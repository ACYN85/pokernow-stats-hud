'use strict';
var assert = require('assert');
var notes = require('./playerNotesStore.js');
var state = notes.normalize(null);
state = notes.set(state, 'stable-a', 'First note');
assert.strictEqual(notes.get(state, 'stable-a'), 'First note');
assert.strictEqual(notes.get(notes.normalize(JSON.parse(JSON.stringify(state))), 'stable-a'), 'First note', 'storage hydration preserves notes');
state = notes.set(state, 'stable-b', 'Same display name, separate ID');
assert.notStrictEqual(notes.get(state, 'stable-a'), notes.get(state, 'stable-b'));
assert.strictEqual(notes.get(state, 'stable-a'), 'First note', 'a display-name rename has no effect on stable-ID lookup');
var before = JSON.stringify(state); state = notes.clear(state, 'stable-a');
assert.strictEqual(notes.get(state, 'stable-a'), ''); assert.strictEqual(notes.get(state, 'stable-b'), 'Same display name, separate ID');
assert.notStrictEqual(JSON.stringify(state), before, 'clear is an explicit state update');
assert.throws(function () { notes.set(state, '', 'bad'); }, /stable player ID/);

function noteState(count) {
  var value = notes.normalize(null);
  for (var index = 0; index < count; index += 1) value = notes.set(value, 'stable-' + String(index).padStart(3, '0'), 'note-' + index);
  return value;
}
var at499 = noteState(499);
var with500 = notes.set(at499, 'stable-499', 'last supported note');
assert.strictEqual(Object.keys(with500.notes).length, 500, '499 notes plus one new note reaches the exact supported capacity');
var updatedAtCapacity = notes.set(with500, 'stable-250', 'updated note');
assert.strictEqual(updatedAtCapacity.notes['stable-250'], 'updated note', 'an existing stable ID remains editable at capacity');
var capacitySnapshot = JSON.stringify(updatedAtCapacity);
assert.throws(function () { notes.set(updatedAtCapacity, 'stable-500', 'must be rejected'); }, function (error) {
  return error && error.code === 'PLAYER_NOTES_CAPACITY';
}, 'a new stable ID is rejected at capacity');
assert.strictEqual(JSON.stringify(updatedAtCapacity), capacitySnapshot, 'capacity rejection cannot mutate or evict an existing note');
var afterClear = notes.clear(updatedAtCapacity, 'stable-250');
var afterReplacement = notes.set(afterClear, 'stable-500', 'replacement after explicit clear');
assert.strictEqual(Object.keys(afterReplacement.notes).length, 500);
assert.strictEqual(notes.get(afterReplacement, 'stable-500'), 'replacement after explicit clear');
assert.strictEqual(notes.get(afterReplacement, 'stable-000'), 'note-0', 'clearing and replacing a note preserves every unrelated stable ID');
assert.strictEqual(notes.MAX_PLAYERS, 500, 'the capacity is a public, testable product limit');
console.log('Stable-ID mutable Player Notes persistence and separation tests passed.');
