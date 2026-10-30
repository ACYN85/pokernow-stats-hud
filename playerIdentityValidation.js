/* Retained Career evidence only. SAFE never asserts common account ownership. */
(function (root, factory) {
  'use strict';
  var model = root.PokerPlayerIdentity, aggregator = root.PokerCareerStatsAggregator;
  if (typeof module !== 'undefined' && module.exports) { model = require('./playerIdentity.js'); aggregator = require('./careerStatsAggregator.js'); }
  var api = factory(model, aggregator);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPlayerIdentityValidation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Model, Aggregator) {
  'use strict';
  var LIMITS = Object.freeze({ page: 128, candidates: 32768, groups: 4096, peers: 32, bytes: 2 * 1024 * 1024, evidence: 32, deadlineMs: 15000 });
  var NAMESPACE = 'pnhudIdentityValidationV1';
  function fail(code, message) { var e = new Error(message); e.code = code; throw e; }
  function members(ids) {
    // Reuse the foundation's exact typed-ID, exclusivity and capacity validation.
    return Model.linkInternal(Model.empty(), ids, '00000000-0000-4000-8000-000000000001', 0).persons[0].members;
  }
  function sameRoute(a, b) { return !!a && !!b && a.bank === b.bank && a.careerGeneration === b.careerGeneration && a.ledgerRevision === b.ledgerRevision; }
  function usableRoute(route) { return !!route && ['A', 'B'].indexOf(route.bank) >= 0 && typeof route.careerGeneration === 'string' && !!route.careerGeneration && typeof route.ledgerRevision === 'string' && !!route.ledgerRevision; }
  function issue(code, handKey) { return handKey === undefined ? { code: code } : { code: code, handKey: handKey }; }
  function group(ids, handKey, records, complete) {
    ids = members(ids);
    var result = { status: 'SAFE', overlaps: [], unresolved: [] };
    function unresolved(code) { result.unresolved.push(issue(code, handKey)); result.status = 'UNRESOLVED'; return result; }
    if (!complete) return unresolved('INCOMPLETE_PEERS');
    if (!Array.isArray(records) || !records.length || records.length > LIMITS.peers) return unresolved('PEER_BUDGET_OR_MISSING_GROUP');
    if (new TextEncoder().encode(JSON.stringify(records)).length > LIMITS.bytes) return unresolved('GROUP_BYTE_BUDGET');
    var aliases = new Map(ids.map(function (id) { return [String(id), Model.rawKey(id)]; }));
    for (var record of records) {
      if (Aggregator.validateRecord(record)) return unresolved('INVALID_PHYSICAL_RECORD');
      if (typeof record.handKey !== 'string' || typeof record.authoritativeHandId !== 'string' ||
          record.handKey.length > 2048 || record.authoritativeHandId.length > 500 ||
          typeof record.namespace.host !== 'string' || typeof record.namespace.gameId !== 'string' ||
          record.namespace.host.length > 500 || record.namespace.gameId.length > 500) return unresolved('AMBIGUOUS_CANONICAL_IDENTITY');
      for (var player of record.players) {
        try {
          var key = Model.rawKey(player.playerId);
          if (aliases.has(String(player.playerId)) && aliases.get(String(player.playerId)) !== key) return unresolved('TYPED_ID_ALIAS');
        } catch (_invalid) { return unresolved('INVALID_RAW_ID'); }
      }
    }
    var resolved = Aggregator.resolveActiveRecords(records);
    if (resolved.rejectedRecords.length || resolved.quarantinedHandKeys.length) return unresolved('QUARANTINED_OR_MISSING_AUTHORITY');
    var active = resolved.activeRecords.find(function (record) { return record.handKey === handKey; });
    if (!active) return unresolved('MISSING_ACTIVE_HAND');
    // Provenance contradictions are authority failures even when counters match.
    var own = records.filter(function (record) { return record.handKey === handKey; });
    if (own.some(function (record) { return record.authoritativeHandId !== active.authoritativeHandId || record.namespace.host !== active.namespace.host || record.namespace.gameId !== active.namespace.gameId; }))
      return unresolved('CONTRADICTORY_CANONICAL_IDENTITY');
    var keys = new Set(ids.map(Model.rawKey));
    var positive = active.players.filter(function (player) { return keys.has(Model.rawKey(player.playerId)) && player.counters.hands > 0; }).map(function (player) { return player.playerId; });
    if (positive.length > 1) { result.status = 'CONFLICTING'; result.overlaps.push({ handKey: handKey, playerIds: positive }); }
    return result;
  }
  function summarize(parts, incomplete) {
    var overlaps = [], unresolved = [], conflict = false, unknown = !!incomplete;
    parts.forEach(function (part) {
      conflict = conflict || part.status === 'CONFLICTING'; unknown = unknown || part.status === 'UNRESOLVED';
      overlaps = overlaps.concat(part.overlaps || []).slice(0, LIMITS.evidence);
      unresolved = unresolved.concat(part.unresolved || []).slice(0, LIMITS.evidence);
    });
    if (incomplete && unresolved.length < LIMITS.evidence) unresolved.push(issue(incomplete));
    return { status: conflict ? 'CONFLICTING' : unknown ? 'UNRESOLVED' : 'SAFE', overlaps: overlaps, unresolved: unresolved };
  }
  function proposal(state, ids, personId) {
    state = Model.validate(state); ids = members(ids); Model.personTarget(personId);
    var next = Model.linkInternal(state, ids, personId, state.identityRevision);
    var proposed = next.persons.find(function (person) { return person.personId === personId; });
    var names = Model.resolveDisplayName(next, Model.personTarget(personId), '');
    return { personId: personId, rawIds: ids, proposedMembers: proposed.members,
      currentGroups: state.persons, currentRawIds: state.players, assignedName: proposed.assignedName,
      nameConflicts: names.conflictingAssignedNames, requiresExplicitNameResolution: !proposed.assignedName && names.conflictingAssignedNames.length > 1 };
  }
  function requireFresh(preview, state, route) {
    if (!preview || preview.identityRevision !== state.identityRevision) fail('IDENTITY_REVISION_CONFLICT', 'Identity changed; create another preview');
    if (!usableRoute(route) || !sameRoute(preview.route, route)) fail('IDENTITY_STALE_PREVIEW', 'Career changed; create another preview');
  }
  function proof(person, state, route, evidence) {
    var saved = { key: [NAMESPACE, person.personId], schemaVersion: 1, personId: person.personId, members: person.members.slice(),
      identityRevision: state.identityRevision, route: Object.assign({}, route), status: evidence.status,
      overlaps: evidence.overlaps, unresolved: evidence.unresolved, combinedAvailable: false };
    if (new TextEncoder().encode(JSON.stringify(saved)).length > 65536) {
      saved.status = 'UNRESOLVED'; saved.overlaps = []; saved.unresolved = [issue('EVIDENCE_STORAGE_BUDGET')];
    }
    return saved;
  }
  function validity(saved, person, state, route) {
    // A corrupt or stale sidecar cannot confer safety. Combined consumers stay disabled.
    if (!saved || Object.keys(saved).sort().join('|') !== 'combinedAvailable|identityRevision|key|members|overlaps|personId|route|schemaVersion|status|unresolved' ||
        JSON.stringify(saved.key) !== JSON.stringify([NAMESPACE, person.personId]) || !usableRoute(saved.route) ||
        saved.schemaVersion !== 1 || saved.personId !== person.personId || saved.identityRevision !== state.identityRevision ||
        !sameRoute(saved.route, route) || JSON.stringify(saved.members) !== JSON.stringify(person.members) ||
        ['SAFE', 'CONFLICTING', 'UNRESOLVED'].indexOf(saved.status) < 0 || saved.combinedAvailable !== false ||
        !Array.isArray(saved.overlaps) || !Array.isArray(saved.unresolved) || saved.overlaps.length > LIMITS.evidence || saved.unresolved.length > LIMITS.evidence ||
        new TextEncoder().encode(JSON.stringify(saved)).length > 65536 || !validEvidence(saved, person.members))
      return { status: 'UNRESOLVED', overlaps: [], unresolved: [issue('MISSING_STALE_OR_INVALID_VALIDATION')], combinedAvailable: false };
    // This is retained-evidence status, never an activation certificate.
    return { status: saved.status, overlaps: saved.overlaps, unresolved: saved.unresolved, combinedAvailable: false };
  }
  function validEvidence(saved, ids) {
    try {
      if (Object.keys(saved.overlaps).length !== saved.overlaps.length || Object.keys(saved.unresolved).length !== saved.unresolved.length) return false;
      if (saved.status === 'SAFE' && (saved.overlaps.length || saved.unresolved.length)) return false;
      if (saved.status === 'CONFLICTING' && !saved.overlaps.length || saved.status === 'UNRESOLVED' && !saved.unresolved.length) return false;
      var keys = new Set(ids.map(Model.rawKey));
      if (saved.overlaps.some(function (row) {
        return !row || Object.keys(row).sort().join('|') !== 'handKey|playerIds' || typeof row.handKey !== 'string' || row.handKey.length > 2048 ||
          !Array.isArray(row.playerIds) || row.playerIds.length < 2 || members(row.playerIds).length !== row.playerIds.length || row.playerIds.some(function (id) { return !keys.has(Model.rawKey(id)); });
      })) return false;
      return saved.unresolved.every(function (row) { return row && ['code', 'code|handKey'].indexOf(Object.keys(row).sort().join('|')) >= 0 &&
        typeof row.code === 'string' && /^[A-Z_]{1,80}$/.test(row.code) && (row.handKey === undefined || typeof row.handKey === 'string' && row.handKey.length <= 2048); });
    } catch (_malformed) { return false; }
  }
  return Object.freeze({ LIMITS: LIMITS, NAMESPACE: NAMESPACE, members: members, group: group, summarize: summarize,
    proposal: proposal, requireFresh: requireFresh, sameRoute: sameRoute, usableRoute: usableRoute, issue: issue, proof: proof, validity: validity });
});
