'use strict';

var assert = require('assert');
var fs = require('fs');
var walk = require('./walkDetection.js');
var hands = require('./handFinalization.js');
var stats = require('./stats.js');
var overlays = require('./seatOverlay.js');

function event(handId, player, action, timestamp, extra) {
  return Object.assign({ handId: handId, player: player, action: action, street: 'preflop', amount: 0, timestamp: timestamp }, extra || {});
}

var baseline = [
  event('base-1', 'BB', 'call', 10),
  event('base-2', 'BB', 'raise', 20),
  event('base-3', 'BB', 'fold', 30),
  event('base-4', 'BB', 'fold', 40)
];
var accounting = hands.createState({ finalizedEvents: baseline });
var displayedEvents = accounting.finalizedEvents;
hands.beginHand(accounting, 'live-walk', { activate: true, timestamp: 100 });

var identities = { smallBlindPlayerId: 'sb-id', bigBlindPlayerId: 'bb-id' };
var boundaryEvents = [
  walk.createInitialHandEvent({ handId: 'live-walk', playerId: 'sb-id', player: 'SB', smallBlindPlayerId: identities.smallBlindPlayerId, bigBlindPlayerId: identities.bigBlindPlayerId, blindDeduction: null, timestamp: 100 }),
  walk.createInitialHandEvent({ handId: 'live-walk', playerId: 'bb-id', player: 'BB', smallBlindPlayerId: identities.smallBlindPlayerId, bigBlindPlayerId: identities.bigBlindPlayerId, blindDeduction: null, timestamp: 100 }),
  event('live-walk', 'SB', 'fold', 110, { playerId: 'sb-id' })
];
boundaryEvents.forEach(function (item) {
  hands.stageEvent(accounting, item, { playerId: item.playerId, reason: item.action === 'blind' ? 'verified blind assignment' : 'verified live action' });
});
assert.strictEqual(hands.commitHand(accounting, 'live-walk', 'settlement/gameResult', 120).committed, true);

var result = stats.computePlayerStats(displayedEvents, 'BB');
assert.strictEqual(boundaryEvents[1].action, 'blind', 'verified bBPI must survive even without same-window stack deduction');
assert.strictEqual(boundaryEvents[1].blindType, 'big');
assert.deepStrictEqual({
  hands: result.handsPlayed,
  vpipHands: result.vpipHands,
  vpipOpportunities: result.vpipOpportunities,
  pfrHands: result.pfrHands,
  pfrOpportunities: result.pfrOpportunities,
  vpip: result.vpip,
  pfr: result.pfr
}, { hands: 5, vpipHands: 2, vpipOpportunities: 4, pfrHands: 1, pfrOpportunities: 4, vpip: 50, pfr: 25 });
assert.match(overlays.compactStatsLabel(result), /^H 5 \| VPIP 50% \| PFR 25%/);

function blindEvent(handId, playerId, player, smallBlindPlayerId, bigBlindPlayerId, timestamp) {
  return walk.createInitialHandEvent({ handId: handId, playerId: playerId, player: player, smallBlindPlayerId: smallBlindPlayerId, bigBlindPlayerId: bigBlindPlayerId, blindDeduction: null, timestamp: timestamp });
}

var calledRaise = [
  blindEvent('bb-called', 'sb-id', 'SB', 'sb-id', 'bb-id', 200),
  blindEvent('bb-called', 'bb-id', 'BB', 'sb-id', 'bb-id', 201),
  event('bb-called', 'SB', 'raise', 202, { amount: 6 }),
  event('bb-called', 'BB', 'call', 203, { amount: 4 })
];
assert.strictEqual(stats.computePlayerStats(calledRaise, 'BB').vpipOpportunities, 1, 'BB calling a raise remains an opportunity');

