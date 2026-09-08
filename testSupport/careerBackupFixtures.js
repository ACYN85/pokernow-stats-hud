'use strict';

var aggregator = require('../careerStatsAggregator.js');

function decision(opportunity, result, reason) {
  return { opportunity: opportunity, result: result, unsupportedReason: reason === undefined ? (opportunity === null || result === null ? 'fixture_evidence_unsupported' : null) : reason };
}
function player(playerId, displayName, counters, decisions) {
  var exact = Object.assign(aggregator.emptyCounters(), { hands: 1, vpipOpportunities: 1, pfrOpportunities: 1 }, counters || {});
  var unsupported = decision(null, null);
  return {
    playerId: String(playerId),
    displayName: String(displayName),
    sourceContributionIds: { preflop: 'preflop:' + playerId, flopCBet: 'flop:' + playerId, showdown: 'showdown:' + playerId },
    counters: exact,
    decisions: Object.assign({ threeBet: unsupported, foldToThreeBet: unsupported, flopCBet: unsupported, foldToFlopCBet: unsupported, wtsd: unsupported, wsd: unsupported }, decisions || {}),
    relational: { schemaVersion: 1, threeBetTargetPlayerId: null, foldToThreeBetAggressorPlayerId: null, flopCBetOpponentPlayerIds: [], foldToFlopCBetAggressorPlayerId: null },
    position: { schemaVersion: 1, status: 'unsupported', dealtPosition: null, dealtPlayerCount: null, unsupportedReason: 'fixture position unavailable' }
  };
}
function record(gameId, handId, players, options) {
  options = options || {};
  var value = {
    schemaVersion: aggregator.RECORD_SCHEMA_VERSION,
    recordType: 'certified-career-hand',
    handKey: ['pokernow', 'pokernow.com', gameId, handId].join('|'),
    namespace: { provider: 'pokernow', host: 'pokernow.com', gameId: gameId },
    authoritativeHandId: handId,
    lifecycleHandIds: ['lifecycle:' + handId],
    finalizedAt: options.finalizedAt || 1000,
    semanticVersions: Object.assign({}, aggregator.CURRENT_SEMANTIC_VERSIONS, options.semanticVersions || {}),
    players: players,
    supersedesFingerprint: options.supersedesFingerprint || null
  };
  value.fingerprint = aggregator.fingerprint(value);
  return value;
}
function complexRecords() {
  var records = [];
  records.push(record('TABLE-A', 'BB-WALK', [
    player('stable-alice', 'Alice', { vpipOpportunities: 1, pfrOpportunities: 1 }),
    player('stable-bob', 'Bob', { vpipOpportunities: 1, pfrOpportunities: 1 })
  ], { finalizedAt: 1001 }));
  records.push(record('TABLE-A', 'AF-INFINITY-AND-UNSUPPORTED', [
    player('stable-alice', 'Alicia', { vpipMade: 1, postflopAggressiveActions: 3, postflopCalls: 0 }, { flopCBet: decision(null, null, 'board_evidence_incomplete') }),
    player('stable-name-duplicate-1', 'Alex', { vpipMade: 1 })
  ], { finalizedAt: 1002 }));
  records.push(record('TABLE-B', 'MULTIWAY-F3B', [
    player('stable-alice', 'Alicia', { vpipMade: 1, pfrMade: 1, foldToThreeBet: 1, foldToThreeBetOpportunities: 1 }, { foldToThreeBet: decision(1, 1, null) }),
    player('stable-bob', 'Bob', { vpipMade: 1, threeBetMade: 1, threeBetOpportunities: 1 }, { threeBet: decision(1, 1, null) }),
    player('stable-name-duplicate-2', 'Alex', { vpipMade: 1 })
  ], { finalizedAt: 1003 }));
  records.push(record('TABLE-B', 'DEEP-CBET-FCB', [
    player('stable-alice', 'Alicia', { vpipMade: 1, pfrMade: 1, flopCBetMade: 1, flopCBetOpportunities: 1 }, { flopCBet: decision(1, 1, null) }),
    player('stable-bob', 'Bob', { vpipMade: 1, foldToFlopCBet: 1, foldToFlopCBetOpportunities: 1 }, { foldToFlopCBet: decision(1, 1, null) })
  ], { finalizedAt: 1004 }));
  records.push(record('TABLE-A', 'MUCKED-SHOWDOWN', [
    player('stable-alice', 'Alicia', { vpipMade: 1, wtsdMade: 1, wtsdOpportunities: 1, wsdMade: 1, wsdOpportunities: 1 }, { wtsd: decision(1, 1, null), wsd: decision(1, 1, null) }),
    player('stable-bob', 'Bob', { vpipMade: 1, wtsdMade: 1, wtsdOpportunities: 1, wsdOpportunities: 1 }, { wtsd: decision(1, 1, null), wsd: decision(1, 0, null) })
  ], { finalizedAt: 1005 }));
  records.push(record('TABLE-A', 'CHOP', [
    player('stable-alice', 'Alicia', { vpipMade: 1, wtsdMade: 1, wtsdOpportunities: 1, wsdMade: 1, wsdOpportunities: 1 }, { wtsd: decision(1, 1, null), wsd: decision(1, 1, null) }),
    player('stable-bob', 'Bob', { vpipMade: 1, wtsdMade: 1, wtsdOpportunities: 1, wsdMade: 1, wsdOpportunities: 1 }, { wtsd: decision(1, 1, null), wsd: decision(1, 1, null) })
  ], { finalizedAt: 1006 }));
  records.push(record('TABLE-C', 'SIDE-POT-REFUND', [
    player('stable-alice', 'Alicia', { vpipMade: 1, pfrMade: 1 }),
    player('stable-bob', 'Bob', { vpipMade: 1 }),
    player('stable-name-duplicate-2', 'Alex', { vpipMade: 1 })
  ], { finalizedAt: 1007 }));
  var correctionA = record('TABLE-A', 'CORRECTION-CHAIN', [player('stable-alice', 'Alice', { vpipMade: 1 }), player('stable-bob', 'Bob', { vpipMade: 1 })], { finalizedAt: 1008, semanticVersions: { preflop: 1 } });
  var correctionB = record('TABLE-A', 'CORRECTION-CHAIN', [player('stable-alice', 'Alicia', { vpipMade: 1, pfrMade: 1 }), player('stable-bob', 'Bob', { vpipMade: 1 })], { finalizedAt: 1008, semanticVersions: { preflop: 2 }, supersedesFingerprint: correctionA.fingerprint });
  var correctionC = record('TABLE-A', 'CORRECTION-CHAIN', [player('stable-alice', 'Alicia', { vpipMade: 1, pfrMade: 1 }), player('stable-bob', 'Bob', { vpipMade: 1, foldToThreeBet: 1, foldToThreeBetOpportunities: 1 }, { foldToThreeBet: decision(1, 1, null) })], { finalizedAt: 1008, semanticVersions: { preflop: 3 }, supersedesFingerprint: correctionB.fingerprint });
  return records.concat([correctionA, correctionB, correctionC]);
}

module.exports = Object.freeze({ decision: decision, player: player, record: record, complexRecords: complexRecords });
