'use strict';

function action(sequence, street, playerId, type, details) {
  return Object.assign({
    sequence: sequence,
    sourceSequence: sequence,
    street: street,
    playerId: playerId,
    type: type,
    confidence: 'authoritative_synthetic_reducer_fixture',
    isAllIn: null,
    isFullRaise: null,
    isShortAllInRaise: null
  }, details || {});
}

function player(playerId, details) {
  return Object.assign({
    playerId: playerId,
    seat: null,
    startingStack: 1000,
    endingStack: null,
    folded: null,
    allIn: null,
    sawFlop: true,
    reachedShowdown: null,
    awardTotal: null
  }, details || {});
}

function record(id, options) {
  options = options || {};
  var actions = options.actions || [];
  var entrants = options.entrants || [];
  var flopActions = actions.filter(function (item) { return item.street === 'flop'; });
  var firstBet = flopActions.find(function (item) { return item.type === 'bet' || item.type === 'raise'; }) || null;
  return {
    schemaVersion: 1,
    mode: 'production_shadow',
    status: 'finalized',
    handIdentity: { handId: id, lifecycleHandId: 'lifecycle-' + id },
    players: options.players,
    actions: actions,
    streets: {
      preflop: {
        entrants: options.players.map(function (item) { return item.playerId; }),
        actionOrder: actions.filter(function (item) { return item.street === 'preflop'; }).map(function (item) { return item.playerId; })
      },
      flop: {
        startedAtSequence: 100,
        completedBySequence: 200,
        board: ['As', '7h', '2c'],
        potAtStart: 100,
        entrants: entrants,
        firstActor: options.firstActor === undefined ? (flopActions[0] ? flopActions[0].playerId : null) : options.firstActor,
        actionOrder: options.actionOrder || flopActions.map(function (item) { return item.playerId; }),
        firstBettor: options.firstBettor === undefined ? (firstBet ? firstBet.playerId : null) : options.firstBettor,
        checksBeforeFirstBet: options.checksBeforeFirstBet || (firstBet
          ? flopActions.filter(function (item) { return item.sequence < firstBet.sequence && item.type === 'check'; }).map(function (item) { return item.playerId; })
          : flopActions.filter(function (item) { return item.type === 'check'; }).map(function (item) { return item.playerId; }))
      }
    },
    preflopRoles: {
      openingAggressor: options.openingAggressor,
      finalAggressor: options.finalAggressor
    },
    automaticRunout: {
      detected: options.automaticRunout === true ? true : false,
      postflopActionCount: flopActions.length
    },
    settlement: {
      status: 'known',
      sidePotStatus: options.sidePotStatus === undefined ? null : options.sidePotStatus
    },
    ambiguities: options.ambiguities || [],
    provenance: {
      source: 'synthetic-cbet-reducer-fixture',
      fixtureScenarioId: id,
      finalizationReason: 'synthetic C1-C11 reducer fixture',
      historyComplete: options.historyComplete === undefined ? true : options.historyComplete,
      recovered: options.recovered === true
    }
  };
}

function headsUpPreflop(aggressorId, callerId) {
  return [
    action(1, 'preflop', aggressorId, 'raise', { isFullRaise: true }),
    action(2, 'preflop', callerId, 'call')
  ];
}

var C1 = record('C1', {
  players: [player('A'), player('B', { folded: true })],
  entrants: ['A', 'B'],
  openingAggressor: 'A',
  finalAggressor: 'A',
  actions: headsUpPreflop('A', 'B').concat([
    action(3, 'flop', 'B', 'check'),
    action(4, 'flop', 'A', 'bet'),
    action(5, 'flop', 'B', 'fold')
  ])
});

var C2 = record('C2', {
  players: [player('A'), player('B')],
  entrants: ['A', 'B'],
  openingAggressor: 'A',
  finalAggressor: 'A',
  actions: headsUpPreflop('A', 'B').concat([
    action(3, 'flop', 'B', 'check'),
    action(4, 'flop', 'A', 'bet'),
    action(5, 'flop', 'B', 'call')
  ])
});

var C3 = record('C3', {
  players: [player('A'), player('B')],
  entrants: ['A', 'B'],
  openingAggressor: 'A',
  finalAggressor: 'A',
  actions: headsUpPreflop('A', 'B').concat([
    action(3, 'flop', 'B', 'check'),
    action(4, 'flop', 'A', 'check')
  ])
});

var C4 = record('C4', {
  players: [player('A'), player('B')],
  entrants: ['A', 'B'],
  openingAggressor: 'A',
  finalAggressor: 'A',
  actions: headsUpPreflop('A', 'B').concat([
    action(3, 'flop', 'B', 'bet'),
    action(4, 'flop', 'A', 'fold')
  ])
});

