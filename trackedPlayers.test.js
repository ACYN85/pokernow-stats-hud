'use strict';

var assert = require('assert');
var tracked = require('./trackedPlayers.js');

var now = new Date(2026, 8, 9, 12, 0, 0).getTime();
function row(id, name, hands, lastSeenAt, revision) {
  return { playerId: id, latestDisplayName: name, hands: hands, lastSeenAt: lastSeenAt, revision: revision || 1, summaryVersion: 1 };
}
function ids(rows) { return rows.map(function (item) { return item.playerId; }); }

var summaries = [
  row('stable-b', 'Zulu Target', 14, now - 86400000),
  row('stable-a', 'Alpha', 391, now),
  row('stable-c', 'alpha', 391, null),
  row('stable-d', '', 0, 0)
];

assert.deepStrictEqual(ids(tracked.visibleRows(summaries, '', tracked.SORT_RECENT)), ['stable-a', 'stable-b', 'stable-c', 'stable-d'], 'recent is default and missing dates follow valid dates');
assert.deepStrictEqual(ids(tracked.visibleRows([row('b', 'B', 1, 100), row('a', 'A', 9, 100)], '', 'recent')), ['a', 'b'], 'recent ties end with stable ID');
assert.deepStrictEqual(ids(tracked.visibleRows(summaries, '', tracked.SORT_HANDS)), ['stable-a', 'stable-c', 'stable-b', 'stable-d']);
assert.deepStrictEqual(ids(tracked.visibleRows([row('b', 'Z', 2, 1), row('a', 'A', 2, 9)], '', 'hands')), ['a', 'b'], 'hand ties end with stable ID');
assert.deepStrictEqual(ids(tracked.visibleRows(summaries, '', tracked.SORT_NAME)), ['stable-a', 'stable-c', 'stable-d', 'stable-b']);
assert.deepStrictEqual(ids(tracked.visibleRows([row('b', 'Same', 1, 1), row('a', 'same', 1, 1)], '', 'name')), ['a', 'b'], 'case-insensitive name ties end with stable ID');

assert.deepStrictEqual(ids(tracked.visibleRows(summaries, 'ZUL', 'recent')), ['stable-b'], 'partial name search is case-insensitive');
assert.deepStrictEqual(ids(tracked.visibleRows(summaries, 'STABLE-A', 'recent')), ['stable-a'], 'full stable-ID search is case-insensitive');
assert.deepStrictEqual(ids(tracked.visibleRows(summaries, 'ble-c', 'recent')), ['stable-c'], 'partial stable-ID search works');
assert.deepStrictEqual(tracked.visibleRows(summaries, 'missing', 'recent'), []);

var duplicates = tracked.normalizeSummaries([
  row('one', 'Alex', 1, 1, 1), row('two', 'Alex', 2, 2, 1),
  row('one', 'Old Alex', 9, 9, 0), row('one', 'Renamed Alex', 3, 3, 2)
]);
assert.strictEqual(duplicates.length, 2, 'duplicate names remain separate while duplicate stable IDs collapse');
assert.strictEqual(duplicates.find(function (item) { return item.playerId === 'one'; }).latestDisplayName, 'Renamed Alex', 'highest revision wins for the same stable ID');
assert.strictEqual(tracked.normalizeSummaries([row('unknown', '   ', -1, 'bad')])[0].latestDisplayName, 'Unknown player');

assert.strictEqual(tracked.shortId('123456789012345'), '123456\u20262345');
assert.strictEqual(tracked.shortId('short-id'), 'short-id');
assert.strictEqual(tracked.formatLastSeen(now, now).text, 'Last seen Today');
assert.strictEqual(tracked.formatLastSeen(now - 86400000, now).text, 'Last seen Yesterday');
assert.strictEqual(tracked.formatLastSeen(null, now).text, 'Last seen unavailable');
assert.strictEqual(tracked.formatLastSeen('malformed', now).text, 'Last seen unavailable');

var loading = tracked.render({ summaries: [], loading: true, search: '', sort: 'recent', now: now });
assert.ok(loading.includes('Preparing tracked players'));
assert.ok(!loading.includes('No tracked players yet'), 'pending readiness never presents partial data as complete');
var empty = tracked.render({ summaries: [], loading: false, search: '', sort: 'recent', now: now });
assert.ok(empty.includes('No tracked players yet'));
var normal = tracked.render({ summaries: summaries, loading: false, search: '', sort: 'recent', now: now });
assert.ok(normal.includes('<h2>Tracked Players</h2>'));
assert.ok(normal.includes('Zulu Target') && normal.includes('391 hands') && normal.includes('Last seen Today'));
assert.ok(normal.includes('Stable player ID: stable-a'));
assert.ok(normal.includes('Most recent') && normal.includes('Most hands') && normal.includes('Name A\u2013Z'));
var noResults = tracked.render({ summaries: summaries, loading: false, search: 'does-not-exist', sort: 'recent', now: now });
assert.ok(noResults.includes('No matching players'));

var measurements = [100, 500, 1000].map(function (count) {
  var rows = Array.from({ length: count }, function (_unused, index) {
    return row('player-' + String(index).padStart(4, '0'), 'Player ' + index, index % 73, now - index * 1000);
  });
  var started = process.hrtime.bigint();
  var rendered = tracked.render({ summaries: rows, loading: false, search: '', sort: 'recent', now: now });
  var renderedAt = process.hrtime.bigint();
  var searched = tracked.visibleRows(rows, 'player 9', 'recent');
  var searchedAt = process.hrtime.bigint();
  var sorted = tracked.visibleRows(rows, '', 'hands');
  var ended = process.hrtime.bigint();
  assert.strictEqual((rendered.match(/pnhud-tracked-player-row/g) || []).length, count);
  assert.ok(searched.every(function (item) { return item.latestDisplayName.toLowerCase().includes('player 9'); }));
  assert.strictEqual(sorted.length, count);
  assert.ok(sorted.every(function (item, index) { return index === 0 || sorted[index - 1].hands >= item.hands; }));
  return {
    players: count,
    renderMs: Number(renderedAt - started) / 1e6,
    searchMs: Number(searchedAt - renderedAt) / 1e6,
    sortMs: Number(ended - searchedAt) / 1e6
  };
});

console.log(JSON.stringify({ trackedPlayersLocalMeasurements: measurements }, null, 2));
console.log('Tracked Players local browse/search/sort/presentation tests passed.');
