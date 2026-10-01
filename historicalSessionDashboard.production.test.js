'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const indexed = require('./careerIndexedStore.js');
const aggregator = require('./careerStatsAggregator.js');
const fixtures = require('./testSupport/careerBackupFixtures.js');
const policy = require('./careerBackupPolicy.js');
const backup = require('./careerBackup.js');
const crypto = require('node:crypto').webcrypto;
const support = require('./testSupport/productionContentScriptHarness.js');

const S = '00000000-0000-4000-8000-000000000011';
const U = '00000000-0000-4000-8000-000000000012';
function record(id, sessionId, at, names) {
  const players = names.map((name, index) => {
    const player = fixtures.player(name, name);
    player.position = { schemaVersion: 1, status: 'supported', dealtPosition: index === 0 ? 'BTN' : index === 1 ? 'BB' : 'SB', dealtPlayerCount: names.length, unsupportedReason: null };
    return player;
  });
  return fixtures.record('HISTORY-UI', id, players, { historicalSessionId: sessionId, finalizedAt: at });
}
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); for (let i = 0; i < 24; i++) await Promise.resolve(); }
async function until(predicate) { for (let i = 0; i < 100; i++) { await flush(); if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Timed out waiting for Dashboard deletion state'); }

(async () => {
  const service = indexed.createMemoryService({}, { initializedAt: 1 });
  const start = Date.UTC(2026, 8, 29, 12);
  for (let i = 0; i < 10; i++) await service.append(record('S-' + i, S, start + i * 1000, i < 5 ? ['A', 'B'] : ['A', 'B', 'C']));
  await service.append(record('S-B-ONLY', S, start + 11000, ['B', 'C']));
  await service.append(record('U-A', U, start + 86400000, ['A', 'B']));
  const legacy = structuredClone(record('LEGACY-A', S, start - 60 * 86400000, ['A', 'B']));
  legacy.schemaVersion = 3;
  delete legacy.session;
  legacy.fingerprint = aggregator.fingerprint(legacy);
  await service.append(legacy);
  const legacyOnly = structuredClone(record('LEGACY-Z', S, start - 61 * 86400000, ['Z', 'B']));
  legacyOnly.schemaVersion = 3;
  delete legacyOnly.session;
  legacyOnly.fingerprint = aggregator.fingerprint(legacyOnly);
  await service.append(legacyOnly);
  for (let i = 0; i < 48; i++) {
    const sessionId = '00000000-0000-4000-8000-' + String(i + 100).padStart(12, '0');
    for (let j = 0; j < (i === 0 ? 50 : 1); j++)
      await service.append(record('EXTRA-' + i + '-' + j, sessionId, start - (i + 1) * 86400000 + j * 1000, ['A', 'B']));
  }
  let workerListener;
  const workerIndexed = Object.assign({}, indexed, {
    hasCompleteDatabase: async () => true,
    outboxRecords: () => [],
    createIndexedService: async () => service
  });
  const worker = {
    importScripts() {}, indexedDB: {}, PokerCareerIndexedStore: workerIndexed,
    PokerCareerBackupPolicy: policy, PokerCareerBackup: backup, crypto,
    chrome: { storage: { local: { get: async () => ({ ['pokerNowHudSessionMeta:game:' + encodeURIComponent('pokernow.com:HISTORY-UI')]: {
      gameId: 'HISTORY-UI', sessionKey: 'pokernow.com:HISTORY-UI', historicalSessionId: S } }), getKeys: async () => [], set: async () => {}, remove: async () => {} } },
      runtime: { onMessage: { addListener(listener) { workerListener = listener; } }, getManifest: () => ({ version: '1.4.0' }) } },
    console, Date, Promise, Object, Array, String, Error
  };
  worker.globalThis = worker;
  vm.runInNewContext(fs.readFileSync('./careerServiceWorker.js', 'utf8'), worker, { filename: 'careerServiceWorker.js' });
  assert.equal(typeof workerListener, 'function');
  const requests = [];
  const delayed = [];
  let delayDetail = false;
  let failDetail = false;
  const h = support.createHarness({
    gameId: 'historical-session-dashboard',
    runtimeSendMessage(message, callback) {
      requests.push(message);
      if (failDetail && message.method === 'getCareerSessionPlayerStats') callback({ ok: false, error: 'fixture detail failure' });
      else if (delayDetail && message.method === 'getCareerSessionPlayerStats') delayed.push({ message, callback });
      else workerListener(JSON.parse(JSON.stringify(message)), {}, callback);
    },
    transformContentSource(source) {
      return source.replace(/\n\}\)\(\);\s*$/, `
        var historyScroller = { scrollTop: 0 };
        var lastFocus = null;
        globalThis.historyProbe = {
          open: openPlayerDashboard,
          mode: function (mode) { handlePlayerDashboardClick({ target: { closest: function (selector) { return selector === '[data-dashboard-mode]' ? { dataset: { dashboardMode: mode } } : null; } } }); },
          view: function (view) { handlePlayerDashboardClick({ target: { closest: function (selector) { return selector === '[data-dashboard-history-view]' ? { dataset: { dashboardHistoryView: view } } : null; } } }); },
          row: function (sessionId) { handlePlayerDashboardClick({ target: { closest: function (selector) { return selector === '[data-dashboard-history-session]' ? { dataset: { dashboardHistorySession: sessionId } } : null; } } }); },
          deletion: function (selector) { handlePlayerDashboardClick({ target: { closest: function (query) { return query === selector ? { disabled: false } : null; } } }); },
          back: function () { handlePlayerDashboardClick({ target: { closest: function (selector) { return selector === '.pnhud-dashboard-history-back' ? {} : null; } } }); },
          size: function (size) { handlePlayerDashboardInput({ target: { value: size, matches: function (selector) { return selector === '[data-dashboard-table-size]'; } } }); },
          situation: function (value) { handlePlayerDashboardInput({ target: { value: value, matches: function (selector) { return selector === '[data-dashboard-situation]'; } } }); },
          position: function (value) { handlePlayerDashboardInput({ target: { value: value, matches: function (selector) { return selector === '[data-dashboard-position]'; } } }); },
          self: function (id) { localUserPlayerId = id; playerDashboardState.selfPlayerId = id; renderPlayerDashboard(); },
          opponent: function (value) { handlePlayerDashboardClick({ target: { closest: function (selector) { return selector === '[data-dashboard-opponent]' ? { dataset: { dashboardOpponent: value }, disabled: false } : null; } } }); },
          html: function () { return playerDashboardElement.innerHTML; },
          state: function () { return cloneJson(playerDashboardState); },
          current: function (sessionId) { historicalSessionId = sessionId; playerDashboardState.currentHistoricalSessionId = sessionId; renderPlayerDashboard(); },
          currentId: function () { return historicalSessionId; },
          attachScroll: function () { var original = playerDashboardElement.querySelector.bind(playerDashboardElement); playerDashboardElement.querySelector = function (selector) { if (selector === '.pnhud-dashboard-history-rows') return historyScroller; if (selector === '.pnhud-dashboard-history-back' || selector.indexOf('[data-dashboard-history-session=') === 0 || selector.indexOf('[data-dashboard-') === 0) return { focus: function () { lastFocus = selector; } }; return original(selector); }; },
          focus: function () { return lastFocus; },
          scroll: function (value) { historyScroller.scrollTop = value; },
          scrollValue: function () { return historyScroller.scrollTop; },
          seedLive: function (hands) { playerDashboardState.sessionStats.handsPlayed = hands; },
          append: function (record) { return enqueueIndexedCareerRecord(record); },
          drain: function () { return careerIndexedAppendQueue; },
          stop: function () { cleanupExtension('historical dashboard test'); }
        };
      })();`);
    }
  });
  function run(expression) { return h.evaluateInIsolatedWorld('historyProbe.' + expression); }
  function state() { return JSON.parse(JSON.stringify(run('state()'))); }
  assert.deepEqual(h.evaluationErrors, []);
  await flush();
  run('open("A","Alice")');
  assert.match(run('html()'), /data-dashboard-mode="history"/);
  run('mode("history")');
  await flush();
  assert.equal(requests.filter(item => item.method === 'listCareerSessionPlayerSummaries' && item.args[0] === 'A').length, 1);
  assert.equal(requests.filter(item => item.method === 'getCareerSessionPlayerStats').length, 0, 'list uses no per-row detail queries');
  assert.equal(state().historyList.sessions.length, 50);
  assert.equal(state().historyList.unassigned.legacyHandCount, 1);
  assert.match(run('html()'), /Career hand lacks explicit Session provenance/);
  assert.deepEqual(state().historyList.sessions.slice(0, 2).map(row => row.sessionId), [U, S]);
  assert.match(run('html()'), /Sep 29, 2026/, 'numeric authoritative timestamp receives a local date label');
  run('current("' + S + '")');
  assert.match(run('html()'), /Current Session/);
  assert.match(run('html()'), /10 hands played · Session total: 11/);
  assert.match(run('html()'), /HU 5 · 3–5 5/);
  assert.match(run('html()'), /VPIP .* · PFR .* · 3Bet /);
  assert.equal((run('html()').match(/data-dashboard-history-session=/g) || []).length, 50);
  run('attachScroll()');
  run('scroll(137)');
  run('row("' + S + '")');
  assert.equal(state().historyListScroll, 137);
  assert.equal(run('focus()'), '.pnhud-dashboard-history-back');
  await flush();
  assert.equal(state().mode, 'history-detail');
  assert.equal(state().selectedHistorySessionId, S);
  assert.ok(state().coreStats, state().error || 'missing Session detail');
  assert.equal(state().coreStats.counters.hands, 10);
  for (const label of ['Hands', 'VPIP', 'PFR', 'AF', '3Bet', 'F3B', 'CBet', 'FCB', 'WTSD', 'W$SD']) assert.ok(run('html()').includes('>' + label + '</span>'), label);
  assert.match(run('html()'), /pnhud-dashboard-evidence/);
  assert.match(run('html()'), /Back to Sessions/);
  run('self("B")');
  const beforeRelational = requests.filter(item => item.method === 'getCareerSessionPlayerStats').length;
  run('opponent("self")');
  await flush();
  const relationalRequests = requests.filter(item => item.method === 'getCareerSessionPlayerStats').slice(beforeRelational);
  assert.equal(relationalRequests.length, 4);
  assert.ok(relationalRequests.every(item => item.args[0] === S && item.args[1] === 'A'));
  assert.deepEqual(relationalRequests.slice(1).map(item => item.args[2].statId), ['threeBet', 'foldToThreeBet', 'foldToFlopCBet']);
  assert.ok(relationalRequests.slice(1).every(item => item.args[2].counterpartMode === 'self' && item.args[2].selfPlayerId === 'B'));
  run('opponent("overall")');
  await flush();
  run('size("HU")');
  await flush();
  assert.equal(state().coreStats.counters.hands, 5);
  run('situation("ip")');
  await flush();
  assert.equal(requests.filter(item => item.method === 'getCareerSessionPlayerStats').at(-1).args[2].situation, 'ip');
  run('situation("overall")');
  run('position("BTN")');
  await flush();
  assert.equal(requests.filter(item => item.method === 'getCareerSessionPlayerStats').at(-1).args[2].position, 'BTN');
  delayDetail = true;
  run('size("3_TO_5")');
  run('size("HU")');
  assert.equal(delayed.length, 2);
  const staleFilter = delayed.shift();
  workerListener(JSON.parse(JSON.stringify(staleFilter.message)), {}, staleFilter.callback);
  await flush();
  assert.equal(state().loading, true, 'older filter result cannot replace the newer request');
  const latest = delayed.shift();
  workerListener(JSON.parse(JSON.stringify(latest.message)), {}, latest.callback);
  await flush();
  assert.equal(state().loading, false);
  assert.equal(state().tableSize, 'HU');
  delayDetail = false;
  run('scroll(0)');
  run('back()');
  assert.equal(run('scrollValue()'), 137, 'Back restores the bounded list scroll region');
  assert.equal(run('focus()'), '[data-dashboard-history-session="' + S + '"]');
  assert.equal(state().mode, 'history-list');
  assert.equal(requests.filter(item => item.method === 'listCareerSessionPlayerSummaries' && item.args[0] === 'A').length, 1, 'Back reuses list');
  run('row("00000000-0000-4000-8000-000000000100")');
  await flush();
  assert.equal(state().coreStats.counters.hands, 50);
  assert.match(run('html()'), /Session profile · HU/);
  assert.match(run('html()'), /Based on 50 Session hands/);
  assert.match(run('html()'), /pnhud-dashboard-insights/, 'supported Session observations use selected Session counters');
  run('back()');
  run('row("' + U + '")');
  await flush();
  assert.equal(state().coreStats.counters.hands, 1, 'weak Session retains its own sample');
  assert.doesNotMatch(run('html()'), /pnhud-dashboard-insights|pnhud-dashboard-review-signals/, 'weak Session does not borrow Career analysis support');
  run('back()');
  failDetail = true;
  run('seedLive(99)');
  run('row("' + S + '")');
  await flush();
  assert.match(run('html()'), /Historical Session statistics could not be loaded/);
  assert.doesNotMatch(run('html()'), /99 hands|Finalized hands|pnhud-dashboard-relational-grid/, 'failed detail cannot show live Session cards');
  failDetail = false;
  run('back()');
  delayDetail = true;
  run('row("' + S + '")');
  assert.ok(delayed.length);
  run('open("B","Bob")');
  run('mode("history")');
  await flush();
  const bobHtml = run('html()');
  delayed.splice(0).forEach(item => workerListener(JSON.parse(JSON.stringify(item.message)), {}, item.callback));
  await flush();
  assert.equal(state().playerId, 'B');
  assert.equal(state().selectedHistorySessionId, null);
  assert.equal(run('html()'), bobHtml, 'late Alice detail cannot repaint Bob');
  delayDetail = false;
  run('open("C","Charlie")');
  await flush();
  assert.equal(state().mode, 'history-list', 'player switch keeps History mode');
  assert.equal(state().historyList.sessions.length, 1, 'one-Session history remains browsable');
  run('open("Z","Legacy")');
  await flush();
  assert.equal(state().historyList.sessions.length, 0);
  assert.match(run('html()'), /No historical Sessions recorded yet/);
  assert.match(run('html()'), /lacks explicit Session provenance/);
  run('open("N","New player")');
  await flush();
  assert.equal(state().historyList.sessions.length, 0);
  assert.doesNotMatch(run('html()'), /lacks explicit Session provenance/);
  run('open("A","Alice")');
  run('mode("history")');
  await flush();
  const listCalls = requests.filter(item => item.method === 'listCareerSessionPlayerSummaries' && item.args[0] === 'A').length;
  run('current("' + S + '")');
  run('append(' + JSON.stringify(record('S-APPEND', S, start + 12000, ['A', 'B'])) + ')');
  await run('drain()');
  await flush();
  assert.equal(requests.filter(item => item.method === 'listCareerSessionPlayerSummaries' && item.args[0] === 'A').length, listCalls + 1, 'accepted current Session append refreshes open list');
  assert.equal(state().historyList.sessions.find(row => row.sessionId === S).playerHandCount, 11);
  run('row("' + S + '")');
  await flush();
  run('append(' + JSON.stringify(record('S-APPEND-2', S, start + 13000, ['A', 'B'])) + ')');
  await run('drain()');
  await flush();
  assert.equal(state().coreStats.counters.hands, 12, 'selected current historical Session refreshes from accepted Career hands');
  run('back()');
  await flush();
  run('view("trends")');
  await flush();
  assert.equal(state().historyTrend.points.some(point => point.sessionId === U), true, 'Trend initially includes old Session');
  run('view("sessions")');
  await flush();
  run('row("' + U + '")');
  await flush();
  const detailCalls = requests.filter(item => item.method === 'getCareerSessionPlayerStats').length;
  run('append(' + JSON.stringify(record('S-APPEND-3', S, start + 14000, ['A', 'B'])) + ')');
  await run('drain()');
  await flush();
  assert.equal(requests.filter(item => item.method === 'getCareerSessionPlayerStats').length, detailCalls, 'completed historical selection does not reload for current Session append');
  run('deletion("[data-dashboard-delete-session]")');
  await until(() => !state().historyDeletionLoading);
  assert.ok(state().historyDeletionPreview, JSON.stringify({ state: state(), lastRequest: requests.at(-1) }));
  assert.equal(state().historyDeletionPreview.sessionId, U);
  assert.equal(state().historyDeletionPreview.logicalHandCount, 1);
  assert.match(run('html()'), /whole Session for every affected player, regardless of the filters/);
  assert.equal(run('focus()'), '[data-dashboard-cancel-session-deletion]');
  run('deletion("[data-dashboard-cancel-session-deletion]")');
  assert.equal(state().historyDeletionPreview, null);
  assert.equal((await service.exportCareer()).records.some(row => row.session && row.session.sessionId === U), true);
  run('deletion("[data-dashboard-delete-session]")');
  await until(() => !!state().historyDeletionPreview || !!state().historyDeletionError);
  run('append(' + JSON.stringify(record('S-APPEND-4', S, start + 15000, ['A', 'B'])) + ')');
  await run('drain()');
  await flush();
  const deletionCallsBeforeStale = requests.filter(item => item.method === 'deleteCareerHistoricalSession').length;
  run('deletion("[data-dashboard-confirm-session-deletion]")');
  assert.equal(requests.filter(item => item.method === 'deleteCareerHistoricalSession').length, deletionCallsBeforeStale, 'changed Career blocks stale UI confirmation');
  assert.match(run('html()'), /Career changed after this preview/);
  run('deletion("[data-dashboard-delete-session]")');
  await until(() => !!state().historyDeletionPreview || !!state().historyDeletionError);
  run('deletion("[data-dashboard-confirm-session-deletion]")');
  run('deletion("[data-dashboard-confirm-session-deletion]")');
  await until(() => state().mode === 'history-list' || !!state().historyDeletionError);
  assert.equal(requests.filter(item => item.method === 'deleteCareerHistoricalSession').length, 1, 'confirmation cannot double submit');
  assert.equal(state().mode, 'history-list');
  assert.equal(state().historyList.sessions.some(row => row.sessionId === U), false);
  assert.equal((await service.exportCareer()).records.some(row => row.session && row.session.sessionId === U), false);
  assert.equal(run('currentId()'), S, 'old-Session deletion does not rotate live identity');
  run('view("trends")');
  await flush();
  assert.equal(state().historyTrend.points.some(point => point.sessionId === U), false, 'cached Trend is invalidated after deletion');
  run('mode("recent")');
  await flush();
  assert.equal(state().recentComparison.recent.selectedSessionIds.includes(U), false, 'Recent window excludes deleted Session');
  assert.equal(state().recentComparison.career.core.counters.hands, (await service.careerStats('A')).counters.hands, 'Recent-vs-Career uses rebuilt Career');
  run('mode("history")');
  await flush();
  run('append(' + JSON.stringify(record('S-AFTER-DELETE', S, start + 16000, ['A', 'B'])) + ')');
  await run('drain()');
  await flush();
  assert.equal(state().historyList.sessions.find(row => row.sessionId === S).playerHandCount, 15, 'next live hand stays in current Session');
  run('row("' + S + '")');
  await flush();
  assert.match(run('html()'), /Use Settings.*Data.*Remove Current Session from Career/);
  assert.doesNotMatch(run('html()'), /data-dashboard-delete-session/);
  run('stop()');
  console.log('Historical Dashboard worker/message/UI list, detail, filters, 50 rows, Back, player-switch fencing, and whole-Session deletion passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
