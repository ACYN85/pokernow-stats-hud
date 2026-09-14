'use strict';

var assert = require('assert');
var support = require('./testSupport/productionContentScriptHarness.js');
var frames = require('./testSupport/flopCBetProductionFrames.js');
var stats = require('./stats.js');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function instrument(source) {
  ['refreshHud', 'invalidateSeatHudCareerStats', 'invalidateLeaderboardCareerStats', 'loadPlayerDashboardCareer'].forEach(function (name) {
    source = source.replace(new RegExp('(function ' + name + '\\([^)]*\\) \\{)'), '$1 globalThis.lifecycleRefreshes = globalThis.lifecycleRefreshes || {}; globalThis.lifecycleRefreshes.' + name + ' = (globalThis.lifecycleRefreshes.' + name + ' || 0) + 1;');
  });
  return source.replace(/\n\}\)\(\);\s*$/, `
  globalThis.lifecycleProbe = {
    reset: resetCurrentSession,
    drainCareer: function () { return careerIndexedAppendQueue; },
    careerReady: function () { return careerTrackingReady; },
    stop: function () { cleanupExtension('lifecycle matrix reload'); },
    openCareerDashboard: function () { playerDashboardState.open = true; playerDashboardState.mode = 'career'; playerDashboardState.playerId = 'P1'; },
    snapshot: function () { return {
      active: cloneJson(PokerHandFinalization.activeHand(handAccounting)),
      events: cloneJson(liveEvents), revision: finalizedSessionRevision,
      paused: currentEffectivePauseState(),
      evaluations: cloneJson(handTransitionDiagnostics.evaluations.slice(-3)),
      career: cloneJson(careerDiagnostics),
      refreshes: cloneJson(globalThis.lifecycleRefreshes || {}),
      acquisitionPending: lifecycleBoundaryAcquisition.pending,
      signatures: Array.from(socketHandSignatures)
    }; }
  };
})();
`);
}
var sequence = 0;
function create(saved, gameId, options) {
  gameId = gameId || 'lifecycle-release-blocker-' + (++sequence);
  var keys = support.storageKeys(gameId);
  var storage = saved || {};
  if (!saved) { storage[keys.schema] = 4; storage[keys.playerMap] = { P1: 'P1', P2: 'P2', P3: 'P3' }; }
  var h = support.createHarness(Object.assign({ gameId: gameId, initialStorage: storage, controlledClock: true, initialNow: 100000, transformContentSource: instrument }, options || {}));
  assert.deepStrictEqual(h.evaluationErrors, []);
  h.time = 100000; h.frame = 0;
  return h;
}
function snapshot(h) { return clone(h.evaluateInIsolatedWorld('lifecycleProbe.snapshot()')); }
function send(h, name, payload, delta, direction) {
  h.time += delta === undefined ? 4000 : delta;
  h.setNow(h.time);
  h.contextWindow.postMessage({ source: 'pokernow-stats-hud-main', type: 'websocket-frame', frameId: 'matrix-' + (++h.frame), hookInstanceId: 'matrix', capturedAt: h.time, framesCaptured: h.frame, socketId: 'matrix-socket', socketUrl: 'wss://example.invalid/socket', direction: direction || 'incoming', dataType: 'string', data: '42' + JSON.stringify([name, payload]), binaryBytes: null });
}
function register(h, state) { send(h, 'registered', { currentPlayer: { id: 'P1' }, ownerID: 'P1', gameState: state }); }
function reset(h) { h.evaluateInIsolatedWorld('lifecycleProbe.reset()'); }
function pause(h) { send(h, 'action', { type: 'UP' }, 1, 'outgoing'); }
function resume(h) { send(h, 'action', { type: 'UR' }, 1, 'outgoing'); }
function scenario(id) { return frames.ordinaryScenario('bet-fold', id); }
function start(h, s, delta) { send(h, 'gC', s.snapshots.initial, delta); }
function finish(h, s) {
  s.frames.slice(2, -1).forEach(function (raw) { var packet = JSON.parse(raw.slice(2)); send(h, packet[0], packet[1], 250); });
}
function count(h) { return stats.computePlayerStats(snapshot(h).events, 'P1').handsPlayed; }
function careerCount(h) { var result = h.evaluateInIsolatedWorld('PokerNowHUDCareer.careerStats("P1")'); return result ? result.counters.hands : 0; }
function check(h, hands, career, label) {
  assert.strictEqual(count(h), hands, label + ': Session');
  assert.strictEqual(careerCount(h), career, label + ': Career');
  assert.deepStrictEqual(h.logs.filter(function (call) { return call[0] === '[HUD] websocket frame processing error' || call[0] === '[HUD] initialization error'; }), [], label + ': no swallowed runtime errors');
}
function reload(h, state) {
  h.evaluateInIsolatedWorld('lifecycleProbe.stop()');
  var next = create(clone(h.storage), h.gameId); next.time = h.time + 4000;
  register(next, state); return next;
}
function fresh(h, id, expected, career) { var s = scenario(id); start(h, s); finish(h, s); check(h, expected, career, id); return s; }
function run(name, fn) { try { fn(); console.log('PASS ' + name); } catch (e) { console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }

run('A clean baseline', function () {
  var h = create(); register(h, scenario('A1').snapshots.predeal);
  var s = scenario('A1'); start(h, s);
  var boundary = snapshot(h).evaluations.slice(-1)[0];
  assert.ok(boundary.accepted && boundary.confidenceScore >= 50, 'ordinary boundary still qualifies by its original score');
  assert.ok(snapshot(h).signatures.some(function (signature) { return signature.indexOf('|multi:') >= 0; }), 'ordinary boundary retains its original signature path');
  finish(h, s); check(h, 1, 1, 'A1'); fresh(h, 'A2', 2, 2);
});
run('B reset between hands', function () {
  var h = create(); register(h, scenario('B1').snapshots.predeal); fresh(h, 'B1', 1, 1);
  reset(h); check(h, 0, 1, 'reset'); fresh(h, 'B2', 1, 2);
});
run('C reset mid-hand', function () {
  var h = create(), s = scenario('C1'); register(h, s.snapshots.predeal); start(h, s);
  reset(h); finish(h, s); check(h, 0, 0, 'discarded partial'); fresh(h, 'C2', 1, 1);
});
run('D pause between hands', function () {
  var h = create(), s = scenario('D1'); register(h, s.snapshots.predeal); pause(h);
  send(h, 'gC', { hI: 'stale', now: 1 }); check(h, 0, 0, 'paused'); resume(h); fresh(h, 'D1', 1, 1);
});
run('E pause mid-hand', function () {
  var h = create(), s = scenario('E1'); register(h, s.snapshots.predeal); start(h, s); pause(h);
  send(h, 'gC', { hI: 'stale', now: 1 }); resume(h); send(h, 'gC', { hI: 'E1' }); finish(h, s);
  check(h, 1, 1, 'owned partial'); fresh(h, 'E2', 2, 2);
});
run('F reset while paused', function () {
  var h = create(), s = scenario('F1'); register(h, s.snapshots.predeal); start(h, s); pause(h); reset(h);
  check(h, 0, 0, 'reset paused'); resume(h); finish(h, s); check(h, 0, 0, 'old partial'); fresh(h, 'F2', 1, 1);
});
['page', 'extension'].forEach(function (kind) {
  run(kind + ' reload between hands', function () {
    var h = create(), s = scenario(kind + '1'); register(h, s.snapshots.predeal); fresh(h, s.handId, 1, 1);
    h = reload(h, s.snapshots.predeal); fresh(h, kind + '2', 2, 2);
  });
  run(kind + ' reload mid-hand', function () {
    var h = create(), s = scenario(kind + 'mid1'); register(h, s.snapshots.predeal); start(h, s);
    h = reload(h, s.snapshots.initial); finish(h, s); check(h, 1, 1, 'recovered'); fresh(h, kind + 'mid2', 2, 2);
  });
});
run('K cold start active', function () {
  var h = create(), s = scenario('K1'); register(h, s.snapshots.afterPreflop);
  finish(h, s); check(h, 0, 0, 'unowned current hand'); fresh(h, 'K2', 1, 1);
});
run('L long pause', function () {
  var h = create(), s = scenario('L1'); register(h, s.snapshots.predeal); pause(h);
  for (var i = 0; i < 20; i++) send(h, 'gC', { hI: 'stale-' + i, tB: { P1: 20, P2: 20 }, pGS: { P2: 'fold' }, now: i }, 60000);
  check(h, 0, 0, 'long pause'); resume(h); fresh(h, 'L1', 1, 1);
});
run('M immediate reset boundary', function () {
  var h = create(), s = scenario('M1'); register(h, s.snapshots.predeal); start(h, s); finish(h, s); reset(h);
  var next = scenario('M2'); start(h, next, 1); finish(h, next);
  check(h, 1, 2, 'immediate fresh hand');
});
function sparse(id) {
  var s = scenario(id), baseline = clone(s.snapshots.predeal), deal = clone(s.snapshots.initial);
  Object.assign(baseline, { gN: 1, gT: [1, 0], cHB: 20, dealerID: 'P1', dealerId: 'P1', status: 'inProgress',
    pGS: { P1: 'inGame', P2: 'inGame' }, tB: { P1: '<D>', P2: '<D>' } });
  baseline.players.P1.status = 'active'; baseline.players.P2.status = 'active';
  baseline.players.P1.cards = []; baseline.players.P2.cards = [];
  // Button and stacks have already arrived; the deal adds cards and exact IDs.
  deal.players = { P1: { stack: 1000, cards: ['As', 'Kd'] }, P2: { stack: 1000 } };
  return { hand: s, baseline: baseline, deal: deal };
}
['cold', 'reset', 'reset-three', 'resume', 'reload', 'extension-reload', 'reset-mid', 'reset-paused', 'reload-mid'].forEach(function (kind) {
  run('sparse complete deal after ' + kind, function () {
    var h = create(), fixture = sparse('SPARSE-' + kind), s = fixture.hand, baseline = fixture.baseline, deal = fixture.deal;
    var mid = kind === 'reset-mid' || kind === 'reset-paused' || kind === 'reload-mid';
    if (kind === 'reset-three') { baseline.players.P3 = { stack: 1000 }; baseline.pGS.P3 = 'inGame'; }
    if (kind !== 'cold') {
      register(h, s.snapshots.predeal); fresh(h, 'BEFORE-SPARSE', 1, 1);
      if (mid) {
        var old = scenario('OWNED-BEFORE-' + kind); start(h, old);
        if (kind === 'reload-mid') h = reload(h, old.snapshots.initial);
        else { if (kind === 'reset-paused') pause(h); reset(h); if (kind === 'reset-paused') resume(h); }
        finish(h, old); check(h, kind === 'reload-mid' ? 2 : 0, kind === 'reload-mid' ? 2 : 1, 'current-hand contract');
      }
      send(h, 'gC', baseline);
    }
    else register(h, baseline);
    if (kind.indexOf('reset') === 0 && !mid) reset(h);
    if (kind === 'resume') { pause(h); resume(h); }
    if (kind === 'reload' || kind === 'extension-reload') h = reload(h, baseline);
    if (kind === 'reset-three') { deal.players.P3 = { stack: 1000 }; deal.iHPI.push('P3'); deal.pGS.P3 = 'inGame'; }
    send(h, 'gC', deal);
    var boundary = snapshot(h).evaluations.slice(-1)[0];
    assert.strictEqual(boundary.confidenceScore, 48, 'exact sparse production reproducer stays below the generic threshold');
    assert.strictEqual(boundary.accepted, true, 'fully observed deal acquires ownership');
    assert.strictEqual(boundary.resumeBoundaryOverride, false, 'no stopped/broken epoch masks the acquisition gate');
    assert.strictEqual(snapshot(h).acquisitionPending, false, 'accepted boundary consumes rearm');
    if (kind === 'reset-three') send(h, 'gC', { pGS: { P3: 'fold' } }, 250);
    finish(h, s); check(h, kind === 'reload-mid' ? 3 : kind === 'resume' || kind === 'reload' || kind === 'extension-reload' ? 2 : 1, kind === 'reload-mid' ? 3 : kind === 'cold' ? 1 : 2, 'sparse complete hand');
  });
});
run('paused sparse stale traffic and excluded pre-reset ID', function () {
  var h = create(), old = scenario('EXCLUDED'), f = sparse('EXCLUDED');
  register(h, old.snapshots.predeal); start(h, old); pause(h); reset(h);
  send(h, 'gC', f.baseline); send(h, 'gC', f.deal);
  check(h, 0, 0, 'sparse deal while paused'); assert.strictEqual(snapshot(h).active, null);
  assert.strictEqual(snapshot(h).acquisitionPending, true);
  resume(h); send(h, 'gC', f.baseline); send(h, 'gC', f.deal);
  assert.strictEqual(snapshot(h).active, null, 'excluded old hI cannot reacquire after a clean-looking stale baseline');
  finish(h, f.hand); check(h, 0, 0, 'old partial stays discarded');
  var next = sparse('AFTER-EXCLUDED'); send(h, 'gC', next.baseline); send(h, 'gC', next.deal); finish(h, next.hand);
  check(h, 1, 1, 'first genuinely new sparse hand');
});
run('sparse hand signature survives reload and full stale replay', function () {
  var h = create(), f = sparse('SPARSE-REPLAY'); register(h, f.baseline); send(h, 'gC', f.deal); finish(h, f.hand);
  check(h, 1, 1, 'before replay'); h = reload(h, f.baseline); send(h, 'gC', f.deal);
  assert.strictEqual(snapshot(h).evaluations.slice(-1)[0].rejectionReason, 'duplicate hand transition signature');
  finish(h, f.hand); check(h, 1, 1, 'full stale replay');
  var next = sparse('SPARSE-REPLAY-NEXT'); send(h, 'gC', next.baseline); send(h, 'gC', next.deal); finish(h, next.hand);
  check(h, 2, 2, 'fresh after replay');
});
run('terminal publication refreshes exactly once', function () {
  var h = create(), s = scenario('REFRESH'); register(h, s.snapshots.predeal); start(h, s);
  s.frames.slice(2, -2).forEach(function (raw) { var packet = JSON.parse(raw.slice(2)); send(h, packet[0], packet[1], 250); });
  h.evaluateInIsolatedWorld('lifecycleProbe.openCareerDashboard()');
  var before = snapshot(h), terminal = JSON.parse(s.terminalFrame.slice(2));
  send(h, terminal[0], terminal[1], 250);
  var after = snapshot(h); check(h, 1, 1, 'publication');
  assert.strictEqual(after.revision - before.revision, 1, 'Session revision advances once');
  ['refreshHud', 'invalidateSeatHudCareerStats', 'invalidateLeaderboardCareerStats', 'loadPlayerDashboardCareer'].forEach(function (name) {
    assert.strictEqual((after.refreshes[name] || 0) - (before.refreshes[name] || 0), 1, name + ' runs once for accepted publication');
  });
  send(h, terminal[0], terminal[1], 250); check(h, 1, 1, 'duplicate terminal');
  assert.deepStrictEqual(snapshot(h).refreshes, after.refreshes, 'repeated terminal does not republish');
  h = reload(h, Object.assign(clone(s.snapshots.beforeSettlement), terminal[1]));
  send(h, terminal[0], terminal[1]); check(h, 1, 1, 'terminal replay after reload');
  fresh(h, 'REFRESH-NEXT', 2, 2);
});

(async function () {
  var service = require('./careerIndexedStore.js').createMemoryService({}, { initializedAt: 1 });
  var messages = [];
  var options = { runtimeSendMessage: function (message, callback) {
    messages.push(clone(message));
    var result = message.method === 'initialize' ? service.careerLedgerInfo() : service[message.method].apply(service, message.args || []);
    Promise.resolve(result).then(function (value) { callback({ ok: true, value: value }); }, function (error) { callback({ ok: false, error: error.message }); });
  } };
  async function ready(h) {
    for (var i = 0; i < 10 && !h.evaluateInIsolatedWorld('lifecycleProbe.careerReady()'); i++) await new Promise(function (resolve) { setImmediate(resolve); });
    assert.strictEqual(h.evaluateInIsolatedWorld('lifecycleProbe.careerReady()'), true);
  }
  var h = create(null, 'sparse-indexed-bridge', options), f = sparse('INDEXED-SPARSE');
  await ready(h); register(h, f.baseline); reset(h); send(h, 'gC', f.deal); finish(h, f.hand);
  await h.evaluateInIsolatedWorld('lifecycleProbe.drainCareer()');
  assert.strictEqual(count(h), 1);
  assert.strictEqual((await service.careerStats('P1')).counters.hands, 1);
  assert.strictEqual(messages.filter(function (m) { return m.method === 'append'; }).length, 1, 'production async bridge appends exactly once');
  h.evaluateInIsolatedWorld('lifecycleProbe.stop()');
  h = create(clone(h.storage), h.gameId, options); await ready(h);
  register(h, f.baseline); send(h, 'gC', f.deal); finish(h, f.hand);
  await h.evaluateInIsolatedWorld('lifecycleProbe.drainCareer()');
  assert.strictEqual(count(h), 1);
  assert.strictEqual((await service.careerStats('P1')).counters.hands, 1);
  assert.strictEqual(messages.filter(function (m) { return m.method === 'append'; }).length, 1, 'replayed sparse hand never submits another append');
  var outboxPrefix = require('./careerIndexedStore.js').OUTBOX_PREFIX;
  assert.strictEqual(Object.keys(h.storage).filter(function (key) { return key.indexOf(outboxPrefix) === 0; }).length, 0, 'acknowledged append drains its durable outbox');
  console.log('PASS asynchronous Career bridge sparse append and replay');
})().catch(function (error) { console.error(error); process.exitCode = 1; });
