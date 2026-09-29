'use strict';
var assert = require('assert');
var fs = require('fs');
var support = require('./testSupport/productionContentScriptHarness');
var stats = require('./stats');
var frames = require('./testSupport/flopCBetProductionFrames');
var content = process.env.PNHUD_BASELINE ? require('child_process').execFileSync('git', ['show', 'e9c833b:content.js'], { encoding: 'utf8' }) : fs.readFileSync('content.js', 'utf8');
function instrument(source) {
  return source.replace(/\n\}\)\(\);\s*$/, `
  globalThis.controllers = globalThis.controllers || [];
  globalThis.controllers.push({ bridge: handlePageBridgeMessage, finalize: finalizeStatsHand,
    persist: persistHandAccounting, render: refreshHud, reset: resetCurrentSession,
    status: function () { return { cleaned: extensionCleanedUp, pause: currentEffectivePauseState(), finalized: handAccounting.finalizedHandIds.size, frames: pipelineHealth.framesReceived }; } });
})();`);
}
function make(storage, document) {
  var h = support.createHarness({ gameId: 'controller-long-pause', initialStorage: storage, document: document, controlledClock: true,
    transformContentSource: function () { return instrument(content); } });
  assert.deepStrictEqual(h.evaluationErrors, []);
  if (process.env.PNHUD_BASELINE) h.evaluateInIsolatedWorld(require("child_process").execFileSync("git", ["show", "e9c833b:pokerNowLifecycleSignal.js"], { encoding: "utf8" }));
  return h;
}
var keys = support.storageKeys('controller-long-pause');
var initial = {}; initial[keys.schema] = 4; initial[keys.playerMap] = { P1: 'PlayerA', P2: 'PlayerB' };
function emit(h, event, payload, time) { support.dispatchFrame(h, '42' + JSON.stringify([event, payload]), 'frame-' + time, time); }
function paused(h, time) { emit(h, 'gC', { status: 'paused' }, time); }
function hand(id, reverse) {
  return { hI: id, handId: id, status: 'inProgress', gT: [1, 0], oTC: { '1': [] }, tB: reverse ? { P2: 10, P1: 20 } : { P1: 10, P2: 20 },
    cHB: 20, mR: 40, cPI: reverse ? 'P2' : 'P1', pITT: reverse ? 'P2' : 'P1', sBPI: reverse ? 'P2' : 'P1', bBPI: reverse ? 'P1' : 'P2',
    iHPI: ['P1', 'P2'], pGS: { P1: 'inGame', P2: 'inGame' }, pC: { P1: {}, P2: {} }, seats: [[1, 'P1'], [6, 'P2']], gameResult: '<D>' };
}
function zero(h, label) {
  assert.strictEqual(stats.computePlayerStats(h.storage[keys.liveEvents] || [], 'PlayerA').handsPlayed, 0, label);
  assert.strictEqual(h.evaluateInIsolatedWorld('controllers.at(-1).status().finalized'), 0, label + ' no finalization');
  assert.strictEqual(Object.keys(h.storage).filter(function (key) { return key.startsWith('pokerNowHudCareerV1:record:'); }).length, 0, label + ' no Career append');
}
function storm(h, start, label) {
  for (var i = 0; i < 100; i++) {
    emit(h, 'gC', hand('STALE-' + i, i % 2), start + i * 1200000);
    emit(h, 'gC', { tB: { P1: 100, P2: 100 }, pGS: { P1: 'fold', P2: 'inGame' } }, start + i * 1200000 + 1);
    if (i % 10 === 0) emit(h, 'registered', { currentPlayer: { id: 'P1' }, ownerID: 'P1', gameState: hand('RESYNC-' + i, false) }, start + i * 1200000 + 2);
  }
  zero(h, label);
}
for (var flag of ['gamePaused', 'isPaused', 'paused', 'game_paused']) {
  var flagged = make(initial);
  support.dispatchFrames(flagged, frames.ordinaryScenario('deep-bet-fold', 'BEFORE-PAUSE').frames.slice(0, 2), 'baseline', 10);
  emit(flagged, 'gC', { [flag]: true }, 1000);
  storm(flagged, 2000, flag + ' explicit Pause cannot merely label the HUD while hands grow');
  var restarted = make(flagged.storage);
  storm(restarted, 130000000, flag + ' persisted across restart');
}
var h = make(initial);
support.dispatchFrames(h, frames.ordinaryScenario('deep-bet-fold', 'BEFORE-PAUSE').frames.slice(0, 2), 'baseline', 10);
paused(h, 1000); storm(h, 2000, 'long Pause, stale IDs, betting patches and reconnect/resync');
var priorBridge = h.evaluateInIsolatedWorld('controllers[0].bridge');
h.evaluateInIsolatedWorld(instrument(content));
assert.strictEqual(h.listenerCount('message'), 1, 'reinjection must leave exactly one authoritative socket listener');
assert.strictEqual(h.evaluateInIsolatedWorld('controllers[0].status().cleaned'), true);
storm(h, 130000000, 'reinjected controller preserves Pause');
var before = JSON.stringify(h.storage); var writes = h.storageWrites.length;
h.evaluateInIsolatedWorld('controllers[0].finalize("STALE-1", "stale callback", 999); controllers[0].persist(); controllers[0].reset(); controllers[0].render();');
priorBridge({ source: h.contextWindow, origin: 'https://pokernow.com', data: { source: 'pokernow-stats-hud-main', type: 'websocket-frame', frameId: 'retired-resume', direction: 'incoming', data: '42["notice",{"message":"Room owner resumed the game"}]', dataType: 'string' } });
assert.strictEqual(JSON.stringify(h.storage), before, 'retired callbacks cannot persist, reset or resume');
assert.strictEqual(h.storageWrites.length, writes);
for (var restart of ['page reload', 'extension reload', 'browser lifecycle restart']) {
  h = make(h.storage); storm(h, 260000000, restart + ' remains paused even with sparse active snapshots');
}
// A separate isolated world shares the document ownership epoch (extension reload).
var old = h;
h = make(old.storage, old.context.document);
assert.strictEqual(old.listenerCount('message'), 0, 'cross-world predecessor is retired synchronously');
storm(h, 390000000, 'cross-world owner remains paused');
emit(h, 'notice', { message: 'Room owner resumed the game' }, 520000000);
var scenario = frames.ordinaryScenario('deep-bet-fold', 'AFTER-LONG-PAUSE');
support.dispatchFrames(h, scenario.frames.slice(0, -1).concat([scenario.terminalFrame]), 'resume', 520001000);
var finalized = h.storage[keys.finalizedHandIds] || [];
assert.strictEqual(finalized.length, 1, 'first observed resumed hand finalizes once');
var settled = JSON.stringify(h.storage[keys.liveEvents]);
support.dispatchFrames(h, [scenario.terminalFrame, scenario.terminalFrame], 'repeat', 520002000);
assert.strictEqual(JSON.stringify(h.storage[keys.liveEvents]), settled, 'duplicate settlement is inert');
assert.strictEqual(Object.keys(h.storage).filter(function (key) { return key.startsWith('pokerNowHudCareerV1:record:'); }).length, 1, 'resumed Career appends exactly once');
assert.ok(h.logs.every(function (entry) { return entry[0] !== '[HUD] websocket frame processing error'; }));
console.log('Long-Pause/reconnect/restart/reinjection ownership matrix passed; resumed Session finalizes exactly once.');
