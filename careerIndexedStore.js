/* Career-only IndexedDB persistence, structural Phase 1 migration, indexed queries, and export. */
(function (root, factory) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;
  var aggregator = root.PokerCareerStatsAggregator;
  var phaseOne = root.PokerCareerContributionStore;
  var filteredStats = root.PokerFilteredStats;
  if (typeof module !== 'undefined' && module.exports) {
    aggregator = require('./careerStatsAggregator.js');
    phaseOne = require('./careerContributionStore.js');
    filteredStats = require('./filteredStats.js');
  }
  var api = factory(aggregator, phaseOne, filteredStats);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerCareerIndexedStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Aggregator, PhaseOneStore, FilteredStats) {
  'use strict';

  var DATABASE_NAME = 'PokerNowHUDCareer';
  var DATABASE_VERSION = 5;
  var STORAGE_SCHEMA_VERSION = 2;
  var MIGRATION_MARKER_KEY = 'pokerNowHudCareerV2:migration';
  var OUTBOX_PREFIX = 'pokerNowHudCareerV2:outbox:';
  var MESSAGE_TYPE = 'PNHUD_CAREER_INDEXED_REQUEST';
  var STORE_RECORDS = 'careerRecords';
  var STORE_METADATA = 'careerMetadata';
  var STORE_AGGREGATES = 'careerAggregateCache';
  var STORE_PLAYER_HEADS = 'careerPlayerHeads';
  var STORE_SESSION_PROJECTIONS = 'careerSessionProjectionsByGeneration';
  var SESSION_PROJECTION_VERSION = 1;
  var SESSION_PROJECTION_STATE_KEY = 'sessionProjections';
  var SESSION_PROJECTION_CHUNK_GROUPS = 128;
  var STORE_HAND_MEMBERSHIPS = 'careerHandMembershipsByGeneration';
  var STORE_CONTROL = 'careerControl';
  var STORE_GENERATION_PROJECTIONS = 'careerSessionProjectionsByGeneration';
  var STORE_GENERATION_MEMBERSHIPS = 'careerHandMembershipsByGeneration';
  var BANKED_STORES = [STORE_RECORDS, STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS];
  var DERIVED_CLEANUP_STORES = ['careerSessionProjections', 'careerHandMemberships', STORE_GENERATION_PROJECTIONS, STORE_GENERATION_MEMBERSHIPS];
  var DERIVED_CLEANUP_KEY = 'derivedCleanup';
  var DERIVED_CLEANUP_MAX_ROWS = 128;
  var HAND_MEMBERSHIP_STATE_KEY = 'handMemberships';
  var HAND_MEMBERSHIP_VERSION = 1;
  // Derived metadata version only: no object-store, record, or backup schema change.
  var PLAYER_SUMMARY_VERSION = 2;

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function cloneDashboard(value) {
    if (Array.isArray(value)) return value.map(cloneDashboard);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).reduce(function (result, key) { result[key] = cloneDashboard(value[key]); return result; }, {});
  }
  function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (!value || typeof value !== 'object') return value; return Object.keys(value).sort().reduce(function (result, key) { if (value[key] !== undefined) result[key] = canonical(value[key]); return result; }, {}); }
  function canonicalJson(value) { return JSON.stringify(canonical(value)); }
  function phaseOneRecords(saved) {
    return Object.keys(saved || {}).filter(function (key) { return key.indexOf(PhaseOneStore.RECORD_PREFIX) === 0; }).sort().map(function (key) { return clone(saved[key]); });
  }
  function outboxKey(record) { return OUTBOX_PREFIX + encodeURIComponent(record.fingerprint); }
  function outboxRecords(saved) { return Object.keys(saved || {}).filter(function (key) { return key.indexOf(OUTBOX_PREFIX) === 0; }).sort().map(function (key) { return { key: key, record: clone(saved[key]) }; }); }
  function recordWrapper(record, sequence) {
    return {
      playerIds: record.players.map(function (entry) { return String(entry.playerId); }),
      sequence: Number(sequence || 0),
      record: clone(record)
    };
  }
  function initialMetadata(saved, options) {
    var old = saved && saved[PhaseOneStore.META_KEY] || {};
    var initializedAt = Number(old.careerTrackingStartedAt || options && options.initializedAt || Date.now());
    return {
      key: 'career', storageSchemaVersion: STORAGE_SCHEMA_VERSION, databaseVersion: DATABASE_VERSION,
      aggregateSchemaVersion: Aggregator.AGGREGATE_SCHEMA_VERSION,
      careerTrackingStartedAt: initializedAt,
      careerSchemaInitializedAt: Number(old.careerSchemaInitializedAt || initializedAt),
      initializedByBuildId: String(old.initializedByBuildId || options && options.buildId || ''),
      firstAcceptedHandKey: old.firstAcceptedHandKey || null,
      firstAcceptedAt: old.firstAcceptedAt || null,
      latestAcceptedAt: old.latestAcceptedAt || null,
      physicalRecordCount: 0, activeRecordCount: 0, quarantinedHandCount: 0, nextSequence: 0,
      migration: { fromStorageSchemaVersion: 1, state: 'pending', attempts: 0, completedAt: null, copiedRecordCount: 0 },
      backend: 'extension-service-worker-indexeddb'
    };
  }
  function physicalRecordCountForPlayer(records, playerId) {
    playerId = String(playerId);
    return (records || []).filter(function (record) { return (record.players || []).some(function (entry) { return String(entry.playerId) === playerId; }); }).length;
  }
  function physicalRecordCountsByPlayer(records) {
    var counts = {};
    (records || []).forEach(function (record) {
      var seen = new Set();
      (record.players || []).forEach(function (entry) {
        var id = String(entry.playerId);
        if (seen.has(id)) return;
        seen.add(id); counts[id] = Number(counts[id] || 0) + 1;
      });
    });
    return counts;
  }
  function cacheForPlayer(player, revision, physicalRecordCount) {
    return { playerId: player.playerId, aggregateSchemaVersion: Aggregator.AGGREGATE_SCHEMA_VERSION, revision: Number(revision || 0), physicalRecordCount: Math.max(0, Number(physicalRecordCount === undefined ? player.recordCount : physicalRecordCount)), player: clone(player) };
  }
  function validCache(cache, head) {
    var profile = cache && cache.player && cache.player.profileProjection;
    function validCounters(counters) { return Aggregator.COUNTER_FIELDS.every(function (field) { return Number.isInteger(counters && counters[field]) && counters[field] >= 0; }); }
    function validContexts(contexts) {
      return contexts && typeof contexts === 'object' && !Array.isArray(contexts) &&
        contexts.situations && typeof contexts.situations === 'object' && !Array.isArray(contexts.situations) &&
        contexts.positions && typeof contexts.positions === 'object' && !Array.isArray(contexts.positions) &&
        Object.keys(contexts.situations).every(function (key) { return (key === 'ip' || key === 'oop') && validCounters(contexts.situations[key]); }) &&
        Object.keys(contexts.positions).every(function (key) { return Aggregator.POSITION_LABELS.indexOf(key) >= 0 && validCounters(contexts.positions[key]); });
    }
    if (!cache || !head || cache.playerId !== head.playerId || cache.revision !== head.revision || cache.aggregateSchemaVersion !== Aggregator.AGGREGATE_SCHEMA_VERSION ||
      !cache.player || !validCounters(cache.player.counters) || !validContexts(cache.player.contexts) ||
      !cache.player.tableSizes || typeof cache.player.tableSizes !== 'object' || Array.isArray(cache.player.tableSizes) ||
      !Object.keys(cache.player.tableSizes).every(function (key) {
        var part = cache.player.tableSizes[key];
        return /^[2-9]$/.test(key) && part && validCounters(part.counters) && validContexts(part.contexts) &&
          Number.isInteger(part.recordCount) && part.recordCount >= 0 &&
          (part.earliestPositionTrackedAt === null || Number.isSafeInteger(part.earliestPositionTrackedAt) && part.earliestPositionTrackedAt >= 0) &&
          Number.isInteger(part.unsupportedPositionRecords) && part.unsupportedPositionRecords >= 0;
      }) || !cache.player.positionCoverage || !Number.isInteger(cache.player.positionCoverage.trackedHands) ||
      cache.player.positionCoverage.trackedHands < 0 ||
      !(cache.player.positionCoverage.earliestTrackedAt === null || Number.isSafeInteger(cache.player.positionCoverage.earliestTrackedAt) && cache.player.positionCoverage.earliestTrackedAt >= 0) ||
      !Number.isInteger(cache.player.positionCoverage.unsupportedRecords) || cache.player.positionCoverage.unsupportedRecords < 0 ||
      !profile || profile.version !== Aggregator.PROFILE_PROJECTION_VERSION || !validCounters(profile.counters) ||
      !profile.profileContext || profile.profileContext.version !== Aggregator.PROFILE_CONTEXT_VERSION || !Number.isInteger(cache.physicalRecordCount)) return false;
    return true;
  }
  function playerFromRecords(records, playerId) {
    var state = Aggregator.createState(records);
    return { player: Aggregator.playerStats(state, playerId), physicalRecordCount: physicalRecordCountForPlayer(records, playerId), rebuilt: { aggregate: state.aggregate, activeRecords: Aggregator.activeRecords(state), rejectedRecords: state.rejectedRecords } };
  }
  function summaryHead(playerId, revision, player, contextHandKeys) {
    return {
      playerId: String(playerId), revision: Number(revision || 0), summaryVersion: PLAYER_SUMMARY_VERSION,
      contextHandKeys: (contextHandKeys || []).slice(),
      summary: player ? clone({ latestDisplayName: player.latestDisplayName, hands: player.counters.hands, lastSeenAt: player.lastSeenAt }) : null
    };
  }
  function validSummaryHead(head) {
    if (!head || typeof head.playerId !== 'string' || !Number.isInteger(head.revision) || head.revision < 0 || head.summaryVersion !== PLAYER_SUMMARY_VERSION) return false;
    if (!Array.isArray(head.contextHandKeys) || !head.contextHandKeys.every(function (key) { return typeof key === 'string' && key.length > 0; })) return false;
    var summary = head.summary;
    return summary === null || Boolean(summary && typeof summary.latestDisplayName === 'string' && Number.isInteger(summary.hands) && summary.hands >= 0 && (summary.lastSeenAt === null || (typeof summary.lastSeenAt === 'number' && Number.isFinite(summary.lastSeenAt) && summary.lastSeenAt >= 0)));
  }
  function summariesReady(metadata, heads) {
    return Boolean(metadata && metadata.playerSummaryVersion === PLAYER_SUMMARY_VERSION && heads.every(validSummaryHead));
  }
  function summaryRows(heads) {
    return heads.filter(function (head) { return head.summary !== null; }).sort(function (a, b) { return a.playerId.localeCompare(b.playerId); }).map(function (head) {
      return Object.assign({ playerId: head.playerId, revision: head.revision, summaryVersion: head.summaryVersion }, clone(head.summary));
    });
  }
  function summaryYield() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }
  async function backfillSummaryHeads(wrappers, previousHeads) {
    // Single authoritative snapshot, independent of every aggregate cache. The
    // cooperative rebuild uses exactly the synchronous resolver and accumulator.
    var resolved = await Aggregator.rebuildCooperatively(wrappers.map(function (wrapper) { return wrapper.record; }), summaryYield);
    var revisions = new Map(previousHeads.map(function (head) { return [head.playerId, head.revision]; }));
    var accepted = new Set(resolved.acceptedRecords.map(function (record) { return record.fingerprint; }));
    var quarantined = new Set(resolved.quarantinedHandKeys); var contexts = new Map();
    wrappers.forEach(function (wrapper) {
      if (!accepted.has(wrapper.record.fingerprint)) return;
      wrapper.record.players.forEach(function (entry) {
        var id = String(entry.playerId); revisions.set(id, Math.max(revisions.get(id) || 0, Number(wrapper.sequence || 0)));
        if (quarantined.has(wrapper.record.handKey)) {
          if (!contexts.has(id)) contexts.set(id, new Set());
          contexts.get(id).add(wrapper.record.handKey);
        }
      });
    });
    return Array.from(revisions.keys()).sort().map(function (id) { return summaryHead(id, revisions.get(id), resolved.aggregate.players[id], Array.from(contexts.get(id) || []).sort()); });
  }
  function tableSelection(player, tableSize) {
    if (!tableSize) return { counters: player.counters, contexts: player.contexts, recordCount: player.recordCount };
    var selected = { counters: Aggregator.emptyCounters(), contexts: { situations: {}, positions: {} }, recordCount: 0, earliestPositionTrackedAt: null, unsupportedPositionRecords: 0 };
    Object.keys(player.tableSizes || {}).forEach(function (key) {
      if (Aggregator.classifyTableSize(Number(key)) !== tableSize) return;
      var part = player.tableSizes[key]; selected.recordCount += part.recordCount;
      selected.unsupportedPositionRecords += part.unsupportedPositionRecords;
      if (part.earliestPositionTrackedAt !== null) selected.earliestPositionTrackedAt = selected.earliestPositionTrackedAt === null
        ? part.earliestPositionTrackedAt : Math.min(selected.earliestPositionTrackedAt, part.earliestPositionTrackedAt);
      Aggregator.COUNTER_FIELDS.forEach(function (field) { selected.counters[field] += part.counters[field]; });
      ['situations', 'positions'].forEach(function (kind) { Object.keys(part.contexts[kind]).forEach(function (context) {
        var target = selected.contexts[kind][context] || (selected.contexts[kind][context] = Aggregator.emptyCounters());
        Aggregator.COUNTER_FIELDS.forEach(function (field) { target[field] += part.contexts[kind][context][field]; });
      }); });
    });
    return selected;
  }
  function tableCoverage(player, scope) {
    var counts = { HU: 0, '3_TO_5': 0, SIX_PLUS: 0 };
    Object.keys(player.tableSizes || {}).forEach(function (key) { var bucket = Aggregator.classifyTableSize(Number(key)); if (scope && scope.tableSize && bucket !== scope.tableSize) return; var part = player.tableSizes[key]; var counters = scope && scope.position ? part.contexts.positions[scope.position] : scope && scope.situation ? part.contexts.situations[scope.situation] : part.counters; if (counts[bucket] !== undefined) counts[bucket] += Number(counters && counters.hands || 0); });
    return counts;
  }
  function profileStatsFromCache(cache, scope) {
    if (!cache || !cache.player) return null;
    var player = cache.player; var counts = tableCoverage(player, scope);
    var bucket = scope.tableSize || ['HU', '3_TO_5', 'SIX_PLUS'].find(function (key) {
      var total = scope.position ? player.contexts.positions[scope.position] : scope.situation ? player.contexts.situations[scope.situation] : player.counters;
      return counts[key] > 0 && counts[key] === Number(total && total.hands || 0);
    });
    if (!bucket) return null;
    var counters = Aggregator.emptyCounters(); var sum = 0; var records = 0;
    Object.keys(player.tableSizes || {}).forEach(function (key) {
      if (Aggregator.classifyTableSize(Number(key)) !== bucket) return;
      var part = player.tableSizes[key]; var slice = scope.position ? part.contexts.positions[scope.position] : scope.situation ? part.contexts.situations[scope.situation] : part.counters;
      if (!slice) return;
      Aggregator.COUNTER_FIELDS.forEach(function (field) { counters[field] += slice[field]; });
      sum += Number(key) * slice.vpipOpportunities; records += part.recordCount;
    });
    return { version: Aggregator.PROFILE_PROJECTION_VERSION, playerId: player.playerId, latestDisplayName: player.latestDisplayName, lastSeenAt: player.lastSeenAt, recordCount: records, counters: counters, profileContext: { version: Aggregator.PROFILE_CONTEXT_VERSION, preflopTableSizeSum: sum, preflopTableSizeOpportunities: counters.vpipOpportunities }, tableSize: bucket };
  }
  function unfilteredResultFromCache(cache, tableSize) {
    if (!cache || !cache.player) return null;
    var player = cache.player;
    var selected = tableSelection(player, tableSize);
    var counters = clone(selected.counters);
    var tracked = tableSize ? Number(Object.values(selected.contexts.positions).reduce(function (sum, counters) { return sum + Number(counters.hands || 0); }, 0)) : Number(player.positionCoverage && player.positionCoverage.trackedHands || 0);
    return {
      schemaVersion: FilteredStats.SCHEMA_VERSION,
      playerId: String(player.playerId),
      filters: FilteredStats.normalizeFilters({}),
      counters: counters,
      derived: Aggregator.deriveCounters(counters),
      coverage: {
        totalCareerHands: Number(counters.hands || 0), positionTrackedHands: tracked, matchedPositionHands: tracked,
        situationTrackedHands: 0, matchedSituationHands: 0, excludedUnsupportedSituationHands: 0,
        relationalSupportedOpportunities: 0, matchedRelationalOpportunities: 0,
        earliestPositionTrackedAt: player.positionCoverage && player.positionCoverage.earliestTrackedAt || null,
        earliestRelationalTrackedAt: null, activeRecordCount: Number(selected.recordCount || 0),
        physicalRecordCount: Number(cache.physicalRecordCount || 0), tableSizeHands: tableCoverage(player), excludedUnsupportedPositionRecords: 0,
        excludedMissingCounterpartRecords: 0
      }
    };
  }
  function contextResultFromCache(cache, scope, playerId) {
    var player = cache && cache.player || { playerId: String(playerId), counters: Aggregator.emptyCounters(), contexts: { situations: {}, positions: {} }, positionCoverage: { trackedHands: 0, earliestTrackedAt: null, unsupportedRecords: 0 }, recordCount: 0 };
    var selected = tableSelection(player, scope.tableSize);
    var position = scope.position; var situation = scope.situation;
    var partition = position ? selected.contexts.positions[position] : situation ? selected.contexts.situations[situation] : selected.counters;
    var counters = clone(partition || Aggregator.emptyCounters());
    var total = Number(selected.counters.hands || 0);
    var tracked = scope.tableSize ? Number(Object.values(selected.contexts.positions).reduce(function (sum, counters) { return sum + Number(counters.hands || 0); }, 0)) : Number(player.positionCoverage.trackedHands || 0);
    var situationTracked = Number((selected.contexts.situations.ip && selected.contexts.situations.ip.hands || 0) + (selected.contexts.situations.oop && selected.contexts.situations.oop.hands || 0));
    return {
      schemaVersion: FilteredStats.SCHEMA_VERSION, playerId: String(player.playerId), filters: FilteredStats.normalizeFilters(scope),
      counters: counters, derived: Aggregator.deriveCounters(counters),
      coverage: {
        totalCareerHands: total, positionTrackedHands: tracked,
        matchedPositionHands: position ? Number(counters.hands || 0) : Number(situation ? counters.hands : tracked),
        situationTrackedHands: situation ? situationTracked : 0, matchedSituationHands: situation ? Number(counters.hands || 0) : 0,
        excludedUnsupportedSituationHands: situation ? total - situationTracked : 0,
        relationalSupportedOpportunities: 0, matchedRelationalOpportunities: 0,
        earliestPositionTrackedAt: scope.tableSize ? selected.earliestPositionTrackedAt : player.positionCoverage.earliestTrackedAt,
        earliestRelationalTrackedAt: null, activeRecordCount: Number(selected.recordCount || 0),
        physicalRecordCount: Number(cache && cache.physicalRecordCount || 0), tableSizeHands: tableCoverage(player, scope),
        excludedUnsupportedPositionRecords: position ? scope.tableSize ? selected.unsupportedPositionRecords : player.positionCoverage.unsupportedRecords : 0,
        excludedMissingCounterpartRecords: 0
      }
    };
  }
  function comparisonContextsFromCache(cache, revision, playerId, tableSize) {
    var contexts = cache && cache.player && tableSelection(cache.player, tableSize).contexts;
    var positions = {};
    Aggregator.POSITION_LABELS.forEach(function (position) {
      positions[position] = contexts && contexts.positions[position] ? contextResultFromCache(cache, { position: position, tableSize: tableSize }) : null;
    });
    return { playerId: String(playerId), source: 'career', playerRevision: Number(revision || 0),
      situations: {
        ip: contexts && contexts.situations.ip ? contextResultFromCache(cache, { situation: 'ip', tableSize: tableSize }) : null,
        oop: contexts && contexts.situations.oop ? contextResultFromCache(cache, { situation: 'oop', tableSize: tableSize }) : null
      }, positions: positions };
  }
  function recentCareerCacheUsable(cache, head) {
    // Table partitions contain ONLY positive contributions with exact dealt counts.
    // Equality proves no zero-hand/unknown entries can contaminate Recent's Career
    // reference population. Quarantined contexts and missing/stale caches use records.
    return validSummaryHead(head) && validCache(cache, head) && cache.player.playerId === head.playerId && !head.contextHandKeys.length &&
      (cache.player.positionCoverage.trackedHands === 0 || cache.player.positionCoverage.earliestTrackedAt > 0) &&
      Object.values(cache.player.tableSizes).reduce(function (sum, part) { return sum + part.recordCount; }, 0) === cache.player.recordCount;
  }
  function recentCareerFromCache(cache, playerId, filters) {
    var core = contextResultFromCache(cache, { position: filters.position, situation: filters.situation, tableSize: filters.tableSize }, playerId);
    // Recent's raw filter traversal reports matched supported positions even when
    // Overall is selected, and excludes all unsupported situations before matching.
    if (!filters.position && !filters.situation) core.coverage.matchedPositionHands = core.coverage.positionTrackedHands;
    if (filters.situation) core.coverage.excludedUnsupportedSituationHands = core.coverage.totalCareerHands - core.coverage.situationTrackedHands;
    var counts = { HU: 0, '3_TO_5': 0, SIX_PLUS: 0, UNKNOWN: 0 };
    Object.keys(cache.player.tableSizes).forEach(function (key) { counts[Aggregator.classifyTableSize(Number(key))] += cache.player.tableSizes[key].recordCount; });
    return { playerId: playerId, filters: filters, playerHandCount: cache.player.recordCount,
      playerTableSizeHands: counts, core: publicStatResult(core), relational: null,
      profileStats: profileStatsFromCache(cache, filters) };
  }
  function migrationPlan(saved, options) {
    var records = phaseOneRecords(saved);
    var resolved = Aggregator.rebuild(records);
    var hardFailures = resolved.rejectedRecords.filter(function (entry) { return entry.reason !== 'duplicate physical record'; });
    var meta = initialMetadata(saved, options || {});
    meta.migration.attempts = 1;
    if (hardFailures.length) {
      meta.migration.state = 'blocked';
      meta.migration.failures = hardFailures.slice(0, 20);
      return { ok: false, metadata: meta, records: records, resolved: resolved, reason: 'Phase 1 ledger contains records that cannot be migrated conservatively' };
    }
    var sequenceByFingerprint = {};
    resolved.acceptedRecords.forEach(function (record, index) { sequenceByFingerprint[record.fingerprint] = index + 1; });
    var maxRevisionByPlayer = {};
    resolved.activeRecords.forEach(function (record) { record.players.forEach(function (entry) { maxRevisionByPlayer[String(entry.playerId)] = Math.max(maxRevisionByPlayer[String(entry.playerId)] || 0, sequenceByFingerprint[record.fingerprint]); }); });
    meta.physicalRecordCount = resolved.acceptedRecords.length;
    meta.activeRecordCount = resolved.aggregate.ledgerRecordCount;
    meta.quarantinedHandCount = resolved.aggregate.quarantinedHandCount;
    meta.nextSequence = resolved.acceptedRecords.length;
    meta.migration.state = 'complete';
    meta.migration.completedAt = Number(options && options.migratedAt || Date.now());
    meta.migration.copiedRecordCount = resolved.acceptedRecords.length;
    meta.playerSummaryVersion = PLAYER_SUMMARY_VERSION;
    return {
      ok: true, metadata: meta, resolved: resolved,
      wrappers: resolved.acceptedRecords.map(function (record) { return recordWrapper(record, sequenceByFingerprint[record.fingerprint]); }),
      heads: Object.keys(resolved.aggregate.players).sort().map(function (playerId) { return summaryHead(playerId, maxRevisionByPlayer[playerId], resolved.aggregate.players[playerId]); }),
      caches: Object.keys(resolved.aggregate.players).sort().map(function (playerId) { return cacheForPlayer(resolved.aggregate.players[playerId], maxRevisionByPlayer[playerId] || 0, physicalRecordCountForPlayer(resolved.acceptedRecords, playerId)); })
    };
  }
  function replacementPlan(records, career, options) {
    options = options || {}; career = career || {};
    var restoredAt = Number(options.restoredAt || Date.now());
    var mutationMode = options.mode === 'merge' ? 'merge' : 'replace';
    var ordered = (records || []).map(clone).sort(function (left, right) { return left.handKey.localeCompare(right.handKey) || left.fingerprint.localeCompare(right.fingerprint); });
    var resolved = Aggregator.rebuild(ordered);
    if (resolved.rejectedRecords.length || resolved.acceptedRecords.length !== ordered.length || resolved.quarantinedHandKeys.length) return { ok: false, reason: 'replacement records failed deterministic validation', resolved: resolved };
    var sequenceByFingerprint = {};
    ordered.forEach(function (record, index) { sequenceByFingerprint[record.fingerprint] = index + 1; });
    var maxRevisionByPlayer = {}; var physicalCounts = physicalRecordCountsByPlayer(ordered);
    resolved.activeRecords.forEach(function (record) { record.players.forEach(function (entry) { var id = String(entry.playerId); maxRevisionByPlayer[id] = Math.max(maxRevisionByPlayer[id] || 0, sequenceByFingerprint[record.fingerprint]); }); });
    var metadata = {
      key: 'career', storageSchemaVersion: STORAGE_SCHEMA_VERSION, databaseVersion: DATABASE_VERSION,
      aggregateSchemaVersion: Aggregator.AGGREGATE_SCHEMA_VERSION,
      careerTrackingStartedAt: career.careerTrackingStartedAt,
      careerSchemaInitializedAt: career.careerSchemaInitializedAt,
      initializedByBuildId: String(career.initializedByBuildId || ''),
      firstAcceptedHandKey: career.firstAcceptedHandKey,
      firstAcceptedAt: career.firstAcceptedAt,
      latestAcceptedAt: career.latestAcceptedAt,
      physicalRecordCount: ordered.length,
      activeRecordCount: resolved.activeRecords.length,
      quarantinedHandCount: 0,
      nextSequence: ordered.length,
      migration: { fromStorageSchemaVersion: STORAGE_SCHEMA_VERSION, state: 'complete', attempts: 0, completedAt: restoredAt, copiedRecordCount: ordered.length },
      restore: { mode: mutationMode, backupFormatVersion: Number(options.backupFormatVersion || 1), payloadDigest: String(options.payloadDigest || ''), restoredAt: restoredAt },
      playerSummaryVersion: PLAYER_SUMMARY_VERSION,
      backend: 'extension-service-worker-indexeddb'
    };
    return {
      ok: true, metadata: metadata, resolved: resolved,
      wrappers: ordered.map(function (record) { return recordWrapper(record, sequenceByFingerprint[record.fingerprint]); }),
      heads: Object.keys(resolved.aggregate.players).sort().map(function (playerId) { return summaryHead(playerId, maxRevisionByPlayer[playerId], resolved.aggregate.players[playerId]); }),
      caches: Object.keys(resolved.aggregate.players).sort().map(function (playerId) { return cacheForPlayer(resolved.aggregate.players[playerId], maxRevisionByPlayer[playerId] || 0, physicalCounts[playerId] || 0); })
    };
  }
  function serializableExport(metadata, records) {
    return {
      exportSchemaVersion: 1,
      careerStorageSchemaVersion: STORAGE_SCHEMA_VERSION,
      recordSchemaVersion: Aggregator.RECORD_SCHEMA_VERSION,
      // Backup v1 carries immutable records, never the derived aggregate cache.
      aggregateSchemaVersion: 2,
      metadata: clone(metadata),
      records: records.map(clone).sort(function (left, right) { return left.handKey.localeCompare(right.handKey) || left.fingerprint.localeCompare(right.fingerprint); })
    };
  }
  function mergePreservesExisting(currentRecords, nextRecords) {
    var nextByFingerprint = new Map((nextRecords || []).map(function (record) { return [record.fingerprint, record]; }));
    return (currentRecords || []).every(function (record) {
      var next = nextByFingerprint.get(record.fingerprint);
      return next && canonicalJson(next) === canonicalJson(record);
    });
  }
  function normalizedPlayerIds(values) {
    return Array.from(new Set((Array.isArray(values) ? values : []).map(function (value) { return String(value || '').trim(); }).filter(Boolean))).slice(0, 64);
  }
  function sessionSummaries(records, playerId) {
    return Aggregator.historicalSessionCatalog(records).filter(function (summary) {
      return playerId === undefined || Number(summary.playerHandCounts[String(playerId)] || 0) > 0;
    }).map(function (summary) { return Aggregator.publicSessionSummary(summary, playerId); });
  }
  function sessionRecords(records, sessionId) {
    return Aggregator.resolveActiveRecords(records).activeRecords.filter(function (record) {
      return record.schemaVersion >= 4 && record.session.sessionId === sessionId;
    });
  }
  function requiredSessionPlayerId(value) {
    if (typeof value !== 'string' || !value || value.length > 500 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('canonical player ID is required for historical Session query');
    return value;
  }
  function requiredHistoricalSessionId(value) {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new TypeError('canonical historical Session ID is required');
    return value;
  }
  function normalizedSessionFilters(requested) {
    if (requested !== undefined && (!requested || typeof requested !== 'object' || Array.isArray(requested) || Object.getPrototypeOf(requested) !== Object.prototype)) throw new TypeError('historical Session filters must be a plain object');
    var filters = requested || {};
    var allowed = ['position', 'situation', 'tableSize', 'statId', 'counterpartMode', 'counterpartPlayerId', 'selfPlayerId'];
    if (Object.keys(filters).some(function (key) { return allowed.indexOf(key) < 0; })) throw new TypeError('unsupported historical Session filter');
    allowed.forEach(function (key) { if (filters[key] !== undefined && filters[key] !== null && typeof filters[key] !== 'string') throw new TypeError('historical Session filter values must be strings'); });
    var normalized = FilteredStats.normalizeFilters(filters);
    if (normalized.position && Aggregator.POSITION_LABELS.indexOf(normalized.position) < 0) throw new TypeError('unsupported position filter');
    if (normalized.statId && !FilteredStats.RELATIONAL_STATS[normalized.statId]) throw new TypeError('unsupported relational stat filter');
    if (normalized.statId && !normalized.counterpartMode) throw new TypeError('relational stat filter requires a counterpart mode');
    if (!normalized.counterpartMode && (normalized.counterpartPlayerId || normalized.selfPlayerId)) throw new TypeError('counterpart ID requires a relational filter');
    if (normalized.counterpartMode && normalized.counterpartMode !== 'specific' && normalized.counterpartMode !== 'self' && normalized.counterpartMode !== 'others') throw new TypeError('unsupported counterpart mode');
    if (normalized.counterpartPlayerId) requiredSessionPlayerId(normalized.counterpartPlayerId);
    if (normalized.selfPlayerId) requiredSessionPlayerId(normalized.selfPlayerId);
    return normalized;
  }
  function requiredRecentWindow(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).sort().join('|') !== 'count|type' || (value.type !== 'sessions' && value.type !== 'hands') ||
      !Number.isSafeInteger(value.count) || value.count < 1 || value.count > (value.type === 'sessions' ? 100 : 5000)) {
      throw new TypeError('recent window requires sessions (1-100) or hands (1-5000)');
    }
    return { type: value.type, count: value.count };
  }
  function recentSnapshot(records, playerId, selectedSessionIds) {
    playerId = requiredSessionPlayerId(playerId);
    var resolved = Aggregator.resolveActiveRecords(records || []);
    var catalog = Aggregator.historicalSessionCatalogFromActive(resolved.activeRecords);
    var hands = resolved.activeRecords.filter(function (record) {
      return record.players.some(function (entry) { return String(entry.playerId) === playerId && Number(entry.counters && entry.counters.hands || 0) > 0; });
    });
    var physical = new Map();
    resolved.physicalRecords.forEach(function (record) {
      if (!physical.has(record.handKey)) physical.set(record.handKey, []);
      physical.get(record.handKey).push(record);
    });
    return { playerId: playerId, resolved: resolved, catalog: catalog, hands: hands, physical: physical, selectedSessionIds: selectedSessionIds,
      query: { historyTraversals: 1, resolverPasses: 1, physicalRecordsRead: (records || []).length, activeRecordsExamined: resolved.activeRecords.length } };
  }
  function sessionIdOf(record) { return record.schemaVersion >= 4 && record.session ? record.session.sessionId : null; }
  function handTime(record) { return Number.isSafeInteger(record.finalizedAt) && record.finalizedAt > 0 ? record.finalizedAt : null; }
  function selectedResolution(snapshot, active) {
    var accepted = [];
    active.forEach(function (record) { (snapshot.physical.get(record.handKey) || []).forEach(function (physical) { accepted.push(physical); }); });
    return { activeRecords: active, acceptedRecords: accepted };
  }
  function composition(active) {
    var counts = { HU: 0, '3_TO_5': 0, SIX_PLUS: 0, UNKNOWN: 0 };
    active.forEach(function (record) { counts[Aggregator.classifyTableSize(Aggregator.resolveDealtPlayerCount(record))] += 1; });
    return counts;
  }
  function timeCoverage(active) {
    var times = active.map(handTime).filter(function (value) { return value !== null; });
    return { startedAt: times.length ? Math.min.apply(null, times) : null, endedAt: times.length ? Math.max.apply(null, times) : null, undatedHandCount: active.length - times.length };
  }
  function publicStatResult(value) {
    // The established AF derivation can be Infinity when calls are zero. JSON
    // cannot carry Infinity, so expose null plus the exact raw counters.
    return clone(value);
  }
  function profileForPopulation(active, physicalCount, playerId, filters) {
    var player = Aggregator.aggregateActiveRecords(active).players[playerId];
    return player ? profileStatsFromCache({ player: player, physicalRecordCount: physicalCount },
      { position: filters.position, situation: filters.situation, tableSize: filters.tableSize }) : null;
  }
  function recentFromSnapshot(snapshot, window, filters) {
    var active; var selectedSessionIds = []; var omittedUndatedHands = 0;
    if (window.type === 'sessions') {
      var participating = new Set(snapshot.hands.map(sessionIdOf).filter(Boolean));
      selectedSessionIds = snapshot.selectedSessionIds || snapshot.catalog.filter(function (row) { return participating.has(row.sessionId); }).slice(0, window.count).map(function (row) { return row.sessionId; });
      var selected = new Set(selectedSessionIds);
      active = snapshot.hands.filter(function (record) { return selected.has(sessionIdOf(record)); });
    } else {
      var dated = snapshot.hands.filter(function (record) { return handTime(record) !== null; });
      omittedUndatedHands = snapshot.hands.length - dated.length;
      if (snapshot.omittedUndatedHands !== undefined) omittedUndatedHands = snapshot.omittedUndatedHands;
      dated.sort(function (left, right) { return handTime(right) - handTime(left) ||
        left.handKey.localeCompare(right.handKey) || left.fingerprint.localeCompare(right.fingerprint); });
      active = dated.slice(0, window.count);
    }
    var resolution = selectedResolution(snapshot, active);
    var coreFilters = { position: filters.position, situation: filters.situation, tableSize: filters.tableSize };
    var results = FilteredStats.careerStatsBatchFromResolved(resolution, snapshot.playerId,
      filters.counterpartMode ? [coreFilters, filters] : [coreFilters]);
    var unassigned = { legacyHandCount: 0, unsupportedHandCount: 0 };
    active.forEach(function (record) {
      if (sessionIdOf(record)) return;
      if (record.schemaVersion < 4) unassigned.legacyHandCount += 1;
      else unassigned.unsupportedHandCount += 1;
    });
    return { playerId: snapshot.playerId, window: window, filters: filters,
      selectedSessionIds: selectedSessionIds, selectedSessionCount: selectedSessionIds.length,
      selectedPlayerHandCount: active.length, timeCoverage: timeCoverage(active),
      playerTableSizeHands: composition(active), unassigned: unassigned, omittedUndatedHands: omittedUndatedHands,
      core: publicStatResult(results[0]), relational: filters.counterpartMode ? publicStatResult(results[1]) : null,
      profileStats: profileForPopulation(active, resolution.acceptedRecords.length, snapshot.playerId, filters),
      query: Object.assign({}, snapshot.query, { selectedPhysicalRecords: resolution.acceptedRecords.length }) };
  }
  function statMeasures(core) {
    var c = core.counters, d = core.derived;
    var spec = { vpip: ['vpipMade', 'vpipOpportunities'], pfr: ['pfrMade', 'pfrOpportunities'],
      af: ['postflopAggressiveActions', 'postflopCalls'], threeBet: ['threeBetMade', 'threeBetOpportunities'],
      foldToThreeBet: ['foldToThreeBet', 'foldToThreeBetOpportunities'], flopCBet: ['flopCBetMade', 'flopCBetOpportunities'],
      foldToFlopCBet: ['foldToFlopCBet', 'foldToFlopCBetOpportunities'], wtsd: ['wtsdMade', 'wtsdOpportunities'],
      wsd: ['wsdMade', 'wsdOpportunities'] };
    return Object.keys(spec).reduce(function (output, key) {
      var numerator = c[spec[key][0]], denominator = c[spec[key][1]];
      var evidenceApi = typeof module !== 'undefined' && module.exports ? require('./statEvidence.js') : globalThis.PokerStatEvidence;
      var evidence = evidenceApi.evaluateStatEvidence({ statKey: key, numerator: numerator, opportunities: denominator,
        aggressiveActions: key === 'af' ? numerator : undefined, calls: key === 'af' ? denominator : undefined });
      output[key] = { value: Number.isFinite(d[key]) && (key === 'af' ? numerator + denominator > 0 : denominator > 0) ? d[key] : null,
        numerator: numerator, denominator: denominator, supportCount: evidence.supportCount, evidenceStatus: evidence.status,
        evidenceLevel: evidence.level, supportType: evidence.supportType,
        nonFinite: key === 'af' && numerator > 0 && denominator === 0 };
      return output;
    }, {});
  }
  function careerRecentPlayerStatsFromRecords(records, playerId, requestedWindow, requestedFilters) {
    var window = requiredRecentWindow(requestedWindow), filters = normalizedSessionFilters(requestedFilters);
    return recentFromSnapshot(recentSnapshot(records, playerId), window, filters);
  }
  function careerRecentVsCareerFromRecords(records, playerId, requestedWindow, requestedFilters) {
    var window = requiredRecentWindow(requestedWindow), filters = normalizedSessionFilters(requestedFilters);
    return recentComparisonFromSnapshot(recentSnapshot(records, playerId), window, filters);
  }
  function requiredRecentBatchFilters(filters) {
    if (!Array.isArray(filters) || filters.length < 1 || filters.length > 4) throw new TypeError('Recent batch requires 1–4 filter contexts');
    return filters.map(normalizedSessionFilters);
  }
  function recentBatchFromRecords(records, playerId, requestedWindow, requestedFilters) {
    var window = requiredRecentWindow(requestedWindow), filters = requiredRecentBatchFilters(requestedFilters);
    var snapshot = recentSnapshot(records, playerId);
    return filters.map(function (filter, index) { return index === 0 ? recentComparisonFromSnapshot(snapshot, window, filter) : recentFromSnapshot(snapshot, window, filter); });
  }
  function careerPopulationFromSnapshot(snapshot, filters) {
    var whole = selectedResolution(snapshot, snapshot.hands);
    var coreFilters = { position: filters.position, situation: filters.situation, tableSize: filters.tableSize };
    var results = FilteredStats.careerStatsBatchFromResolved(whole, snapshot.playerId,
      filters.counterpartMode ? [coreFilters, filters] : [coreFilters]);
    return { playerId: snapshot.playerId, filters: filters, playerHandCount: snapshot.hands.length,
      playerTableSizeHands: composition(snapshot.hands), core: publicStatResult(results[0]),
      relational: filters.counterpartMode ? publicStatResult(results[1]) : null,
      profileStats: profileForPopulation(snapshot.hands, whole.acceptedRecords.length, snapshot.playerId, filters) };
  }
  function recentComparisonFromSnapshot(snapshot, window, filters, baseline) {
    var recent = recentFromSnapshot(snapshot, window, filters);
    var career = baseline || careerPopulationFromSnapshot(snapshot, filters);
    return recentComparisonResult(recent, career, snapshot.query);
  }
  function recentComparisonResult(recent, career, query) {
    var filters = recent.filters;
    var recentMeasures = statMeasures(recent.core), careerMeasures = statMeasures(career.core), comparison = {};
    if (filters.counterpartMode) {
      recentMeasures[filters.statId] = statMeasures(recent.relational)[filters.statId];
      careerMeasures[filters.statId] = statMeasures(career.relational)[filters.statId];
    }
    Object.keys(recentMeasures).forEach(function (key) {
      var a = recentMeasures[key], b = careerMeasures[key];
      comparison[key] = { unit: key === 'af' ? 'ratio' : 'percentage_points', recentValue: a.value, careerValue: b.value,
        delta: a.value === null || b.value === null ? null : Math.round((a.value - b.value) * 100) / 100,
        recentNumerator: a.numerator, careerNumerator: b.numerator,
        recentOpportunities: key === 'af' ? null : a.denominator, careerOpportunities: key === 'af' ? null : b.denominator,
        recentCalls: key === 'af' ? a.denominator : null, careerCalls: key === 'af' ? b.denominator : null,
        recentSupport: { count: a.supportCount, type: a.supportType, status: a.evidenceStatus, level: a.evidenceLevel },
        careerSupport: { count: b.supportCount, type: b.supportType, status: b.evidenceStatus, level: b.evidenceLevel },
        recentNonFinite: a.nonFinite, careerNonFinite: b.nonFinite };
    });
    return { playerId: recent.playerId, window: recent.window, recent: recent, career: career, comparison: comparison,
      query: Object.assign({}, query, { selectedPhysicalRecords: recent.query.selectedPhysicalRecords,
        careerPhysicalRecords: career.core.coverage.physicalRecordCount }) };
  }
  function careerPlayerSessionTrendFromRecords(records, playerId, requested) {
    var filters = normalizedSessionFilters(requested);
    var snapshot = recentSnapshot(records, playerId), bySession = new Map();
    snapshot.hands.forEach(function (record) {
      var id = sessionIdOf(record); if (!id) return;
      if (!bySession.has(id)) bySession.set(id, []);
      bySession.get(id).push(record);
    });
    var points = snapshot.catalog.filter(function (row) { return bySession.has(row.sessionId); }).reverse().map(function (row) {
      var active = bySession.get(row.sessionId), resolution = selectedResolution(snapshot, active);
      var coreFilters = { position: filters.position, situation: filters.situation, tableSize: filters.tableSize };
      var results = FilteredStats.careerStatsBatchFromResolved(resolution, snapshot.playerId,
        filters.counterpartMode ? [coreFilters, filters] : [coreFilters]);
      var core = publicStatResult(results[0]);
      var relational = filters.counterpartMode ? publicStatResult(results[1]) : null;
      var measures = statMeasures(core);
      if (relational) measures[filters.statId] = statMeasures(relational)[filters.statId];
      return { sessionId: row.sessionId, provenanceStatus: row.provenanceStatus, startedAt: row.startedAt, endedAt: row.endedAt,
        sessionHandCount: row.handCount, playerHandCount: active.length, playerTableSizeHands: composition(active),
        core: core, relational: relational, stats: measures };
    });
    return { playerId: snapshot.playerId, filters: filters, order: 'endedAt-ascending-sessionId-descending', points: points,
      unassigned: { legacyHandCount: snapshot.hands.filter(function (record) { return !sessionIdOf(record) && record.schemaVersion < 4; }).length,
        unsupportedHandCount: snapshot.hands.filter(function (record) { return !sessionIdOf(record) && record.schemaVersion >= 4; }).length },
      query: Object.assign({}, snapshot.query, { sessionPopulationsComputed: points.length }) };
  }
  function trendRange(value) {
    if (value === undefined || value === 'all') return 'all';
    if (!Number.isInteger(value) || value < 1 || value > 200) throw new TypeError('Session Trend range requires all or 1–200 Sessions');
    return value;
  }
  function trendRangeResult(result, range, requested) {
    if (requested !== undefined) {
      result.totalSessionCount = result.points.length;
      result.range = range;
      if (range !== 'all') result.points = result.points.slice(-range);
    }
    return result;
  }
  function historicalPlayerSessionPopulation(records, playerId) {
    playerId = requiredSessionPlayerId(playerId);
    var resolution = Aggregator.resolveActiveRecords(records || []);
    var catalog = Aggregator.historicalSessionCatalogFromActive(resolution.activeRecords);
    var groups = new Map(); var legacyHandCount = 0; var unsupportedHandCount = 0;
    resolution.activeRecords.forEach(function (record) {
      var entry = record.players.find(function (candidate) { return candidate.playerId === playerId && Number(candidate.counters && candidate.counters.hands || 0) > 0; });
      if (!entry) return;
      var id = record.schemaVersion >= 4 && record.session && record.session.sessionId;
      if (!id) { if (record.schemaVersion >= 4) unsupportedHandCount += 1; else legacyHandCount += 1; return; }
      var group = groups.get(id);
      if (!group) { group = { records: [], activeRecords: [], tableSizeHands: { HU: 0, '3_TO_5': 0, SIX_PLUS: 0, UNKNOWN: 0 } }; groups.set(id, group); }
      group.activeRecords.push(record);
      group.tableSizeHands[Aggregator.classifyTableSize(Aggregator.resolveDealtPlayerCount(record))] += 1;
    });
    var activeHandKeys = new Set();
    groups.forEach(function (group) { group.activeRecords.forEach(function (record) { activeHandKeys.add(record.handKey); }); });
    resolution.physicalRecords.forEach(function (record) {
      if (!activeHandKeys.has(record.handKey)) return;
      var id = record.schemaVersion >= 4 && record.session && record.session.sessionId;
      var group = groups.get(id);
      if (group) group.records.push(record);
    });
    return { catalog: catalog, groups: groups, unassigned: { legacyHandCount: legacyHandCount, unsupportedHandCount: unsupportedHandCount },
      query: { historyTraversals: 1, resolverPasses: 1, physicalRecordsRead: (records || []).length, activeRecordsExamined: resolution.activeRecords.length } };
  }
  function playerSessionSummary(summary, group, playerId) {
    var stats = FilteredStats.careerStatsFromResolved({ activeRecords: group.activeRecords, acceptedRecords: group.records }, playerId, {});
    return { sessionId: summary.sessionId, provenanceStatus: summary.provenanceStatus, startedAt: summary.startedAt, endedAt: summary.endedAt,
      playerId: playerId, playerHandCount: group.activeRecords.length, sessionHandCount: summary.handCount,
      tableSizeHands: clone(summary.tableSizeHands), playerTableSizeHands: clone(group.tableSizeHands),
      stats: { counters: stats.counters, derived: stats.derived }, coverage: stats.coverage };
  }
  function listCareerSessionPlayerSummariesFromRecords(records, playerId) {
    var population = historicalPlayerSessionPopulation(records, playerId);
    var sessions = population.catalog.filter(function (summary) { return population.groups.has(summary.sessionId); }).map(function (summary) {
      return playerSessionSummary(summary, population.groups.get(summary.sessionId), playerId);
    });
    return { playerId: playerId, sessions: sessions, unassigned: population.unassigned,
      query: Object.assign({}, population.query, { sessionPopulationsComputed: sessions.length }) };
  }
  function careerSessionPlayerStatsFromRecords(records, sessionId, playerId, requested) {
    sessionId = requiredHistoricalSessionId(sessionId); playerId = requiredSessionPlayerId(playerId);
    var filters = normalizedSessionFilters(requested);
    var population = historicalPlayerSessionPopulation(records, playerId);
    var summary = population.catalog.find(function (candidate) { return candidate.sessionId === sessionId; });
    var group = population.groups.get(sessionId);
    if (!summary || !group) return null;
    var scope = { position: filters.position, situation: filters.situation, tableSize: filters.tableSize };
    var requests = [scope, { situation: 'ip', tableSize: filters.tableSize }, { situation: 'oop', tableSize: filters.tableSize }];
    Aggregator.POSITION_LABELS.forEach(function (position) { requests.push({ position: position, tableSize: filters.tableSize }); });
    if (filters.counterpartMode) requests.push(filters);
    var results = FilteredStats.careerStatsBatchFromResolved({ activeRecords: group.activeRecords, acceptedRecords: group.records }, playerId, requests);
    var positions = {};
    Aggregator.POSITION_LABELS.forEach(function (position, index) { positions[position] = results[index + 3].counters.hands ? results[index + 3] : null; });
    var aggregate = Aggregator.aggregateActiveRecords(group.activeRecords);
    var player = aggregate.players[playerId] || null;
    var cache = player ? { player: player, physicalRecordCount: group.records.length } : null;
    return { session: playerSessionSummary(summary, group, playerId), playerId: playerId, filters: filters,
      core: results[0], relational: filters.counterpartMode ? results[results.length - 1] : null,
      comparisonContexts: { situations: { ip: results[1].counters.hands ? results[1] : null, oop: results[2].counters.hands ? results[2] : null }, positions: positions },
      profileStats: profileStatsFromCache(cache, scope),
      query: Object.assign({}, population.query, { sessionPhysicalRecordsSelected: group.records.length, sessionActiveHandsSelected: group.activeRecords.length }) };
  }
  function removalError(message, code) {
    var error = new TypeError(message);
    error.code = code || 'CAREER_SESSION_REMOVAL_INVALID';
    return error;
  }
  // Raw query folds keep scalar counter/coverage/profile witnesses, never hands.
  // The accepted resolver's stable locale order uses the first valid physical
  // fingerprint in native primary-key order to break collation-equal hand keys.
  function rawOrder(left, right) {
    return left[0].localeCompare(right[0]) || (left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0);
  }
  function rawMinimum() {
    var first = null, lastNull = null, count = 0, minimum, only;
    return {
      add: function (value, order) {
        if (value === null) { if (!lastNull || rawOrder(lastNull, order) < 0) lastNull = order; return; }
        if (!first || rawOrder(order, first) < 0) first = order;
        only = value; minimum = count++ ? Math.min(minimum, value) : Number(value);
      },
      value: function () {
        if (!count) return null;
        if (lastNull && rawOrder(lastNull, first) > 0) return Math.min(minimum, 0);
        return count === 1 ? only : minimum;
      }
    };
  }
  function rawStatsFold(playerId, filters) {
    var value = FilteredStats.careerStatsFromResolved({ activeRecords: [], acceptedRecords: [] }, playerId, filters);
    var position = rawMinimum(), relational = rawMinimum();
    return {
      add: function (record, physicalCount, order) {
        var delta = FilteredStats.careerStatsFromResolved({ activeRecords: [record], acceptedRecords: { length: physicalCount } }, playerId, filters);
        Aggregator.COUNTER_FIELDS.forEach(function (key) { value.counters[key] += delta.counters[key]; });
        Object.keys(value.coverage).forEach(function (key) {
          if (key === 'earliestPositionTrackedAt' || key === 'earliestRelationalTrackedAt') return;
          if (key === 'tableSizeHands') Object.keys(value.coverage[key]).forEach(function (bucket) { value.coverage[key][bucket] += delta.coverage[key][bucket]; });
          else value.coverage[key] += delta.coverage[key];
        });
        if (delta.coverage.positionTrackedHands > 0) position.add(delta.coverage.earliestPositionTrackedAt, order);
        if (delta.coverage.relationalSupportedOpportunities > 0) relational.add(delta.coverage.earliestRelationalTrackedAt, order);
      },
      value: function () {
        value.coverage.earliestPositionTrackedAt = position.value(); value.coverage.earliestRelationalTrackedAt = relational.value();
        value.derived = Aggregator.deriveCounters(value.counters); return value;
      },
      unsafe: function () {
        return Aggregator.COUNTER_FIELDS.some(function (key) { return !Number.isSafeInteger(value.counters[key]); }) ||
          Object.keys(value.coverage).some(function (key) { return key.indexOf('earliest') !== 0 && key !== 'tableSizeHands' && !Number.isSafeInteger(value.coverage[key]); });
      }
    };
  }
  function rawPopulationFold(playerId, requests, profile, ordered) {
    var folds = requests.map(function (filter) { return rawStatsFold(playerId, filter); }), player = null, name = null, nameReplay = false;
    var count = 0, physical = 0, tables = composition([]), started = null, ended = null, undated = 0;
    var unassigned = { legacyHandCount: 0, unsupportedHandCount: 0 };
    return {
      add: function (record, physicalCount, order) {
        count++; physical += physicalCount; tables[Aggregator.classifyTableSize(Aggregator.resolveDealtPlayerCount(record))]++;
        var at = handTime(record);
        if (at === null) undated++; else { started = started === null ? at : Math.min(started, at); ended = ended === null ? at : Math.max(ended, at); }
        if (!sessionIdOf(record)) unassigned[record.schemaVersion < 4 ? 'legacyHandCount' : 'unsupportedHandCount']++;
        folds.forEach(function (fold) { fold.add(record, physicalCount, order); });
        if (profile) {
          var entry = record.players.find(function (entry) { return String(entry.playerId) === playerId; });
          player = Aggregator.foldQueryPlayer(player, record, entry, Aggregator.careerSituationMap(record)[playerId]);
          var time = Number(record.finalizedAt || 0);
          if (!entry.displayName || Number.isNaN(time)) nameReplay = true;
          if (entry.displayName && time >= 0 && (!name || time > name.time || time === name.time && rawOrder(order, name.order) > 0))
            name = { time: time, order: order, value: String(entry.displayName) };
          if (!ordered) player.latestDisplayName = name ? name.value : '';
        }
      },
      value: function () { return { results: folds.map(function (fold) { return fold.value(); }), player: player,
        orderedReplay: !ordered && (nameReplay || folds.some(function (fold) { return fold.unsafe(); }) ||
          player && Aggregator.COUNTER_FIELDS.some(function (key) { return !Number.isSafeInteger(player.counters[key]); })),
        count: count, physical: physical, tables: tables, time: { startedAt: started, endedAt: ended, undatedHandCount: undated }, unassigned: unassigned }; }
    };
  }
  function rawSessionOrder(a, b) {
    return (b.endedAt === null ? -1 : b.endedAt) - (a.endedAt === null ? -1 : a.endedAt) || a.sessionId.localeCompare(b.sessionId);
  }
  function rawKeep(rows, value, limit, compare) {
    if (limit === 'all') { rows.push(value); return; }
    var low = 0, high = rows.length;
    while (low < high) { var middle = (low + high) >>> 1; if (compare(rows[middle], value) <= 0) low = middle + 1; else high = middle; }
    if (low < limit) { rows.splice(low, 0, value); if (rows.length > limit) rows.pop(); }
  }
  // At most eight raw wrappers plus seven valid chain records. More than seven
  // VALID versions cannot form an accepted strictly advancing semantic chain.
  // Invalid wrappers do not count toward that bound and cannot quarantine a
  // surviving valid chain. External predecessor presence is checked sequentially.
  function readRawGroup(tx, key, metrics, complete, fail) {
    var store = tx.objectStore(STORE_RECORDS), valid = [], overflow = false, minimum = null;
    function accept(wrapper) {
      metrics.physicalRecordsRead++;
      var record = wrapper.record;
      if (Aggregator.validateRecord(record)) return;
      if (minimum === null || record.fingerprint < minimum) minimum = record.fingerprint;
      if (valid.length < 7) valid.push(record); else overflow = true;
      metrics.maxChainRecords = Math.max(metrics.maxChainRecords, valid.length);
    }
    function finish() {
      if (overflow) { complete(null, 0, [key, minimum]); return; }
      var position = 0;
      function predecessors() {
        while (position < valid.length) {
          var child = valid[position++], fp = child.supersedesFingerprint;
          if (!fp || valid.some(function (row) { return row.fingerprint === fp; })) continue;
          var request = store.get(fp);
          request.onsuccess = function () { try {
            metrics.predecessorReads++;
            // Any valid foreign predecessor fails transition. Missing/invalid
            // predecessors also quarantine; none can resurrect an earlier tip.
            complete(null, 0, [key, minimum]);
          } catch (error) { fail(error); } }; return;
        }
        var resolved = Aggregator.resolveActiveRecords(valid);
        metrics.resolverPasses++; metrics.maxResolverRecords = Math.max(metrics.maxResolverRecords, valid.length);
        var active = resolved.activeRecords[0] || null;
        complete(active, resolved.physicalRecords.length, [key, minimum]);
      }
      predecessors();
    }
    var request = store.index('handKey').getAll(key, 8);
    request.onsuccess = function () { try {
      metrics.maxPageRecords = Math.max(metrics.maxPageRecords, request.result.length);
      if (request.result.length < 8) { request.result.forEach(accept); finish(); return; }
      // A malformed group may have arbitrarily many invalid wrappers. Cursor it
      // without retaining them; do not equate eight wrappers with eight versions.
      var cursor = store.index('handKey').openCursor(IDBKeyRange.only(key));
      cursor.onsuccess = function () { try { if (!cursor.result) { finish(); return; } accept(cursor.result.value); cursor.result.continue(); } catch (error) { fail(error); } };
    } catch (error) { fail(error); } };
  }
  function rawHandTraversal(tx, metrics, consume, complete, fail) {
    var request = tx.objectStore(STORE_RECORDS).index('handKey').openKeyCursor(null, 'nextunique');
    metrics.historyTraversals++;
    request.onsuccess = function () { try {
      var cursor = request.result;
      if (!cursor) { complete(); return; }
      readRawGroup(tx, cursor.key, metrics, function (active, physical, order) {
        if (active) { metrics.authoritativeLogicalHandsEmitted++; metrics.activeRecordsExamined++; consume(active, physical, order); } cursor.continue();
      }, fail);
    } catch (error) { fail(error); } };
  }
  // The Session index supplies a bounded global namespace witness: one Session
  // at a time, including unrelated players. Emit only the cursor's active tip.
  function rawSessionTraversal(tx, metrics, start, consume, end, complete, fail) {
    var request = tx.objectStore(STORE_RECORDS).index('sessionId').openCursor(), current = null, summary;
    metrics.historyTraversals++;
    function read(cursor) { try {
      if (!cursor) { complete(); return; }
      metrics.sessionCandidatesVisited++;
      var fingerprint = cursor.value.record.fingerprint;
      readRawGroup(tx, cursor.value.record.handKey, metrics, function (active, physical, order) {
        if (active && active.fingerprint === fingerprint && sessionIdOf(active) === current) {
          metrics.authoritativeLogicalHandsEmitted++; metrics.activeRecordsExamined++;
          if (!summary) summary = { sessionId: current, provenanceStatus: 'explicit', startedAt: null, endedAt: null,
            handCount: 0, tableSizeHands: composition([]), namespace: active.namespace, playerHandCounts: Object.create(null) };
          if (summary.namespace.provider !== active.namespace.provider || summary.namespace.host !== active.namespace.host || summary.namespace.gameId !== active.namespace.gameId)
            throw new TypeError('historical Session ID collides across game namespaces');
          summary.handCount++;
          var at = Number.isSafeInteger(active.finalizedAt) && active.finalizedAt >= 0 ? active.finalizedAt : null;
          if (at !== null) { summary.startedAt = summary.startedAt === null ? at : Math.min(summary.startedAt, at); summary.endedAt = summary.endedAt === null ? at : Math.max(summary.endedAt, at); }
          summary.tableSizeHands[Aggregator.classifyTableSize(Aggregator.resolveDealtPlayerCount(active))]++;
          // Consumers need only their selected-player membership, never a
          // population of all historical player identities.
          consume(summary, active, physical, order);
        }
        cursor.continue();
      }, fail);
    } catch (error) { fail(error); } }
    request.onsuccess = function () { try {
      var cursor = request.result;
      if (!cursor || cursor.key !== current) {
        var previous = summary; summary = null; current = cursor && cursor.key;
        function proceed() { if (cursor) start(current); read(cursor); }
        if (previous) { end(previous, proceed); return; }
        proceed(); return;
      }
      read(cursor);
    } catch (error) { fail(error); } };
  }
  function rawUnassignedTraversal(tx, metrics, consume, complete, fail) {
    var request = tx.objectStore(STORE_RECORDS).openCursor(); metrics.historyTraversals++;
    request.onsuccess = function () { try {
      var cursor = request.result;
      if (!cursor) { complete(); return; }
      metrics.unassignedCandidatesVisited = Number(metrics.unassignedCandidatesVisited || 0) + 1;
      var record = cursor.value.record;
      if (sessionIdOf(record)) { cursor.continue(); return; }
      readRawGroup(tx, record.handKey, metrics, function (active, physical, order) {
        if (active && active.fingerprint === record.fingerprint && !sessionIdOf(active)) {
          metrics.authoritativeLogicalHandsEmitted++; metrics.activeRecordsExamined++; consume(active, physical, order);
        }
        cursor.continue();
      }, fail);
    } catch (error) { fail(error); } };
  }
  // Exceptional floating sums / missing-name prefix maxima require the exact
  // resolver order. Repeated bounded selection keeps 64 compact references,
  // never records or a whole-history sort. Every pass advances its last witness.
  function rawOrderedPopulation(tx, metrics, playerId, requests, profile, includes, complete, fail) {
    var fold = rawPopulationFold(playerId, requests, profile, true), after = null;
    function page() {
      var references = [];
      rawHandTraversal(tx, metrics, function (record, physical, order) {
        if (includes(record) && (!after || rawOrder(order, after) > 0)) rawKeep(references, { key: record.handKey, order: order }, 64,
          function (a, b) { return rawOrder(a.order, b.order); });
        metrics.maxOrderReferences = Math.max(metrics.maxOrderReferences || 0, references.length);
      }, function () {
        var index = 0;
        function consume() {
          if (index === references.length) {
            if (references.length < 64) { complete(fold.value()); return; }
            after = references[references.length - 1].order; page(); return;
          }
          readRawGroup(tx, references[index++].key, metrics, function (record, physical, order) { fold.add(record, physical, order); consume(); }, fail);
        }
        consume();
      }, fail);
    }
    page();
  }
  function normalizedRemovalRequest(request) {
    request = request || {};
    var source = request.namespace || {};
    var namespace = {
      provider: String(source.provider || '').toLowerCase(),
      host: String(source.host || '').toLowerCase(),
      gameId: String(source.gameId || '')
    };
    if (namespace.provider !== 'pokernow' || !namespace.host || !namespace.gameId) throw removalError('Exact PokerNow room provenance is required for Career Session removal');
    var supplied = Array.isArray(request.sessionHandIds) ? request.sessionHandIds : [];
    if (supplied.length > 10000) throw removalError('Current Session hand provenance exceeds the supported removal bound');
    var handIds = [];
    var seen = new Set();
    supplied.forEach(function (value) {
      var id = value === null || value === undefined ? '' : String(value);
      if (!id || id.length > 500 || id.trim() !== id || /[\u0000-\u001f\u007f]/.test(id)) throw removalError('Current Session contains malformed hand provenance');
      if (!seen.has(id)) { seen.add(id); handIds.push(id); }
    });
    var historicalSessionId = request.historicalSessionId === undefined ? null : request.historicalSessionId;
    if (historicalSessionId !== null && (typeof historicalSessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(historicalSessionId))) throw removalError('Current Session identity is malformed');
    return { namespace: namespace, historicalSessionId: historicalSessionId, sessionHandIds: handIds.sort() };
  }
  function sameNamespace(left, right) {
    return Boolean(left && String(left.provider || '').toLowerCase() === right.provider && String(left.host || '').toLowerCase() === right.host && String(left.gameId || '') === right.gameId);
  }
  function recordAliases(record) {
    return Array.from(new Set([record && record.authoritativeHandId].concat(record && record.lifecycleHandIds || []).filter(function (value) { return value !== null && value !== undefined && String(value); }).map(String)));
  }
  function sessionRemovalPlan(records, request) {
    var normalized = normalizedRemovalRequest(request);
    var sourceRecords = (records || []).map(clone); var resolved = Aggregator.rebuild(sourceRecords);
    if (resolved.acceptedRecords.length !== sourceRecords.length) throw removalError('Career history cannot be removed while its physical record set fails deterministic validation');
    var matchesByAlias = new Map();
    resolved.acceptedRecords.forEach(function (record) {
      if (!sameNamespace(record.namespace, normalized.namespace)) return;
      recordAliases(record).forEach(function (alias) {
        if (!matchesByAlias.has(alias)) matchesByAlias.set(alias, new Set());
        matchesByAlias.get(alias).add(String(record.handKey));
      });
    });
    var matchedSessionHandIds = []; var unmatchedSessionHandIds = []; var logicalHandKeys = new Set();
    normalized.sessionHandIds.forEach(function (handId) {
      var candidates = Array.from(matchesByAlias.get(handId) || []).sort();
      if (candidates.length > 1) throw removalError('Current Session hand provenance is ambiguous across multiple Career logical hands', 'CAREER_SESSION_REMOVAL_AMBIGUOUS');
      if (!candidates.length) unmatchedSessionHandIds.push(handId);
      else {
        if (normalized.historicalSessionId && resolved.activeRecords.some(function (record) {
          return record.handKey === candidates[0] && record.schemaVersion >= 4 && record.session.sessionId && record.session.sessionId !== normalized.historicalSessionId;
        })) throw removalError('Current Session hand identity disagrees with Career Session provenance', 'CAREER_SESSION_REMOVAL_AMBIGUOUS');
        matchedSessionHandIds.push(handId); logicalHandKeys.add(candidates[0]);
      }
    });
    var selectedKeys = Array.from(logicalHandKeys).sort(); var selected = new Set(selectedKeys);
    var removedRecords = resolved.acceptedRecords.filter(function (record) { return selected.has(String(record.handKey)); });
    var affectedPlayerIds = Array.from(new Set(removedRecords.reduce(function (ids, record) {
      (record.players || []).forEach(function (entry) { ids.push(String(entry.playerId)); }); return ids;
    }, []))).sort();
    return {
      namespace: normalized.namespace,
      historicalSessionId: normalized.historicalSessionId,
      sessionHandIds: normalized.sessionHandIds,
      sessionHandCount: normalized.sessionHandIds.length,
      matchedSessionHandIds: matchedSessionHandIds,
      unmatchedSessionHandIds: unmatchedSessionHandIds,
      logicalHandKeys: selectedKeys,
      logicalHandCount: selectedKeys.length,
      physicalRecordCount: removedRecords.length,
      physicalFingerprints: removedRecords.map(function (record) { return String(record.fingerprint); }).sort(),
      affectedPlayerIds: affectedPlayerIds
    };
  }
  function historicalSessionDeletionPlan(records, requestedSessionId) {
    var sessionId = requiredHistoricalSessionId(requestedSessionId);
    var sourceRecords = (records || []).map(clone);
    var resolved = Aggregator.rebuild(sourceRecords);
    if (resolved.acceptedRecords.length !== sourceRecords.length) throw removalError('Career history fails deterministic validation; the Session was not deleted', 'CAREER_HISTORICAL_SESSION_CONFLICT');
    var summary = Aggregator.historicalSessionCatalogFromActive(resolved.activeRecords).find(function (row) { return row.sessionId === sessionId; });
    if (!summary) throw removalError('This canonical Session no longer exists in Career', 'CAREER_HISTORICAL_SESSION_NOT_FOUND');
    var active = resolved.activeRecords.filter(function (record) { return sessionIdOf(record) === sessionId; });
    var selectedKeys = new Set(active.map(function (record) { return String(record.handKey); }));
    var physical = resolved.acceptedRecords.filter(function (record) {
      var belongs = selectedKeys.has(String(record.handKey)); var explicit = sessionIdOf(record);
      if (belongs && explicit && explicit !== sessionId || !belongs && explicit === sessionId)
        throw removalError('Conflicting physical Session provenance blocks deletion', 'CAREER_HISTORICAL_SESSION_CONFLICT');
      return belongs;
    });
    var players = new Map();
    active.forEach(function (record) {
      (record.players || []).forEach(function (entry) {
        if (Number(entry.counters && entry.counters.hands || 0) <= 0) return;
        var id = String(entry.playerId); var row = players.get(id) || { playerId: id, displayName: '', handCount: 0, lastSeenAt: -1 };
        row.handCount += 1;
        if (entry.displayName && Number(record.finalizedAt || 0) >= row.lastSeenAt) {
          row.displayName = String(entry.displayName); row.lastSeenAt = Number(record.finalizedAt || 0);
        }
        players.set(id, row);
      });
    });
    var affectedPlayers = Array.from(players.values()).sort(function (left, right) { return left.playerId.localeCompare(right.playerId); }).map(function (row) {
      return { playerId: row.playerId, displayName: row.displayName || row.playerId, handCount: row.handCount };
    });
    var namespaces = Array.from(new Map(active.map(function (record) {
      var namespace = record.namespace || {};
      var key = String(namespace.host || '') + ':' + String(namespace.gameId || '');
      return [key, { host: String(namespace.host || ''), gameId: String(namespace.gameId || '') }];
    })).values());
    return {
      sessionId: sessionId, startedAt: summary.startedAt, endedAt: summary.endedAt,
      provenanceStatus: summary.provenanceStatus, logicalHandCount: active.length,
      physicalRecordCount: physical.length, tableSizeHands: clone(summary.tableSizeHands),
      affectedPlayers: affectedPlayers, affectedPlayerIds: affectedPlayers.map(function (row) { return row.playerId; }),
      namespaces: namespaces,
      logicalHandKeys: Array.from(selectedKeys).sort(),
      physicalFingerprints: physical.map(function (record) { return String(record.fingerprint); }).sort()
    };
  }
  function affectedProjectionPlan(wrappers, metadata, handKeys) {
    var selectedKeys = new Set((handKeys || []).map(String));
    var removed = wrappers.filter(function (wrapper) { return selectedKeys.has(String(wrapper.record.handKey)); });
    var retained = wrappers.filter(function (wrapper) { return !selectedKeys.has(String(wrapper.record.handKey)); });
    var resolved = Aggregator.rebuild(retained.map(function (wrapper) { return wrapper.record; }));
    if (resolved.acceptedRecords.length !== retained.length) throw removalError('Career Session removal would leave a physical record set that fails deterministic validation');
    var affectedIds = Array.from(new Set(removed.reduce(function (ids, wrapper) {
      (wrapper.record.players || []).forEach(function (entry) { ids.push(String(entry.playerId)); }); return ids;
    }, []))).sort();
    var affected = new Set(affectedIds); var accepted = new Set(resolved.acceptedRecords.map(function (record) { return record.fingerprint; }));
    var quarantined = new Set(resolved.quarantinedHandKeys); var revisions = new Map(); var contexts = new Map();
    retained.forEach(function (wrapper) {
      if (!accepted.has(wrapper.record.fingerprint)) return;
      (wrapper.record.players || []).forEach(function (entry) {
        var id = String(entry.playerId); if (!affected.has(id)) return;
        revisions.set(id, Math.max(revisions.get(id) || 0, Number(wrapper.sequence || 0)));
        if (quarantined.has(wrapper.record.handKey)) {
          if (!contexts.has(id)) contexts.set(id, new Set());
          contexts.get(id).add(wrapper.record.handKey);
        }
      });
    });
    var heads = []; var caches = [];
    affectedIds.forEach(function (id) {
      if (!revisions.has(id) && !resolved.aggregate.players[id]) return;
      var player = resolved.aggregate.players[id] || null;
      heads.push(summaryHead(id, revisions.get(id) || 0, player, Array.from(contexts.get(id) || []).sort()));
      if (player) caches.push(cacheForPlayer(player, revisions.get(id) || 0, physicalRecordCountForPlayer(resolved.acceptedRecords, id)));
    });
    var chronological = resolved.acceptedRecords.slice().sort(function (left, right) { return Number(left.finalizedAt || 0) - Number(right.finalizedAt || 0) || left.handKey.localeCompare(right.handKey) || left.fingerprint.localeCompare(right.fingerprint); });
    var nextMetadata = Object.assign({}, clone(metadata || {}), {
      physicalRecordCount: resolved.acceptedRecords.length,
      activeRecordCount: resolved.activeRecords.length,
      quarantinedHandCount: resolved.quarantinedHandKeys.length,
      firstAcceptedHandKey: chronological.length ? chronological[0].handKey : null,
      firstAcceptedAt: chronological.length ? chronological[0].finalizedAt : null,
      latestAcceptedAt: chronological.length ? chronological[chronological.length - 1].finalizedAt : null,
      playerSummaryVersion: PLAYER_SUMMARY_VERSION
    });
    return { removed: removed, retained: retained, resolved: resolved, affectedPlayerIds: affectedIds, heads: heads, caches: caches, metadata: nextMetadata };
  }
  function requireExpectedPhysicalDeletion(mutation, expectedFingerprints) {
    if (expectedFingerprints === undefined) return;
    if (!Array.isArray(expectedFingerprints) || expectedFingerprints.some(function (value) { return typeof value !== 'string'; }))
      throw removalError('Expected physical deletion identity is malformed');
    var actual = mutation.removed.map(function (wrapper) { return String(wrapper.record.fingerprint); }).sort();
    if (canonicalJson(actual) !== canonicalJson(expectedFingerprints.slice().sort()))
      throw removalError('Career changed after historical Session deletion preview; preview it again', 'CAREER_HISTORICAL_SESSION_STALE');
  }

  function createMemoryService(saved, options) {
    var plan = migrationPlan(saved || {}, options || {});
    var records = new Map(); var heads = new Map(); var caches = new Map(); var queue = Promise.resolve();
    var dashboardCache = new Map(); var trendCache = new Map(); var trendPending = new Map(); var trendGeneration = 0; var dashboardDiagnostics = { playerRecordRetrievals: 0, aggregateUpgrades: 0, cacheHits: 0, cacheMisses: 0, trendCacheHits: 0, trendCacheMisses: 0 };
    (plan.wrappers || []).forEach(function (wrapper) { records.set(wrapper.record.fingerprint, wrapper); });
    (plan.heads || []).forEach(function (head) { heads.set(head.playerId, head); });
    (plan.caches || []).forEach(function (cache) { caches.set(cache.playerId, cache); });
    var metadata = plan.metadata;
    var summaryWork = null; var summaryError = null;
    function ensurePlayerSummaries(inspectHeads) {
      if (summaryWork) return summaryWork;
      if (!plan.ok) return Promise.reject(new Error(plan.reason));
      if (metadata.playerSummaryVersion === PLAYER_SUMMARY_VERSION && (!inspectHeads || summariesReady(metadata, Array.from(heads.values())))) return Promise.resolve();
      summaryError = null;
      summaryWork = (async function () {
        while (!summariesReady(metadata, Array.from(heads.values()))) {
          var before = canonicalJson(metadata);
          var rebuiltHeads = await backfillSummaryHeads(Array.from(records.values()).map(clone), Array.from(heads.values()).map(clone));
          // A concurrent replacement/append invalidates the entire old snapshot.
          if (summariesReady(metadata, Array.from(heads.values()))) break;
          if (canonicalJson(metadata) !== before) continue;
          heads.clear(); rebuiltHeads.forEach(function (head) { heads.set(head.playerId, head); if (head.contextHandKeys.length) caches.delete(head.playerId); });
          invalidateDashboardPlayers(rebuiltHeads.filter(function (head) { return head.contextHandKeys.length; }).map(function (head) { return head.playerId; }));
          metadata.playerSummaryVersion = PLAYER_SUMMARY_VERSION;
        }
      })().catch(function (error) { summaryError = String(error.message || error); throw error; }).finally(function () { summaryWork = null; });
      return summaryWork;
    }
    async function careerPlayerSummaries() {
      await ensurePlayerSummaries(true);
      return summaryRows(Array.from(heads.values()));
    }
    function allRecords() { return Array.from(records.values()).map(function (wrapper) { return clone(wrapper.record); }); }
    function ensureContextAggregates() {
      if (metadata.aggregateSchemaVersion === Aggregator.AGGREGATE_SCHEMA_VERSION) return;
      var resolved = Aggregator.rebuild(allRecords());
      var physicalCounts = physicalRecordCountsByPlayer(resolved.acceptedRecords);
      caches.clear();
      heads.forEach(function (head) {
        var player = resolved.aggregate.players[head.playerId];
        if (player) caches.set(head.playerId, cacheForPlayer(player, head.revision, physicalCounts[head.playerId] || 0));
      });
      metadata.aggregateSchemaVersion = Aggregator.AGGREGATE_SCHEMA_VERSION;
      dashboardCache.clear(); dashboardDiagnostics.aggregateUpgrades += 1;
    }
    function recordsForHand(handKey) { return Array.from(records.values()).filter(function (wrapper) { return wrapper.record.handKey === handKey; }).map(function (wrapper) { return clone(wrapper.record); }); }
    function recordsForPlayer(playerId) {
      dashboardDiagnostics.playerRecordRetrievals += 1;
      var head = heads.get(String(playerId)); var context = new Set(head && head.contextHandKeys || []);
      return Array.from(records.values()).filter(function (wrapper) { return wrapper.playerIds.indexOf(String(playerId)) >= 0 || context.has(wrapper.record.handKey); }).map(function (wrapper) { return clone(wrapper.record); });
    }
    function invalidateDashboardPlayers(playerIds) { (playerIds || []).map(String).forEach(function (playerId) { Array.from(dashboardCache.keys()).forEach(function (key) { if (key.indexOf(playerId + '|') === 0) dashboardCache.delete(key); }); Array.from(trendCache.keys()).forEach(function (key) { if (key.indexOf(playerId + '|') === 0) trendCache.delete(key); }); }); }
    async function stats(playerId) {
      await ensurePlayerSummaries();
      ensureContextAggregates();
      playerId = String(playerId);
      var head = heads.get(playerId); if (!head) return Promise.resolve(null);
      var cache = caches.get(playerId);
      if (validCache(cache, head)) return Promise.resolve(Aggregator.derivePlayer(cache.player));
      var result = playerFromRecords(recordsForPlayer(playerId), playerId);
      if (result.player) caches.set(playerId, cacheForPlayer(Object.assign({}, result.player, { derived: undefined }), head.revision, result.physicalRecordCount));
      return Promise.resolve(result.player);
    }
    function careerHudStats(playerIds) {
      var requestedCount = Array.isArray(playerIds) ? playerIds.length : 0;
      var ids = normalizedPlayerIds(playerIds);
      return Promise.all(ids.map(stats)).then(function (players) {
        var byPlayerId = {};
        ids.forEach(function (playerId, index) { byPlayerId[playerId] = players[index] || null; });
        return { players: byPlayerId, query: { batched: true, requestedCount: requestedCount, uniquePlayerCount: ids.length, duplicatePlayerIdsRemoved: Math.max(0, requestedCount - ids.length), backend: 'memory-indexed-test-double' } };
      });
    }
    function append(record) {
      var operation = queue.then(async function () {
        if (!plan.ok) return { accepted: false, reason: plan.reason, migrationBlocked: true };
        await ensurePlayerSummaries();
        ensureContextAggregates();
        var state = Aggregator.createState(recordsForHand(record.handKey));
        var previous = state.activeByHand.get(record.handKey);
        var result = Aggregator.append(state, record);
        if (!result.accepted) return result;
        var situations = Aggregator.careerSituationMap(record);
        var updated = record.players.map(function (entry) {
          var id = String(entry.playerId);
          var head = heads.get(id); var cache = caches.get(id);
          var replacement = result.supersession && validSummaryHead(head) && !head.contextHandKeys.length && validCache(cache, head) && cache.player.playerId === id
            ? Aggregator.replacePlayer(cache.player, previous, record, id) : null;
          var next = replacement ? { player: replacement, physicalRecordCount: cache.physicalRecordCount + 1 } : !result.supersession && (!head || validCache(cache, head))
            ? { player: Aggregator.appendPlayer(cache && cache.player || null, record, entry, situations[id]), physicalRecordCount: cache ? cache.physicalRecordCount + 1 : 1 }
            : playerFromRecords(recordsForPlayer(id).concat([record]), id);
          return { head: summaryHead(id, metadata.nextSequence + 1, next.player, head && head.contextHandKeys),
            cache: next.player ? cacheForPlayer(next.player, metadata.nextSequence + 1, next.physicalRecordCount) : null };
        });
        metadata.nextSequence += 1;
        records.set(record.fingerprint, recordWrapper(record, metadata.nextSequence));
        metadata.physicalRecordCount += 1;
        if (!result.supersession) metadata.activeRecordCount += 1;
        metadata.latestAcceptedAt = record.finalizedAt;
        if (!metadata.firstAcceptedHandKey) { metadata.firstAcceptedHandKey = record.handKey; metadata.firstAcceptedAt = record.finalizedAt; }
        updated.forEach(function (entry) { heads.set(entry.head.playerId, entry.head); if (entry.cache) caches.set(entry.head.playerId, entry.cache); else caches.delete(entry.head.playerId); });
        invalidateDashboardPlayers(record.players.map(function (entry) { return entry.playerId; }));
        return result;
      });
      queue = operation.catch(function () {});
      return operation;
    }
    function rebuild() { return Promise.resolve(Aggregator.rebuild(allRecords())); }
    function replaceCareerRecords(nextRecords, career, restoreOptions) {
      var replacement = replacementPlan(nextRecords, career, restoreOptions);
      if (!replacement.ok) return Promise.reject(new Error(replacement.reason));
      var mutationMode = restoreOptions && restoreOptions.mode === 'merge' ? 'merge' : 'replace';
      var operation = queue.then(function () {
        records.clear(); heads.clear(); caches.clear(); dashboardCache.clear(); trendCache.clear(); trendPending.clear(); trendGeneration += 1;
        replacement.wrappers.forEach(function (wrapper) { records.set(wrapper.record.fingerprint, wrapper); });
        replacement.heads.forEach(function (head) { heads.set(head.playerId, head); });
        replacement.caches.forEach(function (cache) { caches.set(cache.playerId, cache); });
        Object.keys(metadata).forEach(function (key) { delete metadata[key]; }); Object.assign(metadata, clone(replacement.metadata));
        summaryError = null;
        return { replaced: mutationMode === 'replace', merged: mutationMode === 'merge', metadata: clone(metadata), aggregate: clone(replacement.resolved.aggregate) };
      });
      queue = operation.catch(function () {});
      return operation;
    }
    function mergeCareerRecords(nextRecords, career, mergeOptions) {
      var currentRecords = allRecords();
      if (!mergePreservesExisting(currentRecords, nextRecords)) return Promise.reject(new Error('Career merge cannot remove or alter existing physical records'));
      var replacement = replacementPlan(nextRecords, career, Object.assign({}, mergeOptions || {}, { mode: 'merge' }));
      if (!replacement.ok) return Promise.reject(new Error(replacement.reason));
      var operation = queue.then(function () {
        replacement.wrappers.forEach(function (wrapper) { records.set(wrapper.record.fingerprint, wrapper); });
        heads.clear(); caches.clear(); dashboardCache.clear(); trendCache.clear(); trendPending.clear(); trendGeneration += 1;
        replacement.heads.forEach(function (head) { heads.set(head.playerId, head); });
        replacement.caches.forEach(function (cache) { caches.set(cache.playerId, cache); });
        Object.keys(metadata).forEach(function (key) { delete metadata[key]; }); Object.assign(metadata, clone(replacement.metadata));
        summaryError = null;
        return { replaced: false, merged: true, metadata: clone(metadata), aggregate: clone(replacement.resolved.aggregate) };
      });
      queue = operation.catch(function () {});
      return operation;
    }
    function removeCareerHandKeys(handKeys, expectedFingerprints) {
      var operation = queue.then(function () {
        if (!plan.ok) throw new Error(plan.reason);
        var mutation = affectedProjectionPlan(Array.from(records.values()).map(clone), metadata, handKeys);
        requireExpectedPhysicalDeletion(mutation, expectedFingerprints);
        if (!mutation.removed.length) return { removed: false, logicalHandCount: 0, physicalRecordCount: 0, affectedPlayerIds: [], metadata: clone(metadata) };
        mutation.removed.forEach(function (wrapper) { records.delete(wrapper.record.fingerprint); });
        mutation.affectedPlayerIds.forEach(function (id) { heads.delete(id); caches.delete(id); });
        mutation.heads.forEach(function (head) { heads.set(head.playerId, head); });
        mutation.caches.forEach(function (cache) { caches.set(cache.playerId, cache); });
        Object.keys(metadata).forEach(function (key) { delete metadata[key]; }); Object.assign(metadata, clone(mutation.metadata));
        dashboardCache.clear(); trendCache.clear(); trendPending.clear(); trendGeneration += 1; summaryError = null;
        return { removed: true, logicalHandCount: new Set(mutation.removed.map(function (wrapper) { return wrapper.record.handKey; })).size, physicalRecordCount: mutation.removed.length, affectedPlayerIds: mutation.affectedPlayerIds, metadata: clone(metadata) };
      });
      queue = operation.catch(function () {});
      return operation;
    }
    async function careerDashboardStats(playerId, requested) {
      await ensurePlayerSummaries();
      ensureContextAggregates();
      playerId = String(playerId); requested = requested || {};
      var head = heads.get(playerId) || null;
      var scope = FilteredStats.normalizeFilters({ position: requested.position || null, situation: requested.situation || null, tableSize: requested.tableSize || null });
      var position = scope.position; var situation = scope.situation; var tableSize = scope.tableSize;
      var opponentMode = requested.opponentMode === 'self' || requested.opponentMode === 'others' ? requested.opponentMode : 'overall';
      var selfPlayerId = requested.selfPlayerId === null || requested.selfPlayerId === undefined ? null : String(requested.selfPlayerId);
      var cacheKey = playerId + '|' + Number(head && head.revision || 0) + '|' + canonicalJson({ position: position, situation: situation, tableSize: tableSize, opponentMode: opponentMode, selfPlayerId: selfPlayerId });
      if (dashboardCache.has(cacheKey)) {
        dashboardDiagnostics.cacheHits += 1;
        var cached = cloneDashboard(dashboardCache.get(cacheKey));
        cached.query.dashboardCacheHit = true;
        cached.query.playerRecordRetrievals = 0;
        return Promise.resolve(cached);
      }
      dashboardDiagnostics.cacheMisses += 1;
      var retrievalsBefore = dashboardDiagnostics.playerRecordRetrievals;
      var aggregateCache = caches.get(playerId);
      var aggregateCacheUsed = Boolean(validCache(aggregateCache, head));
      var hasScope = Boolean(position || situation || tableSize);
      var needsRecords = Boolean(opponentMode !== 'overall' || !aggregateCacheUsed);
      var playerRecords = needsRecords ? recordsForPlayer(playerId) : null;
      if (!aggregateCacheUsed && playerRecords) {
        var rebuilt = playerFromRecords(playerRecords, playerId);
        if (rebuilt.player && head) { aggregateCache = cacheForPlayer(Object.assign({}, rebuilt.player, { derived: undefined }), head.revision, rebuilt.physicalRecordCount); caches.set(playerId, aggregateCache); }
      }
      var relationalStatIds = opponentMode !== 'overall' ? ['threeBet', 'foldToThreeBet', 'foldToFlopCBet'] : [];
      var filters = [];
      relationalStatIds.forEach(function (statId) {
        filters.push({ position: position, situation: situation, tableSize: tableSize, statId: statId, counterpartMode: opponentMode, selfPlayerId: selfPlayerId });
      });
      var filteredResults = FilteredStats.careerStatsFilteredBatch(playerRecords || [], playerId, filters);
      var core = hasScope ? contextResultFromCache(aggregateCache, { position: position, situation: situation, tableSize: tableSize }, playerId) : unfilteredResultFromCache(aggregateCache);
      var relational = {};
      relationalStatIds.forEach(function (statId, index) {
        relational[statId] = filteredResults[index];
      });
      var result = {
        core: core, relational: relational, comparisonContexts: comparisonContextsFromCache(aggregateCache, head && head.revision, playerId, tableSize), profileStats: profileStatsFromCache(aggregateCache, { position: position, situation: situation, tableSize: tableSize }), careerTrackingStartedAt: metadata.careerTrackingStartedAt,
        query: { playerRevision: Number(head && head.revision || 0), aggregateCacheUsed: aggregateCacheUsed, dashboardCacheHit: false, playerRecordRetrievals: dashboardDiagnostics.playerRecordRetrievals - retrievalsBefore }
      };
      dashboardCache.set(cacheKey, cloneDashboard(result));
      while (dashboardCache.size > 32) dashboardCache.delete(dashboardCache.keys().next().value);
      return Promise.resolve(result);
    }
    async function careerTrendStats(playerId) {
      await ensurePlayerSummaries(); playerId = String(playerId);
      var head = heads.get(playerId) || null; var revision = Number(head && head.revision || 0); var cacheKey = playerId + '|' + revision;
      if (trendCache.has(cacheKey)) {
        dashboardDiagnostics.trendCacheHits += 1;
        var cached = cloneDashboard(trendCache.get(cacheKey)); cached.query.trendCacheHit = true; cached.query.trendRequestCoalesced = false; cached.query.playerRecordRetrievals = 0; return cached;
      }
      if (trendPending.has(cacheKey)) {
        dashboardDiagnostics.trendCacheHits += 1;
        return trendPending.get(cacheKey).then(function (value) { var shared = cloneDashboard(value); shared.query.trendCacheHit = true; shared.query.trendRequestCoalesced = true; shared.query.playerRecordRetrievals = 0; return shared; });
      }
      dashboardDiagnostics.trendCacheMisses += 1;
      var generation = trendGeneration; var retrievalsBefore = dashboardDiagnostics.playerRecordRetrievals;
      var operation = Promise.resolve().then(function () {
        var result = FilteredStats.careerTrendStats(head ? recordsForPlayer(playerId) : [], playerId);
        result.query = Object.assign({}, result.query, { playerRevision: revision, trendCacheHit: false, trendRequestCoalesced: false, playerRecordRetrievals: dashboardDiagnostics.playerRecordRetrievals - retrievalsBefore });
        if (generation === trendGeneration) { trendCache.set(cacheKey, cloneDashboard(result)); while (trendCache.size > 32) trendCache.delete(trendCache.keys().next().value); }
        return result;
      });
      trendPending.set(cacheKey, operation);
      try { return await operation; } finally { if (trendPending.get(cacheKey) === operation) trendPending.delete(cacheKey); }
    }
    return {
      backend: 'memory-indexed-test-double', migration: clone(plan), append: append, careerStats: stats,
      careerStatsFiltered: async function (playerId, filters) { await ensurePlayerSummaries(); return Promise.resolve(FilteredStats.careerStatsFiltered(recordsForPlayer(playerId), playerId, filters)); },
      careerDashboardStats: careerDashboardStats,
      careerTrendStats: careerTrendStats,
      careerHudStats: careerHudStats,
      careerPlayerSummaries: careerPlayerSummaries,
      careerPlayers: function () { return Promise.all(Array.from(heads.keys()).sort().map(stats)); },
      careerLedgerInfo: function () { return Promise.resolve(Object.assign(clone(metadata), { ready: plan.ok, cacheEntryCount: caches.size, playerCount: heads.size, playerSummariesReady: summariesReady(metadata, Array.from(heads.values())), playerSummaryBackfillRunning: Boolean(summaryWork), playerSummaryError: summaryError })); },
      careerPlayerRecordInfo: async function (playerId) { await ensurePlayerSummaries(); var values = recordsForPlayer(playerId); var resolution = Aggregator.rebuild(values); return Promise.resolve({ playerId: String(playerId), physicalRecordCount: physicalRecordCountForPlayer(values, playerId), activeRecordCount: physicalRecordCountForPlayer(resolution.activeRecords, playerId), rejectedRecords: resolution.rejectedRecords }); },
      recentCareerRecords: function (limit) { return Promise.resolve(allRecords().sort(function (a, b) { return b.finalizedAt - a.finalizedAt; }).slice(0, Math.max(0, Math.min(20, Number(limit || 20))))); },
      listCareerSessions: function () { return Promise.resolve(sessionSummaries(allRecords())); },
      listCareerSessionsForPlayer: function (playerId) { return Promise.resolve(sessionSummaries(allRecords(), String(playerId))); },
      getCareerSession: function (sessionId) { return Promise.resolve(sessionSummaries(allRecords()).find(function (summary) { return summary.sessionId === sessionId; }) || null); },
      getCareerSessionRecords: function (sessionId) { return Promise.resolve(sessionRecords(allRecords(), String(sessionId))); },
      listCareerSessionPlayerSummaries: function (playerId) { return Promise.resolve(listCareerSessionPlayerSummariesFromRecords(allRecords(), playerId)); },
      getCareerSessionPlayerStats: function (sessionId, playerId, filters) { return Promise.resolve(careerSessionPlayerStatsFromRecords(allRecords(), sessionId, playerId, filters)); },
      getCareerRecentPlayerStats: function (playerId, window, filters) { return Promise.resolve(careerRecentPlayerStatsFromRecords(allRecords(), playerId, window, filters)); },
      getCareerRecentVsCareer: function (playerId, window, filters) { return Promise.resolve(careerRecentVsCareerFromRecords(allRecords(), playerId, window, filters)); },
      getCareerRecentBatch: function (playerId, window, filters) { return Promise.resolve(recentBatchFromRecords(allRecords(), playerId, window, filters)); },
      getCareerPlayerSessionTrend: function (playerId, filters, range) { return Promise.resolve(trendRangeResult(careerPlayerSessionTrendFromRecords(allRecords(), playerId, filters), trendRange(range), range)); },
      rebuildCareerStats: function () { return rebuild().then(function (result) { return result.aggregate; }); },
      exportCareer: function () { return Promise.resolve(serializableExport(metadata, allRecords())); },
      replaceCareerRecords: replaceCareerRecords,
      mergeCareerRecords: mergeCareerRecords,
      removeCareerHandKeys: removeCareerHandKeys,
      close: function () {},
      testHooks: { records: records, heads: heads, caches: caches, dashboardCache: dashboardCache, trendCache: trendCache, trendPending: trendPending, dashboardDiagnostics: dashboardDiagnostics, metadata: metadata, migrationPlan: plan }
    };
  }

  // Session sidecars are derived. Production lists use only validated snapshots.
  function projectionToken() { return globalThis.crypto.randomUUID(); }
  function emptyProjectionState() {
    return { key: SESSION_PROJECTION_STATE_KEY, version: SESSION_PROJECTION_VERSION, status: 'absent',
      ledgerRevision: projectionToken(), sourceRevision: null, generation: null, checkpoint: null,
      chunks: 0, groups: 0, maxChunkRecords: 0, counts: { canonical: 0, player: 0, unassigned: 0 }, catalogError: null,
      populationVersion: 1, firstCanonicalKey: null, completeness: null };
  }
  function projectionReady(state) {
    return Boolean(state && typeof state.careerGeneration === 'string' && state.careerGeneration && state.version === SESSION_PROJECTION_VERSION && state.status === 'ready' &&
      typeof state.generation === 'string' && state.generation && typeof state.ledgerRevision === 'string' &&
      state.sourceRevision === state.ledgerRevision && !state.catalogError && state.counts &&
      ['canonical', 'player', 'unassigned'].every(function (kind) { return Number.isSafeInteger(state.counts[kind]) && state.counts[kind] >= 0; }));
  }
  function projectionOrder(at) { return at === null ? 1 : -at; }
  function validProjectionChronologyKey(key) {
    return key === null || Array.isArray(key) && key.length === 3 && key[0] === 'canonical' && Number.isSafeInteger(key[1]) && key[1] <= 1 &&
      typeof key[2] === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key[2]);
  }
  function projectionChronologyKey(row) { return ['canonical', row.orderTime, row.sessionId]; }
  function sameProjectionKey(left, right) { return canonicalJson(left) === canonicalJson(right); }
  function validProjectionControl(state) {
    function count(value) { return Number.isSafeInteger(value) && value >= 0; }
    function token(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
    return projectionReady(state) && state.key === SESSION_PROJECTION_STATE_KEY && token(state.generation) && token(state.ledgerRevision) &&
      state.catalogError === null && count(state.chunks) && state.chunks > 0 && count(state.groups) && count(state.maxChunkRecords) &&
      (state.groups === 0 ? state.checkpoint === null : typeof state.checkpoint === 'string' && Boolean(state.checkpoint));
  }
  function validProjectionCompleteness(state) {
    var seal = state && state.completeness;
    return Boolean(state && state.populationVersion === 1 && validProjectionChronologyKey(state.firstCanonicalKey) &&
      (state.counts.canonical === 0) === (state.firstCanonicalKey === null) && seal && seal.version === 1 &&
      seal.careerGeneration === state.careerGeneration && seal.generation === state.generation && seal.sourceRevision === state.ledgerRevision && seal.projectionVersion === state.version &&
      seal.checkpoint === state.checkpoint && seal.chunks === state.chunks && seal.groups === state.groups && seal.maxChunkRecords === state.maxChunkRecords &&
      sameProjectionKey(seal.firstCanonicalKey, state.firstCanonicalKey) && seal.counts &&
      ['canonical', 'player', 'unassigned'].every(function (kind) { return seal.counts[kind] === state.counts[kind]; }));
  }
  function sealProjectionState(state) {
    state.completeness = { version: 1, careerGeneration: state.careerGeneration, projectionVersion: state.version, generation: state.generation, sourceRevision: state.ledgerRevision,
      counts: Object.assign({}, state.counts), firstCanonicalKey: state.firstCanonicalKey,
      checkpoint: state.checkpoint, chunks: state.chunks, groups: state.groups, maxChunkRecords: state.maxChunkRecords };
  }
  function validProjectionReadState(state) { return validProjectionControl(state) && validProjectionCompleteness(state); }
  function publicProjectionState(state) {
    var ready = validProjectionReadState(state);
    var controlValid = state && validProjectionControl(Object.assign({}, state, { status: 'ready', catalogError: null })) &&
      state.populationVersion === 1 && validProjectionChronologyKey(state.firstCanonicalKey) &&
      (state.counts.canonical === 0) === (state.firstCanonicalKey === null);
    var invalid = state && state.status === 'invalid' && state.catalogError === 'historical Session ID collides across game namespaces' &&
      controlValid && validProjectionCompleteness(state);
    return state ? Object.assign({}, state, { ready: ready, needsBackfill: !ready && !invalid,
      restartRequired: ['ready', 'invalid', 'building'].indexOf(state.status) >= 0 &&
        (!controlValid || state.status !== 'building' && !validProjectionCompleteness(state)) }) :
      { version: SESSION_PROJECTION_VERSION, status: 'absent', ready: false, needsBackfill: true, restartRequired: false };
  }
  function validProjectionReadRow(row, state) {
    if (!validProjectionRow(row, state)) return false;
    function exact(values, keys) { return Object.keys(values).length === keys.length && keys.every(function (key) { return Object.prototype.hasOwnProperty.call(values, key); }); }
    var all = ['HU', '3_TO_5', 'SIX_PLUS', 'UNKNOWN'];
    if (row.kind === 'canonical') return (state.populationVersion !== 1 || validProjectionChronologyKey(row.nextCanonicalKey) &&
      (row.nextCanonicalKey === null || row.nextCanonicalKey[2] !== row.sessionId &&
        (row.nextCanonicalKey[1] > row.orderTime || row.nextCanonicalKey[1] === row.orderTime && row.nextCanonicalKey[2] > row.sessionId))) &&
      exact(row.tableSizeHands, all) && (row.startedAt === null) === (row.endedAt === null) &&
      (row.startedAt === null || Number.isSafeInteger(row.startedAt) && Number.isSafeInteger(row.endedAt) && row.startedAt <= row.endedAt);
    if (row.kind !== 'player') return true;
    if (!exact(row.counters, Aggregator.COUNTER_FIELDS) || !exact(row.playerTableSizeHands, all) ||
        !exact(row.counterTableSizeHands, ['HU', '3_TO_5', 'SIX_PLUS'])) return false;
    if (row.counters.hands < row.playerHandCount || row.positionTrackedHands > row.counters.hands ||
        ['HU', '3_TO_5', 'SIX_PLUS'].reduce(function (sum, key) { return sum + row.counterTableSizeHands[key]; }, 0) > row.counters.hands) return false;
    var time = row.positionTimes;
    if (!time) return row.positionTrackedHands === 0;
    function witness(value) { return Array.isArray(value) && value.length === 2 && value.every(function (part) { return typeof part === 'string' && part; }); }
    return time.count > 0 && time.count <= row.positionTrackedHands && typeof time.poisoned === 'boolean' &&
      (time.minimum === null || typeof time.minimum === 'number' && !Number.isNaN(time.minimum)) &&
      (time.nonNullCount === 0 ? time.firstKey === null : witness(time.firstKey)) &&
      (time.nonNullCount === time.count ? time.lastNullKey === null : witness(time.lastNullKey));
  }
  function projectionKey(kind, playerId, sessionId) { return [kind, playerId || '', sessionId || '']; }
  function projectionRow(kind, playerId, sessionId, generation) {
    return { key: projectionKey(kind, playerId, sessionId), kind: kind, playerId: playerId || '',
      sessionId: sessionId || '', generation: generation };
  }
  // The existing coverage fold is order-sensitive for null/absent times. Keep
  // constant-sized witnesses in resolver localeCompare order, not IDB order.
  function projectionTimeOrder(left, right) { return left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]); }
  function addProjectionTime(target, source) {
    if (!source || !source.count) return target;
    if (!target) return clone(source);
    target.count += source.count;
    if (source.lastNullKey !== null && (target.lastNullKey === null || projectionTimeOrder(source.lastNullKey, target.lastNullKey) > 0)) target.lastNullKey = source.lastNullKey;
    if (source.firstKey !== null && (target.firstKey === null || projectionTimeOrder(source.firstKey, target.firstKey) < 0)) {
      target.firstKey = source.firstKey; target.firstTime = source.firstTime;
    }
    target.nonNullCount += source.nonNullCount;
    target.poisoned = target.poisoned || source.poisoned;
    target.minimum = Math.min(target.minimum === null ? Infinity : target.minimum, source.minimum === null ? Infinity : source.minimum);
    if (target.minimum === Infinity) target.minimum = null;
    return target;
  }
  function projectionTime(record, physical) {
    var at = record.finalizedAt, number = Number(at);
    // Stable sort ties follow group insertion order in native primary-key reads:
    // the smallest accepted physical fingerprint, not necessarily the tip.
    var firstFingerprint = physical.map(function (value) { return value.fingerprint; }).sort()[0];
    var key = [record.handKey, firstFingerprint];
    return { count: 1, nonNullCount: at === null ? 0 : 1, firstKey: at === null ? null : key,
      firstTime: at, lastNullKey: at === null ? key : null,
      minimum: at === null || Number.isNaN(number) ? null : number, poisoned: at !== null && Number.isNaN(number) };
  }
  function projectionEarliest(time) {
    if (!time || !time.nonNullCount) return null;
    var laterNull = time.lastNullKey !== null && projectionTimeOrder(time.lastNullKey, time.firstKey) > 0;
    if (time.nonNullCount === 1 && !laterNull) return time.firstTime;
    if (time.poisoned) return NaN;
    return laterNull ? Math.min(0, time.minimum) : time.minimum;
  }
  function projectionDeltas(active, physical, generation) {
    if (!active) return [];
    var id = sessionIdOf(active), rows = [];
    if (id) {
      var canonicalRow = projectionRow('canonical', '', id, generation);
      Object.assign(canonicalRow, Aggregator.historicalSessionCatalogFromActive([active])[0]);
      delete canonicalRow.playerHandCounts;
      canonicalRow.namespace = { provider: active.namespace.provider, host: active.namespace.host, gameId: active.namespace.gameId };
      canonicalRow.orderTime = projectionOrder(canonicalRow.endedAt); rows.push(canonicalRow);
    }
    active.players.forEach(function (entry) {
      if (!(Number(entry.counters.hands || 0) > 0)) return;
      var playerId = String(entry.playerId);
      if (!id) {
        if (entry.playerId !== playerId) return;
        var unassigned = projectionRow('unassigned', playerId, '', generation);
        unassigned.legacyHandCount = active.schemaVersion < 4 ? 1 : 0;
        unassigned.unsupportedHandCount = active.schemaVersion >= 4 ? 1 : 0;
        rows.push(unassigned); return;
      }
      // The canonical catalog coerces participant object keys, while the rich
      // historical population requires an exact string ID. Preserve both old
      // contracts even for validator-accepted nonstring legacy entries.
      var strict = entry.playerId === playerId;
      var stats = FilteredStats.careerStatsFromResolved({ activeRecords: strict ? [active] : [],
        acceptedRecords: strict ? physical.filter(function (record) { return sessionIdOf(record) === id; }) : [] }, playerId, {});
      var player = projectionRow('player', playerId, id, generation);
      player.catalogHandCount = 1; player.playerHandCount = strict ? 1 : 0; player.playerTableSizeHands = composition(strict ? [active] : []);
      player.counters = stats.counters; player.physicalRecordCount = stats.coverage.physicalRecordCount;
      player.counterTableSizeHands = stats.coverage.tableSizeHands;
      player.positionTrackedHands = stats.coverage.positionTrackedHands;
      player.positionTimes = strict && entry.position && entry.position.status === 'supported' && entry.position.dealtPosition ? projectionTime(active, physical) : null;
      rows.push(player);
    });
    return rows;
  }
  function mergeProjectionRow(previous, delta, state) {
    if (!previous) { state.counts[delta.kind] += 1; return delta; }
    if (previous.generation !== state.generation || previous.kind !== delta.kind) throw new Error('Session projection generation/row mismatch; explicit rebuild required');
    if (delta.kind === 'canonical') {
      if (previous.namespace.provider !== delta.namespace.provider || previous.namespace.host !== delta.namespace.host ||
        previous.namespace.gameId !== delta.namespace.gameId) state.catalogError = 'historical Session ID collides across game namespaces';
      previous.handCount += delta.handCount;
      if (delta.startedAt !== null) previous.startedAt = previous.startedAt === null ? delta.startedAt : Math.min(previous.startedAt, delta.startedAt);
      if (delta.endedAt !== null) previous.endedAt = previous.endedAt === null ? delta.endedAt : Math.max(previous.endedAt, delta.endedAt);
      previous.orderTime = projectionOrder(previous.endedAt);
      Object.keys(previous.tableSizeHands).forEach(function (key) { previous.tableSizeHands[key] += delta.tableSizeHands[key]; });
    } else if (delta.kind === 'player') {
      previous.catalogHandCount += delta.catalogHandCount;
      previous.playerHandCount += delta.playerHandCount;
      previous.physicalRecordCount += delta.physicalRecordCount;
      previous.positionTrackedHands += delta.positionTrackedHands;
      previous.positionTimes = addProjectionTime(previous.positionTimes, delta.positionTimes);
      Object.keys(previous.playerTableSizeHands).forEach(function (key) { previous.playerTableSizeHands[key] += delta.playerTableSizeHands[key]; });
      Object.keys(previous.counterTableSizeHands).forEach(function (key) { previous.counterTableSizeHands[key] += delta.counterTableSizeHands[key]; });
      Aggregator.COUNTER_FIELDS.forEach(function (key) { previous.counters[key] += delta.counters[key]; });
    } else {
      previous.legacyHandCount += delta.legacyHandCount; previous.unsupportedHandCount += delta.unsupportedHandCount;
    }
    return previous;
  }
  function projectionPlayerSummary(canonicalRow, player) {
    var coverage = FilteredStats.careerStatsFromResolved({ activeRecords: [], acceptedRecords: [] }, player.playerId, {}).coverage;
    coverage.totalCareerHands = player.counters.hands;
    coverage.activeRecordCount = player.playerHandCount; coverage.physicalRecordCount = player.physicalRecordCount;
    coverage.positionTrackedHands = coverage.matchedPositionHands = player.positionTrackedHands;
    coverage.earliestPositionTrackedAt = projectionEarliest(player.positionTimes);
    ['HU', '3_TO_5', 'SIX_PLUS'].forEach(function (bucket) { coverage.tableSizeHands[bucket] = player.playerTableSizeHands[bucket]; });
    // Coverage table buckets sum counters.hands, while membership buckets count
    // logical hands. Valid records can carry hands > 1; keep these distinct.
    if (player.counterTableSizeHands) coverage.tableSizeHands = player.counterTableSizeHands;
    return { sessionId: canonicalRow.sessionId, provenanceStatus: canonicalRow.provenanceStatus,
      startedAt: canonicalRow.startedAt, endedAt: canonicalRow.endedAt, playerId: player.playerId,
      playerHandCount: player.playerHandCount, sessionHandCount: canonicalRow.handCount,
      tableSizeHands: canonicalRow.tableSizeHands, playerTableSizeHands: player.playerTableSizeHands,
      stats: { counters: player.counters, derived: Aggregator.deriveCounters(player.counters) }, coverage: coverage };
  }
  function validProjectionRow(row, state) {
    function count(value) { return Number.isInteger(value) && value >= 0; }
    function buckets(values, keys) { return values && keys.every(function (key) { return count(values[key]); }); }
    var all = ['HU', '3_TO_5', 'SIX_PLUS', 'UNKNOWN'];
    if (!row || row.careerGeneration !== state.careerGeneration || row.generation !== state.generation || canonicalJson(row.key) !== canonicalJson(projectionKey(row.kind, row.playerId, row.sessionId))) return false;
    if (row.kind === 'unassigned') return row.sessionId === '' && typeof row.playerId === 'string' && row.playerId &&
      count(row.legacyHandCount) && count(row.unsupportedHandCount) && row.legacyHandCount + row.unsupportedHandCount > 0;
    if (typeof row.sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.sessionId)) return false;
    if (row.kind === 'canonical') return row.playerId === '' && row.provenanceStatus === 'explicit' && count(row.handCount) && row.handCount > 0 &&
      buckets(row.tableSizeHands, all) && all.reduce(function (sum, key) { return sum + row.tableSizeHands[key]; }, 0) === row.handCount &&
      (row.startedAt === null || count(row.startedAt)) && (row.endedAt === null || count(row.endedAt)) &&
      row.orderTime === projectionOrder(row.endedAt) && row.namespace && row.namespace.provider === 'pokernow' && row.namespace.host && row.namespace.gameId;
    return row.kind === 'player' && typeof row.playerId === 'string' && row.playerId &&
      count(row.catalogHandCount) && row.catalogHandCount > 0 && count(row.playerHandCount) && row.playerHandCount <= row.catalogHandCount && buckets(row.playerTableSizeHands, all) &&
      all.reduce(function (sum, key) { return sum + row.playerTableSizeHands[key]; }, 0) === row.playerHandCount &&
      row.counters && Aggregator.COUNTER_FIELDS.every(function (key) { return count(row.counters[key]); }) && (!row.playerHandCount || row.counters.hands > 0) &&
      count(row.physicalRecordCount) && row.physicalRecordCount >= row.playerHandCount && count(row.positionTrackedHands) &&
      buckets(row.counterTableSizeHands, ['HU', '3_TO_5', 'SIX_PLUS']) &&
      (!row.positionTimes || count(row.positionTimes.count) && count(row.positionTimes.nonNullCount) && row.positionTimes.count <= row.playerHandCount && row.positionTimes.nonNullCount <= row.positionTimes.count);
  }
  // The resolver's only out-of-group dependency is predecessor presence and
  // validation. Foreign predecessors always fail cross-hand transition in the
  // child's group; they do not invalidate the parent. Never project those peers.
  function readProjectionGroup(tx, handKey, complete, fail) {
    var store = tx.objectStore(STORE_RECORDS), request = store.index('handKey').getAll(handKey);
    request.onsuccess = function () { try {
      var records = (request.result || []).map(function (wrapper) { return wrapper.record; });
      var present = new Set(records.map(function (record) { return record.fingerprint; }));
      var missing = Array.from(new Set(records.map(function (record) { return record.supersedesFingerprint; }).filter(function (fp) { return fp && !present.has(fp); })));
      var context = [], remaining = missing.length;
      function finish() {
        var resolved = Aggregator.resolveActiveRecords(records.concat(context));
        complete(resolved.activeRecords.find(function (record) { return record.handKey === handKey; }) || null,
          resolved.physicalRecords.filter(function (record) { return record.handKey === handKey; }), records.length + context.length);
      }
      if (!remaining) { finish(); return; }
      missing.forEach(function (fp) {
        var predecessor = store.get(fp);
        predecessor.onsuccess = function () { try { if (predecessor.result) context.push(predecessor.result.record); if (--remaining === 0) finish(); } catch (error) { fail(error); } };
      });
    } catch (error) { fail(error); } };
  }
  function projectionPopulationKey(playerId) { return ['sessionProjectionPopulation', playerId]; }
  // Hand membership is a derived selection hint, never record/stat authority.
  // Raw Recent compares String(participantId), but retain the exact persisted
  // JSON identity in the typed primary key (including legacy nonstring IDs).
  function membershipIdentity(id) { return [typeof id, JSON.stringify(id)]; }
  function membershipPopulationKey(id) { return ['handMembershipPopulation', id]; }
  function membershipCollation() {
    return canonicalJson(new Intl.Collator().resolvedOptions()) + '|' +
      (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  }
  function emptyMembershipState(revision) {
    return { key: HAND_MEMBERSHIP_STATE_KEY, version: HAND_MEMBERSHIP_VERSION, status: 'building',
      generation: projectionToken(), sourceRevision: revision, collation: membershipCollation(),
      checkpoint: null, cleanup: true, chunks: 0, groups: 0, rows: 0, datedRows: 0, maxChunkRecords: 0, completeness: null };
  }
  function sealMembershipState(state) {
    state.completeness = { version: state.version, careerGeneration: state.careerGeneration, generation: state.generation, sourceRevision: state.sourceRevision,
      collation: state.collation, checkpoint: state.checkpoint, cleanup: state.cleanup, chunks: state.chunks, groups: state.groups,
      rows: state.rows, datedRows: state.datedRows, maxChunkRecords: state.maxChunkRecords };
  }
  function validMembershipProgress(state) {
    return Boolean(state && typeof state.careerGeneration === 'string' && state.careerGeneration && state.key === HAND_MEMBERSHIP_STATE_KEY && state.version === HAND_MEMBERSHIP_VERSION &&
      typeof state.generation === 'string' && state.generation && typeof state.sourceRevision === 'string' && state.sourceRevision &&
      state.collation === membershipCollation() && typeof state.cleanup === 'boolean' && ['chunks', 'groups', 'rows', 'datedRows', 'maxChunkRecords'].every(function (field) {
        return Number.isSafeInteger(state[field]) && state[field] >= 0;
      }) && state.datedRows <= state.rows && (state.groups === 0 ? state.checkpoint === null : typeof state.checkpoint === 'string' && state.checkpoint));
  }
  function validMembershipReady(state, revision) {
    if (!validMembershipProgress(state) || state.cleanup || state.status !== 'ready' || state.sourceRevision !== revision || state.chunks < 1) return false;
    var expected = clone(state); sealMembershipState(expected);
    return canonicalJson(state.completeness) === canonicalJson(expected.completeness);
  }
  function publicMembershipState(state, revision) {
    var ready = validMembershipReady(state, revision);
    return Object.assign({}, state || { version: HAND_MEMBERSHIP_VERSION, status: 'absent' }, {
      ledgerRevision: revision || null, ready: ready, needsBackfill: !ready,
      restartRequired: Boolean(state && (!validMembershipProgress(state) || state.sourceRevision !== revision || state.status === 'ready' && !ready))
    });
  }
  function membershipChronology(row) { return [row.playerId, row.orderTime, row.tieOrder]; }
  function validMembershipKey(key, id) {
    return key === null || Array.isArray(key) && key.length === 3 && key[0] === id && Number.isSafeInteger(key[1]) && key[1] < 0 &&
      Array.isArray(key[2]) && key[2].length > 0 && key[2].every(function (digit) { return Number.isInteger(digit) && digit >= 0 && digit < 65536; }) && key[2][key[2].length - 1] > 0;
  }
  function validMembershipRow(row, state) {
    return Boolean(row && row.careerGeneration === state.careerGeneration && row.version === HAND_MEMBERSHIP_VERSION && row.generation === state.generation &&
      row.playerId === String(row.participantId) && typeof row.handKey === 'string' && row.handKey && typeof row.fingerprint === 'string' && row.fingerprint &&
      sameProjectionKey(row.key, [membershipIdentity(row.participantId), row.handKey]) &&
      (row.finalizedAt === null ? row.orderTime === null && row.tieOrder === null && row.nextKey === null :
        handTime(row) === row.finalizedAt && row.orderTime === -row.finalizedAt && validMembershipKey(membershipChronology(row), row.playerId) &&
        validMembershipKey(row.nextKey, row.playerId) && (row.nextKey === null || IDBKeyRange.lowerBound(membershipChronology(row), true).includes(row.nextKey))));
  }
  function validMembershipPopulation(row, state, id) {
    return Boolean(row && row.careerGeneration === state.careerGeneration && row.version === HAND_MEMBERSHIP_VERSION && row.generation === state.generation && row.playerId === id &&
      sameProjectionKey(row.key, membershipPopulationKey(id)) && Number.isSafeInteger(row.rows) && row.rows > 0 && row.rows <= state.rows &&
      Number.isSafeInteger(row.datedRows) && row.datedRows >= 0 && row.datedRows <= row.rows && row.datedRows <= state.datedRows &&
      validMembershipKey(row.firstKey, id) && (row.datedRows === 0) === (row.firstKey === null));
  }
  // Arbitrary-length fractional array labels: no floating-point precision limit.
  // These encode persisted localeCompare order, not IDB's binary string order.
  function membershipLabelBetween(lower, upper) {
    // Leave midpoint splitting for constrained gaps. Sequential tied inserts
    // use integer space, so label depth does not grow every sixteen appends.
    if (!upper && lower) {
      var next = lower.slice(), tail = next.length - 1;
      if (next[tail] < 65535) next[tail] += 1; else next.push(32768);
      return next;
    }
    if (!lower && upper) {
      var prior = upper.slice(), last = prior.length - 1;
      if (prior[last] > 1) prior[last] -= 1; else { prior[last] = 0; prior.push(32768); }
      return prior;
    }
    var label = [], i = 0;
    for (;;) {
      var lo = lower && i < lower.length ? lower[i] : 0;
      var hi = upper && i < upper.length ? upper[i] : 65536;
      if (hi - lo > 1) { label.push(Math.floor((lo + hi) / 2)); return label; }
      label.push(lo); if (lo < hi) upper = null; i += 1;
    }
  }
  function membershipEntries(active) {
    return active ? active.players.filter(function (entry) { return Number(entry.counters && entry.counters.hands || 0) > 0; }) : [];
  }
  function insertMembership(tx, active, entry, state, complete, fail) {
    var store = tx.objectStore(STORE_HAND_MEMBERSHIPS), metadata = tx.objectStore(STORE_METADATA), id = String(entry.playerId);
    var row = { key: [membershipIdentity(entry.playerId), active.handKey], version: HAND_MEMBERSHIP_VERSION,
      generation: state.generation, participantId: clone(entry.playerId), playerId: id, handKey: active.handKey,
      fingerprint: active.fingerprint, finalizedAt: handTime(active), orderTime: null, tieOrder: null, nextKey: null };
    var populationRequest = metadata.get(membershipPopulationKey(id));
    populationRequest.onsuccess = function () { try {
      var population = populationRequest.result;
      if (population && !validMembershipPopulation(population, state, id)) throw new Error('Invalid hand membership population');
      if (!population) population = { key: membershipPopulationKey(id), version: HAND_MEMBERSHIP_VERSION,
        generation: state.generation, playerId: id, rows: 0, datedRows: 0, firstKey: null };
      function publish() {
        population.rows += 1; state.rows += 1;
        if (row.finalizedAt !== null) { population.datedRows += 1; state.datedRows += 1; }
        store.add(row); metadata.put(population); complete();
      }
      if (row.finalizedAt === null) { publish(); return; }
      row.orderTime = -row.finalizedAt;
      var index = store.index('playerChronology'), lower = null;
      var tieRequest = index.openCursor(IDBKeyRange.bound([id, row.orderTime], [id, row.orderTime, [[]]]));
      tieRequest.onsuccess = function () { try {
        var cursor = tieRequest.result;
        if (cursor) {
          var other = cursor.value;
          if (!validMembershipRow(other, state)) throw new Error('Invalid chronology tie membership');
          var comparison = other.handKey.localeCompare(row.handKey) || other.fingerprint.localeCompare(row.fingerprint);
          if (comparison < 0) { lower = other.tieOrder; cursor.continue(); return; }
          if (comparison === 0) throw new Error('Duplicate hand membership chronology');
        }
        row.tieOrder = membershipLabelBetween(lower, cursor ? cursor.value.tieOrder : null);
        var key = membershipChronology(row), previous, following, remaining = 2;
        var before = index.openCursor(IDBKeyRange.upperBound(key, true), 'prev');
        var after = index.openCursor(IDBKeyRange.lowerBound(key, true));
        function join() {
          if (--remaining) return;
          if (previous && !validMembershipRow(previous, state) || following && !validMembershipRow(following, state)) throw new Error('Invalid chronology neighbor');
          var nextKey = following ? membershipChronology(following) : null;
          if (!sameProjectionKey(previous ? previous.nextKey : population.firstKey, nextKey)) throw new Error('Incomplete hand membership chronology');
          row.nextKey = nextKey;
          if (previous) { previous.nextKey = key; store.put(previous); } else population.firstKey = key;
          publish();
        }
        before.onsuccess = function () { try { previous = before.result && before.result.value.playerId === id ? before.result.value : null; join(); } catch (error) { fail(error); } };
        after.onsuccess = function () { try { following = after.result && after.result.value.playerId === id ? after.result.value : null; join(); } catch (error) { fail(error); } };
      } catch (error) { fail(error); } };
    } catch (error) { fail(error); } };
  }
  function removeMembership(tx, active, entry, state, complete, fail) {
    var store = tx.objectStore(STORE_HAND_MEMBERSHIPS), metadata = tx.objectStore(STORE_METADATA), id = String(entry.playerId);
    var request = store.get([membershipIdentity(entry.playerId), active.handKey]);
    request.onsuccess = function () { try {
      var row = request.result;
      if (!validMembershipRow(row, state) || row.fingerprint !== active.fingerprint) throw new Error('Missing active hand membership during replacement');
      var populationRequest = metadata.get(membershipPopulationKey(id));
      populationRequest.onsuccess = function () { try {
        var population = populationRequest.result;
        if (!validMembershipPopulation(population, state, id)) throw new Error('Invalid replacement membership population');
        function publish(previous) {
          if (row.finalizedAt !== null) {
            if (previous && !validMembershipRow(previous, state)) throw new Error('Invalid replacement chronology predecessor');
            if (!sameProjectionKey(previous ? previous.nextKey : population.firstKey, membershipChronology(row))) throw new Error('Incomplete replacement chronology');
            if (previous) { previous.nextKey = row.nextKey; store.put(previous); } else population.firstKey = row.nextKey;
            population.datedRows -= 1; state.datedRows -= 1;
          }
          population.rows -= 1; state.rows -= 1; store.delete(row.key);
          if (population.rows) metadata.put(population); else metadata.delete(population.key);
          complete();
        }
        if (row.finalizedAt === null) { publish(null); return; }
        var previousRequest = store.index('playerChronology').openCursor(IDBKeyRange.upperBound(membershipChronology(row), true), 'prev');
        previousRequest.onsuccess = function () { try { publish(previousRequest.result && previousRequest.result.value.playerId === id ? previousRequest.result.value : null); } catch (error) { fail(error); } };
      } catch (error) { fail(error); } };
    } catch (error) { fail(error); } };
  }
  function maintainMembershipAppend(tx, record, handValues, supersession, state, oldRevision, newRevision, fail) {
    var metadata = tx.objectStore(STORE_METADATA);
    if (!validMembershipReady(state, oldRevision)) {
      if (state) { state.status = 'stale'; state.reason = 'Career append during incomplete membership generation'; metadata.put(state); }
      return;
    }
    var old = supersession ? Aggregator.resolveActiveRecords(handValues.map(function (wrapper) { return wrapper.record; })).activeRecords[0] : null;
    var removals = membershipEntries(old), additions = membershipEntries(record), i = 0;
    function addNext() {
      if (i < additions.length) { insertMembership(tx, record, additions[i++], state, addNext, fail); return; }
      state.sourceRevision = newRevision; sealMembershipState(state); metadata.put(state);
    }
    function removeNext() {
      if (i < removals.length) { removeMembership(tx, old, removals[i++], state, removeNext, fail); return; }
      i = 0; addNext();
    }
    removeNext();
  }
  function validProjectionPopulation(row, state, playerId) {
    return row && row.careerGeneration === state.careerGeneration && row.version === 1 && row.generation === state.generation && row.playerId === playerId &&
      sameProjectionKey(row.key, projectionPopulationKey(playerId)) && Number.isSafeInteger(row.playerRows) && row.playerRows >= 0 &&
      row.playerRows <= state.counts.player && typeof row.unassigned === 'boolean' && (!row.unassigned || state.counts.unassigned > 0);
  }
  function changeProjectionPopulation(tx, row, change, state, complete, fail) {
    if (row.kind === 'canonical' || !change) { complete(); return; }
    var store = tx.objectStore(STORE_METADATA), request = store.get(projectionPopulationKey(row.playerId));
    request.onsuccess = function () { try {
      var value = request.result;
      if (value && (value.version !== 1 || value.generation !== state.generation || value.playerId !== row.playerId ||
          !Number.isSafeInteger(value.playerRows) || value.playerRows < 0 || typeof value.unassigned !== 'boolean')) throw new Error('Invalid Session projection population metadata');
      if (!value) {
        if (change < 0) throw new Error('Missing Session projection population metadata');
        value = { key: projectionPopulationKey(row.playerId), version: 1, generation: state.generation, playerId: row.playerId, playerRows: 0, unassigned: false };
      }
      if (row.kind === 'player') value.playerRows += change;
      else {
        if (value.unassigned !== (change < 0)) throw new Error('Invalid unassigned Session population transition');
        value.unassigned = change > 0;
      }
      if (value.playerRows < 0) throw new Error('Negative Session projection population');
      // Keep a zero row too: absence is reserved for players never in this generation.
      store.put(value); complete();
    } catch (error) { fail(error); } };
  }
  // Maintain a bounded adjacency witness. It detects a deleted/index-missing
  // canonical row as soon as its chronology range is requested, without counts.
  function writeCanonicalProjection(tx, previous, next, state, complete, fail) {
    var store = tx.objectStore(STORE_SESSION_PROJECTIONS), index = store.index('canonicalChronology');
    var oldKey = previous && projectionChronologyKey(previous), newKey = next && projectionChronologyKey(next);
    if (previous && !validProjectionReadRow(previous, state)) throw new Error('Invalid canonical Session projection during maintenance');
    if (oldKey && newKey && sameProjectionKey(oldKey, newKey)) {
      next.nextCanonicalKey = previous.nextCanonicalKey; store.put(next); complete(); return;
    }
    function predecessor(key, callback) {
      var request = index.openCursor(IDBKeyRange.bound(['canonical'], key, false, true), 'prev');
      request.onsuccess = function () { try {
        var cursor = request.result;
        if (cursor && !validProjectionReadRow(cursor.value, state)) throw new Error('Invalid canonical chronology predecessor');
        callback(cursor && cursor.value);
      } catch (error) { fail(error); } };
    }
    function insert() {
      if (!next) { complete(); return; }
      var following = index.openCursor(IDBKeyRange.bound(newKey, ['canonical', []], true, false));
      following.onsuccess = function () { try {
        var cursor = following.result, followingKey = cursor ? cursor.key : null;
        if (cursor && !validProjectionReadRow(cursor.value, state)) throw new Error('Invalid canonical chronology successor');
        predecessor(newKey, function (prior) {
          if (!sameProjectionKey(prior ? prior.nextCanonicalKey : state.firstCanonicalKey, followingKey)) throw new Error('Incomplete canonical chronology during insertion');
          next.nextCanonicalKey = followingKey;
          if (prior) { prior.nextCanonicalKey = newKey; store.put(prior); }
          else state.firstCanonicalKey = newKey;
          store.put(next); complete();
        });
      } catch (error) { fail(error); } };
    }
    if (!previous) { insert(); return; }
    predecessor(oldKey, function (prior) {
      if (!sameProjectionKey(prior ? prior.nextCanonicalKey : state.firstCanonicalKey, oldKey)) throw new Error('Incomplete canonical chronology during removal');
      if (prior) { prior.nextCanonicalKey = previous.nextCanonicalKey; store.put(prior); }
      else state.firstCanonicalKey = previous.nextCanonicalKey;
      store.delete(previous.key); insert();
    });
  }
  function putProjectionDeltas(tx, rows, state, complete, fail) {
    var store = tx.objectStore(STORE_SESSION_PROJECTIONS), remaining = rows.length;
    if (!remaining) { complete(); return; }
    rows.forEach(function (delta) {
      var request = store.get(delta.key);
      request.onsuccess = function () { try {
        var previous = request.result;
        var target = previous && delta.kind === 'canonical' ? Object.assign({}, previous, { tableSizeHands: Object.assign({}, previous.tableSizeHands) }) : previous;
        var merged = mergeProjectionRow(target, delta, state);
        function finished() { if (--remaining === 0) complete(); }
        if (delta.kind === 'canonical') writeCanonicalProjection(tx, previous, merged, state, finished, fail);
        else {
          store.put(merged);
          changeProjectionPopulation(tx, merged, previous ? 0 : 1, state, finished, fail);
        }
      } catch (error) { fail(error); } };
    });
  }
  function invalidateSessionProjections(tx, reason) {
    var store = tx.objectStore(STORE_METADATA), request = store.get(SESSION_PROJECTION_STATE_KEY);
    request.onsuccess = function () {
      try {
        var state = request.result || emptyProjectionState();
        state.ledgerRevision = projectionToken(); state.status = 'stale'; state.reason = reason;
        store.put(state);
        var membershipRequest = store.get(HAND_MEMBERSHIP_STATE_KEY);
        membershipRequest.onsuccess = function () { try {
          if (membershipRequest.result) {
            var membership = membershipRequest.result; membership.status = 'stale'; membership.reason = reason;
            store.put(membership);
          }
        } catch (error) { try { tx.abort(); } catch (_abortError) {} } };
      } catch (error) { try { tx.abort(); } catch (_abortError) {} }
    };
  }
  function maintainSessionProjectionAppend(tx, record, handValues, supersession, priorState, fail) {
    var state = priorState || emptyProjectionState(), wasReady = validProjectionReadState(state);
    state.ledgerRevision = projectionToken();
    var metadata = tx.objectStore(STORE_METADATA);
    function publish() {
      state.sourceRevision = state.ledgerRevision;
      state.status = state.catalogError ? 'invalid' : 'ready';
      sealProjectionState(state);
      metadata.put(state);
    }
    if (!wasReady) {
      if (state.status !== 'absent') state.status = 'stale';
      metadata.put(state); return;
    }
    var id = sessionIdOf(record);
    if (!supersession) {
      putProjectionDeltas(tx, projectionDeltas(record, [record], state.generation), state, publish, fail); return;
    }
    if (!id) {
      var old = Aggregator.resolveActiveRecords(handValues.map(function (wrapper) { return wrapper.record; })).activeRecords[0];
      var previous = projectionDeltas(old, [], state.generation), next = projectionDeltas(record, [], state.generation);
      var ids = new Set(previous.concat(next).map(function (row) { return row.playerId; })), remaining = ids.size;
      if (!remaining) { publish(); return; }
      ids.forEach(function (playerId) {
        var store = tx.objectStore(STORE_SESSION_PROJECTIONS), key = projectionKey('unassigned', playerId, '');
        var request = store.get(key);
        request.onsuccess = function () { try {
          var row = request.result;
          var before = previous.find(function (row) { return row.playerId === playerId; });
          var after = next.find(function (row) { return row.playerId === playerId; });
          if (before && (!row || row.generation !== state.generation)) throw new Error('Missing unassigned Session projection; explicit rebuild required');
          var existed = Boolean(row);
          if (!row) { row = projectionRow('unassigned', playerId, '', state.generation); row.legacyHandCount = row.unsupportedHandCount = 0; state.counts.unassigned += 1; }
          row.legacyHandCount += Number(after && after.legacyHandCount || 0) - Number(before && before.legacyHandCount || 0);
          row.unsupportedHandCount += Number(after && after.unsupportedHandCount || 0) - Number(before && before.unsupportedHandCount || 0);
          var exists = Boolean(row.legacyHandCount || row.unsupportedHandCount);
          if (!exists) { store.delete(key); state.counts.unassigned -= 1; }
          else store.put(row);
          changeProjectionPopulation(tx, row, Number(exists) - Number(existed), state, function () { if (--remaining === 0) publish(); }, fail);
        } catch (error) { fail(error); } };
      });
      return;
    }
    // Replacement may remove extrema/coverage witnesses or positive membership.
    // Rebuild only the affected Session's compact rows using complete groups.
    // This uncommon path is proportional to that Session, not the whole ledger.
    var candidates = tx.objectStore(STORE_RECORDS).index('sessionId').getAll(id);
    candidates.onsuccess = function () { try {
      var keys = Array.from(new Set((candidates.result || []).map(function (wrapper) { return wrapper.record.handKey; })));
      var rows = new Map(), index = 0;
      var rebuiltState = { generation: state.generation, counts: { canonical: 0, player: 0, unassigned: 0 }, catalogError: null };
      function step() {
        if (index === keys.length) { replaceRows(); return; }
        readProjectionGroup(tx, keys[index++], function (active, physical) {
          if (active && sessionIdOf(active) === id) projectionDeltas(active, physical, state.generation).forEach(function (delta) {
            rows.set(canonicalJson(delta.key), mergeProjectionRow(rows.get(canonicalJson(delta.key)), delta, rebuiltState));
          });
          step();
        }, fail);
      }
      function replaceRows() {
        var store = tx.objectStore(STORE_SESSION_PROJECTIONS), old = store.index('sessionId').getAll(id);
        old.onsuccess = function () { try {
          var previous = old.result || [], replacements = Array.from(rows.values()), at = 0;
          function removeNext() {
            if (at === previous.length) { at = 0; addNext(); return; }
            var row = previous[at++];
            if (row.generation !== state.generation) throw new Error('Session projection generation mismatch; explicit rebuild required');
            state.counts[row.kind] -= 1;
            if (row.kind === 'canonical') writeCanonicalProjection(tx, row, null, state, removeNext, fail);
            else { store.delete(row.key); changeProjectionPopulation(tx, row, -1, state, removeNext, fail); }
          }
          function addNext() {
            if (at === replacements.length) { state.catalogError = rebuiltState.catalogError; publish(); return; }
            var row = replacements[at++]; state.counts[row.kind] += 1;
            if (row.kind === 'canonical') writeCanonicalProjection(tx, null, row, state, addNext, fail);
            else { store.put(row); changeProjectionPopulation(tx, row, 1, state, addNext, fail); }
          }
          removeNext();
        } catch (error) { fail(error); } };
      }
      step();
    } catch (error) { fail(error); } };
  }
  function requestPromise(request) { return new Promise(function (resolve, reject) { request.onsuccess = function () { resolve(request.result); }; request.onerror = function () { reject(request.error || new Error('IndexedDB request failed')); }; }); }
  function transactionPromise(transaction) { return new Promise(function (resolve, reject) { transaction.oncomplete = function () { resolve(); }; transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB transaction failed')); }; transaction.onabort = function () { reject(transaction.error || new Error('IndexedDB transaction aborted')); }; }); }
  function bankStore(name, bank) { return BANKED_STORES.indexOf(name) < 0 || bank === 'A' ? name : name + 'B'; }
  async function putRoutedCareerCache(transaction, cache) {
    try {
      transaction.objectStore(STORE_AGGREGATES).put(cache);
      await transactionPromise(transaction);
    } catch (error) { try { transaction.abort(); } catch (_abortError) {} throw error; }
  }
  function routedPromise(db, names, mode, executor, expected) {
    return routedTransaction(db, names, mode, expected).then(function (tx) {
      return new Promise(function (resolve, reject) {
        try { executor(tx, resolve, reject); }
        catch (error) { try { tx.abort(); } catch (_abortError) {} reject(error); }
      });
    });
  }
  function validCareerControl(value) {
    return Boolean(value && value.key === 'active' && value.version === 1 && ['A', 'B'].indexOf(value.bank) >= 0 &&
      typeof value.careerGeneration === 'string' && value.careerGeneration);
  }
  // Resolve control inside the SAME native transaction as every authority read
  // and write. Both banks are in scope; only the selected bank is exposed.
  // The adapter translates established logical sidecar keys/witnesses at the
  // storage boundary, so the existing resolver/backfill algorithms stay owners.
  async function routedTransaction(db, names, mode, expected) {
    names = typeof names === 'string' ? [names] : names;
    var scope = [STORE_CONTROL, STORE_METADATA, bankStore(STORE_METADATA, 'B')];
    names.forEach(function (name) {
      if (name === STORE_SESSION_PROJECTIONS) scope.push(STORE_GENERATION_PROJECTIONS);
      else if (name === STORE_HAND_MEMBERSHIPS) scope.push(STORE_GENERATION_MEMBERSHIPS);
      else { scope.push(name); if (BANKED_STORES.indexOf(name) >= 0) scope.push(bankStore(name, 'B')); }
    });
    var native = db.transaction(Array.from(new Set(scope)), mode || 'readonly');
    try {
      var control = await requestPromise(native.objectStore(STORE_CONTROL).get('active'));
      if (!validCareerControl(control)) throw new Error('Invalid Career routing control');
      var metadata = native.objectStore(bankStore(STORE_METADATA, control.bank));
      var values = await Promise.all([requestPromise(metadata.get(SESSION_PROJECTION_STATE_KEY)), requestPromise(metadata.get(HAND_MEMBERSHIP_STATE_KEY))]);
      var states = { projection: values[0], membership: values[1] };
      var route = Object.freeze({ bank: control.bank, careerGeneration: control.careerGeneration, ledgerRevision: values[0] && values[0].ledgerRevision });
      if (expected && (expected.bank !== route.bank || expected.careerGeneration !== route.careerGeneration || expected.ledgerRevision !== route.ledgerRevision))
        throw new Error('Career routing snapshot changed; retry operation');
      function kindForKey(key) { return Array.isArray(key) && key[0] === 'handMembershipPopulation' ? 'membership' : 'projection'; }
      function prefix(kind) {
        var state = states[kind];
        return [route.careerGeneration, state && state.generation || 'unavailable'];
      }
      function encodeKey(key, kind) { return prefix(kind).concat(Array.isArray(key) ? key : [key]); }
      function decodeKey(key, kind) {
        var p = prefix(kind);
        return Array.isArray(key) && key[0] === p[0] && key[1] === p[1] ? key.slice(2) : key;
      }
      function range(query, kind) {
        var p = prefix(kind), end = [p[0], p[1] + '\u0000'];
        if (query === undefined || query === null) return IDBKeyRange.bound(p, end, false, true);
        if (!(query instanceof IDBKeyRange)) return encodeKey(query, kind);
        return IDBKeyRange.bound(query.lower === undefined ? p : encodeKey(query.lower, kind),
          query.upper === undefined ? end : encodeKey(query.upper, kind), query.lower === undefined ? false : query.lowerOpen,
          query.upper === undefined ? true : query.upperOpen);
      }
      function decodeRow(value, kind) {
        if (!value) return value;
        var row = Object.assign({}, value);
        row.key = decodeKey(row.key, kind);
        ['nextCanonicalKey', 'nextKey', 'firstKey'].forEach(function (field) { if (row[field] !== undefined && row[field] !== null) row[field] = decodeKey(row[field], kind); });
        return row;
      }
      function encodeRow(value, kind) {
        var row = Object.assign({}, value, { careerGeneration: route.careerGeneration });
        row.key = encodeKey(row.key, kind);
        ['nextCanonicalKey', 'nextKey', 'firstKey'].forEach(function (field) { if (row[field] !== undefined && row[field] !== null) row[field] = encodeKey(row[field], kind); });
        return row;
      }
      function projectionControlRow(value, encode) {
        if (!value) return value;
        var row = Object.assign({}, value), convert = encode ? encodeKey : decodeKey;
        if (row.firstCanonicalKey) row.firstCanonicalKey = convert(row.firstCanonicalKey, 'projection');
        if (row.completeness) {
          row.completeness = Object.assign({}, row.completeness);
          if (row.completeness.firstCanonicalKey) row.completeness.firstCanonicalKey = convert(row.completeness.firstCanonicalKey, 'projection');
        }
        return row;
      }
      function adaptRequest(request, transform, cursorKind) {
        return new Proxy(request, { get: function (target, property) {
          if (property === 'result') {
            var result = target.result;
            if (!cursorKind || !result) return transform(result);
            return new Proxy(result, { get: function (cursor, field) {
              if (field === 'key' || field === 'primaryKey') return decodeKey(cursor[field], cursorKind);
              if (field === 'value') return decodeRow(cursor.value, cursorKind);
              if (field === 'continue') return function (key) { return key === undefined ? cursor.continue() : cursor.continue(encodeKey(key, cursorKind)); };
              if (field === 'update') return function (row) { return cursor.update(encodeRow(row, cursorKind)); };
              var value = Reflect.get(cursor, field, cursor); return typeof value === 'function' ? value.bind(cursor) : value;
            } });
          }
          var value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
        }, set: function (target, property, value) { target[property] = value; return true; } });
      }
      function sidecarStore(store, kind) {
        return new Proxy(store, { get: function (target, property) {
          if (property === 'index') return function (name) { return sidecarStore(target.index(name), kind); };
          if (property === 'put' || property === 'add') return function (row) { return target[property](encodeRow(row, kind)); };
          // A fresh build has a fresh namespace. Retired rows stay invisible;
          // no unbounded clear is admitted in a chunk or publication.
          if (property === 'clear') return function () { return target.count(range(null, kind)); };
          if (['get', 'getAll', 'getAllKeys', 'count', 'delete', 'openCursor', 'openKeyCursor'].indexOf(property) >= 0)
            return function (query, extra) {
              var req = extra === undefined ? target[property](range(query, kind)) : target[property](range(query, kind), extra);
              return adaptRequest(req, function (result) {
                if (property === 'get') return decodeRow(result, kind);
                if (property === 'getAll') return result.map(function (row) { return decodeRow(row, kind); });
                if (property === 'getAllKeys') return result.map(function (key) { return decodeKey(key, kind); });
                return result;
              }, property === 'openCursor' || property === 'openKeyCursor' ? kind : null);
            };
          var value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
        } });
      }
      function metadataStore() {
        return new Proxy(metadata, { get: function (target, property) {
          if (property === 'get') return function (key) {
            var population = Array.isArray(key), kind = kindForKey(key);
            return adaptRequest(target.get(population ? encodeKey(key, kind) : key), function (row) {
              if (population) return decodeRow(row, kind);
              if (key === SESSION_PROJECTION_STATE_KEY || key === HAND_MEMBERSHIP_STATE_KEY) {
                if (row && row.careerGeneration !== route.careerGeneration) {
                  if (key === HAND_MEMBERSHIP_STATE_KEY) return undefined;
                  var absent = emptyProjectionState(); absent.ledgerRevision = row.ledgerRevision; absent.careerGeneration = route.careerGeneration; return absent;
                }
              }
              return key === SESSION_PROJECTION_STATE_KEY ? projectionControlRow(row, false) : row;
            });
          };
          if (property === 'put' || property === 'add') return function (row) {
            if (Array.isArray(row.key)) return target[property](encodeRow(row, kindForKey(row.key)));
            if (row.key === SESSION_PROJECTION_STATE_KEY || row.key === HAND_MEMBERSHIP_STATE_KEY) {
              row.careerGeneration = route.careerGeneration;
              states[row.key === SESSION_PROJECTION_STATE_KEY ? 'projection' : 'membership'] = row;
            }
            return target[property](row.key === SESSION_PROJECTION_STATE_KEY ? projectionControlRow(row, true) : row);
          };
          if (property === 'delete') return function (key) { return target.delete(Array.isArray(key) ? encodeKey(key, kindForKey(key)) : key); };
          if (property === 'openKeyCursor') return function (query) {
            var kind = kindForKey(query.lower); return adaptRequest(target.openKeyCursor(range(query, kind)), function (v) { return v; }, kind);
          };
          var value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
        } });
      }
      return new Proxy(native, { get: function (target, property) {
        if (property === 'route') return route;
        // Retirement uses physical prefixes, never the logical active adapter.
        // Deliberately incapable of exposing an authoritative family here.
        if (property === 'retirementStore') return function (name) {
          if (DERIVED_CLEANUP_STORES.indexOf(name) < 0) throw new Error('Not a derived retirement store');
          return target.objectStore(name);
        };
        if (property === 'bindDerived') return function (kind, state) { state.careerGeneration = route.careerGeneration; states[kind] = state; };
        if (property === 'objectStore') return function (name) {
          if (name === STORE_METADATA) return metadataStore();
          if (name === STORE_SESSION_PROJECTIONS) return sidecarStore(target.objectStore(STORE_GENERATION_PROJECTIONS), 'projection');
          if (name === STORE_HAND_MEMBERSHIPS) return sidecarStore(target.objectStore(STORE_GENERATION_MEMBERSHIPS), 'membership');
          return target.objectStore(bankStore(name, route.bank));
        };
        var value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
      }, set: function (target, property, value) { target[property] = value; return true; } });
    } catch (error) { try { native.abort(); } catch (_abortError) {} throw error; }
  }
  function openDatabase(indexedDB) {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      var upgradeError = null; var blocked = false;
      request.onupgradeneeded = function (event) {
        var db = request.result;
        try {
          var records;
          if (event.oldVersion < 1) {
            records = db.createObjectStore(STORE_RECORDS, { keyPath: 'record.fingerprint' });
            records.createIndex('handKey', 'record.handKey', { unique: false });
            records.createIndex('playerIds', 'playerIds', { unique: false, multiEntry: true });
            records.createIndex('finalizedAt', 'record.finalizedAt', { unique: false });
            records.createIndex('supersedesFingerprint', 'record.supersedesFingerprint', { unique: false });
            db.createObjectStore(STORE_METADATA, { keyPath: 'key' });
            db.createObjectStore(STORE_AGGREGATES, { keyPath: 'playerId' });
            db.createObjectStore(STORE_PLAYER_HEADS, { keyPath: 'playerId' });
          } else {
            records = request.transaction.objectStore(STORE_RECORDS);
          }
          // Physical candidates only; active authority still belongs to the resolver.
          if (event.oldVersion < 2) records.createIndex('sessionId', 'record.session.sessionId', { unique: false });
          if (event.oldVersion < 3) {
            var projections = db.createObjectStore('careerSessionProjections', { keyPath: 'key' });
            projections.createIndex('canonicalChronology', ['kind', 'orderTime', 'sessionId'], { unique: false });
            projections.createIndex('sessionId', 'sessionId', { unique: false });
          }
          if (event.oldVersion < 4) {
            var memberships = db.createObjectStore('careerHandMemberships', { keyPath: 'key' });
            memberships.createIndex('playerChronology', ['playerId', 'orderTime', 'tieOrder'], { unique: true });
          }
          if (event.oldVersion < 5) {
            var recordsB = db.createObjectStore(bankStore(STORE_RECORDS, 'B'), { keyPath: 'record.fingerprint' });
            ['handKey', 'finalizedAt', 'supersedesFingerprint', 'sessionId'].forEach(function (name) {
              recordsB.createIndex(name, name === 'sessionId' ? 'record.session.sessionId' : 'record.' + name, { unique: false });
            });
            recordsB.createIndex('playerIds', 'playerIds', { unique: false, multiEntry: true });
            db.createObjectStore(bankStore(STORE_METADATA, 'B'), { keyPath: 'key' });
            db.createObjectStore(bankStore(STORE_AGGREGATES, 'B'), { keyPath: 'playerId' });
            db.createObjectStore(bankStore(STORE_PLAYER_HEADS, 'B'), { keyPath: 'playerId' });
            var control = db.createObjectStore(STORE_CONTROL, { keyPath: 'key' });
            var sharedProjections = db.createObjectStore(STORE_GENERATION_PROJECTIONS, { keyPath: 'key' });
            sharedProjections.createIndex('canonicalChronology', ['careerGeneration', 'generation', 'kind', 'orderTime', 'sessionId'], { unique: false });
            sharedProjections.createIndex('sessionId', ['careerGeneration', 'generation', 'sessionId'], { unique: false });
            var sharedMemberships = db.createObjectStore(STORE_GENERATION_MEMBERSHIPS, { keyPath: 'key' });
            sharedMemberships.createIndex('playerChronology', ['careerGeneration', 'generation', 'playerId', 'orderTime', 'tieOrder'], { unique: true });
            var generation = projectionToken(), metadataA = request.transaction.objectStore(STORE_METADATA);
            control.put({ key: 'active', version: 1, bank: 'A', careerGeneration: generation });
            control.put({ key: 'legacyDerivedCleanup', version: 1, status: 'pending' });
            var oldControl = metadataA.get(SESSION_PROJECTION_STATE_KEY);
            oldControl.onsuccess = function () { try {
              var state = emptyProjectionState(), old = oldControl.result;
              if (old && typeof old.ledgerRevision === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(old.ledgerRevision)) state.ledgerRevision = old.ledgerRevision;
              state.careerGeneration = generation;
              metadataA.put(state);
              metadataA.put({ key: HAND_MEMBERSHIP_STATE_KEY, version: HAND_MEMBERSHIP_VERSION, status: 'absent', careerGeneration: generation });
            } catch (error) { upgradeError = error; request.transaction.abort(); } };
          }
        } catch (error) {
          upgradeError = error;
          try { request.transaction.abort(); } catch (_abortError) { /* Preserve the upgrade failure. */ }
        }
      };
      request.onsuccess = function () { if (blocked) request.result.close(); else { request.result.onversionchange = function () { request.result.close(); }; resolve(request.result); } };
      request.onerror = function () { reject(upgradeError || request.error || new Error('Unable to open career IndexedDB')); };
      request.onblocked = function () { blocked = true; reject(new Error('Career IndexedDB upgrade was blocked by another extension context')); };
    });
  }
  async function initializeDatabase(db, saved, options) {
    var read = await routedTransaction(db, [STORE_METADATA], 'readonly');
    var existing = await requestPromise(read.objectStore(STORE_METADATA).get('career'));
    await transactionPromise(read);
    if (existing && existing.storageSchemaVersion === STORAGE_SCHEMA_VERSION && existing.migration && existing.migration.state === 'complete') return { ok: true, metadata: existing, alreadyComplete: true };
    var plan = migrationPlan(saved || {}, options || {});
    if (!plan.ok) return plan;
    var transaction = await routedTransaction(db, [STORE_RECORDS, STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readwrite', read.route);
    try {
      plan.wrappers.forEach(function (wrapper) { transaction.objectStore(STORE_RECORDS).put(wrapper); });
      plan.caches.forEach(function (cache) { transaction.objectStore(STORE_AGGREGATES).put(cache); });
      plan.heads.forEach(function (head) { transaction.objectStore(STORE_PLAYER_HEADS).put(head); });
      transaction.objectStore(STORE_METADATA).put(plan.metadata);
      invalidateSessionProjections(transaction, 'Career initialization replaced derived state');
      await transactionPromise(transaction);
    } catch (error) { try { transaction.abort(); } catch (_abortError) { /* Preserve the original failure if already inactive. */ } throw error; }
    return plan;
  }
  async function hasCompleteDatabase(indexedDB) {
    if (!indexedDB || typeof indexedDB.open !== 'function') return false;
    var db = await openDatabase(indexedDB);
    try {
      var transaction = await routedTransaction(db, [STORE_METADATA], 'readonly');
      var metadata = await requestPromise(transaction.objectStore(STORE_METADATA).get('career'));
      await transactionPromise(transaction);
      return Boolean(metadata && metadata.storageSchemaVersion === STORAGE_SCHEMA_VERSION && metadata.migration && metadata.migration.state === 'complete');
    } finally {
      db.close();
    }
  }
  async function idbGetAll(db, storeName) { var tx = await routedTransaction(db, [storeName], 'readonly'); return requestPromise(tx.objectStore(storeName).getAll()).then(function (value) { return transactionPromise(tx).then(function () { return value; }); }); }
  function readIndexedPlayerHistory(tx, playerId, head, complete) {
    var store = tx.objectStore(STORE_RECORDS);
    var requests = [store.index('playerIds').getAll(playerId)];
    // These are read hints, never exclusion authority. Re-read every physical
    // peer of known quarantined hands and let the existing resolver decide.
    (head && head.contextHandKeys || []).forEach(function (key) { requests.push(store.index('handKey').getAll(key)); });
    var remaining = requests.length; var byFingerprint = new Map();
    requests.forEach(function (request) {
      request.onsuccess = function () {
        (request.result || []).forEach(function (wrapper) { byFingerprint.set(wrapper.record.fingerprint, wrapper); });
        if (--remaining === 0) complete(Array.from(byFingerprint.values()));
      };
    });
  }

  function readSummarySnapshot(db, includeHistoryIfStale) {
    return routedPromise(db, includeHistoryIfStale ? [STORE_METADATA, STORE_PLAYER_HEADS, STORE_RECORDS] : [STORE_METADATA, STORE_PLAYER_HEADS], 'readonly', function (tx, resolve, reject) {
      var snapshot = { metadata: null, heads: null, wrappers: null, route: tx.route };
      var meta = tx.objectStore(STORE_METADATA).get('career'); var heads = tx.objectStore(STORE_PLAYER_HEADS).getAll();
      function readHistory() {
        if (!snapshot.metadata || !snapshot.heads) return;
        if (includeHistoryIfStale && !summariesReady(snapshot.metadata, snapshot.heads)) {
          var records = tx.objectStore(STORE_RECORDS).getAll();
          records.onsuccess = function () { snapshot.wrappers = records.result; };
        }
      }
      meta.onsuccess = function () { snapshot.metadata = meta.result; if (!snapshot.metadata) { tx.abort(); return; } readHistory(); };
      heads.onsuccess = function () { snapshot.heads = heads.result; readHistory(); };
      tx.oncomplete = function () { resolve(snapshot); };
      tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Career player summary snapshot failed')); };
    });
  }
  function commitSummarySnapshot(db, snapshot, rebuiltHeads) {
    return routedPromise(db, [STORE_METADATA, STORE_PLAYER_HEADS, STORE_AGGREGATES], 'readwrite', function (tx, resolve, reject) { var committed = false;
      var metadataStore = tx.objectStore(STORE_METADATA); var request = metadataStore.get('career');
      var headStore = tx.objectStore(STORE_PLAYER_HEADS); var headRequest = headStore.getAll();
      var currentMetadata; var currentHeads;
      function publish() {
        if (!currentMetadata || !currentHeads) return;
        if (tx.route.bank !== snapshot.route.bank || tx.route.careerGeneration !== snapshot.route.careerGeneration || tx.route.ledgerRevision !== snapshot.route.ledgerRevision) return;
        // Another initializer or SAFE REPLACE may already have completed this
        // index. In particular, restore can reuse sequence/provenance values.
        if (summariesReady(currentMetadata, currentHeads)) { committed = true; return; }
        if (canonicalJson(currentMetadata) !== canonicalJson(snapshot.metadata)) return;
        headStore.clear();
        rebuiltHeads.forEach(function (head) { headStore.put(head); if (head.contextHandKeys.length) tx.objectStore(STORE_AGGREGATES).delete(head.playerId); });
        metadataStore.put(Object.assign({}, currentMetadata, { playerSummaryVersion: PLAYER_SUMMARY_VERSION }));
        committed = true;
      }
      request.onsuccess = function () { currentMetadata = request.result; if (!currentMetadata) { tx.abort(); return; } publish(); };
      headRequest.onsuccess = function () { currentHeads = headRequest.result; publish(); };
      tx.oncomplete = function () { resolve(committed); };
      tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Career player summary backfill aborted; retry is safe')); };
    });
  }

  async function createIndexedService(indexedDB, saved, options) {
    if (!indexedDB || typeof indexedDB.open !== 'function') throw new TypeError('IndexedDB is unavailable');
    var db = await openDatabase(indexedDB);
    var migration;
    try { migration = await initializeDatabase(db, saved || {}, options || {}); }
    catch (error) { db.close(); throw error; }
    if (!migration.ok) { db.close(); throw new Error(migration.reason); }
    function cleanupFence(tx, projection, membership) {
      return { bank: tx.route.bank, careerGeneration: tx.route.careerGeneration, ledgerRevision: tx.route.ledgerRevision,
        references: canonicalJson([projection || null, membership || null]) };
    }
    async function careerDerivedCleanupState() {
      var tx = await routedTransaction(db, [STORE_CONTROL, STORE_METADATA]), completion = transactionPromise(tx);
      var rows = await Promise.all([requestPromise(tx.objectStore(STORE_CONTROL).get(DERIVED_CLEANUP_KEY)),
        requestPromise(tx.objectStore(STORE_CONTROL).get('legacyDerivedCleanup')),
        requestPromise(tx.objectStore(STORE_METADATA).get(SESSION_PROJECTION_STATE_KEY)),
        requestPromise(tx.objectStore(STORE_METADATA).get(HAND_MEMBERSHIP_STATE_KEY))]);
      var fence = cleanupFence(tx, rows[2], rows[3]); await completion;
      return { pending: !rows[0] || rows[0].version !== 1 || rows[0].status !== 'complete' ||
        canonicalJson(rows[0].fence) !== canonicalJson(fence) || !rows[1] || rows[1].status !== 'complete', progress: rows[0] || null };
    }
    function cleanupCareerDerivedNamespaces(options) {
      options = options || {};
      var limit = options.maxRows === undefined ? DERIVED_CLEANUP_MAX_ROWS : options.maxRows;
      if (!Number.isInteger(limit) || limit < 1 || limit > DERIVED_CLEANUP_MAX_ROWS) throw new TypeError('Derived cleanup requires 1–128 keys');
      return routedPromise(db, [STORE_CONTROL, STORE_METADATA].concat(DERIVED_CLEANUP_STORES), 'readwrite', function (tx, resolve, reject) {
        var control = tx.objectStore(STORE_CONTROL), metadata = tx.objectStore(STORE_METADATA), values = [], loaded = 0;
        var state, fence, deleted = 0, probes = 0, result, retained = {};
        function fail(error) { try { tx.abort(); } catch (_abortError) {} reject(error); }
        function guarded(callback) { return function () { try { callback(); } catch (error) { fail(error); } }; }
        [control.get(DERIVED_CLEANUP_KEY), control.get('legacyDerivedCleanup'), metadata.get(SESSION_PROJECTION_STATE_KEY), metadata.get(HAND_MEMBERSHIP_STATE_KEY)].forEach(function (r, i) {
          r.onsuccess = guarded(function () { values[i] = r.result; if (++loaded === 4) begin(); });
        });
        function begin() {
          fence = cleanupFence(tx, values[2], values[3]);
          state = values[0];
          if (!state || state.version !== 1 || canonicalJson(state.fence) !== canonicalJson(fence) ||
              !Number.isInteger(state.phase) || state.phase < 0 || state.phase > 4) {
            state = { key: DERIVED_CLEANUP_KEY, version: 1, status: 'pending', fence: fence, phase: 0, namespace: null, after: null };
          }
          [values[2], values[3]].forEach(function (reference, i) {
            if (reference && reference.careerGeneration === tx.route.careerGeneration && typeof reference.generation === 'string' && reference.generation &&
                ['ready', 'building', 'invalid'].indexOf(reference.status) >= 0)
              retained[DERIVED_CLEANUP_STORES[i + 2]] = [tx.route.careerGeneration, reference.generation];
          });
          if (state.status === 'complete' && values[1] && values[1].status === 'complete') { finish(); return; }
          step();
        }
        function finish() {
          state.status = state.phase === 4 ? 'complete' : 'pending';
          control.put(state);
          result = { pending: state.status !== 'complete', deleted: deleted, probes: probes, phase: state.phase };
        }
        function advance() {
          state.phase += 1; state.namespace = null; state.after = null;
          // Cursor exhaustion, not an attempted delete, proves both empty.
          // Deletions and this marker commit in the same native transaction.
          if (state.phase === 2) control.put({ key: 'legacyDerivedCleanup', version: 1, status: 'complete' });
          step();
        }
        function step() {
          if (state.phase === 4 || deleted >= limit || probes >= 32) { finish(); return; }
          var name = DERIVED_CLEANUP_STORES[state.phase], store = tx.retirementStore(name);
          if (state.phase < 2) { drain(store, null, true); return; }
          if (state.namespace) {
            // A durable cursor is a hint. Recheck its target against references
            // even when the stored fence matches (including damaged progress).
            if (canonicalJson(state.namespace) === canonicalJson(retained[name])) {
              state.after = namespaceEnd(state.namespace); state.namespace = null; step(); return;
            }
            drain(store, IDBKeyRange.bound(state.namespace, namespaceEnd(state.namespace), false, true), false); return;
          }
          var r = store.openKeyCursor(state.after ? IDBKeyRange.lowerBound(state.after) : null);
          r.onsuccess = guarded(function () {
            var cursor = r.result;
            if (!cursor) { advance(); return; }
            probes += 1;
            var key = cursor.primaryKey;
            if (!Array.isArray(key) || key.length < 3 || typeof key[0] !== 'string' || typeof key[1] !== 'string' || !key[1])
              throw new Error('Malformed derived namespace key; retirement stopped');
            var namespace = key.slice(0, 2);
            if (canonicalJson(namespace) === canonicalJson(retained[name])) { state.after = namespaceEnd(namespace); step(); return; }
            state.namespace = namespace; drain(store, IDBKeyRange.bound(namespace, namespaceEnd(namespace), false, true), false);
          });
        }
        function namespaceEnd(namespace) { return [namespace[0], namespace[1] + '\u0000']; }
        function drain(store, range, legacy) {
          var r = store.openKeyCursor(range);
          r.onsuccess = guarded(function () {
            var cursor = r.result;
            if (!cursor) {
              if (legacy) { advance(); return; }
              state.after = namespaceEnd(state.namespace); state.namespace = null; step(); return;
            }
            if (deleted >= limit) { finish(); return; }
            store.delete(cursor.primaryKey); deleted += 1; cursor.continue();
          });
        }
        tx.oncomplete = function () { resolve(result); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Derived retirement aborted; prior batches remain resumable')); };
      });
    }
    function membershipChunk(groupLimit, restart) {
      return routedPromise(db, [STORE_RECORDS, STORE_METADATA, STORE_HAND_MEMBERSHIPS], 'readwrite', function (tx, resolve, reject) {
        var metadata = tx.objectStore(STORE_METADATA), store = tx.objectStore(STORE_HAND_MEMBERSHIPS), state, projection, result, loaded = 0;
        function fail(error) { try { tx.abort(); } catch (_abortError) {} reject(error); }
        var stateRequest = metadata.get(HAND_MEMBERSHIP_STATE_KEY), revisionRequest = metadata.get(SESSION_PROJECTION_STATE_KEY);
        function begin() {
          if (++loaded !== 2) return;
          // The existing projection control owns the sole authoritative ledger
          // revision. Creating it does not change that revision on a build restart.
          if (!projection) { projection = emptyProjectionState(); metadata.put(projection); }
          var revision = projection.ledgerRevision;
          if (!restart && validMembershipReady(state, revision)) { result = state; return; }
          var resetting = restart || !validMembershipProgress(state) || state.status !== 'building' || state.sourceRevision !== revision;
          if (resetting) { state = emptyMembershipState(revision); tx.bindDerived('membership', state); store.clear(); }
          var groups = 0, records = 0, cursorRequest;
          function start() {
            cursorRequest = tx.objectStore(STORE_RECORDS).index('handKey').openKeyCursor(
              state.checkpoint === null ? null : IDBKeyRange.lowerBound(state.checkpoint, true), 'nextunique');
            cursorRequest.onsuccess = consume;
          }
          if (state.cleanup) {
            var cleaned = 0;
            var populations = metadata.openKeyCursor(IDBKeyRange.bound(['handMembershipPopulation'], ['handMembershipPopulation', []]));
            populations.onsuccess = function () { try {
              var cursor = populations.result;
              if (!cursor) { state.cleanup = false; start(); return; }
              if (cleaned >= groupLimit) { checkpoint(); return; }
              metadata.delete(cursor.primaryKey); cleaned += 1; cursor.continue();
            } catch (error) { fail(error); } };
          } else start();
          function checkpoint() {
            state.groups += groups; state.chunks += 1; state.maxChunkRecords = Math.max(state.maxChunkRecords, records);
            if (state.status === 'ready') sealMembershipState(state);
            metadata.put(state); result = state;
          }
          function consume() { try {
            var cursor = cursorRequest.result;
            if (!cursor) {
              var total = store.count(), dated = store.index('playerChronology').count(), remaining = 2;
              function verify() {
                if (--remaining) return;
                if (total.result !== state.rows || dated.result !== state.datedRows) throw new Error('Incomplete hand membership publication');
                state.status = 'ready'; checkpoint();
              }
              total.onsuccess = dated.onsuccess = function () { try { verify(); } catch (error) { fail(error); } };
              return;
            }
            if (groups >= groupLimit) { checkpoint(); return; }
            var key = cursor.key;
            readProjectionGroup(tx, key, function (active, physical, materialized) {
              records += materialized; groups += 1; state.checkpoint = key;
              var entries = membershipEntries(active), index = 0;
              function next() {
                if (index < entries.length) { insertMembership(tx, active, entries[index++], state, next, fail); return; }
                cursor.continue();
              }
              next();
            }, fail);
          } catch (error) { fail(error); } }
        }
        stateRequest.onsuccess = function () { try { state = stateRequest.result; begin(); } catch (error) { fail(error); } };
        revisionRequest.onsuccess = function () { try { projection = revisionRequest.result; begin(); } catch (error) { fail(error); } };
        tx.oncomplete = function () { resolve(publicMembershipState(result, projection.ledgerRevision)); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Hand membership chunk aborted; checkpoint remains resumable')); };
      });
    }
    async function backfillCareerHandMemberships(options) {
      options = options || {};
      var maximum = options.maxChunks === undefined ? 1 : options.maxChunks, limit = options.chunkGroups === undefined ? 128 : options.chunkGroups;
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 1024 || !Number.isInteger(limit) || limit < 1 || limit > 128)
        throw new TypeError('Hand membership backfill requires 1–1024 chunks of 1–128 hand groups');
      var state;
      for (var i = 0; i < maximum; i += 1) {
        state = await membershipChunk(limit, Boolean(options.restart && i === 0));
        if (state.status !== 'building') break;
        await summaryYield();
      }
      return state;
    }
    async function careerHandMembershipState() {
      var tx = await routedTransaction(db, STORE_METADATA), completion = transactionPromise(tx), store = tx.objectStore(STORE_METADATA);
      var rows = await Promise.all([requestPromise(store.get(HAND_MEMBERSHIP_STATE_KEY)), requestPromise(store.get(SESSION_PROJECTION_STATE_KEY))]);
      await completion; return publicMembershipState(rows[0], rows[1] && rows[1].ledgerRevision);
    }
    function readCareerHandMemberships(playerId, limit) {
      playerId = requiredSessionPlayerId(playerId); limit = limit === undefined ? 500 : limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new TypeError('Hand membership read requires 1–5000 rows');
      return routedPromise(db, [STORE_METADATA, STORE_HAND_MEMBERSHIPS], 'readonly', function (tx, resolve, reject) {
        var metadata = tx.objectStore(STORE_METADATA), state, projection, loaded = 0;
        var output = { valid: false, reason: 'Hand memberships are not ready for the current ledger revision' };
        function fail(error) { try { tx.abort(); } catch (_abortError) {} reject(error); }
        function unavailable(reason) { output = { valid: false, reason: reason }; }
        var stateRequest = metadata.get(HAND_MEMBERSHIP_STATE_KEY), revisionRequest = metadata.get(SESSION_PROJECTION_STATE_KEY);
        function begin() {
          if (++loaded !== 2 || !projection || !validMembershipReady(state, projection.ledgerRevision)) return;
          var populationRequest = metadata.get(membershipPopulationKey(playerId));
          populationRequest.onsuccess = function () { try {
            var population = populationRequest.result;
            if (population && !validMembershipPopulation(population, state, playerId)) { unavailable('Invalid hand membership population metadata'); return; }
            var expected = population ? population.firstKey : null, target = Math.min(limit, population ? population.datedRows : 0);
            var rowsRequest = tx.objectStore(STORE_HAND_MEMBERSHIPS).index('playerChronology').getAll(IDBKeyRange.bound([playerId], [playerId, []]), Math.max(1, target));
            rowsRequest.onsuccess = function () { try {
              var rows = rowsRequest.result;
              if (rows.length !== target) { unavailable('Incomplete hand membership chronology'); return; }
              for (var i = 0; i < rows.length; i += 1) {
                var row = rows[i];
                if (!validMembershipRow(row, state) || row.playerId !== playerId || !sameProjectionKey(membershipChronology(row), expected)) { unavailable('Invalid or missing hand membership in requested prefix'); return; }
                if (i && (rows[i - 1].finalizedAt < row.finalizedAt || rows[i - 1].finalizedAt === row.finalizedAt &&
                    (rows[i - 1].handKey.localeCompare(row.handKey) || rows[i - 1].fingerprint.localeCompare(row.fingerprint)) >= 0)) {
                  unavailable('Hand membership prefix does not match raw chronology'); return;
                }
                expected = row.nextKey;
              }
              if ((target === (population ? population.datedRows : 0)) !== (expected === null)) { unavailable('Incomplete hand membership terminal totals'); return; }
              output = { valid: true, rows: rows, playerId: playerId, limit: limit, population: population ? population.rows : 0,
                datedPopulation: population ? population.datedRows : 0, omittedUndatedHands: population ? population.rows - population.datedRows : 0,
                generation: state.generation, ledgerRevision: projection.ledgerRevision,
                query: { source: 'hand-memberships', membershipRowsMaterialized: rows.length, fullLedgerScans: 0 } };
            } catch (error) { fail(error); } };
          } catch (error) { fail(error); } };
        }
        stateRequest.onsuccess = function () { try { state = stateRequest.result; begin(); } catch (error) { fail(error); } };
        revisionRequest.onsuccess = function () { try { projection = revisionRequest.result; begin(); } catch (error) { fail(error); } };
        tx.oncomplete = function () { resolve(output); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Hand membership read failed')); };
      });
    }
    function projectionChunk(groupLimit, restart) {
      return routedPromise(db, [STORE_RECORDS, STORE_METADATA, STORE_SESSION_PROJECTIONS], 'readwrite', function (tx, resolve, reject) {
        var metadata = tx.objectStore(STORE_METADATA), store = tx.objectStore(STORE_SESSION_PROJECTIONS);
        var request = metadata.get(SESSION_PROJECTION_STATE_KEY), result;
        function fail(error) { try { tx.abort(); } catch (_abortError) {} reject(error); }
        request.onsuccess = function () { try {
          var state = request.result || emptyProjectionState();
          if (!restart && (validProjectionReadState(state) || state.status === 'invalid' && publicProjectionState(state).needsBackfill === false)) { result = state; return; }
          var resetting = restart || state.version !== SESSION_PROJECTION_VERSION || state.populationVersion !== 1 || state.status !== 'building' ||
            state.sourceRevision !== state.ledgerRevision || publicProjectionState(state).restartRequired;
          if (resetting) {
            var revision = typeof state.ledgerRevision === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(state.ledgerRevision) ? state.ledgerRevision : projectionToken();
            state = emptyProjectionState(); state.ledgerRevision = revision;
            state.sourceRevision = revision; state.generation = projectionToken(); state.status = 'building';
            tx.bindDerived('projection', state); store.clear();
          }
          var groups = 0, records = 0;
          var range = state.checkpoint === null ? null : IDBKeyRange.lowerBound(state.checkpoint, true);
          var cursorRequest;
          function start() {
            cursorRequest = tx.objectStore(STORE_RECORDS).index('handKey').openKeyCursor(range, 'nextunique');
            cursorRequest.onsuccess = consume;
          }
          if (resetting) {
            var oldPopulations = metadata.openKeyCursor(IDBKeyRange.bound(['sessionProjectionPopulation'], ['sessionProjectionPopulation', []]));
            oldPopulations.onsuccess = function () { try {
              var cursor = oldPopulations.result;
              if (!cursor) { start(); return; }
              metadata.delete(cursor.primaryKey); cursor.continue();
            } catch (error) { fail(error); } };
          } else start();
          function consume() { try {
            var cursor = cursorRequest.result;
            if (!cursor) { verifyComplete(); return; }
            if (groups >= groupLimit) { checkpoint(); return; }
            var key = cursor.key;
            readProjectionGroup(tx, key, function (active, physical, materialized) {
              records += materialized; groups += 1; state.checkpoint = key;
              putProjectionDeltas(tx, projectionDeltas(active, physical, state.generation), state, function () { cursor.continue(); }, fail);
            }, fail);
          } catch (error) { fail(error); } }
          function checkpoint() {
            state.chunks += 1; state.groups += groups;
            state.maxChunkRecords = Math.max(state.maxChunkRecords, records);
            if (state.status === 'ready' || state.status === 'invalid') sealProjectionState(state);
            metadata.put(state); result = state;
          }
          function verifyComplete() {
            // Native counts, not a materialized ledger or projection array. All
            // chunks and publication share the durable revision/checkpoint row.
            var remaining = 4;
            function checked() {
              if (--remaining === 0) { state.status = state.catalogError ? 'invalid' : 'ready'; checkpoint(); }
            }
            ['canonical', 'player', 'unassigned'].forEach(function (kind) {
              var count = store.count(IDBKeyRange.bound([kind], [kind, []]));
              count.onsuccess = function () { try {
                if (count.result !== state.counts[kind]) throw new Error('Session projection count mismatch; explicit rebuild required');
                checked();
              } catch (error) { fail(error); } };
            });
            var chronologyCount = store.index('canonicalChronology').count(IDBKeyRange.bound(['canonical'], ['canonical', []]));
            chronologyCount.onsuccess = function () { try {
              if (chronologyCount.result !== state.counts.canonical) throw new Error('Session projection chronology count mismatch; explicit rebuild required');
              checked();
            } catch (error) { fail(error); } };
          }
        } catch (error) { fail(error); } };
        tx.oncomplete = function () { resolve(result); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Session projection chunk aborted; committed checkpoint remains resumable')); };
      });
    }
    async function backfillCareerSessionProjections(options) {
      options = options || {};
      var maximum = options.maxChunks === undefined ? 1 : options.maxChunks;
      var limit = options.chunkGroups === undefined ? SESSION_PROJECTION_CHUNK_GROUPS : options.chunkGroups;
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 1024 || !Number.isInteger(limit) || limit < 1 || limit > SESSION_PROJECTION_CHUNK_GROUPS) throw new TypeError('Session projection backfill requires 1–1024 chunks of 1–128 hand groups');
      var state;
      for (var i = 0; i < maximum; i += 1) {
        state = await projectionChunk(limit, Boolean(options.restart && i === 0));
        if (state.status !== 'building') break;
        await summaryYield();
      }
      return publicProjectionState(state);
    }
    async function careerSessionProjectionState() {
      var tx = await routedTransaction(db, [STORE_METADATA], 'readonly'), completion = transactionPromise(tx);
      var state = await requestPromise(tx.objectStore(STORE_METADATA).get(SESSION_PROJECTION_STATE_KEY));
      await completion;
      return publicProjectionState(state);
    }
    // One adapter owns full and keyset reads. Counts, state, rows and joins are
    // validated in the same readonly snapshot; no ready boolean is cached.
    function readSessionProjectionSnapshot(options) {
      var playerId = options.playerId, mode = options.mode, paged = options.paged, after = options.after;
      return routedPromise(db, [STORE_METADATA, STORE_SESSION_PROJECTIONS], 'readonly', function (tx, resolve, reject) {
        var output;
        var request = tx.objectStore(STORE_METADATA).get(SESSION_PROJECTION_STATE_KEY);
        function fail(error) { try { tx.abort(); } catch (_abortError) {} reject(error); }
        function unavailable(reason) { var error = new Error(reason); error.code = 'CAREER_SESSION_PROJECTIONS_NOT_READY'; throw error; }
        request.onsuccess = function () { try {
          var state = request.result;
          if (!validProjectionReadState(state)) unavailable('Career Session projections are not ready or have invalid metadata');
          if (after && (after.generation !== state.generation || after.ledgerRevision !== state.ledgerRevision)) unavailable('Session projection continuation is stale; restart enumeration');
          var store = tx.objectStore(STORE_SESSION_PROJECTIONS), chronology = store.index('canonicalChronology');
          var rows = [], unassigned = null, population = null, scanned = 0, lastKey = null;
          var remaining = paged ? playerId === undefined ? 1 : 2 : playerId === undefined ? 1 : 5;
          var visited = after ? after.canonicalRows : 0, memberships = after ? after.playerRows : 0;
          var expectedKey = after ? after.expectedKey : state.firstCanonicalKey;
          function validate(row, kind) {
            if (!row || row.kind !== kind || !validProjectionReadRow(row, state)) unavailable('Invalid ' + kind + ' Session projection; explicit rebuild required');
          }
          function summary(canonicalRow, player) {
            validate(canonicalRow, 'canonical');
            if (playerId === undefined) return Aggregator.publicSessionSummary(canonicalRow);
            validate(player, 'player');
            if (player.playerId !== playerId || player.sessionId !== canonicalRow.sessionId || player.catalogHandCount > canonicalRow.handCount) unavailable('Invalid player Session projection join');
            return mode === 'catalog' ? Object.assign(Aggregator.publicSessionSummary(canonicalRow), { playerHandCount: player.catalogHandCount }) :
              player.playerHandCount > 0 ? projectionPlayerSummary(canonicalRow, player) : null;
          }
          function coverage() { return { legacyHandCount: unassigned ? unassigned.legacyHandCount : 0, unsupportedHandCount: unassigned ? unassigned.unsupportedHandCount : 0 }; }
          function publish(hasMore) {
            if (!paged && playerId === undefined && (scanned !== state.counts.canonical || expectedKey !== null))
              unavailable('Incomplete canonical Session projection enumeration');
            if (paged && (visited > state.counts.canonical || playerId !== undefined && memberships > population.playerRows ||
                !hasMore && (expectedKey !== null || visited !== state.counts.canonical || playerId !== undefined && memberships !== population.playerRows)))
              unavailable('Incomplete Session projection traversal; restart or raw fallback required');
            if (!paged && playerId !== undefined) rows.sort(function (a, b) { return projectionOrder(a.endedAt) - projectionOrder(b.endedAt) || a.sessionId.localeCompare(b.sessionId); });
            var value = playerId !== undefined && mode !== 'catalog' ? { playerId: playerId, sessions: rows, unassigned: coverage() } : rows;
            output = { valid: true, value: value, generation: state.generation, ledgerRevision: state.ledgerRevision };
            if (paged) Object.assign(output, { rows: rows, scannedCanonicalRows: scanned,
              next: hasMore ? { version: 1, generation: state.generation, ledgerRevision: state.ledgerRevision,
                playerId: playerId === undefined ? null : playerId, mode: mode, key: lastKey,
                canonicalRows: visited, playerRows: memberships, expectedKey: expectedKey } : null });
          }
          // Native counts detect missing rows/index entries without loading the
          // global catalog or unrelated participants into JavaScript.
          if (!paged) (playerId === undefined ? ['canonical'] : ['canonical', 'player', 'unassigned']).forEach(function (kind) {
            var count = store.count(IDBKeyRange.bound([kind], [kind, []]));
            count.onsuccess = function () { try {
              if (count.result !== state.counts[kind]) unavailable('Missing ' + kind + ' Session projection; explicit rebuild required');
              begin();
            } catch (error) { fail(error); } };
          });
          if (!paged && playerId !== undefined) {
            var indexedCount = chronology.count(IDBKeyRange.bound(['canonical'], ['canonical', []]));
            indexedCount.onsuccess = function () { try {
              if (indexedCount.result !== state.counts.canonical) unavailable('Missing canonical chronology entries'); begin();
            } catch (error) { fail(error); } };
          }
          if (playerId !== undefined) {
            var unassignedRequest = store.get(projectionKey('unassigned', playerId, ''));
            unassignedRequest.onsuccess = function () { try {
              unassigned = unassignedRequest.result;
              if (unassigned) { validate(unassigned, 'unassigned'); if (unassigned.playerId !== playerId) unavailable('Invalid unassigned player join'); }
              begin();
            } catch (error) { fail(error); } };
            if (paged) {
              var populationRequest = tx.objectStore(STORE_METADATA).get(projectionPopulationKey(playerId));
              populationRequest.onsuccess = function () { try {
                population = populationRequest.result || { playerRows: 0, unassigned: false };
                if (populationRequest.result && !validProjectionPopulation(population, state, playerId)) unavailable('Invalid player Session projection population');
                begin();
              } catch (error) { fail(error); } };
            }
          }
          if (paged && playerId === undefined) begin();
          function begin() {
            if (--remaining) return;
            if (paged && playerId !== undefined && Boolean(unassigned) !== population.unassigned) unavailable('Missing or extra unassigned player coverage');
            if (paged && after && (visited > state.counts.canonical || playerId !== undefined && memberships > population.playerRows)) unavailable('Invalid Session traversal totals');
            if (!paged && playerId !== undefined) {
              // Full output requires this player's rows only. Canonical joins
              // preserve whole-Session times when a player leaves early.
              var players = store.openCursor(IDBKeyRange.bound(['player', playerId], ['player', playerId, []]));
              players.onsuccess = function () { try {
                var cursor = players.result;
                if (!cursor) { publish(false); return; }
                var player = cursor.value; validate(player, 'player');
                var canonicalRequest = store.get(projectionKey('canonical', '', player.sessionId));
                canonicalRequest.onsuccess = function () { try {
                  var row = summary(canonicalRequest.result, player); if (row) rows.push(row); cursor.continue();
                } catch (error) { fail(error); } };
              } catch (error) { fail(error); } };
              return;
            }
            // Paged player reads walk canonical chronology with keyed positive
            // membership probes. A scan budget bounds sparse/empty pages too.
            var range = after ? IDBKeyRange.bound(after.key, ['canonical', []], true, false) : IDBKeyRange.bound(['canonical'], ['canonical', []]);
            var canonicalCursor = chronology.openCursor(range);
            canonicalCursor.onsuccess = function () { try {
              var cursor = canonicalCursor.result;
              if (!cursor) { publish(false); return; }
              validate(cursor.value, 'canonical');
              if ((paged || playerId === undefined) && !sameProjectionKey(cursor.key, expectedKey)) unavailable('Missing or unordered canonical Session projection in requested range');
              if (paged && (rows.length >= options.limit || scanned >= options.scanLimit)) { publish(true); return; }
              scanned += 1; lastKey = cursor.key;
              if (paged || playerId === undefined) { visited += 1; expectedKey = cursor.value.nextCanonicalKey; }
              if (playerId === undefined) { rows.push(summary(cursor.value)); cursor.continue(); return; }
              var canonicalRow = cursor.value, playerRequest = store.get(projectionKey('player', playerId, canonicalRow.sessionId));
              playerRequest.onsuccess = function () { try {
                if (playerRequest.result) { if (paged) memberships += 1; var row = summary(canonicalRow, playerRequest.result); if (row) rows.push(row); }
                cursor.continue();
              } catch (error) { fail(error); } };
            } catch (error) { fail(error); } };
          }
        } catch (error) { fail(error); } };
        tx.oncomplete = function () { resolve(output); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Session projection read failed')); };
      }).catch(function (error) {
        if (error.code === 'CAREER_SESSION_PROJECTIONS_NOT_READY') return { valid: false, reason: error.message };
        throw error;
      });
    }
    async function readCareerSessionProjections(playerId, mode) {
      if (playerId !== undefined) playerId = requiredSessionPlayerId(playerId);
      if (mode !== undefined && mode !== 'catalog') throw new TypeError('Unsupported Session projection read mode');
      var snapshot = await readSessionProjectionSnapshot({ playerId: playerId, mode: mode || 'summary' });
      if (snapshot.valid) return snapshot.value;
      // Preserve the internal differential API's accepted collision/error contract.
      var state = await careerSessionProjectionState();
      if (state.status === 'invalid' && state.sourceRevision === state.ledgerRevision && state.catalogError) throw new TypeError(state.catalogError);
      var error = new Error(snapshot.reason); error.code = 'CAREER_SESSION_PROJECTIONS_NOT_READY'; throw error;
    }
    function readCareerSessionProjectionPage(options) {
      options = options || {};
      var playerId = options.playerId === undefined ? undefined : requiredSessionPlayerId(options.playerId);
      var mode = options.mode === undefined ? 'summary' : options.mode;
      var limit = options.limit === undefined ? 50 : options.limit, scanLimit = options.scanLimit === undefined ? 256 : options.scanLimit, after = options.after;
      if (!['catalog', 'summary'].includes(mode) || !Number.isInteger(limit) || limit < 1 || limit > 200 ||
          !Number.isInteger(scanLimit) || scanLimit < limit || scanLimit > 1024) throw new TypeError('Session projection page requires 1–200 rows and limit–1024 canonical probes');
      if (after && (after.version !== 1 || after.playerId !== (playerId === undefined ? null : playerId) || after.mode !== mode ||
          !validProjectionChronologyKey(after.key) || after.key === null)) throw new TypeError('Invalid Session projection page continuation');
      if (after && after.canonicalRows === undefined && after.playerRows === undefined && after.expectedKey === undefined)
        return Promise.resolve({ valid: false, reason: 'Legacy Session projection continuation; restart enumeration' });
      if (after && (!Number.isSafeInteger(after.canonicalRows) || after.canonicalRows < 1 ||
          !Number.isSafeInteger(after.playerRows) || after.playerRows < 0 || after.playerRows > after.canonicalRows ||
          playerId === undefined && after.playerRows !== 0 || !validProjectionChronologyKey(after.expectedKey)))
        throw new TypeError('Invalid Session projection page continuation');
      return readSessionProjectionSnapshot({ playerId: playerId, mode: mode, paged: true, limit: limit, scanLimit: scanLimit, after: after });
    }
    async function sessionListWithFallback(playerId, mode) {
      var snapshot = await readSessionProjectionSnapshot({ playerId: playerId, mode: mode });
      if (!snapshot.valid) return boundedRawQuery({ kind: mode === 'summary' ? 'summary' : 'catalog', playerId: playerId });
      if (mode === 'summary') snapshot.value.query = { historyTraversals: 0, resolverPasses: 0, physicalRecordsRead: 0,
        activeRecordsExamined: 0, sessionPopulationsComputed: snapshot.value.sessions.length, source: 'session-projections' };
      return snapshot.value;
    }
    var summaryWork = null; var summaryError = null; var summaryInitialized = false; var aggregateWork = null; var aggregateInitialized = false;
    function ensurePlayerSummaries() {
      if (summaryWork) return summaryWork;
      if (summaryInitialized) return Promise.resolve();
      summaryError = null;
      summaryWork = (async function () {
        for (;;) {
          var snapshot = await readSummarySnapshot(db, true);
          if (summariesReady(snapshot.metadata, snapshot.heads)) break;
          var rebuiltHeads = await backfillSummaryHeads(snapshot.wrappers, snapshot.heads);
          if (await commitSummarySnapshot(db, snapshot, rebuiltHeads)) {
            invalidateDashboardPlayers(rebuiltHeads.filter(function (head) { return head.contextHandKeys.length; }).map(function (head) { return head.playerId; }));
            break;
          }
        }
        summaryInitialized = true;
      })().catch(function (error) { summaryError = String(error.message || error); throw error; }).finally(function () { summaryWork = null; });
      return summaryWork;
    }
    // Career initialization is already detached from Session frame release.
    // Start here, expose readiness, and retry after errors on the next request.
    ensurePlayerSummaries().catch(function () {});
    function ensureContextAggregates() {
      if (aggregateInitialized) return Promise.resolve();
      if (aggregateWork) return aggregateWork;
      aggregateWork = (async function () {
        await ensurePlayerSummaries();
        for (;;) {
          var versionRead = await routedTransaction(db, [STORE_METADATA], 'readonly');
          var versionMetadata = await requestPromise(versionRead.objectStore(STORE_METADATA).get('career'));
          await transactionPromise(versionRead);
          if (versionMetadata.aggregateSchemaVersion === Aggregator.AGGREGATE_SCHEMA_VERSION) { aggregateInitialized = true; return; }
          var read = await routedTransaction(db, [STORE_METADATA, STORE_PLAYER_HEADS, STORE_RECORDS], 'readonly');
          var snapshot = await Promise.all([
            requestPromise(read.objectStore(STORE_METADATA).get('career')),
            requestPromise(read.objectStore(STORE_PLAYER_HEADS).getAll()),
            requestPromise(read.objectStore(STORE_RECORDS).getAll())
          ]);
          await transactionPromise(read);
          var metadata = snapshot[0];
          if (metadata.aggregateSchemaVersion === Aggregator.AGGREGATE_SCHEMA_VERSION) { aggregateInitialized = true; return; }
          var resolved = Aggregator.rebuild(snapshot[2].map(function (wrapper) { return wrapper.record; }));
          var physicalCounts = physicalRecordCountsByPlayer(resolved.acceptedRecords);
          var committed = await routedPromise(db, [STORE_METADATA, STORE_AGGREGATES], 'readwrite', function (tx, resolve, reject) {
            var metaStore = tx.objectStore(STORE_METADATA); var currentRequest = metaStore.get('career');
            var didWrite = false;
            currentRequest.onsuccess = function () {
              if (canonicalJson(currentRequest.result) !== canonicalJson(metadata)) return;
              var cacheStore = tx.objectStore(STORE_AGGREGATES);
              cacheStore.clear();
              snapshot[1].forEach(function (head) {
                var player = resolved.aggregate.players[head.playerId];
                if (player) cacheStore.put(cacheForPlayer(player, head.revision, physicalCounts[head.playerId] || 0));
              });
              metaStore.put(Object.assign({}, metadata, { aggregateSchemaVersion: Aggregator.AGGREGATE_SCHEMA_VERSION }));
              didWrite = true;
            };
            tx.oncomplete = function () { resolve(didWrite); };
            tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Career aggregate upgrade failed')); };
          }, read.route);
          if (committed) { dashboardCache.clear(); aggregateInitialized = true; return; }
        }
      })().finally(function () { aggregateWork = null; });
      return aggregateWork;
    }
    async function careerPlayerSummaries() {
      await ensurePlayerSummaries();
      var snapshot = await readSummarySnapshot(db, false);
      if (!summariesReady(snapshot.metadata, snapshot.heads)) {
        summaryInitialized = false;
        return careerPlayerSummaries();
      }
      return summaryRows(snapshot.heads);
    }
    async function indexedPlayerHistory(playerId, expected) {
      await ensurePlayerSummaries(); playerId = String(playerId);
      return routedPromise(db, [STORE_RECORDS, STORE_PLAYER_HEADS], 'readonly', function (tx, resolve, reject) { var wrappers;
        var request = tx.objectStore(STORE_PLAYER_HEADS).get(playerId);
        request.onsuccess = function () { readIndexedPlayerHistory(tx, playerId, request.result, function (values) { wrappers = values; }); };
        tx.oncomplete = function () { resolve(wrappers); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Career player history read failed')); };
      }, expected);
    }
    var dashboardCache = new Map(); var trendCache = new Map(); var trendPending = new Map(); var trendGeneration = 0;
    function invalidateDashboardPlayers(playerIds) { (playerIds || []).map(String).forEach(function (playerId) { Array.from(dashboardCache.keys()).forEach(function (key) { if (key.indexOf(playerId + '|') === 0) dashboardCache.delete(key); }); Array.from(trendCache.keys()).forEach(function (key) { if (key.indexOf(playerId + '|') === 0) trendCache.delete(key); }); }); }
    async function append(record) {
      var error = Aggregator.validateRecord(record); if (error) return { accepted: false, duplicate: false, conflict: false, reason: error };
      await ensureContextAggregates();
      return routedPromise(db, [STORE_RECORDS, STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS, STORE_SESSION_PROJECTIONS, STORE_HAND_MEMBERSHIPS], 'readwrite', function (tx, resolve, reject) {
        var recordsStore = tx.objectStore(STORE_RECORDS); var metadataStore = tx.objectStore(STORE_METADATA);
        var handRequest = recordsStore.index('handKey').getAll(record.handKey); var metaRequest = metadataStore.get('career');
        var projectionRequest = metadataStore.get(SESSION_PROJECTION_STATE_KEY);
        var membershipRequest = metadataStore.get(HAND_MEMBERSHIP_STATE_KEY), membershipState, membershipLoaded = false;
        var handValues; var meta; var planned; var projectionState; var projectionLoaded = false;
        function fail(error) { try { tx.abort(); } catch (_abortError) {} reject(error); }
        function proceed() {
          if (!handValues || !meta || !projectionLoaded || !membershipLoaded || planned) return;
          var handState = Aggregator.createState(handValues.map(function (wrapper) { return wrapper.record; }));
          var previous = handState.activeByHand.get(record.handKey);
          planned = Aggregator.append(handState, record);
          if (!planned.accepted) return;
          meta.nextSequence += 1; meta.physicalRecordCount += 1; if (!planned.supersession) meta.activeRecordCount += 1;
          meta.latestAcceptedAt = record.finalizedAt;
          if (!meta.firstAcceptedHandKey) { meta.firstAcceptedHandKey = record.handKey; meta.firstAcceptedAt = record.finalizedAt; }
          recordsStore.add(recordWrapper(record, meta.nextSequence)); metadataStore.put(meta);
          projectionState = projectionState || emptyProjectionState();
          var oldLedgerRevision = projectionState.ledgerRevision;
          maintainSessionProjectionAppend(tx, planned.record, handValues, planned.supersession, projectionState, fail);
          maintainMembershipAppend(tx, planned.record, handValues, planned.supersession, membershipState, oldLedgerRevision, projectionState.ledgerRevision, fail);
          var situations = Aggregator.careerSituationMap(record);
          record.players.forEach(function (entry) {
            var id = String(entry.playerId);
            // Queued after add(), so this reads the new physical record too.
            // Resolution and head publication share the append transaction.
            var headRequest = tx.objectStore(STORE_PLAYER_HEADS).get(id);
            headRequest.onsuccess = function () { try {
              var head = headRequest.result;
              var cacheRequest = tx.objectStore(STORE_AGGREGATES).get(id);
              cacheRequest.onsuccess = function () { try {
                var cache = cacheRequest.result;
                var replacement = planned.supersession && validSummaryHead(head) && !head.contextHandKeys.length && validCache(cache, head) && cache.player.playerId === id
                  ? Aggregator.replacePlayer(cache.player, previous, record, id) : null;
                if (replacement) {
                  tx.objectStore(STORE_PLAYER_HEADS).put(summaryHead(id, meta.nextSequence, replacement, head.contextHandKeys));
                  tx.objectStore(STORE_AGGREGATES).put(cacheForPlayer(replacement, meta.nextSequence, cache.physicalRecordCount + 1));
                  return;
                }
                if (!planned.supersession && (!head || validCache(cache, head))) {
                  var nextPlayer = Aggregator.appendPlayer(cache && cache.player || null, record, entry, situations[id]);
                  tx.objectStore(STORE_PLAYER_HEADS).put(summaryHead(id, meta.nextSequence, nextPlayer, head && head.contextHandKeys));
                  tx.objectStore(STORE_AGGREGATES).put(cacheForPlayer(nextPlayer, meta.nextSequence, cache ? cache.physicalRecordCount + 1 : 1));
                  return;
                }
                readIndexedPlayerHistory(tx, id, head, function (wrappers) { try {
                  var result = playerFromRecords(wrappers.map(function (wrapper) { return wrapper.record; }), id);
                  tx.objectStore(STORE_PLAYER_HEADS).put(summaryHead(id, meta.nextSequence, result.player, head && head.contextHandKeys));
                  if (result.player) tx.objectStore(STORE_AGGREGATES).put(cacheForPlayer(result.player, meta.nextSequence, result.physicalRecordCount));
                  else tx.objectStore(STORE_AGGREGATES).delete(id);
                } catch (error) { fail(error); } });
              } catch (error) { fail(error); } };
            } catch (error) { fail(error); } };
          });
        }
        handRequest.onsuccess = function () { try { handValues = handRequest.result || []; proceed(); } catch (error) { fail(error); } };
        metaRequest.onsuccess = function () { try { meta = metaRequest.result; if (!meta) { fail(new Error('Career metadata is missing')); return; } proceed(); } catch (error) { fail(error); } };
        projectionRequest.onsuccess = function () { try { projectionState = projectionRequest.result; projectionLoaded = true; proceed(); } catch (error) { fail(error); } };
        membershipRequest.onsuccess = function () { try { membershipState = membershipRequest.result; membershipLoaded = true; proceed(); } catch (error) { fail(error); } };
        handRequest.onerror = metaRequest.onerror = function () { tx.abort(); };
        tx.oncomplete = function () { if (planned && planned.accepted) invalidateDashboardPlayers(record.players.map(function (entry) { return entry.playerId; })); resolve(planned || { accepted: false, duplicate: false, conflict: false, reason: 'append did not run' }); };
        tx.onerror = function () { reject(tx.error || new Error('Career append transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('Career append transaction aborted')); };
      });
    }
    async function stats(playerId, expected) {
      await ensureContextAggregates();
      playerId = String(playerId);
      var tx = await routedTransaction(db, [STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readonly', expected);
      var pair = await Promise.all([requestPromise(tx.objectStore(STORE_AGGREGATES).get(playerId)), requestPromise(tx.objectStore(STORE_PLAYER_HEADS).get(playerId))]);
      await transactionPromise(tx);
      var cache = pair[0]; var head = pair[1]; if (!head) return null;
      if (validCache(cache, head)) return Aggregator.derivePlayer(cache.player);
      var wrappers = await indexedPlayerHistory(playerId, tx.route);
      var result = playerFromRecords(wrappers.map(function (wrapper) { return wrapper.record; }), playerId);
      if (result.player) {
        var write = await routedTransaction(db, [STORE_AGGREGATES], 'readwrite', tx.route);
        var exactPlayer = clone(result.player); delete exactPlayer.derived;
        await putRoutedCareerCache(write, cacheForPlayer(exactPlayer, head.revision, result.physicalRecordCount));
      }
      return result.player;
    }
    async function statsDiagnostic(playerId) {
      await ensurePlayerSummaries();
      playerId = String(playerId);
      var tx = await routedTransaction(db, [STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readonly');
      var pair = await Promise.all([requestPromise(tx.objectStore(STORE_AGGREGATES).get(playerId)), requestPromise(tx.objectStore(STORE_PLAYER_HEADS).get(playerId))]);
      await transactionPromise(tx);
      var cacheHit = validCache(pair[0], pair[1]);
      return { player: await stats(playerId, tx.route), cacheHit: cacheHit, rebuiltFromPlayerIndex: Boolean(pair[1] && !cacheHit) };
    }
    async function careerHudStats(playerIds) {
      await ensureContextAggregates();
      var requestedCount = Array.isArray(playerIds) ? playerIds.length : 0;
      var ids = normalizedPlayerIds(playerIds);
      var read = await routedTransaction(db, [STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readonly');
      var aggregateStore = read.objectStore(STORE_AGGREGATES);
      var headStore = read.objectStore(STORE_PLAYER_HEADS);
      var pairs = await Promise.all(ids.map(function (playerId) {
        return Promise.all([requestPromise(aggregateStore.get(playerId)), requestPromise(headStore.get(playerId))]);
      }));
      await transactionPromise(read);
      var cacheHits = 0;
      var staleIndexes = [];
      var players = new Array(ids.length).fill(null);
      pairs.forEach(function (pair, index) {
        if (!pair[1]) return;
        if (validCache(pair[0], pair[1])) {
          cacheHits += 1;
          players[index] = Aggregator.derivePlayer(pair[0].player);
        } else staleIndexes.push(index);
      });
      var rebuilt = await Promise.all(staleIndexes.map(async function (index) {
        var wrappers = await indexedPlayerHistory(ids[index], read.route);
        return playerFromRecords(wrappers.map(function (wrapper) { return wrapper.record; }), ids[index]);
      }));
      if (rebuilt.some(function (result) { return result.player; })) {
        var write = await routedTransaction(db, [STORE_AGGREGATES], 'readwrite', read.route);
        try {
          rebuilt.forEach(function (result, rebuiltIndex) {
            if (!result.player) return;
            var index = staleIndexes[rebuiltIndex];
            var exactPlayer = clone(result.player); delete exactPlayer.derived;
            write.objectStore(STORE_AGGREGATES).put(cacheForPlayer(exactPlayer, pairs[index][1].revision, result.physicalRecordCount));
            players[index] = result.player;
          });
          await transactionPromise(write);
        } catch (error) { try { write.abort(); } catch (_abortError) { /* Preserve the original failure if already inactive. */ } throw error; }
      }
      var byPlayerId = {};
      ids.forEach(function (playerId, index) { byPlayerId[playerId] = players[index] || null; });
      return { players: byPlayerId, query: { batched: true, requestedCount: requestedCount, uniquePlayerCount: ids.length, duplicatePlayerIdsRemoved: Math.max(0, requestedCount - ids.length), backend: 'indexeddb', runtimeMessages: 1, aggregateReadTransactions: 1, cacheHits: cacheHits, playerIndexLookups: staleIndexes.length, aggregateWriteTransactions: staleIndexes.length ? 1 : 0 } };
    }
    async function allRecords() { return (await idbGetAll(db, STORE_RECORDS)).map(function (wrapper) { return wrapper.record; }); }
    function boundedRawQuery(spec) {
      return routedPromise(db, [STORE_RECORDS, STORE_METADATA], 'readonly', function (tx, resolve, reject) {
        var playerId = spec.playerId, rows = [], total = 0, fold, output, detailPopulation, unassigned = { legacyHandCount: 0, unsupportedHandCount: 0 };
        var metrics = { source: 'raw-ledger', bounded: true, historyTraversals: 0, resolverPasses: 0, physicalRecordsRead: 0,
          sessionCandidatesVisited: 0, predecessorReads: 0, authoritativeLogicalHandsEmitted: 0,
          maxPageRecords: 0, maxChainRecords: 0, maxResolverRecords: 0, maxRetainedHands: 0, maxRetainedSessions: 0,
          generation: null, careerGeneration: tx.route.careerGeneration, bank: tx.route.bank, ledgerRevision: tx.route.ledgerRevision,
          fullLedgerScanRequests: 0, activeRecordsExamined: 0 };
        var started = performance.now(), filters = spec.filters || [], requests;
        if (spec.kind === 'detail') {
          // The established async adapter observes native storage failure before
          // validating detail arguments. Keep rejection asynchronous and resolve
          // the routed read snapshot before applying the same input validators.
          spec.sessionId = requiredHistoricalSessionId(spec.sessionId);
          playerId = requiredSessionPlayerId(playerId); filters = filters.map(normalizedSessionFilters);
        }
        function fail(error) { try { tx.abort(); } catch (_) {} reject(error); }
        function positive(record, strict) {
          return record.players.some(function (entry) { return (strict ? entry.playerId === playerId : String(entry.playerId) === playerId) && Number(entry.counters.hands || 0) > 0; });
        }
        function scope(filter) { return { position: filter.position, situation: filter.situation, tableSize: filter.tableSize }; }
        function statRequests(filter) { return filter.counterpartMode ? [scope(filter), filter] : [scope(filter)]; }
        function rich(summary, population) {
          var stats = population.results[0];
          return { sessionId: summary.sessionId, provenanceStatus: summary.provenanceStatus, startedAt: summary.startedAt, endedAt: summary.endedAt,
            playerId: playerId, playerHandCount: population.count, sessionHandCount: summary.handCount,
            tableSizeHands: clone(summary.tableSizeHands), playerTableSizeHands: population.tables,
            stats: { counters: stats.counters, derived: stats.derived }, coverage: stats.coverage };
        }
        if (spec.kind === 'detail') {
          requests = [{}, scope(filters[0]), { situation: 'ip', tableSize: filters[0].tableSize }, { situation: 'oop', tableSize: filters[0].tableSize }];
          Aggregator.POSITION_LABELS.forEach(function (position) { requests.push({ position: position, tableSize: filters[0].tableSize }); });
          if (filters[0].counterpartMode) requests.push(filters[0]);
        }
        function sessionStart(id) {
          fold = spec.kind === 'summary' ? rawPopulationFold(playerId, [{}], false) :
            spec.kind === 'detail' && id === spec.sessionId ? rawPopulationFold(playerId, requests, true) :
            spec.kind === 'trend' ? rawPopulationFold(playerId, statRequests(filters[0]), false) : null;
        }
        function sessionConsume(summary, record, physical, order) {
          if (playerId !== undefined && positive(record, false)) summary.playerHandCounts[playerId] = Number(summary.playerHandCounts[playerId] || 0) + 1;
          if (fold && positive(record, spec.kind === 'summary' || spec.kind === 'detail')) fold.add(record, physical, order);
        }
        function sessionEnd(summary, next) {
          var population = fold && fold.value();
          function publish(population) {
          var row;
          if (spec.kind === 'session') { if (summary.sessionId === spec.sessionId) output = Aggregator.publicSessionSummary(summary); }
          else if (spec.kind === 'summary') { if (population.count) rows.push(rich(summary, population)); }
          else if (spec.kind === 'detail') {
            if (summary.sessionId === spec.sessionId && population && population.count) {
              detailPopulation = population;
              var positions = {}, values = population.results;
              Aggregator.POSITION_LABELS.forEach(function (position, index) { positions[position] = values[index + 4].counters.hands ? values[index + 4] : null; });
              output = { session: rich(summary, population), playerId: playerId, filters: filters[0], core: values[1],
                relational: filters[0].counterpartMode ? values[values.length - 1] : null,
                comparisonContexts: { situations: { ip: values[2].counters.hands ? values[2] : null, oop: values[3].counters.hands ? values[3] : null }, positions: positions },
                profileStats: profileStatsFromCache({ player: population.player, physicalRecordCount: population.physical }, scope(filters[0])),
                query: { sessionPhysicalRecordsSelected: population.physical, sessionActiveHandsSelected: population.count } };
            }
          } else if (spec.kind === 'trend') {
            if (population.count) {
              total++;
              var core = publicStatResult(population.results[0]), relational = filters[0].counterpartMode ? publicStatResult(population.results[1]) : null;
              var measures = statMeasures(core); if (relational) measures[filters[0].statId] = statMeasures(relational)[filters[0].statId];
              row = { sessionId: summary.sessionId, provenanceStatus: summary.provenanceStatus, startedAt: summary.startedAt, endedAt: summary.endedAt,
                sessionHandCount: summary.handCount, playerHandCount: population.count, playerTableSizeHands: population.tables,
                core: core, relational: relational, stats: measures };
              rawKeep(rows, row, spec.range, rawSessionOrder);
            }
          } else if (playerId === undefined || summary.playerHandCounts[playerId] > 0) {
            row = Aggregator.publicSessionSummary(summary, playerId);
            if (spec.kind === 'recent') rawKeep(rows, row, spec.window.type === 'sessions' ? spec.window.count : 0, rawSessionOrder);
            else rows.push(row);
          }
          metrics.maxRetainedSessions = Math.max(metrics.maxRetainedSessions, rows.length + 1);
          fold = null;
          next();
          }
          if (population && population.orderedReplay) rawOrderedPopulation(tx, metrics, playerId,
            spec.kind === 'summary' ? [{}] : spec.kind === 'detail' ? requests : statRequests(filters[0]),
            spec.kind === 'detail', function (record) {
              return sessionIdOf(record) === summary.sessionId && positive(record, spec.kind === 'summary' || spec.kind === 'detail');
            }, publish, fail);
          else publish(population);
        }
        function finish() {
          metrics.totalMs = performance.now() - started;
          if (spec.kind === 'recent') output.forEach(function (value) { Object.assign(value.query, metrics); if (value.recent) Object.assign(value.recent.query, metrics); });
          else if (spec.kind !== 'session' && output && !Array.isArray(output)) output.query = Object.assign({}, metrics, output.query);
        }
        function afterSessions() {
          rows.sort(rawSessionOrder);
          if (spec.kind === 'catalog') { output = rows; finish(); return; }
          if (spec.kind === 'session') { output = output || null; finish(); return; }
          if (spec.kind === 'detail') {
            output = output || null;
            finish(); return;
          }
          var selected = new Set(spec.kind === 'recent' ? rows.map(function (row) { return row.sessionId; }) : []);
          var retained = [], omitted = 0, recentFold, careerFold;
          if (spec.kind === 'recent') {
            requests = []; filters.forEach(function (filter) { requests = requests.concat(statRequests(filter)); });
            recentFold = rawPopulationFold(playerId, requests, true, spec.window.type === 'hands');
            if (spec.comparison) careerFold = rawPopulationFold(playerId, statRequests(filters[0]), true);
          }
          (spec.kind === 'recent' ? rawHandTraversal : rawUnassignedTraversal)(tx, metrics, function (record, physical, order) {
            if (!positive(record, spec.kind === 'summary')) return;
            if (!sessionIdOf(record)) unassigned[record.schemaVersion < 4 ? 'legacyHandCount' : 'unsupportedHandCount']++;
            if (spec.kind !== 'recent') return;
            if (careerFold) careerFold.add(record, physical, order);
            if (spec.window.type === 'sessions') { if (selected.has(sessionIdOf(record))) recentFold.add(record, physical, order); }
            else if (handTime(record) === null) omitted++;
            else rawKeep(retained, { record: record, physical: physical }, spec.window.count, function (a, b) {
              return handTime(b.record) - handTime(a.record) || a.record.handKey.localeCompare(b.record.handKey) || a.record.fingerprint.localeCompare(b.record.fingerprint);
            });
            metrics.maxRetainedHands = Math.max(metrics.maxRetainedHands, retained.length);
          }, function () {
            if (spec.kind === 'summary') output = { playerId: playerId, sessions: rows, unassigned: unassigned, query: { sessionPopulationsComputed: rows.length } };
            else if (spec.kind === 'trend') {
              output = { playerId: playerId, filters: filters[0], order: 'endedAt-ascending-sessionId-descending', points: rows.reverse(), unassigned: unassigned,
                query: { sessionPopulationsComputed: rows.length } };
              if (spec.requestedRange !== undefined) { output.range = spec.range; output.totalSessionCount = total; }
            } else {
              if (spec.window.type === 'hands') retained.forEach(function (row, index) { recentFold.add(row.record, row.physical, [String(index).padStart(8, '0'), '']); });
              var population = recentFold.value(), baseline = careerFold && careerFold.value();
              function build(population, baseline) {
              var offset = 0;
              // The selected hand window is already bounded and chronological;
              // replay its Profile with the exact existing aggregate reducer.
              if (spec.window.type === 'hands') population.player = Aggregator.aggregateActiveRecords(retained.map(function (row) { return row.record; })).players[playerId] || null;
              var career;
              if (baseline) career = { playerId: playerId, filters: filters[0], playerHandCount: baseline.count, playerTableSizeHands: baseline.tables,
                core: publicStatResult(baseline.results[0]), relational: filters[0].counterpartMode ? publicStatResult(baseline.results[1]) : null,
                profileStats: profileStatsFromCache({ player: baseline.player, physicalRecordCount: baseline.physical }, scope(filters[0])) };
              output = filters.map(function (filter, index) {
                var results = population.results.slice(offset, offset + statRequests(filter).length); offset += results.length;
                var query = Object.assign({}, metrics, { selectedPhysicalRecords: population.physical, fallbackReason: spec.reason,
                  selectedLogicalHandKeys: retained.map(function (row) { return row.record.handKey; }), selectedFingerprints: retained.map(function (row) { return row.record.fingerprint; }) });
                var value = { playerId: playerId, window: spec.window, filters: filter, selectedSessionIds: Array.from(selected), selectedSessionCount: selected.size,
                  selectedPlayerHandCount: population.count, timeCoverage: population.time, playerTableSizeHands: clone(population.tables), unassigned: clone(population.unassigned),
                  omittedUndatedHands: omitted, core: publicStatResult(results[0]), relational: filter.counterpartMode ? publicStatResult(results[1]) : null,
                  profileStats: profileStatsFromCache({ player: population.player, physicalRecordCount: population.physical }, scope(filter)), query: query };
                return spec.comparison && index === 0 ? recentComparisonResult(value, career, query) : value;
              });
              finish();
              }
              function withBaseline(population) {
                if (baseline && baseline.orderedReplay) rawOrderedPopulation(tx, metrics, playerId, statRequests(filters[0]), true,
                  function (record) { return positive(record, false); }, function (value) { build(population, value); }, fail);
                else build(population, baseline);
              }
              if (population.orderedReplay) rawOrderedPopulation(tx, metrics, playerId, requests, true,
                function (record) { return positive(record, false) && selected.has(sessionIdOf(record)); }, withBaseline, fail);
              else withBaseline(population);
              return;
            }
            finish();
          }, fail);
        }
        tx.oncomplete = function () { resolve(output); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Bounded raw query transaction failed')); };
        rawSessionTraversal(tx, metrics, sessionStart, sessionConsume, sessionEnd, afterSessions, fail);
      });
    }
    // Shared candidate/peer/predecessor collector for one or several Sessions.
    // Callbacks queue every dependent request while the caller's snapshot is live.
    function readSessionPopulation(tx, sessionIds, receivePopulation, fail, playerId, selectedHandKeys) {
        var store = tx.objectStore(STORE_RECORDS);
        var byFingerprint = new Map(); var handKeys = new Set();
        var predecessors = new Set(); var lookedUp = new Set(); var pending = 0;
        var candidates = 0, materialized = 0;
        function receive(rows) {
          materialized += rows.length;
          // Native primary keys prevent duplicate physical fingerprints. Keep full
          // peers, including invalid/legacy/other-Session rows, for the shared resolver.
          rows.forEach(function (wrapper) {
            if (!wrapper || !wrapper.record || byFingerprint.has(wrapper.record.fingerprint)) return;
            var record = wrapper.record; byFingerprint.set(record.fingerprint, record);
            if (typeof record.supersedesFingerprint === 'string') predecessors.add(record.supersedesFingerprint);
          });
          rows.forEach(function (wrapper) {
            var key = wrapper && wrapper.record && wrapper.record.handKey;
            if (typeof key !== 'string' || handKeys.has(key)) return;
            handKeys.add(key); read(store.index('handKey').getAll(key), false);
          });
        }
        function drain() {
          if (pending) return;
          // First finish complete hand groups, then look up only predecessors still
          // absent. Foreign predecessors retain existing cross-hand failure semantics.
          var missing = Array.from(predecessors); predecessors.clear();
          missing.forEach(function (fingerprint) {
            if (byFingerprint.has(fingerprint) || lookedUp.has(fingerprint)) return;
            lookedUp.add(fingerprint); read(store.get(fingerprint), true);
          });
          if (!pending) receivePopulation(Array.from(byFingerprint.values()), { sessionPhysicalCandidates: candidates, physicalRecordsMaterialized: materialized });
        }
        function read(request, single) {
          pending += 1;
          request.onerror = function () { fail(request.error || new Error('IndexedDB request failed')); };
          request.onsuccess = function () {
            try {
              receive(single ? request.result ? [request.result] : [] : request.result || []);
              pending -= 1; drain();
            } catch (error) { fail(error); }
          };
        }
        sessionIds.forEach(function (id) {
          var request = store.index('sessionId').getAll(id);
          request.addEventListener('success', function () { candidates += (request.result || []).length; });
          read(request, false);
        });
        if (playerId !== undefined) read(store.index('playerIds').getAll(playerId), false);
        (selectedHandKeys || []).forEach(function (key) {
          if (handKeys.has(key)) return;
          handKeys.add(key); read(store.index('handKey').getAll(key), false);
        });
        if (!sessionIds.length && playerId === undefined && !(selectedHandKeys || []).length) drain();
    }
    function resolveCareerSessionPopulation(requestedSessionId) {
      return routedPromise(db, [STORE_RECORDS], 'readonly', function (tx, resolve, reject) {
        var records = [], sessionId;
        function fail(error) { try { tx.abort(); } catch (_abortError) {} reject(error); }
        tx.oncomplete = function () {
          try {
            var resolved = Aggregator.resolveActiveRecords(records);
            resolve({ sessionId: sessionId, resolved: resolved, activeRecords: resolved.activeRecords.filter(function (record) {
              return record.schemaVersion >= 4 && record.session.sessionId === sessionId;
            }) });
          } catch (error) { reject(error); }
        };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction failed')); };
        try {
          // This API historically coerces input and returns [] for malformed IDs;
          // create the transaction first so storage errors are not hidden by emptiness.
          sessionId = String(requestedSessionId);
          try { requiredHistoricalSessionId(sessionId); } catch (_invalidSessionId) { return; }
          readSessionPopulation(tx, [sessionId], function (values) { records = values; }, fail);
        } catch (error) { fail(error); }
      });
    }
    async function recentHandResults(playerId, window, filters, comparison) {
      var fallbackReason = null;
      function compute(snapshot, baseline) {
        return filters.map(function (filter, index) {
          return comparison && index === 0 ? recentComparisonFromSnapshot(snapshot, window, filter, baseline) : recentFromSnapshot(snapshot, window, filter);
        });
      }
      // Selection is the accepted validated primitive. Complete peers and the
      // reference share a readonly snapshot, fenced on both sides of computation.
      for (var attempt = 0; attempt < 2; attempt += 1) {
        var started = performance.now(), selection = await readCareerHandMemberships(playerId, window.count);
        if (!selection.valid) { fallbackReason = selection.reason; break; }
        var selectedAt = performance.now(), keys = selection.rows.map(function (row) { return row.handKey; });
        var population = await routedPromise(db, [STORE_RECORDS, STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readonly', function (tx, resolve, reject) {
          var meta = tx.objectStore(STORE_METADATA), current, membership, cache, head, loaded = 0, matches = false;
          var records = [], careerRecords = null, io = { physicalRecordsMaterialized: 0 }, projectionGeneration;
          function fail(error) { try { tx.abort(); } catch (_abortError) {} reject(error); }
          function begin() {
            if (++loaded !== 4) return;
            // A sealed global catalog certifies the raw Recent namespace check.
            // Building/invalid/unavailable catalogs take the complete raw path.
            matches = validProjectionReadState(current) && current.ledgerRevision === selection.ledgerRevision &&
              validMembershipReady(membership, current.ledgerRevision) && membership.generation === selection.generation;
            if (!matches) return;
            projectionGeneration = current.generation;
            readSessionPopulation(tx, [], function (values, reads) { records = values; io = reads; }, fail, undefined, keys);
            if (comparison && (filters[0].counterpartMode || !recentCareerCacheUsable(cache, head))) {
              readSessionPopulation(tx, [], function (values) { careerRecords = values; }, fail, playerId);
            }
          }
          [[meta, SESSION_PROJECTION_STATE_KEY, function (value) { current = value; }],
            [meta, HAND_MEMBERSHIP_STATE_KEY, function (value) { membership = value; }],
            [tx.objectStore(STORE_AGGREGATES), playerId, function (value) { cache = value; }],
            [tx.objectStore(STORE_PLAYER_HEADS), playerId, function (value) { head = value; }]].forEach(function (entry) {
            var request = entry[0].get(entry[1]);
            request.onsuccess = function () { try { entry[2](request.result); begin(); } catch (error) { fail(error); } };
          });
          tx.oncomplete = function () { resolve({ matches: matches, records: records, careerRecords: careerRecords,
            cache: cache, io: io, projectionGeneration: projectionGeneration }); };
          tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Recent hand snapshot read failed')); };
        });
        if (!population.matches) { fallbackReason = 'hand-snapshot-or-global-catalog-unavailable'; continue; }
        var fetchedAt = performance.now(), snapshot = recentSnapshot(population.records, playerId);
        var byHand = new Map(snapshot.hands.map(function (record) { return [record.handKey, record]; }));
        var active = selection.rows.map(function (row) {
          var record = byHand.get(row.handKey);
          return record && record.fingerprint === row.fingerprint && handTime(record) === row.finalizedAt &&
            record.players.some(function (entry) { return sameProjectionKey(entry.playerId, row.participantId) && Number(entry.counters.hands || 0) > 0; }) ? record : null;
        });
        if (new Set(keys).size !== keys.length || active.some(function (record) { return !record; })) {
          fallbackReason = 'membership-authority-mismatch'; break;
        }
        // Foreign predecessor context is resolver input, never extra window membership.
        snapshot.hands = active; snapshot.omittedUndatedHands = selection.omittedUndatedHands;
        var resolvedAt = performance.now(), baseline;
        if (comparison) baseline = population.careerRecords === null ? recentCareerFromCache(population.cache, playerId, filters[0]) :
          careerPopulationFromSnapshot(recentSnapshot(population.careerRecords, playerId), filters[0]);
        var referenceAt = performance.now(), values = compute(snapshot, baseline), computedAt = performance.now();
        var tx = await routedTransaction(db, STORE_METADATA, 'readonly'), completion = transactionPromise(tx), meta = tx.objectStore(STORE_METADATA);
        var fence = await Promise.all([requestPromise(meta.get(SESSION_PROJECTION_STATE_KEY)), requestPromise(meta.get(HAND_MEMBERSHIP_STATE_KEY))]);
        await completion;
        if (!validProjectionReadState(fence[0]) || fence[0].generation !== population.projectionGeneration ||
            fence[0].ledgerRevision !== selection.ledgerRevision || !validMembershipReady(fence[1], selection.ledgerRevision) ||
            fence[1].generation !== selection.generation) {
          fallbackReason = 'hand-snapshot-changed-before-publication'; continue;
        }
        values.forEach(function (value) {
          var diagnostics = { source: 'hand-memberships-bounded', generation: selection.generation, ledgerRevision: selection.ledgerRevision,
            attempts: attempt + 1, historyTraversals: 0, fullLedgerScanRequests: 0, selectedLogicalHandKeys: keys,
            selectedFingerprints: selection.rows.map(function (row) { return row.fingerprint; }),
            membershipRowsMaterialized: selection.rows.length, playerMembershipPopulation: selection.population,
            physicalRecordsMaterialized: population.io.physicalRecordsMaterialized, authoritativeRecords: population.records.length,
            careerPlayerRecordsRead: population.careerRecords === null ? 0 : population.careerRecords.length,
            careerBaseline: comparison ? population.careerRecords === null ? 'maintained-aggregate' : 'authoritative-player-history' : null,
            selectionMs: selectedAt - started, populationFetchMs: fetchedAt - selectedAt, resolutionMs: resolvedAt - fetchedAt,
            careerReferenceMs: referenceAt - resolvedAt, computationMs: computedAt - referenceAt, totalMs: performance.now() - started };
          Object.assign(value.query, diagnostics);
          if (value.recent) Object.assign(value.recent.query, diagnostics);
        });
        return values;
      }
      return boundedRawQuery({ kind: 'recent', playerId: playerId, window: window, filters: filters, comparison: comparison, reason: fallbackReason });
    }
    async function recentSessionResults(playerId, requestedWindow, requestedFilters, comparison) {
      playerId = requiredSessionPlayerId(playerId);
      var window = requiredRecentWindow(requestedWindow), filters = requestedFilters.map(normalizedSessionFilters);
      if (window.type === 'hands' && [100, 250, 500].includes(window.count)) return recentHandResults(playerId, window, filters, comparison);
      var bounded = window.type === 'sessions' && [3, 5, 10].includes(window.count);
      var fallbackReason = bounded ? null : 'window-outside-session-presets';
      function compute(snapshot, baseline) {
        return filters.map(function (filter, index) {
          return comparison && index === 0 ? recentComparisonFromSnapshot(snapshot, window, filter, baseline) : recentFromSnapshot(snapshot, window, filter);
        });
      }
      // At most two projection attempts. Under sustained mutation use one coherent
      // raw snapshot, never unbounded retries or synchronous projection rebuilding.
      for (var attempt = 0; bounded && attempt < 2; attempt += 1) {
        var started = performance.now();
        var selection = await readCareerSessionProjectionPage({ playerId: playerId, mode: 'catalog', limit: window.count, scanLimit: 1024 });
        if (!selection.valid || selection.rows.length < window.count && selection.next) {
          fallbackReason = selection.reason || 'sparse-player-probe-budget'; break;
        }
        var ids = selection.rows.map(function (row) { return row.sessionId; });
        var selectedAt = performance.now();
        var population = await routedPromise(db, [STORE_RECORDS, STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readonly', function (tx, resolve, reject) {
          var meta = tx.objectStore(STORE_METADATA), records = [], careerRecords = null, cache, head, current, io, ready = 0, matches = false;
          function fail(error) { try { tx.abort(); } catch (_abortError) {} reject(error); }
          function begin() {
            if (++ready !== 3) return;
            matches = validProjectionReadState(current) && current.generation === selection.generation && current.ledgerRevision === selection.ledgerRevision;
            if (!matches) return;
            readSessionPopulation(tx, ids, function (values, reads) { records = values; io = reads; }, fail);
            if (comparison && (filters[0].counterpartMode || !recentCareerCacheUsable(cache, head))) {
              readSessionPopulation(tx, [], function (values) { careerRecords = values; }, fail, playerId);
            }
          }
          [[meta, SESSION_PROJECTION_STATE_KEY, function (value) { current = value; }],
            [tx.objectStore(STORE_AGGREGATES), playerId, function (value) { cache = value; }],
            [tx.objectStore(STORE_PLAYER_HEADS), playerId, function (value) { head = value; }]].forEach(function (entry) {
            var request = entry[0].get(entry[1]);
            request.onsuccess = function () { try { entry[2](request.result); begin(); } catch (error) { fail(error); } };
          });
          tx.oncomplete = function () { resolve({ matches: matches, records: records, careerRecords: careerRecords, cache: cache, io: io }); };
          tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Recent Session snapshot read failed')); };
        });
        if (!population.matches) { fallbackReason = 'snapshot-changed-before-population'; continue; }
        var fetchedAt = performance.now(), snapshot = recentSnapshot(population.records, playerId, ids), values;
        if (comparison) {
          if (population.careerRecords !== null) {
            var whole = recentSnapshot(population.careerRecords, playerId);
            values = compute(snapshot, careerPopulationFromSnapshot(whole, filters[0]));
          } else {
            var career = recentCareerFromCache(population.cache, playerId, filters[0]);
            values = compute(snapshot, career);
          }
        } else values = compute(snapshot);
        var computedAt = performance.now();
        var fence = await careerSessionProjectionState();
        if (!validProjectionReadState(fence) || fence.generation !== selection.generation || fence.ledgerRevision !== selection.ledgerRevision) {
          fallbackReason = 'snapshot-changed-before-publication'; continue;
        }
        values.forEach(function (value) {
          var diagnostics = { source: 'session-projections-bounded', generation: selection.generation, ledgerRevision: selection.ledgerRevision,
            attempts: attempt + 1, historyTraversals: 0, fullLedgerScanRequests: 0, selectedSessionIds: ids,
            scannedCanonicalRows: selection.scannedCanonicalRows, sessionPhysicalCandidates: population.io.sessionPhysicalCandidates,
            physicalRecordsMaterialized: population.io.physicalRecordsMaterialized, authoritativeRecords: population.records.length,
            careerPlayerRecordsRead: population.careerRecords === null ? 0 : population.careerRecords.length,
            careerBaseline: comparison ? population.careerRecords === null ? 'maintained-aggregate' : 'authoritative-player-history' : null,
            selectionMs: selectedAt - started, populationFetchMs: fetchedAt - selectedAt,
            computationMs: computedAt - fetchedAt, totalMs: performance.now() - started };
          Object.assign(value.query, diagnostics);
          if (value.recent) { Object.assign(value.recent.query, diagnostics); value.query.careerPhysicalRecords = population.careerRecords === null ? population.cache.physicalRecordCount : value.query.careerPhysicalRecords; }
        });
        return values;
      }
      return boundedRawQuery({ kind: 'recent', playerId: playerId, window: window, filters: filters, comparison: comparison, reason: fallbackReason });
    }
    // Trends needs the coerced positive-player catalog, not the rich-list's
    // strict-string population. Read only this player's compact catalog and
    // canonical parents in one snapshot; never enumerate physical history here.
    function readTrendCatalog(playerId) {
      return routedPromise(db, [STORE_METADATA, STORE_SESSION_PROJECTIONS, STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readonly', function (tx, resolve, reject) {
        var meta = tx.objectStore(STORE_METADATA), store = tx.objectStore(STORE_SESSION_PROJECTIONS);
        var state, population, unassigned, players, cache, head, remaining = 6, output = { valid: false, reason: 'unavailable-trend-catalog' };
        function fail(error) { try { tx.abort(); } catch (_abortError) {} reject(error); }
        function begin() {
          if (--remaining) return;
          if (!validProjectionReadState(state) || population && !validProjectionPopulation(population, state, playerId) ||
              players.length !== (population ? population.playerRows : 0) || Boolean(unassigned) !== Boolean(population && population.unassigned) ||
              unassigned && (!validProjectionReadRow(unassigned, state) || unassigned.kind !== 'unassigned' || unassigned.playerId !== playerId)) return;
          var counts = unassigned ? { legacyHandCount: unassigned.legacyHandCount, unsupportedHandCount: unassigned.unsupportedHandCount } :
            { legacyHandCount: 0, unsupportedHandCount: 0 };
          var participating = counts.legacyHandCount + counts.unsupportedHandCount;
          if (!players.every(function (row) {
            participating += row.playerHandCount;
            return row.kind === 'player' && row.playerId === playerId && validProjectionReadRow(row, state) && row.catalogHandCount === row.playerHandCount;
          })) { output.reason = 'unprovable-trend-participant-identity'; return; }
          // Aggregate recordCount includes all coerced identities, even zero-hand
          // entries. Equality certifies no nonstring unassigned/zero population
          // was silently lost by the strict projection producer. Missing or
          // quarantine-context aggregates choose the exact raw implementation.
          if (!(participating === 0 && !head && !cache) &&
              (!validSummaryHead(head) || head.playerId !== playerId || head.contextHandKeys.length || !validCache(cache, head) ||
               cache.player.playerId !== playerId || cache.player.recordCount !== participating)) {
            output.reason = 'unprovable-trend-unassigned-coverage'; return;
          }
          var rows = [], pending = players.length;
          output = { valid: true, rows: rows, unassigned: counts, generation: state.generation, ledgerRevision: state.ledgerRevision };
          players.forEach(function (player) {
            var request = store.get(projectionKey('canonical', '', player.sessionId));
            request.onsuccess = function () { try {
              var parent = request.result;
              if (!parent || parent.kind !== 'canonical' || !validProjectionReadRow(parent, state) ||
                  parent.sessionId !== player.sessionId || player.catalogHandCount > parent.handCount) {
                output.valid = false; output.reason = 'invalid-trend-canonical-parent';
              } else rows.push({ canonical: parent, player: player });
              if (--pending === 0) rows.sort(function (a, b) {
                return projectionOrder(a.canonical.endedAt) - projectionOrder(b.canonical.endedAt) || a.canonical.sessionId.localeCompare(b.canonical.sessionId);
              });
            } catch (error) { fail(error); } };
          });
        }
        [[meta, SESSION_PROJECTION_STATE_KEY, function (v) { state = v; }],
          [meta, projectionPopulationKey(playerId), function (v) { population = v; }],
          [store, projectionKey('unassigned', playerId, ''), function (v) { unassigned = v; }],
          [tx.objectStore(STORE_AGGREGATES), playerId, function (v) { cache = v; }],
          [tx.objectStore(STORE_PLAYER_HEADS), playerId, function (v) { head = v; }]].forEach(function (entry) {
          var request = entry[0].get(entry[1]);
          request.onsuccess = function () { try { entry[2](request.result); begin(); } catch (error) { fail(error); } };
        });
        var request = store.getAll(IDBKeyRange.bound(['player', playerId], ['player', playerId, []]));
        request.onsuccess = function () { try { players = request.result; begin(); } catch (error) { fail(error); } };
        tx.oncomplete = function () { resolve(output); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Trend catalog read failed')); };
      });
    }
    function trendProjectionPoint(row, playerId) {
      var summary = projectionPlayerSummary(row.canonical, row.player);
      var core = FilteredStats.careerStatsFromResolved({ activeRecords: [], acceptedRecords: [] }, playerId, {});
      core.counters = summary.stats.counters; core.derived = summary.stats.derived; core.coverage = summary.coverage;
      core = publicStatResult(core);
      return { sessionId: summary.sessionId, provenanceStatus: summary.provenanceStatus, startedAt: summary.startedAt, endedAt: summary.endedAt,
        sessionHandCount: summary.sessionHandCount, playerHandCount: summary.playerHandCount, playerTableSizeHands: summary.playerTableSizeHands,
        core: core, relational: null, stats: statMeasures(core) };
    }
    function readTrendPopulation(selection, rows) {
      return routedPromise(db, [STORE_METADATA, STORE_RECORDS], 'readonly', function (tx, resolve, reject) {
        var records = [], io, matches = false;
        function fail(error) { try { tx.abort(); } catch (_abortError) {} reject(error); }
        var request = tx.objectStore(STORE_METADATA).get(SESSION_PROJECTION_STATE_KEY);
        request.onsuccess = function () { try {
          var state = request.result;
          matches = validProjectionReadState(state) && state.generation === selection.generation && state.ledgerRevision === selection.ledgerRevision;
          if (matches) readSessionPopulation(tx, rows.map(function (row) { return row.canonical.sessionId; }), function (values, reads) { records = values; io = reads; }, fail);
        } catch (error) { fail(error); } };
        tx.oncomplete = function () { resolve({ matches: matches, records: records, io: io }); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Trend population read failed')); };
      });
    }
    async function sessionTrendResults(playerId, requestedFilters, requestedRange) {
      playerId = requiredSessionPlayerId(playerId);
      var filters = normalizedSessionFilters(requestedFilters), range = trendRange(requestedRange), reason;
      var filtered = Boolean(filters.position || filters.situation || filters.tableSize || filters.counterpartMode);
      for (var attempt = 0; attempt < 2; attempt += 1) {
        var start = performance.now(), selection = await readTrendCatalog(playerId), selectedAt = performance.now();
        if (!selection.valid) { reason = selection.reason; break; }
        var rows = (range === 'all' ? selection.rows : selection.rows.slice(0, range)).slice().reverse();
        var points = [], fetchMs = 0, computeMs = 0, physical = 0, authoritative = 0, candidates = 0, active = 0, valid = true;
        if (!filtered) {
          points = rows.map(function (row) { return trendProjectionPoint(row, playerId); });
          computeMs = performance.now() - selectedAt;
        } else {
          for (var offset = 0; offset < rows.length; offset += 100) {
            var batch = rows.slice(offset, offset + 100), before = performance.now();
            var population = await readTrendPopulation(selection, batch), fetched = performance.now();
            fetchMs += fetched - before;
            if (!population.matches) { valid = false; reason = 'trend-revision-changed-between-batches'; break; }
            var result = careerPlayerSessionTrendFromRecords(population.records, playerId, requestedFilters);
            active += result.query.activeRecordsExamined;
            var byId = new Map(result.points.map(function (point) { return [point.sessionId, point]; }));
            batch.forEach(function (row) {
              var point = byId.get(row.canonical.sessionId);
              if (!point || point.playerHandCount !== row.player.catalogHandCount) { valid = false; reason = 'trend-population-projection-mismatch'; return; }
              // Whole canonical times/counts belong to the catalog, including
              // other participants after this player's last qualifying hand.
              point.startedAt = row.canonical.startedAt; point.endedAt = row.canonical.endedAt; point.sessionHandCount = row.canonical.handCount;
              points.push(point);
            });
            computeMs += performance.now() - fetched;
            physical += population.io.physicalRecordsMaterialized; authoritative += population.records.length; candidates += population.io.sessionPhysicalCandidates;
            if (!valid) break;
          }
        }
        if (!valid) continue;
        var fence = await careerSessionProjectionState();
        if (!validProjectionReadState(fence) || fence.generation !== selection.generation || fence.ledgerRevision !== selection.ledgerRevision) {
          reason = 'trend-revision-changed-before-publication'; continue;
        }
        var value = { playerId: playerId, filters: filters, order: 'endedAt-ascending-sessionId-descending', points: points, unassigned: selection.unassigned,
          query: { source: filtered ? 'session-projections-authoritative-batches' : 'session-projections', generation: selection.generation,
            ledgerRevision: selection.ledgerRevision, attempts: attempt + 1, historyTraversals: 0, fullLedgerScanRequests: 0,
            resolverPasses: filtered ? Math.ceil(rows.length / 100) : 0, physicalRecordsRead: authoritative, activeRecordsExamined: active,
            sessionPopulationsComputed: points.length, catalogSessionCount: selection.rows.length, projectionRowsMaterialized: selection.rows.length * 2 +
              (selection.unassigned.legacyHandCount + selection.unassigned.unsupportedHandCount > 0 ? 1 : 0),
            physicalRecordsMaterialized: physical, sessionPhysicalCandidates: candidates, selectionMs: selectedAt - start,
            populationFetchMs: fetchMs, computationMs: computeMs, totalMs: performance.now() - start } };
        if (requestedRange !== undefined) { value.range = range; value.totalSessionCount = selection.rows.length; }
        return value;
      }
      var result = await boundedRawQuery({ kind: 'trend', playerId: playerId, filters: [filters], range: range, requestedRange: requestedRange });
      result.query.fallbackReason = reason;
      return result;
    }
    async function careerDashboardStats(playerId, requested) {
      await ensureContextAggregates();
      playerId = String(playerId); requested = requested || {};
      var scope = FilteredStats.normalizeFilters({ position: requested.position || null, situation: requested.situation || null, tableSize: requested.tableSize || null });
      var position = scope.position; var situation = scope.situation; var tableSize = scope.tableSize;
      var opponentMode = requested.opponentMode === 'self' || requested.opponentMode === 'others' ? requested.opponentMode : 'overall';
      var selfPlayerId = requested.selfPlayerId === null || requested.selfPlayerId === undefined ? null : String(requested.selfPlayerId);
      var read = await routedTransaction(db, [STORE_AGGREGATES, STORE_PLAYER_HEADS, STORE_METADATA], 'readonly');
      var values = await Promise.all([
        requestPromise(read.objectStore(STORE_AGGREGATES).get(playerId)),
        requestPromise(read.objectStore(STORE_PLAYER_HEADS).get(playerId)),
        requestPromise(read.objectStore(STORE_METADATA).get('career'))
      ]);
      await transactionPromise(read);
      var aggregateCache = values[0]; var head = values[1] || null; var metadata = values[2] || {};
      var cacheKey = playerId + '|' + read.route.careerGeneration + '|' + Number(head && head.revision || 0) + '|' + canonicalJson({ position: position, situation: situation, tableSize: tableSize, opponentMode: opponentMode, selfPlayerId: selfPlayerId });
      if (dashboardCache.has(cacheKey)) {
        var cached = cloneDashboard(dashboardCache.get(cacheKey));
        cached.query.dashboardCacheHit = true; cached.query.playerRecordRetrievals = 0;
        return cached;
      }
      var aggregateCacheUsed = Boolean(validCache(aggregateCache, head));
      var hasScope = Boolean(position || situation || tableSize);
      var needsRecords = Boolean(opponentMode !== 'overall' || !aggregateCacheUsed);
      var playerRecords = [];
      var retrievals = 0;
      if (needsRecords) {
        var wrappers = await indexedPlayerHistory(playerId, read.route); retrievals = 1;
        playerRecords = wrappers.map(function (wrapper) { return wrapper.record; });
      }
      if (!aggregateCacheUsed && head) {
        var rebuilt = playerFromRecords(playerRecords, playerId);
        if (rebuilt.player) {
          aggregateCache = cacheForPlayer(Object.assign({}, rebuilt.player, { derived: undefined }), head.revision, rebuilt.physicalRecordCount);
          var write = await routedTransaction(db, [STORE_AGGREGATES], 'readwrite', read.route);
          await putRoutedCareerCache(write, aggregateCache);
        }
      }
      var relationalStatIds = opponentMode !== 'overall' ? ['threeBet', 'foldToThreeBet', 'foldToFlopCBet'] : [];
      var filters = [];
      relationalStatIds.forEach(function (statId) {
        filters.push({ position: position, situation: situation, tableSize: tableSize, statId: statId, counterpartMode: opponentMode, selfPlayerId: selfPlayerId });
      });
      var filteredResults = FilteredStats.careerStatsFilteredBatch(playerRecords, playerId, filters);
      var core = hasScope ? contextResultFromCache(aggregateCache, { position: position, situation: situation, tableSize: tableSize }, playerId) : unfilteredResultFromCache(aggregateCache);
      var relational = {};
      relationalStatIds.forEach(function (statId, index) {
        relational[statId] = filteredResults[index];
      });
      var result = { core: core, relational: relational, comparisonContexts: comparisonContextsFromCache(aggregateCache, head && head.revision, playerId, tableSize), profileStats: profileStatsFromCache(aggregateCache, { position: position, situation: situation, tableSize: tableSize }), careerTrackingStartedAt: metadata.careerTrackingStartedAt || null, query: { playerRevision: Number(head && head.revision || 0), aggregateCacheUsed: aggregateCacheUsed, dashboardCacheHit: false, playerRecordRetrievals: retrievals } };
      dashboardCache.set(cacheKey, cloneDashboard(result));
      while (dashboardCache.size > 32) dashboardCache.delete(dashboardCache.keys().next().value);
      return result;
    }
    async function careerTrendStats(playerId) {
      await ensurePlayerSummaries(); playerId = String(playerId);
      var read = await routedTransaction(db, [STORE_PLAYER_HEADS], 'readonly'); var head = await requestPromise(read.objectStore(STORE_PLAYER_HEADS).get(playerId)); await transactionPromise(read);
      var revision = Number(head && head.revision || 0); var cacheKey = playerId + '|' + read.route.careerGeneration + '|' + revision;
      if (trendCache.has(cacheKey)) { var cached = cloneDashboard(trendCache.get(cacheKey)); cached.query.trendCacheHit = true; cached.query.trendRequestCoalesced = false; cached.query.playerRecordRetrievals = 0; return cached; }
      if (trendPending.has(cacheKey)) return trendPending.get(cacheKey).then(function (value) { var shared = cloneDashboard(value); shared.query.trendCacheHit = true; shared.query.trendRequestCoalesced = true; shared.query.playerRecordRetrievals = 0; return shared; });
      var generation = trendGeneration;
      var operation = (async function () {
        var wrappers = head ? await indexedPlayerHistory(playerId, read.route) : [];
        var result = FilteredStats.careerTrendStats(wrappers.map(function (wrapper) { return wrapper.record; }), playerId);
        result.query = Object.assign({}, result.query, { playerRevision: revision, trendCacheHit: false, trendRequestCoalesced: false, playerRecordRetrievals: head ? 1 : 0 });
        if (generation === trendGeneration) { trendCache.set(cacheKey, cloneDashboard(result)); while (trendCache.size > 32) trendCache.delete(trendCache.keys().next().value); }
        return result;
      })();
      trendPending.set(cacheKey, operation);
      try { return await operation; } finally { if (trendPending.get(cacheKey) === operation) trendPending.delete(cacheKey); }
    }
    function replaceCareerRecords(nextRecords, career, restoreOptions) {
      var replacement = replacementPlan(nextRecords, career, restoreOptions);
      if (!replacement.ok) return Promise.reject(new Error(replacement.reason));
      var mutationMode = restoreOptions && restoreOptions.mode === 'merge' ? 'merge' : 'replace';
      return routedPromise(db, [STORE_RECORDS, STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readwrite', function (tx, resolve, reject) {
        // Promise rejection alone cannot roll back already queued IDB mutations.
        function fail(error) { try { tx.abort(); } catch (_abortError) { /* Keep the original failure if already inactive. */ } reject(error); }
        tx.onerror = function () { reject(tx.error || new Error('career mutation transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('career mutation transaction aborted; previous career remains intact')); };
        try {
          var recordStore = tx.objectStore(STORE_RECORDS); var metadataStore = tx.objectStore(STORE_METADATA);
          var aggregateStore = tx.objectStore(STORE_AGGREGATES); var headStore = tx.objectStore(STORE_PLAYER_HEADS);
          recordStore.clear(); metadataStore.clear(); aggregateStore.clear(); headStore.clear();
          replacement.wrappers.forEach(function (wrapper) { recordStore.add(wrapper); });
          replacement.caches.forEach(function (cache) { aggregateStore.add(cache); });
          replacement.heads.forEach(function (head) { headStore.add(head); });
          metadataStore.add(replacement.metadata);
          invalidateSessionProjections(tx, 'Career Replace');
          var verifyRecords = recordStore.getAll(); var verifyMetadata = metadataStore.get('career'); var verifyHeads = headStore.getAll(); var verified = false; var restoredWrappers = null; var restoredMetadata = null; var restoredHeads = null;
          function verify() {
            if (!restoredWrappers || !restoredMetadata || !restoredHeads || verified) return;
            var restoredRecords = restoredWrappers.map(function (wrapper) { return wrapper.record; });
            var restored = Aggregator.rebuild(restoredRecords);
            if (restored.rejectedRecords.length || restoredRecords.length !== replacement.wrappers.length || canonicalJson(restored.aggregate) !== canonicalJson(replacement.resolved.aggregate) || restoredMetadata.physicalRecordCount !== replacement.metadata.physicalRecordCount || !summariesReady(restoredMetadata, restoredHeads) || canonicalJson(restoredHeads.slice().sort(function (a, b) { return a.playerId.localeCompare(b.playerId); })) !== canonicalJson(replacement.heads.slice().sort(function (a, b) { return a.playerId.localeCompare(b.playerId); }))) {
              tx.abort(); return;
            }
            verified = true;
          }
          verifyRecords.onsuccess = function () { try { restoredWrappers = verifyRecords.result || []; verify(); } catch (error) { fail(error); } };
          verifyMetadata.onsuccess = function () { try { restoredMetadata = verifyMetadata.result || null; verify(); } catch (error) { fail(error); } };
          verifyHeads.onsuccess = function () { try { restoredHeads = verifyHeads.result || []; verify(); } catch (error) { fail(error); } };
          tx.oncomplete = function () { if (!verified) { reject(new Error('career mutation verification did not complete')); return; } dashboardCache.clear(); trendCache.clear(); trendPending.clear(); trendGeneration += 1; summaryError = null; resolve({ replaced: mutationMode === 'replace', merged: mutationMode === 'merge', metadata: clone(replacement.metadata), aggregate: clone(replacement.resolved.aggregate) }); };
        } catch (error) { fail(error); }
      });
    }
    async function mergeCareerRecords(nextRecords, career, mergeOptions) {
      var read = await routedTransaction(db, [STORE_RECORDS], 'readonly');
      var currentWrappers = await requestPromise(read.objectStore(STORE_RECORDS).getAll()); await transactionPromise(read);
      var currentRecords = currentWrappers.map(function (wrapper) { return wrapper.record; });
      if (!mergePreservesExisting(currentRecords, nextRecords)) throw new Error('Career merge cannot remove or alter existing physical records');
      var replacement = replacementPlan(nextRecords, career, Object.assign({}, mergeOptions || {}, { mode: 'merge' }));
      if (!replacement.ok) throw new Error(replacement.reason);
      return routedPromise(db, [STORE_RECORDS, STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readwrite', function (tx, resolve, reject) {
        function fail(error) { try { tx.abort(); } catch (_abortError) { /* Keep the original failure if already inactive. */ } reject(error); }
        tx.onerror = function () { reject(tx.error || new Error('Career merge transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('Career merge transaction aborted; previous Career history remains intact')); };
        try {
          var recordStore = tx.objectStore(STORE_RECORDS); var metadataStore = tx.objectStore(STORE_METADATA);
          var aggregateStore = tx.objectStore(STORE_AGGREGATES); var headStore = tx.objectStore(STORE_PLAYER_HEADS);
          replacement.wrappers.forEach(function (wrapper) { recordStore.put(wrapper); });
          aggregateStore.clear(); headStore.clear();
          replacement.caches.forEach(function (cache) { aggregateStore.add(cache); });
          replacement.heads.forEach(function (head) { headStore.add(head); });
          metadataStore.put(replacement.metadata);
          invalidateSessionProjections(tx, 'Career Merge');
          var verifyRecords = recordStore.getAll(); var verifyMetadata = metadataStore.get('career'); var verifyHeads = headStore.getAll();
          var mergedWrappers = null; var mergedMetadata = null; var mergedHeads = null; var verified = false;
          function verify() {
            if (!mergedWrappers || !mergedMetadata || !mergedHeads || verified) return;
            var mergedRecords = mergedWrappers.map(function (wrapper) { return wrapper.record; });
            var merged = Aggregator.rebuild(mergedRecords);
            var recordsMatch = canonicalJson(mergedRecords.slice().sort(function (left, right) { return left.handKey.localeCompare(right.handKey) || left.fingerprint.localeCompare(right.fingerprint); })) === canonicalJson(replacement.resolved.acceptedRecords);
            var headsMatch = canonicalJson(mergedHeads.slice().sort(function (a, b) { return a.playerId.localeCompare(b.playerId); })) === canonicalJson(replacement.heads.slice().sort(function (a, b) { return a.playerId.localeCompare(b.playerId); }));
            if (!recordsMatch || merged.rejectedRecords.length || merged.quarantinedHandKeys.length || canonicalJson(merged.aggregate) !== canonicalJson(replacement.resolved.aggregate) || canonicalJson(mergedMetadata) !== canonicalJson(replacement.metadata) || !summariesReady(mergedMetadata, mergedHeads) || !headsMatch) { tx.abort(); return; }
            verified = true;
          }
          verifyRecords.onsuccess = function () { try { mergedWrappers = verifyRecords.result || []; verify(); } catch (error) { fail(error); } };
          verifyMetadata.onsuccess = function () { try { mergedMetadata = verifyMetadata.result || null; verify(); } catch (error) { fail(error); } };
          verifyHeads.onsuccess = function () { try { mergedHeads = verifyHeads.result || []; verify(); } catch (error) { fail(error); } };
          tx.oncomplete = function () {
            if (!verified) { reject(new Error('Career merge verification did not complete')); return; }
            dashboardCache.clear(); trendCache.clear(); trendPending.clear(); trendGeneration += 1; summaryError = null;
            resolve({ replaced: false, merged: true, metadata: clone(replacement.metadata), aggregate: clone(replacement.resolved.aggregate) });
          };
        } catch (error) { fail(error); }
      }, read.route);
    }
    async function removeCareerHandKeys(handKeys, expectedFingerprints) {
      var read = await routedTransaction(db, [STORE_RECORDS, STORE_METADATA], 'readonly');
      var snapshot = await Promise.all([requestPromise(read.objectStore(STORE_RECORDS).getAll()), requestPromise(read.objectStore(STORE_METADATA).get('career'))]);
      await transactionPromise(read);
      var mutation = affectedProjectionPlan(snapshot[0] || [], snapshot[1] || {}, handKeys);
      requireExpectedPhysicalDeletion(mutation, expectedFingerprints);
      if (!mutation.removed.length) return { removed: false, logicalHandCount: 0, physicalRecordCount: 0, affectedPlayerIds: [], metadata: clone(snapshot[1] || {}) };
      return routedPromise(db, [STORE_RECORDS, STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readwrite', function (tx, resolve, reject) {
        function fail(error) { try { tx.abort(); } catch (_abortError) { /* Keep the original failure if already inactive. */ } reject(error); }
        tx.onerror = function () { reject(tx.error || new Error('Career Session removal transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('Career Session removal transaction aborted; previous Career history remains intact')); };
        try {
          var recordStore = tx.objectStore(STORE_RECORDS); var metadataStore = tx.objectStore(STORE_METADATA);
          var aggregateStore = tx.objectStore(STORE_AGGREGATES); var headStore = tx.objectStore(STORE_PLAYER_HEADS);
          mutation.removed.forEach(function (wrapper) { recordStore.delete(wrapper.record.fingerprint); });
          mutation.affectedPlayerIds.forEach(function (id) { aggregateStore.delete(id); headStore.delete(id); });
          mutation.caches.forEach(function (cache) { aggregateStore.put(cache); });
          mutation.heads.forEach(function (head) { headStore.put(head); });
          metadataStore.put(mutation.metadata);
          invalidateSessionProjections(tx, 'Career hand/Session removal');
          var expectedHeads = new Map(mutation.heads.map(function (head) { return [head.playerId, head]; }));
          var countResult = null; var metadataResult = null; var headResults = new Map(); var verified = false;
          var countRequest = recordStore.count(); var metadataRequest = metadataStore.get('career');
          countRequest.onsuccess = function () { try { countResult = countRequest.result; verify(); } catch (error) { fail(error); } };
          metadataRequest.onsuccess = function () { try { metadataResult = metadataRequest.result; verify(); } catch (error) { fail(error); } };
          mutation.affectedPlayerIds.forEach(function (id) {
            var request = headStore.get(id);
            request.onsuccess = function () { try { headResults.set(id, request.result || null); verify(); } catch (error) { fail(error); } };
          });
          function verify() {
            if (countResult === null || !metadataResult || headResults.size !== mutation.affectedPlayerIds.length || verified) return;
            var headsMatch = mutation.affectedPlayerIds.every(function (id) { return canonicalJson(headResults.get(id)) === canonicalJson(expectedHeads.get(id) || null); });
            if (countResult !== mutation.retained.length || canonicalJson(metadataResult) !== canonicalJson(mutation.metadata) || !headsMatch) { tx.abort(); return; }
            verified = true;
          }
          tx.oncomplete = function () {
            if (!verified) { reject(new Error('Career Session removal verification did not complete')); return; }
            dashboardCache.clear(); trendCache.clear(); trendPending.clear(); trendGeneration += 1; summaryError = null;
            resolve({ removed: true, logicalHandCount: new Set(mutation.removed.map(function (wrapper) { return wrapper.record.handKey; })).size, physicalRecordCount: mutation.removed.length, affectedPlayerIds: mutation.affectedPlayerIds, metadata: clone(mutation.metadata) });
          };
        } catch (error) { fail(error); }
      }, read.route);
    }
    return {
      backend: 'indexeddb', migration: migration, append: append, careerStats: stats,
      careerStatsFiltered: async function (playerId, filters) { var wrappers = await indexedPlayerHistory(playerId); return FilteredStats.careerStatsFiltered(wrappers.map(function (wrapper) { return wrapper.record; }), playerId, filters); },
      careerDashboardStats: careerDashboardStats,
      careerTrendStats: careerTrendStats,
      careerHudStats: careerHudStats,
      careerPlayerSummaries: careerPlayerSummaries,
      careerStatsDiagnostic: statsDiagnostic,
      careerPlayers: async function () { var read = await routedTransaction(db, [STORE_PLAYER_HEADS], 'readonly'); var heads = await requestPromise(read.objectStore(STORE_PLAYER_HEADS).getAll()); await transactionPromise(read); return Promise.all(heads.sort(function (a, b) { return a.playerId.localeCompare(b.playerId); }).map(function (head) { return stats(head.playerId, read.route); })); },
      careerLedgerInfo: async function () { var tx = await routedTransaction(db, [STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readonly'); var values = await Promise.all([requestPromise(tx.objectStore(STORE_METADATA).get('career')), requestPromise(tx.objectStore(STORE_AGGREGATES).count()), requestPromise(tx.objectStore(STORE_PLAYER_HEADS).count())]); await transactionPromise(tx); return Object.assign(values[0] || {}, { ready: true, cacheEntryCount: values[1], playerCount: values[2], playerSummariesReady: Boolean(values[0] && values[0].playerSummaryVersion === PLAYER_SUMMARY_VERSION && summaryInitialized && !summaryError), playerSummaryBackfillRunning: Boolean(summaryWork), playerSummaryError: summaryError }); },
      careerPlayerRecordInfo: async function (playerId) { var wrappers = await indexedPlayerHistory(playerId); var resolution = Aggregator.rebuild(wrappers.map(function (wrapper) { return wrapper.record; })); return { playerId: String(playerId), physicalRecordCount: physicalRecordCountForPlayer(wrappers.map(function (wrapper) { return wrapper.record; }), playerId), activeRecordCount: physicalRecordCountForPlayer(resolution.activeRecords, playerId), rejectedRecords: resolution.rejectedRecords }; },
      recentCareerRecords: function (limit) {
        var maximum = Math.max(0, Math.min(20, Number(limit || 20)));
        return routedPromise(db, [STORE_RECORDS], 'readonly', function (tx, resolve, reject) {
          var values = [];
          var request = tx.objectStore(STORE_RECORDS).index('finalizedAt').openCursor(null, 'prev');
          request.onsuccess = function () { var cursor = request.result; if (!cursor || values.length >= maximum) return; values.push(clone(cursor.value.record)); cursor.continue(); };
          request.onerror = function () { reject(request.error || new Error('Recent career record cursor failed')); };
          tx.oncomplete = function () { resolve(values); }; tx.onerror = function () { reject(tx.error || new Error('Recent career record transaction failed')); };
        });
      },
      listCareerSessions: function () { return sessionListWithFallback(undefined, 'catalog'); },
      careerSessionProjectionState: careerSessionProjectionState,
      careerHandMembershipState: careerHandMembershipState,
      careerDerivedCleanupState: careerDerivedCleanupState,
      cleanupCareerDerivedNamespaces: cleanupCareerDerivedNamespaces,
      backfillCareerHandMemberships: backfillCareerHandMemberships,
      readCareerHandMemberships: readCareerHandMemberships,
      backfillCareerSessionProjections: backfillCareerSessionProjections,
      readCareerSessionProjections: readCareerSessionProjections,
      readCareerSessionProjectionPage: readCareerSessionProjectionPage,
      listCareerSessionsForPlayer: function (playerId) { return sessionListWithFallback(String(playerId), 'catalog'); },
      getCareerSession: function (sessionId) { return boundedRawQuery({ kind: 'session', sessionId: sessionId }); },
      getCareerSessionRecords: async function (sessionId) { return (await resolveCareerSessionPopulation(sessionId)).activeRecords; },
      listCareerSessionPlayerSummaries: async function (playerId) { return sessionListWithFallback(requiredSessionPlayerId(playerId), 'summary'); },
      getCareerSessionPlayerStats: async function (sessionId, playerId, filters) {
        return boundedRawQuery({ kind: 'detail', sessionId: sessionId, playerId: playerId, filters: [filters] });
      },
      getCareerRecentPlayerStats: async function (playerId, window, filters) { return (await recentSessionResults(playerId, window, [filters], false))[0]; },
      getCareerRecentVsCareer: async function (playerId, window, filters) { return (await recentSessionResults(playerId, window, [filters], true))[0]; },
      getCareerRecentBatch: function (playerId, window, filters) { return recentSessionResults(playerId, window, requiredRecentBatchFilters(filters), true); },
      getCareerPlayerSessionTrend: sessionTrendResults,
      rebuildCareerStats: async function () { return Aggregator.rebuild(await allRecords()).aggregate; },
      exportCareer: async function () { var tx = await routedTransaction(db, [STORE_METADATA, STORE_RECORDS], 'readonly'); var values = await Promise.all([requestPromise(tx.objectStore(STORE_METADATA).get('career')), requestPromise(tx.objectStore(STORE_RECORDS).getAll())]); await transactionPromise(tx); return serializableExport(values[0], values[1].map(function (wrapper) { return wrapper.record; })); },
      replaceCareerRecords: replaceCareerRecords,
      mergeCareerRecords: mergeCareerRecords,
      removeCareerHandKeys: removeCareerHandKeys,
      close: function () { db.close(); }
    };
  }

  // Local extension-page/dedicated-worker reader. Never dispatched through MV3
  // messaging, never initializes/migrates/repairs Career, never reads sidecars.
  async function createBackupV2Source(indexedDB, codec) {
    var db = await new Promise(function (resolve, reject) {
      var request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION), blocked = false;
      request.onupgradeneeded = function () { request.transaction.abort(); };
      request.onblocked = function () { blocked = true; reject(new Error('Career database is blocked')); };
      request.onerror = function () { reject(request.error || new Error('Existing DB5 Career is required')); };
      request.onsuccess = function () { if (blocked) { request.result.close(); return; } resolve(request.result); };
    });
    var metrics = { pages: 0, dbReadMs: 0, maxRecordsPerPage: 0, maxPageBytes: 0, maxActiveDBRequests: 2, finalizationRequests: 0 };
    function changed() { var error = new Error('Career changed during export; start a new backup.'); error.code = 'CAREER_BACKUP_V2_SOURCE_CHANGED'; return error; }
    function tokenFor(tx, metadata) {
      if (!metadata || metadata.storageSchemaVersion !== STORAGE_SCHEMA_VERSION || !metadata.migration || metadata.migration.state !== 'complete' ||
        typeof tx.route.ledgerRevision !== 'string' || !tx.route.ledgerRevision) throw new Error('Initialized DB5 Career is required');
      return Object.assign({}, tx.route, { careerMetadata: codec.boundary(metadata) });
    }
    async function transaction(token, records) {
      var tx = await routedTransaction(db, records ? [STORE_METADATA, STORE_RECORDS] : [STORE_METADATA], 'readonly');
      var completion = transactionPromise(tx); completion.catch(function () {});
      try {
        var metadata = await requestPromise(tx.objectStore(STORE_METADATA).get('career')), current = tokenFor(tx, metadata);
        if (token && canonicalJson(token) !== canonicalJson(current)) throw changed();
        return { tx: tx, completion: completion, token: current };
      } catch (error) { try { tx.abort(); } catch (_) {} await completion.catch(function () {}); throw error; }
    }
    return {
      metrics: metrics,
      capture: async function () { var state = await transaction(null, false); await state.completion; return state.token; },
      page: async function (token, after) {
        var start = performance.now(), state = await transaction(token, true), rows = [], size = 0, exhausted = false, next = after;
        try {
          await new Promise(function (resolve, reject) {
            var req = state.tx.objectStore(STORE_RECORDS).openCursor(after === null ? undefined : IDBKeyRange.lowerBound(after, true));
            req.onerror = function () { reject(req.error); };
            req.onsuccess = function () {
              try {
                var cursor = req.result;
                if (!cursor) { exhausted = true; resolve(); return; }
                var record = cursor.value.record, text = codec.recordText(record), n = new TextEncoder().encode(text).length;
                if (typeof cursor.key !== 'string' || cursor.key !== record.fingerprint) throw new Error('Invalid physical Career key');
                if (rows.length && (rows.length >= 128 || size + n + rows.length + 128 > codec.MAX_PAYLOAD_BYTES)) { resolve(); return; }
                rows.push(record); size += n; next = cursor.key;
                if (rows.length >= 128) { resolve(); return; }
                cursor.continue();
              } catch (error) { reject(error); }
            };
          });
          await state.completion;
          metrics.pages++; metrics.dbReadMs += performance.now() - start;
          metrics.maxRecordsPerPage = Math.max(metrics.maxRecordsPerPage, rows.length); metrics.maxPageBytes = Math.max(metrics.maxPageBytes, size);
          return { records: rows, after: next, exhausted: exhausted };
        } catch (error) { try { state.tx.abort(); } catch (_) {} await state.completion.catch(function () {}); throw error; }
      },
      finalize: async function (token, writeFooterAndClose) {
        var state = await transaction(token, true), running = true, keepaliveError = null;
        // Only the short footer/CompressionStream drain/close phase holds native read
        // locks. A single chained request preserves the transaction across disk awaits;
        // all append/Restore/publication transactions conflict with these scopes.
        function keepalive() {
          if (!running) return;
          try {
            var req = state.tx.objectStore(STORE_METADATA).get('career'); metrics.finalizationRequests++;
            req.onsuccess = keepalive;
            req.onerror = function () { keepaliveError = req.error; };
          } catch (error) { keepaliveError = error; }
        }
        keepalive();
        try { await writeFooterAndClose(); if (keepaliveError) throw keepaliveError; running = false; await state.completion; }
        catch (error) { running = false; try { state.tx.abort(); } catch (_) {} await state.completion.catch(function () {}); throw error; }
      },
      close: function () { db.close(); }
    };
  }

  function createMessageService(runtime) {
    if (!runtime || typeof runtime.sendMessage !== 'function') throw new TypeError('Extension runtime messaging is unavailable');
    function request(method, args) {
      return new Promise(function (resolve, reject) {
        runtime.sendMessage({ type: MESSAGE_TYPE, method: method, args: Array.isArray(args) ? args : [] }, function (response) {
          var runtimeError = runtime.lastError;
          if (runtimeError) { reject(new Error(runtimeError.message || String(runtimeError))); return; }
          if (!response || response.ok !== true) { reject(new Error(response && response.error || 'Career service worker returned no response')); return; }
          resolve(response.value);
        });
      });
    }
    return {
      backend: 'extension-service-worker-indexeddb',
      initialize: function () { return request('initialize'); },
      append: function (record) { return request('append', [record]); },
      careerStats: function (playerId) { return request('careerStats', [String(playerId)]); },
      careerStatsFiltered: function (playerId, filters) { return request('careerStatsFiltered', [String(playerId), filters || {}]); },
      careerDashboardStats: function (playerId, options) { return request('careerDashboardStats', [String(playerId), options || {}]); },
      careerTrendStats: function (playerId) { return request('careerTrendStats', [String(playerId)]); },
      careerHudStats: function (playerIds) { return request('careerHudStats', [normalizedPlayerIds(playerIds)]); },
      careerPlayers: function () { return request('careerPlayers'); },
      careerPlayerSummaries: function () { return request('careerPlayerSummaries'); },
      careerSessionProjectionState: function () { return request('careerSessionProjectionState'); },
      careerHandMembershipState: function () { return request('careerHandMembershipState'); },
      backfillCareerHandMemberships: function (options) { return request('backfillCareerHandMemberships', [options || {}]); },
      readCareerHandMemberships: function (playerId, limit) { return request('readCareerHandMemberships', limit === undefined ? [playerId] : [playerId, limit]); },
      backfillCareerSessionProjections: function (options) { return request('backfillCareerSessionProjections', [options || {}]); },
      readCareerSessionProjections: function (playerId, mode) { return request('readCareerSessionProjections', playerId === undefined ? [] : mode === undefined ? [playerId] : [playerId, mode]); },
      readCareerSessionProjectionPage: function (options) { return request('readCareerSessionProjectionPage', [options || {}]); },
      driveCareerSessionProjections: function () { return request('driveCareerSessionProjections'); },
      careerLedgerInfo: function () { return request('careerLedgerInfo'); },
      careerPlayerRecordInfo: function (playerId) { return request('careerPlayerRecordInfo', [String(playerId)]); },
      recentCareerRecords: function (limit) { return request('recentCareerRecords', [limit]); },
      listCareerSessions: function () { return request('listCareerSessions'); },
      listCareerSessionsForPlayer: function (playerId) { return request('listCareerSessionsForPlayer', [String(playerId)]); },
      getCareerSession: function (sessionId) { return request('getCareerSession', [String(sessionId)]); },
      getCareerSessionRecords: function (sessionId) { return request('getCareerSessionRecords', [String(sessionId)]); },
      listCareerSessionPlayerSummaries: function (playerId) { return request('listCareerSessionPlayerSummaries', [playerId]); },
      getCareerSessionPlayerStats: function (sessionId, playerId, filters) { return request('getCareerSessionPlayerStats', [sessionId, playerId, filters || {}]); },
      getCareerRecentPlayerStats: function (playerId, window, filters) { return request('getCareerRecentPlayerStats', [playerId, window, filters || {}]); },
      getCareerRecentVsCareer: function (playerId, window, filters) { return request('getCareerRecentVsCareer', [playerId, window, filters || {}]); },
      getCareerRecentBatch: function (playerId, window, filters) { return request('getCareerRecentBatch', [playerId, window, filters]); },
      getCareerPlayerSessionTrend: function (playerId, filters, range) { return request('getCareerPlayerSessionTrend', range === undefined ? [playerId, filters || {}] : [playerId, filters || {}, range]); },
      rebuildCareerStats: function () { return request('rebuildCareerStats'); },
      exportCareer: function () { return request('exportCareer'); },
      exportCareerBackup: function () { return request('exportCareerBackup'); },
      validateCareerBackup: function (backup) { return request('validateCareerBackup', [backup]); },
      prepareCareerRestore: function (backup) { return request('prepareCareerRestore', [backup]); },
      replaceCareerBackup: function (backup, confirmation) { return request('replaceCareerBackup', [backup, confirmation]); },
      prepareCareerImport: function (backup) { return request('prepareCareerImport', [backup]); },
      mergeCareerBackup: function (backup, confirmation) { return request('mergeCareerBackup', [backup, confirmation]); },
      prepareCareerSessionRemoval: function (removalRequest) { return request('prepareCareerSessionRemoval', [removalRequest]); },
      removeCareerSession: function (removalRequest, confirmation) { return request('removeCareerSession', [removalRequest, confirmation]); },
      prepareCareerHistoricalSessionDeletion: function (sessionId) { return request('prepareCareerHistoricalSessionDeletion', [sessionId]); },
      deleteCareerHistoricalSession: function (sessionId, confirmation) { return request('deleteCareerHistoricalSession', [sessionId, confirmation]); },
      careerRuntimeTimings: function (playerId) { return request('careerRuntimeTimings', [playerId === undefined ? null : String(playerId)]); }
    };
  }

  return Object.freeze({
    // Local inactive-bank builder shares the established cache/head contract.
    portability: Object.freeze({ cacheForPlayer: cacheForPlayer, summaryHead: summaryHead, validCache: validCache }),
    routing: Object.freeze({ transaction: routedTransaction, openDatabase: openDatabase, controlStore: STORE_CONTROL,
      bankStore: bankStore, sessionProjections: STORE_GENERATION_PROJECTIONS, handMemberships: STORE_GENERATION_MEMBERSHIPS }),
    DATABASE_NAME: DATABASE_NAME, DATABASE_VERSION: DATABASE_VERSION, STORAGE_SCHEMA_VERSION: STORAGE_SCHEMA_VERSION, PLAYER_SUMMARY_VERSION: PLAYER_SUMMARY_VERSION,
    MIGRATION_MARKER_KEY: MIGRATION_MARKER_KEY, OUTBOX_PREFIX: OUTBOX_PREFIX, MESSAGE_TYPE: MESSAGE_TYPE, STORES: Object.freeze({ records: STORE_RECORDS, metadata: STORE_METADATA, aggregates: STORE_AGGREGATES, playerHeads: STORE_PLAYER_HEADS, sessionProjections: STORE_SESSION_PROJECTIONS, handMemberships: STORE_HAND_MEMBERSHIPS }),
    HAND_MEMBERSHIP_STATE_KEY: HAND_MEMBERSHIP_STATE_KEY, HAND_MEMBERSHIP_VERSION: HAND_MEMBERSHIP_VERSION,
    SESSION_PROJECTION_VERSION: SESSION_PROJECTION_VERSION, SESSION_PROJECTION_STATE_KEY: SESSION_PROJECTION_STATE_KEY,
    phaseOneRecords: phaseOneRecords, outboxKey: outboxKey, outboxRecords: outboxRecords, recordWrapper: recordWrapper, migrationPlan: migrationPlan, replacementPlan: replacementPlan, serializableExport: serializableExport, mergePreservesExisting: mergePreservesExisting, normalizedRemovalRequest: normalizedRemovalRequest, sessionRemovalPlan: sessionRemovalPlan, historicalSessionDeletionPlan: historicalSessionDeletionPlan, affectedProjectionPlan: affectedProjectionPlan,
    listCareerSessionPlayerSummariesFromRecords: listCareerSessionPlayerSummariesFromRecords, careerSessionPlayerStatsFromRecords: careerSessionPlayerStatsFromRecords,
    careerRecentPlayerStatsFromRecords: careerRecentPlayerStatsFromRecords, careerRecentVsCareerFromRecords: careerRecentVsCareerFromRecords,
    careerPlayerSessionTrendFromRecords: careerPlayerSessionTrendFromRecords,
    createMemoryService: createMemoryService, createIndexedService: createIndexedService, createMessageService: createMessageService, hasCompleteDatabase: hasCompleteDatabase,
    createBackupV2Source: createBackupV2Source
  });
});
