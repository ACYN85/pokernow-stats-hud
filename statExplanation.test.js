'use strict';

var assert = require('assert');
var explanation = require('./statExplanation.js');
var preflopReducer = require('./preflopOpportunityReducer.js');
var flopReducer = require('./flopCBetOpportunityReducer.js');
var showdownReducer = require('./showdownStatsReducer.js');
var stats = require('./stats.js');
var showdownFixtures = require('./testSupport/showdownStatsFixtures.js');
var flopFixtures = require('./testSupport/flopCBetOpportunityFixtures.js');

function action(sequence, street, playerId, type, extra) {
  return Object.assign({
    sequence: sequence,
    sourceSequence: sequence,
    street: street,
    playerId: playerId,
    type: type,
    confidence: 'proven',
    isAllIn: false,
    isFullRaise: null,
    isShortAllInRaise: false
  }, extra || {});
}

function player(playerId, extra) {
  return Object.assign({ playerId: playerId, startingStack: 1000, folded: false, allIn: null, sawFlop: true, reachedShowdown: false }, extra || {});
}

function semanticRecord(handId, players, actions, options) {
  options = options || {};
  var flopActions = actions.filter(function (entry) { return entry.street === 'flop'; });
  var firstBet = flopActions.find(function (entry) { return entry.type === 'bet' || entry.type === 'raise'; }) || null;
  var entrants = options.flopEntrants || players.filter(function (entry) { return entry.sawFlop === true; }).map(function (entry) { return entry.playerId; });
  return {
    schemaVersion: 1,
    mode: 'production_shadow',
    status: 'finalized',
    handIdentity: { handId: handId, lifecycleHandId: 'life-' + handId },
    players: players,
    actions: actions,
    streets: {
      preflop: { entrants: players.map(function (entry) { return entry.playerId; }), actionOrder: actions.filter(function (entry) { return entry.street === 'preflop'; }).map(function (entry) { return entry.playerId; }) },
      flop: { entrants: entrants, firstActor: flopActions[0] && flopActions[0].playerId || null, actionOrder: flopActions.map(function (entry) { return entry.playerId; }), firstBettor: firstBet && firstBet.playerId || null, board: ['As', '7h', '2c'] },
      turn: { entrants: options.turnEntrants || entrants, actionOrder: actions.filter(function (entry) { return entry.street === 'turn'; }).map(function (entry) { return entry.playerId; }), board: ['As', '7h', '2c', 'Kd'] },
      river: { entrants: options.riverEntrants || entrants, actionOrder: actions.filter(function (entry) { return entry.street === 'river'; }).map(function (entry) { return entry.playerId; }), board: ['As', '7h', '2c', 'Kd', '3s'] }
    },
    preflopRoles: { openingAggressor: options.openingAggressor || null, finalAggressor: options.finalAggressor || null },
    automaticRunout: { detected: options.automaticRunout === true, postflopActionCount: flopActions.length },
    showdown: { detected: options.showdownDetected === true, participants: options.showdownParticipants || [], winners: options.showdownWinners || [], losers: options.showdownLosers || [] },
    settlement: options.settlement || { status: 'known', awards: [], refunds: [], totalAwardAmount: 0, chopped: false, uncontested: true, sidePotStatus: false, pots: [], reconciliation: {} },
    ambiguities: [],
    provenance: { historyComplete: true, recovered: false, finalizationReason: 'stat explanation fixture' }
  };
}

function finalizedEvents(record) {
  return record.players.map(function (entry) {
    return { handId: record.handIdentity.lifecycleHandId, playerId: entry.playerId, player: entry.playerId, action: 'dealt', street: 'preflop', timestamp: 1 };
  });
}

function basicContributions(record) {
  var result = {};
  record.players.forEach(function (entry) {
    var actions = record.actions.filter(function (item) { return item.street === 'preflop' && item.playerId === entry.playerId; });
    result[entry.playerId] = {
      vpip: { opportunities: 1, made: actions.some(function (item) { return item.type === 'call' || item.type === 'bet' || item.type === 'raise'; }) ? 1 : 0 },
      pfr: { opportunities: 1, made: actions.some(function (item) { return item.type === 'raise'; }) ? 1 : 0 }
    };
  });
  return result;
}

function buildExplanation(record, options) {
  options = options || {};
  var events = finalizedEvents(record);
  var preflopContribution = options.preflop === false ? null : preflopReducer.deriveContribution(record);
  var preflopIntegration = preflopContribution ? stats.applyPreflopContribution(events, preflopContribution, Object.fromEntries(record.players.map(function (entry) { return [entry.playerId, entry.playerId]; }))) : null;
  if (preflopIntegration) events = preflopIntegration.events;
  var flopContribution = options.flop === false ? null : flopReducer.deriveContribution(record);
  var flopIntegration = flopContribution ? stats.applyFlopCBetContribution(events, flopContribution) : null;
  if (flopIntegration) events = flopIntegration.events;
  var showdownContribution = options.showdown === false ? null : showdownReducer.deriveContribution(record);
  var showdownIntegration = showdownContribution ? stats.applyShowdownContribution(events, showdownContribution) : null;
  return explanation.build({
    semanticRecord: record,
    preflopContribution: preflopContribution,
    preflopIntegration: preflopIntegration,
    flopCBetContribution: flopContribution,
    flopCBetIntegration: flopIntegration,
    showdownContribution: showdownContribution,
    showdownIntegration: showdownIntegration,
    basicContributionsByPlayer: basicContributions(record),
    finalizedAt: 1000
  });
}

