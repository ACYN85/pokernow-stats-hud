'use strict';

var assert = require('assert');
var fs = require('fs');
var manifest = require('./manifest.json');
var lifecycle = require('./gameBreakLifecycle.js');

var content = fs.readFileSync('./content.js', 'utf8');
var isolated = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });
assert.ok(isolated.js.includes('interruptedHandRecovery.js'));
assert.ok(isolated.js.indexOf('interruptedHandRecovery.js') < isolated.js.indexOf('content.js'));
assert.ok(content.includes("['PokerInterruptedHandRecovery', globalThis.PokerInterruptedHandRecovery, 'interruptedHandRecovery.js']"));
assert.ok(content.includes('reconcileInterruptedHandRecovery(currentSnapshot'));
assert.ok(content.includes('recoveryOwnsCurrentHand'));
assert.ok(content.includes('socketGameContext.handId = String(active.handId)'));
assert.ok(content.includes('PokerHandFinalization.reclaimRecoveredHand'));
assert.ok(content.includes('capturedEventSemantics = new Set(liveEvents.concat(activeHandState'), 'restored staged events retain production dedupe ownership');
assert.ok(content.includes('interruptedHandRecovery: PokerInterruptedHandRecovery.snapshot'));
assert.ok(content.includes('interruptedHandRecoveryState = PokerInterruptedHandRecovery.createState(null)'), 'session reset clears recovery ownership');
assert.ok(content.includes('diagnosticGameStatus(current, incomingPatch)'), 'current patch status outranks stale merged status');
assert.ok(content.includes('authoritativeLifecycleFlag(current, incomingPatch'));
assert.ok(content.includes('var requiredConfidence = 50'), 'generic hand-boundary confidence remains unchanged');

function state() {
  return lifecycle.createState({ buildId: 'paused-live-test', gameSessionKey: 'table' });
}
function trace(target, input) {
  return lifecycle.recordSnapshot(target, Object.assign({
    timestamp: Date.now(),
    currentTableStatus: 'inProgress',
    playerStatuses: [],
    occupiedSeatCount: 2,
    activeInGamePlayerCount: 2,
    mappedPlayerCount: 2,
    activeHand: { handId: 'H1' },
    dealingPossible: true,
    cleanPreDealBaseline: false,
    priorHandResolved: false
  }, input || {}));
}
var live = state();
assert.strictEqual(trace(live).classification, 'active');
assert.strictEqual(trace(live, { currentTableStatus: 'paused' }).classification, 'temporarily stopped', 'live mid-hand pause overrides stale active-hand evidence');
assert.strictEqual(trace(live, { currentTableStatus: 'stopped' }).classification, 'temporarily stopped');
assert.strictEqual(trace(live, { currentTableStatus: 'inProgress', activeInGamePlayerCount: 1 }).classification, 'broken heads-up game', 'insufficient eligible players overrides connected transport and active hand');
assert.strictEqual(trace(live, { currentTableStatus: 'inProgress', activeInGamePlayerCount: 2 }).classification, 'active');
assert.strictEqual(trace(live, { currentTableStatus: 'waitingToStart', gamePaused: true }).classification, 'temporarily stopped');
assert.strictEqual(trace(live, { currentTableStatus: 'inProgress', gamePaused: false }).classification, 'active', 'explicit resumed state supersedes stale waiting state');

console.log('Production live inactive precedence, partial-patch status ownership, and interrupted-hand recovery wiring tests passed.');
