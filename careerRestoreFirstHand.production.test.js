'use strict';

var assert = require('assert');
var support = require('./testSupport/productionContentScriptHarness.js');
var frames = require('./testSupport/flopCBetProductionFrames.js');
var indexed = require('./careerIndexedStore.js');
var backup = require('./careerBackup.js');
var policy = require('./careerBackupPolicy.js');
var stats = require('./stats.js');
var fs = require('fs');
var vm = require('vm');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function instrument(source) {
  return source.replace(/\n\}\)\(\);\s*$/, `
  globalThis.restoreHandProbe = {
    ready: function () { return careerTrackingReady; },
    drain: function () { return careerIndexedAppendQueue; },
    confirm: function (candidate, preview) {
      careerDataUiState.backupCandidate = candidate;
      careerDataUiState.preview = Object.assign({ fileName: 'validated-backup.json' }, preview);
      confirmCareerRestore();
    },
    state: function () { return {
      busy: careerDataUiState.busy, message: careerDataUiState.message,
      events: cloneJson(liveEvents), finalized: Array.from(handAccounting.finalizedHandIds),
      active: cloneJson(PokerHandFinalization.activeHand(handAccounting)),
      evaluations: cloneJson(handTransitionDiagnostics.evaluations.slice(-8)),
      acquisitionPending: lifecycleBoundaryAcquisition.pending,
      excludedHandId: lifecycleBoundaryAcquisition.excludedHandId,
      lastAcceptedBoundaryAt: handTransitionDiagnostics.lastAcceptedBoundaryAt,
      previousHandId: previousGcSnapshot && previousGcSnapshot.hI,
      paused: currentEffectivePauseState()
    }; },
    stop: function () { cleanupExtension('restore hand fixture teardown'); }
  };
})();`);
}
function worker(service) {
  var listener;
  var bridge = new Proxy({}, { get: function (_, method) { return method === 'then' ? undefined : function () { return service[method].apply(service, arguments); }; } });
  var context = vm.createContext({ importScripts: function () {}, PokerCareerIndexedStore: indexed,
    PokerCareerBackup: backup, PokerCareerBackupPolicy: policy, crypto: require('crypto').webcrypto, performance: performance,
    chrome: { runtime: { onMessage: { addListener: function (fn) { listener = fn; } } }, storage: { local: { getKeys: async function () { return []; } } } }, service: bridge });
  vm.runInContext(fs.readFileSync('careerServiceWorker.js', 'utf8'), context);
  vm.runInContext('careerServicePromise = Promise.resolve(service)', context);
  return { send: function (message, callback) { listener(message, {}, callback); }, call: function (method, args) { return new Promise(function (resolve, reject) {
    listener({ type: indexed.MESSAGE_TYPE, method: method, args: args || [] }, {}, function (reply) { if (reply.ok) resolve(clone(reply.value)); else reject(new Error(reply.error)); });
  }); } };
}
function create(api, gameId, replacementGate) {
  var messages = [];
  var keys = support.storageKeys(gameId);
  var storage = {};
  storage[keys.schema] = 4;
  storage[keys.playerMap] = { P1: 'P1', P2: 'P2' };
  var h = support.createHarness({
    gameId: gameId, initialStorage: storage, controlledClock: true, initialNow: 100000,
    transformContentSource: instrument,
    runtimeSendMessage: function (message, callback) {
      messages.push(clone(message));
      if (message.method === 'replaceCareerBackup' && replacementGate) {
        replacementGate.release = function (error) {
          if (error) callback({ ok: false, error: error });
          else api.send(message, callback);
        };
        return;
      }
      api.send(message, callback);
    }
  });
  assert.deepStrictEqual(h.evaluationErrors, []);
  h.time = 100000; h.frame = 0; h.messages = messages;
  return h;
}
function state(h) { return clone(h.evaluateInIsolatedWorld('restoreHandProbe.state()')); }
function send(h, name, payload, delta, direction) {
  h.time += delta === undefined ? 100 : delta;
  h.setNow(h.time);
  h.contextWindow.postMessage({ source: 'pokernow-stats-hud-main', type: 'websocket-frame', frameId: 'restore-' + (++h.frame), hookInstanceId: 'restore', capturedAt: h.time, framesCaptured: h.frame, socketId: 'restore-socket', socketUrl: 'wss://example.invalid/socket', direction: direction || 'incoming', dataType: 'string', data: '42' + JSON.stringify([name, payload]), binaryBytes: null });
}
function start(h, scenario) { send(h, 'gC', scenario.snapshots.initial); }
function finish(h, scenario) {
  scenario.frames.slice(2, -1).forEach(function (raw) {
    var packet = JSON.parse(raw.slice(2)); send(h, packet[0], packet[1]);
  });
}
async function settle(h) {
  for (var i = 0; i < 100 && state(h).busy; i++) await new Promise(function (resolve) { setImmediate(resolve); });
  assert.match(state(h).message, /restored successfully/);
}
async function check(h, service, sessionHands, careerHands, label) {
  assert.strictEqual(stats.computePlayerStats(state(h).events, 'P1').handsPlayed, sessionHands, label + ' Session');
  var career = await service.careerStats('P1');
  assert.strictEqual(career ? career.counters.hands : 0, careerHands, label + ' Career');
  assert.strictEqual(state(h).finalized.length, sessionHands, label + ' finalized IDs');
}
(async function () {
 for (var variant of ['shortly-after-finalization', 'between-hands', 'paused-then-resumed', 'live-hand-discarded', 'in-flight-success', 'in-flight-failure', 'in-flight-superseded']) {
  var service = indexed.createMemoryService({}, { initializedAt: 1 });
  var api = worker(service);
  var candidate = await api.call('exportCareerBackup');
  var replacementGate = variant.indexOf('in-flight-') === 0 ? {} : null;
  var h = create(api, 'career-restore-' + variant, replacementGate);
  for (var i = 0; i < 20 && !h.evaluateInIsolatedWorld('restoreHandProbe.ready()'); i++) await new Promise(function (resolve) { setImmediate(resolve); });
  assert.strictEqual(h.evaluateInIsolatedWorld('restoreHandProbe.ready()'), true);
  var prior = frames.ordinaryScenario('bet-fold', 'PRIOR');
  send(h, 'registered', { currentPlayer: { id: 'P1' }, ownerID: 'P1', gameState: prior.snapshots.predeal });
  start(h, prior); finish(h, prior);
  await h.evaluateInIsolatedWorld('restoreHandProbe.drain()');
  await check(h, service, 1, 1, 'before restore');
  var partial = frames.ordinaryScenario('bet-fold', 'PARTIAL-BEFORE-RESTORE');
  if (variant === 'between-hands') h.time += 4000;
  if (variant === 'live-hand-discarded' || replacementGate) {
    h.time += 4000;
    start(h, partial);
  }
  if (variant === 'paused-then-resumed') send(h, 'action', { type: 'UP' }, 1, 'outgoing');
  var preview = await api.call('prepareCareerRestore', [candidate]);
  h.evaluateInIsolatedWorld('restoreHandProbe.confirm(' + JSON.stringify(candidate) + ',' + JSON.stringify(preview) + ')');
  if (replacementGate) {
    for (var spin = 0; spin < 100 && !replacementGate.release; spin++) await new Promise(function (resolve) { setImmediate(resolve); });
    assert.strictEqual(typeof replacementGate.release, 'function', 'worker replacement is held in flight');
    finish(h, partial);
    assert.strictEqual(stats.computePlayerStats(state(h).events, 'P1').handsPlayed, 2, 'pre-restore hand finalizes in Session before replacement settles');
    await check(h, service, 2, 1, 'Career append deferred during replacement');
    if (variant === 'in-flight-superseded') {
      h.evaluateInIsolatedWorld('restoreHandProbe.stop()');
      await h.evaluateInIsolatedWorld('restoreHandProbe.drain()');
      await check(h, service, 2, 2, 'controller cleanup releases deferred Career append');
      replacementGate.release();
      await new Promise(function (resolve) { setImmediate(resolve); });
      console.log('PASS Career Restore in-flight finalization: controller retirement retains hand');
      continue;
    }
    replacementGate.release(variant === 'in-flight-failure' ? 'fixture Career replacement failure' : null);
    if (variant === 'in-flight-failure') {
      for (var wait = 0; wait < 100 && state(h).busy; wait++) await new Promise(function (resolve) { setImmediate(resolve); });
      await h.evaluateInIsolatedWorld('restoreHandProbe.drain()');
      await check(h, service, 2, 2, 'failed Restore retains in-flight hand and Career append');
      assert.match(state(h).message, /Career data operation failed/);
      h.evaluateInIsolatedWorld('restoreHandProbe.stop()');
      console.log('PASS Career Restore in-flight finalization: failed replacement retains hand');
      continue;
    }
  }
  await settle(h);
  await check(h, service, 0, 0, 'successful restore');
  if (variant === 'paused-then-resumed') {
    assert.strictEqual(state(h).paused, 'paused', 'Restore retains verified Pause');
    send(h, 'gC', { hI: 'PAUSED-STALE' }, 1);
    await check(h, service, 0, 0, 'paused stale traffic');
    send(h, 'action', { type: 'UR' }, 1, 'outgoing');
    assert.strictEqual(state(h).paused, 'resumed', 'verified Resume reopens progression');
  }
  if (variant === 'live-hand-discarded') {
    finish(h, partial);
    await check(h, service, 0, 0, 'pre-restore partial hand discarded');
  } else {
    send(h, 'gC', prior.snapshots.initial, 1);
    await check(h, service, 0, 0, 'pre-restore hand replay excluded');
  }
  var next = frames.ordinaryScenario('bet-fold', 'AFTER-RESTORE');
  send(h, 'gC', next.snapshots.predeal, 1);
  await check(h, service, 0, 0, 'fresh predeal baseline');
  start(h, next);
  assert.ok(state(h).active && state(h).active.handId, 'first eligible boundary owns the hand: ' + JSON.stringify(state(h).evaluations.slice(-1)[0]));
  finish(h, next);
  await h.evaluateInIsolatedWorld('restoreHandProbe.drain()');
  await check(h, service, 1, 1, 'first eligible post-restore hand');
  send(h, 'gC', JSON.parse(next.terminalFrame.slice(2))[1]);
  await check(h, service, 1, 1, 'duplicate terminal');
  assert.strictEqual(h.messages.filter(function (message) { return message.method === 'append'; }).length, 2, 'one pre-restore and one post-restore append');
  assert.deepStrictEqual(h.logs.filter(function (line) { return line[0] === '[HUD] websocket frame processing error'; }), []);
  h.evaluateInIsolatedWorld('restoreHandProbe.stop()');
  console.log('PASS Career Restore first eligible hand: ' + variant);
 }
})().catch(function (error) { console.error(error); process.exitCode = 1; });
