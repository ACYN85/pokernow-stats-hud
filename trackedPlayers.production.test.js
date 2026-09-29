'use strict';

var assert = require('assert');
var support = require('./testSupport/productionContentScriptHarness.js');

function instrument(source) {
  return source.replace(/\n\}\)\(\);\s*$/, `
  globalThis.trackedPlayersTest = {
    ensure: ensureSettingsUi,
    open: function () { if (trackedPlayersState.open) return false; updateHudUiPreferences({ selectedSettingsSection: 'players' }, 'test', { render: false }); setSettingsOpen(true, 'test-players'); return true; },
    close: function () { setSettingsOpen(false, 'test-close'); },
    invalidate: invalidateTrackedPlayers,
    careerInvalidate: invalidateLeaderboardCareerStats,
    search: function (value) { handleTrackedPlayersInput({ target: { value: value, selectionStart: String(value).length, selectionEnd: String(value).length, classList: { contains: function (name) { return name === 'pnhud-tracked-players-search'; } } } }); },
    sort: function (value) { handleTrackedPlayersChange({ target: { value: value, classList: { contains: function (name) { return name === 'pnhud-tracked-players-sort'; } } } }); },
    click: function (playerId, displayName) { handleTrackedPlayersClick({ target: { closest: function (selector) { return selector === '.pnhud-tracked-player-row' ? { dataset: { trackedPlayerId: playerId, trackedPlayerName: displayName }, isConnected: true, focus: function () {} } : null; } } }); },
    state: function () {
      var panel = document.getElementById(trackedPlayersPanelId); var launcher = document.getElementById('pnhud-tracked-players-launcher');
      return {
        open: trackedPlayersState.open, loading: trackedPlayersState.loading, search: trackedPlayersState.search, sort: trackedPlayersState.sort,
        settingsOpen: hudUiPreferences.settingsOpen, selectedSection: hudUiPreferences.selectedSettingsSection,
        summaries: trackedPlayersState.summaries, backendRequests: trackedPlayersState.backendRequests, renders: trackedPlayersState.renders,
        html: panel && panel.innerHTML || '', panelHidden: panel && panel.hidden, panelBound: panel && panel.dataset.pnhudTrackedPlayersBound,
        launcherText: launcher && launcher.textContent, launcherExpanded: launcher && launcher.getAttribute('aria-expanded'),
        rootCount: [document.getElementById(trackedPlayersPanelId)].filter(Boolean).length,
        settingsRootCount: [document.getElementById(settingsPanelId)].filter(Boolean).length,
        dashboardRootCount: [document.getElementById(playerDashboardId)].filter(Boolean).length,
        dashboard: { open: playerDashboardState.open, playerId: playerDashboardState.playerId, displayName: playerDashboardState.displayName, mode: playerDashboardState.mode, note: playerDashboardState.note, loading: playerDashboardState.loading, coreHands: playerDashboardState.coreStats && playerDashboardState.coreStats.counters && playerDashboardState.coreStats.counters.hands }
      };
    },
    stop: function () { cleanupExtension('tracked players fixture teardown'); }
  };
})();
`);
}

function flush() { return Promise.resolve().then(function () { return Promise.resolve(); }).then(function () { return Promise.resolve(); }); }
function state(harness) { return JSON.parse(JSON.stringify(harness.evaluateInIsolatedWorld('trackedPlayersTest.state()'))); }
function call(harness, expression) { return harness.evaluateInIsolatedWorld('trackedPlayersTest.' + expression); }
function summary(id, name, hands, lastSeenAt, revision) { return { playerId: id, latestDisplayName: name, hands: hands, lastSeenAt: lastSeenAt, revision: revision || 1, summaryVersion: 1 }; }