var raised = [
  blindEvent('bb-raised', 'sb-id', 'SB', 'sb-id', 'bb-id', 210),
  blindEvent('bb-raised', 'bb-id', 'BB', 'sb-id', 'bb-id', 211),
  event('bb-raised', 'SB', 'call', 212, { amount: 1 }),
  event('bb-raised', 'BB', 'raise', 213, { amount: 6 })
];
assert.strictEqual(stats.computePlayerStats(raised, 'BB').pfrOpportunities, 1, 'BB raising remains an opportunity');

var limped = [
  blindEvent('bb-option', 'sb-id', 'SB', 'sb-id', 'bb-id', 220),
  blindEvent('bb-option', 'bb-id', 'BB', 'sb-id', 'bb-id', 221),
  event('bb-option', 'SB', 'call', 222, { amount: 1 }),
  event('bb-option', 'BB', 'check', 223)
];
assert.strictEqual(stats.computePlayerStats(limped, 'BB').vpipOpportunities, 1, 'SB limp and BB check is not a walk');

var ordinaryFold = [
  blindEvent('ordinary-fold', 'sb-id', 'SB', 'sb-id', 'bb-id', 230),
  blindEvent('ordinary-fold', 'bb-id', 'BB', 'sb-id', 'bb-id', 231),
  event('ordinary-fold', 'UTG', 'fold', 232)
];
assert.strictEqual(stats.computePlayerStats(ordinaryFold, 'UTG').vpipOpportunities, 1, 'a normal non-Big-Blind fold remains an opportunity');

var uncertainBlind = [
  blindEvent('uncertain-blind', 'possible-bb', 'Possible BB', 'sb-id', '<D>', 240),
  event('uncertain-blind', 'Other', 'fold', 241)
];
assert.strictEqual(uncertainBlind[0].action, 'dealt');
assert.strictEqual(stats.computePlayerStats(uncertainBlind, 'Possible BB').vpipOpportunities, 1, 'uncertain blind identity must not exclude an opportunity');

var nextHandAccounting = hands.createState();
hands.beginHand(nextHandAccounting, 'walk-before-next', { activate: true, timestamp: 300 });
[
  blindEvent('walk-before-next', 'sb-id', 'SB', 'sb-id', 'bb-id', 300),
  blindEvent('walk-before-next', 'bb-id', 'BB', 'sb-id', 'bb-id', 301),
  event('walk-before-next', 'SB', 'fold', 302, { playerId: 'sb-id' })
].forEach(function (item) {
  hands.stageEvent(nextHandAccounting, item, { playerId: item.playerId, reason: 'verified next-boundary production event' });
});
var nextBoundary = hands.beginHand(nextHandAccounting, 'following-hand', { activate: true, timestamp: 310, priorReason: 'next distinct hand began' });
assert.strictEqual(nextBoundary.priorResult.committed, true, 'next-hand boundary finalizes the walk');
var nextBoundaryStats = stats.computePlayerStats(nextHandAccounting.finalizedEvents, 'BB');
assert.deepStrictEqual({ hands: nextBoundaryStats.handsPlayed, vpipOpportunities: nextBoundaryStats.vpipOpportunities, pfrOpportunities: nextBoundaryStats.pfrOpportunities }, { hands: 1, vpipOpportunities: 0, pfrOpportunities: 0 });

var productionSource = fs.readFileSync('./content.js', 'utf8');
assert.match(productionSource, /\[HUD WALK TRACE\]/, 'live finalization emits the uniquely prefixed walk trace');
assert.match(productionSource, /statsBeforeCommit/);
assert.match(productionSource, /incrementsApplied/);
assert.match(productionSource, /sourceRepresentation: 'handAccounting\.finalizedEvents via liveEvents'/, 'trace identifies the exact live overlay denominator source');
assert.match(productionSource, /surroundingRawBlindSamples/, 'trace retains blind fields around boundary timing');
assert.match(productionSource, /PokerHudDiagnostics\.enabled\('deep'\)/, 'temporary live tracing remains gated behind deep diagnostics');

console.log('Production Big Blind walk path test passed.');
