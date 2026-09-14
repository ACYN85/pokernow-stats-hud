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
  function exactPostflopSituationMap(rows) {
    if (!Array.isArray(rows) || !rows.length) return {};
    // A finalized semantic record may also list seated observers. Supported
    // position rows are the exact dealt roster; all of those rows must agree.
    // A positively known entrant outside that roster is contradictory evidence.
    if (rows.some(function (row) { return row && (row.sawFlop === true || row.sawFlop === 1) && (!row.position || row.position.status !== 'supported'); })) return {};
    var dealt = rows.filter(function (row) { return row && row.playerId && row.position && row.position.schemaVersion === 1 && row.position.status === 'supported' && POSTFLOP_POSITION_ORDER.indexOf(row.position.dealtPosition) >= 0 && Number.isInteger(row.position.dealtPlayerCount); });
    if (!dealt.length || dealt.some(function (row) { return row.position.dealtPlayerCount !== dealt.length || (row.sawFlop !== false && row.sawFlop !== true && row.sawFlop !== 0 && row.sawFlop !== 1); })) return {};
    var entrants = dealt.filter(function (row) { return row.sawFlop === true || row.sawFlop === 1; });
    if (entrants.length !== 2) return {};
    var first = POSTFLOP_POSITION_ORDER.indexOf(entrants[0].position.dealtPosition);
    var second = POSTFLOP_POSITION_ORDER.indexOf(entrants[1].position.dealtPosition);
    if (first === second) return {};
    var result = {};
    result[String(entrants[0].playerId)] = first > second ? 'ip' : 'oop';
    result[String(entrants[1].playerId)] = second > first ? 'ip' : 'oop';
    return result;
  }
  function careerSituation(record, playerId) {
    if (!record || record.schemaVersion < 3) return null;
    var rows = (record.players || []).map(function (entry) {
      return { playerId: String(entry.playerId), position: entry.position, sawFlop: entry.decisions && entry.decisions.wtsd && entry.decisions.wtsd.opportunity };
    });
    return exactPostflopSituationMap(rows)[String(playerId)] || null;
  }
  function sessionSituationMap(semanticRecord, showdownContribution) {
    var position = semanticRecord && semanticRecord.positionProvenance;
    var showdown = showdownContribution && showdownContribution.players;
    if (!position || !showdown) return {};
    return exactPostflopSituationMap((semanticRecord.players || []).map(function (player) {
      var id = !player || player.playerId === null || player.playerId === undefined ? '' : String(player.playerId);
      var resolved = rootPosition(position, id);
      return { playerId: id, position: { schemaVersion: resolved.schemaVersion, status: resolved.dealtPosition ? 'supported' : 'unsupported', dealtPosition: resolved.dealtPosition, dealtPlayerCount: resolved.dealtPlayerCount }, sawFlop: showdown[id] && showdown[id].sawFlopForWTSD };
    }));
  }
  function normalizeFilters(filters) {
    filters = filters || {}; var position = filters.position === undefined || filters.position === null ? null : String(filters.position); var situation = filters.situation === undefined || filters.situation === null || filters.situation === 'overall' ? null : String(filters.situation); var statId = filters.statId === undefined || filters.statId === null ? null : String(filters.statId); var mode = filters.counterpartMode || (filters.counterpartPlayerId ? 'specific' : null); var counterpart = filters.counterpartPlayerId === undefined || filters.counterpartPlayerId === null ? null : String(filters.counterpartPlayerId); var self = filters.selfPlayerId === undefined || filters.selfPlayerId === null ? null : String(filters.selfPlayerId);
    if (situation && SITUATIONS.indexOf(situation) < 0) throw new TypeError('unsupported situation filter');
    if (position && situation) throw new TypeError('position and situation filters are mutually exclusive');
    if (mode && !RELATIONAL[statId]) throw new TypeError('counterpart filtering requires statId threeBet, foldToThreeBet, or foldToFlopCBet');
    if (mode === 'specific' && !counterpart) throw new TypeError('specific counterpart filtering requires counterpartPlayerId');
    if ((mode === 'self' || mode === 'others') && !self) throw new TypeError('self/others filtering requires a canonical selfPlayerId');
    if (mode && ['specific', 'self', 'others'].indexOf(mode) < 0) throw new TypeError('unsupported counterpart mode');
    return { position: position, situation: situation, statId: statId, counterpartMode: mode, counterpartPlayerId: counterpart, selfPlayerId: self };
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
    var counters = emptyCounters(); var coverage = { totalCareerHands: 0, positionTrackedHands: 0, matchedPositionHands: 0, situationTrackedHands: 0, matchedSituationHands: 0, excludedUnsupportedSituationHands: 0, relationalSupportedOpportunities: 0, matchedRelationalOpportunities: 0, earliestPositionTrackedAt: null, earliestRelationalTrackedAt: null, activeRecordCount: 0, physicalRecordCount: resolution.acceptedRecords.length, excludedUnsupportedPositionRecords: 0, excludedMissingCounterpartRecords: 0 };
    resolution.activeRecords.forEach(function (record) { var entry = (record.players || []).find(function (candidate) { return String(candidate.playerId) === playerId; }); if (!entry) return; var handCount = Number(entry.counters.hands || 0); coverage.activeRecordCount += 1; coverage.totalCareerHands += handCount; var positionSupported = entry.position && entry.position.status === 'supported' && entry.position.dealtPosition; var situation = filters.situation ? careerSituation(record, playerId) : null; if (situation) coverage.situationTrackedHands += handCount; if (positionSupported) { coverage.positionTrackedHands += handCount; coverage.earliestPositionTrackedAt = coverage.earliestPositionTrackedAt === null ? record.finalizedAt : Math.min(coverage.earliestPositionTrackedAt, record.finalizedAt); } if (filters.position && (!positionSupported || entry.position.dealtPosition !== filters.position)) { if (!positionSupported) coverage.excludedUnsupportedPositionRecords += 1; return; } if (filters.situation && situation !== filters.situation) { if (!situation) coverage.excludedUnsupportedSituationHands += handCount; return; } if (positionSupported) coverage.matchedPositionHands += handCount; if (filters.situation) coverage.matchedSituationHands += handCount; if (!filters.counterpartMode) { addCounters(counters, entry.counters); return; } var spec = RELATIONAL[filters.statId]; var relation = entry.relational && entry.relational[spec.relationField]; var opportunities = Number(entry.counters[spec.opportunities] || 0); if (relation && opportunities > 0) { coverage.relationalSupportedOpportunities += opportunities; coverage.earliestRelationalTrackedAt = coverage.earliestRelationalTrackedAt === null ? record.finalizedAt : Math.min(coverage.earliestRelationalTrackedAt, record.finalizedAt); } else { if (opportunities > 0) coverage.excludedMissingCounterpartRecords += 1; return; } if (!relationMatches(relation, filters)) return; counters[spec.made] += Number(entry.counters[spec.made] || 0); counters[spec.opportunities] += opportunities; coverage.matchedRelationalOpportunities += opportunities; });
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
  function session(events, playerId, requestedFilters) {
    playerId = String(playerId); var filters = normalizeFilters(requestedFilters); var playerEvents = (events || []).filter(function (event) { return event && String(event.playerId || '') === playerId; }); var handIds = new Set(playerEvents.map(function (event) { return String(event.handId); })); var trackedHands = new Set(playerEvents.filter(function (event) { return event.dealtPosition; }).map(function (event) { return String(event.handId); })); var situationHands = new Set(playerEvents.filter(function (event) { return SITUATIONS.indexOf(event.postflopSituation) >= 0; }).map(function (event) { return String(event.handId); })); var selected = filters.position ? playerEvents.filter(function (event) { return event.dealtPosition === filters.position; }) : filters.situation ? playerEvents.filter(function (event) { return event.postflopSituation === filters.situation; }) : playerEvents.slice(); var totalHands = new Set(playerEvents.filter(function (event) { return event.countsAsHand; }).map(function (event) { return String(event.handId); })); var counters; var coverage = { totalSessionHands: totalHands.size, positionTrackedHands: trackedHands.size, matchedPositionHands: new Set(selected.filter(function (event) { return event.countsAsHand && event.dealtPosition; }).map(function (event) { return String(event.handId); })).size, situationTrackedHands: situationHands.size, matchedSituationHands: new Set(selected.filter(function (event) { return event.countsAsHand && event.postflopSituation === filters.situation; }).map(function (event) { return String(event.handId); })).size, excludedUnsupportedSituationHands: filters.situation ? Array.from(totalHands).filter(function (handId) { return !situationHands.has(handId); }).length : 0, relationalSupportedOpportunities: 0, matchedRelationalOpportunities: 0, activeRecordCount: handIds.size, excludedMissingCounterpartRecords: 0 };
    if (!filters.counterpartMode) counters = exactFromSession(Stats.computePlayerStatsByIdentity(selected, playerId, selected[0] && selected[0].player));
    else { counters = emptyCounters(); var spec = RELATIONAL[filters.statId]; var seen = new Set(); selected.forEach(function (event) { var opportunity = Number(event[spec.opportunities] || 0); if (!opportunity) return; var key = [event.handId, playerId, filters.statId].join('|'); if (seen.has(key)) return; seen.add(key); var relation = event[spec.relationField]; if (!relation) { coverage.excludedMissingCounterpartRecords += 1; return; } coverage.relationalSupportedOpportunities += opportunity; if (!relationMatches(relation, filters)) return; counters[spec.made] += Number(event[spec.made] || 0); counters[spec.opportunities] += opportunity; coverage.matchedRelationalOpportunities += opportunity; }); }
    return result(playerId, filters, counters, coverage);
  }
  return Object.freeze({ SCHEMA_VERSION: SCHEMA_VERSION, RELATIONAL_STATS: RELATIONAL, SITUATIONS: SITUATIONS, TREND_WINDOWS: TREND_WINDOWS, POSTFLOP_POSITION_ORDER: POSTFLOP_POSITION_ORDER, normalizeFilters: normalizeFilters, careerStatsFiltered: career, careerStatsFilteredBatch: careerBatch, careerTrendStats: careerTrends, sessionStatsFiltered: session, annotateSessionEvents: annotateSessionEvents, annotateSessionEventRange: annotateSessionEventRange, exactFromSession: exactFromSession });
});
