/* Pure deterministic aggregation and supersession for immutable PokerNow career records. */
(function (root, factory) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerCareerStatsAggregator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STORAGE_SCHEMA_VERSION = 2;
  var RECORD_SCHEMA_VERSION = 3;
  var SUPPORTED_RECORD_SCHEMA_VERSIONS = Object.freeze([1, 2, 3]);
  var AGGREGATE_SCHEMA_VERSION = 2;
  var COUNTER_FIELDS = Object.freeze([
    'hands', 'vpipMade', 'vpipOpportunities', 'pfrMade', 'pfrOpportunities',
    'postflopAggressiveActions', 'postflopCalls', 'threeBetMade', 'threeBetOpportunities',
    'foldToThreeBet', 'foldToThreeBetOpportunities', 'flopCBetMade', 'flopCBetOpportunities',
    'foldToFlopCBet', 'foldToFlopCBetOpportunities', 'wtsdMade', 'wtsdOpportunities',
    'wsdMade', 'wsdOpportunities'
  ]);
  var SEMANTIC_VERSION_FIELDS = Object.freeze(['core', 'preflop', 'flopCBet', 'showdown', 'sourceLedger']);
  var CURRENT_SEMANTIC_VERSIONS = Object.freeze({ core: 1, preflop: 2, flopCBet: 1, showdown: 1, sourceLedger: 1 });
  var POSITION_SCHEMA_VERSION = 1;
  var POSITION_LABELS = Object.freeze(['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO']);
  /* Exact-delta records from these versions can coexist. Unknown versions remain quarantined. */
  var SUPPORTED_SEMANTIC_VERSIONS = Object.freeze({
    core: Object.freeze([1, 2]), preflop: Object.freeze([1, 2, 3]), flopCBet: Object.freeze([1, 2]),
    showdown: Object.freeze([1, 2]), sourceLedger: Object.freeze([1, 2])
  });

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function object(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
  function integer(value) { return Number.isInteger(value) && value >= 0; }
  function emptyCounters() { return COUNTER_FIELDS.reduce(function (result, field) { result[field] = 0; return result; }, {}); }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!object(value)) return value;
    return Object.keys(value).sort().reduce(function (result, key) {
      if (value[key] !== undefined) result[key] = canonical(value[key]);
      return result;
    }, {});
  }
  function fingerprintInput(value) {
    var input = clone(value);
    if (input && input.recordType === 'certified-career-hand') {
      delete input.fingerprint;
      delete input.finalizedAt;
      delete input.lifecycleHandIds;
      (input.players || []).forEach(function (player) { delete player.displayName; delete player.sourceContributionIds; });
    }
    return input;
  }
  function fingerprint(value) {
    var text = JSON.stringify(canonical(fingerprintInput(value)));
    var first = 2166136261;
    var second = 2246822519;
    for (var index = 0; index < text.length; index += 1) {
      first ^= text.charCodeAt(index); first = Math.imul(first, 16777619);
      second ^= text.charCodeAt(index) + index; second = Math.imul(second, 3266489917);
    }
    return ('00000000' + (first >>> 0).toString(16)).slice(-8) + ('00000000' + (second >>> 0).toString(16)).slice(-8);
  }
  function percentage(made, opportunities) { return opportunities > 0 ? Math.round((made / opportunities) * 1000) / 10 : null; }
  function afValue(aggressive, calls) {
    if (calls === 0) return aggressive > 0 ? Infinity : 0;
    return Math.round((aggressive / calls) * 100) / 100;
  }
  function versionKey(record) { return SEMANTIC_VERSION_FIELDS.map(function (field) { return field + ':' + record.semanticVersions[field]; }).join('|'); }
  function playerIds(record) { return (record.players || []).map(function (entry) { return String(entry.playerId); }).sort(); }
  function samePlayers(left, right) { return JSON.stringify(playerIds(left)) === JSON.stringify(playerIds(right)); }

  function validateSemanticVersions(versions) {
    if (!object(versions)) return 'semanticVersions are required';
    var unsupported = SEMANTIC_VERSION_FIELDS.find(function (field) {
      return !SUPPORTED_SEMANTIC_VERSIONS[field] || SUPPORTED_SEMANTIC_VERSIONS[field].indexOf(versions[field]) < 0;
    });
    return unsupported ? 'unsupported semantic version for ' + unsupported : null;
  }
  function validateRecord(record) {
    if (!object(record)) return 'record must be an object';
    if (SUPPORTED_RECORD_SCHEMA_VERSIONS.indexOf(record.schemaVersion) < 0) return 'unsupported career record schema version';
    if (record.recordType !== 'certified-career-hand') return 'unsupported career record type';
    if (!record.handKey || !record.authoritativeHandId) return 'canonical hand identity is required';
    if (!object(record.namespace) || record.namespace.provider !== 'pokernow' || !record.namespace.host || !record.namespace.gameId) return 'canonical PokerNow namespace is required';
    var semanticError = validateSemanticVersions(record.semanticVersions);
    if (semanticError) return semanticError;
    if (record.supersedesFingerprint !== null && record.supersedesFingerprint !== undefined && typeof record.supersedesFingerprint !== 'string') return 'supersedesFingerprint must be null or a fingerprint';
    if (record.supersedesFingerprint && record.supersedesFingerprint === record.fingerprint) return 'self-supersession is forbidden';
    if (!Array.isArray(record.players) || !record.players.length) return 'at least one player contribution is required';
    var ids = new Set();
    var recordIds = new Set(record.players.map(function (player) { return player && player.playerId !== undefined && player.playerId !== null ? String(player.playerId) : ''; }).filter(Boolean));
    for (var index = 0; index < record.players.length; index += 1) {
      var player = record.players[index];
      if (!object(player) || !player.playerId) return 'stable player ID is required';
      if (ids.has(String(player.playerId))) return 'duplicate stable player ID in hand record';
      ids.add(String(player.playerId));
      if (!object(player.counters)) return 'exact player counters are required';
      var invalidCounter = COUNTER_FIELDS.find(function (field) { return !integer(player.counters[field]); });
      if (invalidCounter) return 'invalid counter ' + invalidCounter;
      var pairs = [['vpipMade', 'vpipOpportunities'], ['pfrMade', 'pfrOpportunities'], ['threeBetMade', 'threeBetOpportunities'], ['foldToThreeBet', 'foldToThreeBetOpportunities'], ['flopCBetMade', 'flopCBetOpportunities'], ['foldToFlopCBet', 'foldToFlopCBetOpportunities'], ['wtsdMade', 'wtsdOpportunities'], ['wsdMade', 'wsdOpportunities']];
      var invalidPair = pairs.find(function (pair) { return player.counters[pair[0]] > player.counters[pair[1]]; });
      if (invalidPair) return invalidPair[0] + ' exceeds its opportunity counter';
      if (record.schemaVersion >= 2) {
        if (!object(player.relational) || player.relational.schemaVersion !== 1) return 'relational provenance v1 is required for career record schema v2';
        var nullableIds = ['threeBetTargetPlayerId', 'foldToThreeBetAggressorPlayerId', 'foldToFlopCBetAggressorPlayerId'];
        var invalidRelationId = nullableIds.find(function (field) { var value = player.relational[field]; return value !== null && (typeof value !== 'string' || !value || !recordIds.has(String(value)) || String(value) === String(player.playerId)); });
        if (invalidRelationId) return 'invalid relational stable player ID for ' + invalidRelationId;
        if (!Array.isArray(player.relational.flopCBetOpponentPlayerIds) || player.relational.flopCBetOpponentPlayerIds.some(function (id) { return typeof id !== 'string' || !id || !recordIds.has(String(id)) || String(id) === String(player.playerId); })) return 'invalid flop CBet opponent stable player IDs';
      }
      if (record.schemaVersion >= 3) {
        if (!object(player.position) || player.position.schemaVersion !== POSITION_SCHEMA_VERSION) return 'position provenance v1 is required for career record schema v3';
        if (['supported', 'unsupported'].indexOf(player.position.status) < 0) return 'invalid position provenance status';
        if (player.position.dealtPlayerCount !== null && (!Number.isInteger(player.position.dealtPlayerCount) || player.position.dealtPlayerCount < 2 || player.position.dealtPlayerCount > 9)) return 'invalid dealt player count';
        if (player.position.status === 'supported') {
          if (POSITION_LABELS.indexOf(player.position.dealtPosition) < 0 || player.position.dealtPlayerCount === null || player.position.unsupportedReason !== null) return 'invalid supported position provenance';
        } else if (player.position.dealtPosition !== null || (player.position.unsupportedReason !== null && typeof player.position.unsupportedReason !== 'string')) return 'invalid unsupported position provenance';
      }
    }
    if (record.fingerprint !== fingerprint(record)) return 'record fingerprint mismatch';
    return null;
  }
  function validateTransition(predecessor, successor) {
    if (predecessor.handKey !== successor.handKey) return 'cross-hand supersession is forbidden';
    if (!samePlayers(predecessor, successor)) return 'cross-player supersession is forbidden';
    var increased = false;
    for (var index = 0; index < SEMANTIC_VERSION_FIELDS.length; index += 1) {
      var field = SEMANTIC_VERSION_FIELDS[index];
      if (successor.semanticVersions[field] < predecessor.semanticVersions[field]) return 'semantic version regression for ' + field;
      if (successor.semanticVersions[field] > predecessor.semanticVersions[field]) increased = true;
    }
    return increased ? null : 'superseding record must advance a semantic version';
  }

  function resolveActiveRecords(candidates) {
    var rejectedRecords = [];
    var physical = [];
    var byFingerprint = new Map();
    (candidates || []).forEach(function (candidate) {
      var record = clone(candidate);
      var error = validateRecord(record);
      if (error) { rejectedRecords.push({ handKey: record && record.handKey || null, fingerprint: record && record.fingerprint || null, reason: error }); return; }
      if (byFingerprint.has(record.fingerprint)) { rejectedRecords.push({ handKey: record.handKey, fingerprint: record.fingerprint, reason: 'duplicate physical record' }); return; }
      byFingerprint.set(record.fingerprint, record); physical.push(record);
    });
    var groups = new Map();
    physical.forEach(function (record) { if (!groups.has(record.handKey)) groups.set(record.handKey, []); groups.get(record.handKey).push(record); });
    var activeRecords = [];
    var quarantinedHandKeys = [];
    groups.forEach(function (group, handKey) {
      var roots = group.filter(function (record) { return !record.supersedesFingerprint; });
      var successors = new Map();
      var failure = null;
      group.forEach(function (record) {
        if (failure || !record.supersedesFingerprint) return;
        var predecessor = byFingerprint.get(record.supersedesFingerprint);
        if (!predecessor) { failure = 'missing supersession predecessor'; return; }
        var transitionError = validateTransition(predecessor, record);
        if (transitionError) { failure = transitionError; return; }
        if (successors.has(predecessor.fingerprint)) { failure = 'competing supersession successors are forbidden'; return; }
        successors.set(predecessor.fingerprint, record);
      });
      if (!failure && roots.length !== 1) failure = 'supersession chain requires exactly one root';
      var tips = group.filter(function (record) { return !successors.has(record.fingerprint); });
      if (!failure && tips.length !== 1) failure = 'supersession chain requires exactly one active tip';
      if (!failure) {
        var visited = new Set();
        var cursor = tips[0];
        while (cursor) {
          if (visited.has(cursor.fingerprint)) { failure = 'supersession cycle detected'; break; }
          visited.add(cursor.fingerprint);
          cursor = cursor.supersedesFingerprint ? byFingerprint.get(cursor.supersedesFingerprint) : null;
        }
        if (!failure && visited.size !== group.length) failure = 'disconnected supersession chain';
      }
      if (failure) {
        quarantinedHandKeys.push(handKey);
        rejectedRecords.push({ handKey: handKey, fingerprint: null, reason: failure });
      } else activeRecords.push(tips[0]);
    });
    activeRecords.sort(function (left, right) { return left.handKey.localeCompare(right.handKey); });
    physical.sort(function (left, right) { return left.handKey.localeCompare(right.handKey) || left.fingerprint.localeCompare(right.fingerprint); });
    return { physicalRecords: physical, activeRecords: activeRecords, rejectedRecords: rejectedRecords, quarantinedHandKeys: quarantinedHandKeys };
  }

  function emptyAggregate() { return { schemaVersion: AGGREGATE_SCHEMA_VERSION, ledgerRecordCount: 0, physicalRecordCount: 0, quarantinedHandCount: 0, players: {}, semanticVersionCoverage: {} }; }
  function addRecord(aggregate, record) {
    record.players.forEach(function (entry) {
      var playerId = String(entry.playerId);
      var player = aggregate.players[playerId];
      if (!player) player = aggregate.players[playerId] = { playerId: playerId, latestDisplayName: '', lastSeenAt: 0, recordCount: 0, counters: emptyCounters(), positionCoverage: { trackedHands: 0, earliestTrackedAt: null } };
      if (entry.displayName && Number(record.finalizedAt || 0) >= player.lastSeenAt) player.latestDisplayName = String(entry.displayName);
      player.lastSeenAt = Math.max(player.lastSeenAt, Number(record.finalizedAt || 0));
      player.recordCount += 1;
      COUNTER_FIELDS.forEach(function (field) { player.counters[field] += entry.counters[field]; });
      if (entry.position && entry.position.status === 'supported' && entry.position.dealtPosition) {
        player.positionCoverage.trackedHands += Number(entry.counters.hands || 0);
        player.positionCoverage.earliestTrackedAt = player.positionCoverage.earliestTrackedAt === null
          ? Number(record.finalizedAt || 0)
          : Math.min(player.positionCoverage.earliestTrackedAt, Number(record.finalizedAt || 0));
      }
    });
    aggregate.ledgerRecordCount += 1;
    var key = versionKey(record);
    aggregate.semanticVersionCoverage[key] = (aggregate.semanticVersionCoverage[key] || 0) + 1;
  }
  function rebuild(records) {
    var resolved = resolveActiveRecords(records || []);
    var aggregate = emptyAggregate();
    resolved.activeRecords.forEach(function (record) { addRecord(aggregate, record); });
    aggregate.physicalRecordCount = resolved.physicalRecords.length;
    aggregate.quarantinedHandCount = resolved.quarantinedHandKeys.length;
    return { aggregate: aggregate, acceptedRecords: resolved.physicalRecords, activeRecords: resolved.activeRecords, rejectedRecords: resolved.rejectedRecords, quarantinedHandKeys: resolved.quarantinedHandKeys };
  }
  function createState(records) {
    var rebuilt = rebuild(records || []);
    var byFingerprint = new Map(); var byHand = new Map(); var activeByHand = new Map();
    rebuilt.acceptedRecords.forEach(function (record) { byFingerprint.set(record.fingerprint, record); if (!byHand.has(record.handKey)) byHand.set(record.handKey, []); byHand.get(record.handKey).push(record); });
    rebuilt.activeRecords.forEach(function (record) { activeByHand.set(record.handKey, record); });
    return { byFingerprint: byFingerprint, byHand: byHand, activeByHand: activeByHand, aggregate: rebuilt.aggregate, rejectedRecords: rebuilt.rejectedRecords.slice(), appendSequence: 0 };
  }
  function append(state, candidate) {
    if (!state || !(state.byFingerprint instanceof Map)) throw new TypeError('career aggregator state is required');
    var record = clone(candidate); var error = validateRecord(record);
    if (error) return { accepted: false, duplicate: false, conflict: false, reason: error };
    if (state.byFingerprint.has(record.fingerprint)) return { accepted: false, duplicate: true, conflict: false, reason: 'duplicate physical record' };
    var group = state.byHand.get(record.handKey) || [];
    if (!group.length && record.supersedesFingerprint) return { accepted: false, duplicate: false, conflict: true, reason: state.byFingerprint.has(record.supersedesFingerprint) ? 'cross-hand supersession is forbidden' : 'missing supersession predecessor' };
    if (group.length) {
      if (!record.supersedesFingerprint) return { accepted: false, duplicate: false, conflict: true, reason: 'conflicting duplicate hand key requires explicit supersession' };
      var predecessor = state.byFingerprint.get(record.supersedesFingerprint);
      if (!predecessor) return { accepted: false, duplicate: false, conflict: true, reason: 'missing supersession predecessor' };
      error = validateTransition(predecessor, record);
      if (error) return { accepted: false, duplicate: false, conflict: true, reason: error };
      if (group.some(function (entry) { return entry.supersedesFingerprint === predecessor.fingerprint; })) return { accepted: false, duplicate: false, conflict: true, reason: 'competing supersession successors are forbidden' };
      if (state.activeByHand.get(record.handKey).fingerprint !== predecessor.fingerprint) return { accepted: false, duplicate: false, conflict: true, reason: 'supersession predecessor is not the active chain tip' };
    }
    var nextRecords = group.concat([record]);
    var resolved = resolveActiveRecords(nextRecords);
    if (resolved.quarantinedHandKeys.length) return { accepted: false, duplicate: false, conflict: true, reason: resolved.rejectedRecords[resolved.rejectedRecords.length - 1].reason };
    state.byFingerprint.set(record.fingerprint, record); state.byHand.set(record.handKey, nextRecords); state.activeByHand.set(record.handKey, record);
    /* Supersession is rare: rebuild guarantees exact presentation metadata and version coverage. */
    if (group.length) {
      state.aggregate = rebuild(Array.from(state.byFingerprint.values())).aggregate;
    } else { addRecord(state.aggregate, record); state.aggregate.physicalRecordCount = state.byFingerprint.size; }
    state.appendSequence += 1;
    return { accepted: true, duplicate: false, conflict: false, supersession: group.length > 0, handKey: record.handKey, record: clone(record) };
  }
  function exactAggregate(state) { return clone(state.aggregate); }
  function records(state) { return Array.from(state.byFingerprint.values()).map(clone); }
  function activeRecords(state) { return Array.from(state.activeByHand.values()).map(clone); }
  function derivePlayer(player) {
    if (!player) return null;
    var result = clone(player); var c = result.counters;
    result.derived = deriveCounters(c);
    return result;
  }
  function deriveCounters(counters) {
    var c = counters || emptyCounters();
    return { vpip: percentage(c.vpipMade, c.vpipOpportunities), pfr: percentage(c.pfrMade, c.pfrOpportunities), af: afValue(c.postflopAggressiveActions, c.postflopCalls), threeBet: percentage(c.threeBetMade, c.threeBetOpportunities), foldToThreeBet: percentage(c.foldToThreeBet, c.foldToThreeBetOpportunities), flopCBet: percentage(c.flopCBetMade, c.flopCBetOpportunities), foldToFlopCBet: percentage(c.foldToFlopCBet, c.foldToFlopCBetOpportunities), wtsd: percentage(c.wtsdMade, c.wtsdOpportunities), wsd: percentage(c.wsdMade, c.wsdOpportunities) };
  }
  function playerStats(state, playerId) { return derivePlayer(state && state.aggregate && state.aggregate.players[String(playerId)]); }
  function playerList(state) { return Object.keys(state.aggregate.players).sort().map(function (playerId) { return playerStats(state, playerId); }); }

  return Object.freeze({
    STORAGE_SCHEMA_VERSION: STORAGE_SCHEMA_VERSION, RECORD_SCHEMA_VERSION: RECORD_SCHEMA_VERSION, SUPPORTED_RECORD_SCHEMA_VERSIONS: SUPPORTED_RECORD_SCHEMA_VERSIONS, AGGREGATE_SCHEMA_VERSION: AGGREGATE_SCHEMA_VERSION,
    CURRENT_SEMANTIC_VERSIONS: CURRENT_SEMANTIC_VERSIONS, SUPPORTED_SEMANTIC_VERSIONS: SUPPORTED_SEMANTIC_VERSIONS,
    POSITION_SCHEMA_VERSION: POSITION_SCHEMA_VERSION, POSITION_LABELS: POSITION_LABELS,
    SEMANTIC_VERSION_FIELDS: SEMANTIC_VERSION_FIELDS, COUNTER_FIELDS: COUNTER_FIELDS, emptyCounters: emptyCounters,
    fingerprint: fingerprint, validateRecord: validateRecord, validateTransition: validateTransition, resolveActiveRecords: resolveActiveRecords,
    rebuild: rebuild, createState: createState, append: append, exactAggregate: exactAggregate, records: records, activeRecords: activeRecords,
    deriveCounters: deriveCounters, derivePlayer: derivePlayer, playerStats: playerStats, playerList: playerList
  });
});
