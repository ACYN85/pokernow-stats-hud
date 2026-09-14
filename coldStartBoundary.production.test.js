'use strict';

var assert = require('assert');
var fs = require('fs');
var lifecycle = require('./firstHandLifecycle.js');
var hands = require('./handFinalization.js');
var stats = require('./stats.js');

function completeSignature(overrides) {
  return Object.assign({
    startupType: 'cold-start',
    noActiveHand: true,
    noFinalizedHands: true,
    noPreviousHandCommitted: true,
    mappedPlayersVerified: true,
    verifiedPlayerIds: ['player-a', 'player-b'],
    holeCardsDetected: true,
    observedPreDealBaseline: true,
    inHandPlayerIds: ['player-a', 'player-b'],
    smallBlindPlayerId: 'player-a',
    bigBlindPlayerId: 'player-b',
    currentPlayerId: 'player-a',
    playerInTurnId: 'player-a',
    confidenceBeforeOverride: 48,
    requiredConfidence: 50,
    observedSignals: ['player hole cards appeared', 'unknown/minified player-ID field became active']
  }, overrides || {});
}

var override = lifecycle.evaluateColdStartBoundaryOverride(completeSignature());
assert.ok(override && override.activated, 'the captured 48-point cold-start deal signature activates the override');
assert.strictEqual(override.reason, 'verified cold-start deal signature');
assert.strictEqual(override.confidenceBeforeOverride, 48);
assert.strictEqual(override.requiredConfidence, 50);
assert.ok(override.observedSignals.includes('iHPI present'));
assert.ok(override.observedSignals.includes('sBPI present'));
assert.ok(override.observedSignals.includes('bBPI present'));
assert.ok(override.observedSignals.includes('cPI present'));
assert.ok(override.observedSignals.includes('pITT present'));

var traceState = lifecycle.create({ buildId: 'cold-start-test', lobbySessionKey: 'lobby', startupType: 'cold-start', startedAt: 1 });
lifecycle.record(traceState, 'boundaryDecisions', { accepted: true, confidenceScore: 48, coldStartBoundaryOverride: override }, 2);
assert.deepStrictEqual(lifecycle.snapshot(traceState)[0].boundaryDecisions[0].details.coldStartBoundaryOverride, override, 'first-hand lifecycle diagnostics include the structured override');

var handState = hands.createState({ finalizedEvents: [] });
function playAndFinalize(handNumber) {
  var handId = 'live-hand-' + handNumber;
  hands.beginHand(handState, handId, { activate: true, timestamp: handNumber * 100 });
  ['player-a', 'player-b'].forEach(function (playerId, index) {
    hands.stageEvent(handState, {
      handId: handId,
      playerId: playerId,
      player: index === 0 ? 'PlayerA' : 'PlayerB',
      action: 'blind',
      blindType: index === 0 ? 'small' : 'big',
      street: 'preflop',
      amount: index === 0 ? 10 : 20,
      timestamp: handNumber * 100 + index,
      eventKey: handId + '|blind|' + playerId
    }, { playerId: playerId, reason: 'verified production participant' });
  });
  hands.commitHand(handState, handId, 'settlement/gameResult appeared in live game-state patch', handNumber * 100 + 50);
  return stats.computePlayerStats(handState.finalizedEvents, 'PlayerA').handsPlayed;
}

assert.strictEqual(playAndFinalize(1), 1, 'fresh-lobby Hand 1 is finalized');
assert.strictEqual(playAndFinalize(2), 2, 'fresh-lobby Hand 2 is finalized once');
assert.strictEqual(playAndFinalize(3), 3, 'fresh-lobby Hand 3 is finalized once');

assert.strictEqual(lifecycle.evaluateColdStartBoundaryOverride(completeSignature({ observedPreDealBaseline: false })), false, 'joining during an active hand does not synthesize a boundary');
assert.strictEqual(lifecycle.evaluateColdStartBoundaryOverride(completeSignature({ observedPreDealBaseline: false, holeCardsDetected: false })), false, 'reloading during an active hand does not synthesize a boundary');
assert.strictEqual(lifecycle.evaluateColdStartBoundaryOverride(completeSignature({ noActiveHand: false })), false, 'reconnect while a hand is active cannot create a duplicate active hand');
assert.strictEqual(lifecycle.evaluateColdStartBoundaryOverride(completeSignature({ noFinalizedHands: false, noPreviousHandCommitted: false })), false, 'the override is disabled after the first committed hand');
assert.strictEqual(lifecycle.evaluateColdStartBoundaryOverride(completeSignature({ startupType: 'reset-session' })), false, 'Reset Session during a hand is not treated as cold startup');

var rearmed = completeSignature({ startupType: 'reset-session', lifecycleAcquisitionPending: true, noFinalizedHands: false, noPreviousHandCommitted: false });
assert.strictEqual(lifecycle.evaluateColdStartBoundaryOverride(rearmed).lifecycleAcquisition, true, 'rearmed acquisition reuses the complete deal proof despite prior Session history');
[
  { noActiveHand: false }, { observedPreDealBaseline: false }, { holeCardsDetected: false },
  { mappedPlayersVerified: false }, { inHandPlayerIds: ['player-a', 'unmapped'] },
  { smallBlindPlayerId: 'player-b', bigBlindPlayerId: 'player-b' }, { currentPlayerId: 'unmapped' },
  { playerInTurnId: null }, { lifecycleAcquisitionPending: false }
].forEach(function (missing) {
  assert.strictEqual(lifecycle.evaluateColdStartBoundaryOverride(Object.assign({}, rearmed, missing)), false, 'rearm cannot substitute for complete safe deal evidence: ' + JSON.stringify(missing));
});

['inHandPlayerIds', 'smallBlindPlayerId', 'bigBlindPlayerId', 'currentPlayerId', 'playerInTurnId'].forEach(function (field) {
  var missing = {};
  missing[field] = field === 'inHandPlayerIds' ? [] : null;
  assert.strictEqual(lifecycle.evaluateColdStartBoundaryOverride(completeSignature(missing)), false, field + ' is mandatory for the override');
});

var source = fs.readFileSync('./content.js', 'utf8');
assert.match(source, /var requiredConfidence = 50;/, 'the production generic threshold remains 50');
assert.match(source, /confidenceScore >= requiredConfidence/, 'ordinary boundaries still use the generic confidence comparison');
assert.match(source, /PokerFirstHandLifecycle\.evaluateColdStartBoundaryOverride\(/, 'detectGcNewHand calls the production cold-start helper');
assert.match(source, /coldStartBoundaryOverride: cloneJson\(coldStartBoundaryOverride \|\| false\)/, 'boundary decisions export the override through firstHandLifecycleTraces');

console.log('Cold-start boundary override production regression passed.');
