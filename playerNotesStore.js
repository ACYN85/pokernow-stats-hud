/* Mutable player notes keyed only by canonical stable player ID. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPlayerNotesStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var VERSION = 1;
  var MAX_NOTE_LENGTH = 5000;
  var MAX_PLAYERS = 500;
  var MAX_LEGACY_PLAYERS = MAX_PLAYERS + 1;

  function stableId(value) {
    value = String(value === undefined || value === null ? '' : value).trim();
    return value && value.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
  }
  function normalize(saved) {
    var source = saved && saved.version === VERSION && saved.notes && typeof saved.notes === 'object' && !Array.isArray(saved.notes) ? saved.notes : {};
    var notes = {};
    Object.keys(source).sort().forEach(function (id) {
      var canonicalId = stableId(id); var note = source[id];
      if (Object.keys(notes).length < MAX_LEGACY_PLAYERS && canonicalId && typeof note === 'string' && note.length) notes[canonicalId] = note.slice(0, MAX_NOTE_LENGTH);
    });
    return { version: VERSION, notes: notes };
  }
  function get(state, playerId) { var id = stableId(playerId); return id && state && state.notes && state.notes[id] || ''; }
  function set(state, playerId, note) {
    var id = stableId(playerId); if (!id) throw new TypeError('canonical stable player ID is required');
    var next = normalize(state); var text = String(note === undefined || note === null ? '' : note).slice(0, MAX_NOTE_LENGTH);
    if (text && !Object.prototype.hasOwnProperty.call(next.notes, id) && Object.keys(next.notes).length >= MAX_PLAYERS) {
      var capacityError = new RangeError('Player note limit reached (' + MAX_PLAYERS + '). Clear an existing note before adding another.');
      capacityError.code = 'PLAYER_NOTES_CAPACITY';
      throw capacityError;
    }
    if (text) next.notes[id] = text; else delete next.notes[id];
    return next;
  }
  function has(state, playerId) { return Boolean(get(state, playerId)); }
  return Object.freeze({ VERSION: VERSION, MAX_NOTE_LENGTH: MAX_NOTE_LENGTH, MAX_PLAYERS: MAX_PLAYERS, normalize: normalize, get: get, set: set, clear: function (state, id) { return set(state, id, ''); }, has: has, stableId: stableId });
});
