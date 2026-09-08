'use strict';

var assert = require('assert');
var PokerStats = require('./stats');
var classifier = require('./playerProfileClassifier');
var store = require('./playerProfileShadowStore');
var calibration = require('./playerProfileCalibration');

function keys(sessionKey) {
  var suffix = encodeURIComponent(sessionKey);
  return {
    live: 'pokerNowHudLiveEvents:game:' + suffix,
    playerMap: 'pokerNowHudPlayerMap:game:' + suffix,
    meta: 'pokerNowHudSessionMeta:game:' + suffix,
    schema: 'pokerNowHudLiveSchemaVersion:game:' + suffix
  };
}

function handEvents(playerId, playerName, count, completeFeatures) {
  return Array.from({ length: count }, function (_unused, index) {
    var event = {
      eventKey: playerId + ':' + index,
      handId: playerId + '-HAND-' + index,
      playerId: playerId,
      player: playerName,
      street: 'preflop',
      action: index % 4 === 0 ? 'raise' : index % 3 === 0 ? 'call' : 'fold',
      timestamp: 100000 + index,
      threeBetMade: index % 20 === 0 ? 1 : 0,
      threeBetOpportunities: index % 5 === 0 ? 1 : 0,
      foldToThreeBet: index % 30 === 0 ? 1 : 0,
      foldToThreeBetOpportunities: index % 10 === 0 ? 1 : 0
    };
    if (completeFeatures) {
      event.flopCBetMade = index % 12 === 0 ? 1 : 0;
      event.flopCBetOpportunities = index % 6 === 0 ? 1 : 0;
      event.foldToFlopCBet = index % 18 === 0 ? 1 : 0;
      event.foldToFlopCBetOpportunities = index % 9 === 0 ? 1 : 0;
      event.sawFlopForWTSD = index % 2 === 0 ? 1 : 0;
      event.wentToShowdown = index % 8 === 0 ? 1 : 0;
      event.showdownsForWSD = index % 8 === 0 ? 1 : 0;
      event.wonMoneyAtShowdown = index % 16 === 0 ? 1 : 0;
    }
    return event;
  });
}

function installSession(storage, sessionKey, playerId, playerName, count, options) {
  options = options || {};
  var sessionKeys = keys(sessionKey);
  var events = handEvents(playerId, playerName, count, options.completeFeatures === true);
  for (var fillerIndex = 0; fillerIndex < Number(options.unrelatedEventCount || 0); fillerIndex += 1) {
    events.push({ handId: 'UNRELATED-' + fillerIndex, playerId: null, player: null, street: 'preflop', action: null, timestamp: 190000 + fillerIndex });
  }
  var playerMap = {};
  playerMap[playerId] = playerName;
  if (options.nullAlias) playerMap.null = playerName;
  if (options.gamePlayerAlias) playerMap.gamePlayer = playerName;
  storage[sessionKeys.live] = events;
  storage[sessionKeys.playerMap] = playerMap;
  storage[sessionKeys.meta] = { gameId: sessionKey.slice(sessionKey.indexOf(':') + 1), sessionKey: sessionKey, updatedAt: 200000 };
  storage[sessionKeys.schema] = 4;
  return { keys: sessionKeys, events: events };
}

[null, undefined, '', ' ', '\t', 'null', ' NULL ', 'undefined', ' UnDeFiNeD ', 'gamePlayer', ' GAMEPLAYER '].forEach(function (value) {
  assert.strictEqual(calibration.historicalPlayerIdentity(value), null, JSON.stringify(value) + ' is an invalid historical player identity');
});
['0', 'player-1', 'opaque_ID/value', 'null-player'].forEach(function (value) {
  assert.strictEqual(calibration.historicalPlayerIdentity(value), value, value + ' remains a legitimate opaque ID');
});
assert.deepStrictEqual(calibration.resolveHistoricalIdentity('null', { stablePlayerId: 'P1' }), { playerId: 'P1', resolved: true, conflict: false }, 'an explicit stored stablePlayerId resolves an invalid sentinel');
assert.deepStrictEqual(calibration.resolveHistoricalIdentity('gamePlayer', { stablePlayerId: 'P1' }), { playerId: 'P1', resolved: true, conflict: false }, 'the protocol placeholder resolves only through an explicit stored stablePlayerId');
assert.deepStrictEqual(calibration.resolveHistoricalIdentity(undefined, { authoritativePlayerId: 'P2' }), { playerId: 'P2', resolved: true, conflict: false }, 'an explicit authoritativePlayerId resolves missing identity');
assert.deepStrictEqual(calibration.resolveHistoricalIdentity('null', { stablePlayerId: 'P1', authoritativePlayerId: 'P2' }), { playerId: null, resolved: false, conflict: true }, 'conflicting exact aliases fail closed');

