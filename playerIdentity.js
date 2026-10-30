/* Local identity metadata only. Persons remain unvalidated; no statistical resolver. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPlayerIdentity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var SCHEMA_VERSION = 1;
  var LIMITS = Object.freeze({ players: 1024, persons: 256, members: 32, idLength: 500, nameLength: 200, bytes: 1024 * 1024 });
  function fail(code, message) { var error = new Error(message); error.code = code; throw error; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function exact(value, fields) {
    if (!value || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
        Object.keys(value).sort().join('|') !== fields.slice().sort().join('|'))
      fail('IDENTITY_INVALID_METADATA', 'Unexpected identity fields');
  }
  function text(value, max) {
    if (typeof value !== 'string' || !value || value.length > max || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return false;
    // Reject lone surrogates: IDs and names must survive JSON/UTF-8 unchanged.
    for (var i = 0; i < value.length; i += 1) {
      var c = value.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) { var next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
      else if (c >= 0xdc00 && c <= 0xdfff) return false;
    }
    return true;
  }
  function rawId(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)) return value;
    if (text(value, LIMITS.idLength) && !/^(null|undefined|gameplayer)$/i.test(value)) return value;
    fail('IDENTITY_INVALID_ID', 'A usable original string or safe integer PokerNow ID is required');
  }
  function rawKey(value) { rawId(value); return JSON.stringify([typeof value, value]); }
  function personId(value) {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))
      fail('IDENTITY_INVALID_PERSON', 'A lowercase UUID v4 Person ID is required');
    return value;
  }
  function createPersonId(cryptoProvider) {
    if (!cryptoProvider || typeof cryptoProvider.randomUUID !== 'function') fail('IDENTITY_UUID_UNAVAILABLE', 'Secure UUID generation is required');
    return personId(cryptoProvider.randomUUID());
  }
  function rawTarget(value) { return { kind: 'player', playerId: rawId(value) }; }
  function personTarget(value) { return { kind: 'person', personId: personId(value) }; }
  function target(value) {
    if (value && value.kind === 'player') { exact(value, ['kind', 'playerId']); return rawTarget(value.playerId); }
    if (value && value.kind === 'person') { exact(value, ['kind', 'personId']); return personTarget(value.personId); }
    fail('IDENTITY_INVALID_TARGET', 'Explicit player or Person target is required');
  }
  function name(value) {
    if (value === null || value === '') return null;
    if (typeof value !== 'string') fail('IDENTITY_INVALID_NAME', 'Assigned name must be text or null');
    value = value.trim();
    if (!value) return null;
    if (!text(value, LIMITS.nameLength)) fail('IDENTITY_INVALID_NAME', 'Assigned name is invalid or too long');
    return value;
  }
  function empty() { return { schemaVersion: SCHEMA_VERSION, identityRevision: 0, players: [], persons: [] }; }
  function list(value, max) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || Object.keys(value).length !== value.length) return false;
    for (var i = 0; i < value.length; i += 1) if (!Object.prototype.hasOwnProperty.call(value, i)) return false;
    return true;
  }
  function validate(state) {
    exact(state, ['schemaVersion', 'identityRevision', 'players', 'persons']);
    if (state.schemaVersion !== SCHEMA_VERSION || !Number.isSafeInteger(state.identityRevision) || state.identityRevision < 0 ||
        !list(state.players, LIMITS.players) || !list(state.persons, LIMITS.persons))
      fail('IDENTITY_INVALID_METADATA', 'Invalid identity schema, revision or capacity');
    var players = new Map(), persons = new Map(), aliases = new Map(), membership = new Map();
    state.players.forEach(function (row) {
      exact(row, ['playerId', 'personId', 'assignedName']); var key = rawKey(row.playerId), alias = String(row.playerId);
      if (players.has(key)) fail('IDENTITY_DUPLICATE_MEMBER', 'Duplicate raw identity');
      if (aliases.has(alias) && aliases.get(alias) !== key) fail('IDENTITY_AMBIGUOUS_ID', 'Numeric/string ID alias requires authoritative resolution');
      aliases.set(alias, key); players.set(key, row);
      if (row.personId !== null) personId(row.personId);
      if (name(row.assignedName) !== row.assignedName) fail('IDENTITY_INVALID_METADATA', 'Noncanonical assigned name');
    });
    state.persons.forEach(function (row) {
      exact(row, ['personId', 'members', 'assignedName', 'validation']); personId(row.personId);
      if (persons.has(row.personId) || row.validation !== 'unvalidated' || !list(row.members, LIMITS.members))
        fail('IDENTITY_INVALID_METADATA', 'Invalid Person or unvalidated membership state');
      if (name(row.assignedName) !== row.assignedName) fail('IDENTITY_INVALID_METADATA', 'Noncanonical Person name');
      persons.set(row.personId, row);
      row.members.forEach(function (id) {
        var key = rawKey(id), raw = players.get(key);
        if (membership.has(key)) fail('IDENTITY_DUPLICATE_MEMBER', 'A raw ID belongs to at most one Person');
        membership.set(key, row.personId);
        if (!raw || raw.personId !== row.personId) fail('IDENTITY_INVALID_METADATA', 'Forward/reverse membership disagreement');
      });
    });
    state.players.forEach(function (row) {
      if (row.personId !== null && (!persons.has(row.personId) || membership.get(rawKey(row.playerId)) !== row.personId))
        fail('IDENTITY_INVALID_METADATA', 'Reverse/forward membership disagreement');
    });
    if (new TextEncoder().encode(JSON.stringify(state)).length > LIMITS.bytes) fail('IDENTITY_CAPACITY', 'Identity metadata byte limit exceeded');
    return clone(state);
  }
  function expectRevision(state, expected) {
    if (!Number.isSafeInteger(expected) || expected < 0 || expected !== state.identityRevision)
      fail('IDENTITY_REVISION_CONFLICT', 'Identity changed; reread before retrying');
  }
  function playerRow(state, id) { var key = rawKey(id); return state.players.find(function (row) { return rawKey(row.playerId) === key; }); }
  function personRow(state, id) { personId(id); return state.persons.find(function (row) { return row.personId === id; }); }
  function ensurePlayer(state, id) {
    var row = playerRow(state, id);
    if (!row) { row = { playerId: id, personId: null, assignedName: null }; state.players.push(row); }
    return row;
  }
  function finish(previous, next) {
    next.players = next.players.filter(function (row) { return row.personId !== null || row.assignedName !== null; });
    next.players.sort(function (a, b) { return rawKey(a.playerId).localeCompare(rawKey(b.playerId)); });
    next.persons.sort(function (a, b) { return a.personId.localeCompare(b.personId); });
    next.persons.forEach(function (row) { row.members.sort(function (a, b) { return rawKey(a).localeCompare(rawKey(b)); }); });
    if (JSON.stringify(previous) === JSON.stringify(next)) return next;
    if (previous.identityRevision === Number.MAX_SAFE_INTEGER) fail('IDENTITY_REVISION_EXHAUSTED', 'Identity revision exhausted');
    next.identityRevision += 1;
    return validate(next);
  }
  function setAssignedName(state, requestedTarget, assignedName, expected) {
    var previous = validate(state); expectRevision(previous, expected);
    var next = clone(previous), t = target(requestedTarget), value = name(assignedName), row;
    if (t.kind === 'player') row = ensurePlayer(next, t.playerId);
    else { row = personRow(next, t.personId); if (!row) fail('IDENTITY_PERSON_NOT_FOUND', 'Person does not exist'); }
    row.assignedName = value; return finish(previous, next);
  }
  // Internal foundation primitive only: this operation cannot certify grouping.
  function linkInternal(state, ids, id, expected) {
    var previous = validate(state); expectRevision(previous, expected); personId(id);
    if (!list(ids, LIMITS.members) || !ids.length) fail('IDENTITY_INVALID_METADATA', 'Bounded nonempty member list required');
    var keys = new Set(); ids.forEach(function (raw) { var key = rawKey(raw); if (keys.has(key)) fail('IDENTITY_DUPLICATE_MEMBER', 'Duplicate link input'); keys.add(key); });
    var next = clone(previous), person = personRow(next, id);
    if (!person) { person = { personId: id, members: [], assignedName: null, validation: 'unvalidated' }; next.persons.push(person); }
    ids.forEach(function (raw) {
      var row = ensurePlayer(next, raw);
      if (row.personId !== null && row.personId !== id) fail('IDENTITY_MEMBERSHIP_CONFLICT', 'Raw ID already belongs to another Person');
      if (row.personId === null) { row.personId = id; person.members.push(raw); }
    });
    return finish(previous, next);
  }
  function unlinkInternal(state, id, raw, expected) {
    var previous = validate(state); expectRevision(previous, expected);
    var next = clone(previous), person = personRow(next, id), row = playerRow(next, raw), key = rawKey(raw);
    if (!person || !row || row.personId !== id) fail('IDENTITY_MEMBERSHIP_CONFLICT', 'Raw ID is not a member of this Person');
    person.members = person.members.filter(function (member) { return rawKey(member) !== key; }); row.personId = null;
    // Keep even an empty Person: its UUID/name survive detach/relink.
    return finish(previous, next);
  }
  function resolveDisplayName(state, requestedTarget, nativeName) {
    state = validate(state); var t = target(requestedTarget), assigned = null, source = 'native', conflicts = [];
    nativeName = typeof nativeName === 'string' ? nativeName : '';
    if (t.kind === 'player') { var raw = playerRow(state, t.playerId); assigned = raw && raw.assignedName; if (assigned) source = 'raw-assigned'; }
    else {
      var person = personRow(state, t.personId); if (!person) fail('IDENTITY_PERSON_NOT_FOUND', 'Person does not exist');
      var names = Array.from(new Set(person.members.map(function (id) { return playerRow(state, id).assignedName; }).filter(Boolean)));
      conflicts = names.length > 1 ? names : [];
      if (person.assignedName) { assigned = person.assignedName; source = 'person-assigned'; }
      else if (names.length === 1) { assigned = names[0]; source = 'raw-inherited'; }
    }
    return { target: t, displayName: assigned || nativeName, nativeName: nativeName, assignedName: assigned || null,
      nameSource: source, conflictingAssignedNames: conflicts, identityRevision: state.identityRevision };
  }
  return Object.freeze({ SCHEMA_VERSION: SCHEMA_VERSION, LIMITS: LIMITS, empty: empty, validate: validate, rawId: rawId, rawKey: rawKey,
    rawTarget: rawTarget, personTarget: personTarget, validateTarget: target, createPersonId: createPersonId, setAssignedName: setAssignedName,
    linkInternal: linkInternal, unlinkInternal: unlinkInternal, resolveDisplayName: resolveDisplayName });
});
