'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const indexed = require('./careerIndexedStore.js');
const aggregator = require('./careerStatsAggregator.js');
const fixtures = require('./testSupport/careerBackupFixtures.js');
const policy = require('./careerBackupPolicy.js');
const support = require('./testSupport/productionContentScriptHarness.js');
const dashboard = require('./playerDashboard.js');

const S = i => '00000000-0000-4000-8000-' + String(i + 100).padStart(12, '0');
const start = Date.UTC(2026, 8, 1, 12);
function record(id, sessionId, at, names) {
  const players = names.map((name, index) => {
    const player = fixtures.player(name, name);
    player.position = { schemaVersion: 1, status: 'supported', dealtPosition: index === 0 ? 'BTN' : index === 1 ? 'BB' : 'SB', dealtPlayerCount: names.length, unsupportedReason: null };
    return player;
  });
  return fixtures.record('RECENT-TREND-UI', id, players, { historicalSessionId: sessionId, finalizedAt: at });
}
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }

(async () => {
  const service = indexed.createMemoryService({}, { initializedAt: 1 });
  for (let i = 0; i < 50; i++) {
    const names = i === 49 ? ['A', 'B', 'C'] : ['A', 'B'];
    await service.append(record('A-' + i, S(i), start + i * 86400000, names));
  }
  await service.append(record('B-ONLY', S(51), start + 51 * 86400000, ['B', 'C']));
  await service.append(record('ONE', S(52), start + 52 * 86400000, ['One', 'B']));
  const legacy = structuredClone(record('LEGACY-Z', S(53), start - 86400000, ['Z', 'B']));
  legacy.schemaVersion = 3; delete legacy.session; legacy.fingerprint = aggregator.fingerprint(legacy);
  await service.append(legacy);
  let workerListener;
  const workerIndexed = Object.assign({}, indexed, { hasCompleteDatabase: async () => true, outboxRecords: () => [], createIndexedService: async () => service });
  const worker = {
    importScripts() {}, indexedDB: {}, PokerCareerIndexedStore: workerIndexed,
    PokerCareerBackupPolicy: policy, PokerCareerBackup: {}, crypto: {},
    chrome: { storage: { local: { get: async () => ({}), getKeys: async () => [], set: async () => {}, remove: async () => {} } },
      runtime: { onMessage: { addListener(listener) { workerListener = listener; } }, getManifest: () => ({ version: '1.4.0' }) } },
    console, Date, Promise, Object, Array, String, Error
  };
  worker.globalThis = worker;
  vm.runInNewContext(fs.readFileSync('./careerServiceWorker.js', 'utf8'), worker, { filename: 'careerServiceWorker.js' });
  const requests = [];
  const delayed = [];
  let delayMethod = '';
  let failMethod = '';
  const h = support.createHarness({
    gameId: 'recent-trend-dashboard',
    runtimeSendMessage(message, callback) {
      requests.push(message);
      if (message.method === failMethod) callback({ ok: false, error: 'fixture failure' });
      else if (message.method === delayMethod) delayed.push({ message, callback });
      else workerListener(JSON.parse(JSON.stringify(message)), {}, callback);
    },
    transformContentSource(source) {
      return source.replace(/\n\}\)\(\);\s*$/, `
        var recentTrendFocus = null;
        globalThis.recentTrendProbe = {
          open: openPlayerDashboard,
          mode: function (mode) { handlePlayerDashboardClick({ target: { closest: function (selector) { return selector === '[data-dashboard-mode]' ? { dataset: { dashboardMode: mode } } : null; } } }); },
          view: function (view) { handlePlayerDashboardClick({ target: { closest: function (selector) { return selector === '[data-dashboard-history-view]' ? { dataset: { dashboardHistoryView: view } } : null; } } }); },
          point: function (id) { handlePlayerDashboardClick({ target: { closest: function (selector) { return selector === '[data-dashboard-trend-session]' ? { dataset: { dashboardTrendSession: id } } : null; } } }); },
          back: function () { handlePlayerDashboardClick({ target: { closest: function (selector) { return selector === '.pnhud-dashboard-history-back' ? {} : null; } } }); },
          input: function (selector, value) { handlePlayerDashboardInput({ target: { value: value, matches: function (candidate) { return candidate === selector; } } }); },
          html: function () { return playerDashboardElement.innerHTML; },
          render: function () { renderPlayerDashboard(); },
          attachFocus: function () { var original = playerDashboardElement.querySelector.bind(playerDashboardElement); playerDashboardElement.querySelector = function (selector) { if (['[data-dashboard-recent-window]', '[data-dashboard-session-trend-metric]', '[data-dashboard-session-trend-range]', '[data-dashboard-table-size]', '[data-dashboard-situation]', '[data-dashboard-position]'].indexOf(selector) >= 0) return { focus: function () { recentTrendFocus = selector; } }; return original(selector); }; },
          focus: function () { return recentTrendFocus; },
          state: function () { return cloneJson(playerDashboardState); },
          append: function (record) { return enqueueIndexedCareerRecord(record); },
          drain: function () { return careerIndexedAppendQueue; },
          current: function (id) { historicalSessionId = id; },
          stop: function () { cleanupExtension('recent trend dashboard test'); }
        };
      })();`);
    }
  });
  function run(expression) { return h.evaluateInIsolatedWorld('recentTrendProbe.' + expression); }
  function state() { return JSON.parse(JSON.stringify(run('state()'))); }
  function input(selector, value) { run('input(' + JSON.stringify(selector) + ',' + JSON.stringify(value) + ')'); }
  function release() { const item = delayed.shift(); workerListener(JSON.parse(JSON.stringify(item.message)), {}, item.callback); }
  assert.deepEqual(h.evaluationErrors, []);
  await flush();
  run('open("A","Alice")');
  run('mode("recent")'); await flush();
  assert.equal(state().recentWindow.type, 'sessions');
  assert.equal(state().recentWindow.count, 5);
  assert.equal(state().recentComparison.recent.selectedSessionCount, 5);
  assert.equal(state().recentComparison.recent.selectedPlayerHandCount, 5);
  assert.deepEqual(state().recentComparison.recent.selectedSessionIds, [S(49), S(48), S(47), S(46), S(45)]);
  assert.match(run('html()'), /Recent · 5 Sessions/);
  assert.match(run('html()'), /5 Sessions · 5 player hands/);
  for (const value of ['sessions:3', 'sessions:5', 'sessions:10', 'hands:100', 'hands:250', 'hands:500']) assert.ok(run('html()').includes('value="' + value + '"'));
  for (const label of ['Hands', 'VPIP', 'PFR', 'AF', '3Bet', 'F3B', 'CBet', 'FCB', 'WTSD', 'W$SD']) assert.ok(run('html()').includes('>' + label + '</span>'), label);
  assert.match(run('html()'), /Recent vs Career/);
  assert.equal((run('html()').match(/<tr><th scope="row">/g) || []).length, 9);
  assert.match(run('html()'), /opportunities.*evidence/);
  assert.match(run('html()'), / pp/);
  assert.ok(state().recentComparison.comparison.vpip.recentSupport.count < state().recentComparison.comparison.vpip.careerSupport.count);
  assert.equal(state().recentComparison.comparison.af.unit, 'ratio');
  assert.doesNotMatch(run('html()').match(/<tr><th scope="row">AF<\/th>[\s\S]*?<\/tr>/)[0], /%/);
  const comparisonState = state();
  comparisonState.recentComparison.comparison.vpip = { unit: 'percentage_points', recentValue: 34, careerValue: 26, delta: 8,
    recentSupport: { count: 3, status: 'weak' }, careerSupport: { count: 80, status: 'strong' } };
  comparisonState.recentComparison.comparison.af = { unit: 'ratio', recentValue: 2.5, careerValue: 1.5, delta: 1,
    recentNumerator: 5, recentCalls: 2, careerNumerator: 15, careerCalls: 10,
    recentSupport: { count: 7, status: 'insufficient' }, careerSupport: { count: 25, status: 'weak' } };
  const comparisonHtml = dashboard.render(comparisonState);
  assert.match(comparisonHtml, /<th scope="row">VPIP<\/th><td><strong>34\.0%<\/strong><small>3 opportunities · Weak evidence<\/small><\/td><td><strong>26\.0%<\/strong><small>80 opportunities · Strong evidence<\/small><\/td><td>\+8\.0 pp<\/td>/);
  assert.match(comparisonHtml, /<th scope="row">AF<\/th><td><strong>2\.5<\/strong><small>5 aggressive \/ 2 calls · Insufficient evidence<\/small><\/td><td><strong>1\.5<\/strong><small>15 aggressive \/ 10 calls · Weak evidence<\/small><\/td><td>\+1\.00 ratio<\/td>/);
  assert.doesNotMatch(run('html()'), /Strategic Implications|trending upward|becoming looser/);
  assert.equal(requests.filter(item => item.method === 'getCareerRecentVsCareer').length, 1);
  assert.equal(requests.filter(item => item.method === 'getCareerPlayerStats').length, 0, 'comparison includes Career without a second query');
  run('attachFocus()');
  const gapHtml = dashboard.render({ mode: 'history-trends', playerId: 'A', historyTrendMetric: 'vpip', historyTrendRange: 'all',
    historyTrend: { playerId: 'A', points: [
      { sessionId: S(0), endedAt: start, playerHandCount: 12, stats: { vpip: { value: 20, numerator: 2, denominator: 10, evidenceStatus: 'weak' } } },
      { sessionId: S(1), endedAt: start + 86400000, playerHandCount: 1, stats: { vpip: { value: null, numerator: 0, denominator: 0, evidenceStatus: 'insufficient' } } },
      { sessionId: S(2), endedAt: start + 2 * 86400000, playerHandCount: 300, stats: { vpip: { value: 0, numerator: 0, denominator: 300, evidenceStatus: 'strong' } } }
    ] } });
  assert.equal((gapHtml.match(/<circle /g) || []).length, 2, 'unsupported point is absent while measured zero remains');
  assert.equal((gapHtml.match(/<polyline /g) || []).length, 0, 'line never crosses an unsupported Session');
  assert.match(gapHtml, /fill="none" stroke="currentColor" stroke-width="2"/);
  assert.match(gapHtml, /12 player hands, weak evidence/);
  assert.match(gapHtml, /300 player hands, strong evidence/);
  const nonfiniteAfHtml = dashboard.render({ mode: 'history-trends', playerId: 'A', historyTrendMetric: 'af', historyTrendRange: 'all',
    historyTrend: { playerId: 'A', points: [{ sessionId: S(0), endedAt: start, playerHandCount: 90,
      stats: { af: { value: null, nonFinite: true, numerator: 15, denominator: 0, evidenceStatus: 'moderate' } } }] } });
  assert.match(nonfiniteAfHtml, /<span>∞<\/span><small>15 aggressive \/ 0 calls · 90 hands · moderate evidence/);
  assert.match(nonfiniteAfHtml, /No finite AF values in these Sessions/);
  assert.doesNotMatch(nonfiniteAfHtml, /No supported AF observations|AF unsupported/);
  assert.equal((nonfiniteAfHtml.match(/<circle /g) || []).length, 0, 'nonfinite AF remains a chart gap');
  const css = fs.readFileSync('./hud.css', 'utf8');
  assert.match(css, /\.pnhud-dashboard-filter-row \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.pnhud-dashboard-session-trend-chart \{[^}]*width: 100%;[^}]*max-width: 100%/);
  assert.match(css, /\.pnhud-dashboard-comparison-scroll \{[^}]*max-width: 100%; overflow-x: auto/);
  const selectRule = css.match(/#pnhud-player-dashboard \.pnhud-dashboard-position select,[\s\S]*?\{[^}]*background: #0b2b25;[^}]*\}/);
  assert.ok(selectRule, 'regular Dashboard select style exists');
  for (const className of ['recent-window', 'trend-metric', 'trend-range']) {
    assert.ok(selectRule[0].includes('.pnhud-dashboard-' + className + ' select'), className + ' reuses the regular select declaration');
  }
  const recentMarkup = dashboard.render({ mode: 'recent', playerId: 'A', recentWindow: { type: 'sessions', count: 5 }, loading: true });
  assert.match(recentMarkup, /<label class="pnhud-dashboard-recent-window"><span>Recent window<\/span><select data-dashboard-recent-window aria-label="Recent window">/);
  assert.deepEqual([...recentMarkup.match(/<select data-dashboard-recent-window[^>]*>([\s\S]*?)<\/select>/)[1].matchAll(/<option value="([^"]+)"/g)].map(match => match[1]),
    ['sessions:3', 'sessions:5', 'sessions:10', 'hands:100', 'hands:250', 'hands:500']);
  assert.match(recentMarkup, /<option value="sessions:5" selected>/, 'Recent default remains five Sessions');
  const trendMarkup = dashboard.render({ mode: 'history-trends', playerId: 'A', historyTrendMetric: 'vpip', historyTrendRange: 10 });
  assert.match(trendMarkup, /<label class="pnhud-dashboard-trend-metric"><span>Metric<\/span><select data-dashboard-session-trend-metric aria-label="Session trend metric">/);
  assert.match(trendMarkup, /<label class="pnhud-dashboard-trend-range"><span>Show<\/span><select data-dashboard-session-trend-range aria-label="Session trend range">/);
  assert.deepEqual([...trendMarkup.match(/<select data-dashboard-session-trend-metric[^>]*>([\s\S]*?)<\/select>/)[1].matchAll(/<option value="([^"]+)"/g)].map(match => match[1]), dashboard.TREND_IDS);
  assert.deepEqual([...trendMarkup.match(/<select data-dashboard-session-trend-range[^>]*>([\s\S]*?)<\/select>/)[1].matchAll(/<option value="([^"]+)"/g)].map(match => match[1]), ['10', '25', 'all']);
  assert.match(trendMarkup, /<option value="vpip" selected>/);
  assert.match(trendMarkup, /<option value="10" selected>/);
  for (const [value, count] of [['sessions:3', 3], ['sessions:10', 10], ['hands:100', 50], ['hands:250', 50], ['hands:500', 50]]) {
    input('[data-dashboard-recent-window]', value); await flush();
    assert.equal(run('focus()'), '[data-dashboard-recent-window]', 'window selection retains keyboard focus');
    assert.equal(state().recentComparison.recent.selectedPlayerHandCount, count);
  }
  input('[data-dashboard-recent-window]', 'sessions:5'); await flush();
  input('[data-dashboard-table-size]', 'HU'); await flush();
  assert.equal(run('focus()'), '[data-dashboard-table-size]', 'filter selection retains keyboard focus');
  assert.equal(state().recentComparison.recent.selectedSessionCount, 5);
  assert.equal(state().recentComparison.recent.core.counters.hands, 4, 'window selected before HU filter');
  assert.equal(state().profile.hands, 4, 'Recent Profile receives the filtered Recent population');
  assert.match(run('html()'), /Recent profile · HU/);
  assert.match(run('html()'), /Statistics below use the active filters inside this fixed window/);
  run('mode("career")'); await flush();
  assert.equal(state().coreStats.counters.hands, 49);
  assert.equal(state().profile.hands, 49, 'Career Profile retains its full Career population');
  assert.match(run('html()'), /Career profile · HU/);
  run('mode("session")');
  assert.match(run('html()'), /Current session/);
  assert.doesNotMatch(run('html()'), /Recent profile/);
  run('mode("recent")'); await flush();
  assert.equal(state().coreStats.counters.hands, 4, 'returning to Recent restores the Recent population');
  delayMethod = 'getCareerRecentVsCareer';
  input('[data-dashboard-recent-window]', 'sessions:3');
  input('[data-dashboard-recent-window]', 'sessions:10');
  assert.equal(delayed.length, 2);
  release(); await flush(); assert.equal(state().loading, true);
  release(); await flush(); assert.equal(state().recentComparison.recent.selectedSessionCount, 10);
  input('[data-dashboard-recent-window]', 'sessions:3');
  run('open("B","Bob")');
  assert.equal(state().recentComparison, null, 'player switch clears old comparison');
  release(); await flush(); assert.equal(state().playerId, 'B');
  release(); await flush();
  delayMethod = '';
  run('open("A","Alice")'); await flush();
  run('mode("history")'); await flush();
  run('view("trends")'); await flush();
  assert.equal(state().historyTrendMetric, 'vpip');
  assert.equal(state().historyTrend.points.length, 50);
  assert.deepEqual(state().historyTrend.points.slice(0, 2).map(point => point.sessionId), [S(0), S(1)]);
  assert.equal((run('html()').match(/data-dashboard-trend-session=/g) || []).length, 10);
  assert.match(run('html()'), /player hands.*evidence/);
  assert.equal(requests.filter(item => item.method === 'getCareerPlayerSessionTrend').length, 1);
  let started = performance.now(); for (let i = 0; i < 20; i++) run('render()');
  const tenPointRenderMs = Math.round((performance.now() - started) * 10) / 10;
  input('[data-dashboard-session-trend-range]', 'all');
  assert.equal(run('focus()'), '[data-dashboard-session-trend-range]', 'range selection retains keyboard focus');
  assert.equal((run('html()').match(/data-dashboard-trend-session=/g) || []).length, 50);
  started = performance.now(); for (let i = 0; i < 20; i++) run('render()');
  const fiftyPointRenderMs = Math.round((performance.now() - started) * 10) / 10;
  assert.equal(requests.filter(item => item.method === 'getCareerPlayerSessionTrend').length, 1, 'rerender does not query per Session');
  input('[data-dashboard-session-trend-metric]', 'af');
  assert.equal(run('focus()'), '[data-dashboard-session-trend-metric]', 'metric selection retains keyboard focus');
  assert.match(run('html()'), /AF by Session/);
  assert.equal(requests.filter(item => item.method === 'getCareerPlayerSessionTrend').length, 1, 'metric uses fetched per-point stats');
  input('[data-dashboard-table-size]', 'HU'); await flush();
  assert.equal(state().historyTrend.points.length, 50);
  assert.equal(state().historyTrend.points.at(-1).stats.vpip.value, null, 'non-HU Session remains an unsupported point');
  assert.match(run('html()'), /No supported AF observations|unsupported|—/);
  run('point("' + S(49) + '")'); await flush();
  assert.equal(state().mode, 'history-detail');
  assert.equal(state().selectedHistorySessionId, S(49));
  assert.match(run('html()'), /Back to Trends/);
  run('back()'); await flush(); assert.equal(state().mode, 'history-trends');
  run('view("sessions")'); assert.equal(state().mode, 'history-list');
  run('view("trends")'); assert.equal(state().mode, 'history-trends');
  run('open("One","One")'); await flush();
  assert.equal(state().historyTrend.points.length, 1);
  assert.match(run('html()'), /one Session recorded/);
  run('open("Z","Z")'); await flush();
  assert.equal(state().historyTrend.points.length, 0);
  assert.match(run('html()'), /No Session trend data yet/);
  run('mode("recent")'); await flush();
  assert.match(run('html()'), /No explicit recent Session history exists/);
  assert.doesNotMatch(run('html()'), /Recent vs Career/);
  input('[data-dashboard-recent-window]', 'hands:100'); await flush();
  assert.equal(state().recentComparison.recent.selectedPlayerHandCount, 1);
  assert.match(run('html()'), /lacks explicit Session provenance/);
  run('open("A","Alice")'); await flush();
  run('current("' + S(49) + '")');
  run('mode("recent")'); await flush();
  input('[data-dashboard-recent-window]', 'sessions:5'); await flush();
  const recentCalls = requests.filter(item => item.method === 'getCareerRecentVsCareer').length;
  run('append(' + JSON.stringify(record('A-APPEND', S(49), start + 50 * 86400000, ['A', 'B', 'C'])) + ')');
  await run('drain()'); await flush();
  assert.equal(requests.filter(item => item.method === 'getCareerRecentVsCareer').length, recentCalls + 1);
  assert.equal(state().recentComparison.recent.selectedPlayerHandCount, 6, 'accepted current Session append refreshes Recent');
  run('mode("history")'); await flush();
  run('view("trends")'); await flush();
  const trendCalls = requests.filter(item => item.method === 'getCareerPlayerSessionTrend').length;
  run('append(' + JSON.stringify(record('A-APPEND-2', S(49), start + 50 * 86400000 + 1000, ['A', 'B'])) + ')');
  await run('drain()'); await flush();
  assert.equal(requests.filter(item => item.method === 'getCareerPlayerSessionTrend').length, trendCalls + 1);
  assert.equal(state().historyTrend.points.at(-1).playerHandCount, 3, 'accepted current Session append refreshes newest point');
  delayMethod = 'getCareerPlayerSessionTrend';
  input('[data-dashboard-table-size]', 'HU');
  input('[data-dashboard-session-trend-metric]', 'pfr');
  assert.equal(delayed.length, 2, 'metric change fences an in-flight trend request');
  release(); await flush(); assert.equal(state().historyTrendLoading, true);
  release(); await flush(); assert.equal(state().historyTrendMetric, 'pfr');
  input('[data-dashboard-table-size]', '3_TO_5');
  assert.equal(delayed.length, 1);
  run('open("B","Bob")');
  assert.equal(state().historyTrend, null, 'player switch clears prior chart');
  release(); await flush(); assert.equal(state().playerId, 'B');
  delayMethod = '';
  failMethod = 'getCareerPlayerSessionTrend';
  run('open("A","Alice")'); await flush();
  assert.match(run('html()'), /Session trends could not be loaded/);
  assert.doesNotMatch(run('html()'), /data-dashboard-trend-session=/);
  failMethod = '';
  run('mode("recent")'); await flush();
  failMethod = 'getCareerRecentVsCareer';
  input('[data-dashboard-recent-window]', 'sessions:3'); await flush();
  assert.match(run('html()'), /Recent statistics could not be loaded/);
  assert.doesNotMatch(run('html()'), /Recent vs Career/);
  failMethod = '';
  run('stop()');
  console.log('Recent/Trend Dashboard UI: 20 synthetic renders, 10 points=' + tenPointRenderMs + 'ms, 50 points=' + fiftyPointRenderMs + 'ms; windows, filters, races, gaps, and navigation passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
