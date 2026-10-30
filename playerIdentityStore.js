/* DB5 metadata authority. Public callers receive only the raw assigned-name projection. */
(function (root, factory) {
  'use strict';
  var model = root.PokerPlayerIdentity, indexed = root.PokerCareerIndexedStore;
  if (typeof module !== 'undefined' && module.exports) { model = require('./playerIdentity.js'); indexed = require('./careerIndexedStore.js'); }
  var api = factory(model, indexed);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPlayerIdentityStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Model, Indexed) {
  'use strict';
  var NAMESPACE = 'pnhudIdentityV1', MAX_ROWS = Model.LIMITS.players + Model.LIMITS.persons + 1;
  function fail(message) { var error = new Error(message); error.code = 'IDENTITY_INVALID_METADATA'; throw error; }
  function request(r) { return new Promise(function (resolve, reject) { r.onsuccess = function () { resolve(r.result); }; r.onerror = function () { reject(r.error || new Error('Identity read failed')); }; }); }
  function done(tx) { return new Promise(function (resolve, reject) { tx.oncomplete = resolve; tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Identity transaction aborted')); }; }); }
  function key(kind, id) { return id === undefined ? [NAMESPACE, kind] : [NAMESPACE, kind, id]; }
  function rowsFor(state) {
    return [{ key: key('control'), schemaVersion: state.schemaVersion, identityRevision: state.identityRevision }].concat(
      state.players.map(function (row) { return Object.assign({ key: key('player', JSON.parse(Model.rawKey(row.playerId))) }, row); }),
      state.persons.map(function (row) { return Object.assign({ key: key('person', row.personId) }, row); }));
  }
  function stateFor(rows) {
    if (rows.length > MAX_ROWS || new TextEncoder().encode(JSON.stringify(rows)).length > Model.LIMITS.bytes) fail('Identity metadata capacity exceeded');
    if (!rows.length) return Model.empty();
    var state = Model.empty(), controls = 0;
    rows.forEach(function (row) {
      if (!row || !Array.isArray(row.key)) fail('Invalid identity key');
      var copy = Object.assign({}, row); delete copy.key;
      if (JSON.stringify(row.key) === JSON.stringify(key('control'))) {
        if (++controls !== 1 || Object.keys(copy).sort().join('|') !== 'identityRevision|schemaVersion') fail('Invalid identity control');
        state.schemaVersion = copy.schemaVersion; state.identityRevision = copy.identityRevision;
      } else if (row.key[1] === 'player' && JSON.stringify(row.key) === JSON.stringify(key('player', JSON.parse(Model.rawKey(copy.playerId))))) state.players.push(copy);
      else if (row.key[1] === 'person' && JSON.stringify(row.key) === JSON.stringify(key('person', copy.personId))) state.persons.push(copy);
      else fail('Unknown or mismatched identity row');
    });
    if (controls !== 1) fail('Orphan identity metadata has no control');
    state.players.sort(function (a, b) { return Model.rawKey(a.playerId).localeCompare(Model.rawKey(b.playerId)); });
    state.persons.sort(function (a, b) { return a.personId.localeCompare(b.personId); });
    return Model.validate(state);
  }
  function writeNext(store, rows, current, next) {
    var nextRows = rowsFor(next); stateFor(nextRows);
    var old = new Map(rows.map(function (row) { return [JSON.stringify(row.key), row]; }));
    nextRows.forEach(function (row) { var k = JSON.stringify(row.key); if (JSON.stringify(old.get(k)) !== JSON.stringify(row)) store.put(row); old.delete(k); });
    old.forEach(function (row) { store.delete(row.key); });
    // Membership epochs prevent unlink/relink from resurrecting an old certificate.
    // Names and unrelated Person mutations need not invalidate an unchanged membership.
    next.persons.forEach(function (person) {
      var prior = current.persons.find(function (p) { return p.personId === person.personId; });
      if (!prior || JSON.stringify(prior.members) !== JSON.stringify(person.members))
        store.put({ key: ['pnhudIdentityPublishedV1', 'membership', person.personId], schemaVersion: 1, token: Model.createPersonId(globalThis.crypto) });
    });
  }
  async function open(indexedDB) {
    var R = Indexed.routing, db = await R.openDatabase(indexedDB);
    async function transaction(change, playerId) {
      var tx = await R.transaction(db, playerId !== undefined && needsTypedEvidence(playerId) ? [R.controlStore, Indexed.STORES.records] : [R.controlStore], change ? 'readwrite' : 'readonly'), completion = done(tx);
      completion.catch(function () {});
      try {
        var store = tx.objectStore(R.controlStore);
        var rows = await request(store.getAll(IDBKeyRange.bound([NAMESPACE], [NAMESPACE + '\u0000'], false, true), MAX_ROWS + 1));
        var current = stateFor(rows);
        if (playerId !== undefined) await verifyRawPlayer(tx, current, playerId);
        var next = change ? change(current) : current;
        if (change && next.identityRevision !== current.identityRevision) {
          writeNext(store, rows, current, next);
        }
        await completion; return next;
      } catch (error) { try { tx.abort(); } catch (_abort) {} await completion.catch(function () {}); throw error; }
    }
    return Object.freeze({
      read: function () { return transaction(); },
      readAssignedNames: async function () { return assignedNames(await transaction()); },
      readPlayerAssignedName: async function (id) { id = Model.rawId(id); return assignedNames(await transaction(null, id)); },
      setPlayerAssignedName: async function (id, name, revision) {
        id = Model.rawId(id);
        return assignedNames(await transaction(function (state) { return Model.setAssignedName(state, Model.rawTarget(id), name, revision); }, id));
      },
      setAssignedName: async function (target, name, expectedRevision) {
        target = Model.validateTarget(target);
        return transaction(function (state) { return Model.setAssignedName(state, target, name, expectedRevision); });
      },
      linkInternal: async function (ids, expectedRevision, personId) {
        if (Array.isArray(ids)) ids = ids.slice();
        personId = personId === undefined ? Model.createPersonId(globalThis.crypto) : personId;
        return transaction(function (state) { return Model.linkInternal(state, ids, personId, expectedRevision); });
      },
      unlinkInternal: function (personId, id, expectedRevision) { return transaction(function (state) { return Model.unlinkInternal(state, personId, id, expectedRevision); }); },
      close: function () { db.close(); }
    });
  }
  function assignedNames(state) {
    return { identityRevision: state.identityRevision, players: state.players.filter(function (row) { return row.assignedName !== null; })
      .map(function (row) { return { playerId: row.playerId, assignedName: row.assignedName }; }) };
  }
  function needsTypedEvidence(id) {
    return typeof id === 'number' || (typeof id === 'string' && Number.isSafeInteger(Number(id)) && Number(id) >= 0 && String(Number(id)) === id);
  }
  // Only canonical integer spellings can alias a valid numeric raw ID. Normal
  // opaque PokerNow IDs require no Career traversal, regardless of history size.
  function verifyRawPlayer(tx, state, id) {
    var key = Model.rawKey(id), alias = String(id);
    state.players.forEach(function (row) {
      if (String(row.playerId) === alias && Model.rawKey(row.playerId) !== key) {
        var error = new Error('This player ID has conflicting typed identity evidence'); error.code = 'IDENTITY_AMBIGUOUS_ID'; throw error;
      }
    });
    if (!needsTypedEvidence(id)) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var count = 0, cursor = tx.objectStore(Indexed.STORES.records).index('playerIds').openCursor(IDBKeyRange.only(alias));
      cursor.onerror = function () { reject(cursor.error || new Error('Player identity evidence unavailable')); };
      cursor.onsuccess = function () {
        try {
          var entry = cursor.result;
          if (!entry) { resolve(); return; }
          if (++count > 4096) { var limit = new Error('Player identity evidence exceeds the safe name-edit limit'); limit.code = 'IDENTITY_EVIDENCE_LIMIT'; throw limit; }
          var wrapper = entry.value, players = wrapper && wrapper.record && wrapper.record.players;
          if (!Array.isArray(players) || !Array.isArray(wrapper.playerIds) ||
              JSON.stringify(wrapper.playerIds) !== JSON.stringify(players.map(function (p) { return String(p && p.playerId); }))) fail('Invalid player identity evidence');
          players.forEach(function (p) {
            if (String(p && p.playerId) === alias && Model.rawKey(p.playerId) !== key) {
              var error = new Error('This player ID has conflicting typed identity evidence'); error.code = 'IDENTITY_AMBIGUOUS_ID'; throw error;
            }
          });
          entry.continue();
        } catch (error) { reject(error); }
      };
    });
  }
  // Internal native readers share exactly the same strict metadata decoder.
  return Object.freeze({ NAMESPACE: NAMESPACE, open: open, metadata: Object.freeze({ maxRows: MAX_ROWS, stateFor: stateFor, writeNext: writeNext }) });
});
