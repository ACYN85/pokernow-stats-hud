'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');
var settings = require('./settingsUi.js');
var seatOverlay = require('./seatOverlay.js');
var careerStore = require('./careerIndexedStore.js');

function deferred() {
  var resolve;
  var reject;
  var promise = new Promise(function (yes, no) { resolve = yes; reject = no; });
  return { promise: promise, resolve: resolve, reject: reject };
}

(async function () {
  var defaults = settings.normalize(undefined).value;
  assert.strictEqual(defaults.seatHudStatSource, 'session', 'Seat HUD statistics default to Session');
  var migrated = settings.normalize(Object.assign({}, defaults, { version: 9 }));
  assert.strictEqual(migrated.value.seatHudStatSource, 'session', 'v9 preferences migrate safely to Session');
  var careerPreference = settings.merge(defaults, { seatHudStatSource: 'career' });
  assert.strictEqual(settings.normalize(careerPreference).value.seatHudStatSource, 'career', 'Career source survives persisted preference reload');
  assert.deepStrictEqual(settings.SEAT_HUD_STAT_SOURCES, ['session', 'career']);

  var authoritativeCareer = { counters: {
    hands: 20, vpipMade: 8, vpipOpportunities: 20, pfrMade: 5, pfrOpportunities: 20,
    postflopAggressiveActions: 9, postflopCalls: 3,
    threeBetMade: 2, threeBetOpportunities: 8, foldToThreeBet: 3, foldToThreeBetOpportunities: 6,
    flopCBetMade: 4, flopCBetOpportunities: 5, foldToFlopCBet: 2, foldToFlopCBetOpportunities: 4,
    wtsdMade: 6, wtsdOpportunities: 12, wsdMade: 4, wsdOpportunities: 6
  } };
  var beforeCareer = JSON.parse(JSON.stringify(authoritativeCareer));
  var careerStats = seatOverlay.careerStatsToOverlayStats(authoritativeCareer);
  assert.deepStrictEqual(seatOverlay.compactStatLabels(careerStats, ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']), ['H 20', 'VPIP 40%', 'PFR 25%', 'AF 3.0', '3B 25%', 'F3B 50%', 'CB 80%', 'FCB 50%', 'WTSD 50%', 'W$SD 67%']);
  assert.deepStrictEqual(authoritativeCareer, beforeCareer, 'Career conversion is read-only');
  assert.deepStrictEqual(seatOverlay.compactStatLabels(seatOverlay.careerStatsToOverlayStats(null), ['hands', 'vpip', 'pfr', 'af', 'threeBet']), ['H 0', 'VPIP ---', 'PFR ---', 'AF ---', '3B ---'], 'zero-history Career players use valid existing placeholders');
  var unsupported = seatOverlay.careerStatsToOverlayStats({ counters: { hands: 2, futureUnsupportedCounter: 999 } });
  assert.deepStrictEqual(seatOverlay.compactStatLabels(unsupported, ['hands', 'vpip', 'wtsd']), ['H 2', 'VPIP 0%', 'WTSD ---'], 'unsupported Career fields preserve existing formatting semantics');

  var runtimeCalls = [];
  var runtime = {
    lastError: null,
    sendMessage: function (message, callback) { runtimeCalls.push(message); callback({ ok: true, value: { players: {}, query: { batched: true } } }); }
  };
  await careerStore.createMessageService(runtime).careerHudStats(['stable-1', 'stable-1', '', 'stable-2']);
  assert.strictEqual(runtimeCalls.length, 1, 'all mounted seats use one Career runtime request');
  assert.deepStrictEqual(runtimeCalls[0].args[0], ['stable-1', 'stable-2'], 'Career batch deduplicates stable player IDs');

  var content = fs.readFileSync('./content.js', 'utf8');
  var careerIndexedSource = fs.readFileSync('./careerIndexedStore.js', 'utf8');
  var start = content.indexOf('  function currentSeatHudStatSource()');
  var end = content.indexOf('  function cachedSessionFilteredStats(', start);
  assert.ok(start >= 0 && end > start, 'production Career HUD query functions can be isolated');
  var pending = deferred();
  var scheduled = [];
  var context = {
    PokerSeatOverlay: seatOverlay,
    PokerCareerContributionStore: { playerStats: function () { throw new Error('fallback should not run'); } },
    PokerSessionStatsCache: {}, PokerStats: {},
    hudUiPreferences: { seatHudStatSource: 'career' },
    careerIndexedService: { careerHudStats: function () { return pending.promise; } },
    careerStoreState: null,
    seatHudCareerStatsByPlayer: new Map(),
    seatHudCareerLoadedSignature: '', seatHudCareerPendingSignature: '', seatHudCareerRequestToken: 0,
    seatHudCareerQueryDiagnostics: { batchRequests: 0, lastRequestedPlayerIds: [], lastError: null, loading: false, lastResultPlayerCount: 0, lastQuery: null },
    confirmedSeatMappings: new Map([['stable-1', {}], ['stable-2', {}]]),
    cloneJson: function (value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); },
    scheduleSeatOverlayReconcile: function (reason) { scheduled.push(reason); },
    console: { warn: function () {} },
    Promise: Promise, Map: Map, Set: Set, Array: Array, String: String, Object: Object, Number: Number
  };
  vm.runInNewContext(content.slice(start, end), context);
  var request = context.requestSeatHudCareerBatch(['stable-1', 'stable-2'], 'test', true);
  context.hudUiPreferences.seatHudStatSource = 'session';
  context.seatHudCareerRequestToken += 1;
  pending.resolve({ players: { 'stable-1': authoritativeCareer }, query: { batched: true } });
  assert.strictEqual(await request, false, 'in-flight Career result is ignored after switching to Session');
  assert.strictEqual(context.seatHudCareerStatsByPlayer.size, 0, 'stale Career result cannot repaint Session HUDs');
  assert.strictEqual(scheduled.length, 0, 'stale Career result schedules no repaint');

  var pendingTeardown = deferred();
  context.hudUiPreferences.seatHudStatSource = 'career';
  context.careerIndexedService.careerHudStats = function () { return pendingTeardown.promise; };
  var teardownRequest = context.requestSeatHudCareerBatch(['stable-1'], 'teardown', true);
  context.seatHudCareerRequestToken += 1;
  pendingTeardown.resolve({ players: { 'stable-1': authoritativeCareer }, query: { batched: true } });
  assert.strictEqual(await teardownRequest, false, 'teardown token invalidates pending Career results');

  assert.ok(content.includes("requestSeatHudCareerBatch(Array.from(confirmedSeatMappings.keys())"), 'one mounted-ID batch feeds every Career seat HUD');
  assert.ok(content.includes('seatHudCareerRequestToken += 1;') && content.includes("incomingUiPreference.value.seatHudStatSource === 'career'"), 'stored source changes invalidate stale work');
  assert.ok(content.includes("profileStatSource: 'session'"), 'profile records remain explicitly Session-derived');
  assert.ok(seatOverlay.profileTooltipHtml({ visible: true, archetype: 'TAG', rawScores: {} }, true, 'session', 'career').includes('profile remains Session-based'), 'Career HUD tooltip truthfully identifies the Session profile source');
  assert.ok(content.includes('Career uses all hands currently stored in PokerNow HUD Career data.'), 'Settings uses concise Career helper text');
  assert.ok(!content.includes('All Time</label>'), 'Seat HUD source is called Career, never All Time');
  assert.ok(content.includes("seatHudStatSource: nextSeatHudSource") && content.includes("updateHudUiPreferences"), 'one global persisted setting switches all seat records');
  assert.ok(content.includes("currentSeatHudStatSource() !== 'career'"), 'Session rendering does not consume a late Career response');
  assert.ok(content.includes('record.canonicalPlacement') && content.includes('manualOverlayPositions[drag.playerId]'), 'source switching is independent from canonical-relative drag offsets');
  assert.ok(careerIndexedSource.includes('aggregateReadTransactions: 1') && careerIndexedSource.includes('playerIndexLookups: staleIndexes.length'), 'Career batch uses one aggregate/cache transaction and only indexed stale-cache rebuilds');

  console.log('Seat HUD global Session/Career source, batch/cache, zero-history, formatting, persistence, stale-response, teardown, and profile-source tests passed.');
})().catch(function (error) { console.error(error); process.exitCode = 1; });
