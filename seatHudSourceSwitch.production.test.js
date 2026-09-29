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
    cachedSessionPlayerStats: function () { return { handsPlayed: 3, vpip: 66.7, pfr: 33.3 }; },
    cloneJson: function (value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); },
    scheduleSeatOverlayReconcile: function (reason) { scheduled.push(reason); },
    console: { warn: function () {} },
    Promise: Promise, Map: Map, Set: Set, Array: Array, String: String, Object: Object, Number: Number
  };
  vm.runInNewContext(content.slice(start, end), context);
  context.hudUiPreferences.seatHudStatSource = 'session';
  assert.strictEqual(context.seatHudStatsForPlayer('stable-1', 'playerA').handsPlayed, 3, 'Session Seat HUD reads the current authoritative Session projection');
  context.seatHudCareerStatsByPlayer.set('stable-1', authoritativeCareer);
  context.hudUiPreferences.seatHudStatSource = 'career';
  assert.strictEqual(context.seatHudStatsForPlayer('stable-1', 'playerA').handsPlayed, 20, 'switching to Career reads only the Career batch projection');
  context.hudUiPreferences.seatHudStatSource = 'session';
  assert.strictEqual(context.seatHudStatsForPlayer('stable-1', 'playerA').handsPlayed, 3, 'Career to Session switching cannot retain the Career projection');
  context.seatHudCareerStatsByPlayer.clear();
  context.hudUiPreferences.seatHudStatSource = 'career';
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

  var retireStart = content.indexOf('  function retireUnownedSeatOverlayDom(');
  var retireEnd = content.indexOf('  function potOddsOwnedMutationElement(', retireStart);
  assert.ok(retireStart >= 0 && retireEnd > retireStart, 'production orphan retirement can be isolated');
  function fakeOverlay(html) {
    return { html: html, connected: true, remove: function () { this.connected = false; } };
  }
  var sharedRoot = {
    dataset: { pnhudRendererInstance: 'old-renderer' }, children: [],
    appendChild: function (element) { this.children.push(element); return element; },
    querySelectorAll: function () { return this.children.filter(function (element) { return element.connected; }); }
  };
  function controllerForRoot() {
    return seatOverlay.createController({
      create: function (entry) { return sharedRoot.appendChild(fakeOverlay('H ' + entry.stats.handsPlayed)); },
      update: function (record, entry) { record.element.html = 'H ' + entry.stats.handsPlayed; },
      move: function () {}, position: function () {},
      remove: function (record) { record.element.remove(); }, skip: function () {}
    });
  }
  function overlayEntry(hands) {
    return { playerId: 'stable-1', name: 'playerA', seatId: 'seat-1', confirmed: true, rect: { left: 1, top: 1, width: 10, height: 10 }, stats: { handsPlayed: hands }, statSource: 'session', displayedStatIds: ['hands'] };
  }
  var predecessorController = controllerForRoot();
  predecessorController.reconcile([overlayEntry(12)], { displayMode: 'seat-overlays-only' });
  var cleanupContext = {
    hudRendererInstanceId: 'current-renderer', seatOverlayRendererSuperseded: false,
    layer: sharedRoot,
    console: { log: function () {} }, Array: Array
  };
  vm.runInNewContext(content.slice(retireStart, retireEnd) + '\nretired = retireUnownedSeatOverlayDom(layer);', cleanupContext);
  assert.strictEqual(cleanupContext.retired, 1, 'a reused root retires the old H12 overlay outside the new controller');
  var currentController = controllerForRoot();
  currentController.reconcile([overlayEntry(3)], { displayMode: 'seat-overlays-only' });
  assert.deepStrictEqual(sharedRoot.querySelectorAll().map(function (element) { return element.html; }), ['H 3'], 'the current renderer owns the only connected card');
  var predecessorContext = {
    hudRendererInstanceId: 'old-renderer', seatOverlayRendererSuperseded: false,
    seatOverlayLayer: sharedRoot, seatOverlayController: predecessorController, seatReconcileTimer: 1,
    clearTimeout: function () {}, console: { warn: function () {}, log: function () {} }, Array: Array, Boolean: Boolean
  };
  vm.runInNewContext(content.slice(retireStart, retireEnd) + '\nif (!seatOverlayRendererOwnsLayer(seatOverlayLayer)) retireSupersededSeatOverlayRenderer("test ownership transfer");\nif (seatOverlayRendererOwnsLayer(seatOverlayLayer)) seatOverlayController.reconcile([entry], { displayMode: "seat-overlays-only" });', Object.assign(predecessorContext, { entry: overlayEntry(12) }));
  assert.strictEqual(predecessorContext.seatOverlayRendererSuperseded, true, 'the predecessor permanently observes ownership transfer');
  assert.strictEqual(predecessorController.records.size, 0, 'the predecessor controller relinquishes all records');
  assert.deepStrictEqual(sharedRoot.querySelectorAll().map(function (element) { return element.html; }), ['H 3'], 'a later predecessor reconcile cannot recreate H12 after seat remount');
  assert.strictEqual(sharedRoot.dataset.pnhudRendererInstance, 'current-renderer');
  assert.ok(content.indexOf('retireUnownedSeatOverlayDom(seatOverlayLayer)') < content.indexOf('seatOverlayController = PokerSeatOverlay.createController({'), 'orphan DOM is retired before the current controller accepts ownership');
  assert.ok(content.includes("reconcileSeatOverlays('authoritative Session reset committed')"), 'a committed Session reset republishes mounted Seat HUDs without waiting for DOM discovery');

  console.log('Seat HUD global Session/Career source, batch/cache, zero-history, formatting, persistence, stale-response, teardown, and profile-source tests passed.');
})().catch(function (error) { console.error(error); process.exitCode = 1; });