var sidePotRecord = semanticRecord('SYNTHETIC-SIDE-POT', [
  player('PlayerC', { reachedShowdown: true }),
  player('PlayerA', { folded: true, reachedShowdown: false }),
  player('PlayerB', { reachedShowdown: true })
], [
  action(1, 'preflop', 'PlayerC', 'raise', { isFullRaise: true }),
  action(2, 'preflop', 'PlayerA', 'call'),
  action(3, 'preflop', 'PlayerB', 'call'),
  action(4, 'flop', 'PlayerA', 'check'),
  action(5, 'flop', 'PlayerB', 'check'),
  action(6, 'flop', 'PlayerC', 'bet', { isAllIn: true }),
  action(7, 'flop', 'PlayerA', 'call'),
  action(8, 'flop', 'PlayerB', 'call'),
  action(9, 'turn', 'PlayerB', 'bet'),
  action(10, 'turn', 'PlayerA', 'fold'),
  action(11, 'river', 'PlayerB', 'check')
], {
  openingAggressor: 'PlayerC',
  finalAggressor: 'PlayerC',
  turnEntrants: ['PlayerC', 'PlayerA', 'PlayerB'],
  riverEntrants: ['PlayerC', 'PlayerB'],
  showdownDetected: true,
  showdownParticipants: ['PlayerC', 'PlayerB'],
  showdownWinners: ['PlayerB'],
  showdownLosers: ['PlayerC'],
  settlement: {
    status: 'known',
    awards: [{ awardId: 'player-b-award', playerId: 'PlayerB', amount: 500, potId: null, boardIndex: null }],
    refunds: [],
    totalAwardAmount: 500,
    chopped: false,
    uncontested: false,
    sidePotStatus: null,
    pots: [],
    reconciliation: {}
  }
});

var sidePot = buildExplanation(sidePotRecord);
assert.strictEqual(sidePot.players.PlayerC.flopCBet.semanticContribution, '1/1');
assert.strictEqual(sidePot.players.PlayerC.flopCBet.counterContribution, '1/1');
assert.strictEqual(sidePot.players.PlayerC.flopCBet.reasonCode, 'final_preflop_aggressor_bet_flop');
assert.strictEqual(sidePot.players.PlayerA.foldToFlopCBet.semanticContribution, '0/1');
assert.strictEqual(sidePot.players.PlayerA.foldToFlopCBet.reasonCode, 'direct_call_to_qualifying_cbet');
assert.strictEqual(sidePot.players.PlayerB.foldToFlopCBet.semanticContribution, '0/1');
assert.strictEqual(sidePot.players.PlayerB.foldToFlopCBet.reasonCode, 'direct_call_to_qualifying_cbet');
assert.deepStrictEqual(sidePot.players.PlayerA.foldToFlopCBet.laterActionsIgnored, [
  { sequence: 10, street: 'turn', type: 'fold', reasonCode: 'already_responded_to_cbet' }
]);
assert.strictEqual(sidePot.players.PlayerA.wtsd.semanticContribution, '0/1');
assert.strictEqual(sidePot.players.PlayerA.wsd.semanticContribution, '0/0');
assert.strictEqual(sidePot.players.PlayerC.wtsd.semanticContribution, '1/1');
assert.strictEqual(sidePot.players.PlayerC.wsd.semanticContribution, '0/1');
assert.strictEqual(sidePot.players.PlayerB.wsd.semanticContribution, '1/1');
assert.strictEqual(sidePot.players.PlayerB.wsd.reasonCode, 'positive_showdown_award');

var squeezeRecord = semanticRecord('F3B-SQUEEZE', [player('A', { sawFlop: false }), player('B', { sawFlop: false }), player('C', { sawFlop: false }), player('D', { sawFlop: false })], [
  action(1, 'preflop', 'A', 'raise', { isFullRaise: true, raiseContext: 'open_raise' }),
  action(2, 'preflop', 'B', 'call'),
  action(3, 'preflop', 'C', 'call'),
  action(4, 'preflop', 'D', 'raise', { isFullRaise: true, raiseContext: 'squeeze' }),
  action(5, 'preflop', 'A', 'fold'),
  action(6, 'preflop', 'B', 'call'),
  action(7, 'preflop', 'C', 'fold')
], { openingAggressor: 'A', finalAggressor: 'D', flopEntrants: [] });
var squeeze = buildExplanation(squeezeRecord, { flop: false, showdown: false });
assert.strictEqual(squeeze.players.A.foldToThreeBet.semanticContribution, '1/1');
assert.strictEqual(squeeze.players.A.foldToThreeBet.reasonCode, 'direct_fold_to_qualifying_three_bet');
assert.strictEqual(squeeze.players.B.foldToThreeBet.semanticContribution, '0/1');
assert.strictEqual(squeeze.players.B.foldToThreeBet.reasonCode, 'direct_call_to_qualifying_three_bet');
assert.strictEqual(squeeze.players.C.foldToThreeBet.semanticContribution, '1/1');
assert.strictEqual(squeeze.players.D.foldToThreeBet.semanticContribution, '0/0');
assert.strictEqual(squeeze.players.D.foldToThreeBet.reasonCode, 'three_bettor_not_eligible');

