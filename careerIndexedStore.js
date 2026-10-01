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
  var DATABASE_VERSION = 1;
  var STORAGE_SCHEMA_VERSION = 2;
  var MIGRATION_MARKER_KEY = 'pokerNowHudCareerV2:migration';
  var OUTBOX_PREFIX = 'pokerNowHudCareerV2:outbox:';
  var MESSAGE_TYPE = 'PNHUD_CAREER_INDEXED_REQUEST';
  var STORE_RECORDS = 'careerRecords';
  var STORE_METADATA = 'careerMetadata';
  var STORE_AGGREGATES = 'careerAggregateCache';
  var STORE_PLAYER_HEADS = 'careerPlayerHeads';
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
  function recentSnapshot(records, playerId) {
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
    return { playerId: playerId, resolved: resolved, catalog: catalog, hands: hands, physical: physical,
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
      selectedSessionIds = snapshot.catalog.filter(function (row) { return participating.has(row.sessionId); }).slice(0, window.count).map(function (row) { return row.sessionId; });
      var selected = new Set(selectedSessionIds);
      active = snapshot.hands.filter(function (record) { return selected.has(sessionIdOf(record)); });
    } else {
      var dated = snapshot.hands.filter(function (record) { return handTime(record) !== null; });
      omittedUndatedHands = snapshot.hands.length - dated.length;
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
    var snapshot = recentSnapshot(records, playerId); var recent = recentFromSnapshot(snapshot, window, filters);
    var whole = selectedResolution(snapshot, snapshot.hands);
    var coreFilters = { position: filters.position, situation: filters.situation, tableSize: filters.tableSize };
    var results = FilteredStats.careerStatsBatchFromResolved(whole, snapshot.playerId,
      filters.counterpartMode ? [coreFilters, filters] : [coreFilters]);
    var career = { playerId: snapshot.playerId, filters: filters, playerHandCount: snapshot.hands.length,
      playerTableSizeHands: composition(snapshot.hands), core: publicStatResult(results[0]),
      relational: filters.counterpartMode ? publicStatResult(results[1]) : null,
      profileStats: profileForPopulation(snapshot.hands, whole.acceptedRecords.length, snapshot.playerId, filters) };
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
    return { playerId: snapshot.playerId, window: window, recent: recent, career: career, comparison: comparison,
      query: Object.assign({}, snapshot.query, { selectedPhysicalRecords: recent.query.selectedPhysicalRecords,
        careerPhysicalRecords: whole.acceptedRecords.length }) };
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
        var result = Aggregator.append(state, record);
        if (!result.accepted) return result;
        var situations = Aggregator.careerSituationMap(record);
        var updated = record.players.map(function (entry) {
          var id = String(entry.playerId);
          var head = heads.get(id); var cache = caches.get(id);
          var next = !result.supersession && (!head || validCache(cache, head))
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
      getCareerPlayerSessionTrend: function (playerId, filters) { return Promise.resolve(careerPlayerSessionTrendFromRecords(allRecords(), playerId, filters)); },
      rebuildCareerStats: function () { return rebuild().then(function (result) { return result.aggregate; }); },
      exportCareer: function () { return Promise.resolve(serializableExport(metadata, allRecords())); },
      replaceCareerRecords: replaceCareerRecords,
      mergeCareerRecords: mergeCareerRecords,
      removeCareerHandKeys: removeCareerHandKeys,
      close: function () {},
      testHooks: { records: records, heads: heads, caches: caches, dashboardCache: dashboardCache, trendCache: trendCache, trendPending: trendPending, dashboardDiagnostics: dashboardDiagnostics, metadata: metadata, migrationPlan: plan }
    };
  }

  function requestPromise(request) { return new Promise(function (resolve, reject) { request.onsuccess = function () { resolve(request.result); }; request.onerror = function () { reject(request.error || new Error('IndexedDB request failed')); }; }); }
  function transactionPromise(transaction) { return new Promise(function (resolve, reject) { transaction.oncomplete = function () { resolve(); }; transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB transaction failed')); }; transaction.onabort = function () { reject(transaction.error || new Error('IndexedDB transaction aborted')); }; }); }
  function openDatabase(indexedDB) {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        var records = db.createObjectStore(STORE_RECORDS, { keyPath: 'record.fingerprint' });
        records.createIndex('handKey', 'record.handKey', { unique: false });
        records.createIndex('playerIds', 'playerIds', { unique: false, multiEntry: true });
        records.createIndex('finalizedAt', 'record.finalizedAt', { unique: false });
        records.createIndex('supersedesFingerprint', 'record.supersedesFingerprint', { unique: false });
        db.createObjectStore(STORE_METADATA, { keyPath: 'key' });
        db.createObjectStore(STORE_AGGREGATES, { keyPath: 'playerId' });
        db.createObjectStore(STORE_PLAYER_HEADS, { keyPath: 'playerId' });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('Unable to open career IndexedDB')); };
      request.onblocked = function () { reject(new Error('Career IndexedDB upgrade was blocked by another extension context')); };
    });
  }
  async function initializeDatabase(db, saved, options) {
    var read = db.transaction([STORE_METADATA], 'readonly');
    var existing = await requestPromise(read.objectStore(STORE_METADATA).get('career'));
    await transactionPromise(read);
    if (existing && existing.storageSchemaVersion === STORAGE_SCHEMA_VERSION && existing.migration && existing.migration.state === 'complete') return { ok: true, metadata: existing, alreadyComplete: true };
    var plan = migrationPlan(saved || {}, options || {});
    if (!plan.ok) return plan;
    var transaction = db.transaction([STORE_RECORDS, STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readwrite');
    plan.wrappers.forEach(function (wrapper) { transaction.objectStore(STORE_RECORDS).put(wrapper); });
    plan.caches.forEach(function (cache) { transaction.objectStore(STORE_AGGREGATES).put(cache); });
    plan.heads.forEach(function (head) { transaction.objectStore(STORE_PLAYER_HEADS).put(head); });
    transaction.objectStore(STORE_METADATA).put(plan.metadata);
    await transactionPromise(transaction);
    return plan;
  }
  async function hasCompleteDatabase(indexedDB) {
    if (!indexedDB || typeof indexedDB.open !== 'function') return false;
    var db = await openDatabase(indexedDB);
    try {
      var transaction = db.transaction([STORE_METADATA], 'readonly');
      var metadata = await requestPromise(transaction.objectStore(STORE_METADATA).get('career'));
      await transactionPromise(transaction);
      return Boolean(metadata && metadata.storageSchemaVersion === STORAGE_SCHEMA_VERSION && metadata.migration && metadata.migration.state === 'complete');
    } finally {
      db.close();
    }
  }
  function idbGetAll(db, storeName) { var tx = db.transaction([storeName], 'readonly'); return requestPromise(tx.objectStore(storeName).getAll()).then(function (value) { return transactionPromise(tx).then(function () { return value; }); }); }
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
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(includeHistoryIfStale ? [STORE_METADATA, STORE_PLAYER_HEADS, STORE_RECORDS] : [STORE_METADATA, STORE_PLAYER_HEADS], 'readonly');
      var snapshot = { metadata: null, heads: null, wrappers: null };
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
    return new Promise(function (resolve, reject) {
      var tx = db.transaction([STORE_METADATA, STORE_PLAYER_HEADS, STORE_AGGREGATES], 'readwrite'); var committed = false;
      var metadataStore = tx.objectStore(STORE_METADATA); var request = metadataStore.get('career');
      var headStore = tx.objectStore(STORE_PLAYER_HEADS); var headRequest = headStore.getAll();
      var currentMetadata; var currentHeads;
      function publish() {
        if (!currentMetadata || !currentHeads) return;
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
    var migration = await initializeDatabase(db, saved || {}, options || {});
    if (!migration.ok) { db.close(); throw new Error(migration.reason); }
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
          var versionRead = db.transaction([STORE_METADATA], 'readonly');
          var versionMetadata = await requestPromise(versionRead.objectStore(STORE_METADATA).get('career'));
          await transactionPromise(versionRead);
          if (versionMetadata.aggregateSchemaVersion === Aggregator.AGGREGATE_SCHEMA_VERSION) { aggregateInitialized = true; return; }
          var read = db.transaction([STORE_METADATA, STORE_PLAYER_HEADS, STORE_RECORDS], 'readonly');
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
          var committed = await new Promise(function (resolve, reject) {
            var tx = db.transaction([STORE_METADATA, STORE_AGGREGATES], 'readwrite');
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
          });
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
    async function indexedPlayerHistory(playerId) {
      await ensurePlayerSummaries(); playerId = String(playerId);
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORE_RECORDS, STORE_PLAYER_HEADS], 'readonly'); var wrappers;
        var request = tx.objectStore(STORE_PLAYER_HEADS).get(playerId);
        request.onsuccess = function () { readIndexedPlayerHistory(tx, playerId, request.result, function (values) { wrappers = values; }); };
        tx.oncomplete = function () { resolve(wrappers); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Career player history read failed')); };
      });
    }
    var dashboardCache = new Map(); var trendCache = new Map(); var trendPending = new Map(); var trendGeneration = 0;
    function invalidateDashboardPlayers(playerIds) { (playerIds || []).map(String).forEach(function (playerId) { Array.from(dashboardCache.keys()).forEach(function (key) { if (key.indexOf(playerId + '|') === 0) dashboardCache.delete(key); }); Array.from(trendCache.keys()).forEach(function (key) { if (key.indexOf(playerId + '|') === 0) trendCache.delete(key); }); }); }
    async function append(record) {
      var error = Aggregator.validateRecord(record); if (error) return { accepted: false, duplicate: false, conflict: false, reason: error };
      await ensureContextAggregates();
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORE_RECORDS, STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readwrite');
        var recordsStore = tx.objectStore(STORE_RECORDS); var metadataStore = tx.objectStore(STORE_METADATA);
        var handRequest = recordsStore.index('handKey').getAll(record.handKey); var metaRequest = metadataStore.get('career');
        var handValues; var meta; var planned;
        function proceed() {
          if (!handValues || !meta || planned) return;
          planned = Aggregator.append(Aggregator.createState(handValues.map(function (wrapper) { return wrapper.record; })), record);
          if (!planned.accepted) return;
          meta.nextSequence += 1; meta.physicalRecordCount += 1; if (!planned.supersession) meta.activeRecordCount += 1;
          meta.latestAcceptedAt = record.finalizedAt;
          if (!meta.firstAcceptedHandKey) { meta.firstAcceptedHandKey = record.handKey; meta.firstAcceptedAt = record.finalizedAt; }
          recordsStore.add(recordWrapper(record, meta.nextSequence)); metadataStore.put(meta);
          var situations = Aggregator.careerSituationMap(record);
          record.players.forEach(function (entry) {
            var id = String(entry.playerId);
            // Queued after add(), so this reads the new physical record too.
            // Resolution and head publication share the append transaction.
            var headRequest = tx.objectStore(STORE_PLAYER_HEADS).get(id);
            headRequest.onsuccess = function () {
              var head = headRequest.result;
              var cacheRequest = tx.objectStore(STORE_AGGREGATES).get(id);
              cacheRequest.onsuccess = function () {
                var cache = cacheRequest.result;
                if (!planned.supersession && (!head || validCache(cache, head))) {
                  var nextPlayer = Aggregator.appendPlayer(cache && cache.player || null, record, entry, situations[id]);
                  tx.objectStore(STORE_PLAYER_HEADS).put(summaryHead(id, meta.nextSequence, nextPlayer, head && head.contextHandKeys));
                  tx.objectStore(STORE_AGGREGATES).put(cacheForPlayer(nextPlayer, meta.nextSequence, cache ? cache.physicalRecordCount + 1 : 1));
                  return;
                }
                readIndexedPlayerHistory(tx, id, head, function (wrappers) {
                  var result = playerFromRecords(wrappers.map(function (wrapper) { return wrapper.record; }), id);
                  tx.objectStore(STORE_PLAYER_HEADS).put(summaryHead(id, meta.nextSequence, result.player, head && head.contextHandKeys));
                  if (result.player) tx.objectStore(STORE_AGGREGATES).put(cacheForPlayer(result.player, meta.nextSequence, result.physicalRecordCount));
                  else tx.objectStore(STORE_AGGREGATES).delete(id);
                });
              };
            };
          });
        }
        handRequest.onsuccess = function () { handValues = handRequest.result || []; proceed(); };
        metaRequest.onsuccess = function () { meta = metaRequest.result; if (!meta) { tx.abort(); reject(new Error('Career metadata is missing')); return; } proceed(); };
        handRequest.onerror = metaRequest.onerror = function () { tx.abort(); };
        tx.oncomplete = function () { if (planned && planned.accepted) invalidateDashboardPlayers(record.players.map(function (entry) { return entry.playerId; })); resolve(planned || { accepted: false, duplicate: false, conflict: false, reason: 'append did not run' }); };
        tx.onerror = function () { reject(tx.error || new Error('Career append transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('Career append transaction aborted')); };
      });
    }
    async function stats(playerId) {
      await ensureContextAggregates();
      playerId = String(playerId);
      var tx = db.transaction([STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readonly');
      var pair = await Promise.all([requestPromise(tx.objectStore(STORE_AGGREGATES).get(playerId)), requestPromise(tx.objectStore(STORE_PLAYER_HEADS).get(playerId))]);
      await transactionPromise(tx);
      var cache = pair[0]; var head = pair[1]; if (!head) return null;
      if (validCache(cache, head)) return Aggregator.derivePlayer(cache.player);
      var wrappers = await indexedPlayerHistory(playerId);
      var result = playerFromRecords(wrappers.map(function (wrapper) { return wrapper.record; }), playerId);
      if (result.player) {
        var write = db.transaction([STORE_AGGREGATES], 'readwrite');
        var exactPlayer = clone(result.player); delete exactPlayer.derived;
        write.objectStore(STORE_AGGREGATES).put(cacheForPlayer(exactPlayer, head.revision, result.physicalRecordCount));
        await transactionPromise(write);
      }
      return result.player;
    }
    async function statsDiagnostic(playerId) {
      await ensurePlayerSummaries();
      playerId = String(playerId);
      var tx = db.transaction([STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readonly');
      var pair = await Promise.all([requestPromise(tx.objectStore(STORE_AGGREGATES).get(playerId)), requestPromise(tx.objectStore(STORE_PLAYER_HEADS).get(playerId))]);
      await transactionPromise(tx);
      var cacheHit = validCache(pair[0], pair[1]);
      return { player: await stats(playerId), cacheHit: cacheHit, rebuiltFromPlayerIndex: Boolean(pair[1] && !cacheHit) };
    }
    async function careerHudStats(playerIds) {
      await ensureContextAggregates();
      var requestedCount = Array.isArray(playerIds) ? playerIds.length : 0;
      var ids = normalizedPlayerIds(playerIds);
      var read = db.transaction([STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readonly');
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
        var wrappers = await indexedPlayerHistory(ids[index]);
        return playerFromRecords(wrappers.map(function (wrapper) { return wrapper.record; }), ids[index]);
      }));
      if (rebuilt.some(function (result) { return result.player; })) {
        var write = db.transaction([STORE_AGGREGATES], 'readwrite');
        rebuilt.forEach(function (result, rebuiltIndex) {
          if (!result.player) return;
          var index = staleIndexes[rebuiltIndex];
          var exactPlayer = clone(result.player); delete exactPlayer.derived;
          write.objectStore(STORE_AGGREGATES).put(cacheForPlayer(exactPlayer, pairs[index][1].revision, result.physicalRecordCount));
          players[index] = result.player;
        });
        await transactionPromise(write);
      }
      var byPlayerId = {};
      ids.forEach(function (playerId, index) { byPlayerId[playerId] = players[index] || null; });
      return { players: byPlayerId, query: { batched: true, requestedCount: requestedCount, uniquePlayerCount: ids.length, duplicatePlayerIdsRemoved: Math.max(0, requestedCount - ids.length), backend: 'indexeddb', runtimeMessages: 1, aggregateReadTransactions: 1, cacheHits: cacheHits, playerIndexLookups: staleIndexes.length, aggregateWriteTransactions: staleIndexes.length ? 1 : 0 } };
    }
    async function allRecords() { return (await idbGetAll(db, STORE_RECORDS)).map(function (wrapper) { return wrapper.record; }); }
    async function careerDashboardStats(playerId, requested) {
      await ensureContextAggregates();
      playerId = String(playerId); requested = requested || {};
      var scope = FilteredStats.normalizeFilters({ position: requested.position || null, situation: requested.situation || null, tableSize: requested.tableSize || null });
      var position = scope.position; var situation = scope.situation; var tableSize = scope.tableSize;
      var opponentMode = requested.opponentMode === 'self' || requested.opponentMode === 'others' ? requested.opponentMode : 'overall';
      var selfPlayerId = requested.selfPlayerId === null || requested.selfPlayerId === undefined ? null : String(requested.selfPlayerId);
      var read = db.transaction([STORE_AGGREGATES, STORE_PLAYER_HEADS, STORE_METADATA], 'readonly');
      var values = await Promise.all([
        requestPromise(read.objectStore(STORE_AGGREGATES).get(playerId)),
        requestPromise(read.objectStore(STORE_PLAYER_HEADS).get(playerId)),
        requestPromise(read.objectStore(STORE_METADATA).get('career'))
      ]);
      await transactionPromise(read);
      var aggregateCache = values[0]; var head = values[1] || null; var metadata = values[2] || {};
      var cacheKey = playerId + '|' + Number(head && head.revision || 0) + '|' + canonicalJson({ position: position, situation: situation, tableSize: tableSize, opponentMode: opponentMode, selfPlayerId: selfPlayerId });
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
        var wrappers = await indexedPlayerHistory(playerId); retrievals = 1;
        playerRecords = wrappers.map(function (wrapper) { return wrapper.record; });
      }
      if (!aggregateCacheUsed && head) {
        var rebuilt = playerFromRecords(playerRecords, playerId);
        if (rebuilt.player) {
          aggregateCache = cacheForPlayer(Object.assign({}, rebuilt.player, { derived: undefined }), head.revision, rebuilt.physicalRecordCount);
          var write = db.transaction([STORE_AGGREGATES], 'readwrite');
          write.objectStore(STORE_AGGREGATES).put(aggregateCache); await transactionPromise(write);
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
      var read = db.transaction([STORE_PLAYER_HEADS], 'readonly'); var head = await requestPromise(read.objectStore(STORE_PLAYER_HEADS).get(playerId)); await transactionPromise(read);
      var revision = Number(head && head.revision || 0); var cacheKey = playerId + '|' + revision;
      if (trendCache.has(cacheKey)) { var cached = cloneDashboard(trendCache.get(cacheKey)); cached.query.trendCacheHit = true; cached.query.trendRequestCoalesced = false; cached.query.playerRecordRetrievals = 0; return cached; }
      if (trendPending.has(cacheKey)) return trendPending.get(cacheKey).then(function (value) { var shared = cloneDashboard(value); shared.query.trendCacheHit = true; shared.query.trendRequestCoalesced = true; shared.query.playerRecordRetrievals = 0; return shared; });
      var generation = trendGeneration;
      var operation = (async function () {
        var wrappers = head ? await indexedPlayerHistory(playerId) : [];
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
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORE_RECORDS, STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readwrite');
        var recordStore = tx.objectStore(STORE_RECORDS); var metadataStore = tx.objectStore(STORE_METADATA);
        var aggregateStore = tx.objectStore(STORE_AGGREGATES); var headStore = tx.objectStore(STORE_PLAYER_HEADS);
        recordStore.clear(); metadataStore.clear(); aggregateStore.clear(); headStore.clear();
        replacement.wrappers.forEach(function (wrapper) { recordStore.add(wrapper); });
        replacement.caches.forEach(function (cache) { aggregateStore.add(cache); });
        replacement.heads.forEach(function (head) { headStore.add(head); });
        metadataStore.add(replacement.metadata);
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
        verifyRecords.onsuccess = function () { restoredWrappers = verifyRecords.result || []; verify(); };
        verifyMetadata.onsuccess = function () { restoredMetadata = verifyMetadata.result || null; verify(); };
        verifyHeads.onsuccess = function () { restoredHeads = verifyHeads.result || []; verify(); };
        tx.oncomplete = function () { if (!verified) { reject(new Error('career mutation verification did not complete')); return; } dashboardCache.clear(); trendCache.clear(); trendPending.clear(); trendGeneration += 1; summaryError = null; resolve({ replaced: mutationMode === 'replace', merged: mutationMode === 'merge', metadata: clone(replacement.metadata), aggregate: clone(replacement.resolved.aggregate) }); };
        tx.onerror = function () { reject(tx.error || new Error('career mutation transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('career mutation transaction aborted; previous career remains intact')); };
      });
    }
    async function mergeCareerRecords(nextRecords, career, mergeOptions) {
      var currentWrappers = await idbGetAll(db, STORE_RECORDS);
      var currentRecords = currentWrappers.map(function (wrapper) { return wrapper.record; });
      if (!mergePreservesExisting(currentRecords, nextRecords)) throw new Error('Career merge cannot remove or alter existing physical records');
      var replacement = replacementPlan(nextRecords, career, Object.assign({}, mergeOptions || {}, { mode: 'merge' }));
      if (!replacement.ok) throw new Error(replacement.reason);
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORE_RECORDS, STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readwrite');
        var recordStore = tx.objectStore(STORE_RECORDS); var metadataStore = tx.objectStore(STORE_METADATA);
        var aggregateStore = tx.objectStore(STORE_AGGREGATES); var headStore = tx.objectStore(STORE_PLAYER_HEADS);
        replacement.wrappers.forEach(function (wrapper) { recordStore.put(wrapper); });
        aggregateStore.clear(); headStore.clear();
        replacement.caches.forEach(function (cache) { aggregateStore.add(cache); });
        replacement.heads.forEach(function (head) { headStore.add(head); });
        metadataStore.put(replacement.metadata);
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
        verifyRecords.onsuccess = function () { mergedWrappers = verifyRecords.result || []; verify(); };
        verifyMetadata.onsuccess = function () { mergedMetadata = verifyMetadata.result || null; verify(); };
        verifyHeads.onsuccess = function () { mergedHeads = verifyHeads.result || []; verify(); };
        tx.oncomplete = function () {
          if (!verified) { reject(new Error('Career merge verification did not complete')); return; }
          dashboardCache.clear(); trendCache.clear(); trendPending.clear(); trendGeneration += 1; summaryError = null;
          resolve({ replaced: false, merged: true, metadata: clone(replacement.metadata), aggregate: clone(replacement.resolved.aggregate) });
        };
        tx.onerror = function () { reject(tx.error || new Error('Career merge transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('Career merge transaction aborted; previous Career history remains intact')); };
      });
    }
    async function removeCareerHandKeys(handKeys, expectedFingerprints) {
      var read = db.transaction([STORE_RECORDS, STORE_METADATA], 'readonly');
      var snapshot = await Promise.all([requestPromise(read.objectStore(STORE_RECORDS).getAll()), requestPromise(read.objectStore(STORE_METADATA).get('career'))]);
      await transactionPromise(read);
      var mutation = affectedProjectionPlan(snapshot[0] || [], snapshot[1] || {}, handKeys);
      requireExpectedPhysicalDeletion(mutation, expectedFingerprints);
      if (!mutation.removed.length) return { removed: false, logicalHandCount: 0, physicalRecordCount: 0, affectedPlayerIds: [], metadata: clone(snapshot[1] || {}) };
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORE_RECORDS, STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readwrite');
        var recordStore = tx.objectStore(STORE_RECORDS); var metadataStore = tx.objectStore(STORE_METADATA);
        var aggregateStore = tx.objectStore(STORE_AGGREGATES); var headStore = tx.objectStore(STORE_PLAYER_HEADS);
        try {
          mutation.removed.forEach(function (wrapper) { recordStore.delete(wrapper.record.fingerprint); });
          mutation.affectedPlayerIds.forEach(function (id) { aggregateStore.delete(id); headStore.delete(id); });
          mutation.caches.forEach(function (cache) { aggregateStore.put(cache); });
          mutation.heads.forEach(function (head) { headStore.put(head); });
          metadataStore.put(mutation.metadata);
        } catch (error) { tx.abort(); reject(error); return; }
        var expectedHeads = new Map(mutation.heads.map(function (head) { return [head.playerId, head]; }));
        var countResult = null; var metadataResult = null; var headResults = new Map(); var verified = false;
        var countRequest = recordStore.count(); var metadataRequest = metadataStore.get('career');
        countRequest.onsuccess = function () { countResult = countRequest.result; verify(); };
        metadataRequest.onsuccess = function () { metadataResult = metadataRequest.result; verify(); };
        mutation.affectedPlayerIds.forEach(function (id) {
          var request = headStore.get(id);
          request.onsuccess = function () { headResults.set(id, request.result || null); verify(); };
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
        tx.onerror = function () { reject(tx.error || new Error('Career Session removal transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('Career Session removal transaction aborted; previous Career history remains intact')); };
      });
    }
    return {
      backend: 'indexeddb', migration: migration, append: append, careerStats: stats,
      careerStatsFiltered: async function (playerId, filters) { var wrappers = await indexedPlayerHistory(playerId); return FilteredStats.careerStatsFiltered(wrappers.map(function (wrapper) { return wrapper.record; }), playerId, filters); },
      careerDashboardStats: careerDashboardStats,
      careerTrendStats: careerTrendStats,
      careerHudStats: careerHudStats,
      careerPlayerSummaries: careerPlayerSummaries,
      careerStatsDiagnostic: statsDiagnostic,
      careerPlayers: async function () { var heads = await idbGetAll(db, STORE_PLAYER_HEADS); return Promise.all(heads.sort(function (a, b) { return a.playerId.localeCompare(b.playerId); }).map(function (head) { return stats(head.playerId); })); },
      careerLedgerInfo: async function () { var tx = db.transaction([STORE_METADATA, STORE_AGGREGATES, STORE_PLAYER_HEADS], 'readonly'); var values = await Promise.all([requestPromise(tx.objectStore(STORE_METADATA).get('career')), requestPromise(tx.objectStore(STORE_AGGREGATES).count()), requestPromise(tx.objectStore(STORE_PLAYER_HEADS).count())]); await transactionPromise(tx); return Object.assign(values[0] || {}, { ready: true, cacheEntryCount: values[1], playerCount: values[2], playerSummariesReady: Boolean(values[0] && values[0].playerSummaryVersion === PLAYER_SUMMARY_VERSION && summaryInitialized && !summaryError), playerSummaryBackfillRunning: Boolean(summaryWork), playerSummaryError: summaryError }); },
      careerPlayerRecordInfo: async function (playerId) { var wrappers = await indexedPlayerHistory(playerId); var resolution = Aggregator.rebuild(wrappers.map(function (wrapper) { return wrapper.record; })); return { playerId: String(playerId), physicalRecordCount: physicalRecordCountForPlayer(wrappers.map(function (wrapper) { return wrapper.record; }), playerId), activeRecordCount: physicalRecordCountForPlayer(resolution.activeRecords, playerId), rejectedRecords: resolution.rejectedRecords }; },
      recentCareerRecords: function (limit) {
        var maximum = Math.max(0, Math.min(20, Number(limit || 20)));
        return new Promise(function (resolve, reject) {
          var values = []; var tx = db.transaction([STORE_RECORDS], 'readonly');
          var request = tx.objectStore(STORE_RECORDS).index('finalizedAt').openCursor(null, 'prev');
          request.onsuccess = function () { var cursor = request.result; if (!cursor || values.length >= maximum) return; values.push(clone(cursor.value.record)); cursor.continue(); };
          request.onerror = function () { reject(request.error || new Error('Recent career record cursor failed')); };
          tx.oncomplete = function () { resolve(values); }; tx.onerror = function () { reject(tx.error || new Error('Recent career record transaction failed')); };
        });
      },
      listCareerSessions: async function () { return sessionSummaries(await allRecords()); },
      listCareerSessionsForPlayer: async function (playerId) { return sessionSummaries(await allRecords(), String(playerId)); },
      getCareerSession: async function (sessionId) { return sessionSummaries(await allRecords()).find(function (summary) { return summary.sessionId === sessionId; }) || null; },
      getCareerSessionRecords: async function (sessionId) { return sessionRecords(await allRecords(), String(sessionId)); },
      listCareerSessionPlayerSummaries: async function (playerId) { return listCareerSessionPlayerSummariesFromRecords(await allRecords(), playerId); },
      getCareerSessionPlayerStats: async function (sessionId, playerId, filters) { return careerSessionPlayerStatsFromRecords(await allRecords(), sessionId, playerId, filters); },
      getCareerRecentPlayerStats: async function (playerId, window, filters) { return careerRecentPlayerStatsFromRecords(await allRecords(), playerId, window, filters); },
      getCareerRecentVsCareer: async function (playerId, window, filters) { return careerRecentVsCareerFromRecords(await allRecords(), playerId, window, filters); },
      getCareerPlayerSessionTrend: async function (playerId, filters) { return careerPlayerSessionTrendFromRecords(await allRecords(), playerId, filters); },
      rebuildCareerStats: async function () { return Aggregator.rebuild(await allRecords()).aggregate; },
      exportCareer: async function () { var tx = db.transaction([STORE_METADATA, STORE_RECORDS], 'readonly'); var values = await Promise.all([requestPromise(tx.objectStore(STORE_METADATA).get('career')), requestPromise(tx.objectStore(STORE_RECORDS).getAll())]); await transactionPromise(tx); return serializableExport(values[0], values[1].map(function (wrapper) { return wrapper.record; })); },
      replaceCareerRecords: replaceCareerRecords,
      mergeCareerRecords: mergeCareerRecords,
      removeCareerHandKeys: removeCareerHandKeys,
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
      getCareerPlayerSessionTrend: function (playerId, filters) { return request('getCareerPlayerSessionTrend', [playerId, filters || {}]); },
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
    DATABASE_NAME: DATABASE_NAME, DATABASE_VERSION: DATABASE_VERSION, STORAGE_SCHEMA_VERSION: STORAGE_SCHEMA_VERSION, PLAYER_SUMMARY_VERSION: PLAYER_SUMMARY_VERSION,
    MIGRATION_MARKER_KEY: MIGRATION_MARKER_KEY, OUTBOX_PREFIX: OUTBOX_PREFIX, MESSAGE_TYPE: MESSAGE_TYPE, STORES: Object.freeze({ records: STORE_RECORDS, metadata: STORE_METADATA, aggregates: STORE_AGGREGATES, playerHeads: STORE_PLAYER_HEADS }),
    phaseOneRecords: phaseOneRecords, outboxKey: outboxKey, outboxRecords: outboxRecords, recordWrapper: recordWrapper, migrationPlan: migrationPlan, replacementPlan: replacementPlan, serializableExport: serializableExport, mergePreservesExisting: mergePreservesExisting, normalizedRemovalRequest: normalizedRemovalRequest, sessionRemovalPlan: sessionRemovalPlan, historicalSessionDeletionPlan: historicalSessionDeletionPlan, affectedProjectionPlan: affectedProjectionPlan,
    listCareerSessionPlayerSummariesFromRecords: listCareerSessionPlayerSummariesFromRecords, careerSessionPlayerStatsFromRecords: careerSessionPlayerStatsFromRecords,
    careerRecentPlayerStatsFromRecords: careerRecentPlayerStatsFromRecords, careerRecentVsCareerFromRecords: careerRecentVsCareerFromRecords,
    careerPlayerSessionTrendFromRecords: careerPlayerSessionTrendFromRecords,
    createMemoryService: createMemoryService, createIndexedService: createIndexedService, createMessageService: createMessageService, hasCompleteDatabase: hasCompleteDatabase
  });
});
