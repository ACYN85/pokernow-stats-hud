'use strict';

/* Specification fixtures for the isolated showdown reducer. They contain no raw traffic or personal data. */

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function player(playerId, sawFlop, reachedShowdown, folded, allIn) {
  return {
    playerId: playerId,
    seat: null,
    folded: folded,
    allIn: allIn === true ? true : null,
    sawFlop: sawFlop,
    reachedShowdown: reachedShowdown,
    awardTotal: null
  };
}

function action(sequence, playerId, street, type, extra) {
  return Object.assign({
    sequence: sequence,
    sourceSequence: sequence,
    playerId: playerId,
    street: street,
    type: type,
    confidence: 'proven'
  }, extra || {});
}

function singlePotSettlement(awards, options) {
  options = options || {};
  var normalizedAwards = (awards || []).map(function (award, index) {
    return Object.assign({ awardId: 'award-' + index, potId: null, boardIndex: null }, award);
  });
  var totals = {};
  normalizedAwards.forEach(function (award) {
    totals[award.playerId] = Number(totals[award.playerId] || 0) + award.amount;
  });
  return {
    status: 'known',
    awards: normalizedAwards,
    totalsByPlayer: totals,
    totalAwardAmount: options.totalAwardAmount === undefined ? normalizedAwards.reduce(function (sum, award) { return sum + award.amount; }, 0) : options.totalAwardAmount,
    chopped: options.chopped === undefined ? normalizedAwards.length > 1 : options.chopped,
    uncontested: options.uncontested === true,
    sidePotStatus: options.sidePotStatus === undefined ? false : options.sidePotStatus,
    finalStacks: clone(options.finalStacks || {}),
    refunds: clone(options.refunds || []),
    reconciliation: clone(options.reconciliation || {}),
    pots: clone(options.pots || [])
  };
}

function unresolvedSettlement() {
  return {
    status: 'unresolved', awards: [], totalsByPlayer: {}, totalAwardAmount: null,
    chopped: null, uncontested: null, sidePotStatus: null,
    finalStacks: {}, refunds: [], reconciliation: {}
  };
}

function record(id, options) {
  options = options || {};
  var players = options.players || [player('A', true, true, false), player('B', true, true, false)];
  var entrants = options.flopEntrants === undefined ? players.filter(function (value) { return value.sawFlop === true; }).map(function (value) { return value.playerId; }) : options.flopEntrants;
  var streets = {};
  if (entrants !== null) {
    streets.flop = { startedAtSequence: 10, completedBySequence: 20, entrants: clone(entrants), board: ['2c', '7d', 'Jh'], actionOrder: [] };
    streets.turn = { startedAtSequence: 20, completedBySequence: 30, entrants: clone(entrants), board: ['2c', '7d', 'Jh', 'Qs'], actionOrder: [] };
    streets.river = { startedAtSequence: 30, completedBySequence: 40, entrants: clone(entrants), board: ['2c', '7d', 'Jh', 'Qs', '4h'], actionOrder: [] };
  }
  var participants = options.showdownParticipants === undefined ? players.filter(function (value) { return value.reachedShowdown === true; }).map(function (value) { return value.playerId; }) : options.showdownParticipants;
  var showdownDetected = options.showdownDetected === undefined ? participants.length > 0 : options.showdownDetected;
  var settlement = options.settlement || singlePotSettlement([{ playerId: 'A', amount: 200 }]);
  return {
    fixtureSchemaVersion: 1,
    scenarioId: id,
    scenario: options.scenario || id,
    schemaVersion: 1,
    mode: 'production_shadow',
    status: 'finalized',
    handIdentity: {
      handId: options.handId || id + '-AUTH',
      lifecycleHandId: options.lifecycleHandId || id + '-LIFE',
      gameNumber: options.gameNumber || Number(id.slice(1)) || null
    },
    players: clone(players),
    actions: clone(options.actions || []),
    streets: streets,
    preflopRoles: {},
    automaticRunout: {
      detected: options.automaticRunout === true,
      allInSequence: options.automaticRunout === true ? 5 : null,
      revealSequence: options.automaticRunout === true ? 6 : null,
      streetTransitionSequences: entrants === null ? [] : [10, 20, 30],
      postflopActionCount: (options.actions || []).filter(function (value) { return value.street !== 'preflop'; }).length
    },
    showdown: {
      detected: showdownDetected,
      revealSequence: showdownDetected ? 40 : null,
      participants: clone(participants),
      winners: clone(options.showdownWinners || []),
      losers: clone(options.showdownLosers || []),
      evidence: showdownDetected ? { kind: options.showdownEvidenceKind || 'authoritative-finalized-membership', playerIds: clone(participants) } : null
    },
    settlement: clone(settlement),
    ambiguities: clone(options.ambiguities || []),
    provenance: {
      source: 'task-specified-showdown-semantic-fixture',
      finalizationReason: options.finalizationReason || 'authoritative fixture terminal',
      historyComplete: options.historyComplete !== false,
      recovered: options.recovered === true,
      terminalEvidence: settlement.status === 'known',
      fixtureScenario: id
    }
  };
}

