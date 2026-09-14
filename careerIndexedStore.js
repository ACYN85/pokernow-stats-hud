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
  function cacheForPlayer(player, revision, physicalRecordCount) {
    return { playerId: player.playerId, aggregateSchemaVersion: Aggregator.AGGREGATE_SCHEMA_VERSION, revision: Number(revision || 0), physicalRecordCount: Math.max(0, Number(physicalRecordCount === undefined ? player.recordCount : physicalRecordCount)), player: clone(player) };
  }
  function validCache(cache, head) {
    var profile = cache && cache.player && cache.player.profileProjection;
    if (!cache || !head || cache.playerId !== head.playerId || cache.revision !== head.revision || cache.aggregateSchemaVersion !== Aggregator.AGGREGATE_SCHEMA_VERSION || !cache.player || !cache.player.counters || !cache.player.positionCoverage || !profile || profile.version !== Aggregator.PROFILE_PROJECTION_VERSION || !profile.counters || !profile.profileContext || profile.profileContext.version !== Aggregator.PROFILE_CONTEXT_VERSION || !Number.isInteger(cache.physicalRecordCount)) return false;
    if (!Aggregator.COUNTER_FIELDS.every(function (field) { return Number.isInteger(profile.counters[field]) && profile.counters[field] >= 0; })) return false;
    return Aggregator.COUNTER_FIELDS.every(function (field) { return Number.isInteger(cache.player.counters[field]) && cache.player.counters[field] >= 0; });
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
  function unfilteredResultFromCache(cache) {
    if (!cache || !cache.player) return null;
    var player = cache.player;
    var counters = clone(player.counters);
    var tracked = Number(player.positionCoverage && player.positionCoverage.trackedHands || 0);
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
        earliestRelationalTrackedAt: null, activeRecordCount: Number(player.recordCount || 0),
        physicalRecordCount: Number(cache.physicalRecordCount || 0), excludedUnsupportedPositionRecords: 0,
        excludedMissingCounterpartRecords: 0
      }
    };
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
    var ordered = (records || []).map(clone).sort(function (left, right) { return left.handKey.localeCompare(right.handKey) || left.fingerprint.localeCompare(right.fingerprint); });
    var resolved = Aggregator.rebuild(ordered);
    if (resolved.rejectedRecords.length || resolved.acceptedRecords.length !== ordered.length || resolved.quarantinedHandKeys.length) return { ok: false, reason: 'replacement records failed deterministic validation', resolved: resolved };
    var sequenceByFingerprint = {};
    ordered.forEach(function (record, index) { sequenceByFingerprint[record.fingerprint] = index + 1; });
    var maxRevisionByPlayer = {};
    resolved.activeRecords.forEach(function (record) { record.players.forEach(function (entry) { var id = String(entry.playerId); maxRevisionByPlayer[id] = Math.max(maxRevisionByPlayer[id] || 0, sequenceByFingerprint[record.fingerprint]); }); });
    var metadata = {
      key: 'career', storageSchemaVersion: STORAGE_SCHEMA_VERSION, databaseVersion: DATABASE_VERSION,
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
      restore: { mode: 'replace', backupFormatVersion: Number(options.backupFormatVersion || 1), payloadDigest: String(options.payloadDigest || ''), restoredAt: restoredAt },
      playerSummaryVersion: PLAYER_SUMMARY_VERSION,
      backend: 'extension-service-worker-indexeddb'
    };
    return {
      ok: true, metadata: metadata, resolved: resolved,
      wrappers: ordered.map(function (record) { return recordWrapper(record, sequenceByFingerprint[record.fingerprint]); }),
      heads: Object.keys(resolved.aggregate.players).sort().map(function (playerId) { return summaryHead(playerId, maxRevisionByPlayer[playerId], resolved.aggregate.players[playerId]); }),
      caches: Object.keys(resolved.aggregate.players).sort().map(function (playerId) { return cacheForPlayer(resolved.aggregate.players[playerId], maxRevisionByPlayer[playerId] || 0, physicalRecordCountForPlayer(ordered, playerId)); })
    };
  }
  function serializableExport(metadata, records) {
    return {
      exportSchemaVersion: 1,
      careerStorageSchemaVersion: STORAGE_SCHEMA_VERSION,
      recordSchemaVersion: Aggregator.RECORD_SCHEMA_VERSION,
      aggregateSchemaVersion: Aggregator.AGGREGATE_SCHEMA_VERSION,
      metadata: clone(metadata),
      records: records.map(clone).sort(function (left, right) { return left.handKey.localeCompare(right.handKey) || left.fingerprint.localeCompare(right.fingerprint); })
    };
  }
  function normalizedPlayerIds(values) {
    return Array.from(new Set((Array.isArray(values) ? values : []).map(function (value) { return String(value || '').trim(); }).filter(Boolean))).slice(0, 64);
  }

  function createMemoryService(saved, options) {
    var plan = migrationPlan(saved || {}, options || {});
    var records = new Map(); var heads = new Map(); var caches = new Map(); var queue = Promise.resolve();
    var dashboardCache = new Map(); var trendCache = new Map(); var trendPending = new Map(); var trendGeneration = 0; var dashboardDiagnostics = { playerRecordRetrievals: 0, cacheHits: 0, cacheMisses: 0, trendCacheHits: 0, trendCacheMisses: 0 };
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
    function recordsForHand(handKey) { return Array.from(records.values()).filter(function (wrapper) { return wrapper.record.handKey === handKey; }).map(function (wrapper) { return clone(wrapper.record); }); }
    function recordsForPlayer(playerId) {
      dashboardDiagnostics.playerRecordRetrievals += 1;
      var head = heads.get(String(playerId)); var context = new Set(head && head.contextHandKeys || []);
      return Array.from(records.values()).filter(function (wrapper) { return wrapper.playerIds.indexOf(String(playerId)) >= 0 || context.has(wrapper.record.handKey); }).map(function (wrapper) { return clone(wrapper.record); });
    }
    function invalidateDashboardPlayers(playerIds) { (playerIds || []).map(String).forEach(function (playerId) { Array.from(dashboardCache.keys()).forEach(function (key) { if (key.indexOf(playerId + '|') === 0) dashboardCache.delete(key); }); Array.from(trendCache.keys()).forEach(function (key) { if (key.indexOf(playerId + '|') === 0) trendCache.delete(key); }); }); }
    async function stats(playerId) {
      await ensurePlayerSummaries();
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
        var state = Aggregator.createState(recordsForHand(record.handKey));
        var result = Aggregator.append(state, record);
        if (!result.accepted) return result;
        var updatedHeads = record.players.map(function (entry) {
          var id = String(entry.playerId);
          return summaryHead(id, metadata.nextSequence + 1, playerFromRecords(recordsForPlayer(id).concat([record]), id).player, heads.get(id) && heads.get(id).contextHandKeys);
        });
        metadata.nextSequence += 1;
        records.set(record.fingerprint, recordWrapper(record, metadata.nextSequence));
        metadata.physicalRecordCount += 1;
        if (!result.supersession) metadata.activeRecordCount += 1;
        metadata.latestAcceptedAt = record.finalizedAt;
        if (!metadata.firstAcceptedHandKey) { metadata.firstAcceptedHandKey = record.handKey; metadata.firstAcceptedAt = record.finalizedAt; }
        updatedHeads.forEach(function (head) { heads.set(head.playerId, head); caches.delete(head.playerId); });
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
      var operation = queue.then(function () {
        records.clear(); heads.clear(); caches.clear(); dashboardCache.clear(); trendCache.clear(); trendPending.clear(); trendGeneration += 1;
        replacement.wrappers.forEach(function (wrapper) { records.set(wrapper.record.fingerprint, wrapper); });
        replacement.heads.forEach(function (head) { heads.set(head.playerId, head); });
        replacement.caches.forEach(function (cache) { caches.set(cache.playerId, cache); });
        Object.keys(metadata).forEach(function (key) { delete metadata[key]; }); Object.assign(metadata, clone(replacement.metadata));
        summaryError = null;
        return { replaced: true, metadata: clone(metadata), aggregate: clone(replacement.resolved.aggregate) };
      });
      queue = operation.catch(function () {});
      return operation;
    }
    async function careerDashboardStats(playerId, requested) {
      await ensurePlayerSummaries();
      playerId = String(playerId); requested = requested || {};
      var head = heads.get(playerId) || null;
      var scope = FilteredStats.normalizeFilters({ position: requested.position || null, situation: requested.situation || null });
      var position = scope.position; var situation = scope.situation;
      var opponentMode = requested.opponentMode === 'self' || requested.opponentMode === 'others' ? requested.opponentMode : 'overall';
      var selfPlayerId = requested.selfPlayerId === null || requested.selfPlayerId === undefined ? null : String(requested.selfPlayerId);
      var cacheKey = playerId + '|' + Number(head && head.revision || 0) + '|' + canonicalJson({ position: position, situation: situation, opponentMode: opponentMode, selfPlayerId: selfPlayerId });
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
      var hasScope = Boolean(position || situation);
      var needsRecords = Boolean(hasScope || opponentMode !== 'overall' || !aggregateCacheUsed);
      var playerRecords = needsRecords ? recordsForPlayer(playerId) : null;
      if (!aggregateCacheUsed && playerRecords) {
        var rebuilt = playerFromRecords(playerRecords, playerId);
        if (rebuilt.player && head) { aggregateCache = cacheForPlayer(Object.assign({}, rebuilt.player, { derived: undefined }), head.revision, rebuilt.physicalRecordCount); caches.set(playerId, aggregateCache); }
      }
      var relationalStatIds = opponentMode !== 'overall' ? ['threeBet', 'foldToThreeBet', 'foldToFlopCBet'] : [];
      var filters = hasScope ? [{ position: position, situation: situation }] : [];
      relationalStatIds.forEach(function (statId) {
        filters.push({ position: position, situation: situation, statId: statId, counterpartMode: opponentMode, selfPlayerId: selfPlayerId });
      });
      var filteredResults = FilteredStats.careerStatsFilteredBatch(playerRecords || [], playerId, filters);
      var core = hasScope ? filteredResults[0] : unfilteredResultFromCache(aggregateCache);
      var relational = {};
      relationalStatIds.forEach(function (statId, index) {
        relational[statId] = filteredResults[index + (hasScope ? 1 : 0)];
      });
      var result = {
        core: core, relational: relational, profileStats: aggregateCache && clone(aggregateCache.player.profileProjection) || null, careerTrackingStartedAt: metadata.careerTrackingStartedAt,
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
      rebuildCareerStats: function () { return rebuild().then(function (result) { return result.aggregate; }); },
      exportCareer: function () { return Promise.resolve(serializableExport(metadata, allRecords())); },
      replaceCareerRecords: replaceCareerRecords,
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
    var summaryWork = null; var summaryError = null; var summaryInitialized = false;
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
      await ensurePlayerSummaries();
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
          record.players.forEach(function (entry) {
            var id = String(entry.playerId);
            // Queued after add(), so this reads the new physical record too.
            // Resolution and head publication share the append transaction.
            var headRequest = tx.objectStore(STORE_PLAYER_HEADS).get(id);
            headRequest.onsuccess = function () {
              var head = headRequest.result;
              readIndexedPlayerHistory(tx, id, head, function (wrappers) {
                var result = playerFromRecords(wrappers.map(function (wrapper) { return wrapper.record; }), id);
                tx.objectStore(STORE_PLAYER_HEADS).put(summaryHead(id, meta.nextSequence, result.player, head && head.contextHandKeys));
              });
            };
            tx.objectStore(STORE_AGGREGATES).delete(id);
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
      await ensurePlayerSummaries();
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
      await ensurePlayerSummaries();
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
      await ensurePlayerSummaries();
      playerId = String(playerId); requested = requested || {};
      var scope = FilteredStats.normalizeFilters({ position: requested.position || null, situation: requested.situation || null });
      var position = scope.position; var situation = scope.situation;
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
      var cacheKey = playerId + '|' + Number(head && head.revision || 0) + '|' + canonicalJson({ position: position, situation: situation, opponentMode: opponentMode, selfPlayerId: selfPlayerId });
      if (dashboardCache.has(cacheKey)) {
        var cached = cloneDashboard(dashboardCache.get(cacheKey));
        cached.query.dashboardCacheHit = true; cached.query.playerRecordRetrievals = 0;
        return cached;
      }
      var aggregateCacheUsed = Boolean(validCache(aggregateCache, head));
      var hasScope = Boolean(position || situation);
      var needsRecords = Boolean(hasScope || opponentMode !== 'overall' || !aggregateCacheUsed);
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
      var filters = hasScope ? [{ position: position, situation: situation }] : [];
      relationalStatIds.forEach(function (statId) {
        filters.push({ position: position, situation: situation, statId: statId, counterpartMode: opponentMode, selfPlayerId: selfPlayerId });
      });
      var filteredResults = FilteredStats.careerStatsFilteredBatch(playerRecords, playerId, filters);
      var core = hasScope ? filteredResults[0] : unfilteredResultFromCache(aggregateCache);
      var relational = {};
      relationalStatIds.forEach(function (statId, index) {
        relational[statId] = filteredResults[index + (hasScope ? 1 : 0)];
      });
      var result = { core: core, relational: relational, profileStats: aggregateCache && clone(aggregateCache.player.profileProjection) || null, careerTrackingStartedAt: metadata.careerTrackingStartedAt || null, query: { playerRevision: Number(head && head.revision || 0), aggregateCacheUsed: aggregateCacheUsed, dashboardCacheHit: false, playerRecordRetrievals: retrievals } };
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
        tx.oncomplete = function () { if (!verified) { reject(new Error('career replacement verification did not complete')); return; } dashboardCache.clear(); trendCache.clear(); trendPending.clear(); trendGeneration += 1; summaryError = null; resolve({ replaced: true, metadata: clone(replacement.metadata), aggregate: clone(replacement.resolved.aggregate) }); };
        tx.onerror = function () { reject(tx.error || new Error('career replacement transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('career replacement transaction aborted; previous career remains intact')); };
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
      rebuildCareerStats: async function () { return Aggregator.rebuild(await allRecords()).aggregate; },
      exportCareer: async function () { var tx = db.transaction([STORE_METADATA, STORE_RECORDS], 'readonly'); var values = await Promise.all([requestPromise(tx.objectStore(STORE_METADATA).get('career')), requestPromise(tx.objectStore(STORE_RECORDS).getAll())]); await transactionPromise(tx); return serializableExport(values[0], values[1].map(function (wrapper) { return wrapper.record; })); },
      replaceCareerRecords: replaceCareerRecords,
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
      rebuildCareerStats: function () { return request('rebuildCareerStats'); },
      exportCareer: function () { return request('exportCareer'); },
      exportCareerBackup: function () { return request('exportCareerBackup'); },
      validateCareerBackup: function (backup) { return request('validateCareerBackup', [backup]); },
      prepareCareerRestore: function (backup) { return request('prepareCareerRestore', [backup]); },
      replaceCareerBackup: function (backup, confirmation) { return request('replaceCareerBackup', [backup, confirmation]); },
      careerRuntimeTimings: function (playerId) { return request('careerRuntimeTimings', [playerId === undefined ? null : String(playerId)]); }
    };
  }

  return Object.freeze({
    DATABASE_NAME: DATABASE_NAME, DATABASE_VERSION: DATABASE_VERSION, STORAGE_SCHEMA_VERSION: STORAGE_SCHEMA_VERSION, PLAYER_SUMMARY_VERSION: PLAYER_SUMMARY_VERSION,
    MIGRATION_MARKER_KEY: MIGRATION_MARKER_KEY, OUTBOX_PREFIX: OUTBOX_PREFIX, MESSAGE_TYPE: MESSAGE_TYPE, STORES: Object.freeze({ records: STORE_RECORDS, metadata: STORE_METADATA, aggregates: STORE_AGGREGATES, playerHeads: STORE_PLAYER_HEADS }),
    phaseOneRecords: phaseOneRecords, outboxKey: outboxKey, outboxRecords: outboxRecords, recordWrapper: recordWrapper, migrationPlan: migrationPlan, replacementPlan: replacementPlan, serializableExport: serializableExport,
    createMemoryService: createMemoryService, createIndexedService: createIndexedService, createMessageService: createMessageService, hasCompleteDatabase: hasCompleteDatabase
  });
});
