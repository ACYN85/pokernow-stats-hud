'use strict';

var assert = require('assert');
var support = require('./testSupport/productionContentScriptHarness.js');
var settings = require('./settingsUi.js');
var stats = require('./stats.js');
var columns = require('./leaderboardStats.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');
var queryHarness = require('./testSupport/careerDashboardQueryHarness.js');
var indexed = require('./careerIndexedStore.js');
var frames = require('./testSupport/flopCBetProductionFrames.js');
var allColumns = ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd'];

function instrument(source) {
  source = source.replace("    recordPauseLifecycleHudRender('full-hud-render',", "    globalThis.__leaderboardHtml = host.innerHTML;\n    recordPauseLifecycleHudRender('full-hud-render',");
  return source.replace(/\n\}\)\(\);\s*$/, `
  globalThis.lbTest = {
    seed: function (events, participants) { liveEvents = events; activeHandState = { participants: participants || {} }; advanceFinalizedSessionRevision('fixture'); refreshHud(); },
    switchSource: function (source) { handleSettingsPanelChange({ target: { name: 'pnhud-leaderboard-stat-source', value: source, classList: { contains: function () { return false; } } } }); },
    refresh: refreshHud,
    invalidate: invalidateSeatHudCareerStats,
    columns: function (ids) { updateLeaderboardSync(false, 'fixture'); updateLeaderboardStatIds(ids, 'fixture'); refreshHud(); },
    sync: function (enabled) { updateLeaderboardSync(enabled, 'fixture'); refreshHud(); },
    seatSource: function (source) { updateHudUiPreferences({ seatHudStatSource: source }, 'fixture'); refreshHud(); },
    visible: function (enabled) { writeVisibilityState(seatOverlaysVisible(), enabled, 'fixture'); },
    storedSource: function (source) { var prefs = PokerHudSettings.merge(hudUiPreferences, { leaderboardStatSource: source }); handleStorageChanged({ hudUiPreferences: { newValue: prefs } }, 'local'); },
    state: function () { return { preferences: hudUiPreferences, columns: effectiveLeaderboardStatIds(), entries: displayData({}).playerEntries, settings: settingsSectionHtml(), html: globalThis.__leaderboardHtml, position: leaderboardHudPosition, dashboard: { mode: playerDashboardState.mode, open: playerDashboardState.open }, profiles: hudUiPreferences.showPlayerProfiles }; },
    remount: function () { var root = document.getElementById(detailsRootId); if (root) root.remove(); refreshHud(); },
    changeTable: function (id) { pokerNowGameId = id; refreshHud(); },
    stop: function () { cleanupExtension('fixture teardown'); }
  };
})();
`);
}
function create(options) {
  var h = support.createHarness(Object.assign({ gameId: 'leaderboard-source', transformContentSource: instrument, initialStorage: {
    hudUiPreferences: settings.merge(settings.DEFAULTS, { leaderboardEnabled: true, selectedSettingsSection: 'hud' })
  } }, options || {}));
  assert.deepStrictEqual(h.evaluationErrors, []);
  return h;
}
function call(h, expression) { return h.evaluateInIsolatedWorld('lbTest.' + expression); }
function state(h) { return JSON.parse(JSON.stringify(call(h, 'state()'))); }
function rows(h) {
  return Array.from(state(h).html.matchAll(/<tr><td>(.*?)<\/td>(.*?)<\/tr>/g)).map(function (match) {
    return [match[1]].concat(Array.from(match[2].matchAll(/data-pnhud-displayed-value="([^"]*)"/g)).map(function (cell) { return cell[1]; }));
  });
}
async function flush() { for (var i = 0; i < 16; i += 1) await Promise.resolve(); }
function event(id, name, action) { return { playerId: id, player: name, handId: 'SESSION', action: action || 'fold', street: 'preflop', amount: 1, timestamp: 1 }; }
var session = [event('a', 'Alex'), event('b', 'Alex', 'raise'), event('c', 'Alexa'), event('missing', 'New'), event(null, 'Unknown')];

(async function () {
  assert.strictEqual(settings.DEFAULTS.leaderboardStatSource, 'session');
  assert.strictEqual(settings.normalize({ version: 10, seatHudStatSource: 'career' }).value.leaderboardStatSource, 'session');
  assert.strictEqual(settings.normalize(settings.merge(settings.DEFAULTS, { leaderboardStatSource: 'invalid' })).value.leaderboardStatSource, 'session');
  var driver = await queryHarness.openHarness(process.argv.includes('--browser'));
  try {
    var records = [fixtures.record('HISTORY', '1', [fixtures.player('a', 'Old Alex', { vpipMade: 1, pfrMade: 1 }), fixtures.player('b', 'Alex')]),
      fixtures.record('HISTORY', '2', [fixtures.player('a', 'Renamed Alex', {
        vpipMade: 1, postflopAggressiveActions: 3, postflopCalls: 1,
        threeBetMade: 1, threeBetOpportunities: 1, foldToThreeBet: 1, foldToThreeBetOpportunities: 1,
        flopCBetMade: 1, flopCBetOpportunities: 1, foldToFlopCBet: 1, foldToFlopCBetOpportunities: 1,
        wtsdMade: 1, wtsdOpportunities: 1, wsdMade: 1, wsdOpportunities: 1
      }, Object.fromEntries(['threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd'].map(function (id) { return [id, fixtures.decision(1, 1, null)]; }))), fixtures.player('c', 'Alexa', { pfrMade: 1 })]),
      fixtures.record('HISTORY', '3', [fixtures.player('historical-only', 'Absent')])];
    await driver.reset(records, true);
    var requests = [];
    var h = create({ runtimeSendMessage: function (message, callback) {
      if (message.method === 'careerHudStats') {
        var request = { ids: Array.from(message.args[0]), callback: callback };
        requests.push(request);
      } else if (message.method === 'initialize') callback({ ok: true, value: {} });
      else if (message.method === 'append') driver.call('append', message.args).then(function (value) { callback({ ok: true, value: value }); });
      else callback({ ok: true, value: {} });
    } });
    call(h, 'seed(' + JSON.stringify(session) + ')');
    call(h, 'columns(' + JSON.stringify(allColumns) + ')');
    var initial = state(h);
    var sessionRows = rows(h);
    assert.strictEqual(sessionRows.length, 5);
    initial.entries.forEach(function (entry, index) {
      var expected = stats.computePlayerStatsByIdentity(session, entry.playerId, entry.playerName);
      assert.deepStrictEqual(sessionRows[index].slice(1), columns.definitions(allColumns).map(function (d) { return columns.formatValue(d, expected); }), 'Session renderer retains all existing values');
    });
    assert.strictEqual(requests.length, 0, 'Session creates no Career requests');
    assert.ok(initial.settings.includes('<h3>Leaderboard statistics</h3>'));
    assert.ok(initial.settings.includes('name="pnhud-leaderboard-stat-source" value="session" checked'));
    assert.ok(initial.settings.includes('name="pnhud-leaderboard-stat-source" value="career"'));
    assert.ok(initial.settings.includes('Use the same statistics and order as seat overlays'));

    call(h, 'switchSource("career")');
    assert.ok(state(h).html.includes('data-leaderboard-source="career" aria-pressed="true"'), 'source presentation switches synchronously');
    assert.ok(state(h).html.includes('Career statistics loading') && !state(h).html.includes('data-pnhud-displayed-value="0"'), 'cold Career batch renders a neutral pending state, not false H0');
    assert.strictEqual(h.storage.hudUiPreferences.leaderboardStatSource, 'career', 'Settings handler persists source');
    assert.deepStrictEqual(requests[0].ids, ['a', 'b', 'c', 'missing']);
    // Await the actual memory/native-IDB result, then deliver through the production message adapter.
    var coldResult = await driver.call('careerHudStats', [requests[0].ids]);
    requests[0].callback({ ok: true, value: coldResult });
    if (process.argv.includes('--browser')) {
      assert.strictEqual(coldResult.query.aggregateReadTransactions, 1, 'one aggregate read transaction covers all rows');
      assert.strictEqual(coldResult.query.playerIndexLookups, 3, 'only uncached known IDs need the existing indexed aggregate rebuild');
      var warmResult = await driver.call('careerHudStats', [requests[0].ids]);
      assert.strictEqual(warmResult.query.playerIndexLookups, 0, 'warm aggregates perform no repeated record retrieval/resolution');
    }
    await flush();
    var careerRows = rows(h);
    assert.deepStrictEqual(careerRows.map(function (r) { return r[0]; }), sessionRows.map(function (r) { return r[0]; }), 'same inclusion and name ordering');
    assert.deepStrictEqual(careerRows[0].slice(1), ['2', '100.0%', '50.0%', '3.0', '100%', '100%', '100%', '100%', '100%', '100%'], 'every supported column uses Career counters');
    assert.deepStrictEqual(careerRows[1].slice(1, 4), ['1', '0.0%', '0.0%'], 'same-name second ID remains separate');
    assert.deepStrictEqual(careerRows[2].slice(1, 4), ['1', '0.0%', '100.0%'], 'similar name remains separate');
    assert.deepStrictEqual(careerRows[3].slice(1), ['0'].concat(new Array(9).fill('---')), 'no-history player uses established placeholders');
    assert.deepStrictEqual(careerRows[4].slice(1), careerRows[3].slice(1), 'name-only player does not infer Career identity');
    assert.ok(!state(h).html.includes('Absent') && !state(h).html.includes('Old Alex'));
    var requestsBeforeReorder = requests.length;
    var rowsBeforeReorder = rows(h);
    call(h, 'seed(' + JSON.stringify(session.slice().reverse()) + ')');
    assert.strictEqual(requests.length, requestsBeforeReorder, 'roster reorder retains the same stable-ID batch identity');
    assert.deepStrictEqual(rows(h), rowsBeforeReorder, 'roster reorder preserves stable-ID snapshot ownership');
    call(h, 'refresh()'); call(h, 'remount()');
    assert.strictEqual(requests.length, 1, 'unchanged renders and remounts reuse the aggregate presentation');
    call(h, 'columns(["wsd", "hands", "vpip"])');
    assert.deepStrictEqual(rows(h)[0].slice(1), ['100%', '2', '100.0%']);
    call(h, 'sync(true)');
    assert.strictEqual(state(h).preferences.leaderboardStatSource, 'career');
    assert.strictEqual(state(h).preferences.seatHudStatSource, 'session');
    call(h, 'seatSource("career")'); call(h, 'switchSource("session")');
    assert.strictEqual(state(h).preferences.seatHudStatSource, 'career');
    call(h, 'columns(' + JSON.stringify(allColumns) + ')');
    assert.deepStrictEqual(rows(h), sessionRows, 'Career to Session repaints immediately');
    assert.deepStrictEqual(state(h).position, initial.position);
    assert.deepStrictEqual(state(h).dashboard, initial.dashboard);
    assert.strictEqual(state(h).preferences.showPotOdds, initial.preferences.showPotOdds);
    assert.strictEqual(state(h).profiles, initial.profiles);
    call(h, 'seatSource("session")');

    var sourceSwitchRequestCount = requests.length;
    call(h, 'switchSource("career")'); var old = requests.at(-1);
    assert.strictEqual(rows(h)[0][1], '2', 'returning to Career immediately displays the last settled stable-ID snapshot');
    assert.strictEqual(requests.length, sourceSwitchRequestCount + 1, 'returning to Career adds only the existing batched refresh');
    call(h, 'switchSource("session")');
    old.callback({ ok: true, value: { players: { a: { counters: { hands: 999 } } } } }); await flush();
    assert.deepStrictEqual(rows(h), sessionRows, 'late Career response cannot overwrite newer Session selection');
    call(h, 'switchSource("career")'); var oldCareer = requests.at(-1);
    call(h, 'storedSource("session")'); call(h, 'storedSource("career")'); var latest = requests.at(-1);
    latest.callback({ ok: true, value: await driver.call('careerHudStats', [latest.ids]) }); await flush();
    oldCareer.callback({ ok: true, value: { players: { a: { counters: { hands: 999 } } } } }); await flush();
    assert.strictEqual(rows(h)[0][1], '2', 'storage source changes guard successive Career requests');

    var appended = fixtures.record('HISTORY', '4', [fixtures.player('a', 'Another rename')]);
    assert.strictEqual((await driver.call('append', [appended])).accepted, true);
    var settledBeforeRefresh = rows(h);
    call(h, 'invalidate(["a"], "accepted Career hand append")'); var revisionRequest = requests.at(-1);
    assert.deepStrictEqual(rows(h), settledBeforeRefresh, 'same-context Career refresh retains every last-settled stat while pending');
    revisionRequest.callback({ ok: true, value: await driver.call('careerHudStats', [revisionRequest.ids]) }); await flush();
    assert.strictEqual(rows(h)[0][1], '3', 'backend append revision refreshes visible Career values');
    assert.notDeepStrictEqual(rows(h), settledBeforeRefresh, 'the complete refreshed row set replaces the retained snapshot together');
    var count = requests.length;
    call(h, 'invalidate(["historical-only"], "unrelated append")'); call(h, 'refresh()');
    assert.strictEqual(requests.length, count, 'unrelated Career players do not trigger retrieval');
    call(h, 'invalidate(["a"], "revision one")'); var staleRevision = requests.at(-1);
    assert.strictEqual(rows(h)[0][1], '3', 'repeated invalidation does not clear the settled Career snapshot');
    call(h, 'invalidate(["a"], "revision two")'); var currentRevision = requests.at(-1);
    assert.strictEqual(rows(h)[0][1], '3');
    currentRevision.callback({ ok: true, value: await driver.call('careerHudStats', [currentRevision.ids]) }); await flush();
    staleRevision.callback({ ok: true, value: { players: { a: { counters: { hands: 999 } } } } }); await flush();
    assert.strictEqual(rows(h)[0][1], '3', 'older revision cannot overwrite newer aggregate');

    call(h, 'invalidate(["a"], "pending roster")'); var departed = requests.at(-1);
    var nextSession = [event('b', 'Alex'), event('new', 'Zed')];
    call(h, 'seed(' + JSON.stringify(nextSession) + ', {"Transient": true})'); var joined = requests.at(-1);
    assert.ok(rows(h).every(function (row) { return row.length === 1; }) && state(h).html.includes('Career statistics loading'), 'changed roster identity clears the prior roster snapshot without publishing false zeros');
    joined.callback({ ok: true, value: await driver.call('careerHudStats', [joined.ids]) }); await flush();
    departed.callback({ ok: true, value: { players: { a: { counters: { hands: 999 } } } } }); await flush();
    assert.deepStrictEqual(rows(h).map(function (r) { return r[0]; }), ['Alex', 'Transient', 'Zed']);
    assert.deepStrictEqual(joined.ids, ['b', 'new']);
    call(h, 'seed(' + JSON.stringify(nextSession) + ')');
    assert.deepStrictEqual(rows(h).map(function (r) { return r[0]; }), ['Alex', 'Zed'], 'departed active-only participant disappears under existing rules');
    call(h, 'changeTable("other-table")'); var otherTable = requests.at(-1);
    assert.notStrictEqual(otherTable, joined, 'same IDs on changed table get a new request epoch');
    assert.ok(rows(h).every(function (row) { return row.length === 1; }) && state(h).html.includes('Career statistics loading'), 'room change cannot retain the prior room snapshot or publish false zeros');
    call(h, 'visible(false)'); count = requests.length;
    otherTable.callback({ ok: true, value: { players: { b: { counters: { hands: 999 } } } } }); await flush();
    call(h, 'invalidate(["b"], "hidden append")'); call(h, 'refresh()'); call(h, 'refresh()');
    assert.strictEqual(requests.length, count, 'hidden source produces no queries or polling');
    call(h, 'visible(true)'); assert.strictEqual(requests.length, count + 1);
    requests.at(-1).callback({ ok: false, error: 'fixture failure' }); await flush();
    assert.strictEqual(rows(h)[0][1], undefined, 'failed lookup never falls back to Session or false H0');
    assert.ok(state(h).html.includes('Career statistics unavailable'));
    call(h, 'refresh()'); assert.strictEqual(requests.length, count + 1, 'failure cannot introduce a request loop');
    var reloadedRequests = [];
    var reloaded = create({ initialStorage: JSON.parse(JSON.stringify(h.storage)), runtimeSendMessage: function (message, callback) {
      if (message.method === 'careerHudStats') reloadedRequests.push({ ids: Array.from(message.args[0]), callback: callback });
      else callback({ ok: true, value: {} });
    } });
    assert.strictEqual(state(reloaded).preferences.leaderboardStatSource, 'career', 'actual startup restores source');
    call(reloaded, 'seed(' + JSON.stringify([event('a', 'Alex'), event('missing', 'New')]) + ')');
    assert.ok(state(reloaded).html.includes('Career statistics loading') && rows(reloaded).every(function (row) { return row.length === 1; }), 'hard reload/new controller starts pending, not with false Career H0');
    assert.deepStrictEqual(reloadedRequests[0].ids, ['a', 'missing']);
    reloadedRequests[0].callback({ ok: true, value: await driver.call('careerHudStats', [reloadedRequests[0].ids]) }); await flush();
    assert.deepStrictEqual(rows(reloaded).map(function (row) { return row.slice(0, 2); }), [['Alex', '3'], ['New', '0']], 'hard-reload batch atomically publishes Career history and genuine settled H0');
    assert.ok(!state(reloaded).html.includes('Session (legacy)'));
    assert.ok(!state(reloaded).html.includes('profile-chip'), 'no Leaderboard profile feature');
    var longSession = Array.from({ length: 65 }, function (_, index) { var id = 'P' + String(index).padStart(3, '0'); return event(id, id); });
    await driver.call('append', [fixtures.record('HISTORY', 'LONG', [fixtures.player('P064', 'P064')])]);
    count = requests.length;
    call(h, 'seed(' + JSON.stringify(longSession) + ')');
    assert.deepStrictEqual(requests.slice(count).map(function (request) { return request.ids.length; }), [64, 1], 'large retained Session list uses bounded batches, never one request per row');
    for (var batch of requests.slice(count)) batch.callback({ ok: true, value: await driver.call('careerHudStats', [batch.ids]) });
    await flush();
    assert.strictEqual(rows(h).length, 65);
    assert.deepStrictEqual(rows(h).at(-1).slice(0, 2), ['P064', '1'], 'the batch limit cannot silently truncate Career history');
    await driver.call('append', [fixtures.record('HISTORY', 'NULL-ID', [fixtures.player('null', 'Literal ID')])]);
    call(h, 'seed(' + JSON.stringify([event('null', 'Literal ID'), event(null, 'No ID')]) + ')');
    var nullRequest = requests.at(-1);
    nullRequest.callback({ ok: true, value: await driver.call('careerHudStats', [nullRequest.ids]) }); await flush();
    assert.deepStrictEqual(rows(h).map(function (row) { return row.slice(0, 2); }), [['Literal ID', '1'], ['No ID', '0']], 'absent identity cannot alias a literal stable ID');
    var mutationSnapshot = rows(h);
    for (var mutationReason of ['Current Session removed from Career', 'Career data imported', 'Career backup restored']) {
      var requestCountBeforeMutation = requests.length;
      call(h, 'invalidate(null, ' + JSON.stringify(mutationReason) + ')');
      var mutationRequest = requests.at(-1);
      assert.strictEqual(requests.length, requestCountBeforeMutation + 1, mutationReason + ' adds exactly one batched refresh');
      assert.deepStrictEqual(rows(h), mutationSnapshot, mutationReason + ' retains the same-context settled snapshot while pending');
      mutationRequest.callback({ ok: true, value: await driver.call('careerHudStats', [mutationRequest.ids]) }); await flush();
      mutationSnapshot = rows(h);
    }
    call(h, 'invalidate(null, "pre-restore pending refresh")'); var preRestorePending = requests.at(-1);
    call(h, 'invalidate(null, "Career backup restored", true)'); var postRestoreRequest = requests.at(-1);
    assert.ok(rows(h).every(function (row) { return row.length === 1; }) && state(h).html.includes('Career statistics loading'), 'SAFE REPLACE hard-clears to pending, not false H0');
    preRestorePending.callback({ ok: true, value: { players: { null: { counters: { hands: 999 } } } } }); await flush();
    assert.ok(rows(h).every(function (row) { return row.length === 1; }), 'late pre-restore Career response cannot repaint after hard invalidation');
    postRestoreRequest.callback({ ok: true, value: await driver.call('careerHudStats', [postRestoreRequest.ids]) }); await flush();
    assert.strictEqual(rows(h)[0][1], '1', 'post-restore request atomically publishes restored Career values');
    call(h, 'invalidate(["null"], "teardown pending")'); var teardown = requests.at(-1);
    var renderCount = h.logs.filter(function (line) { return line[0] === '[HUD UI BOOT 7] first render completed'; }).length;
    call(h, 'stop()');
    teardown.callback({ ok: true, value: { players: { null: { counters: { hands: 999 } } } } }); await flush();
    assert.strictEqual(h.logs.filter(function (line) { return line[0] === '[HUD UI BOOT 7] first render completed'; }).length, renderCount, 'teardown cannot be repainted by pending requests');
    assert.ok(h.logs.every(function (line) { return line[0] !== '[HUD] initialization error'; }));
    console.log('Leaderboard production source/render/settings/identity/race/query checks passed (' + driver.environment + ').');
  } finally { await driver.close(); }

  // Real frames exercise certified hand finalization -> Career append -> invalidation -> renderer.
  var liveStorage = { hudUiPreferences: settings.merge(settings.DEFAULTS, { leaderboardEnabled: true }) };
  var liveKeys = support.storageKeys('leaderboard-source');
  liveStorage[liveKeys.schema] = 4;
  liveStorage[liveKeys.playerMap] = { P1: 'P1', P2: 'P2' };
  liveStorage[liveKeys.liveEvents] = [event('P1', 'P1', 'dealt')];
  liveStorage[liveKeys.finalizedHandIds] = ['SESSION'];
  var live = create({ initialStorage: liveStorage, debugEnabled: true, showdownDebugEnabled: true });
  call(live, 'switchSource("career")');
  var scenario = frames.ordinaryScenario('deep-bet-fold', 'LEADERBOARD-APPEND');
  support.dispatchFrames(live, scenario.frames.slice(0, -1).concat([scenario.terminalFrame]), 'leaderboard-finalization');
  await flush();
  assert.ok(rows(live).some(function (row) { return row[0] === 'P1' && row[1] === '1'; }), 'certified append repaints Career without another hand');
  assert.ok(live.logs.every(function (line) { return line[0] !== '[HUD PIPELINE FAILURE]' && line[0] !== '[HUD] websocket frame processing error'; }));
  console.log('Leaderboard certified hand append production integration passed.');

  // Exercise the production async append callback, including a worker wake that
  // replays the durable outbox before acknowledging the explicit append message.
  for (var replayFirst of [false, true]) {
    var service = indexed.createMemoryService({}, { initializedAt: 1 });
    var appendOutcome;
    var asyncLive = create({ initialStorage: JSON.parse(JSON.stringify(liveStorage)), debugEnabled: true, runtimeSendMessage: function (message, callback) {
      if (message.method === 'initialize') return callback({ ok: true, value: {} });
      if (message.method === 'append') {
        var prepare = replayFirst ? service.append(message.args[0]) : Promise.resolve();
        prepare.then(function () { return service.append(message.args[0]); }).then(function (result) { appendOutcome = result; callback({ ok: true, value: result }); });
      } else if (message.method === 'careerHudStats') service.careerHudStats(message.args[0]).then(function (value) { callback({ ok: true, value: value }); });
      else callback({ ok: true, value: {} });
    } });
    await flush();
    call(asyncLive, 'switchSource("career")'); await flush();
    assert.strictEqual(rows(asyncLive)[0][1], '0');
    support.dispatchFrames(asyncLive, scenario.frames.slice(0, -1).concat([scenario.terminalFrame]), 'indexed-leaderboard-finalization');
    await flush(); await flush();
    assert.ok(appendOutcome && (replayFirst ? appendOutcome.duplicate : appendOutcome.accepted));
    assert.ok(rows(asyncLive).some(function (row) { return row[0] === 'P1' && row[1] === '1'; }), 'successful indexed append/outbox replay refreshes visible Career');
  }
  console.log('Leaderboard indexed append and outbox replay acknowledgement integration passed.');
})().catch(function (error) { console.error(error); process.exitCode = 1; });