var sessionConfigs = [
  { sessionKey: 'www.pokernow.com:synthetic-session-a', eventCount: 353, hands: 349, complete: true, gamePlayerAlias: true },
  { sessionKey: 'www.pokernow.com:synthetic-session-d', hands: 201, complete: false, nullAlias: true },
  { sessionKey: 'www.pokernow.com:synthetic-session-b', eventCount: 168, hands: 166, complete: false, gamePlayerAlias: true },
  { sessionKey: 'www.pokernow.com:synthetic-session-c', hands: 89, complete: true, nullAlias: true }
];
var storageSnapshot = {};
var installed = {};
sessionConfigs.forEach(function (config, index) {
  installed[config.sessionKey] = installSession(storageSnapshot, config.sessionKey, index === 0 || index === 2 ? 'P1' : 'VALID-P' + (index + 1), 'Historical Player ' + (index + 1), config.hands, {
    completeFeatures: config.complete,
    nullAlias: config.nullAlias,
    gamePlayerAlias: config.gamePlayerAlias,
    unrelatedEventCount: Number(config.eventCount || config.hands) - config.hands
  });
});

var storageBefore = JSON.stringify(storageSnapshot);
sessionConfigs.forEach(function (config, index) {
  var validPlayerId = index === 0 || index === 2 ? 'P1' : 'VALID-P' + (index + 1);
  var playerName = 'Historical Player ' + (index + 1);
  var result = calibration.rebuildSession(storageSnapshot, config.sessionKey, { statsApi: PokerStats, storeApi: store, classifier: classifier });
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.profiles.length, 1, config.sessionKey + ' exports exactly one valid player');
  assert.strictEqual(result.profiles[0].playerId, validPlayerId);
  assert.strictEqual(result.session.eventCount, Number(config.eventCount || config.hands), 'session retains its real-shaped historical event count');
  assert.strictEqual(result.profiles[0].hands, config.hands, 'only authoritative player hands contribute to the profile');
  assert.strictEqual(result.profiles.some(function (profile) { return profile.playerId === 'null'; }), false, 'literal null never reaches profiles');
  assert.strictEqual(result.profiles.some(function (profile) { return profile.playerId === 'gamePlayer'; }), false, 'registered.gamePlayer never becomes an independent stable profile');
  assert.deepStrictEqual(result.profiles[0].authoritativeCounters, store.inputSummary(PokerStats.computePlayerStats(installed[config.sessionKey].events, playerName)), 'valid counters remain unchanged');
  assert.strictEqual(calibration.calibrationSummary(result.profiles).totalPlayers, 1, 'summary counts only the valid player');
  if (config.nullAlias) {
    assert.ok(result.unsupportedPlayers.some(function (entry) { return entry.playerId === null && entry.observedIdentity === 'null' && entry.reason === 'invalid_player_identity'; }), 'rejected null map identity is retained as a bounded diagnostic');
  }
  if (config.gamePlayerAlias) {
    assert.ok(result.unsupportedPlayers.some(function (entry) { return entry.playerId === null && entry.observedIdentity === 'gamePlayer' && entry.reason === 'historical_placeholder_identity' && entry.source === 'player_map'; }), 'legacy registered.gamePlayer map leakage is retained only as a bounded placeholder diagnostic');
  }
  if (!config.complete) {
    assert.strictEqual(result.profiles[0].authoritativeCounters.flopCBetOpportunities, 0);
    assert.strictEqual(result.profiles[0].authoritativeCounters.foldToFlopCBetOpportunities, 0);
    assert.strictEqual(result.profiles[0].authoritativeCounters.sawFlopForWTSD, 0);
    assert.strictEqual(result.profiles[0].authoritativeCounters.showdownsForWSD, 0);
    assert.strictEqual(result.profiles[0].featureSupport.flopCBetRate.supported, false, 'missing historical features remain unsupported');
  }
  assert.deepStrictEqual(calibration.rebuildSession(storageSnapshot, config.sessionKey, { statsApi: PokerStats, storeApi: store, classifier: classifier }), result, 'rebuild is deterministic');
});
assert.strictEqual(JSON.stringify(storageSnapshot), storageBefore, 'four-session calibration audit is read-only');

// Exact invalid->stable resolution and duplicate stable-ID paths classify once.
var exactSession = 'www.pokernow.com:exact-alias';
var exactInstalled = installSession(storageSnapshot, exactSession, 'EXACT-P1', 'Exact Player', 30, { completeFeatures: true });
exactInstalled.events.push({ handId: 'EXACT-ALIAS-EVIDENCE', playerId: null, stablePlayerId: 'EXACT-P1', player: 'Exact Player', street: 'preflop', action: 'fold', timestamp: 200000 });
storageSnapshot[exactInstalled.keys.live] = exactInstalled.events;
storageSnapshot[exactInstalled.keys.playerMap].null = { stablePlayerId: 'EXACT-P1', playerName: 'Exact Player' };
var exactResult = calibration.rebuildSession(storageSnapshot, exactSession, { statsApi: PokerStats, storeApi: store, classifier: classifier });
assert.strictEqual(exactResult.profiles.length, 1);
assert.strictEqual(exactResult.profiles[0].playerId, 'EXACT-P1');

