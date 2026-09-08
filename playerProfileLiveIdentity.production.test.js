'use strict';

var assert = require('assert');
var classifier = require('./playerProfileClassifier');
var store = require('./playerProfileShadowStore');
var harnessSupport = require('./testSupport/productionContentScriptHarness');
var liveFixtures = require('./testSupport/playerProfileLiveValidationFixtures');

function profileStats(hands, vpip, pfr) {
  return liveFixtures.profileStats(hands, {
    vpipHands: vpip,
    pfrHands: pfr,
    afDetails: { bets: Math.floor(hands / 5), raises: Math.floor(hands / 8), calls: Math.floor(hands / 4) }
  });
}

function events(playerId, playerName, count) {
  return Array.from({ length: count }, function (_unused, index) {
    return {
      eventKey: playerId + ':' + index,
      handId: playerId + '-HAND-' + index,
      playerId: playerId,
      player: playerName,
      street: 'preflop',
      action: index % 4 === 0 ? 'raise' : (index % 2 === 0 ? 'call' : 'fold'),
      amount: index % 2 === 0 ? 20 : 0,
      timestamp: 1000 + index
    };
  });
}

function assertMonotonic(entries, label) {
  for (var index = 1; index < entries.length; index += 1) {
    assert.ok(entries[index].hands >= entries[index - 1].hands, label + ' hands are monotonic at index ' + index);
  }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// Canonical guard rejects only known invalid/sentinel identities and preserves opaque IDs.
[null, undefined, '', '   ', 'null', ' NULL ', 'undefined', 'UnDeFiNeD', 'gamePlayer', ' GAMEPLAYER '].forEach(function (identity) {
  assert.strictEqual(store.livePlayerIdentity(identity), null, String(identity) + ' is not a live stable identity');
});
['x', '0', 'rrj620ItzQ', 'opaque-id_123'].forEach(function (identity) {
  assert.strictEqual(store.livePlayerIdentity(identity), identity, identity + ' remains a legitimate opaque identity');
});

// Reproduce the observed 63 -> 6 -> 51 -> 9 -> 63 contamination shape against one key.
var state = store.createState({ classifier: classifier, sessionKey: 'pokernow.com:turnover', maxIdentityDiagnostics: 3 });
var target63 = profileStats(63, 32, 20);
assert.strictEqual(store.update(state, 'rrj620ItzQ', target63, { generatedAt: 1, reason: 'observed-session' }).updated, true);
['null', null, undefined, 'gamePlayer'].forEach(function (invalidIdentity, index) {
  var result = store.update(state, invalidIdentity, profileStats([63, 6, 51, 9][index], 2, 1), { generatedAt: 2 + index, reason: 'spectator-turnover' });
  assert.strictEqual(result.failed, true);
  assert.strictEqual(result.record, null);
});
assert.strictEqual(store.list(state).length, 1, 'invalid observations never create shadow players');
assert.strictEqual(store.get(state, 'null'), null);
assert.strictEqual(store.get(state, 'rrj620ItzQ').hands, 63, 'the real player retains its independent 63-hand profile');
assert.strictEqual(store.inspect(state).invalidIdentityObservationCount, 4);
assert.strictEqual(store.inspect(state).invalidIdentityObservationsRetained, 3, 'invalid identity diagnostics are FIFO bounded');
assert.strictEqual(store.inspect(state).invalidIdentityObservationsTruncated, true);

// A lower cumulative hand count in the same session fails closed before classification/telemetry mutation.
var classificationsBeforeRegression = store.inspect(state).classifications;
var regression = store.update(state, 'rrj620ItzQ', profileStats(6, 3, 2), { generatedAt: 10, reason: 'same-session-turnover' });
assert.strictEqual(regression.failed, true);
assert.strictEqual(regression.rejected, true);
assert.ok(/decreased from 63 to 6/.test(regression.reason));
assert.strictEqual(store.get(state, 'rrj620ItzQ').hands, 63);
assert.strictEqual(store.inspect(state).classifications, classificationsBeforeRegression, 'rejected regression never reaches the classifier');
assert.strictEqual(store.inspect(state).monotonicityViolationCount, 1);
assertMonotonic(store.profileSamples(state, 'rrj620ItzQ'), 'samples');
assertMonotonic(store.profileTimeline(state, 'rrj620ItzQ'), 'timeline');

// Explicit session reset is authoritative: clear establishes a new record boundary.
store.clear(state);
assert.strictEqual(store.update(state, 'rrj620ItzQ', profileStats(6, 3, 2), { generatedAt: 11, reason: 'explicit-session-reset' }).updated, true);
assert.strictEqual(store.get(state, 'rrj620ItzQ').hands, 6);
assert.strictEqual(store.inspect(state).monotonicityViolationCount, 0);

// Production restore and live socket discovery reproduce spectator turnover without a shared null key.
var gameId = 'profile-live-identity-turnover';
var keys = harnessSupport.storageKeys(gameId);
var targetEvents = events('rrj620ItzQ', 'Target Player', 63);
var shortEvents = events('playerB123', 'Departing Player', 6);
var joinedEvents = events('playerC456', 'Joining Player', 9);
var initialStorage = {};
initialStorage[keys.schema] = 4;
initialStorage[keys.playerMap] = {
  rrj620ItzQ: 'Target Player',
  playerB123: 'Departing Player',
  null: 'Target Player',
  undefined: 'Departing Player',
  gamePlayer: 'Joining Player',
  ' ': 'Empty Seat'
};
initialStorage[keys.liveEvents] = targetEvents.concat(shortEvents, joinedEvents);
initialStorage[keys.finalizedHandIds] = initialStorage[keys.liveEvents].map(function (event) { return event.handId; });

var harness = harnessSupport.createHarness({ gameId: gameId, initialStorage: initialStorage });
assert.deepStrictEqual(harness.evaluationErrors, []);
var initialProfiles = harness.context.PokerNowHUDProfiles.list();
assert.deepStrictEqual(plain(initialProfiles.map(function (profile) { return profile.playerId; }).sort()), ['playerB123', 'rrj620ItzQ']);
assert.strictEqual(harness.context.PokerNowHUDProfiles.get('rrj620ItzQ').hands, 63);

function socket(eventName, payload) { return '42[' + JSON.stringify(eventName) + ',' + JSON.stringify(payload) + ']'; }
[
  { observer: { id: null, name: 'Spectator' }, seats: [{ seat: 4, player: { id: null, name: 'Departing Player' } }] },
  { observer: { id: undefined, name: 'Spectator' }, seats: [{ seat: 4, player: null }] },
  { observer: { id: 'gamePlayer', name: 'Spectator' }, seats: [{ seat: 4, player: { id: 'playerC456', name: 'Joining Player' } }] },
  { observer: { name: 'Spectator' }, players: [{ id: 'rrj620ItzQ', name: 'Target Player' }] }
].forEach(function (payload, index) {
  harnessSupport.dispatchFrame(harness, socket('playerUpdate', payload), 'turnover-' + index, 2000 + index);
});

var exported = harness.context.PokerNowHUDProfiles.exportLiveProfileValidation();
var exportedIds = exported.players.map(function (player) { return String(player.playerId); });
assert.deepStrictEqual(plain(exportedIds.slice().sort()), ['playerB123', 'playerC456', 'rrj620ItzQ']);
assert.ok(exportedIds.every(function (playerId) { return store.livePlayerIdentity(playerId) !== null; }));
exported.players.forEach(function (player) {
  assertMonotonic(player.samples, player.playerId + ' samples');
  assertMonotonic(player.timeline, player.playerId + ' timeline');
});
assert.strictEqual(exported.players.find(function (player) { return player.playerId === 'rrj620ItzQ'; }).hands, 63);
assert.ok(exported.identityDiagnostics.invalidIdentityObservationCount >= 4, 'restore and spectator lookup diagnostics retain invalid identity observations');
assert.doesNotThrow(function () { JSON.stringify(exported); });

var latestPlayerMapWrite = harness.storageWrites.filter(function (write) { return Object.prototype.hasOwnProperty.call(write, keys.playerMap); }).slice(-1)[0];
assert.ok(latestPlayerMapWrite, 'a valid join refreshes the production player map');
assert.deepStrictEqual(Object.keys(latestPlayerMapWrite[keys.playerMap]).sort(), ['playerB123', 'playerC456', 'rrj620ItzQ']);

console.log('Live profile identity guard, spectator turnover, observed-session contamination, and monotonicity regressions passed.');
