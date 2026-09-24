/* Canonical, human-inspectable career backup creation and validation. */
(function (root, factory) {
  'use strict';
  var aggregator = root.PokerCareerStatsAggregator;
  if (typeof module !== 'undefined' && module.exports) aggregator = require('./careerStatsAggregator.js');
  var api = factory(aggregator, root.crypto);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerCareerBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Aggregator, defaultCrypto) {
  'use strict';

  var FORMAT = 'pokernow-hud-career-backup';
  var FORMAT_VERSION = 1;
  var DIGEST_ALGORITHM = 'SHA-256';
  var TOP_LEVEL_KEYS = ['aggregateSchemaVersion', 'backupFormat', 'backupFormatVersion', 'careerMetadata', 'careerStorageSchemaVersion', 'integrity', 'recordSchemaVersion', 'records', 'semanticVersionPolicy'];
  var CAREER_KEYS = ['careerSchemaInitializedAt', 'careerTrackingStartedAt', 'firstAcceptedAt', 'firstAcceptedHandKey', 'initializedByBuildId', 'latestAcceptedAt'];
  var RECORD_KEYS = ['authoritativeHandId', 'finalizedAt', 'fingerprint', 'handKey', 'lifecycleHandIds', 'namespace', 'players', 'recordType', 'schemaVersion', 'semanticVersions', 'supersedesFingerprint'];
  var PLAYER_KEYS = ['counters', 'decisions', 'displayName', 'playerId', 'sourceContributionIds'];
  var PLAYER_KEYS_V2 = PLAYER_KEYS.concat(['relational']);
  var PLAYER_KEYS_V3 = PLAYER_KEYS_V2.concat(['position']);
  var DECISION_KEYS = ['threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd'];

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function object(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!object(value)) return value;
    return Object.keys(value).sort().reduce(function (result, key) {
      if (value[key] !== undefined) result[key] = canonical(value[key]);
      return result;
    }, {});
  }
  function canonicalStringify(value) { return JSON.stringify(canonical(value)); }
  function fail(message) { var error = new TypeError(message); error.code = 'CAREER_BACKUP_INVALID'; throw error; }
  function exactKeys(value, expected, label) {
    if (!object(value)) fail(label + ' must be an object');
    var actual = Object.keys(value).sort(); var wanted = expected.slice().sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(label + ' fields are incomplete or unsupported');
  }
  function nonnegativeInteger(value, label) { if (!Number.isInteger(value) || value < 0) fail(label + ' must be a nonnegative integer'); }
  function nullableInteger(value, label) { if (value !== null) nonnegativeInteger(value, label); }
  function validStableId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 500 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value); }
  function normalizedPolicy() {
    return {
      current: clone(Aggregator.CURRENT_SEMANTIC_VERSIONS),
      supported: clone(Aggregator.SUPPORTED_SEMANTIC_VERSIONS)
    };
  }
  async function sha256(text, cryptoImplementation) {
    var implementation = cryptoImplementation || defaultCrypto || (typeof crypto !== 'undefined' ? crypto : null);
    if (!implementation || !implementation.subtle || typeof TextEncoder === 'undefined') fail('SHA-256 support is unavailable');
    var digest = await implementation.subtle.digest(DIGEST_ALGORITHM, new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map(function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
  }
  function careerMetadata(metadata) {
    metadata = metadata || {};
    return {
      careerTrackingStartedAt: metadata.careerTrackingStartedAt === undefined ? null : metadata.careerTrackingStartedAt,
      careerSchemaInitializedAt: metadata.careerSchemaInitializedAt === undefined ? null : metadata.careerSchemaInitializedAt,
      initializedByBuildId: String(metadata.initializedByBuildId || ''),
      firstAcceptedHandKey: metadata.firstAcceptedHandKey === undefined ? null : metadata.firstAcceptedHandKey,
      firstAcceptedAt: metadata.firstAcceptedAt === undefined ? null : metadata.firstAcceptedAt,
      latestAcceptedAt: metadata.latestAcceptedAt === undefined ? null : metadata.latestAcceptedAt
    };
  }
  function validateDecision(decision, label) {
    exactKeys(decision, ['opportunity', 'result', 'unsupportedReason'], label);
    if ([0, 1, null].indexOf(decision.opportunity) < 0 || [0, 1, null].indexOf(decision.result) < 0) fail(label + ' has an invalid tri-state value');
    if (decision.unsupportedReason !== null && typeof decision.unsupportedReason !== 'string') fail(label + ' unsupportedReason must be null or a string');
  }
  function validateCompleteRecord(record, index) {
    var label = 'records[' + index + ']';
    exactKeys(record, RECORD_KEYS, label);
    exactKeys(record.namespace, ['gameId', 'host', 'provider'], label + '.namespace');
    exactKeys(record.semanticVersions, Aggregator.SEMANTIC_VERSION_FIELDS, label + '.semanticVersions');
    var error = Aggregator.validateRecord(record); if (error) fail(label + ': ' + error);
    if (typeof record.authoritativeHandId !== 'string' || !record.authoritativeHandId) fail(label + ' authoritativeHandId must be a string');
    var expectedHandKey = ['pokernow', record.namespace.host, record.namespace.gameId, record.authoritativeHandId].join('|');
    if (record.handKey !== expectedHandKey) fail(label + ' logical hand key does not match its namespace');
    if (record.namespace.host !== String(record.namespace.host).toLowerCase()) fail(label + ' namespace host must be canonical lowercase');
    if (!Array.isArray(record.lifecycleHandIds) || record.lifecycleHandIds.some(function (value) { return typeof value !== 'string'; })) fail(label + ' lifecycleHandIds must be a string array');
    nonnegativeInteger(record.finalizedAt, label + '.finalizedAt');
    record.players.forEach(function (player, playerIndex) {
      var playerLabel = label + '.players[' + playerIndex + ']';
      exactKeys(player, record.schemaVersion >= 3 ? PLAYER_KEYS_V3 : record.schemaVersion >= 2 ? PLAYER_KEYS_V2 : PLAYER_KEYS, playerLabel);
      if (!validStableId(player.playerId)) fail(playerLabel + ' stable player ID is malformed');
      if (typeof player.displayName !== 'string') fail(playerLabel + ' displayName is required presentation metadata');
      exactKeys(player.sourceContributionIds, ['flopCBet', 'preflop', 'showdown'], playerLabel + '.sourceContributionIds');
      Object.keys(player.sourceContributionIds).forEach(function (key) { var value = player.sourceContributionIds[key]; if (value !== null && typeof value !== 'string') fail(playerLabel + '.sourceContributionIds.' + key + ' must be null or a string'); });
      exactKeys(player.decisions, DECISION_KEYS, playerLabel + '.decisions');
      exactKeys(player.counters, Aggregator.COUNTER_FIELDS, playerLabel + '.counters');
      DECISION_KEYS.forEach(function (key) { validateDecision(player.decisions[key], playerLabel + '.decisions.' + key); });
      if (record.schemaVersion >= 2) {
        exactKeys(player.relational, ['flopCBetOpponentPlayerIds', 'foldToFlopCBetAggressorPlayerId', 'foldToThreeBetAggressorPlayerId', 'schemaVersion', 'threeBetTargetPlayerId'], playerLabel + '.relational');
        if (player.relational.schemaVersion !== 1) fail(playerLabel + '.relational schema version is unsupported');
      }
      if (record.schemaVersion >= 3) {
        exactKeys(player.position, ['dealtPlayerCount', 'dealtPosition', 'schemaVersion', 'status', 'unsupportedReason'], playerLabel + '.position');
        if (player.position.schemaVersion !== 1) fail(playerLabel + '.position schema version is unsupported');
      }
    });
  }
  function payloadFor(exported) {
    var records = (exported.records || []).map(clone).sort(function (left, right) { return left.handKey.localeCompare(right.handKey) || left.fingerprint.localeCompare(right.fingerprint); });
    return {
      backupFormat: FORMAT,
      backupFormatVersion: FORMAT_VERSION,
      careerStorageSchemaVersion: Number(exported.careerStorageSchemaVersion),
      recordSchemaVersion: Number(exported.recordSchemaVersion),
      aggregateSchemaVersion: Number(exported.aggregateSchemaVersion),
      semanticVersionPolicy: normalizedPolicy(),
      careerMetadata: careerMetadata(exported.metadata),
      records: records
    };
  }
  async function createBackup(exported, cryptoImplementation) {
    if (!object(exported)) fail('career export is required');
    var payload = payloadFor(exported);
    var resolution = validatePayload(payload);
    var digest = await sha256(canonicalStringify(payload), cryptoImplementation);
    return Object.assign(payload, { integrity: {
      algorithm: DIGEST_ALGORITHM,
      payloadDigest: digest,
      physicalRecordCount: payload.records.length,
      activeRecordCount: resolution.activeRecords.length,
      playerCount: Object.keys(resolution.aggregate.players).length
    } });
  }
  async function digestCareerExport(exported, cryptoImplementation) {
    if (!object(exported)) fail('career export is required');
    return sha256(canonicalStringify(exported), cryptoImplementation);
  }
  function validatePayload(payload) {
    if (payload.backupFormat !== FORMAT) fail('unsupported career backup format');
    if (payload.backupFormatVersion !== FORMAT_VERSION) fail('unsupported career backup format version');
    if (payload.careerStorageSchemaVersion !== Aggregator.STORAGE_SCHEMA_VERSION) fail('unsupported career storage schema version');
    if (Aggregator.SUPPORTED_RECORD_SCHEMA_VERSIONS.indexOf(payload.recordSchemaVersion) < 0) fail('unsupported career record schema version');
    if (payload.aggregateSchemaVersion !== Aggregator.AGGREGATE_SCHEMA_VERSION) fail('unsupported career aggregate schema version');
    if (canonicalStringify(payload.semanticVersionPolicy) !== canonicalStringify(normalizedPolicy())) fail('unsupported semantic version policy');
    exactKeys(payload.careerMetadata, CAREER_KEYS, 'careerMetadata');
    var metadata = payload.careerMetadata;
    nonnegativeInteger(metadata.careerTrackingStartedAt, 'careerTrackingStartedAt');
    nonnegativeInteger(metadata.careerSchemaInitializedAt, 'careerSchemaInitializedAt');
    nullableInteger(metadata.firstAcceptedAt, 'firstAcceptedAt');
    nullableInteger(metadata.latestAcceptedAt, 'latestAcceptedAt');
    if (typeof metadata.initializedByBuildId !== 'string') fail('initializedByBuildId must be a string');
    if (metadata.firstAcceptedHandKey !== null && typeof metadata.firstAcceptedHandKey !== 'string') fail('firstAcceptedHandKey must be null or a string');
    if (!Array.isArray(payload.records)) fail('records must be an array');
    payload.records.forEach(validateCompleteRecord);
    var canonicalRecords = payload.records.slice().sort(function (left, right) { return left.handKey.localeCompare(right.handKey) || left.fingerprint.localeCompare(right.fingerprint); });
    if (canonicalRecords.some(function (record, index) { return record.fingerprint !== payload.records[index].fingerprint; })) fail('records are not in canonical order');
    var fingerprints = new Set();
    payload.records.forEach(function (record) { if (fingerprints.has(record.fingerprint)) fail('duplicate physical fingerprint'); fingerprints.add(record.fingerprint); });
    var resolution = Aggregator.rebuild(payload.records);
    if (resolution.rejectedRecords.length || resolution.acceptedRecords.length !== payload.records.length || resolution.quarantinedHandKeys.length) fail('backup supersession graph is invalid: ' + (resolution.rejectedRecords[0] && resolution.rejectedRecords[0].reason || 'record rejection'));
    if (payload.records.length) {
      if (!metadata.firstAcceptedHandKey || !resolution.acceptedRecords.some(function (record) { return record.handKey === metadata.firstAcceptedHandKey; })) fail('firstAcceptedHandKey is missing from the career history');
      if (metadata.firstAcceptedAt === null || metadata.latestAcceptedAt === null) fail('accepted career timestamps are required');
      if (metadata.firstAcceptedAt < metadata.careerTrackingStartedAt) fail('first accepted hand cannot predate the career tracking boundary');
    } else if (metadata.firstAcceptedHandKey !== null || metadata.firstAcceptedAt !== null || metadata.latestAcceptedAt !== null) fail('empty career metadata cannot claim accepted hands');
    return resolution;
  }
  async function validateBackup(input, cryptoImplementation) {
    var backup;
    try { backup = typeof input === 'string' ? JSON.parse(input) : clone(input); } catch (_error) { fail('career backup JSON is malformed'); }
    exactKeys(backup, TOP_LEVEL_KEYS, 'career backup');
    exactKeys(backup.integrity, ['activeRecordCount', 'algorithm', 'payloadDigest', 'physicalRecordCount', 'playerCount'], 'integrity');
    if (backup.integrity.algorithm !== DIGEST_ALGORITHM || !/^[a-f0-9]{64}$/.test(backup.integrity.payloadDigest)) fail('backup integrity metadata is invalid');
    var payload = clone(backup); delete payload.integrity;
    nonnegativeInteger(backup.integrity.physicalRecordCount, 'integrity.physicalRecordCount');
    nonnegativeInteger(backup.integrity.activeRecordCount, 'integrity.activeRecordCount');
    nonnegativeInteger(backup.integrity.playerCount, 'integrity.playerCount');
    var resolution = validatePayload(payload);
    var digest = await sha256(canonicalStringify(payload), cryptoImplementation);
    if (digest !== backup.integrity.payloadDigest) fail('backup payload digest mismatch');
    if (backup.integrity.physicalRecordCount !== payload.records.length || backup.integrity.activeRecordCount !== resolution.activeRecords.length || backup.integrity.playerCount !== Object.keys(resolution.aggregate.players).length) fail('backup integrity counts do not match its records');
    return {
      backup: backup,
      records: payload.records.map(clone),
      careerMetadata: clone(payload.careerMetadata),
      aggregate: clone(resolution.aggregate),
      activeRecords: resolution.activeRecords.map(clone),
      summary: {
        backupFormatVersion: FORMAT_VERSION,
        payloadDigest: digest,
        physicalRecordCount: payload.records.length,
        activeRecordCount: resolution.activeRecords.length,
        playerCount: Object.keys(resolution.aggregate.players).length,
        firstAcceptedAt: payload.careerMetadata.firstAcceptedAt,
        latestAcceptedAt: payload.careerMetadata.latestAcceptedAt,
        players: Object.keys(resolution.aggregate.players).sort().map(function (id) {
          var player = resolution.aggregate.players[id];
          return { playerId: id, displayName: player.latestDisplayName, hands: player.counters.hands };
        }),
        careerTrackingStartedAt: payload.careerMetadata.careerTrackingStartedAt,
        firstAcceptedHandKey: payload.careerMetadata.firstAcceptedHandKey
      }
    };
  }

  function logicalHandKeys(records) {
    return new Set((records || []).map(function (record) { return String(record.handKey); }));
  }
  function playerIds(records) {
    var ids = new Set();
    (records || []).forEach(function (record) { (record.players || []).forEach(function (player) { ids.add(String(player.playerId)); }); });
    return Array.from(ids).sort();
  }
  function mergedCareerMetadata(current, imported, currentHasRecords, importedHasRecords) {
    if (!currentHasRecords) return clone(imported);
    if (!importedHasRecords) return clone(current);
    var firstCandidates = [current, imported].slice().sort(function (left, right) {
      return Number(left.firstAcceptedAt) - Number(right.firstAcceptedAt) || String(left.firstAcceptedHandKey).localeCompare(String(right.firstAcceptedHandKey));
    });
    var initializationCandidates = [current, imported].slice().sort(function (left, right) {
      return Number(left.careerSchemaInitializedAt) - Number(right.careerSchemaInitializedAt) || String(left.initializedByBuildId).localeCompare(String(right.initializedByBuildId));
    });
    return {
      careerTrackingStartedAt: Math.min(Number(current.careerTrackingStartedAt), Number(imported.careerTrackingStartedAt)),
      careerSchemaInitializedAt: Math.min(Number(current.careerSchemaInitializedAt), Number(imported.careerSchemaInitializedAt)),
      initializedByBuildId: String(initializationCandidates[0].initializedByBuildId || ''),
      firstAcceptedHandKey: firstCandidates[0].firstAcceptedHandKey,
      firstAcceptedAt: firstCandidates[0].firstAcceptedAt,
      latestAcceptedAt: Math.max(Number(current.latestAcceptedAt), Number(imported.latestAcceptedAt))
    };
  }
  function mergeValidatedBackups(current, imported) {
    if (!object(current) || !Array.isArray(current.records) || !object(current.careerMetadata)) fail('current career snapshot is invalid');
    if (!object(imported) || !Array.isArray(imported.records) || !object(imported.careerMetadata)) fail('imported career snapshot is invalid');
    var localByFingerprint = new Map(current.records.map(function (record) { return [record.fingerprint, record]; }));
    var union = current.records.map(clone); var duplicatePhysicalRecordCount = 0; var fingerprintConflicts = [];
    imported.records.forEach(function (record) {
      var local = localByFingerprint.get(record.fingerprint);
      if (!local) { union.push(clone(record)); return; }
      if (canonicalStringify(local) !== canonicalStringify(record)) fingerprintConflicts.push(record.fingerprint);
      else duplicatePhysicalRecordCount += 1;
    });
    union.sort(function (left, right) { return left.handKey.localeCompare(right.handKey) || left.fingerprint.localeCompare(right.fingerprint); });
    var resolved = fingerprintConflicts.length ? null : Aggregator.rebuild(union);
    var rejected = resolved ? resolved.rejectedRecords.slice() : [];
    var conflictKeys = new Set(fingerprintConflicts.map(function (fingerprint) { return 'fingerprint:' + fingerprint; }));
    if (resolved) {
      resolved.quarantinedHandKeys.forEach(function (handKey) { conflictKeys.add(String(handKey)); });
      rejected.forEach(function (entry) { conflictKeys.add(String(entry.handKey || 'fingerprint:' + (entry.fingerprint || 'unknown'))); });
    }
    var currentKeys = logicalHandKeys(current.records); var importedKeys = logicalHandKeys(imported.records);
    var alreadyPresent = Array.from(importedKeys).filter(function (handKey) { return currentKeys.has(handKey); }).length;
    var changedHandKeys = logicalHandKeys(imported.records.filter(function (record) { return !localByFingerprint.has(record.fingerprint); }));
    var affectedPlayerIds = playerIds(union.filter(function (record) { return changedHandKeys.has(record.handKey); }));
    var summary = {
      importedLogicalHandCount: importedKeys.size,
      importedPhysicalRecordCount: imported.records.length,
      alreadyPresentLogicalHandCount: alreadyPresent,
      newLogicalHandCount: importedKeys.size - alreadyPresent,
      exactDuplicatePhysicalRecordCount: duplicatePhysicalRecordCount,
      newPhysicalRecordCount: imported.records.length - duplicatePhysicalRecordCount,
      conflictedLogicalHandCount: conflictKeys.size,
      affectedPlayerCount: affectedPlayerIds.length,
      affectedPlayerIds: affectedPlayerIds,
      mergedLogicalHandCount: new Set(union.map(function (record) { return String(record.handKey); })).size,
      mergedPhysicalRecordCount: union.length,
      sessionAffected: false
    };
    if (fingerprintConflicts.length || !resolved || rejected.length || resolved.acceptedRecords.length !== union.length || resolved.quarantinedHandKeys.length) {
      return { ok: false, reason: 'Career import conflicts with the current authoritative record graph and cannot be merged safely', summary: summary, rejectedRecords: rejected, quarantinedHandKeys: resolved ? resolved.quarantinedHandKeys.slice() : [], fingerprintConflicts: fingerprintConflicts.slice() };
    }
    return {
      ok: true,
      records: union,
      careerMetadata: mergedCareerMetadata(current.careerMetadata, imported.careerMetadata, current.records.length > 0, imported.records.length > 0),
      aggregate: clone(resolved.aggregate),
      activeRecords: resolved.activeRecords.map(clone),
      summary: summary,
      rejectedRecords: [], quarantinedHandKeys: [], fingerprintConflicts: []
    };
  }

  return Object.freeze({
    FORMAT: FORMAT, FORMAT_VERSION: FORMAT_VERSION, DIGEST_ALGORITHM: DIGEST_ALGORITHM,
    canonicalStringify: canonicalStringify,
    digestCareerExport: digestCareerExport,
    createBackup: createBackup,
    validateBackup: validateBackup,
    mergeValidatedBackups: mergeValidatedBackups
  });
});
