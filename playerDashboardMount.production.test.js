'use strict';

const assert = require('node:assert/strict');
const support = require('./testSupport/productionContentScriptHarness.js');
const aggregator = require('./careerStatsAggregator.js');

const requests = [];
const trends = [];
const h = support.createHarness({
  gameId: 'dashboard-table-size-mount',
  runtimeSendMessage(message, callback) {
    if (message.method === 'careerDashboardStats') requests.push({ args: message.args, callback });
    else if (message.method === 'careerTrendStats') trends.push({ args: message.args, callback });
    else callback({ ok: true, value: {} });
  },
  transformContentSource(source) {
    return source.replace(/\n\}\)\(\);\s*$/, `
      globalThis.dashboardMountProbe = {
        open: openPlayerDashboard,
        mode: function (mode) { playerDashboardElement.dispatchEvent({ type: 'click', target: { closest: function (selector) { return selector === '[data-dashboard-mode]' ? { dataset: { dashboardMode: mode } } : null; } } }); },
        size: function (size) { playerDashboardElement.dispatchEvent({ type: 'input', target: { value: size, matches: function (selector) { return selector === '[data-dashboard-table-size]'; } } }); },
        seedSession: function () {
          function hand(id, count) {
            var rows = [{ handId: id, playerId: 'hu-player', player: 'HU Player', action: 'call', street: 'preflop', amount: 2, positionSchemaVersion: 1, dealtPlayerCount: count, dealtPosition: count === 2 ? 'BTN' : 'CO' }];
            for (var i = 1; i < count; i++) rows.push({ handId: id, playerId: 'other-' + i, player: 'Other', action: 'check', street: 'preflop', positionSchemaVersion: 1, dealtPlayerCount: count, dealtPosition: i === count - 1 ? 'BB' : 'SB' });
            liveEvents.push.apply(liveEvents, rows);
            PokerFilteredStats.appendSessionContextHand(sessionContextState, rows);
            finalizedSessionRevision += 1;
          }
          hand('SESSION-HU', 2);
          hand('SESSION-SIX', 6);
        },
        html: function () { return playerDashboardElement && playerDashboardElement.innerHTML; },
        panel: function () { return playerDashboardElement && { id: playerDashboardElement.id, hidden: playerDashboardElement.hidden, extensionId: playerDashboardElement.dataset.pnhudExtensionId, buildId: playerDashboardElement.dataset.pnhudBuildId }; },
        state: function () { return cloneJson(playerDashboardState); },
        stop: function () { cleanupExtension('dashboard mount test'); }
      };
    })();`);
  }
});
function run(expression) { return h.evaluateInIsolatedWorld('dashboardMountProbe.' + expression); }
function state() { return JSON.parse(JSON.stringify(run('state()'))); }
function profile(size, hands) {
  const counters = Object.assign(aggregator.emptyCounters(), {
    hands, vpipMade: Math.round(hands * .75), vpipOpportunities: hands,
    pfrMade: Math.round(hands * .60), pfrOpportunities: hands,
    postflopAggressiveActions: Math.round(hands * .32), postflopCalls: Math.round(hands * .16),
    threeBetMade: hands ? 12 : 0, threeBetOpportunities: hands ? 150 : 0,
    foldToThreeBet: hands ? 30 : 0, foldToThreeBetOpportunities: hands ? 60 : 0,
    flopCBetMade: hands ? 60 : 0, flopCBetOpportunities: hands ? 100 : 0,
    foldToFlopCBet: hands ? 40 : 0, foldToFlopCBetOpportunities: hands ? 90 : 0,
    wtsdMade: hands ? 55 : 0, wtsdOpportunities: hands ? 175 : 0,
    wsdMade: hands ? 28 : 0, wsdOpportunities: hands ? 55 : 0
  });
  return { version: aggregator.PROFILE_PROJECTION_VERSION, playerId: 'hu-player', latestDisplayName: 'HU Player',
    counters, tableSize: size, recordCount: hands, profileContext: { version: aggregator.PROFILE_CONTEXT_VERSION,
      preflopTableSizeSum: hands * (size === 'HU' ? 2 : size === '3_TO_5' ? 4 : 6), preflopTableSizeOpportunities: hands } };
}
function result(size, hands, coverage) {
  const profileSize = size === 'all' ? Object.keys(coverage.buckets).find(bucket => coverage.buckets[bucket] === hands) : size;
  const data = profile(profileSize || 'HU', hands);
  return { core: { counters: data.counters, filters: { position: null, situation: null, tableSize: size === 'all' ? null : size, statId: null, counterpartMode: null }, coverage: { totalCareerHands: coverage.total, tableSizeHands: coverage.buckets } },
    comparisonContexts: { playerId: 'hu-player', source: 'career', playerRevision: 1, situations: {}, positions: {} },
    profileStats: profileSize ? data : null, relational: {}, query: { playerRevision: 1 } };
}
function reply(index, value) {
  requests[index].callback({ ok: true, value });
  trends[index].callback({ ok: true, value: { query: { playerRevision: 1 } } });
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

(async () => {
  assert.deepEqual(h.evaluationErrors, []);
  await flush();
  run('open("hu-player","HU Player")');
  const panel = run('panel()');
  assert.equal(panel.id, 'pnhud-player-dashboard');
  assert.equal(panel.hidden, false);
  assert.equal(panel.extensionId, 'flop-cbet-content-path-test');
  assert.ok(panel.buildId, 'mounted panel identifies its runtime build');
  const controls = run('html()');
  for (const marker of ['data-dashboard-mode="session"', 'data-dashboard-mode="career"',
    'data-dashboard-table-size', 'data-dashboard-situation', 'data-dashboard-position',
    '<option value="all"', '<option value="HU"', '<option value="3_TO_5"', '<option value="SIX_PLUS"']) {
    assert.ok(controls.includes(marker), 'production mount includes ' + marker);
  }
  assert.equal(requests[0].args[1].tableSize, 'all');
  const huCoverage = { total: 500, buckets: { HU: 500, '3_TO_5': 0, SIX_PLUS: 0 } };
  reply(0, result('all', 500, huCoverage));
  await flush();
  assert.equal(state().coreStats.counters.hands, 500);
  assert.match(run('html()'), /Career · All table sizes · 500 hands/);

  run('size("HU")');
  assert.equal(requests[1].args[1].tableSize, 'HU');
  reply(1, result('HU', 500, huCoverage));
  await flush();
  assert.equal(state().profile.hands, 500);
  assert.equal(state().profile.availability.available, true, 'supported HU Profile survives production request path: ' + JSON.stringify(state().profile.availability));
  assert.match(run('html()'), /Career · HU · 500 hands/);
  assert.match(run('html()'), /<h3>Career profile · HU<\/h3>/);
  assert.match(run('html()'), /data-insight-id="vpip-high"/, 'HU Insight uses selected HU cards');
  assert.match(run('html()'), /data-implication-id=/, 'HU Strategic Implications use selected HU observations');
  assert.doesNotMatch(run('html()'), /Career profile · 3\+ handed|No supported 3\+ handed Career sample/);

  run('size("SIX_PLUS")');
  const stale = 2;
  assert.equal(requests[stale].args[1].tableSize, 'SIX_PLUS');
  reply(stale, result('SIX_PLUS', 0, huCoverage));
  await flush();
  assert.equal(state().coreStats.counters.hands, 0, 'empty 6+ does not inherit HU');
  assert.match(run('html()'), /Career · 6\+ handed · 0 hands/);
  assert.match(run('html()'), /<h3>Career profile · 6\+ handed<\/h3>/);
  assert.match(run('html()'), /No supported table-size sample is available for profiling/);
  assert.doesNotMatch(run('html()'), /data-insight-id="vpip-high"/);

  run('size("3_TO_5")');
  assert.equal(requests[3].args[1].tableSize, '3_TO_5');
  reply(3, result('3_TO_5', 0, huCoverage));
  await flush();
  assert.equal(state().coreStats.counters.hands, 0, 'empty 3–5 does not inherit HU');
  assert.match(run('html()'), /Career · 3–5 handed · 0 hands/);
  assert.match(run('html()'), /<h3>Career profile · 3–5 handed<\/h3>/);
  assert.match(run('html()'), /No supported table-size sample is available for profiling/);

  run('size("HU")');
  const oldHU = 4;
  run('size("SIX_PLUS")');
  const currentSix = 5;
  reply(oldHU, result('HU', 500, huCoverage));
  await flush();
  assert.equal(state().loading, true, 'late HU response cannot publish into 6+ request');
  reply(currentSix, result('SIX_PLUS', 0, huCoverage));
  await flush();
  assert.equal(state().coreStats.counters.hands, 0);

  run('size("all")');
  const mixedCoverage = { total: 600, buckets: { HU: 500, '3_TO_5': 0, SIX_PLUS: 100 } };
  reply(6, result('all', 600, mixedCoverage));
  await flush();
  assert.equal(state().coreStats.counters.hands, 600, 'All retains raw mixed population');
  assert.doesNotMatch(run('html()'), /<h3>Career profile/, 'mixed All suppresses calibrated Profile');
  assert.doesNotMatch(run('html()'), /pnhud-dashboard-insights|pnhud-dashboard-review-signals/, 'mixed All suppresses calibrated analysis');

  run('mode("session")');
  run('seedSession()');
  run('size("HU")');
  assert.equal(state().mode, 'session');
  assert.equal(state().tableSize, 'HU');
  assert.equal(state().coreStats.counters.hands, 1, 'Session HU uses the selected population');
  assert.match(run('html()'), /Current session · HU/);
  assert.match(run('html()'), /data-dashboard-table-size/);
  run('size("SIX_PLUS")');
  assert.equal(state().coreStats.counters.hands, 1, 'Session 6+ uses its own selected population');
  run('size("3_TO_5")');
  assert.equal(state().coreStats.counters.hands, 0, 'empty Session 3–5 does not borrow HU or 6+');
  run('stop()');
  console.log('Mounted Dashboard controls, HU Career Profile, empty buckets, mixed All, request fencing, and Session selector passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
