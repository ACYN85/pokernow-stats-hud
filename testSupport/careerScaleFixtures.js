'use strict';

/* Deterministic, player-rich Career records for bounded scale measurement. */
(function (root, factory) {
  var aggregator = root.PokerCareerStatsAggregator;
  if (typeof module !== 'undefined' && module.exports) aggregator = require('../careerStatsAggregator.js');
  var api = factory(aggregator);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerCareerScaleFixtures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Aggregator) {
  function decision(seed, offset) {
    var opportunity = (seed + offset) % 5 === 0 ? null : 1;
    return {
      opportunity: opportunity,
      result: opportunity === null ? null : ((seed + offset) % 3 === 0 ? 1 : 0),
      unsupportedReason: opportunity === null ? 'fixture_evidence_unsupported' : null
    };
  }
  function player(handIndex, seat) {
    var id = 'stable-player-' + String(seat + 1).padStart(2, '0');
    var decisions = {};
    ['threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd'].forEach(function (key, index) {
      decisions[key] = decision(handIndex + seat, index);
    });
    var counters = Object.assign(Aggregator.emptyCounters(), {
      hands: 1,
      vpipMade: (handIndex + seat) % 2,
      vpipOpportunities: 1,
      pfrMade: (handIndex + seat) % 3 === 0 ? 1 : 0,
      pfrOpportunities: 1,
      postflopAggressiveActions: (handIndex + seat) % 4,
      postflopCalls: (handIndex + seat) % 3
    });
    [['threeBetMade', 'threeBetOpportunities', 'threeBet'], ['foldToThreeBet', 'foldToThreeBetOpportunities', 'foldToThreeBet'], ['flopCBetMade', 'flopCBetOpportunities', 'flopCBet'], ['foldToFlopCBet', 'foldToFlopCBetOpportunities', 'foldToFlopCBet'], ['wtsdMade', 'wtsdOpportunities', 'wtsd'], ['wsdMade', 'wsdOpportunities', 'wsd']].forEach(function (fields) {
      var value = decisions[fields[2]];
      counters[fields[1]] = value.opportunity === 1 ? 1 : 0;
      counters[fields[0]] = value.result === 1 ? 1 : 0;
    });
    return {
      playerId: id,
      displayName: 'Representative Player ' + String(seat + 1),
      sourceContributionIds: {
        preflop: 'preflop:v2:' + id,
        flopCBet: 'flop-cbet:v1:' + id,
        showdown: 'showdown:v1:' + id
      },
      counters: counters,
      decisions: decisions,
      relational: {
        schemaVersion: 1,
        threeBetTargetPlayerId: null,
        foldToThreeBetAggressorPlayerId: null,
        flopCBetOpponentPlayerIds: [],
        foldToFlopCBetAggressorPlayerId: null
      },
      position: {
        schemaVersion: 1,
        status: 'supported',
        dealtPosition: ['BTN', 'SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO'][seat],
        dealtPlayerCount: 7,
        unsupportedReason: null
      }
    };
  }
  function record(handIndex, namespaceOffset, semanticPreflopVersion, supersedesFingerprint) {
    var absolute = Number(namespaceOffset || 0) + handIndex;
    var handId = 'scale-hand-' + String(absolute).padStart(10, '0');
    var value = {
      schemaVersion: Aggregator.RECORD_SCHEMA_VERSION,
      recordType: 'certified-career-hand',
      handKey: 'pokernow|pokernow.com|career-scale|' + handId,
      namespace: { provider: 'pokernow', host: 'pokernow.com', gameId: 'career-scale' },
      authoritativeHandId: handId,
      lifecycleHandIds: ['career-scale:socket:' + absolute.toString(36), 'career-scale:lifecycle:' + absolute.toString(36)],
      finalizedAt: 1800000000000 + absolute,
      semanticVersions: Object.assign({}, Aggregator.CURRENT_SEMANTIC_VERSIONS, { preflop: semanticPreflopVersion || 2 }),
      players: Array.from({ length: 7 }, function (_, seat) { return player(absolute, seat); }),
      supersedesFingerprint: supersedesFingerprint || null
    };
    value.fingerprint = Aggregator.fingerprint(value);
    return value;
  }
  function records(physicalRecordCount, namespaceOffset) {
    var count = Math.max(0, Math.floor(Number(physicalRecordCount) || 0));
    var result = [];
    var logicalIndex = 0;
    while (result.length < count) {
      var chain = logicalIndex > 0 && logicalIndex % 50 === 0 && result.length + 1 < count;
      if (chain) {
        var predecessor = record(logicalIndex, namespaceOffset, 1, null);
        result.push(predecessor);
        result.push(record(logicalIndex, namespaceOffset, 2, predecessor.fingerprint));
      } else {
        result.push(record(logicalIndex, namespaceOffset, 2, null));
      }
      logicalIndex += 1;
    }
    return result;
  }
  function metadata(values) {
    var first = values[0] || null;
    var last = values[values.length - 1] || null;
    return {
      careerTrackingStartedAt: first ? first.finalizedAt : 1800000000000,
      careerSchemaInitializedAt: first ? first.finalizedAt : 1800000000000,
      initializedByBuildId: 'career-scale-benchmark',
      firstAcceptedHandKey: first ? first.handKey : null,
      firstAcceptedAt: first ? first.finalizedAt : null,
      latestAcceptedAt: last ? last.finalizedAt : null
    };
  }
  function careerExport(values) {
    return {
      careerStorageSchemaVersion: Aggregator.STORAGE_SCHEMA_VERSION,
      recordSchemaVersion: Aggregator.RECORD_SCHEMA_VERSION,
      aggregateSchemaVersion: Aggregator.AGGREGATE_SCHEMA_VERSION,
      metadata: metadata(values),
      records: values
    };
  }
  return Object.freeze({ records: records, metadata: metadata, careerExport: careerExport });
});