var S1 = record('S1', {
  scenario: 'saw flop then folded turn',
  players: [player('A', true, false, false), player('B', true, false, true)],
  actions: [action(1, 'A', 'flop', 'bet'), action(2, 'B', 'flop', 'call'), action(3, 'B', 'turn', 'fold')],
  showdownDetected: false,
  showdownParticipants: [],
  settlement: singlePotSettlement([{ playerId: 'A', amount: 200 }], { uncontested: true, chopped: false })
});

var S2 = record('S2', {
  scenario: 'saw flop then folded river',
  players: [player('A', true, false, false), player('B', true, false, true)],
  actions: [action(1, 'A', 'flop', 'check'), action(2, 'B', 'flop', 'check'), action(3, 'B', 'river', 'fold')],
  showdownDetected: false,
  showdownParticipants: [],
  settlement: singlePotSettlement([{ playerId: 'A', amount: 200 }], { uncontested: true, chopped: false })
});

var S3 = record('S3', {
  scenario: 'heads-up showdown with a clear winner',
  actions: [action(1, 'A', 'river', 'check'), action(2, 'B', 'river', 'check')],
  showdownWinners: ['A'],
  showdownLosers: ['B'],
  settlement: singlePotSettlement([{ playerId: 'A', amount: 200 }], { chopped: false })
});

var S4 = record('S4', {
  scenario: 'losing participant mucks after explicit semantic showdown membership',
  actions: [action(1, 'A', 'river', 'check'), action(2, 'B', 'river', 'check')],
  showdownParticipants: ['A'],
  showdownWinners: ['A'],
  showdownLosers: [],
  showdownEvidenceKind: 'winner-visible-loser-membership-explicit',
  settlement: singlePotSettlement([{ playerId: 'A', amount: 200 }], { chopped: false })
});

var S5 = record('S5', {
  scenario: 'river bet causes final opponent to fold',
  players: [player('A', true, false, false), player('B', true, false, true)],
  actions: [action(1, 'A', 'river', 'bet'), action(2, 'B', 'river', 'fold')],
  showdownDetected: false,
  showdownParticipants: [],
  settlement: singlePotSettlement([{ playerId: 'A', amount: 200 }], { uncontested: true, chopped: false })
});

var S6 = record('S6', {
  scenario: 'check-through river showdown',
  actions: [action(1, 'A', 'river', 'check'), action(2, 'B', 'river', 'check')],
  showdownWinners: ['B'],
  showdownLosers: ['A'],
  settlement: singlePotSettlement([{ playerId: 'B', amount: 200 }], { chopped: false })
});

var S7 = record('S7', {
  scenario: 'preflop all-in automatic runout',
  players: [player('A', true, true, false, true), player('B', true, true, false, true)],
  actions: [action(1, 'A', 'preflop', 'raise', { isAllIn: true, isFullRaise: true }), action(2, 'B', 'preflop', 'call', { isAllIn: true })],
  automaticRunout: true,
  showdownWinners: ['B'],
  showdownLosers: ['A'],
  settlement: singlePotSettlement([{ playerId: 'B', amount: 400 }], { chopped: false })
});

var S8 = record('S8', {
  scenario: 'flop all-in followed by automatic runout',
  players: [player('A', true, true, false, true), player('B', true, true, false, true)],
  actions: [action(1, 'A', 'flop', 'bet', { isAllIn: true }), action(2, 'B', 'flop', 'call', { isAllIn: true })],
  automaticRunout: true,
  showdownWinners: ['A'],
  showdownLosers: ['B'],
  settlement: singlePotSettlement([{ playerId: 'A', amount: 400 }], { chopped: false })
});

var S9 = record('S9', {
  scenario: 'equal split of one explicitly supported pot',
  showdownWinners: ['A', 'B'],
  settlement: singlePotSettlement([{ playerId: 'A', amount: 100 }, { playerId: 'B', amount: 100 }], { chopped: true })
});

var S10 = record('S10', {
  scenario: 'three-way showdown with one winner',
  players: [player('A', true, true, false), player('B', true, true, false), player('C', true, true, false)],
  showdownParticipants: ['A', 'B', 'C'],
  showdownWinners: ['A'],
  showdownLosers: ['B', 'C'],
  settlement: singlePotSettlement([{ playerId: 'A', amount: 300 }], { chopped: false })
});

