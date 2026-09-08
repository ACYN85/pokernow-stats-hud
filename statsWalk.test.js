'use strict';

var assert = require('assert');
var stats = require('./stats.js');
var classifier = require('./playerProfileClassifier.js');

function event(handId, player, action, timestamp, extra) {
  return Object.assign({ handId: handId, player: player, action: action, street: 'preflop', amount: 0, timestamp: timestamp }, extra || {});
}

var sixHandedWalk = [
  event('walk-6', 'BB', 'blind', 1, { amount: 2, blindType: 'big' }),
  event('walk-6', 'SB', 'blind', 2, { amount: 1, blindType: 'small' }),
  event('walk-6', 'UTG', 'fold', 3),
  event('walk-6', 'MP', 'fold', 4),
  event('walk-6', 'CO', 'fold', 5),
  event('walk-6', 'BTN', 'fold', 6),
  event('walk-6', 'SB', 'fold', 7)
];
var sixStats = stats.computePlayerStats(sixHandedWalk, 'BB');
assert.deepStrictEqual({ hands: sixStats.handsPlayed, vpipOpportunities: sixStats.vpipOpportunities, vpipHands: sixStats.vpipHands, pfrOpportunities: sixStats.pfrOpportunities, pfrHands: sixStats.pfrHands, vpip: sixStats.vpip, pfr: sixStats.pfr }, { hands: 1, vpipOpportunities: 0, vpipHands: 0, pfrOpportunities: 0, pfrHands: 0, vpip: 0, pfr: 0 }, 'six-handed folds to the BB count a Hand but no VPIP/PFR opportunity');
assert.strictEqual(stats.detectBigBlindWalk(sixHandedWalk, 'BB').isWalk, true);

var headsUpWalk = [
  event('walk-hu', 'SB', 'blind', 1, { amount: 1, blindType: 'small' }),
  event('walk-hu', 'BB', 'blind', 2, { amount: 2, blindType: 'big' }),
  event('walk-hu', 'SB', 'fold', 3)
];
var headsUpStats = stats.computePlayerStats(headsUpWalk, 'BB');
assert.strictEqual(headsUpStats.handsPlayed, 1);
assert.strictEqual(headsUpStats.vpipOpportunities, 0, 'heads-up SB fold is a BB walk');
assert.strictEqual(headsUpStats.pfrOpportunities, 0);

var checkedOption = [
  event('bb-check', 'SB', 'blind', 1, { amount: 1, blindType: 'small' }),
  event('bb-check', 'BB', 'blind', 2, { amount: 2, blindType: 'big' }),
  event('bb-check', 'SB', 'call', 3, { amount: 1 }),
  event('bb-check', 'BB', 'check', 4)
];
var checkedStats = stats.computePlayerStats(checkedOption, 'BB');
assert.strictEqual(checkedStats.vpipOpportunities, 1, 'BB check after receiving an option remains in the denominator');
assert.strictEqual(checkedStats.pfrOpportunities, 1);
assert.strictEqual(stats.detectBigBlindWalk(checkedOption, 'BB').isWalk, false);

var raisedOption = [
  event('bb-raise', 'SB', 'blind', 1, { amount: 1, blindType: 'small' }),
  event('bb-raise', 'BB', 'blind', 2, { amount: 2, blindType: 'big' }),
  event('bb-raise', 'SB', 'call', 3, { amount: 1 }),
  event('bb-raise', 'BB', 'raise', 4, { amount: 6 })
];
var raisedStats = stats.computePlayerStats(raisedOption, 'BB');
assert.deepStrictEqual({ opportunities: raisedStats.vpipOpportunities, vpipHands: raisedStats.vpipHands, pfrHands: raisedStats.pfrHands, vpip: raisedStats.vpip, pfr: raisedStats.pfr }, { opportunities: 1, vpipHands: 1, pfrHands: 1, vpip: 100, pfr: 100 }, 'BB raise counts for VPIP and PFR');

