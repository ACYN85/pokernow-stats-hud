(function (root, factory) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;
  var stats = root.PokerStats; var aggregator = root.PokerCareerStatsAggregator;
  if (typeof module !== 'undefined' && module.exports) { stats = require('./stats.js'); aggregator = require('./careerStatsAggregator.js'); }
  var api = factory(stats, aggregator);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerFilteredStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Stats, Aggregator) {
  'use strict';
  var SCHEMA_VERSION = 1;
  var RELATIONAL = Object.freeze({
    threeBet: Object.freeze({ relationField: 'threeBetTargetPlayerId', made: 'threeBetMade', opportunities: 'threeBetOpportunities' }),
    foldToThreeBet: Object.freeze({ relationField: 'foldToThreeBetAggressorPlayerId', made: 'foldToThreeBet', opportunities: 'foldToThreeBetOpportunities' }),
    foldToFlopCBet: Object.freeze({ relationField: 'foldToFlopCBetAggressorPlayerId', made: 'foldToFlopCBet', opportunities: 'foldToFlopCBetOpportunities' })
  });
  var SITUATIONS = Object.freeze(['ip', 'oop']);
  var TREND_WINDOWS = Object.freeze([25, 50, 100, 250]);
  var POSTFLOP_POSITION_ORDER = Object.freeze(['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN']);
  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function emptyCounters() { return Aggregator.COUNTER_FIELDS.reduce(function (result, field) { result[field] = 0; return result; }, {}); }
  function addCounters(target, source) { Aggregator.COUNTER_FIELDS.forEach(function (field) { target[field] += Number(source && source[field] || 0); }); }
  function exactFromSession(stats) { var af = stats && stats.afDetails || {}; return { hands: Number(stats && stats.handsPlayed || 0), vpipMade: Number(stats && stats.vpipHands || 0), vpipOpportunities: Number(stats && stats.vpipOpportunities || 0), pfrMade: Number(stats && stats.pfrHands || 0), pfrOpportunities: Number(stats && stats.pfrOpportunities || 0), postflopAggressiveActions: Number(af.bets || 0) + Number(af.raises || 0), postflopCalls: Number(af.calls || 0), threeBetMade: Number(stats && stats.threeBetMade || 0), threeBetOpportunities: Number(stats && stats.threeBetOpportunities || 0), foldToThreeBet: Number(stats && stats.foldToThreeBet || 0), foldToThreeBetOpportunities: Number(stats && stats.foldToThreeBetOpportunities || 0), flopCBetMade: Number(stats && stats.flopCBetMade || 0), flopCBetOpportunities: Number(stats && stats.flopCBetOpportunities || 0), foldToFlopCBet: Number(stats && stats.foldToFlopCBet || 0), foldToFlopCBetOpportunities: Number(stats && stats.foldToFlopCBetOpportunities || 0), wtsdMade: Number(stats && stats.wentToShowdown || 0), wtsdOpportunities: Number(stats && stats.sawFlopForWTSD || 0), wsdMade: Number(stats && stats.wonMoneyAtShowdown || 0), wsdOpportunities: Number(stats && stats.showdownsForWSD || 0) }; }
  function careerSituation(record, playerId) {
    return Aggregator.careerSituationMap(record)[String(playerId)] || null;
  }
  function sessionSituationMap(semanticRecord, showdownContribution) {
    var position = semanticRecord && semanticRecord.positionProvenance;
    var showdown = showdownContribution && showdownContribution.players;
    if (!position || !showdown) return {};
    return Aggregator.exactPostflopSituationMap((semanticRecord.players || []).map(function (player) {
      var id = !player || player.playerId === null || player.playerId === undefined ? '' : String(player.playerId);
      var resolved = rootPosition(position, id);
      return { playerId: id, position: { schemaVersion: resolved.schemaVersion, status: resolved.dealtPosition ? 'supported' : 'unsupported', dealtPosition: resolved.dealtPosition, dealtPlayerCount: resolved.dealtPlayerCount }, sawFlop: showdown[id] && showdown[id].sawFlopForWTSD };
    }));
  }
  function normalizeFilters(filters) {
    filters = filters || {}; var position = filters.position === undefined || filters.position === null ? null : String(filters.position); var situation = filters.situation === undefined || filters.situation === null || filters.situation === 'overall' ? null : String(filters.situation); var statId = filters.statId === undefined || filters.statId === null ? null : String(filters.statId); var mode = filters.counterpartMode || (filters.counterpartPlayerId ? 'specific' : null); var counterpart = filters.counterpartPlayerId === undefined || filters.counterpartPlayerId === null ? null : String(filters.counterpartPlayerId); var self = filters.selfPlayerId === undefined || filters.selfPlayerId === null ? null : String(filters.selfPlayerId); var tableSize = filters.tableSize === undefined || filters.tableSize === null || filters.tableSize === 'all' ? null : String(filters.tableSize);
    if (tableSize && ['HU', '3_TO_5', 'SIX_PLUS'].indexOf(tableSize) < 0) throw new TypeError('unsupported table-size filter');
    if (situation && SITUATIONS.indexOf(situation) < 0) throw new TypeError('unsupported situation filter');
    if (position && situation) throw new TypeError('position and situation filters are mutually exclusive');
    if (mode && !RELATIONAL[statId]) throw new TypeError('counterpart filtering requires statId threeBet, foldToThreeBet, or foldToFlopCBet');
    if (mode === 'specific' && !counterpart) throw new TypeError('specific counterpart filtering requires counterpartPlayerId');
    if ((mode === 'self' || mode === 'others') && !self) throw new TypeError('self/others filtering requires a canonical selfPlayerId');
    if (mode && ['specific', 'self', 'others'].indexOf(mode) < 0) throw new TypeError('unsupported counterpart mode');
    return { position: position, situation: situation, tableSize: tableSize, statId: statId, counterpartMode: mode, counterpartPlayerId: counterpart, selfPlayerId: self };
  }
  function relationMatches(value, filters) { if (!value) return false; if (filters.counterpartMode === 'specific') return String(value) === filters.counterpartPlayerId; if (filters.counterpartMode === 'self') return String(value) === filters.selfPlayerId; if (filters.counterpartMode === 'others') return String(value) !== filters.selfPlayerId; return true; }
  function result(playerId, filters, counters, coverage) { return { schemaVersion: SCHEMA_VERSION, playerId: String(playerId), filters: clone(filters), counters: counters, derived: Aggregator.deriveCounters(counters), coverage: coverage }; }
  function career(records, playerId, requestedFilters) {
    playerId = String(playerId); var filters = normalizeFilters(requestedFilters);
    return careerResolved(Aggregator.rebuild(records || []), playerId, filters);
  }
  // One retrieved snapshot, shared only within this call. Each result owns its data.
  function careerBatch(records, playerId, requestedFilters) {
    playerId = String(playerId);
    var filters = requestedFilters.map(normalizeFilters);
    if (!filters.length) return [];
    var resolution = Aggregator.rebuild(records || []);
    return filters.map(function (filter) { return careerResolved(resolution, playerId, filter); });
  }
  function careerResolved(resolution, playerId, filters) {
    var counters = emptyCounters(); var coverage = { totalCareerHands: 0, positionTrackedHands: 0, matchedPositionHands: 0, situationTrackedHands: 0, matchedSituationHands: 0, excludedUnsupportedSituationHands: 0, relationalSupportedOpportunities: 0, matchedRelationalOpportunities: 0, earliestPositionTrackedAt: null, earliestRelationalTrackedAt: null, activeRecordCount: 0, physicalRecordCount: resolution.acceptedRecords.length, tableSizeHands: { HU: 0, '3_TO_5': 0, SIX_PLUS: 0 }, excludedUnsupportedPositionRecords: 0, excludedMissingCounterpartRecords: 0 };
    resolution.activeRecords.forEach(function (record) { var entry = (record.players || []).find(function (candidate) { return String(candidate.playerId) === playerId; }); if (!entry) return; var bucket = Aggregator.classifyTableSize(Aggregator.resolveDealtPlayerCount(record)); if (filters.tableSize && bucket !== filters.tableSize) return; var handCount = Number(entry.counters.hands || 0); coverage.activeRecordCount += 1; coverage.totalCareerHands += handCount; var positionSupported = entry.position && entry.position.status === 'supported' && entry.position.dealtPosition; var situation = filters.situation ? careerSituation(record, playerId) : null; if (situation) coverage.situationTrackedHands += handCount; if (positionSupported) { coverage.positionTrackedHands += handCount; coverage.earliestPositionTrackedAt = coverage.earliestPositionTrackedAt === null ? record.finalizedAt : Math.min(coverage.earliestPositionTrackedAt, record.finalizedAt); } if (filters.position && (!positionSupported || entry.position.dealtPosition !== filters.position)) { if (!positionSupported) coverage.excludedUnsupportedPositionRecords += 1; return; } if (filters.situation && situation !== filters.situation) { if (!situation) coverage.excludedUnsupportedSituationHands += handCount; return; } if (coverage.tableSizeHands[bucket] !== undefined) coverage.tableSizeHands[bucket] += handCount; if (positionSupported) coverage.matchedPositionHands += handCount; if (filters.situation) coverage.matchedSituationHands += handCount; if (!filters.counterpartMode) { addCounters(counters, entry.counters); return; } var spec = RELATIONAL[filters.statId]; var relation = entry.relational && entry.relational[spec.relationField]; var opportunities = Number(entry.counters[spec.opportunities] || 0); if (relation && opportunities > 0) { coverage.relationalSupportedOpportunities += opportunities; coverage.earliestRelationalTrackedAt = coverage.earliestRelationalTrackedAt === null ? record.finalizedAt : Math.min(coverage.earliestRelationalTrackedAt, record.finalizedAt); } else { if (opportunities > 0) coverage.excludedMissingCounterpartRecords += 1; return; } if (!relationMatches(relation, filters)) return; counters[spec.made] += Number(entry.counters[spec.made] || 0); counters[spec.opportunities] += opportunities; coverage.matchedRelationalOpportunities += opportunities; });
    return result(playerId, filters, counters, coverage);
  }
  function validFinalizedAt(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
  function defaultTrendWindow(available) {
    if (available.indexOf(100) >= 0) return 100;
    if (available.indexOf(50) >= 0) return 50;
    if (available.indexOf(25) >= 0) return 25;
    return null;
  }
  function trendStatSnapshot(player) {
    var stats = Aggregator.derivePlayer(player);
    return stats ? { playerId: stats.playerId, counters: stats.counters, derived: stats.derived } : null;
  }
  function careerTrends(records, playerId) {
    playerId = String(playerId);
    var resolution = Aggregator.rebuild(records || []);
    var baseline = trendStatSnapshot(resolution.aggregate.players[playerId]);
    var dated = [];
    resolution.activeRecords.forEach(function (record) {
      var entry = (record.players || []).find(function (candidate) { return String(candidate.playerId) === playerId; });
      if (!entry || Number(entry.counters && entry.counters.hands || 0) !== 1 || !validFinalizedAt(record.finalizedAt)) return;
      dated.push({ record: record, finalizedAt: record.finalizedAt, handKey: String(record.handKey), fingerprint: String(record.fingerprint) });
    });
    dated.sort(function (left, right) { return left.finalizedAt - right.finalizedAt || left.handKey.localeCompare(right.handKey) || left.fingerprint.localeCompare(right.fingerprint); });
    var available = TREND_WINDOWS.filter(function (size) { return dated.length >= size; });
    var windows = {};
    available.forEach(function (size) {
      var selected = dated.slice(dated.length - size);
      var aggregate = Aggregator.aggregateActiveRecords(selected.map(function (entry) { return entry.record; }));
      windows[String(size)] = { size: size, oldestFinalizedAt: selected[0].finalizedAt, newestFinalizedAt: selected[selected.length - 1].finalizedAt, stats: trendStatSnapshot(aggregate.players[playerId]) };
    });
    var totalHands = Number(baseline && baseline.counters && baseline.counters.hands || 0);
    return {
      version: 1, playerId: playerId, totalCareerHands: totalHands, datedHands: dated.length, undatedHands: Math.max(0, totalHands - dated.length),
      availableWindows: available, defaultWindow: defaultTrendWindow(available), windows: windows, baseline: baseline,
      chronology: { order: 'finalizedAt-ascending-handKey-fingerprint', earliestFinalizedAt: dated.length ? dated[0].finalizedAt : null, latestFinalizedAt: dated.length ? dated[dated.length - 1].finalizedAt : null },
      resolution: { physicalRecordCount: resolution.acceptedRecords.length, activeRecordCount: resolution.activeRecords.length, quarantinedHandCount: resolution.quarantinedHandKeys.length },
      query: { resolverPasses: 1, windowAggregateBuilds: available.length }
    };
  }
  function annotateSessionEvents(events, semanticRecord, preflopContribution, flopContribution, showdownContribution) {
    var position = semanticRecord && semanticRecord.positionProvenance || null; var aliases = [semanticRecord && semanticRecord.handIdentity && semanticRecord.handIdentity.handId, semanticRecord && semanticRecord.handIdentity && semanticRecord.handIdentity.lifecycleHandId].filter(function (value) { return value !== null && value !== undefined; }).map(String); var preflop = preflopContribution && preflopContribution.players || {}; var preflopHand = preflopContribution && preflopContribution.hand || {}; var flop = flopContribution && flopContribution.players || {}; var flopHand = flopContribution && flopContribution.hand || {}; var situations = sessionSituationMap(semanticRecord, showdownContribution);
    return (events || []).map(function (event) { if (!event || !aliases.includes(String(event.handId)) || event.playerId === undefined || event.playerId === null) return event; var id = String(event.playerId); var playerPosition = rootPosition(position, id); var situation = situations[id] || null; return Object.assign({}, event, { positionSchemaVersion: playerPosition.schemaVersion, dealtPosition: playerPosition.dealtPosition, dealtPlayerCount: playerPosition.dealtPlayerCount, positionUnsupportedReason: playerPosition.unsupportedReason, postflopSituationVersion: situation ? 1 : null, postflopSituation: situation, threeBetTargetPlayerId: preflop[id] && preflop[id].threeBet && preflop[id].threeBet.opportunity === true ? String(preflopHand.openRaiser || '') || null : null, foldToThreeBetAggressorPlayerId: preflop[id] && preflop[id].foldToThreeBet && preflop[id].foldToThreeBet.opportunity === true ? String(preflopHand.threeBettor || '') || null : null, foldToFlopCBetAggressorPlayerId: flop[id] && flop[id].foldToFlopCBetDecision && flop[id].foldToFlopCBetDecision.opportunity === true ? String(flopHand.cBettor || '') || null : null }); });
  }
  function annotateSessionEventRange(events, start, length, semanticRecord, preflopContribution, flopContribution, showdownContribution) {
    events = Array.isArray(events) ? events : [];
    start = Math.max(0, Math.min(events.length, Number(start || 0)));
    length = Math.max(0, Math.min(events.length - start, Number(length || 0)));
    var annotated = annotateSessionEvents(events.slice(start, start + length), semanticRecord, preflopContribution, flopContribution, showdownContribution);
    for (var index = 0; index < annotated.length; index += 1) events[start + index] = annotated[index];
    return events;
  }
  function rootPosition(position, playerId) { var supported = position && position.status === 'supported' && position.assignments && position.assignments[playerId]; return { schemaVersion: 1, dealtPosition: supported ? position.assignments[playerId] : null, dealtPlayerCount: position && Number.isInteger(position.dealtPlayerCount) ? position.dealtPlayerCount : null, unsupportedReason: supported ? null : position && position.reason || 'position provenance unavailable' }; }
  function multiwayHandCount(playerEvents, selectedHandIds) {
    var byHand = new Map();
    playerEvents.forEach(function (event) {
      var handId = String(event.handId);
      if (!selectedHandIds.has(handId)) return;
      var count = Number(event.dealtPlayerCount);
      var supported = event.positionSchemaVersion === 1 && Number.isInteger(count) && count >= 3 && count <= 9;
      var previous = byHand.get(handId);
      byHand.set(handId, previous === undefined ? (supported ? count : null) : previous === count && supported ? count : null);
    });
    return Array.from(byHand.values()).filter(function (count) { return count !== null; }).length;
  }
  function exactSessionHandCount(events) {
    var counts = (events || []).filter(function (event) { return event && event.playerId; }).map(function (event) {
      return event.positionSchemaVersion === 1 ? event.dealtPlayerCount : null;
    });
    return counts.length && Aggregator.classifyTableSize(counts[0]) !== 'UNKNOWN' && counts.every(function (count) { return count === counts[0]; }) ? counts[0] : null;
  }
  function session(events, playerId, requestedFilters) {
    playerId = String(playerId); var filters = normalizeFilters(requestedFilters); var allPlayerEvents = (events || []).filter(function (event) { return event && String(event.playerId || '') === playerId; }); var countByHand = new Map(); var grouped = new Map(); (events || []).forEach(function (event) { if (!event || event.handId === undefined || event.handId === null) return; var key = String(event.handId); if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(event); }); grouped.forEach(function (group, key) { countByHand.set(key, exactSessionHandCount(group)); }); var playerEvents = filters.tableSize ? allPlayerEvents.filter(function (event) { return Aggregator.classifyTableSize(countByHand.get(String(event.handId))) === filters.tableSize; }) : allPlayerEvents; var handIds = new Set(playerEvents.map(function (event) { return String(event.handId); })); var trackedHands = new Set(playerEvents.filter(function (event) { return event.dealtPosition; }).map(function (event) { return String(event.handId); })); var situationHands = new Set(playerEvents.filter(function (event) { return SITUATIONS.indexOf(event.postflopSituation) >= 0; }).map(function (event) { return String(event.handId); })); var selected = filters.position ? playerEvents.filter(function (event) { return event.dealtPosition === filters.position; }) : filters.situation ? playerEvents.filter(function (event) { return event.postflopSituation === filters.situation; }) : playerEvents.slice(); var selectedHandIds = new Set(selected.map(function (event) { return String(event.handId); })); var counters; var coverage = { totalSessionHands: handIds.size, positionTrackedHands: trackedHands.size, matchedPositionHands: new Set(selected.filter(function (event) { return event.dealtPosition; }).map(function (event) { return String(event.handId); })).size, situationTrackedHands: situationHands.size, matchedSituationHands: new Set(selected.filter(function (event) { return event.postflopSituation === filters.situation; }).map(function (event) { return String(event.handId); })).size, excludedUnsupportedSituationHands: filters.situation ? Array.from(handIds).filter(function (handId) { return !situationHands.has(handId); }).length : 0, relationalSupportedOpportunities: 0, matchedRelationalOpportunities: 0, activeRecordCount: handIds.size, excludedMissingCounterpartRecords: 0, tableSizeHands: { HU: 0, '3_TO_5': 0, SIX_PLUS: 0 } };
    selectedHandIds.forEach(function (handId) { var bucket = Aggregator.classifyTableSize(countByHand.get(handId)); if (coverage.tableSizeHands[bucket] !== undefined) coverage.tableSizeHands[bucket] += 1; });
    coverage.tableSize3PlusHands = multiwayHandCount(playerEvents, selectedHandIds);
    coverage.preflopTableSizeSum = 0; coverage.preflopTableSizeOpportunities = 0;
    selectedHandIds.forEach(function (handId) { var count = countByHand.get(handId); if (count === null) return; var one = exactFromSession(Stats.computePlayerStatsByIdentity(grouped.get(handId), playerId)); coverage.preflopTableSizeSum += count * one.vpipOpportunities; coverage.preflopTableSizeOpportunities += one.vpipOpportunities; });
    // Walk detection needs every participant's actions from the selected hands.
    if (!filters.counterpartMode) counters = exactFromSession(Stats.computePlayerStatsByIdentity((events || []).filter(function (event) { return event && selectedHandIds.has(String(event.handId)); }), playerId, selected[0] && selected[0].player));
    else { counters = emptyCounters(); var spec = RELATIONAL[filters.statId]; var seen = new Set(); selected.forEach(function (event) { var opportunity = Number(event[spec.opportunities] || 0); if (!opportunity) return; var key = [event.handId, playerId, filters.statId].join('|'); if (seen.has(key)) return; seen.add(key); var relation = event[spec.relationField]; if (!relation) { coverage.excludedMissingCounterpartRecords += 1; return; } coverage.relationalSupportedOpportunities += opportunity; if (!relationMatches(relation, filters)) return; counters[spec.made] += Number(event[spec.made] || 0); counters[spec.opportunities] += opportunity; coverage.matchedRelationalOpportunities += opportunity; }); }
    return result(playerId, filters, counters, coverage);
  }
  function appendSessionResult(previous, handEvents, playerId, requestedFilters) {
    playerId = String(playerId);
    var filters = normalizeFilters(requestedFilters);
    if (!previous || previous.schemaVersion !== SCHEMA_VERSION || previous.playerId !== playerId || JSON.stringify(previous.filters) !== JSON.stringify(filters))
      throw new TypeError('matching prior Session result is required for an incremental append');
    var delta = session(handEvents, playerId, filters);
    var counters = clone(previous.counters);
    addCounters(counters, delta.counters);
    var coverage = clone(previous.coverage);
    Object.keys(delta.coverage).forEach(function (key) {
      if (key === 'tableSizeHands') { ['HU', '3_TO_5', 'SIX_PLUS'].forEach(function (bucket) { coverage.tableSizeHands[bucket] = Number(coverage.tableSizeHands[bucket] || 0) + Number(delta.coverage.tableSizeHands[bucket] || 0); }); }
      else coverage[key] = Number(coverage[key] || 0) + Number(delta.coverage[key] || 0);
    });
    return result(playerId, filters, counters, coverage);
  }
  function createSessionContextState() { return { players: Object.create(null) }; }
  function appendSessionContextHand(state, handEvents) {
    var byPlayer = new Map();
    (handEvents || []).forEach(function (event) {
      if (!event || !event.playerId) return;
      var id = String(event.playerId);
      if (!byPlayer.has(id)) byPlayer.set(id, []);
      byPlayer.get(id).push(event);
    });
    byPlayer.forEach(function (events, playerId) {
      var player = state.players[playerId] || (state.players[playerId] = { situations: {}, positions: {}, tableSizes: {},
        coverage: { totalSessionHands: 0, positionTrackedHands: 0, situationTrackedHands: 0, activeRecordCount: 0, tableSize3PlusHands: 0, tableSizeHands: { HU: 0, '3_TO_5': 0, SIX_PLUS: 0 }, positions: {}, situations: {}, positions3Plus: {}, situations3Plus: {} } });
      var overallCoverage = session(handEvents, playerId, {}).coverage;
      ['totalSessionHands', 'positionTrackedHands', 'situationTrackedHands', 'activeRecordCount', 'tableSize3PlusHands'].forEach(function (key) {
        player.coverage[key] += overallCoverage[key];
      });
      ['HU', '3_TO_5', 'SIX_PLUS'].forEach(function (bucket) { player.coverage.tableSizeHands[bucket] += overallCoverage.tableSizeHands[bucket]; });
      var positions = new Set(events.map(function (event) { return event.dealtPosition; }).filter(function (position) { return Aggregator.POSITION_LABELS.indexOf(position) >= 0; }));
      var situations = new Set(events.map(function (event) { return event.postflopSituation; }).filter(function (situation) { return SITUATIONS.indexOf(situation) >= 0; }));
      positions.forEach(function (position) {
        if (!player.positions[position]) player.positions[position] = emptyCounters();
        var exact = session(handEvents, playerId, { position: position });
        addCounters(player.positions[position], exact.counters);
        player.coverage.positions[position] = Number(player.coverage.positions[position] || 0) + exact.coverage.matchedPositionHands;
        player.coverage.positions3Plus[position] = Number(player.coverage.positions3Plus[position] || 0) + exact.coverage.tableSize3PlusHands;
      });
      situations.forEach(function (situation) {
        if (!player.situations[situation]) player.situations[situation] = emptyCounters();
        var exact = session(handEvents, playerId, { situation: situation });
        addCounters(player.situations[situation], exact.counters);
        if (!player.coverage.situations[situation]) player.coverage.situations[situation] = { matchedPositionHands: 0, matchedSituationHands: 0 };
        player.coverage.situations[situation].matchedPositionHands += exact.coverage.matchedPositionHands;
        player.coverage.situations[situation].matchedSituationHands += exact.coverage.matchedSituationHands;
        player.coverage.situations3Plus[situation] = Number(player.coverage.situations3Plus[situation] || 0) + exact.coverage.tableSize3PlusHands;
      });
      var dealtCount = exactSessionHandCount(handEvents);
      if (dealtCount !== null) {
        var table = player.tableSizes[dealtCount] || (player.tableSizes[dealtCount] = { overall: emptyCounters(), situations: {}, positions: {}, hands: 0 });
        table.hands += overallCoverage.totalSessionHands;
        addCounters(table.overall, session(handEvents, playerId, {}).counters);
        positions.forEach(function (position) { if (!table.positions[position]) table.positions[position] = emptyCounters(); addCounters(table.positions[position], session(handEvents, playerId, { position: position }).counters); });
        situations.forEach(function (situation) { if (!table.situations[situation]) table.situations[situation] = emptyCounters(); addCounters(table.situations[situation], session(handEvents, playerId, { situation: situation }).counters); });
      }
    });
    return state;
  }
  function rebuildSessionContexts(events) {
    var state = createSessionContextState(); var byHand = new Map();
    (events || []).forEach(function (event) {
      if (!event || event.handId === null || event.handId === undefined) return;
      var key = String(event.handId);
      if (!byHand.has(key)) byHand.set(key, []);
      byHand.get(key).push(event);
    });
    byHand.forEach(function (handEvents) { appendSessionContextHand(state, handEvents); });
    return state;
  }
  function sessionContextResult(state, playerId, requestedFilters) {
    playerId = String(playerId);
    var filters = normalizeFilters(requestedFilters);
    if ((!filters.position && !filters.situation && !filters.tableSize) || filters.counterpartMode) throw new TypeError('maintained Session context requires a position, situation, or table size without a counterpart');
    var player = state && state.players[playerId];
    var table = filters.tableSize ? { overall: emptyCounters(), positions: {}, situations: {}, hands: 0 } : null;
    if (table && player) Object.keys(player.tableSizes || {}).forEach(function (count) { if (Aggregator.classifyTableSize(Number(count)) !== filters.tableSize) return; var part = player.tableSizes[count]; table.hands += part.hands; addCounters(table.overall, part.overall); ['positions', 'situations'].forEach(function (kind) { Object.keys(part[kind]).forEach(function (key) { if (!table[kind][key]) table[kind][key] = emptyCounters(); addCounters(table[kind][key], part[kind][key]); }); }); });
    var counters = clone(filters.position ? table ? table.positions[filters.position] : player && player.positions[filters.position] : filters.situation ? table ? table.situations[filters.situation] : player && player.situations[filters.situation] : table && table.overall || emptyCounters());
    if (!counters) counters = emptyCounters();
    var base = player && player.coverage || { totalSessionHands: 0, positionTrackedHands: 0, situationTrackedHands: 0, activeRecordCount: 0, tableSize3PlusHands: 0, positions: {}, situations: {}, positions3Plus: {}, situations3Plus: {} };
    var situationCoverage = filters.situation && base.situations[filters.situation] || null;
    var tableSizeHands = { HU: 0, '3_TO_5': 0, SIX_PLUS: 0 };
    var tableSizeSum = 0; var tableSizeOpportunities = 0;
    if (player) Object.keys(player.tableSizes || {}).forEach(function (count) { var bucket = Aggregator.classifyTableSize(Number(count)); if (filters.tableSize && bucket !== filters.tableSize) return; var part = player.tableSizes[count]; var slice = filters.position ? part.positions[filters.position] : filters.situation ? part.situations[filters.situation] : part.overall; if (tableSizeHands[bucket] !== undefined) tableSizeHands[bucket] += Number(slice && slice.hands || 0); });
    if (player) Object.keys(player.tableSizes || {}).forEach(function (count) { if (filters.tableSize && Aggregator.classifyTableSize(Number(count)) !== filters.tableSize) return; var part = player.tableSizes[count]; var slice = filters.position ? part.positions[filters.position] : filters.situation ? part.situations[filters.situation] : part.overall; tableSizeSum += Number(count) * Number(slice && slice.vpipOpportunities || 0); tableSizeOpportunities += Number(slice && slice.vpipOpportunities || 0); });
    return result(playerId, filters, counters, {
      totalSessionHands: filters.tableSize ? table.hands : base.totalSessionHands,
      positionTrackedHands: filters.tableSize ? Object.keys(table.positions).reduce(function (sum, key) { return sum + Number(table.positions[key].hands || 0); }, 0) : base.positionTrackedHands,
      tableSize3PlusHands: filters.tableSize ? filters.tableSize === 'HU' ? 0 : Number(counters.hands || 0) : filters.position ? Number(base.positions3Plus[filters.position] || 0) : Number(base.situations3Plus[filters.situation] || 0),
      tableSizeHands: tableSizeHands,
      preflopTableSizeSum: tableSizeSum, preflopTableSizeOpportunities: tableSizeOpportunities,
      matchedPositionHands: filters.tableSize ? filters.position || filters.situation ? Number(counters.hands || 0) : Object.keys(table.positions).reduce(function (sum, key) { return sum + Number(table.positions[key].hands || 0); }, 0) : filters.position ? Number(base.positions[filters.position] || 0) : Number(situationCoverage && situationCoverage.matchedPositionHands || 0),
      situationTrackedHands: filters.tableSize ? ['ip', 'oop'].reduce(function (sum, key) { return sum + Number(table.situations[key] && table.situations[key].hands || 0); }, 0) : base.situationTrackedHands,
      matchedSituationHands: filters.tableSize ? filters.situation ? Number(counters.hands || 0) : 0 : Number(situationCoverage && situationCoverage.matchedSituationHands || 0),
      excludedUnsupportedSituationHands: filters.situation ? (filters.tableSize ? table.hands - ['ip', 'oop'].reduce(function (sum, key) { return sum + Number(table.situations[key] && table.situations[key].hands || 0); }, 0) : base.totalSessionHands - base.situationTrackedHands) : 0,
      relationalSupportedOpportunities: 0, matchedRelationalOpportunities: 0,
      activeRecordCount: filters.tableSize ? table.hands : base.activeRecordCount, excludedMissingCounterpartRecords: 0
    });
  }
  function sessionComparisonContexts(state, playerId, revision, tableSize) {
    playerId = String(playerId);
    var player = state && state.players[playerId]; var positions = {};
    Aggregator.POSITION_LABELS.forEach(function (position) {
      positions[position] = player && (tableSize || player.positions[position]) ? sessionContextResult(state, playerId, { position: position, tableSize: tableSize }) : null;
    });
    return { playerId: playerId, source: 'session', sessionRevision: Number(revision || 0),
      situations: {
        ip: player && (tableSize || player.situations.ip) ? sessionContextResult(state, playerId, { situation: 'ip', tableSize: tableSize }) : null,
        oop: player && (tableSize || player.situations.oop) ? sessionContextResult(state, playerId, { situation: 'oop', tableSize: tableSize }) : null
      }, positions: positions };
  }
  return Object.freeze({ SCHEMA_VERSION: SCHEMA_VERSION, RELATIONAL_STATS: RELATIONAL, SITUATIONS: SITUATIONS, TREND_WINDOWS: TREND_WINDOWS, POSTFLOP_POSITION_ORDER: POSTFLOP_POSITION_ORDER, normalizeFilters: normalizeFilters, careerStatsFiltered: career, careerStatsFilteredBatch: careerBatch, careerTrendStats: careerTrends, sessionStatsFiltered: session, appendSessionResult: appendSessionResult, annotateSessionEvents: annotateSessionEvents, annotateSessionEventRange: annotateSessionEventRange, exactFromSession: exactFromSession, createSessionContextState: createSessionContextState, appendSessionContextHand: appendSessionContextHand, rebuildSessionContexts: rebuildSessionContexts, sessionContextResult: sessionContextResult, sessionComparisonContexts: sessionComparisonContexts });
});