function sidePotSettlement(mainAmount, sideAmount) {
  return singlePotSettlement([
    { awardId: 'main-award', playerId: 'A', amount: mainAmount, potId: 'main' },
    { awardId: 'side-award', playerId: 'B', amount: sideAmount, potId: 'side' }
  ], {
    sidePotStatus: true,
    chopped: true,
    pots: [
      { potId: 'main', amount: mainAmount, eligiblePlayerIds: ['A', 'B', 'C'], awards: [{ playerId: 'A', amount: mainAmount }] },
      { potId: 'side', amount: sideAmount, eligiblePlayerIds: ['B', 'C'], awards: [{ playerId: 'B', amount: sideAmount }] }
    ]
  });
}

var sidePotPlayers = [player('A', true, true, false), player('B', true, true, false), player('C', true, true, false)];
var S11 = record('S11', {
  scenario: 'different main-pot and side-pot winners',
  players: sidePotPlayers,
  showdownParticipants: ['A', 'B', 'C'],
  settlement: sidePotSettlement(300, 200)
});

var S12 = record('S12', {
  scenario: 'player wins side pot after losing main pot',
  players: sidePotPlayers,
  showdownParticipants: ['A', 'B', 'C'],
  settlement: sidePotSettlement(450, 150)
});

var S13 = record('S13', {
  scenario: 'unequal multiway split preserving actual shares',
  players: [player('A', true, true, false), player('B', true, true, false), player('C', true, true, false)],
  showdownParticipants: ['A', 'B', 'C'],
  settlement: singlePotSettlement([{ playerId: 'A', amount: 101 }, { playerId: 'B', amount: 100 }, { playerId: 'C', amount: 100 }], { chopped: true })
});

var S14 = record('S14', {
  scenario: 'uncalled return is separate from showdown award',
  settlement: singlePotSettlement([{ playerId: 'A', amount: 400 }], {
    chopped: false,
    refunds: [{ playerId: 'A', amount: 50, explicit: true, kind: 'uncalled_return' }],
    reconciliation: {
      A: { startingStack: 500, committed: 250, award: 400, refund: 50, endingStack: 700, reconciled: true },
      B: { startingStack: 500, committed: 200, award: 0, refund: 0, endingStack: 300, reconciled: true }
    }
  })
});

var S15 = record('S15', {
  scenario: 'uncontested hand before flop',
  players: [player('A', false, false, false), player('B', false, false, true)],
  flopEntrants: null,
  actions: [action(1, 'B', 'preflop', 'fold')],
  showdownDetected: false,
  showdownParticipants: [],
  settlement: singlePotSettlement([{ playerId: 'A', amount: 30 }], { uncontested: true, chopped: false })
});

var S16 = record('S16', {
  scenario: 'player folds on flop',
  players: [player('A', true, false, false), player('B', true, false, true)],
  actions: [action(1, 'A', 'flop', 'bet'), action(2, 'B', 'flop', 'fold')],
  showdownDetected: false,
  showdownParticipants: [],
  settlement: singlePotSettlement([{ playerId: 'A', amount: 100 }], { uncontested: true, chopped: false })
});

var S17 = record('S17', {
  scenario: 'incomplete showdown ordering',
  actions: [action(2, 'A', 'river', 'check'), action(2, 'B', 'river', 'check')]
});

var S18 = record('S18', {
  scenario: 'showdown membership supported but settlement missing',
  actions: [action(1, 'A', 'river', 'check'), action(2, 'B', 'river', 'check')],
  settlement: unresolvedSettlement()
});

var duplicateSettlement = singlePotSettlement([{ awardId: 'dup-award', playerId: 'A', amount: 200 }], { chopped: false, totalAwardAmount: 200 });
duplicateSettlement.awards.push(clone(duplicateSettlement.awards[0]));
var S19 = record('S19', {
  scenario: 'exact duplicate settlement award record',
  settlement: duplicateSettlement
});

var S20 = record('S20', {
  scenario: 'distinct lifecycle and authoritative hand identities',
  handId: 'S20-AUTHORITATIVE-HAND',
  lifecycleHandId: 'S20-LIFECYCLE-HAND',
  settlement: singlePotSettlement([{ playerId: 'B', amount: 200 }], { chopped: false })
});

module.exports = Object.freeze({
  S1: S1, S2: S2, S3: S3, S4: S4, S5: S5,
  S6: S6, S7: S7, S8: S8, S9: S9, S10: S10,
  S11: S11, S12: S12, S13: S13, S14: S14, S15: S15,
  S16: S16, S17: S17, S18: S18, S19: S19, S20: S20
});
