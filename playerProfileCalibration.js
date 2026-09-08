/* Pure, read-only player-profile calibration and historical-session helpers. */
(function (root) {
  'use strict';

  var SCHEMA_VERSION = 4;
  var MAX_CALIBRATION_PLAYERS = 200;
  var MAX_UNSUPPORTED_PLAYERS = 200;
  var LIVE_PREFIX = 'pokerNowHudLiveEvents:game:';
  var PLAYER_MAP_PREFIX = 'pokerNowHudPlayerMap:game:';
  var META_PREFIX = 'pokerNowHudSessionMeta:game:';
  var SCHEMA_PREFIX = 'pokerNowHudLiveSchemaVersion:game:';

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function historicalPlaceholderIdentity(value) {
    if (value === null || value === undefined) return false;
    try { return /^gameplayer$/i.test(String(value).trim()); } catch (_error) { return false; }
  }

  function historicalPlayerIdentity(value) {
    if (value === null || value === undefined) return null;
    var playerId;
    try { playerId = String(value).trim(); } catch (_error) { return null; }
    if (!playerId || playerId.toLowerCase() === 'null' || playerId.toLowerCase() === 'undefined' || historicalPlaceholderIdentity(playerId)) return null;
    return playerId;
  }

  function explicitIdentity(record) {
    record = record && typeof record === 'object' ? record : {};
    var candidates = [record.stablePlayerId, record.authoritativePlayerId].map(historicalPlayerIdentity).filter(Boolean);
    candidates = Array.from(new Set(candidates));
    return candidates.length === 1
      ? { playerId: candidates[0], conflict: false }
      : { playerId: null, conflict: candidates.length > 1 };
  }

  function resolveHistoricalIdentity(value, exactRecord) {
    var direct = historicalPlayerIdentity(value);
    if (direct) return { playerId: direct, resolved: false, conflict: false };
    var exact = explicitIdentity(exactRecord);
    return { playerId: exact.playerId, resolved: Boolean(exact.playerId), conflict: exact.conflict };
  }

  function invalidObservedValue(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    try { return String(value).slice(0, 32); } catch (_error) { return 'unstringifiable'; }
  }

  function addUnsupported(target, diagnostic) {
    if (!diagnostic || target.length >= MAX_UNSUPPORTED_PLAYERS) return;
    var clean = {
      playerId: historicalPlayerIdentity(diagnostic.playerId),
      reason: String(diagnostic.reason || 'unsupported_historical_identity').slice(0, 120),
      source: String(diagnostic.source || 'historical_rebuild').slice(0, 80)
    };
    if (diagnostic.observedIdentity !== undefined) clean.observedIdentity = invalidObservedValue(diagnostic.observedIdentity);
    if (diagnostic.resolvedPlayerId !== undefined) clean.resolvedPlayerId = historicalPlayerIdentity(diagnostic.resolvedPlayerId);
    var signature = JSON.stringify(clean);
    if (!target.some(function (entry) { return JSON.stringify(entry) === signature; })) target.push(clean);
  }

  function readAllStorage(chromeApi) {
    return new Promise(function (resolve, reject) {
      var local = chromeApi && chromeApi.storage && chromeApi.storage.local;
      if (!local || typeof local.get !== 'function') {
        reject(new Error('extension local storage is unavailable'));
        return;
      }
      local.get(null, function (saved) {
        var storageError = chromeApi.runtime && chromeApi.runtime.lastError;
        if (storageError) {
          reject(new Error(storageError.message || String(storageError)));
          return;
        }
        resolve(saved && typeof saved === 'object' ? clone(saved) : {});
      });
    });
  }

  function decodeSessionKey(suffix) {
    try { return decodeURIComponent(String(suffix || '')); } catch (_error) { return String(suffix || ''); }
  }

  function lobbyId(sessionKey, meta) {
    if (meta && meta.gameId !== undefined && meta.gameId !== null) return String(meta.gameId);
    var separator = String(sessionKey || '').indexOf(':');
    return separator >= 0 ? String(sessionKey).slice(separator + 1) : String(sessionKey || '');
  }

  function eventTimestamp(event) {
    var value = event && event.timestamp;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      var numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
      var parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function sessionDescriptor(storageSnapshot, storageKey) {
    var suffix = String(storageKey).slice(LIVE_PREFIX.length);
    var sessionKey = decodeSessionKey(suffix);
    var events = storageSnapshot[storageKey];
    var playerMap = storageSnapshot[PLAYER_MAP_PREFIX + suffix];
    var meta = storageSnapshot[META_PREFIX + suffix];
    var timestamps = Array.isArray(events) ? events.map(eventTimestamp).filter(function (value) { return value !== null; }) : [];
    var playerIds = new Set();
    Object.keys(playerMap && typeof playerMap === 'object' && !Array.isArray(playerMap) ? playerMap : {}).forEach(function (playerId) {
      var value = playerMap[playerId];
      var resolved = resolveHistoricalIdentity(playerId, value && typeof value === 'object' ? value : null);
      if (resolved.playerId && !resolved.conflict) playerIds.add(resolved.playerId);
    });
    var handIds = new Set();
    if (Array.isArray(events)) {
      events.forEach(function (event) {
        var resolved = resolveHistoricalIdentity(event && event.playerId, event);
        if (resolved.playerId && !resolved.conflict) playerIds.add(resolved.playerId);
        if (event && event.handId !== undefined && event.handId !== null && String(event.handId)) handIds.add(String(event.handId));
      });
    }
    return {
      sessionKey: sessionKey,
      lobbyId: lobbyId(sessionKey, meta),
      eventCount: Array.isArray(events) ? events.length : 0,
      playerCount: playerIds.size,
      firstEventTime: timestamps.length ? Math.min.apply(Math, timestamps) : null,
      lastEventTime: timestamps.length ? Math.max.apply(Math, timestamps) : null,
      approximateHands: handIds.size,
      liveSchemaVersion: storageSnapshot[SCHEMA_PREFIX + suffix] === undefined ? null : storageSnapshot[SCHEMA_PREFIX + suffix],
      status: Array.isArray(events) ? (events.length ? 'available' : 'empty') : 'malformed_events'
    };
  }

  function discoverSessions(storageSnapshot) {
    storageSnapshot = storageSnapshot && typeof storageSnapshot === 'object' ? storageSnapshot : {};
    return Object.keys(storageSnapshot).filter(function (key) {
      return key.indexOf(LIVE_PREFIX) === 0;
    }).map(function (key) {
      return sessionDescriptor(storageSnapshot, key);
    }).sort(function (left, right) {
      var timeDelta = Number(right.lastEventTime || 0) - Number(left.lastEventTime || 0);
      return timeDelta || left.sessionKey.localeCompare(right.sessionKey);
    });
  }

  function suffixForSession(storageSnapshot, sessionKey) {
    var target = String(sessionKey || '');
    return Object.keys(storageSnapshot || {}).filter(function (key) { return key.indexOf(LIVE_PREFIX) === 0; }).map(function (key) {
      return key.slice(LIVE_PREFIX.length);
    }).find(function (suffix) { return decodeSessionKey(suffix) === target; }) || null;
  }

  function stableMappings(events, playerMap) {
    var candidates = new Map();
    var unsupportedPlayers = [];

    function addCandidate(playerIdValue, playerNameValue, source, exactRecord) {
      var resolution = resolveHistoricalIdentity(playerIdValue, exactRecord);
      if (resolution.conflict) {
        addUnsupported(unsupportedPlayers, { playerId: null, observedIdentity: playerIdValue, reason: 'conflicting_exact_identity_aliases', source: source });
        return;
      }
      if (!resolution.playerId) {
        addUnsupported(unsupportedPlayers, {
          playerId: null,
          observedIdentity: playerIdValue,
          reason: historicalPlaceholderIdentity(playerIdValue) ? 'historical_placeholder_identity' : 'invalid_player_identity',
          source: source
        });
        return;
      }
      var playerName = String(playerNameValue === undefined || playerNameValue === null ? '' : playerNameValue).trim();
      if (!playerName) {
        addUnsupported(unsupportedPlayers, { playerId: resolution.playerId, reason: 'missing_player_name', source: source });
        return;
      }
      if (!candidates.has(resolution.playerId)) candidates.set(resolution.playerId, { names: new Set(), sources: new Set() });
      candidates.get(resolution.playerId).names.add(playerName);
      candidates.get(resolution.playerId).sources.add(source);
    }

    Object.keys(playerMap && typeof playerMap === 'object' && !Array.isArray(playerMap) ? playerMap : {}).forEach(function (playerId) {
      var value = playerMap[playerId];
      var objectValue = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
      var playerName = objectValue ? (objectValue.playerName || objectValue.name || objectValue.displayName) : value;
      addCandidate(playerId, playerName, 'player_map', objectValue);
    });
    (events || []).forEach(function (event) {
      if (!event || typeof event !== 'object') return;
      addCandidate(event.playerId, event.player, 'authoritative_event', event);
    });

    var mappings = [];
    candidates.forEach(function (candidate, playerId) {
      if (candidate.names.size !== 1) {
        addUnsupported(unsupportedPlayers, { playerId: playerId, reason: 'conflicting_player_identity_data', source: Array.from(candidate.sources).sort().join('+') });
        return;
      }
      mappings.push([playerId, Array.from(candidate.names)[0]]);
    });
    mappings.sort(function (left, right) { return left[0].localeCompare(right[0]); });
    return { mappings: mappings.slice(0, MAX_CALIBRATION_PLAYERS), unsupportedPlayers: unsupportedPlayers.slice(0, MAX_UNSUPPORTED_PLAYERS) };
  }

  function rate(numerator, denominator) {
    numerator = Number(numerator || 0);
    denominator = Number(denominator || 0);
    return denominator > 0 ? numerator / denominator : null;
  }

  function calibrationRecord(record, sessionKey) {
    var playerId = historicalPlayerIdentity(record && record.playerId);
    if (!playerId) return null;
    var counters = clone(record.inputSummary || {});
    var features = clone(record.featureSummary || {});
    var stabilizedValues = {};
    Object.keys(features).forEach(function (name) { stabilizedValues[name] = features[name] ? features[name].stabilizedRate : null; });
    var afCalls = Number(counters.afCalls || 0);
    var afAggression = Number(counters.afBets || 0) + Number(counters.afRaises || 0);
    return {
      sessionKey: String(sessionKey || ''),
      playerId: playerId,
      hands: Number(record.hands || 0),
      authoritativeCounters: counters,
      rawRates: {
        vpip: rate(counters.vpipHands, counters.vpipOpportunities),
        pfr: rate(counters.pfrHands, counters.pfrOpportunities),
        aggressionFactor: afCalls > 0 ? afAggression / afCalls : (afAggression > 0 ? 'Infinity' : 0),
        threeBet: rate(counters.threeBetMade, counters.threeBetOpportunities),
        foldToThreeBet: rate(counters.foldToThreeBet, counters.foldToThreeBetOpportunities),
        flopCBet: rate(counters.flopCBetMade, counters.flopCBetOpportunities),
        foldToFlopCBet: rate(counters.foldToFlopCBet, counters.foldToFlopCBetOpportunities),
        wtsd: rate(counters.wentToShowdown, counters.sawFlopForWTSD),
        wsd: rate(counters.wonMoneyAtShowdown, counters.showdownsForWSD)
      },
      opportunityDenominators: {
        threeBet: Number(counters.threeBetOpportunities || 0),
        foldToThreeBet: Number(counters.foldToThreeBetOpportunities || 0),
        flopCBet: Number(counters.flopCBetOpportunities || 0),
        foldToFlopCBet: Number(counters.foldToFlopCBetOpportunities || 0),
        wtsd: Number(counters.sawFlopForWTSD || 0),
        wsd: Number(counters.showdownsForWSD || 0)
      },
      stabilizedValues: stabilizedValues,
      featureSupport: features,
      tableContext: clone(record.tableContext || null),
      primary: clone(record.primary || {}),
      tags: clone(record.tags || []),
      profileHistory: clone(record.history || []),
      classifierSchemaVersion: record.classifierSchemaVersion === undefined ? null : record.classifierSchemaVersion,
      shadowStoreSchemaVersion: record.shadowStoreSchemaVersion === undefined ? null : record.shadowStoreSchemaVersion
    };
  }

  function exportCalibration(records, sessionKey) {
    var seen = new Set();
    var exported = [];
    (records || []).forEach(function (record) {
      if (exported.length >= MAX_CALIBRATION_PLAYERS) return;
      var playerId = historicalPlayerIdentity(record && record.playerId);
      if (!playerId || seen.has(playerId)) return;
      var clean = calibrationRecord(record, sessionKey);
      if (!clean) return;
      seen.add(playerId);
      exported.push(clean);
    });
    return exported;
  }

  function handBucket(hands) {
    if (hands < 20) return '0-19';
    if (hands < 40) return '20-39';
    if (hands < 80) return '40-79';
    if (hands < 150) return '80-149';
    return '150+';
  }

  function calibrationSummary(profiles) {
    var summary = {
      totalPlayers: 0,
      playersByHands: { '0-19': 0, '20-39': 0, '40-79': 0, '80-149': 0, '150+': 0 },
      playersByArchetype: {},
      unknownInsufficient: 0,
      unknownUncertain: 0,
      opportunitySupport: {}
    };
    var opportunities = {
      threeBet: 'threeBetRate', foldToThreeBet: 'foldToThreeBetRate', flopCBet: 'flopCBetRate',
      foldToFlopCBet: 'foldToFlopCBetRate', wtsd: 'wtsdRate', wsd: 'wsdRate'
    };
    Object.keys(opportunities).forEach(function (name) {
      summary.opportunitySupport[name] = { supportedPlayers: 0, unsupportedPlayers: 0, playersWithOpportunities: 0, totalOpportunities: 0 };
    });
    var countedPlayerIds = new Set();
    (profiles || []).forEach(function (profile) {
      var playerId = historicalPlayerIdentity(profile && profile.playerId);
      var scopedPlayerId = String(profile && profile.sessionKey || '') + '\u0000' + String(playerId || '');
      if (!playerId || countedPlayerIds.has(scopedPlayerId)) return;
      countedPlayerIds.add(scopedPlayerId);
      summary.totalPlayers += 1;
      summary.playersByHands[handBucket(Number(profile.hands || 0))] += 1;
      var archetype = String(profile.primary && profile.primary.archetype || 'Unknown / Unsupported');
      summary.playersByArchetype[archetype] = Number(summary.playersByArchetype[archetype] || 0) + 1;
      if (archetype === 'Unknown / Insufficient Sample') summary.unknownInsufficient += 1;
      if (archetype === 'Unknown / Uncertain') summary.unknownUncertain += 1;
      Object.keys(opportunities).forEach(function (name) {
        var support = profile.featureSupport && profile.featureSupport[opportunities[name]];
        var denominator = Number(profile.opportunityDenominators && profile.opportunityDenominators[name] || 0);
        summary.opportunitySupport[name].totalOpportunities += denominator;
        if (denominator > 0) summary.opportunitySupport[name].playersWithOpportunities += 1;
        if (support && support.supported === true) summary.opportunitySupport[name].supportedPlayers += 1;
        else summary.opportunitySupport[name].unsupportedPlayers += 1;
      });
    });
    return summary;
  }

  function rebuildSession(storageSnapshot, sessionKey, options) {
    options = options || {};
    storageSnapshot = storageSnapshot && typeof storageSnapshot === 'object' ? storageSnapshot : {};
    var suffix = suffixForSession(storageSnapshot, sessionKey);
    if (!suffix) return { schemaVersion: SCHEMA_VERSION, session: null, profiles: [], unsupportedPlayers: [], error: 'session not found' };
    var liveKey = LIVE_PREFIX + suffix;
    var descriptor = sessionDescriptor(storageSnapshot, liveKey);
    var events = storageSnapshot[liveKey];
    if (!Array.isArray(events)) return { schemaVersion: SCHEMA_VERSION, session: descriptor, profiles: [], unsupportedPlayers: [], error: 'session events are malformed' };
    var statsApi = options.statsApi || root.PokerStats;
    var storeApi = options.storeApi || root.PokerPlayerProfileShadowStore;
    if (!statsApi || !storeApi) return { schemaVersion: SCHEMA_VERSION, session: descriptor, profiles: [], unsupportedPlayers: [], error: 'profile dependencies are unavailable' };
    var state = storeApi.createState({ maxPlayers: MAX_CALIBRATION_PLAYERS, maxHistoryPerPlayer: 10, confidenceDelta: 0.05, classifier: options.classifier || root.PokerPlayerProfileClassifier });
    var reconstruction = stableMappings(events, storageSnapshot[PLAYER_MAP_PREFIX + suffix]);
    var unsupportedPlayers = reconstruction.unsupportedPlayers.slice(0, MAX_UNSUPPORTED_PLAYERS);
    reconstruction.mappings.forEach(function (mapping) {
      try {
        var stats = statsApi.computePlayerStats(events, mapping[1]);
        var result = storeApi.update(state, mapping[0], stats, { generatedAt: Number(descriptor.lastEventTime || 0), reason: 'historical-read-only-rebuild' });
        if (result.failed) addUnsupported(unsupportedPlayers, { playerId: mapping[0], reason: result.reason, source: 'classifier' });
      } catch (error) {
        addUnsupported(unsupportedPlayers, { playerId: mapping[0], reason: String(error && error.message || error), source: 'classifier' });
      }
    });
    var profiles = exportCalibration(storeApi.list(state), descriptor.sessionKey);
    return { schemaVersion: SCHEMA_VERSION, session: descriptor, profiles: profiles, unsupportedPlayers: unsupportedPlayers, error: null };
  }

  var api = Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    MAX_CALIBRATION_PLAYERS: MAX_CALIBRATION_PLAYERS,
    MAX_UNSUPPORTED_PLAYERS: MAX_UNSUPPORTED_PLAYERS,
    historicalPlaceholderIdentity: historicalPlaceholderIdentity,
    historicalPlayerIdentity: historicalPlayerIdentity,
    resolveHistoricalIdentity: resolveHistoricalIdentity,
    readAllStorage: readAllStorage,
    discoverSessions: discoverSessions,
    exportCalibration: exportCalibration,
    calibrationSummary: calibrationSummary,
    rebuildSession: rebuildSession
  });
  root.PokerPlayerProfileCalibration = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
