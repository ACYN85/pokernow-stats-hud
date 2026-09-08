'use strict';

var assert = require('assert');
var stats = require('./stats.js');
var filtered = require('./filteredStats.js');
var cacheApi = require('./sessionStatsCache.js');

function events(handCount) {
  var result = [];
  var positions = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
  for (var hand = 0; hand < handCount; hand += 1) {
    for (var player = 0; player < 6; player += 1) {
      result.push({
        handId: 'h' + hand,
        playerId: 'p' + player,
        player: 'Player ' + player,
        action: (hand + player) % 5 === 0 ? 'raise' : (hand + player) % 3 === 0 ? 'call' : 'fold',
        street: 'preflop', amount: 0, timestamp: hand * 10 + player, countsAsHand: true,
        dealtPosition: positions[player],
        threeBetMade: (hand + player) % 17 === 0 ? 1 : 0,
        threeBetOpportunities: (hand + player) % 7 === 0 ? 1 : 0,
        threeBetTargetPlayerId: 'p' + ((player + 5) % 6)
      });
    }
  }
  return result;
}

var source = events(1000);
var cache = cacheApi.create({ maxEntries: 32 });
var exactCalls = 0;
function exact() { exactCalls += 1; return stats.computePlayerStatsByIdentity(source, 'p0', 'Player 0'); }
var first = cacheApi.get(cache, { kind: 'exact', playerId: 'p0', playerName: 'Player 0' }, exact);
var second = cacheApi.get(cache, { kind: 'exact', playerId: 'p0', playerName: 'Player 0' }, exact);
assert.strictEqual(second, first, 'identical query at one finalized revision reuses the exact result object');
assert.strictEqual(exactCalls, 1);

var filteredCalls = 0;
function position() { filteredCalls += 1; return filtered.sessionStatsFiltered(source, 'p0', { position: 'BTN' }); }
var filteredFirst = cacheApi.get(cache, { kind: 'filtered', playerId: 'p0', filters: { position: 'BTN' } }, position);
var filteredSecond = cacheApi.get(cache, { filters: { position: 'BTN' }, playerId: 'p0', kind: 'filtered' }, position);
assert.strictEqual(filteredSecond, filteredFirst, 'canonical filter dimensions share one cache key regardless of object property order');
assert.strictEqual(filteredCalls, 1);
assert.notStrictEqual(cacheApi.get(cache, { kind: 'filtered', playerId: 'p0', filters: { position: 'CO' } }, function () { return filtered.sessionStatsFiltered(source, 'p0', { position: 'CO' }); }), filteredFirst, 'different filter dimensions do not alias');

var beforeRevision = cacheApi.inspect(cache).revision;
cacheApi.advance(cache, 'finalized hand committed');
assert.strictEqual(cacheApi.inspect(cache).revision, beforeRevision + 1);
var afterFinalization = cacheApi.get(cache, { kind: 'exact', playerId: 'p0', playerName: 'Player 0' }, exact);
assert.notStrictEqual(afterFinalization, first, 'finalization invalidates prior results');
assert.strictEqual(exactCalls, 2);

['Reset Session', 'storage hydration', 'table lifecycle reset', 'supported in-session correction'].forEach(function (reason) {
  var revision = cacheApi.inspect(cache).revision;
  cacheApi.advance(cache, reason);
  assert.strictEqual(cacheApi.inspect(cache).revision, revision + 1, reason + ' advances the one authoritative finalized-session revision');
});

for (var index = 0; index < 100; index += 1) {
  cacheApi.get(cache, { kind: 'exact', playerId: 'bounded-' + index }, function () { return { index: index }; });
}
var inspection = cacheApi.inspect(cache);
assert.ok(inspection.size <= 32, 'query cache remains bounded');
assert.ok(inspection.hits >= 2 && inspection.misses >= 103, 'cache diagnostics expose exact hit/miss counts');

console.log('Revision-keyed session-stat cache identity, filters, invalidation, and bounds passed.');
