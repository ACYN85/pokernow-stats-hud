/* B3-N2 dormant native notes owner. Not imported by the production manifest/worker.
 * Legacy acquisition requires externally established writer exclusion; this API
 * does not freeze Chrome storage or authorize a production migration. */
(function (root, factory) {
  'use strict';
  var indexed = root.PokerCareerIndexedStore;
  if (typeof module !== 'undefined' && module.exports) indexed = require('./careerIndexedStore');
  var api = factory(indexed);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPlayerNotesNative = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Indexed) {
  'use strict';
  var NS = 'pnhudNotesV1', KEY = 'pokerNowHudPlayerNotesV1';
  var LIMITS = Object.freeze({ notes: 500, legacyNotes: 501, key: 500, text: 5000, bytes: 36 * 1024 * 1024 });
  var MAX_ROWS = 1 + 2 * LIMITS.legacyNotes;
  function fail(code, text) { var e = new Error(text); e.code = code; throw e; }
  function shape(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== keys.slice().sort().join('|'))
      fail('NOTES_INVALID', 'Unsupported notes shape. Original data must be preserved.');
  }
  function key(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > LIMITS.key || /[\u0000-\u001f\u007f]/.test(value))
      fail('NOTES_INVALID_KEY', 'An exact legacy string key is required; no conversion is performed.');
    return value;
  }
  function text(value) {
    if (typeof value !== 'string' || value.length > LIMITS.text) fail('NOTES_INVALID_TEXT', 'Note text exceeds the supported exact limit.');
    return value;
  }
  function entries(value) {
    if (!Array.isArray(value) || value.length > LIMITS.legacyNotes) fail('NOTES_CAPACITY', 'Legacy note population exceeds the supported bound.');
    var prior = null;
    return value.map(function (pair) {
      if (!Array.isArray(pair) || pair.length !== 2) fail('NOTES_INVALID', 'Invalid note entry.');
      var id = key(pair[0]);
      if (prior !== null && prior >= id) fail('NOTES_INVALID', 'Duplicate or unordered note keys.');
      prior = id; return [id, text(pair[1])];
    });
  }
  function legacy(saved) {
    if (saved === undefined) return { present: false, entries: [] };
    shape(saved, ['version', 'notes']);
    if (saved.version !== 1 || !saved.notes || typeof saved.notes !== 'object' || Array.isArray(saved.notes)) fail('NOTES_INVALID', 'Unsupported legacy note data.');
    return { present: true, entries: entries(Object.keys(saved.notes).sort().map(function (id) { return [id, saved.notes[id]]; })) };
  }
  function empty() { return { schemaVersion: 1, revision: null, status: 'unacquired', source: null, entries: [] }; }
  function validate(value) {
    shape(value, ['schemaVersion', 'revision', 'status', 'source', 'entries']);
    if (value.schemaVersion !== 1 || !['unacquired', 'active', 'suspended'].includes(value.status)) fail('NOTES_INVALID', 'Unsupported native notes state.');
    var result = { schemaVersion: 1, revision: value.revision, status: value.status, source: null, entries: entries(value.entries) };
    if (value.status === 'unacquired') {
      if (value.revision !== null || value.source !== null || result.entries.length) fail('NOTES_INVALID', 'Invalid unacquired notes.');
    } else {
      if (typeof value.revision !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.revision)) fail('NOTES_INVALID', 'Invalid notes revision.');
      shape(value.source, ['present', 'entries']);
      if (typeof value.source.present !== 'boolean') fail('NOTES_INVALID', 'Missing legacy presence evidence.');
      result.source = { present: value.source.present, entries: entries(value.source.entries) };
      if (!result.source.present && result.source.entries.length) fail('NOTES_INVALID', 'Absent source has entries.');
    }
    if (new TextEncoder().encode(JSON.stringify(result)).length > LIMITS.bytes) fail('NOTES_CAPACITY', 'Native notes byte limit exceeded.');
    return result;
  }
  function apply(current, operation, revision) {
    current = validate(current);
    var fields = { acquire: ['kind', 'expectedRevision', 'source'], write: ['kind', 'expectedRevision', 'key', 'text'],
      delete: ['kind', 'expectedRevision', 'key'], suspend: ['kind', 'expectedRevision'] };
    if (!operation || !Object.hasOwn(fields, operation.kind)) fail('NOTES_INVALID', 'Unknown notes operation.');
    shape(operation, fields[operation.kind]);
    if (operation.expectedRevision !== current.revision) fail('NOTES_CAS_CONFLICT', 'Notes changed. Read authoritative state before reviewing another edit.');
    if (operation.kind === 'suspend') {
      if (current.status === 'unacquired') fail('NOTES_UNACQUIRED', 'No native note acquisition exists.');
      if (current.status === 'suspended') return current;
      current.status = 'suspended';
    } else if (operation.kind === 'acquire') {
      var source = legacy(operation.source);
      if (current.status === 'suspended') fail('NOTES_SUSPENDED', 'Legacy writer interference requires independent recovery review.');
      if (current.status === 'active') {
        if (JSON.stringify(current.source) !== JSON.stringify(source)) fail('NOTES_SOURCE_CHANGED', 'Legacy notes differ from the acquired original. No replacement was applied.');
        return current; // Re-acquisition never replays the original over native edits.
      }
      current.source = source; current.entries = source.entries.map(function (pair) { return pair.slice(); }); current.status = 'active';
    } else {
      if (current.status !== 'active') fail(current.status === 'suspended' ? 'NOTES_SUSPENDED' : 'NOTES_UNACQUIRED', 'Native note editing is unavailable.');
      var id = key(operation.key), found = current.entries.findIndex(function (pair) { return pair[0] === id; });
      if (operation.kind === 'delete') { if (found < 0) return current; current.entries.splice(found, 1); }
      else {
        var note = text(operation.text);
        if (found < 0 && current.entries.length >= LIMITS.notes) fail('NOTES_CAPACITY', 'Clear an existing note before adding another.');
        if (found >= 0 && current.entries[found][1] === note) return current;
        if (found < 0) current.entries.push([id, note]); else current.entries[found] = [id, note];
        current.entries.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
      }
    }
    current.revision = revision;
    return validate(current);
  }
  function request(r) { return new Promise(function (resolve, reject) { r.onsuccess = function () { resolve(r.result); }; r.onerror = function () { reject(r.error || Error('Native notes request failed')); }; }); }
  function done(tx) { return new Promise(function (resolve, reject) { tx.oncomplete = resolve; tx.onerror = tx.onabort = function () { reject(tx.error || Error('Native notes transaction aborted')); }; }); }
  function rowsFor(value) {
    var state = validate(value);
    if (state.status === 'unacquired') return [];
    return [{ key: [NS, 'control'], schemaVersion: 1, revision: state.revision, status: state.status,
      sourcePresent: state.source.present, sourceCount: state.source.entries.length, count: state.entries.length }].concat(
      state.entries.map(function (p) { return { key: [NS, 'note', p[0]], text: p[1] }; }),
      state.source.entries.map(function (p) { return { key: [NS, 'source', p[0]], text: p[1] }; }));
  }
  function stateFor(rows) {
    if (!rows.length) return empty();
    if (rows.length > MAX_ROWS) fail('NOTES_CAPACITY', 'Native notes row limit exceeded.');
    var control, notes = [], source = [];
    rows.forEach(function (row) {
      if (!row || !Array.isArray(row.key) || row.key[0] !== NS) fail('NOTES_INVALID', 'Invalid native notes namespace.');
      if (row.key.length === 2 && row.key[1] === 'control') {
        if (control) fail('NOTES_INVALID', 'Duplicate notes control.');
        shape(row, ['key', 'schemaVersion', 'revision', 'status', 'sourcePresent', 'sourceCount', 'count']); control = row;
      } else if (row.key.length === 3 && (row.key[1] === 'note' || row.key[1] === 'source')) {
        shape(row, ['key', 'text']); (row.key[1] === 'note' ? notes : source).push([row.key[2], row.text]);
      } else fail('NOTES_INVALID', 'Unknown native notes row.');
    });
    if (!control || control.count !== notes.length || control.sourceCount !== source.length || control.status === 'unacquired') fail('NOTES_INVALID', 'Incomplete native notes authority.');
    return validate({ schemaVersion: control.schemaVersion, revision: control.revision, status: control.status,
      source: { present: control.sourcePresent, entries: source }, entries: notes });
  }
  async function readStore(store) {
    return stateFor(await request(store.getAll(IDBKeyRange.bound([NS], [NS + '\u0000'], false, true), MAX_ROWS + 1)));
  }
  // Composable ONLY inside the caller's native transaction. The returned value
  // is provisional until that transaction's actual oncomplete, never an ACK.
  async function changeStore(store, operation) {
    var before = await readStore(store), after = apply(before, operation, globalThis.crypto.randomUUID());
    var old = new Map(rowsFor(before).map(function (r) { return [JSON.stringify(r.key), r]; }));
    rowsFor(after).forEach(function (row) {
      var k = JSON.stringify(row.key);
      if (JSON.stringify(old.get(k)) !== JSON.stringify(row)) store.put(row);
      old.delete(k);
    });
    old.forEach(function (row) { store.delete(row.key); });
    return after;
  }
  // Private native Backup publication only. Retain THIS profile's acquisition
  // evidence; imported revisions/source claims never establish authority.
  async function restoreStore(store, importedEntries, expectedRevision) {
    var before = await readStore(store);
    if (before.revision !== expectedRevision) fail('NOTES_CAS_CONFLICT', 'Notes changed during import review.');
    if (before.status !== 'active') fail('NOTES_SUSPENDED', 'Verified local notes acquisition is required.');
    var after = validate(Object.assign({}, before, { revision: globalThis.crypto.randomUUID(), entries: importedEntries }));
    var old = new Map(rowsFor(before).map(function (r) { return [JSON.stringify(r.key), r]; }));
    rowsFor(after).forEach(function (r) { store.put(r); old.delete(JSON.stringify(r.key)); });
    old.forEach(function (r) { store.delete(r.key); });
    return after; // Provisional until the caller's common native oncomplete.
  }
  async function open(indexedDB) {
    var R = Indexed.routing, db = await R.openDatabase(indexedDB);
    async function transaction(operation) {
      var tx = await R.transaction(db, [R.controlStore], operation ? 'readwrite' : 'readonly'), completion = done(tx);
      completion.catch(function () {});
      try {
        var store = tx.objectStore(R.controlStore), result = operation ? await changeStore(store, operation) : await readStore(store);
        await completion; return result;
      } catch (e) { try { tx.abort(); } catch (_alreadyEnded) {} await completion.catch(function () {}); throw e; }
    }
    return Object.freeze({ read: function () { return transaction(); },
      acquire: function (source, expectedRevision) { return transaction({ kind: 'acquire', source: source, expectedRevision: expectedRevision }); },
      write: function (id, note, expectedRevision) { return transaction({ kind: 'write', key: id, text: note, expectedRevision: expectedRevision }); },
      remove: function (id, expectedRevision) { return transaction({ kind: 'delete', key: id, expectedRevision: expectedRevision }); },
      suspend: function (expectedRevision) { return transaction({ kind: 'suspend', expectedRevision: expectedRevision }); }, close: function () { db.close(); } });
  }
  return Object.freeze({ NAMESPACE: NS, LEGACY_KEY: KEY, LIMITS: LIMITS, legacy: legacy, empty: empty, validate: validate, apply: apply, open: open,
    metadata: Object.freeze({ read: readStore, change: changeStore, restore: restoreStore, rowsFor: rowsFor, stateFor: stateFor, maxRows: MAX_ROWS }) });
});
