/* Immutable certified hand bundles plus Chrome-storage serialization helpers. */
(function (root, factory) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;
  var stats = root.PokerStats;
  var aggregator = root.PokerCareerStatsAggregator;
  var positionResolver = root.PokerPositionResolver;
  if (typeof module !== 'undefined' && module.exports) {
    stats = require('./stats.js');
    aggregator = require('./careerStatsAggregator.js');
    positionResolver = require('./positionResolver.js');
  }
  var api = factory(stats, aggregator, positionResolver);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerCareerContributionStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PokerStats, Aggregator, PositionResolver) {
  'use strict';

  /* Legacy Phase 1 chrome.storage.local schema; retained read-only for structural migration. */
  var STORAGE_SCHEMA_VERSION = 1;
  var META_KEY = 'pokerNowHudCareerV1:meta';
  var CACHE_KEY = 'pokerNowHudCareerV1:aggregateCache';
  var RECORD_PREFIX = 'pokerNowHudCareerV1:record:';
  var RECENT_LIMIT = 20;

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function object(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
  function uniqueStrings(values) {
    return Array.from(new Set((values || []).filter(function (value) { return value !== null && value !== undefined && String(value); }).map(String)));
  }
  function namespace(input) {
    var host = String(input && input.host || '').toLowerCase();
    var gameId = String(input && input.gameId || '');
    if (!host || !gameId) throw new TypeError('PokerNow host and game ID are required');
    return Object.freeze({ provider: 'pokernow', host: host, gameId: gameId });
  }
  function handKey(gameNamespace, authoritativeHandId) {
    var ns = namespace(gameNamespace);
    var handId = String(authoritativeHandId || '');
    if (!handId) throw new TypeError('authoritative PokerNow hI is required');
    return ['pokernow', ns.host, ns.gameId, handId].join('|');
  }
  function storageRecordKey(key, fingerprint) { return RECORD_PREFIX + encodeURIComponent(String(key)) + ':' + encodeURIComponent(String(fingerprint || 'unversioned')); }
  function isSyntheticHandId(value, gameId) {
    value = String(value || '');
    return !value || value.indexOf(String(gameId || '') + ':socket:') === 0 || value.indexOf(':socket:') >= 0;
  }
  function decision(opportunity, result, reason) {
    var unsupported = opportunity === null || result === null;
    return {
      opportunity: opportunity === true ? 1 : opportunity === false ? 0 : null,
      result: opportunity === true ? result === true ? 1 : result === false ? 0 : null : opportunity === false ? 0 : null,
      unsupportedReason: unsupported ? reason || 'semantic_evidence_insufficient' : null
    };
  }
  function playerDecision(source, madeField, reasonField) {
    if (!source) return decision(null, null, 'certified_reducer_contribution_missing');
    return decision(source.opportunity, source[madeField], source[reasonField || 'reason']);
  }
  function showdownDecisions(source) {
    if (!source) return {
      wtsd: decision(null, null, 'certified_showdown_contribution_missing'),
      wsd: decision(null, null, 'certified_showdown_contribution_missing')
    };
    var wtsdOpportunity = source.sawFlopForWTSD === null ? null : source.sawFlopForWTSD === 1;
    var wtsdResult = wtsdOpportunity === true ? source.wentToShowdown === null ? null : source.wentToShowdown === 1 : false;
    var wsdOpportunity = source.wentToShowdown === null ? null : source.wentToShowdown === 1;
    var wsdResult = wsdOpportunity === true
      ? source.wonMoneyAtShowdownCandidateSupported === true ? source.wonMoneyAtShowdownCandidate === 1 : null
      : wsdOpportunity === false ? false : null;
    return {
      wtsd: decision(wtsdOpportunity, wtsdResult, source.unsupportedReason || null),
      wsd: decision(wsdOpportunity, wsdResult, source.wonMoneyAtShowdownCandidateReason || source.unsupportedReason || null)
    };
  }
  function eventAliases(event) {
    return uniqueStrings([event && event.handId, event && event.authoritativeHandId, event && event.lifecycleHandId]);
  }
  function matchingEvents(events, aliases) {
    var wanted = new Set(aliases);
    return (events || []).filter(function (event) { return eventAliases(event).some(function (id) { return wanted.has(id); }); });
  }
  function eventName(events, playerId, fallback) {
    var match = (events || []).slice().reverse().find(function (event) { return event && String(event.playerId || '') === String(playerId) && event.player; });
    return match ? String(match.player) : String(fallback || '');
  }
  function contributionId(events, playerId, field) {
    var match = (events || []).find(function (event) { return event && String(event.playerId || '') === String(playerId) && event[field]; });
    return match ? String(match[field]) : null;
  }

  function buildCertifiedHandRecord(input) {
    input = input || {};
    var semanticRecord = input.semanticRecord;
    if (!object(semanticRecord) || semanticRecord.status !== 'finalized') throw new TypeError('finalized semantic record is required');
    var ns = namespace(input.namespace);
    var identity = semanticRecord.handIdentity || {};
    var authoritativeHandId = String(input.authoritativeHandId || identity.handId || '');
    if (isSyntheticHandId(authoritativeHandId, ns.gameId)) throw new TypeError('career persistence requires authoritative PokerNow hI; synthetic lifecycle identity was rejected');
    var aliases = uniqueStrings([authoritativeHandId, identity.handId, identity.lifecycleHandId].concat(input.lifecycleHandIds || []));
    var events = matchingEvents(input.finalizedEvents || [], aliases);
    var playerIds = uniqueStrings((semanticRecord.players || []).map(function (player) { return player && player.playerId; }).concat(events.map(function (event) { return event && event.playerId; })));
    if (!playerIds.length) throw new TypeError('certified finalized players are required');
    var preflop = input.preflopContribution && input.preflopContribution.players || {};
    var flop = input.flopCBetContribution && input.flopCBetContribution.players || {};
    var showdown = input.showdownContribution && input.showdownContribution.players || {};
    var preflopHand = input.preflopContribution && input.preflopContribution.hand || {};
    var flopHand = input.flopCBetContribution && input.flopCBetContribution.hand || {};
    var flopEntrants = uniqueStrings(semanticRecord.streets && semanticRecord.streets.flop && semanticRecord.streets.flop.entrants || []);
    var semanticPlayers = new Map((semanticRecord.players || []).map(function (player) { return [String(player.playerId), player]; }));
    var players = playerIds.map(function (playerId) {
      var displayName = eventName(events, playerId, semanticPlayers.get(playerId) && semanticPlayers.get(playerId).displayName);
      var computed = PokerStats.computePlayerStatsByIdentity(events, playerId, displayName);
      var exact = PokerStats.authoritativeCounterSnapshot(computed);
      var preflopId = contributionId(events, playerId, 'preflopOpportunityContributionId');
      var flopId = contributionId(events, playerId, 'flopCBetContributionId');
      var showdownId = contributionId(events, playerId, 'showdownStatsContributionId');
      var showdownValues = showdownDecisions(showdown[playerId]);
      return {
        playerId: String(playerId),
        displayName: displayName,
        position: PositionResolver.playerPosition(semanticRecord.positionProvenance, playerId),
        sourceContributionIds: { preflop: preflopId, flopCBet: flopId, showdown: showdownId },
        counters: {
          hands: exact.handsPlayed,
          vpipMade: exact.vpipHands,
          vpipOpportunities: exact.vpipOpportunities,
          pfrMade: exact.pfrHands,
          pfrOpportunities: exact.pfrOpportunities,
          postflopAggressiveActions: Number(computed.afDetails && computed.afDetails.bets || 0) + Number(computed.afDetails && computed.afDetails.raises || 0),
          postflopCalls: Number(computed.afDetails && computed.afDetails.calls || 0),
          threeBetMade: exact.threeBetMade,
          threeBetOpportunities: exact.threeBetOpportunities,
          foldToThreeBet: exact.foldToThreeBet,
          foldToThreeBetOpportunities: exact.foldToThreeBetOpportunities,
          flopCBetMade: exact.flopCBetMade,
          flopCBetOpportunities: exact.flopCBetOpportunities,
          foldToFlopCBet: exact.foldToFlopCBet,
          foldToFlopCBetOpportunities: exact.foldToFlopCBetOpportunities,
          wtsdMade: exact.wentToShowdown,
          wtsdOpportunities: exact.sawFlopForWTSD,
          wsdMade: exact.wonMoneyAtShowdown,
          wsdOpportunities: exact.showdownsForWSD
        },
        decisions: {
          threeBet: playerDecision(preflop[playerId] && preflop[playerId].threeBet, 'made', 'reason'),
          foldToThreeBet: playerDecision(preflop[playerId] && preflop[playerId].foldToThreeBet, 'folded', 'reason'),
          flopCBet: playerDecision(flop[playerId] && flop[playerId].flopCBet, 'made', 'reason'),
          foldToFlopCBet: playerDecision(flop[playerId] && flop[playerId].foldToFlopCBetDecision, 'folded', 'reason'),
          wtsd: showdownValues.wtsd,
          wsd: showdownValues.wsd
        },
        relational: {
          schemaVersion: 1,
          threeBetTargetPlayerId: preflop[playerId] && preflop[playerId].threeBet && preflop[playerId].threeBet.opportunity === true ? String(preflopHand.openRaiser || '') || null : null,
          foldToThreeBetAggressorPlayerId: preflop[playerId] && preflop[playerId].foldToThreeBet && preflop[playerId].foldToThreeBet.opportunity === true ? String(preflopHand.threeBettor || '') || null : null,
          flopCBetOpponentPlayerIds: flop[playerId] && flop[playerId].flopCBet && flop[playerId].flopCBet.opportunity === true ? flopEntrants.filter(function (id) { return String(id) !== String(playerId); }) : [],
          foldToFlopCBetAggressorPlayerId: flop[playerId] && flop[playerId].foldToFlopCBetDecision && flop[playerId].foldToFlopCBetDecision.opportunity === true ? String(flopHand.cBettor || '') || null : null
        }
      };
    });
    var record = {
      schemaVersion: Aggregator.RECORD_SCHEMA_VERSION,
      recordType: 'certified-career-hand',
      handKey: handKey(ns, authoritativeHandId),
      namespace: ns,
      authoritativeHandId: authoritativeHandId,
      lifecycleHandIds: uniqueStrings(aliases.filter(function (alias) { return alias !== authoritativeHandId; })),
      finalizedAt: Number(semanticRecord.provenance && semanticRecord.provenance.finalizedAt || input.finalizedAt || Date.now()),
      semanticVersions: {
        core: Aggregator.CURRENT_SEMANTIC_VERSIONS.core,
        preflop: Number(input.preflopContribution && input.preflopContribution.reducerVersion || Aggregator.CURRENT_SEMANTIC_VERSIONS.preflop),
        flopCBet: Number(input.flopCBetContribution && input.flopCBetContribution.reducerVersion || Aggregator.CURRENT_SEMANTIC_VERSIONS.flopCBet),
        showdown: Number(input.showdownContribution && input.showdownContribution.reducerVersion || Aggregator.CURRENT_SEMANTIC_VERSIONS.showdown),
        sourceLedger: Number(semanticRecord.schemaVersion || Aggregator.CURRENT_SEMANTIC_VERSIONS.sourceLedger)
      },
      players: players,
      supersedesFingerprint: null
    };
    record.fingerprint = Aggregator.fingerprint(record);
    var validationError = Aggregator.validateRecord(record);
    if (validationError) throw new TypeError(validationError);
    return record;
  }

  function initialMeta(options) {
    options = options || {};
    var initializedAt = Number(options.initializedAt || Date.now());
    return {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      careerTrackingStartedAt: initializedAt,
      careerSchemaInitializedAt: initializedAt,
      initializedByBuildId: String(options.buildId || ''),
      firstAcceptedHandKey: null,
      firstAcceptedAt: null,
      acceptedRecordCount: 0,
      latestAcceptedAt: null,
      storageBackend: 'chrome.storage.local-immutable-items',
      aggregateCacheDerivable: true
    };
  }
  function recordValues(saved) {
    return Object.keys(saved || {}).filter(function (key) { return key.indexOf(RECORD_PREFIX) === 0; }).sort().map(function (key) { return saved[key]; });
  }
  function createState(saved, options) {
    saved = saved || {};
    options = options || {};
    var records = recordValues(saved);
    var aggregateState = Aggregator.createState(records);
    var meta = object(saved[META_KEY]) && saved[META_KEY].schemaVersion === STORAGE_SCHEMA_VERSION ? clone(saved[META_KEY]) : initialMeta(options);
    if (records.length && !meta.firstAcceptedHandKey) {
      var earliest = Aggregator.records(aggregateState).sort(function (left, right) { return left.finalizedAt - right.finalizedAt; })[0];
      meta.firstAcceptedHandKey = earliest && earliest.handKey || null;
      meta.firstAcceptedAt = earliest && earliest.finalizedAt || null;
    }
    meta.acceptedRecordCount = aggregateState.aggregate.ledgerRecordCount;
    return {
      aggregateState: aggregateState,
      meta: meta,
      initializedNow: !object(saved[META_KEY]),
      storageRejectedRecords: aggregateState.rejectedRecords.slice(),
      recent: Aggregator.records(aggregateState).sort(function (left, right) { return right.finalizedAt - left.finalizedAt; }).slice(0, RECENT_LIMIT)
    };
  }
  function cacheSnapshot(state) {
    return {
      schemaVersion: Aggregator.AGGREGATE_SCHEMA_VERSION,
      ledgerRecordCount: state.aggregateState.aggregate.ledgerRecordCount,
      exactAggregate: Aggregator.exactAggregate(state.aggregateState),
      rebuiltAt: Date.now()
    };
  }
  function initializationUpdate(state) {
    var update = {};
    update[META_KEY] = clone(state.meta);
    update[CACHE_KEY] = cacheSnapshot(state);
    return update;
  }
  function append(state, record) {
    var result = Aggregator.append(state.aggregateState, record);
    if (!result.accepted) return result;
    if (!state.meta.firstAcceptedHandKey) {
      state.meta.firstAcceptedHandKey = record.handKey;
      state.meta.firstAcceptedAt = record.finalizedAt;
    }
    state.meta.acceptedRecordCount = state.aggregateState.aggregate.ledgerRecordCount;
    state.meta.latestAcceptedAt = record.finalizedAt;
    state.recent.unshift(clone(record));
    if (state.recent.length > RECENT_LIMIT) state.recent.length = RECENT_LIMIT;
    var update = {};
    update[storageRecordKey(record.handKey, record.fingerprint)] = clone(record);
    update[META_KEY] = clone(state.meta);
    update[CACHE_KEY] = cacheSnapshot(state);
    result.storageUpdate = update;
    return result;
  }
  function rebuild(state) {
    var rebuilt = Aggregator.rebuild(Aggregator.records(state.aggregateState));
    return rebuilt.aggregate;
  }
  function info(state) {
    return {
      storageSchemaVersion: STORAGE_SCHEMA_VERSION,
      recordSchemaVersion: Aggregator.RECORD_SCHEMA_VERSION,
      meta: clone(state.meta),
      ledgerRecordCount: state.aggregateState.aggregate.ledgerRecordCount,
      playerCount: Object.keys(state.aggregateState.aggregate.players).length,
      rejectedRecordCount: state.storageRejectedRecords.length,
      semanticVersionCoverage: clone(state.aggregateState.aggregate.semanticVersionCoverage),
      recentHandKeys: state.recent.map(function (record) { return record.handKey; })
    };
  }

  return Object.freeze({
    STORAGE_SCHEMA_VERSION: STORAGE_SCHEMA_VERSION,
    META_KEY: META_KEY,
    CACHE_KEY: CACHE_KEY,
    RECORD_PREFIX: RECORD_PREFIX,
    namespace: namespace,
    handKey: handKey,
    storageRecordKey: storageRecordKey,
    buildCertifiedHandRecord: buildCertifiedHandRecord,
    createState: createState,
    initializationUpdate: initializationUpdate,
    append: append,
    rebuild: rebuild,
    info: info,
    playerStats: function (state, playerId) { return Aggregator.playerStats(state.aggregateState, playerId); },
    players: function (state) { return Aggregator.playerList(state.aggregateState); },
    recentRecords: function (state, limit) { return clone(state.recent.slice(0, Math.max(0, Math.min(RECENT_LIMIT, Number(limit || RECENT_LIMIT))))); },
    records: function (state) { return Aggregator.records(state.aggregateState); },
    exactAggregate: function (state) { return Aggregator.exactAggregate(state.aggregateState); }
  });
});
