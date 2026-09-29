'use strict';

var assert = require('assert');
var aggregator = require('./careerStatsAggregator.js');
var indexed = require('./careerIndexedStore.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');
var support = require('./testSupport/careerPlayerSummaryHarness.js');
var browserMode = process.argv.includes('--browser');
function metadata() { return { careerTrackingStartedAt: 1, careerSchemaInitializedAt: 1, initializedByBuildId: 'summary-fixture', firstAcceptedHandKey: null, firstAcceptedAt: null, latestAcceptedAt: null }; }

function record(hand, id, name, at, options) {
  return fixtures.record('SUMMARIES', hand, [fixtures.player(id, name)], Object.assign({ finalizedAt: at }, options || {}));
}
function fields(player) {
  return JSON.parse(JSON.stringify({ latestDisplayName: player.latestDisplayName, hands: player.counters.hands, lastSeenAt: player.lastSeenAt }));
}
async function assertExact(harness, records) {
  var expected = aggregator.rebuild(records).aggregate.players;
  var rows = await harness.call('careerPlayerSummaries');
  assert.deepStrictEqual(rows.map(function (row) { return row.playerId; }).sort(), Object.keys(expected).sort());
  for (var row of rows) {
    assert.deepStrictEqual({ latestDisplayName: row.latestDisplayName, hands: row.hands, lastSeenAt: row.lastSeenAt }, fields(expected[row.playerId]));
    assert.deepStrictEqual(fields(await harness.call('careerStats', [row.playerId])), fields(expected[row.playerId]), 'summary equals existing full player query');
    assert.strictEqual(row.summaryVersion, indexed.PLAYER_SUMMARY_VERSION);
    assert.ok(Number.isInteger(row.revision));
  }
  return rows;
}

