/* Internal, detached Person Career projections. No record or raw-ID rewriting. */
(function (root, factory) {
  'use strict';
  var m = root.PokerPlayerIdentity, a = root.PokerCareerStatsAggregator, f = root.PokerFilteredStats, i = root.PokerCareerIndexedStore, v = root.PokerPlayerIdentityValidation;
  if (typeof module !== 'undefined' && module.exports) { m = require('./playerIdentity.js'); a = require('./careerStatsAggregator.js'); f = require('./filteredStats.js'); i = require('./careerIndexedStore.js'); v = require('./playerIdentityValidation.js'); }
  var api = factory(m, a, f, i, v);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPlayerIdentityCareer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, A, F, I, V) {
  'use strict';
  function fail(code) { var error = Error(code); error.code = code; throw error; }
  function copy(value) { return structuredClone(value); }
  function sum(a, b) { var n = a + b; if (!Number.isSafeInteger(a) || a < 0 || !Number.isSafeInteger(b) || b < 0 || !Number.isSafeInteger(n)) fail('UNSAFE_COMBINED_COUNTER'); return n; }
  function counters(target, source) { A.COUNTER_FIELDS.forEach(function (field) { target[field] = sum(target[field], source[field]); }); }
  function contexts(target, source) { ['positions', 'situations'].forEach(function (kind) { Object.keys(source[kind]).forEach(function (key) { counters(target[kind][key] || (target[kind][key] = A.emptyCounters()), source[kind][key]); }); }); }
  function earliest(a, b) { return a === null ? b : b === null ? a : Math.min(a, b); }
  function latest(target, source) { if (source.latestDisplayName && source.lastSeenAt >= target.lastSeenAt) target.latestDisplayName = source.latestDisplayName; target.lastSeenAt = Math.max(target.lastSeenAt, source.lastSeenAt); }
  function emptyPlayer() { return { playerId: '', latestDisplayName: '', lastSeenAt: 0, recordCount: 0, counters: A.emptyCounters(), contexts: { positions: {}, situations: {} }, tableSizes: {}, positionCoverage: { trackedHands: 0, earliestTrackedAt: null, unsupportedRecords: 0 }, profileProjection: { version: A.PROFILE_PROJECTION_VERSION, playerId: '', latestDisplayName: '', lastSeenAt: 0, recordCount: 0, counters: A.emptyCounters(), profileContext: { version: A.PROFILE_CONTEXT_VERSION, preflopTableSizeSum: 0, preflopTableSizeOpportunities: 0 } } }; }
  // Permitted only for certified disjoint all-positive, single-version populations.
  function combinePlayers(players) {
    var combined = emptyPlayer();
    players.forEach(function (player) {
      if (!player) return;
      counters(combined.counters, player.counters); contexts(combined.contexts, player.contexts); latest(combined, player);
      combined.recordCount = sum(combined.recordCount, player.recordCount);
      combined.positionCoverage.trackedHands = sum(combined.positionCoverage.trackedHands, player.positionCoverage.trackedHands);
      combined.positionCoverage.unsupportedRecords = sum(combined.positionCoverage.unsupportedRecords, player.positionCoverage.unsupportedRecords);
      combined.positionCoverage.earliestTrackedAt = earliest(combined.positionCoverage.earliestTrackedAt, player.positionCoverage.earliestTrackedAt);
      Object.keys(player.tableSizes).forEach(function (count) {
        var part = player.tableSizes[count], to = combined.tableSizes[count];
        counters(A.emptyCounters(), part.counters); contexts({ positions: {}, situations: {} }, part.contexts);
        sum(0, part.recordCount); sum(0, part.unsupportedPositionRecords);
        if (!to) { combined.tableSizes[count] = copy(part); return; }
        counters(to.counters, part.counters); contexts(to.contexts, part.contexts);
        to.recordCount = sum(to.recordCount, part.recordCount); to.unsupportedPositionRecords = sum(to.unsupportedPositionRecords, part.unsupportedPositionRecords);
        to.earliestPositionTrackedAt = earliest(to.earliestPositionTrackedAt, part.earliestPositionTrackedAt);
      });
      var p = player.profileProjection, out = combined.profileProjection;
      counters(out.counters, p.counters); latest(out, p); out.recordCount = sum(out.recordCount, p.recordCount);
      ['preflopTableSizeSum', 'preflopTableSizeOpportunities'].forEach(function (field) { out.profileContext[field] = sum(out.profileContext[field], p.profileContext[field]); });
    });
    return combined;
  }
  function disjointSingleVersion(ids, records) {
    var keys = new Set(ids.map(M.rawKey)), hands = new Set();
    return records.every(function (record) {
      var entries = record.players.filter(function (entry) { return keys.has(M.rawKey(entry.playerId)); });
      if (!entries.length) return true;
      if (hands.has(record.handKey) || entries.length !== 1 || entries[0].counters.hands !== 1 || record.supersedesFingerprint || !Number.isSafeInteger(record.finalizedAt) || record.finalizedAt <= 0) return false;
      hands.add(record.handKey); return true;
    });
  }
  function assertExact(player) {
    // Preserve the raw path's legacy behavior; grouping explicitly withholds unsafe sums.
    combinePlayers([player]);
    if (!Number.isSafeInteger(player.lastSeenAt) || player.lastSeenAt < 0) fail('UNSUPPORTED_COMBINED_METADATA');
  }
  function maintainedPopulationMatches(ids, pairs, records) {
    var counts = new Map(ids.map(function (id) { return [M.rawKey(id), 0]; }));
    records.forEach(function (record) { record.players.forEach(function (p) { var key = M.rawKey(p.playerId); if (counts.has(key)) counts.set(key, counts.get(key) + 1); }); });
    return pairs.every(function (pair, n) { var expected = counts.get(M.rawKey(ids[n])); return expected === 0 ? !pair[0] && !pair[1] : pair[0] && pair[1] && pair[0].player && pair[0].physicalRecordCount === expected && pair[0].player.recordCount === expected; });
  }
  function project(personId, player, physicalCount, filters, filtered) {
    assertExact(player);
    var target = M.personTarget(personId), cache = { player: player, physicalRecordCount: physicalCount }, scope = { position: filters.position, situation: filters.situation, tableSize: filters.tableSize };
    var output = { player: A.derivePlayer(player), core: scope.position || scope.situation || scope.tableSize ? I.identityQueries.context(cache, scope, '') : I.identityQueries.unfiltered(cache),
      comparisonContexts: I.identityQueries.comparisons(cache, 0, '', scope.tableSize), profileStats: I.identityQueries.profile(cache, scope), filtered: filtered || null };
    if (!output.filtered) { output.filtered = copy(output.core); output.filtered.filters = copy(filters); }
    function detach(row) {
      if (!row || typeof row !== 'object') return;
      if (Object.prototype.hasOwnProperty.call(row, 'playerId')) { delete row.playerId; row.target = copy(target); }
      if (Object.prototype.hasOwnProperty.call(row, 'playerRevision')) delete row.playerRevision;
      Object.keys(row).forEach(function (key) { if (key !== 'target') detach(row[key]); });
    }
    detach(output); return output;
  }
  function fromMaintained(personId, pairs, filters) {
    if (filters.counterpartMode) return null;
    var players = [], physical = 0;
    for (var pair of pairs) {
      var cache = pair[0], head = pair[1];
      // Missing heads are empty only when there is also no cache. Initialization is
      // guaranteed by the native adapter. Quarantine contexts never use this proof.
      if (!head && !cache) continue;
      if (!I.identityQueries.validSummaryHead(head) || head.contextHandKeys.length || !I.portability.validCache(cache, head) || cache.player.playerId !== head.playerId ||
          cache.physicalRecordCount !== cache.player.recordCount || cache.player.recordCount !== cache.player.counters.hands) return null;
      players.push(cache.player); physical = sum(physical, cache.physicalRecordCount);
    }
    // A tied native-name timestamp does not retain the canonical hand-order
    // witness needed for the existing reducer's name choice. Use records instead.
    for (var field of ['lastSeenAt', 'profileProjection']) {
      var seen = new Set();
      for (var p of players) { var at = field === 'profileProjection' ? p.profileProjection.lastSeenAt : p.lastSeenAt; if (at > 0 && seen.has(at)) return null; seen.add(at); }
    }
    return project(personId, combinePlayers(players), physical, filters);
  }
  function fromProjection(personId, statistics, filters) {
    if (filters.counterpartMode) return null;
    var player = copy(statistics.player); delete player.target; player.playerId = '';
    delete player.profileProjection.target; player.profileProjection.playerId = '';
    return project(personId, player, statistics.core.coverage.physicalRecordCount, filters);
  }
  function historicalSessionId(value) {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) fail('INVALID_HISTORICAL_SESSION_ID');
    return value;
  }
  function resolvedRecords(ids, records) {
    var resolution = A.rebuild(records), groups = new Map();
    records.forEach(function (record) { if (!groups.has(record.handKey)) groups.set(record.handKey, []); groups.get(record.handKey).push(record); });
    groups.forEach(function (group, handKey) { var evidence = V.group(ids, handKey, group, true); if (evidence.status !== 'SAFE') fail(evidence.status === 'CONFLICTING' ? 'PUBLISHED_OVERLAP' : 'AMBIGUOUS_CAREER_AUTHORITY'); });
    if (resolution.rejectedRecords.length || resolution.quarantinedHandKeys.length) fail('AMBIGUOUS_CAREER_AUTHORITY');
    return resolution;
  }
  function fromRecords(personId, ids, records, filters, selectedSessionId) {
    ids = V.members(ids); var keys = new Set(ids.map(M.rawKey)), resolution = resolvedRecords(ids, records);
    if (selectedSessionId !== undefined) {
      historicalSessionId(selectedSessionId);
      // Resolve complete peer/predecessor authority BEFORE selection. This is
      // a retained Person population, not a whole-ledger Session catalog.
      try { A.historicalSessionCatalogFromActive(resolution.activeRecords); }
      catch (_collision) { fail('AMBIGUOUS_SESSION_NAMESPACE'); }
      var selected = resolution.activeRecords.filter(function (record) { return record.schemaVersion >= 4 && record.session && record.session.sessionId === selectedSessionId && record.players.some(function (entry) { return keys.has(M.rawKey(entry.playerId)); }); });
      if (!selected.length) return null;
      var selectedKeys = new Set(selected.map(function (record) { return record.handKey; }));
      resolution = Object.assign({}, resolution, { activeRecords: selected, acceptedRecords: resolution.acceptedRecords.filter(function (record) { return selectedKeys.has(record.handKey); }) });
    }
    var player = null, ownActive = [], profileHands = 0, unsupported = 0;
    resolution.activeRecords.forEach(function (record) {
      var entries = record.players.filter(function (entry) { return keys.has(M.rawKey(entry.playerId)); }); if (!entries.length) return;
      ownActive.push(record); var situations = A.careerSituationMap(record);
      entries.forEach(function (entry) { player = A.foldQueryPlayer(player, record, entry, situations[String(entry.playerId)] || null); });
      if (entries.some(function (entry) { return !entry.position || entry.position.status !== 'supported' || !entry.position.dealtPosition; })) unsupported += 1;
      if (record.schemaVersion >= 3 && entries.some(function (entry) { return entry.position && entry.position.dealtPlayerCount >= 3; })) profileHands += 1;
    });
    player = player || emptyPlayer(); player.recordCount = ownActive.length; player.positionCoverage.unsupportedRecords = unsupported; player.profileProjection.recordCount = profileHands;
    var physical = resolution.acceptedRecords.filter(function (record) { return record.players.some(function (entry) { return keys.has(M.rawKey(entry.playerId)); }); }).length;
    var parts = ids.map(function (id) { return F.careerStatsFromResolved(resolution, id, filters); }), filtered = copy(parts[0]);
    filtered.counters = A.emptyCounters();
    Object.keys(filtered.coverage).forEach(function (field) {
      if (field === 'tableSizeHands') { filtered.coverage[field] = { HU: 0, '3_TO_5': 0, SIX_PLUS: 0 }; parts.forEach(function (part) { Object.keys(filtered.coverage[field]).forEach(function (key) { filtered.coverage[field][key] = sum(filtered.coverage[field][key], part.coverage[field][key]); }); }); }
      else if (field.indexOf('earliest') === 0) filtered.coverage[field] = parts.reduce(function (value, part) { return earliest(value, part.coverage[field]); }, null);
      else filtered.coverage[field] = parts.reduce(function (value, part) { return sum(value, part.coverage[field]); }, 0);
    });
    parts.forEach(function (part) { counters(filtered.counters, part.counters); }); filtered.derived = A.deriveCounters(filtered.counters);
    filtered.coverage.physicalRecordCount = physical;
    filtered.coverage.activeRecordCount = ownActive.filter(function (record) { return !filters.tableSize || A.classifyTableSize(A.resolveDealtPlayerCount(record)) === filters.tableSize; }).length;
    return project(personId, player, physical, filters, filtered);
  }
  function fromSessionRecords(personId, ids, records, sessionId, filters) { return fromRecords(personId, ids, records, filters, historicalSessionId(sessionId)); }
  function historyFromRecords(ids, records) {
    ids = V.members(ids); var keys = new Set(ids.map(M.rawKey)), resolution = resolvedRecords(ids, records), sessions = new Map(), unassignedHands = 0;
    try { A.historicalSessionCatalogFromActive(resolution.activeRecords); } catch (_collision) { fail('AMBIGUOUS_SESSION_NAMESPACE'); }
    resolution.activeRecords.forEach(function(record) {
      var hands = record.players.filter(function(p){return keys.has(M.rawKey(p.playerId));}).reduce(function(n,p){return sum(n,p.counters.hands);},0);
      if (!hands) return;
      if (record.schemaVersion < 4 || !record.session || !record.session.sessionId) { unassignedHands = sum(unassignedHands,hands); return; }
      var id=historicalSessionId(record.session.sessionId), row=sessions.get(id)||{sessionId:id,hands:0,firstRetainedAt:record.finalizedAt,lastRetainedAt:record.finalizedAt};
      row.hands=sum(row.hands,hands);row.firstRetainedAt=Math.min(row.firstRetainedAt,record.finalizedAt);row.lastRetainedAt=Math.max(row.lastRetainedAt,record.finalizedAt);sessions.set(id,row);
    });
    var rows=Array.from(sessions.values()).sort(function(a,b){return b.lastRetainedAt-a.lastRetainedAt||a.sessionId.localeCompare(b.sessionId);});
    return {sessions:rows.slice(0,50),totalSessions:rows.length,limited:rows.length>50,unassignedHands:unassignedHands};
  }
  function recentCount(value){if(!Number.isSafeInteger(value)||value<1||value>12)fail('INVALID_PERSON_RECENT_COUNT');return value;}
  function recentFromRecords(personId,ids,records,count,trends){
    count=recentCount(count);ids=V.members(ids);
    var resolution=resolvedRecords(ids,records),keysOfMembers=new Set(ids.map(M.rawKey));
    resolution.activeRecords.forEach(function(record){if(record.schemaVersion>=4&&record.session&&record.session.sessionId&&record.players.some(function(p){return keysOfMembers.has(M.rawKey(p.playerId))&&p.counters.hands>0;})&&record.finalizedAt<=0)fail('PERSON_SESSION_CHRONOLOGY_UNAVAILABLE');});
    var history=historyFromRecords(ids,records),rows=history.sessions.slice(0,count),selected=new Set(rows.map(function(row){return row.sessionId;})),groups=new Map();
    resolution.activeRecords.forEach(function(record){if(record.schemaVersion>=4&&record.session&&selected.has(record.session.sessionId)){if(!groups.has(record.session.sessionId))groups.set(record.session.sessionId,new Set());groups.get(record.session.sessionId).add(record.handKey);}});
    function physical(keys){return resolution.acceptedRecords.filter(function(record){return keys.has(record.handKey);});}
    var coverage={ordering:'LAST_RETAINED_CONTRIBUTION',requestedSessions:count,selectedSessionIds:rows.map(function(row){return row.sessionId;}),totalSessions:history.totalSessions,unassignedHands:history.unassignedHands,wholeSessionComplete:false};
    if(trends)return {recent:coverage,sessions:rows.map(function(row){var stats=fromRecords(personId,ids,physical(groups.get(row.sessionId)),F.normalizeFilters({}));return {sessionId:row.sessionId,hands:stats.player.counters.hands,counters:stats.player.counters,derived:stats.player.derived};})};
    var keys=new Set();groups.forEach(function(group){group.forEach(function(key){keys.add(key);});});
    var stats=fromRecords(personId,ids,physical(keys),F.normalizeFilters({}));stats.recent=coverage;return stats;
  }
  return Object.freeze({ combinePlayers: combinePlayers, disjointSingleVersion: disjointSingleVersion, maintainedPopulationMatches: maintainedPopulationMatches, fromMaintained: fromMaintained, fromProjection: fromProjection, fromRecords: fromRecords, fromSessionRecords: fromSessionRecords, historicalSessionId: historicalSessionId, historyFromRecords:historyFromRecords,recentCount:recentCount,recentFromRecords:recentFromRecords });
});