var exactGamePlayerSession = 'www.pokernow.com:exact-game-player-alias';
var exactGamePlayerInstalled = installSession(storageSnapshot, exactGamePlayerSession, 'EXACT-GP-P1', 'Exact Local Player', 30, { completeFeatures: true });
storageSnapshot[exactGamePlayerInstalled.keys.playerMap].gamePlayer = { authoritativePlayerId: 'EXACT-GP-P1', playerName: 'Exact Local Player' };
var exactGamePlayerResult = calibration.rebuildSession(storageSnapshot, exactGamePlayerSession, { statsApi: PokerStats, storeApi: store, classifier: classifier });
assert.deepStrictEqual(exactGamePlayerResult.profiles.map(function (profile) { return profile.playerId; }), ['EXACT-GP-P1'], 'an explicit persisted authoritative alias collapses the placeholder into the exact stable ID once');

// Equal counters are never an identity merge signal.
var equalSession = 'www.pokernow.com:equal-stats';
var equalKeys = keys(equalSession);
var equalA = handEvents('EQUAL-A', 'Equal A', 20, false);
var equalB = handEvents('EQUAL-B', 'Equal B', 20, false).map(function (event) { return Object.assign({}, event, { handId: event.handId.replace('EQUAL-B', 'EQUAL-A') }); });
storageSnapshot[equalKeys.live] = equalA.concat(equalB);
storageSnapshot[equalKeys.playerMap] = { 'EQUAL-A': 'Equal A', 'EQUAL-B': 'Equal B' };
var equalResult = calibration.rebuildSession(storageSnapshot, equalSession, { statsApi: PokerStats, storeApi: store, classifier: classifier });
assert.deepStrictEqual(equalResult.profiles.map(function (profile) { return profile.playerId; }).sort(), ['EQUAL-A', 'EQUAL-B'], 'equal statistics do not merge distinct valid IDs');

// Conflicting names for one exact stable ID fail closed.
var conflictSession = 'www.pokernow.com:conflicting-id';
var conflictKeys = keys(conflictSession);
storageSnapshot[conflictKeys.live] = handEvents('CONFLICT-P1', 'Event Name', 20, false);
storageSnapshot[conflictKeys.playerMap] = { 'CONFLICT-P1': 'Map Name' };
var conflictResult = calibration.rebuildSession(storageSnapshot, conflictSession, { statsApi: PokerStats, storeApi: store, classifier: classifier });
assert.deepStrictEqual(conflictResult.profiles, []);
assert.ok(conflictResult.unsupportedPlayers.some(function (entry) { return entry.playerId === 'CONFLICT-P1' && entry.reason === 'conflicting_player_identity_data'; }));

// Invalid forms and conflicting datasets remain bounded and JSON-safe.
var boundedSession = 'www.pokernow.com:bounded-invalid';
var boundedKeys = keys(boundedSession);
var boundedEvents = [];
for (var identity = 0; identity < 250; identity += 1) {
  boundedEvents.push({ handId: 'BOUND-' + identity + '-A', playerId: 'BOUND-P' + identity, player: 'Name A ' + identity, street: 'preflop', action: 'fold' });
  boundedEvents.push({ handId: 'BOUND-' + identity + '-B', playerId: 'BOUND-P' + identity, player: 'Name B ' + identity, street: 'preflop', action: 'fold' });
}
boundedEvents.push({ handId: 'INVALID-NULL', playerId: null, player: 'No Identity', street: 'preflop', action: 'fold' });
boundedEvents.push({ handId: 'INVALID-UNDEFINED', playerId: undefined, player: 'No Identity', street: 'preflop', action: 'fold' });
boundedEvents.push({ handId: 'INVALID-LITERAL', playerId: 'undefined', player: 'No Identity', street: 'preflop', action: 'fold' });
boundedEvents.push({ handId: 'INVALID-EMPTY', playerId: '', player: 'No Identity', street: 'preflop', action: 'fold' });
boundedEvents.push({ handId: 'INVALID-WHITESPACE', playerId: '   ', player: 'No Identity', street: 'preflop', action: 'fold' });
storageSnapshot[boundedKeys.live] = boundedEvents;
storageSnapshot[boundedKeys.playerMap] = {};
var boundedResult = calibration.rebuildSession(storageSnapshot, boundedSession, { statsApi: PokerStats, storeApi: store, classifier: classifier });
assert.strictEqual(boundedResult.unsupportedPlayers.length, calibration.MAX_UNSUPPORTED_PLAYERS);
assert.strictEqual(boundedResult.profiles.length, 0);
assert.doesNotThrow(function () { JSON.stringify(boundedResult); });

// Defensive export/summary invariants reject invalid and duplicate store records.
var validRecord = store.update(store.createState({ classifier: classifier }), 'DEFENSIVE-P1', PokerStats.computePlayerStats(handEvents('DEFENSIVE-P1', 'Defensive', 20, false), 'Defensive'), { generatedAt: 1 }).record;
var exported = calibration.exportCalibration([validRecord, validRecord, Object.assign({}, validRecord, { playerId: 'null' })], 'defensive');
assert.strictEqual(exported.length, 1);
assert.strictEqual(calibration.calibrationSummary(exported.concat([{ playerId: 'null' }, exported[0]])).totalPlayers, 1);

console.log('Historical identity sentinels, exact resolution, A1-A4 session shapes, deduplication, conflicts, bounds, and read-only exports passed.');