(async function () {
  var messages = [];
  var summaryRequests = [];
  var dashboardRequests = [];
  var initialStorage = { pokerNowHudPlayerNotesV1: { version: 1, notes: { 'id-unseated': 'Remember the river bluff.' } } };
  var harness = support.createHarness({
    gameId: 'tracked-players-production',
    initialStorage: initialStorage,
    transformContentSource: instrument,
    runtimeSendMessage: function (message, callback) {
      messages.push(message);
      if (message.method === 'initialize') return callback({ ok: true, value: {} });
      if (message.method === 'careerPlayerSummaries') return summaryRequests.push({ callback: callback });
      if (message.method === 'careerDashboardStats') return dashboardRequests.push({ playerId: message.args[0], callback: callback });
      if (message.method === 'careerTrendStats') return callback({ ok: true, value: null });
      callback({ ok: true, value: {} });
    }
  });
  assert.deepStrictEqual(harness.evaluationErrors, []);
  await flush();

  var initial = state(harness);
  assert.ok(!initial.launcherText, 'standalone launcher is absent');
  assert.strictEqual(initial.rootCount, 0);
  call(harness, 'ensure()'); call(harness, 'ensure()');
  assert.strictEqual(state(harness).rootCount, 0, 'browser mounts only inside Players');

  assert.strictEqual(call(harness, 'open()'), true);
  assert.strictEqual(call(harness, 'open()'), false, 'opening an already-open browser cannot overlap instances or requests');
  assert.strictEqual(summaryRequests.length, 1, 'initial open issues exactly one lightweight summary request');
  assert.ok(state(harness).html.includes('Preparing tracked players'), 'pending readiness is explicit');
  assert.ok(!state(harness).launcherExpanded); assert.strictEqual(state(harness).panelBound, 'true');
  summaryRequests[0].callback({ ok: true, value: [] }); await flush();
  assert.ok(state(harness).html.includes('No tracked players yet'));

  var rows = [
    summary('id-recent', 'Same Name', 8, 300, 1),
    summary('id-unseated', 'Same Name', 40, null, 1),
    summary('dragon-ABC-999', 'xxDragon69', 12, 200, 1)
  ];
  call(harness, 'careerInvalidate(["id-recent"], "accepted Career append")');
  assert.strictEqual(summaryRequests.length, 2);
  summaryRequests[1].callback({ ok: true, value: rows }); await flush();
  var loaded = state(harness);
  assert.ok(loaded.html.indexOf('id-recent') < loaded.html.indexOf('dragon-ABC-999'));
  assert.ok(loaded.html.indexOf('dragon-ABC-999') < loaded.html.indexOf('id-unseated'), 'default ordering is recent-first and unavailable dates follow');
  assert.strictEqual((loaded.html.match(/Same Name/g) || []).length >= 2, true, 'same display names retain separate rows');
  assert.ok(loaded.html.includes('40 hands') && loaded.html.includes('Last seen unavailable') && loaded.html.includes('dragon\u2026-999'));

  var backendCount = summaryRequests.length;
  call(harness, 'search("DRA")');
  assert.ok(state(harness).html.includes('xxDragon69') && !state(harness).html.includes('Same Name'));
  call(harness, 'search("abc-9")');
  assert.ok(state(harness).html.includes('xxDragon69'), 'partial stable ID matches locally');
  call(harness, 'search("dragon-ABC-999")');
  assert.ok(state(harness).html.includes('xxDragon69'), 'full stable ID matches locally');
  call(harness, 'search("nothing")');
  assert.ok(state(harness).html.includes('No matching players'));
  call(harness, 'search("")');
  call(harness, 'sort("hands")');
  assert.ok(state(harness).html.indexOf('id-unseated') < state(harness).html.indexOf('dragon-ABC-999'));
  call(harness, 'sort("name")');
  assert.ok(state(harness).html.indexOf('id-recent') < state(harness).html.indexOf('id-unseated'), 'name ties end with stable ID');
  assert.strictEqual(summaryRequests.length, backendCount, 'search keystrokes and sort changes issue zero Career requests');
  call(harness, 'search("Same Name")');

  call(harness, 'careerInvalidate(["id-unseated"], "revision A")'); var stale = summaryRequests.at(-1);
  call(harness, 'careerInvalidate(["id-unseated"], "revision B")'); var current = summaryRequests.at(-1);
  current.callback({ ok: true, value: [summary('id-unseated', 'Renamed Player', 41, 500, 3)] }); await flush();
  stale.callback({ ok: true, value: rows }); await flush();
  assert.strictEqual(state(harness).summaries.length, 1);
  assert.strictEqual(state(harness).summaries[0].latestDisplayName, 'Renamed Player', 'late refresh cannot overwrite the newer name/count/date snapshot');
  call(harness, 'careerInvalidate(null, "Career backup restored", true)'); var restoredSummaries = summaryRequests.at(-1);
  assert.strictEqual(state(harness).summaries.length, 0, 'SAFE REPLACE hard-clears settled pre-restore summaries while the restored snapshot loads');
  assert.ok(!state(harness).html.includes('Renamed Player'), 'pre-restore Tracked Players rows do not survive hard invalidation');
  restoredSummaries.callback({ ok: true, value: [summary('id-unseated', 'Restored Player', 7, 450, 4)] }); await flush();
  assert.strictEqual(state(harness).summaries[0].latestDisplayName, 'Restored Player');

  call(harness, 'click("id-unseated", "Renamed Player")');
  var summariesBeforeSelection = summaryRequests.length;
  call(harness, 'click("id-recent", "Same Name")');
  assert.deepStrictEqual(dashboardRequests.map(function (request) { return request.playerId; }), ['id-unseated', 'id-recent'], 'rapid rows route exact stable IDs through the existing Dashboard query');
  var latestDashboard = dashboardRequests[1]; var staleDashboard = dashboardRequests[0];
  latestDashboard.callback({ ok: true, value: { core: { counters: { hands: 8 }, coverage: {} }, relational: {}, careerTrackingStartedAt: null } }); await flush();
  staleDashboard.callback({ ok: true, value: { core: { counters: { hands: 999 }, coverage: {} }, relational: {}, careerTrackingStartedAt: null } }); await flush();
  assert.strictEqual(state(harness).dashboard.playerId, 'id-recent');
  assert.strictEqual(state(harness).dashboard.coreHands, 8, 'stale Dashboard identity result cannot win');
  call(harness, 'click("id-unseated", "Renamed Player")');
  dashboardRequests.at(-1).callback({ ok: true, value: { core: { counters: { hands: 41 }, coverage: {} }, relational: {}, careerTrackingStartedAt: null } }); await flush();
  assert.strictEqual(state(harness).dashboard.mode, 'career', 'unseated player absent from Session opens in existing Career mode');
  assert.strictEqual(state(harness).dashboard.note, 'Remember the river bluff.', 'existing stable-ID note is loaded by the shared Dashboard');

  assert.strictEqual(state(harness).open, true, 'selecting players keeps the Players browser open');
  assert.strictEqual(state(harness).settingsOpen, true);
  assert.strictEqual(state(harness).selectedSection, 'players');
  assert.strictEqual(state(harness).sort, 'name', 'row selection preserves local sort state');
  assert.strictEqual(state(harness).search, 'Same Name', 'row selection preserves non-empty local search state');
  assert.strictEqual(summaryRequests.length, summariesBeforeSelection, 'row selection never reloads careerPlayerSummaries');
  assert.strictEqual(state(harness).settingsRootCount, 1);
  assert.strictEqual(state(harness).dashboardRootCount, 1);
  call(harness, 'search("")');
  call(harness, 'invalidate()'); var closingRequest = summaryRequests.at(-1); var rendersBeforeClose = state(harness).renders;
  call(harness, 'close()');
  closingRequest.callback({ ok: true, value: rows }); await flush();
  assert.strictEqual(state(harness).open, false);
  assert.strictEqual(state(harness).renders, rendersBeforeClose, 'closing hides without rendering results from the pending request');
  backendCount = summaryRequests.length;
  call(harness, 'careerInvalidate(["new-player"], "closed Career append")');
  assert.strictEqual(summaryRequests.length, backendCount, 'closed browser does not query or render on invalidation');

  call(harness, 'open()');
  assert.strictEqual(summaryRequests.length, backendCount + 1, 'reopen performs one fresh lightweight enumeration');
  summaryRequests.at(-1).callback({ ok: true, value: rows.concat([summary('new-player', 'New Player', 1, 600, 1)]) }); await flush();
  assert.ok(state(harness).html.includes('New Player'));
  assert.strictEqual(state(harness).rootCount, 1);
  assert.strictEqual(messages.filter(function (message) { return message.method === 'careerPlayers' || message.method === 'careerStats'; }).length, 0, 'browser never invokes legacy enumeration or per-player stats/history');
  assert.ok(messages.filter(function (message) { return message.method === 'careerPlayerSummaries'; }).length === summaryRequests.length);

  call(harness, 'close()');
  var scaleMeasurements = [];
  for (var count of [100, 500, 1000]) {
    var requestsBefore = summaryRequests.length;
    var forbiddenBefore = messages.filter(function (message) { return message.method === 'careerPlayers' || message.method === 'careerStats' || message.method === 'careerStatsFiltered'; }).length;
    call(harness, 'open()');
    assert.strictEqual(summaryRequests.length, requestsBefore + 1);
    var scaleRows = Array.from({ length: count }, function (_unused, index) { return summary('scale-' + String(index).padStart(4, '0'), 'Scale Player ' + index, index, 10000 + index, 1); });
    summaryRequests.at(-1).callback({ ok: true, value: scaleRows }); await flush();
    call(harness, 'search("scale p")'); call(harness, 'search("scale pl")'); call(harness, 'search("scale player 9")');
    call(harness, 'sort("hands")'); call(harness, 'sort("name")'); call(harness, 'sort("recent")');
    assert.strictEqual(summaryRequests.length, requestsBefore + 1, '100/500/1000 local interaction never adds summary requests');
    var forbiddenAfter = messages.filter(function (message) { return message.method === 'careerPlayers' || message.method === 'careerStats' || message.method === 'careerStatsFiltered'; }).length;
    assert.strictEqual(forbiddenAfter, forbiddenBefore, '100/500/1000 browser rendering never introduces history/stat queries');
    scaleMeasurements.push({ players: count, initialSummaryRequests: 1, searchCareerRequests: 0, sortCareerRequests: 0, historyOrPerPlayerRequests: 0 });
    call(harness, 'close()');
  }

  call(harness, 'stop()');
  assert.strictEqual(harness.documentListenerCount('keydown'), 0, 'shared key listener is removed on teardown');
  console.log(JSON.stringify({ trackedPlayersProductionScale: scaleMeasurements }));
  console.log('Tracked Players production Settings tab/readiness/query/refresh/Dashboard/race lifecycle tests passed.');
})().catch(function (error) { console.error(error); process.exitCode = 1; });
