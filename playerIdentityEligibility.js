/* Internal published-ledger policy. Manual assertions never prove account ownership. */
(function (root, factory) {
  'use strict';
  var model = root.PokerPlayerIdentity, validation = root.PokerPlayerIdentityValidation;
  if (typeof module !== 'undefined' && module.exports) { model = require('./playerIdentity.js'); validation = require('./playerIdentityValidation.js'); }
  var api = factory(model, validation);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPlayerIdentityEligibility = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, V) {
  'use strict';
  var NS = 'pnhudIdentityPublishedV1', POLICY = 'retained-published-career-v1';
  var LIMITS = Object.freeze({ bytes: 65536, sessions: 128, leaseMs: 7 * 24 * 60 * 60 * 1000 });
  function key(kind, id) { return id === undefined ? [NS, kind] : [NS, kind, id]; }
  function exact(row, fields) { return !!row && typeof row === 'object' && (Object.getPrototypeOf(row) === Object.prototype || Object.getPrototypeOf(row) === null) && Object.keys(row).sort().join('|') === fields.split('|').sort().join('|'); }
  function uuid(id) { try { M.personTarget(id); return true; } catch (_) { return false; } }
  function usableRawId(id) { try { M.rawId(id); return true; } catch (_) { return false; } }
  function copy(row) { return JSON.parse(JSON.stringify(row)); }
  function same(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; } }
  function validControl(row, route) {
    return exact(row, 'key|schemaVersion|policy|epoch|route') && same(row.key, key('control')) && row.schemaVersion === 1 && row.policy === POLICY && uuid(row.epoch) && V.sameRoute(row.route, route) && validRoute(row.route);
  }
  function validRoute(route) { return exact(route, 'bank|careerGeneration|ledgerRevision') && V.usableRoute(route) && route.careerGeneration.length <= 500 && route.ledgerRevision.length <= 500; }
  function control(route, epoch) { if (!validRoute(route) || !uuid(epoch)) throw Error('Invalid publication control'); return { key: key('control'), schemaVersion: 1, policy: POLICY, epoch: epoch, route: copy(route) }; }
  function membership(personId, token) { M.personTarget(personId); if (!uuid(token)) throw Error('Invalid membership token'); return { key: key('membership', personId), schemaVersion: 1, token: token }; }
  function validMembership(row, personId) { return exact(row, 'key|schemaVersion|token') && same(row.key, key('membership', personId)) && row.schemaVersion === 1 && uuid(row.token); }
  function validSessions(rows) {
    return Array.isArray(rows) && Object.getPrototypeOf(rows) === Array.prototype && rows.length <= LIMITS.sessions && Object.keys(rows).length === rows.length && new Set(rows.map(function (r) { return r && r.sessionId; })).size === rows.length && rows.every(function (r) {
      if (!exact(r, 'sessionId|namespace') || typeof r.sessionId !== 'string' || r.sessionId.length > 500 || typeof r.namespace !== 'string' || r.namespace.length > 1600) return false;
      try { var parts = JSON.parse(r.namespace); return r.sessionId.length > 0 && Array.isArray(parts) && parts.length === 3 && parts[0] === 'pokernow' && parts.every(function (p) { return typeof p === 'string' && p.length > 0 && p.length <= 500; }) && r.namespace === JSON.stringify(parts); } catch (_) { return false; }
    });
  }
  function validCertificate(saved, personId) {
    try {
      if (!exact(saved, 'key|schemaVersion|policy|personId|members|membershipToken|identityRevision|epoch|route|manualAssertion|complete|pendingOutboxCovered|status|overlaps|unresolved|sessionNamespaces|issuedAt|expiresAt') ||
          !same(saved.key, key('certificate', personId)) || saved.schemaVersion !== 1 || saved.policy !== POLICY || saved.personId !== personId || !uuid(personId) ||
          !uuid(saved.membershipToken) || !uuid(saved.epoch) || !validRoute(saved.route) || !Number.isSafeInteger(saved.identityRevision) || saved.identityRevision < 0 ||
          saved.manualAssertion !== true || saved.complete !== true || saved.pendingOutboxCovered !== false || !validSessions(saved.sessionNamespaces) ||
          !Number.isSafeInteger(saved.issuedAt) || saved.issuedAt < 0 || !Number.isSafeInteger(saved.expiresAt) || saved.expiresAt <= saved.issuedAt || saved.expiresAt - saved.issuedAt > LIMITS.leaseMs ||
          new TextEncoder().encode(JSON.stringify(saved)).length > LIMITS.bytes || !same(V.members(saved.members), saved.members)) return false;
      var state = { identityRevision: saved.identityRevision }, person = { personId: personId, members: saved.members };
      var decoded = V.validity(V.proof(person, state, saved.route, saved), person, state, saved.route);
      return decoded.status === saved.status && same(decoded.overlaps, saved.overlaps) && same(decoded.unresolved, saved.unresolved);
    } catch (_) { return false; }
  }
  function unavailable(reason, status) { return { eligible: false, status: status || 'UNRESOLVED', reason: reason, policy: POLICY, pendingOutboxCovered: false }; }
  function scopedState(person, rows, revision) {
    if (!exact(revision, 'key|schemaVersion|identityRevision') || !same(revision.key, ['pnhudIdentityV1', 'control']) || revision.schemaVersion !== 1) throw Error('Invalid identity control');
    var p = copy(person); delete p.key;
    if (!same(person.key, ['pnhudIdentityV1', 'person', p.personId])) throw Error('Invalid Person key');
    var players = rows.map(function (row) { var raw = copy(row); delete raw.key; if (!same(row.key, ['pnhudIdentityV1', 'player', JSON.parse(M.rawKey(raw.playerId))])) throw Error('Invalid raw key'); return raw; });
    return M.validate({ schemaVersion: 1, identityRevision: revision.identityRevision, players: players, persons: [p] });
  }
  // Sole authority gate: callers must use current routed native metadata, never cached permission.
  function check(state, personId, route, publication, member, saved, now) {
    try { state = M.validate(state); M.personTarget(personId); } catch (_) { return unavailable('INVALID_IDENTITY_METADATA'); }
    var person = state.persons.find(function (p) { return p.personId === personId; });
    if (!person || !person.members.length) return unavailable('UNVALIDATED_MEMBERSHIP');
    if (!saved) return unavailable('MISSING_CERTIFICATE');
    if (saved.policy !== POLICY) return unavailable('WRONG_POLICY');
    if (!validCertificate(saved, personId)) return unavailable('INVALID_CERTIFICATE');
    if (!validMembership(member, personId) || member.token !== saved.membershipToken || !same(person.members, saved.members) || saved.identityRevision > state.identityRevision) return unavailable('MEMBERSHIP_CHANGED');
    if (!validControl(publication, route) || saved.epoch !== publication.epoch || saved.route.bank !== route.bank || saved.route.careerGeneration !== route.careerGeneration) return unavailable('STALE_CAREER_AUTHORITY');
    if (!Number.isSafeInteger(now) || now < saved.issuedAt || now >= saved.expiresAt) return unavailable('EXPIRED_CERTIFICATE');
    if (saved.status !== 'SAFE') return unavailable(saved.status === 'CONFLICTING' ? 'PUBLISHED_OVERLAP' : 'REVALIDATION_REQUIRED', saved.status);
    var names = M.resolveDisplayName(state, M.personTarget(personId), '');
    if (!person.assignedName && names.conflictingAssignedNames.length > 1) return unavailable('ASSIGNED_NAME_CONFLICT');
    return { eligible: true, status: 'SAFE', reason: 'VALID_PUBLISHED_CERTIFICATE', policy: POLICY, pendingOutboxCovered: false,
      personId: personId, members: person.members.slice(), identityRevision: state.identityRevision, route: copy(route), membershipToken: member.token, epoch: publication.epoch, expiresAt: saved.expiresAt };
  }
  function certificate(person, state, route, publication, member, evidence, sessions, now) {
    var saved = { key: key('certificate', person.personId), schemaVersion: 1, policy: POLICY, personId: person.personId, members: person.members.slice(), membershipToken: member.token,
      identityRevision: state.identityRevision, epoch: publication.epoch, route: copy(route), manualAssertion: true, complete: true, pendingOutboxCovered: false,
      status: evidence.status, overlaps: copy(evidence.overlaps), unresolved: copy(evidence.unresolved), sessionNamespaces: copy(sessions), issuedAt: now, expiresAt: now + LIMITS.leaseMs };
    if (!validCertificate(saved, person.personId)) throw Error('Invalid or over-budget published certificate');
    return saved;
  }
  // A complete accepted canonical group extends a previously complete SAFE base.
  // Unresolved/conflicting bases never become SAFE by inspecting just one hand.
  function advance(saved, state, personId, before, after, publication, member, records, record, supersession, now) {
    var person = state.persons.find(function (p) { return p.personId === personId; }), gate = check(state, personId, before, publication, member, saved, now);
    if (!person) return null;
    if (!validCertificate(saved, personId)) return null;
    var evidence = V.group(person.members, record.handKey, records, true), next = copy(saved);
    next.route = copy(after);
    if (evidence.status === 'CONFLICTING') { next.status = 'CONFLICTING'; next.overlaps = evidence.overlaps; next.unresolved = []; }
    else if (!supersession && gate.reason === 'PUBLISHED_OVERLAP') {
      var combined = V.summarize([saved, evidence]); next.status = combined.status; next.overlaps = combined.overlaps; next.unresolved = combined.unresolved;
    }
    else if (!gate.eligible || supersession || evidence.status !== 'SAFE') {
      next.status = 'UNRESOLVED'; next.overlaps = []; next.unresolved = [V.issue(supersession ? 'SUPERSESSION_REVALIDATE' : 'INCOMPLETE_INCREMENTAL_EVIDENCE')];
    } else {
      var sessions = new Map(next.sessionNamespaces.map(function (s) { return [s.sessionId, s.namespace]; }));
      if (record.schemaVersion >= 4 && record.session.sessionId !== null) {
        var id = record.session.sessionId, namespace = JSON.stringify([record.namespace.provider, record.namespace.host, record.namespace.gameId]);
        if (sessions.has(id) && sessions.get(id) !== namespace) { next.status = 'UNRESOLVED'; next.unresolved = [V.issue('CONTRADICTORY_SESSION_NAMESPACE')]; }
        else { sessions.set(id, namespace); next.sessionNamespaces = Array.from(sessions, function (entry) { return { sessionId: entry[0], namespace: entry[1] }; }); }
      }
    }
    // Do not extend the lease by hand delivery. Bound witness growth, then require a full scan.
    if (!validCertificate(next, personId)) { next.sessionNamespaces = []; next.status = 'UNRESOLVED'; next.overlaps = []; next.unresolved = [V.issue('INCREMENTAL_METADATA_BUDGET')]; }
    return validCertificate(next, personId) ? next : null;
  }
  return Object.freeze({ NAMESPACE: NS, POLICY: POLICY, LIMITS: LIMITS, key: key, control: control, validControl: validControl, membership: membership,
    validMembership: validMembership, validCertificate: validCertificate, usableRawId: usableRawId, scopedState: scopedState, check: check, certificate: certificate, advance: advance });
});
