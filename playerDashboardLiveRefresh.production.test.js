'use strict';
var assert = require('assert');
var support = require('./testSupport/productionContentScriptHarness.js');
var frames = require('./testSupport/flopCBetProductionFrames.js');

var requests = [];
var trends = [];
var appends = [];
var h = support.createHarness({
  gameId: 'dashboard-live-refresh',
  controlledClock: true,
  initialNow: 100000,
  initialStorage: (function () {
    var saved = {}, keys = support.storageKeys('dashboard-live-refresh');
    saved[keys.schema] = 4;
    saved[keys.playerMap] = { P1: 'P1', P2: 'P2', P3: 'P3' };
    return saved;
  })(),
  runtimeSendMessage: function (message, callback) {
    if (message.method === 'careerDashboardStats') requests.push({ args: message.args, callback: callback });
    else if (message.method === 'careerTrendStats') trends.push({ args: message.args, callback: callback });
    else if (message.method === 'append') appends.push({ args: message.args, callback: callback });
    else callback({ ok: true, value: {} });
  },
  transformContentSource: function (source) {
    source = source.replace('function cachedSessionFilteredStats(playerId, filters) {',
      'function cachedSessionFilteredStats(playerId, filters) { globalThis.dashboardFullFilteredQueries = (globalThis.dashboardFullFilteredQueries || 0) + 1;');
    return source.replace(/\n\}\)\(\);\s*$/, `
      globalThis.dashboardLiveProbe = {
        open: openPlayerDashboard,
        change: function (mode) { handlePlayerDashboardClick({ target: { closest: function (selector) { return selector === '[data-dashboard-mode]' ? { dataset: { dashboardMode: mode } } : null; } } }); },
        select: function (position, situation, opponentMode, tableSize) {
          playerDashboardState.position = position;
          playerDashboardState.situation = situation;
          playerDashboardState.opponentMode = opponentMode;
          if (tableSize !== undefined) playerDashboardState.tableSize = tableSize;
          if (playerDashboardState.mode === 'career') loadPlayerDashboardCareer();
          else { refreshPlayerDashboardSession(); renderPlayerDashboard(); }
        },
        state: function () { return cloneJson(playerDashboardState); },
        fullFilteredQueries: function () { return globalThis.dashboardFullFilteredQueries || 0; },
        exactSession: function () { return cloneJson(PokerStats.computePlayerStatsByIdentity(liveEvents, playerDashboardState.playerId, playerDashboardState.displayName)); },
        exactCore: function () { return cloneJson(PokerFilteredStats.sessionStatsFiltered(liveEvents, playerDashboardState.playerId, dashboardScopeFilters())); },
        exactRelational: function () { return cloneJson(dashboardRelationalQueries(function (filters) { return PokerFilteredStats.sessionStatsFiltered(liveEvents, playerDashboardState.playerId, filters); })); },
        html: function () { return playerDashboardElement && playerDashboardElement.innerHTML; },
        drain: function () { return careerIndexedAppendQueue; },
        stop: function () { cleanupExtension('dashboard live refresh test'); }
      };
    })();`);
  }
});
function run(expression) { return h.evaluateInIsolatedWorld('dashboardLiveProbe.' + expression); }
function state() { return JSON.parse(JSON.stringify(run('state()'))); }
function send(name, payload, frame) {
  var time = 100000 + frame * 4000;
  support.dispatchFrame(h, '42' + JSON.stringify([name, payload]), 'dashboard-live-' + frame, time);
}
function hand(id, firstFrame) {
  var scenario = frames.ordinaryScenario('bet-fold', id);
  send('gC', scenario.snapshots.initial, firstFrame);
  scenario.frames.slice(2, -1).forEach(function (raw, index) {
    var packet = JSON.parse(raw.slice(2));
    send(packet[0], packet[1], firstFrame + index + 1);
  });
}
async function flush() { for (var i = 0; i < 12; i++) await Promise.resolve(); }
async function settleAppend() {
  await flush();
  var append = appends.find(function (entry) { return !entry.replied; });
  assert.ok(append, 'finalized hand reaches indexed Career append');
  append.replied = true;
  append.callback({ ok: true, value: { accepted: true } });
  await run('drain()');
  await flush();
}
function reply(request, revision, playerId) {
  var id = playerId || request.args[0];
  request.callback({ ok: true, value: {
    core: { counters: { hands: revision, vpipMade: revision, vpipOpportunities: revision }, coverage: { totalCareerHands: revision } },
    comparisonContexts: { playerId: id, source: 'career', playerRevision: revision, situations: {}, positions: {} },
    profileStats: null, relational: {}, query: { playerRevision: revision }
  } });
  var trend = trends[requests.indexOf(request)];
  assert.ok(trend, 'Career trend request accompanies the coherent Dashboard request');
  trend.replied = true;
  trend.callback({ ok: true, value: { query: { playerRevision: revision } } });
}