(async function () {
  var harness = await support.openHarness(browserMode);
  try {
    await harness.reset([], true);
    assert.deepStrictEqual(await harness.call('careerPlayerSummaries'), []);
    var a = record('A', 'P1', 'Alice', 10);
    assert.strictEqual((await harness.call('append', [a])).accepted, true);
    var rows = await assertExact(harness, [a]);
    assert.deepStrictEqual(rows[0], { playerId: 'P1', revision: 1, summaryVersion: indexed.PLAYER_SUMMARY_VERSION, latestDisplayName: 'Alice', hands: 1, lastSeenAt: 10 });
    var other = record('OTHER', 'P2', 'Bob', 12);
    await harness.call('append', [other]);
    var before = await harness.run(() => readSummaryHeads());
    var b = record('B', 'P1', 'Alicia', 20);
    var update = await harness.sampleSummary('append', [b]);
    assert.strictEqual(update.value.accepted, true);
    assert.strictEqual(update.probe.playerHistoryRetrievals, 0, 'ordinary append updates the maintained player aggregate without history retrieval');
    if (browserMode) assert.deepStrictEqual(update.probe.headWrites, ['P1']);
    var after = await harness.run(() => readSummaryHeads());
    assert.deepStrictEqual(after.find(h => h.playerId === 'P2'), before.find(h => h.playerId === 'P2'), 'unaffected head is byte-for-byte unchanged');
    rows = await assertExact(harness, [a, b, other]);
    assert.deepStrictEqual(fields(aggregator.rebuild([a, b]).aggregate.players.P1), { latestDisplayName: 'Alicia', hands: 2, lastSeenAt: 20 });
    var duplicate = await harness.sampleSummary('append', [b]);
    assert.strictEqual(duplicate.value.duplicate, true);
    assert.strictEqual(duplicate.probe.playerHistoryRetrievals, 0);
    assert.deepStrictEqual(await harness.call('careerPlayerSummaries'), rows, 'duplicate acknowledgement leaves revisions and summaries unchanged');

    // Replay the durable outbox, including the committed-but-unacknowledged case.
    var replayRecord = record('REPLAY', 'P1', 'Replay name', 30);
    var saved = {}; saved[indexed.outboxKey(replayRecord)] = replayRecord;
    var pending = indexed.outboxRecords(saved)[0];
    assert.strictEqual((await harness.call('append', [pending.record])).accepted, true);
    assert.strictEqual((await harness.call('append', [pending.record])).duplicate, true);
    await assertExact(harness, [a, b, other, replayRecord]);

    var successor = record('REPLAY', 'P1', 'Corrected older timestamp', 5, { supersedesFingerprint: replayRecord.fingerprint, semanticVersions: { preflop: 3 } });
    var superseded = await harness.sampleSummary('append', [successor]);
    assert.strictEqual(superseded.value.supersession, true);
    assert.strictEqual(superseded.probe.playerHistoryRetrievals, 1);
    rows = await assertExact(harness, [a, b, other, replayRecord, successor]);
    assert.strictEqual(rows.find(r => r.playerId === 'P1').hands, 3, 'one active contribution replaces its predecessor');
    assert.strictEqual(rows.find(r => r.playerId === 'P1').lastSeenAt, 20, 'superseding timestamp can reduce the maximum');
    assert.strictEqual(rows.find(r => r.playerId === 'P1').latestDisplayName, 'Alicia');
    var tip = record('REPLAY', 'P1', 'Chain tip', 40, { supersedesFingerprint: successor.fingerprint, semanticVersions: { preflop: 3, core: 2 } });
    await harness.call('append', [tip]);
    await assertExact(harness, [a, b, other, replayRecord, successor, tip]);
    var fork = record('REPLAY', 'P1', 'Conflicting', 90, { supersedesFingerprint: replayRecord.fingerprint, semanticVersions: { flopCBet: 2 } });
    var stable = await harness.call('careerPlayerSummaries');
    assert.strictEqual((await harness.call('append', [fork])).conflict, true);
    var invalid = record('REPLAY', 'P1', 'Invalid no advance', 100, { supersedesFingerprint: tip.fingerprint, semanticVersions: { preflop: 3, core: 2 } });
    assert.strictEqual((await harness.call('append', [invalid])).conflict, true);
    assert.deepStrictEqual(await harness.call('careerPlayerSummaries'), stable, 'rejected successors do not mutate authoritative activity');

    // Legacy on-disk ambiguity is resolved by the same full-set quarantine path.
    var quarantined = [a, other, replayRecord, successor, fork];
    await harness.seedLegacy(quarantined);
    var backfill = await harness.sampleSummary();
    assert.strictEqual(backfill.probe.playerHistoryRetrievals, 0);
    assert.strictEqual(backfill.probe.backfills, 1);
    rows = await assertExact(harness, quarantined);
    assert.strictEqual(rows.find(r => r.playerId === 'P1').hands, 1);
    assert.strictEqual(rows.find(r => r.playerId === 'P1').lastSeenAt, 10);
    assert.strictEqual((await harness.call('append', [tip])).conflict, true, 'a quarantined chain cannot accept a new tip');
    await harness.seedLegacy([replayRecord, successor, fork]);
    await harness.sampleSummary();
    assert.deepStrictEqual(await harness.call('careerPlayerSummaries'), [], 'only-quarantined identity has no active aggregate row');
    assert.strictEqual(await harness.call('careerStats', ['P1']), null);

    // Critic regression: a malformed cross-player successor is absent from
    // its predecessor player's index, but still quarantines the entire hand.
    var crossRoot = record('CROSS', 'P1', 'Quarantined name', 100);
    var crossPeer = record('CROSS', 'P2', 'Conflicting peer', 200, { supersedesFingerprint: crossRoot.fingerprint, semanticVersions: { preflop: 3 } });
    var crossValid = record('CROSS-VALID', 'P1', 'Valid name', 10);
    var crossNext = record('CROSS-NEXT', 'P1', 'Next name', 20);
    await harness.seedLegacy([crossRoot, crossPeer, crossValid]);
    // Simulate a v1 index and a warm cache built from the old incomplete subset.
    await harness.run(async function (records) {
      var player = PokerCareerStatsAggregator.rebuild([records[0], records[2]]).aggregate.players.P1;
      var staleCache = { playerId: 'P1', revision: 3, aggregateSchemaVersion: PokerCareerStatsAggregator.AGGREGATE_SCHEMA_VERSION, physicalRecordCount: 2, player: player };
      function oldHead(head) { return Object.assign({}, head, { summaryVersion: 1, summary: head.playerId === 'P1' ? { latestDisplayName: player.latestDisplayName, hands: player.counters.hands, lastSeenAt: player.lastSeenAt } : null }); }
      if (!summaryProbe.browser) {
        var hooks = queryService.testHooks; hooks.metadata.playerSummaryVersion = 1;
        hooks.heads.forEach((head, id) => hooks.heads.set(id, oldHead(head))); hooks.caches.set('P1', staleCache);
      } else {
        var db = await openSummaryDb();
        await new Promise((resolve, reject) => {
          var tx = db.transaction(['careerMetadata', 'careerPlayerHeads', 'careerAggregateCache'], 'readwrite');
          var request = tx.objectStore('careerMetadata').get('career');
          request.onsuccess = () => { var meta = request.result; meta.playerSummaryVersion = 1; tx.objectStore('careerMetadata').put(meta); };
          var cursorRequest = tx.objectStore('careerPlayerHeads').openCursor();
          cursorRequest.onsuccess = () => { var cursor = cursorRequest.result; if (cursor) { cursor.update(oldHead(cursor.value)); cursor.continue(); } };
          tx.objectStore('careerAggregateCache').put(staleCache); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        });
        db.close();
      }
    }, [crossRoot, crossPeer, crossValid]);
    var crossBackfill = await harness.sampleSummary();
    assert.strictEqual(crossBackfill.probe.historyRetrievals, 1);
    assert.strictEqual(crossBackfill.value[0].hands, 1);
    assert.strictEqual(crossBackfill.value[0].summaryVersion, indexed.PLAYER_SUMMARY_VERSION);
    assert.deepStrictEqual((await harness.run(() => readSummaryHeads())).find(head => head.playerId === 'P1').contextHandKeys, [crossRoot.handKey]);
    await assertExact(harness, [crossRoot, crossPeer, crossValid]);
    assert.strictEqual((await harness.call('careerHudStats', [['P1', 'P2']])).players.P1.counters.hands, 1, 'HUD cache agrees after v1 backfill');
    assert.strictEqual((await harness.call('careerDashboardStats', ['P1', {}])).core.counters.hands, 1);
    assert.strictEqual((await harness.call('careerStatsFiltered', ['P1', {}])).counters.hands, 1);
    var crossUpdate = await harness.sampleSummary('append', [crossNext]);
    assert.strictEqual(crossUpdate.value.accepted, true);
    assert.strictEqual(crossUpdate.probe.playerHistoryRetrievals, 0);
    if (browserMode) assert.strictEqual(crossUpdate.probe.historyRetrievals, 1, 'ordinary append checks only the new hand before extending the aggregate');
    rows = await assertExact(harness, [crossRoot, crossPeer, crossValid, crossNext]);
    assert.deepStrictEqual({ hands: rows[0].hands, latestDisplayName: rows[0].latestDisplayName, lastSeenAt: rows[0].lastSeenAt }, { hands: 2, latestDisplayName: 'Next name', lastSeenAt: 20 });
    assert.strictEqual((await harness.call('careerHudStats', [['P1']])).players.P1.counters.hands, 2);
    assert.strictEqual((await harness.call('careerDashboardStats', ['P1', {}])).core.counters.hands, 2);
    assert.strictEqual((await harness.call('careerStatsFiltered', ['P1', {}])).counters.hands, 2);
    var playerRecordInfo = await harness.call('careerPlayerRecordInfo', ['P1']);
    assert.deepStrictEqual([playerRecordInfo.physicalRecordCount, playerRecordInfo.activeRecordCount], [3, 2]);
    var peerNext = record('CROSS-PEER-NEXT', 'P2', 'Peer next', 30);
    await harness.call('append', [peerNext]);
    var crossCorrection = record('CROSS-NEXT', 'P1', 'Corrected next', 40, { supersedesFingerprint: crossNext.fingerprint, semanticVersions: { preflop: 3 } });
    await harness.call('append', [crossCorrection]);
    await assertExact(harness, [crossRoot, crossPeer, crossValid, crossNext, peerNext, crossCorrection]);
    var contextRead = await harness.sampleSummary();
    assert.strictEqual(contextRead.probe.historyRetrievals, 0, 'quarantine context is not fetched by summary enumeration');
    assert.strictEqual(contextRead.probe.aggregateRebuilds, 0);
    var cleanPlayerHand = record('CROSS-CLEAN', 'CLEAN', 'Clean player', 50);
    var cleanAppend = await harness.sampleSummary('append', [cleanPlayerHand]);
    assert.strictEqual(cleanAppend.probe.historyRetrievals, 1, 'quarantine elsewhere adds no player-history read to a normal append');
    var cleanStats = await harness.sampleSummary('careerStats', ['CLEAN']);
    assert.strictEqual(cleanStats.value.counters.hands, 1);
    assert.strictEqual(cleanStats.probe.historyRetrievals, 0, 'new player aggregate is warm immediately after append');
    assert.strictEqual((await harness.sampleSummary('careerStats', ['CLEAN'])).probe.historyRetrievals, 0);


    // All supported schemas, invalid timestamps, and deterministic name ties.
    var legacy = [1, 2, 3].map(function (version) {
      var value = record('SCHEMA-' + version, 'SCHEMA-' + version, 'Schema ' + version, 100 + version);
      value.schemaVersion = version;
      if (version < 3) delete value.players[0].position;
      if (version < 2) delete value.players[0].relational;
      value.fingerprint = aggregator.fingerprint(value); return value;
    });
    [undefined, null, 'bad timestamp', -7, '42'].forEach(function (timestamp, index) {
      var value = record('TIME-' + index, 'TIME-' + index, 'Time ' + index, 1);
      if (timestamp === undefined) delete value.finalizedAt; else value.finalizedAt = timestamp;
      legacy.push(value); // finalizedAt is intentionally outside the existing fingerprint
    });
    legacy.push(record('TIE-Z', 'TIE', 'Last by hand key', 50));
    legacy.push(record('TIE-A', 'TIE', 'First by hand key', 50));
    legacy.push(record('TIE-ZZ', 'TIE', '', 60));
    legacy.push(record('TIE-B', 'TIE', 'Older named record', 55));
    var unsupported = record('UNSUPPORTED', 'BAD', 'Unsupported', 999); unsupported.schemaVersion = 999; unsupported.fingerprint = aggregator.fingerprint(unsupported); legacy.push(unsupported);
    var malformed = record('MALFORMED', 'BAD2', 'Malformed', 999); malformed.players[0].counters.hands = -1; malformed.fingerprint = aggregator.fingerprint(malformed); legacy.push(malformed);
    await harness.seedLegacy(legacy);
    await harness.sampleSummary();
    rows = await assertExact(harness, legacy);
    assert.strictEqual(rows.find(r => r.playerId === 'TIME-2').lastSeenAt, null);
    assert.strictEqual(rows.find(r => r.playerId === 'TIME-0').lastSeenAt, 0);
    assert.strictEqual(rows.find(r => r.playerId === 'TIE').latestDisplayName, 'Older named record');
    var cooperative = await aggregator.rebuildCooperatively(legacy, async function () {});
    assert.deepStrictEqual(cooperative, aggregator.rebuild(legacy), 'cooperative resolution matches the full authoritative result, including rejections');
    var warm = await harness.sampleSummary();
    assert.strictEqual(warm.probe.historyRetrievals, 0);
    assert.strictEqual(warm.probe.aggregateRebuilds, 0);
    assert.deepStrictEqual(warm.value, rows, 're-running readiness/backfill is idempotent');

    // Backup-derived replacement has no dependency on old heads or summary fields.
    var replacement = [record('RESTORED', 'RESTORED', 'Restored identity', 77)];
    await harness.call('replaceCareerRecords', [replacement, metadata()]);
    rows = await assertExact(harness, replacement);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].playerId, 'RESTORED');
    assert.ok((await harness.run(() => readSummaryHeads())).every(head => head.contextHandKeys.length === 0), 'restore removes stale quarantine read hints');
    var exported = await harness.call('exportCareer');
    await assert.rejects(harness.call('replaceCareerRecords', [[unsupported], metadata()]), /validation/);
    assert.deepStrictEqual(await harness.call('exportCareer'), exported, 'invalid SAFE REPLACE preserves the old stores');
    assert.deepStrictEqual(await harness.call('careerPlayerSummaries'), rows);

    // Concurrent accepted appends cannot lose an affected player's revision/count.
    var concurrentA = record('CONCURRENT-A', 'RESTORED', 'Concurrent A', 80);
    var concurrentB = record('CONCURRENT-B', 'RESTORED', 'Concurrent B', 81);
    var concurrent = await Promise.all([harness.call('append', [concurrentA]), harness.call('append', [concurrentB])]);
    assert.ok(concurrent.every(result => result.accepted));
    await assertExact(harness, replacement.concat([concurrentA, concurrentB]));

    // Restart/interruption cannot publish or trust any partial summary generation.
    var many = Array.from({ length: 500 }, (_, i) => record('M' + i, 'M' + i, 'Player ' + i, i + 1));
    await harness.seedLegacy(many);
    await harness.run(async function () {
      summaryFault.pause = true;
      if (!globalThis.queryService) globalThis.queryService = await PokerCareerIndexedStore.createIndexedService(indexedDB, {}, {});
      globalThis.pendingSummary = queryService.careerPlayerSummaries().then(function (rows) { return { rows: rows }; }, function (error) { return { error: error.message }; });
      while (!summaryFault.resume) await new Promise(resolve => setTimeout(resolve, 0));
    });
    var waiting = await harness.call('careerLedgerInfo');
    assert.strictEqual(waiting.playerSummariesReady, false);
    assert.strictEqual(waiting.playerSummaryBackfillRunning, true);
    assert.ok((await harness.run(() => readSummaryHeads())).every(head => !head.summaryVersion), 'no partial heads before commit');
    var interrupted = await harness.run(async function () {
      summaryFault.fail = true; summaryFault.pause = false; summaryFault.resume();
      return pendingSummary;
    });
    assert.match(interrupted.error, /interrupted/);
    assert.strictEqual((await harness.call('careerLedgerInfo')).playerSummariesReady, false);
    await harness.run(async function () {
      globalThis.summaryFault = {};
      if (summaryProbe.browser) { queryService.close(); globalThis.queryService = await PokerCareerIndexedStore.createIndexedService(indexedDB, {}, {}); }
    });
    assert.strictEqual((await harness.call('careerPlayerSummaries')).length, 500, 'retry/restart rebuilds the complete generation');

    // A restore while an old snapshot is yielded must win, even at equal counts.
    await harness.seedLegacy(many);
    await harness.run(async function () {
      summaryFault.pause = true;
      if (!globalThis.queryService) globalThis.queryService = await PokerCareerIndexedStore.createIndexedService(indexedDB, {}, {});
      globalThis.pendingSummary = queryService.careerPlayerSummaries();
      while (!summaryFault.resume) await new Promise(resolve => setTimeout(resolve, 0));
    });
    var restoredMany = many.map((_, i) => record('NEW' + i, 'NEW' + i, 'Restored ' + i, i + 1));
    await harness.call('replaceCareerRecords', [restoredMany, metadata()]);
    var afterRace = await harness.run(async function () { summaryFault.pause = false; summaryFault.resume(); return pendingSummary; });
    assert.strictEqual(afterRace.length, 500);
    assert.ok(afterRace.every(row => row.playerId.startsWith('NEW')), 'stale backfill cannot overwrite SAFE REPLACE');

    // Same metadata/provenance is also possible through the direct replace API.
    // A ready replacement must win even when only old head fields were stale.
    await harness.call('replaceCareerRecords', [many, metadata(), { restoredAt: 123 }]);
    await harness.call('careerPlayerSummaries');
    await harness.run(async function () {
      if (!summaryProbe.browser) {
        queryService.testHooks.heads.forEach(head => { delete head.summaryVersion; });
      } else {
        var db = await openSummaryDb();
        await new Promise((resolve, reject) => {
          var tx = db.transaction('careerPlayerHeads', 'readwrite');
          var request = tx.objectStore('careerPlayerHeads').openCursor();
          request.onsuccess = () => { var cursor = request.result; if (cursor) { var head = cursor.value; delete head.summaryVersion; cursor.update(head); cursor.continue(); } };
          tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        });
        db.close();
      }
      globalThis.summaryFault = { pause: true };
      globalThis.pendingSummary = queryService.careerPlayerSummaries();
      while (!summaryFault.resume) await new Promise(resolve => setTimeout(resolve, 0));
    });
    var sameIdsNewRecords = many.map((_, i) => record('CHANGED' + i, 'M' + i, 'Changed ' + i, i + 1));
    await harness.call('replaceCareerRecords', [sameIdsNewRecords, metadata(), { restoredAt: 123 }]);
    var sameMetadataRace = await harness.run(async function () { summaryFault.pause = false; summaryFault.resume(); return pendingSummary; });
    assert.strictEqual(sameMetadataRace.length, 500);
    assert.ok(sameMetadataRace.every(row => row.latestDisplayName.startsWith('Changed ')), 'a ready replacement wins even with byte-identical metadata');

    if (browserMode) {
      await harness.reset([a, other], true);
      await harness.call('careerPlayerSummaries');
      await harness.call('careerStats', ['P1']); await harness.call('careerStats', ['P2']);
      await harness.run(() => {
        globalThis.dumpSummaryStores = async function () {
          var db = await openSummaryDb();
          try {
            return await new Promise((resolve, reject) => {
              var names = ['careerRecords', 'careerMetadata', 'careerPlayerHeads', 'careerAggregateCache'];
              var tx = db.transaction(names); var values = {};
              names.forEach(name => { var request = tx.objectStore(name).getAll(); request.onsuccess = () => { values[name] = request.result; }; });
              tx.oncomplete = () => resolve(values); tx.onabort = () => reject(tx.error);
            });
          } finally { db.close(); }
        };
      });
      var oldStores = await harness.run(() => dumpSummaryStores());
      var oldExport = await harness.call('exportCareer'); var oldHeads = await harness.run(() => readSummaryHeads());
      await harness.run(() => { summaryFault.abortHeadWrite = true; });
      await assert.rejects(harness.call('append', [b]), /abort|transaction/i);
      assert.deepStrictEqual(await harness.call('exportCareer'), oldExport, 'aborted summary update rolls back appended hand and metadata');
      assert.deepStrictEqual(await harness.run(() => readSummaryHeads()), oldHeads);
      assert.deepStrictEqual(await harness.run(() => dumpSummaryStores()), oldStores, 'all four Career stores retain the committed generation');
      await harness.run(() => { summaryFault.abortHeadWrite = true; });
      await assert.rejects(harness.call('replaceCareerRecords', [replacement, metadata()]), /abort/i);
      assert.deepStrictEqual(await harness.call('exportCareer'), oldExport, 'failed head replacement rolls back all previous Career records');
      assert.deepStrictEqual(await harness.run(() => readSummaryHeads()), oldHeads);
      assert.deepStrictEqual(await harness.run(() => dumpSummaryStores()), oldStores, 'SAFE REPLACE rollback includes warm aggregate caches');
      await harness.seedLegacy(many);
      await harness.run(() => { summaryFault.abortHeadWrite = true; });
      await assert.rejects(harness.sampleSummary(), /abort/i);
      assert.ok((await harness.run(() => readSummaryHeads())).every(head => !head.summaryVersion), 'aborted backfill leaves every legacy head untouched');
      assert.strictEqual((await harness.call('careerPlayerSummaries')).length, 500, 'failed atomic publication retries safely');
    }
    console.log('Career player summary semantics, cache independence, cooperative backfill/restart, restore races, and atomic publication passed: ' + harness.environment);
  } finally { await harness.close(); }
})().catch(function (error) { console.error(error); process.exitCode = 1; });
