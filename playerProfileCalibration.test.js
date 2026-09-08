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

function eventsFor(playerId, playerName, handCount, aggressive) {
  var events = [];
  for (var index = 1; index <= handCount; index += 1) {
    events.push({
      eventKey: playerId + ':' + index,
      handId: 'hand-' + index,
      playerId: playerId,
      player: playerName,
      street: 'preflop',
      action: aggressive && index % 2 === 0 ? 'raise' : 'check',
      timestamp: 1000 + index,
      threeBetMade: aggressive && index % 10 === 0 ? 1 : 0,
      threeBetOpportunities: index % 5 === 0 ? 1 : 0,
      foldToThreeBet: 0,
      foldToThreeBetOpportunities: index % 11 === 0 ? 1 : 0,
      flopCBetMade: aggressive && index % 6 === 0 ? 1 : 0,
      flopCBetOpportunities: index % 3 === 0 ? 1 : 0,
      foldToFlopCBet: 0,
      foldToFlopCBetOpportunities: index % 7 === 0 ? 1 : 0,
      sawFlopForWTSD: index % 2 === 0 ? 1 : 0,
      wentToShowdown: index % 8 === 0 ? 1 : 0,
      showdownsForWSD: index % 8 === 0 ? 1 : 0,
      wonMoneyAtShowdown: index % 16 === 0 ? 1 : 0
    });
  }
  return events;
}

var firstSession = 'pokernow.com:historical-a';
var secondSession = 'www.pokernow.com:historical-b';
var firstKeys = keys(firstSession);
var secondKeys = keys(secondSession);
var firstEvents = eventsFor('stable-P1', 'Historical Alice', 40, true);
var secondEvents = eventsFor('stable-P1', 'Historical Alice Renamed', 10, false);
var storageSnapshot = {};
storageSnapshot[firstKeys.live] = firstEvents;
storageSnapshot[firstKeys.playerMap] = { 'stable-P1': 'Historical Alice' };
storageSnapshot[firstKeys.meta] = { gameId: 'historical-a', sessionKey: firstSession, url: 'https://pokernow.com/games/historical-a', updatedAt: 9999 };
storageSnapshot[firstKeys.schema] = 4;
storageSnapshot[secondKeys.live] = secondEvents;
storageSnapshot[secondKeys.playerMap] = { 'stable-P1': 'Historical Alice Renamed' };
storageSnapshot[secondKeys.meta] = { gameId: 'historical-b', sessionKey: secondSession, updatedAt: 8888 };
storageSnapshot[secondKeys.schema] = 4;
storageSnapshot.pokerNowHudLiveEvents = [{ player: 'Legacy Name', handId: 'unsafe-unscoped' }];
storageSnapshot['pokerNowHudLiveEvents:game:' + encodeURIComponent('pokernow.com:malformed')] = { not: 'an array' };

var discovered = calibration.discoverSessions(storageSnapshot);
assert.strictEqual(discovered.length, 3, 'two valid and one malformed scoped sessions are discoverable');
assert.strictEqual(discovered.some(function (session) { return session.sessionKey === 'unsafe-unscoped'; }), false, 'legacy unscoped events are excluded');
var firstMetadata = discovered.find(function (session) { return session.sessionKey === firstSession; });
assert.deepStrictEqual(firstMetadata, {
  sessionKey: firstSession,
  lobbyId: 'historical-a',
  eventCount: 40,
  playerCount: 1,
  firstEventTime: 1001,
  lastEventTime: 1040,
  approximateHands: 40,
  liveSchemaVersion: 4,
  status: 'available'
});
assert.strictEqual(JSON.stringify(discovered).includes('https://'), false, 'safe discovery metadata excludes stored URLs');

var before = JSON.stringify(storageSnapshot);
var rebuilt = calibration.rebuildSession(storageSnapshot, firstSession, { statsApi: PokerStats, storeApi: store, classifier: classifier });
assert.strictEqual(JSON.stringify(storageSnapshot), before, 'historical rebuild does not mutate authoritative storage');
assert.strictEqual(rebuilt.error, null);
assert.strictEqual(rebuilt.profiles.length, 1);
assert.strictEqual(rebuilt.profiles[0].sessionKey, firstSession);
assert.strictEqual(rebuilt.profiles[0].playerId, 'stable-P1');
assert.strictEqual(rebuilt.profiles[0].hands, 40);
assert.strictEqual(rebuilt.profiles[0].authoritativeCounters.handsPlayed, PokerStats.computePlayerStats(firstEvents, 'Historical Alice').handsPlayed);
assert.strictEqual(rebuilt.profiles[0].authoritativeCounters.threeBetOpportunities, PokerStats.computePlayerStats(firstEvents, 'Historical Alice').threeBetOpportunities);
assert.strictEqual(JSON.stringify(rebuilt).includes('Historical Alice'), false, 'calibration export excludes display names');
assert.doesNotThrow(function () { JSON.stringify(rebuilt); }, 'calibration export is JSON-safe');

var repeated = calibration.rebuildSession(storageSnapshot, firstSession, { statsApi: PokerStats, storeApi: store, classifier: classifier });
assert.deepStrictEqual(repeated, rebuilt, 'historical rebuild is deterministic');
var isolatedSecond = calibration.rebuildSession(storageSnapshot, secondSession, { statsApi: PokerStats, storeApi: store, classifier: classifier });
assert.strictEqual(isolatedSecond.profiles[0].hands, 10, 'same stable ID remains isolated by session');
assert.notStrictEqual(isolatedSecond.profiles[0].sessionKey, rebuilt.profiles[0].sessionKey);

var summary = calibration.calibrationSummary(rebuilt.profiles.concat(isolatedSecond.profiles));
assert.strictEqual(summary.totalPlayers, 2);
assert.strictEqual(summary.playersByHands['20-39'], 0);
assert.strictEqual(summary.playersByHands['40-79'], 1);
assert.strictEqual(summary.playersByHands['0-19'], 1);
['threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd'].forEach(function (field) {
  assert.ok(summary.opportunitySupport[field]);
  assert.strictEqual(Number.isFinite(summary.opportunitySupport[field].totalOpportunities), true);
});

var malformed = calibration.rebuildSession(storageSnapshot, 'pokernow.com:malformed', { statsApi: PokerStats, storeApi: store, classifier: classifier });
assert.strictEqual(malformed.error, 'session events are malformed');
assert.deepStrictEqual(malformed.profiles, []);
assert.strictEqual(calibration.rebuildSession(storageSnapshot, 'missing', { statsApi: PokerStats, storeApi: store, classifier: classifier }).error, 'session not found');
assert.deepStrictEqual(calibration.discoverSessions(null), []);

console.log('Player-profile historical discovery, read-only rebuild, isolation, calibration export, summaries, and malformed handling passed.');