function showdownExplanation(fixture) {
  return buildExplanation(fixture, { preflop: false, flop: false });
}

var sd1 = showdownExplanation(showdownFixtures.S3);
assert.strictEqual(sd1.players.A.wtsd.semanticContribution, '1/1');
assert.strictEqual(sd1.players.B.wtsd.semanticContribution, '1/1');
assert.strictEqual(sd1.players.A.wsd.semanticContribution, '1/1');
assert.strictEqual(sd1.players.B.wsd.semanticContribution, '0/1');

var sd2 = showdownExplanation(showdownFixtures.S5);
assert.strictEqual(sd2.players.A.wtsd.semanticContribution, '0/1');
assert.strictEqual(sd2.players.B.wtsd.semanticContribution, '0/1');
assert.strictEqual(sd2.players.A.wsd.semanticContribution, '0/0');
assert.strictEqual(sd2.players.B.wsd.semanticContribution, '0/0');

var sd3 = showdownExplanation(showdownFixtures.S7);
assert.strictEqual(sd3.players.A.wtsd.semanticContribution, '1/1');
assert.strictEqual(sd3.players.B.wtsd.semanticContribution, '1/1');
assert.strictEqual(sd3.players.B.wsd.semanticContribution, '1/1');

var sd4 = showdownExplanation(showdownFixtures.S18);
assert.strictEqual(sd4.players.A.wtsd.semanticContribution, '1/1');
assert.strictEqual(sd4.players.A.wsd.semanticContribution, null);
assert.strictEqual(sd4.players.A.wsd.status, 'unsupported');
assert.strictEqual(sd4.players.A.wsd.reasonCode, 'incomplete_settlement');
assert.strictEqual(sd4.players.A.wsd.counterContribution, '0/0');

var sd5 = showdownExplanation(showdownFixtures.S9);
assert.strictEqual(sd5.players.A.wsd.semanticContribution, '1/1');
assert.strictEqual(sd5.players.B.wsd.semanticContribution, '1/1');
assert.strictEqual(sd5.players.A.wsd.reasonCode, 'positive_showdown_award');

var deepCBet = buildExplanation(flopFixtures.C7, { preflop: false, showdown: false });
assert.strictEqual(deepCBet.players.A.flopCBet.semanticContribution, '1/1');
assert.strictEqual(deepCBet.players.A.flopCBet.reasonCode, 'final_preflop_aggressor_bet_flop');

var muckedLoser = showdownExplanation(showdownFixtures.S4);
assert.strictEqual(muckedLoser.players.B.wtsd.semanticContribution, '1/1');
assert.strictEqual(muckedLoser.players.B.wtsd.reasonCode, 'supported_flop_entry_and_contested_showdown');
assert.strictEqual(muckedLoser.players.B.wsd.semanticContribution, '0/1');
assert.strictEqual(muckedLoser.players.B.wsd.reasonCode, 'complete_showdown_no_positive_award');

var state = explanation.createState({ maxHands: 2 });
assert.strictEqual(explanation.record(state, { semanticRecord: sidePotRecord, basicContributionsByPlayer: basicContributions(sidePotRecord) }).recorded, true);
assert.strictEqual(explanation.record(state, { semanticRecord: sidePotRecord, basicContributionsByPlayer: basicContributions(sidePotRecord) }).duplicate, true, 'duplicate finalized identity records once');
assert.strictEqual(explanation.record(state, { semanticRecord: showdownFixtures.S3, basicContributionsByPlayer: {} }).recorded, true);
assert.strictEqual(explanation.record(state, { semanticRecord: showdownFixtures.S9, basicContributionsByPlayer: {} }).recorded, true);
assert.strictEqual(explanation.list(state).length, 2, 'explanation history is FIFO bounded');
assert.strictEqual(explanation.latest(state).handId, showdownFixtures.S9.handIdentity.handId);
assert.strictEqual(explanation.get(state, showdownFixtures.S3.handIdentity.lifecycleHandId).handId, showdownFixtures.S3.handIdentity.handId);
assert.strictEqual(explanation.get(state, sidePotRecord.handIdentity.handId), null, 'oldest explanation is evicted');
assert.doesNotThrow(function () { JSON.stringify(explanation.list(state)); }, 'export is JSON-safe');
assert.strictEqual(JSON.stringify(explanation.list(state)).includes('cards'), false, 'explanations contain no card values');
assert.ok(explanation.summarize(sidePot).some(function (line) { return line.includes('PlayerA: FCB 0/1'); }));

console.log('Per-hand statistic explanations: PlayerC multiway, F3B squeeze, SD1-SD5, tri-state, IDs, bounds, dedupe, and JSON safety passed.');