(async function () {
  assert.deepStrictEqual(h.evaluationErrors, []);
  var baseline = frames.ordinaryScenario('bet-fold', 'LIVE-1');
  send('registered', { currentPlayer: { id: 'P1' }, ownerID: 'P1', gameState: baseline.snapshots.predeal }, 1);
  await flush();
  run('open("P1","P1")');
  run('change("session")');
  run('select(null,"overall","overall","HU")');
  var before = state();
  var fullQueries = run('fullFilteredQueries()');
  assert.equal(before.sessionStats.handsPlayed, 0);
  hand('LIVE-1', 2);
  var after = state();
  assert.equal(after.mode, 'session');
  assert.equal(after.sessionStats.handsPlayed, 1, 'open Session Dashboard advances with finalized hand');
  assert.equal(after.coreStats.counters.hands, 1, 'open HU Dashboard advances from a finalized two-player hand');
  assert.equal(after.tableSize, 'HU');
  assert.ok(after.sessionRevision > before.sessionRevision);
  assert.equal(after.comparisonContexts.sessionRevision, after.sessionRevision, 'Session comparison and cards share revision');
  assert.equal(run('fullFilteredQueries()'), fullQueries, 'routine finalized hand does not rescan history for Dashboard filters');
  assert.deepStrictEqual(after.sessionStats, JSON.parse(JSON.stringify(run('exactSession()'))), 'complete-hand incremental stats equal authoritative Session result');
  assert.deepStrictEqual(after.coreStats, JSON.parse(JSON.stringify(run('exactCore()'))), 'incremental Overall cards equal authoritative full result');
  assert.match(run('html()'), /1 hand/, 'visible Dashboard rerenders without reopening');
  await settleAppend();

  run('select("SB","overall","self")');
  var filtered = state();
  fullQueries = run('fullFilteredQueries()');
  hand('LIVE-2', 50);
  var filteredAfter = state();
  assert.equal(filteredAfter.sessionStats.handsPlayed, 2);
  assert.equal(filteredAfter.tableSize, 'HU', 'position filter preserves the selected table size');
  assert.equal(filteredAfter.position, 'SB');
  assert.equal(filteredAfter.situation, 'overall');
  assert.equal(filteredAfter.opponentMode, 'self');
  assert.ok(filteredAfter.sessionRevision > filtered.sessionRevision);
  assert.equal(run('fullFilteredQueries()'), fullQueries, 'filtered hand append avoids full-history query');
  assert.deepStrictEqual(filteredAfter.relationalStats, JSON.parse(JSON.stringify(run('exactRelational()'))), 'incremental relational results equal authoritative full result');
  await settleAppend();
  run('select(null,"ip","others")');
  hand('LIVE-3', 100);
  assert.equal(state().situation, 'ip');
  assert.equal(state().opponentMode, 'others');
  assert.deepStrictEqual(state().relationalStats, JSON.parse(JSON.stringify(run('exactRelational()'))), 'IP/others hand append preserves exact relational counters and coverage');
  await settleAppend();

  run('select(null,"ip","others","all")');
  run('change("career")');
  var initial = requests.at(-1);
  reply(initial, 3);
  await flush();
  assert.equal(state().loading, false);
  assert.equal(state().careerRevision, 3);
  var pending = requests.length;
  hand('LIVE-4', 150);
  assert.equal(requests.length, pending, 'Session finalization does not query Career before accepted append');
  await settleAppend();
  assert.ok(requests.length > pending, 'accepted Career append refreshes open Career Dashboard');
  var fresh = requests.at(-1);
  reply(fresh, 4);
  await flush();
  assert.equal(state().careerRevision, 4);
  assert.equal(state().coreStats.counters.hands, 4);
  assert.equal(state().comparisonContexts.playerRevision, 4);
  assert.equal(state().mode, 'career');
  assert.equal(state().situation, 'ip');
  assert.equal(state().opponentMode, 'others');

  run('select("SB","overall","self")');
  var staleFilter = requests.at(-1);
  run('select(null,"ip","others")');
  var currentFilter = requests.at(-1);
  reply(staleFilter, 5);
  await flush();
  assert.equal(state().loading, true, 'old filter response stays fenced');
  reply(currentFilter, 5);
  await flush();
  assert.equal(state().situation, 'ip');
  assert.equal(state().opponentMode, 'others');

  run('open("P2","P2")');
  run('change("career")');
  var oldPlayer = requests.at(-1);
  run('open("P1","P1")');
  run('change("career")');
  var currentPlayer = requests.at(-1);
  reply(oldPlayer, 6);
  await flush();
  assert.equal(state().playerId, 'P1', 'old player response stays fenced');
  reply(currentPlayer, 6);
  await flush();
  assert.equal(state().comparisonContexts.playerId, 'P1');

  hand('LIVE-5', 200);
  await settleAppend();
  var oldRevision = requests.at(-1);
  hand('LIVE-6', 250);
  await settleAppend();
  var currentRevision = requests.at(-1);
  assert.notStrictEqual(currentRevision, oldRevision, 'second accepted append starts a newer Career request');
  reply(oldRevision, 7);
  await flush();
  assert.equal(state().loading, true, 'rapid append cannot publish older revision');
  reply(currentRevision, 8);
  await flush();
  assert.equal(state().careerRevision, 8);
  assert.equal(state().comparisonContexts.playerRevision, 8);

  run('open("P3","P3")');
  run('change("career")');
  var unrelated = requests.at(-1);
  reply(unrelated, 1);
  await flush();
  var requestCount = requests.length;
  hand('LIVE-7', 300);
  await settleAppend();
  assert.equal(requests.length, requestCount, 'unrelated player avoids Career Dashboard query');

  run('open("P1","P1")');
  run('change("career")');
  var staleSource = requests.at(-1);
  run('change("session")');
  reply(staleSource, 9);
  await flush();
  assert.equal(state().mode, 'session');
  assert.equal(state().comparisonContexts.source, 'session', 'late Career response cannot repaint Session');

  run('stop()');
  console.log('Open Dashboard Session finalization and accepted Career revision refresh production tests passed.');
})().catch(function (error) { console.error(error); process.exitCode = 1; });
