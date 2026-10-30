/* Dormant private-profile portable recovery. No production imports/routes. */
(function (root, factory) {
  'use strict';
  var api;
  if (typeof module !== 'undefined' && module.exports) api = factory(require('./careerIndexedStore'), require('./careerBackup'),
    require('./careerBackupV2'), require('./careerBackupV2Import'), require('./playerIdentity'), require('./playerIdentityStore'),
    require('./playerNotesNative'), require('./playerIdentityEligibility'), require('./careerBackupPolicy'), require('./playerIdentityValidation'));
  else api = factory(root.PokerCareerIndexedStore, root.PokerCareerBackup, root.PokerCareerBackupV2,
    root.PokerCareerBackupV2Import, root.PokerPlayerIdentity, root.PokerPlayerIdentityStore,
    root.PokerPlayerNotesNative, root.PokerPlayerIdentityEligibility, root.PokerCareerBackupPolicy, root.PokerPlayerIdentityValidation);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerCareerBackupV3 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (I, V1, C, Import, M, Identity, N, E, Policy, Validation) {
  'use strict';
  var MAX_METADATA = 20 * 1024 * 1024, MAX_FILE = Policy.MAX_BACKUP_BYTES, PREFIX = 'PNHUD3\n', END = 'PNHUD3-END ';
  var enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  var REVISION = '00000000-0000-4000-8000-000000000000';
  function fail(code, message) { var e = Error(message); e.code = 'CAREER_BACKUP_V3_' + code; throw e; }
  function exact(o, keys) { if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).sort().join('|') !== keys.sort().join('|')) fail('INVALID', 'Missing or unsupported portable fields.'); }
  function same(a, b) { return V1.canonicalStringify(a) === V1.canonicalStringify(b); }
  function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function bounded(value) { var text = V1.canonicalStringify(value); if (enc.encode(text).length > MAX_METADATA) fail('SIZE', 'Portable metadata exceeds its bound.'); return text; }
  function portableIdentity(state) {
    state = M.validate(state);
    state.players.sort(function (a, b) { return compare(M.rawKey(a.playerId), M.rawKey(b.playerId)); });
    state.persons.sort(function (a, b) { return compare(a.personId, b.personId); });
    state.persons.forEach(function (p) { p.members.sort(function (a, b) { return compare(M.rawKey(a), M.rawKey(b)); }); });
    delete state.identityRevision; return state;
  }
  function annotations(value) {
    exact(value, ['identity', 'notes']); exact(value.identity, ['schemaVersion', 'players', 'persons']);
    exact(value.notes, ['keyPolicy', 'entries']);
    if (value.notes.keyPolicy !== 'opaque-legacy-string-v1') fail('INVALID', 'Notes never establish typed player identities.');
    var identity = portableIdentity(Object.assign({ identityRevision: 0 }, value.identity));
    var notes = N.validate({ schemaVersion: 1, revision: REVISION, status: 'active', source: { present: false, entries: [] }, entries: value.notes.entries });
    var normalized = { identity: identity, notes: { keyPolicy: 'opaque-legacy-string-v1', entries: notes.entries } };
    if (!same(normalized, value)) fail('INVALID', 'Portable identity arrays must be in deterministic order.');
    return normalized;
  }
  function header(value) { return { backupFormat: 'PNHUD-private-native', backupFormatVersion: 3, codec: 'native-annotations-v1+career-v2-sha256', annotations: annotations(value) }; }
  function validateHeader(value) {
    exact(value, ['backupFormat', 'backupFormatVersion', 'codec', 'annotations']);
    if (!same(header(value.annotations), value)) fail('INVALID', 'Unsupported v3 header.'); return value;
  }
  async function digest(text, transport) { return C.hash('PNHUD-Backup-v3\n' + text + '\n' + transport.headerDigest + '\n' + transport.finalChain + '\n'); }
  function merge(local, incoming) {
    local = annotations(local); incoming = annotations(incoming);
    function union(a, b, key, label) {
      var map = new Map(a.map(function (r) { return [key(r), r]; }));
      b.forEach(function (r) { var k = key(r); if (map.has(k) && !same(map.get(k), r)) fail('MERGE_CONFLICT', label + ' conflicts; no data was applied.'); map.set(k, r); });
      return Array.from(map.values());
    }
    var identity = portableIdentity(M.validate({ schemaVersion: 1, identityRevision: 0,
      players: union(local.identity.players, incoming.identity.players, function (p) { return M.rawKey(p.playerId); }, 'Raw assignment/membership'),
      persons: union(local.identity.persons, incoming.identity.persons, function (p) { return p.personId; }, 'Person UUID/name/members') }));
    return annotations({ identity: identity, notes: { keyPolicy: 'opaque-legacy-string-v1',
      entries: union(local.notes.entries, incoming.notes.entries, function (p) { return p[0]; }, 'Opaque note value').sort(function (a, b) { return compare(a[0], b[0]); }) } });
  }
  function request(r) { return new Promise(function (resolve, reject) { r.onsuccess = function () { resolve(r.result); }; r.onerror = function () { reject(r.error); }; }); }
  async function snapshot(store) {
    var rows = await request(store.getAll(IDBKeyRange.bound([Identity.NAMESPACE], [Identity.NAMESPACE + '\u0000'], false, true), Identity.metadata.maxRows + 1));
    var identity = Identity.metadata.stateFor(rows), notes = await N.metadata.read(store);
    if (notes.status !== 'active') fail('NOTES_AUTHORITY', 'Verified active local notes acquisition is required.');
    return { rows: rows, identity: identity, notes: notes,
      token: { identityRevision: identity.identityRevision, notesRevision: notes.revision },
      annotations: annotations({ identity: portableIdentity(identity), notes: { keyPolicy: 'opaque-legacy-string-v1', entries: notes.entries } }) };
  }
  function evidence(value) {
    var required = new Map(value.identity.players.map(function (p) { return [String(p.playerId), M.rawKey(p.playerId)]; })), found = new Set();
    return {
      record: function (r) { r.players.forEach(function (p) {
        var wanted = required.get(String(p.playerId)); if (!wanted) return;
        if (M.rawKey(p.playerId) !== wanted || typeof r.handKey !== 'string' || typeof r.authoritativeHandId !== 'string' || typeof r.namespace.gameId !== 'string')
          fail('TYPED_EVIDENCE', 'Original typed player evidence is ambiguous or unsupported.');
        found.add(wanted);
      }); },
      finish: function () { if (Array.from(required.values()).some(function (k) { return !found.has(k); })) fail('MISSING_RAW', 'A portable raw identity has no matching backed-up Career evidence.'); }
    };
  }
  async function inspect(file) {
    if (!file || !Number.isSafeInteger(file.size) || file.size < 94 || file.size > MAX_FILE) fail('SIZE', 'V3 file exceeds the existing 64-MiB portable envelope or is incomplete.');
    var prefix = dec.decode(await file.slice(0, 16).arrayBuffer());
    if (!/^PNHUD3\n[0-9a-f]{8}\n$/.test(prefix)) fail('INVALID', 'Invalid v3 framing.');
    var size = parseInt(prefix.slice(7, 15), 16), start = 17 + size, tail = END.length + 65;
    if (size > MAX_METADATA || start + tail >= file.size) fail('SIZE', 'Invalid annotation length.');
    var text = dec.decode(await file.slice(16, 16 + size).arrayBuffer());
    if (dec.decode(await file.slice(16 + size, start).arrayBuffer()) !== '\n') fail('INVALID', 'Missing annotation boundary.');
    var parsed; try { parsed = JSON.parse(text); } catch (_) { fail('INVALID', 'Malformed annotations.'); }
    validateHeader(parsed);
    if (bounded(parsed) !== text) fail('INVALID', 'Noncanonical annotations or duplicate fields.');
    var trailer = dec.decode(await file.slice(file.size - tail).arrayBuffer());
    if (!(new RegExp('^' + END + '[0-9a-f]{64}\n$')).test(trailer)) fail('INTEGRITY', 'Missing completion proof.');
    return { header: parsed, text: text, proof: trailer.slice(END.length, -1), career: file.slice(start, file.size - tail) };
  }
  // scope.assert is supplied ONLY by the closed disposable-profile controller.
  // It is not a portable capability and cannot certify old production documents.
  function requireScope(scope) { if (!scope || typeof scope.assert !== 'function') fail('PRIVATE_SCOPE', 'A proved closed private notes scope is required.'); }
  async function exportFile(handle, scope, options) {
    requireScope(scope); options = options || {}; await scope.assert();
    var source, sink, captured, total = 0, footer, text, seen;
    try {
      source = await I.createBackupV2Source(indexedDB, C, { capture: async function (store) {
        var s = await snapshot(store); if (!captured) captured = s; return s.token;
      } });
      var token = await source.capture(); seen = evidence(captured.annotations); text = bounded(header(captured.annotations));
      sink = await handle.createWritable();
      async function write(bytes) { if ((total += bytes.byteLength) > MAX_FILE) fail('SIZE', 'Complete v3 exceeds the existing 64-MiB envelope; output must be discarded.'); await sink.write(bytes); }
      await write(enc.encode(PREFIX + enc.encode(text).length.toString(16).padStart(8, '0') + '\n' + text + '\n'));
      async function* records() { var after = null; while (true) {
        var page = await source.page(token, after);
        for (var r of page.records) { seen.record(r); if(options.finalizedHistory)options.finalizedHistory.record(r); yield r; }
        after = page.after; if (page.exhausted) return;
      } }
      var final = false;
      var metrics = await C.encode(token.careerMetadata, records(), async function (bytes) {
        if (final) footer = JSON.parse(dec.decode(bytes)); await write(bytes);
      }, async function (finish) {
        seen.finish(); if(options.finalizedHistory)options.finalizedHistory.verify(); await scope.assert();
        await source.finalize(token, async function () {
          final = true; await finish(); await scope.assert();
          await write(enc.encode(END + await digest(text, footer) + '\n')); await sink.close();
        });
      }, options.signal, options.onProgress);
      await scope.assert(); return { status: 'COMPLETE', fileBytes: total, career: metrics, source: source.metrics };
    } catch (e) { if (sink) { try { await sink.abort(e); } catch (_closedOrFailed) {} } throw e; }
    finally { if (source) source.close(); }
  }
  async function prepare(file, scope, options) {
    requireScope(scope); options = options || {}; await scope.assert();
    var input = await inspect(file), incoming = input.header.annotations, seen = evidence(incoming), destination, next;
    var participant = {
      capture: async function (store) { destination = await snapshot(store); next = options.mode === 'merge' ? merge(destination.annotations, incoming) : incoming;
        var retainedHistory=await request(store.count(IDBKeyRange.bound(['pnhudFinalizedHistoryV1'],['pnhudFinalizedHistoryV1\u0000'],false,true)));
        if(retainedHistory&&!options.finalizedHistory)fail('HISTORY_REQUIRED','Retained canonical history requires the versioned history-aware restore.');
        if(options.finalizedHistory)await options.finalizedHistory.capture(store); },
      record: function(r){seen.record(r);if(options.finalizedHistory)options.finalizedHistory.record(r);},
      recordLocal: function(r){if(options.finalizedHistory)options.finalizedHistory.record(r);},
      verifyInput: async function (h, proof) { seen.finish(); if(options.finalizedHistory)options.finalizedHistory.verify(); if (await digest(input.text, proof) !== input.proof) fail('INTEGRITY', 'V3 annotation/Career binding differs.'); await scope.assert(); },
      publish: async function (store, route) {
        var current = await snapshot(store);
        if (!same(current.token, destination.token)) fail('DESTINATION_CHANGED', 'Notes or identity changed during preview; read and review again.');
        if (current.identity.identityRevision === Number.MAX_SAFE_INTEGER) fail('REVISION', 'Identity revision exhausted.');
        var identity = M.validate(Object.assign({}, next.identity, { identityRevision: current.identity.identityRevision + 1 }));
        Identity.metadata.writeNext(store, current.rows, current.identity, identity);
        // A Replace may evict UUIDs. Repeated imports must not accumulate their
        // derived certificates/epochs outside the bounded identity population.
        // Only exact keys for <=512 old/new IDs are touched, in this same commit.
        new Set(current.identity.persons.concat(identity.persons).map(function (p) { return p.personId; })).forEach(function (id) {
          store.delete(E.key('membership', id)); store.delete(E.key('certificate', id)); store.delete([Validation.NAMESPACE, id]);
        });
        identity.persons.forEach(function (p) { store.put(E.membership(p.personId, crypto.randomUUID())); });
        store.put(E.control(route, crypto.randomUUID()));
        await N.metadata.restore(store, next.notes.entries, current.notes.revision);
        if(options.finalizedHistory)await options.finalizedHistory.publish(store);
      }
    };
    var staged = await Import.prepare(input.career, Object.assign({}, options, { nativeParticipant: participant }));
    return { preview: Object.assign({}, staged.preview, { formatVersion: 3, annotations: next, inputProof: input.proof, freshValidationRequired: true }), metrics: staged.metrics,
      close: staged.close, publish: async function (confirmation) {
        if (!confirmation || confirmation.expectedInputProof !== input.proof) fail('CONFIRMATION', 'Review and confirm the exact v3 input proof.');
        await scope.assert(); var result = await staged.publish(confirmation);
        try { await scope.assert(); } catch (e) { fail('UNKNOWN', 'Commit may have completed before scope loss. Independent native readback is required.'); }
        return result;
      } };
  }
  return Object.freeze({ MAX_METADATA_BYTES: MAX_METADATA, MAX_FILE_BYTES: MAX_FILE, header: header, annotations: annotations,
    portableIdentity: portableIdentity, merge: merge, inspect: inspect, digest: digest, evidence: evidence, exportFile: exportFile, prepare: prepare });
});