var priorHands = [];
for (var hand = 1; hand <= 10; hand += 1) {
  priorHands.push(event('prior-' + hand, 'BB', hand <= 5 ? 'call' : 'fold', hand));
}
var preserved = stats.computePlayerStats(priorHands.concat(headsUpWalk), 'BB');
assert.deepStrictEqual({ hands: preserved.handsPlayed, opportunities: preserved.vpipOpportunities, vpipHands: preserved.vpipHands, vpip: preserved.vpip }, { hands: 11, opportunities: 10, vpipHands: 5, vpip: 50 }, 'a 5/10 player remains 50% after a walk instead of becoming 5/11');

var firstSession = stats.computePlayerStats(priorHands.slice(0, 5), 'BB');
var secondSession = stats.computePlayerStats(priorHands.slice(5).concat(headsUpWalk), 'BB');
var combined = stats.combinePlayerStats('BB', [firstSession, secondSession]);
assert.deepStrictEqual({ hands: combined.handsPlayed, opportunities: combined.vpipOpportunities, vpipHands: combined.vpipHands, vpip: combined.vpip }, { hands: 11, opportunities: 10, vpipHands: 5, vpip: 50 }, 'session/all-time aggregation combines numerator and opportunity counts');

var tableContextBaselineEvents = [];
for (var contextHand = 1; contextHand <= 10; contextHand += 1) {
  var contextId = 'context-' + contextHand;
  tableContextBaselineEvents.push(event(contextId, 'BB', 'blind', contextHand * 10, { amount: 2, blindType: 'big', playersDealtCount: 6, playersDealtCountVersion: 1, playersDealtCountSource: 'finalized-hand-participants' }));
  tableContextBaselineEvents.push(event(contextId, 'SB', 'blind', contextHand * 10 + 1, { amount: 1, blindType: 'small' }));
  ['UTG', 'MP', 'CO', 'BTN'].forEach(function (player, index) { tableContextBaselineEvents.push(event(contextId, player, 'fold', contextHand * 10 + index + 2)); });
  tableContextBaselineEvents.push(event(contextId, 'SB', 'call', contextHand * 10 + 6, { amount: 1 }));
  tableContextBaselineEvents.push(event(contextId, 'BB', contextHand <= 5 ? 'call' : 'check', contextHand * 10 + 7, { amount: contextHand <= 5 ? 2 : 0 }));
}
var tableContextBeforeWalk = stats.computePlayerStats(tableContextBaselineEvents, 'BB');
var tableContextAfterWalk = stats.computePlayerStats(tableContextBaselineEvents.concat(sixHandedWalk), 'BB');
assert.deepStrictEqual({
  handsDelta: tableContextAfterWalk.handsPlayed - tableContextBeforeWalk.handsPlayed,
  vpipHandsDelta: tableContextAfterWalk.vpipHands - tableContextBeforeWalk.vpipHands,
  vpipOpportunityDelta: tableContextAfterWalk.vpipOpportunities - tableContextBeforeWalk.vpipOpportunities,
  pfrHandsDelta: tableContextAfterWalk.pfrHands - tableContextBeforeWalk.pfrHands,
  pfrOpportunityDelta: tableContextAfterWalk.pfrOpportunities - tableContextBeforeWalk.pfrOpportunities,
  tableSizeSumDelta: tableContextAfterWalk.preflopTableSizeSum - tableContextBeforeWalk.preflopTableSizeSum,
  tableSizeOpportunityDelta: tableContextAfterWalk.preflopTableSizeOpportunities - tableContextBeforeWalk.preflopTableSizeOpportunities
}, { handsDelta: 1, vpipHandsDelta: 0, vpipOpportunityDelta: 0, pfrHandsDelta: 0, pfrOpportunityDelta: 0, tableSizeSumDelta: 0, tableSizeOpportunityDelta: 0 }, 'a true BB walk advances hands only and cannot enter preflop table-size context');
assert.strictEqual(tableContextBeforeWalk.effectiveTableSize, 6);
assert.strictEqual(tableContextAfterWalk.effectiveTableSize, 6);
assert.strictEqual(classifier.scoreDecomposition(tableContextBeforeWalk).tableContext.effectiveTableSize, classifier.scoreDecomposition(tableContextAfterWalk).tableContext.effectiveTableSize, 'classifier table context is unchanged by a true BB walk');

console.log('Big-blind walk opportunity and aggregation tests passed.');