var C5 = record('C5', {
  players: [player('A'), player('B', { folded: true }), player('C')],
  entrants: ['A', 'B', 'C'],
  openingAggressor: 'A',
  finalAggressor: 'A',
  actions: [
    action(1, 'preflop', 'A', 'raise', { isFullRaise: true }),
    action(2, 'preflop', 'B', 'call'),
    action(3, 'preflop', 'C', 'call'),
    action(4, 'flop', 'B', 'check'),
    action(5, 'flop', 'C', 'check'),
    action(6, 'flop', 'A', 'bet'),
    action(7, 'flop', 'B', 'fold'),
    action(8, 'flop', 'C', 'call')
  ]
});

var C6 = record('C6', {
  players: [player('A'), player('B')],
  entrants: ['A', 'B'],
  openingAggressor: 'A',
  finalAggressor: 'B',
  actions: [
    action(1, 'preflop', 'A', 'raise', { isFullRaise: true }),
    action(2, 'preflop', 'B', 'raise', { isFullRaise: true }),
    action(3, 'preflop', 'A', 'call'),
    action(4, 'flop', 'A', 'check'),
    action(5, 'flop', 'B', 'bet')
  ]
});

var C7 = record('C7', {
  players: [player('A'), player('B')],
  entrants: ['A', 'B'],
  openingAggressor: 'A',
  finalAggressor: 'A',
  actions: [
    action(1, 'preflop', 'A', 'raise', { isFullRaise: true }),
    action(2, 'preflop', 'B', 'raise', { isFullRaise: true }),
    action(3, 'preflop', 'A', 'raise', { isFullRaise: true }),
    action(4, 'preflop', 'B', 'call'),
    action(5, 'flop', 'B', 'check'),
    action(6, 'flop', 'A', 'bet')
  ]
});

var C8 = record('C8', {
  players: [player('A', { allIn: true }), player('B', { allIn: true })],
  entrants: ['A', 'B'],
  openingAggressor: 'A',
  finalAggressor: 'A',
  automaticRunout: true,
  firstActor: null,
  actionOrder: [],
  firstBettor: null,
  actions: [
    action(1, 'preflop', 'A', 'raise', { isFullRaise: true, isAllIn: true }),
    action(2, 'preflop', 'B', 'call', { isAllIn: true })
  ]
});

var C9 = record('C9', {
  players: [player('A'), player('B'), player('C', { allIn: true })],
  entrants: ['A', 'B', 'C'],
  openingAggressor: 'A',
  finalAggressor: 'A',
  sidePotStatus: null,
  actions: [
    action(1, 'preflop', 'A', 'raise', { isFullRaise: true }),
    action(2, 'preflop', 'B', 'call'),
    action(3, 'preflop', 'C', 'raise', { isFullRaise: false, isShortAllInRaise: true, isAllIn: true }),
    action(4, 'preflop', 'A', 'call'),
    action(5, 'preflop', 'B', 'call'),
    action(6, 'flop', 'B', 'check'),
    action(7, 'flop', 'A', 'bet'),
    action(8, 'flop', 'B', 'call')
  ]
});

var C10 = record('C10', {
  players: [player('A'), player('B'), player('C', { allIn: true })],
  entrants: ['A', 'B', 'C'],
  openingAggressor: 'A',
  finalAggressor: 'A',
  actions: [
    action(1, 'preflop', 'A', 'raise', { isFullRaise: true }),
    action(2, 'preflop', 'B', 'call'),
    action(3, 'preflop', 'C', 'partial_call', { isAllIn: true }),
    action(4, 'flop', 'B', 'check'),
    action(5, 'flop', 'A', 'bet'),
    action(6, 'flop', 'B', 'call')
  ]
});

var C11 = record('C11', {
  players: [player('A'), player('B')],
  entrants: ['A', 'B'],
  openingAggressor: 'A',
  finalAggressor: 'A',
  firstActor: null,
  actionOrder: ['A', 'B'],
  actions: headsUpPreflop('A', 'B').concat([
    action(3, 'flop', 'B', 'check'),
    action(4, 'flop', 'A', 'bet')
  ])
});

module.exports = Object.freeze({
  action: action,
  player: player,
  record: record,
  C1: C1,
  C2: C2,
  C3: C3,
  C4: C4,
  C5: C5,
  C6: C6,
  C7: C7,
  C8: C8,
  C9: C9,
  C10: C10,
  C11: C11
});
