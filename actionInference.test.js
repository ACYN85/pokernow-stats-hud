'use strict';

var assert = require('assert');
var inference = require('./actionInference.js');
var stats = require('./stats.js');

var raise = inference.classifyCommitmentTransition({ previousCommitment: 10, currentCommitment: 60, previousHighestBet: 20 });
assert.deepStrictEqual({ action: raise.action, amount: raise.amount, addedAmount: raise.addedAmount, amountIsTotalTo: raise.amountIsTotalTo }, { action: 'raise', amount: 60, addedAmount: 50, amountIsTotalTo: true });

var call = inference.classifyCommitmentTransition({ previousCommitment: 20, currentCommitment: 60, previousHighestBet: 60 });
assert.deepStrictEqual({ action: call.action, amount: call.amount, addedAmount: call.addedAmount }, { action: 'call', amount: 40, addedAmount: 40 });

var check = inference.classifyActorTurnEnd({ actorChanged: true, foldedChanged: false, becameInactive: false, commitmentsVerified: true, addedAmount: 0, outstandingAmount: 0 });
assert.strictEqual(check.action, 'check');
assert.strictEqual(check.accepted, true);

var unverifiedCheck = inference.classifyActorTurnEnd({ actorChanged: true, foldedChanged: false, becameInactive: false, commitmentsVerified: false, addedAmount: 0, outstandingAmount: 0 });
assert.strictEqual(unverifiedCheck.accepted, false);
assert.strictEqual(unverifiedCheck.action, null);

var ambiguousFold = inference.classifyActorTurnEnd({ actorChanged: true, foldedChanged: false, becameInactive: false, commitmentsVerified: true, addedAmount: 0, outstandingAmount: 40 });
assert.strictEqual(ambiguousFold.accepted, false);
assert.strictEqual(ambiguousFold.action, null);

var blind = inference.classifyCommitmentTransition({ previousCommitment: 0, currentCommitment: 20, previousHighestBet: 0, forcedBlind: true });
assert.strictEqual(blind.accepted, false);
assert.strictEqual(blind.action, 'blind');

var events = [
  { handId: 'H1', player: 'Raiser', action: 'blind', street: 'preflop', amount: 10, timestamp: 1 },
  { handId: 'H1', player: 'Caller', action: 'blind', street: 'preflop', amount: 20, timestamp: 2 },
  { handId: 'H1', player: 'Raiser', action: raise.action, street: 'preflop', amount: raise.amount, timestamp: 3 },
  { handId: 'H1', player: 'Caller', action: call.action, street: 'preflop', amount: call.amount, timestamp: 4 },
  { handId: 'H2', player: 'Raiser', action: 'dealt', street: 'preflop', amount: 0, timestamp: 5 },
  { handId: 'H2', player: 'Caller', action: 'dealt', street: 'preflop', amount: 0, timestamp: 5 },
  { handId: 'H2', player: 'Raiser', action: check.action, street: 'flop', amount: 0, timestamp: 6 },
  { handId: 'H2', player: 'Caller', action: check.action, street: 'flop', amount: 0, timestamp: 7 }
];
var handOneRaiser = stats.computePlayerStats(events.filter(function (event) { return event.handId === 'H1'; }), 'Raiser');
var handOneCaller = stats.computePlayerStats(events.filter(function (event) { return event.handId === 'H1'; }), 'Caller');
assert.deepStrictEqual({ hands: handOneRaiser.handsPlayed, vpip: handOneRaiser.vpip, pfr: handOneRaiser.pfr }, { hands: 1, vpip: 100, pfr: 100 });
assert.deepStrictEqual({ hands: handOneCaller.handsPlayed, vpip: handOneCaller.vpip, pfr: handOneCaller.pfr }, { hands: 1, vpip: 100, pfr: 0 });

var raiserStats = stats.computePlayerStats(events, 'Raiser');
var callerStats = stats.computePlayerStats(events, 'Caller');
assert.deepStrictEqual({ hands: raiserStats.handsPlayed, vpip: raiserStats.vpip, pfr: raiserStats.pfr, af: raiserStats.af }, { hands: 2, vpip: 50, pfr: 50, af: 0 });
assert.deepStrictEqual({ hands: callerStats.handsPlayed, vpip: callerStats.vpip, pfr: callerStats.pfr, af: callerStats.af }, { hands: 2, vpip: 50, pfr: 0, af: 0 });

var blindOnlyStats = stats.computePlayerStats([
  { handId: 'B1', player: 'BlindOnly', action: 'blind', street: 'preflop', amount: 10, timestamp: 1 }
], 'BlindOnly');
assert.deepStrictEqual({ hands: blindOnlyStats.handsPlayed, vpip: blindOnlyStats.vpip, pfr: blindOnlyStats.pfr }, { hands: 1, vpip: 0, pfr: 0 });

console.log('All live action-inference tests passed.');
