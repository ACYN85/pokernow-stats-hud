/* Dormant Person-only compatibility portability. No manifest, route or consent grant.
 * Reuses v3 identity rules and v2 Career staging; never acquires or writes notes. */
(function (root, factory) {
  'use strict';
  var node = typeof module !== 'undefined' && module.exports;
  var api = factory(node ? require('./careerBackupV3') : root.PokerCareerBackupV3,
    node ? require('./careerBackupV2') : root.PokerCareerBackupV2,
    node ? require('./careerBackupV2Import') : root.PokerCareerBackupV2Import,
    node ? require('./careerBackup') : root.PokerCareerBackup,
    node ? require('./careerIndexedStore') : root.PokerCareerIndexedStore,
    node ? require('./playerIdentity') : root.PokerPlayerIdentity,
    node ? require('./playerIdentityStore') : root.PokerPlayerIdentityStore,
    node ? require('./playerIdentityEligibility') : root.PokerPlayerIdentityEligibility,
    node ? require('./playerIdentityValidation') : root.PokerPlayerIdentityValidation);
  if (node) module.exports = api;
  else root.PokerCompatibilityPersonBackup = api;
})(globalThis, function (V3, C, Import, V1, I, M, Identity, E, Validation) {
  'use strict';
  // Additive discriminator: original v3/v4 decoders refuse this variant.
  // It cannot be mistaken for a complete native-notes backup.
  var CODEC = 'compatibility-person-v1+career-v2-sha256';
  var enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  var END = 'PNHUD3-END ', MAX = V3.MAX_FILE_BYTES;
  function fail(code, message) { throw Object.assign(new Error(message || code), { code: 'PERSON_BACKUP_' + code }); }
  function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== keys.slice().sort().join('|')) fail('INVALID');
  }
  function text(value) { return V1.canonicalStringify(value); }
  function same(a, b) { return text(a) === text(b); }
  function identity(value) {
    exact(value, ['schemaVersion', 'players', 'persons']);
    var result = V3.portableIdentity(M.validate(Object.assign({ identityRevision: 0 }, value)));
    if (!same(value, result)) fail('INVALID', 'Identity must be canonical, bounded and unvalidated.');
    return result;
  }
  function header(value) {
    return { backupFormat: 'PNHUD-private-native', backupFormatVersion: 3, codec: CODEC,
      annotations: { identity: identity(value) } };
  }
  function merge(a, b) {
    // Existing exclusive-membership, UUID, name, alias and duplicate policies.
    function wrap(value) { return { identity: identity(value), notes: { keyPolicy: 'opaque-legacy-string-v1', entries: [] } }; }
    return V3.merge(wrap(a), wrap(b)).identity;
  }
  function request(r) { return new Promise(function (resolve, reject) { r.onsuccess = function () { resolve(r.result); }; r.onerror = function () { reject(r.error); }; }); }
  async function snapshot(store) {
    // A Career-only bundle must not discard native finalized/pending recovery.
    for (var ns of ['pnhudFinalizedHistoryV1', 'pnhudSessionV1']) {
      if (await request(store.count(IDBKeyRange.bound([ns], [ns + '\u0000'], false, true)))) fail('NATIVE_HISTORY_REQUIRED');
    }
    var rows = await request(store.getAll(IDBKeyRange.bound([Identity.NAMESPACE], [Identity.NAMESPACE + '\u0000'], false, true), Identity.metadata.maxRows + 1));
    var state = Identity.metadata.stateFor(rows);
    return { rows: rows, state: state, portable: V3.portableIdentity(state), token: { identityRevision: state.identityRevision } };
  }
  function scopeRequired(scope) {
    if (!scope || scope.kind !== 'compatibility-person-maintenance-v1' || typeof scope.assert !== 'function') fail('SCOPE_REQUIRED');
    // This is an internal lifecycle adapter, not caller-supplied authorization.
    // No production transport currently installs or exposes this owner.
  }
  async function inspect(file) {
    if (!file || !Number.isSafeInteger(file.size) || file.size < 94 || file.size > MAX) fail('SIZE');
    var prefix = dec.decode(await file.slice(0, 16).arrayBuffer());
    if (!/^PNHUD3\n[0-9a-f]{8}\n$/.test(prefix)) fail('INVALID');
    var size = parseInt(prefix.slice(7, 15), 16), start = 17 + size, tail = END.length + 65;
    if (size > V3.MAX_METADATA_BYTES || start + tail >= file.size) fail('SIZE');
    var raw = dec.decode(await file.slice(16, 16 + size).arrayBuffer());
    if (dec.decode(await file.slice(16 + size, start).arrayBuffer()) !== '\n') fail('INVALID');
    var h; try { h = JSON.parse(raw); } catch (_) { fail('INVALID'); }
    exact(h, ['backupFormat', 'backupFormatVersion', 'codec', 'annotations']);
    exact(h.annotations, ['identity']);
    if (!same(h, header(h.annotations.identity)) || raw !== text(h)) fail('INVALID');
    var trailer = dec.decode(await file.slice(file.size - tail).arrayBuffer());
    if (!/^PNHUD3-END [0-9a-f]{64}\n$/.test(trailer)) fail('INTEGRITY');
    return { header: h, text: raw, proof: trailer.slice(END.length, -1), career: file.slice(start, file.size - tail) };
  }
  async function exportFile(handle, scope, options) {
    scopeRequired(scope); options = options || {}; await scope.assert();
    var source, sink, captured, footer, seen, total = 0, final = false;
    try {
      source = await I.createBackupV2Source(indexedDB, C, { capture: async function (store) {
        var s = await snapshot(store); if (!captured) captured = s; return s.token;
      } });
      var token = await source.capture(), raw = text(header(captured.portable));
      seen = V3.evidence({ identity: captured.portable });
      sink = await handle.createWritable();
      async function write(bytes) { if ((total += bytes.byteLength) > MAX) fail('SIZE'); await sink.write(bytes); }
      await write(enc.encode('PNHUD3\n' + enc.encode(raw).length.toString(16).padStart(8, '0') + '\n' + raw + '\n'));
      async function* records() {
        var after = null;
        while (true) {
          await scope.assert(); var page = await source.page(token, after);
          for (var r of page.records) { seen.record(r); yield r; }
          after = page.after; if (page.exhausted) return;
        }
      }
      var metrics = await C.encode(token.careerMetadata, records(), async function (bytes) {
        if (final) footer = JSON.parse(dec.decode(bytes)); await write(bytes);
      }, async function (finish) {
        seen.finish(); await scope.assert();
        await source.finalize(token, async function () {
          final = true; await finish(); await scope.assert();
          await write(enc.encode(END + await V3.digest(raw, footer) + '\n')); await sink.close();
        });
      }, options.signal, options.onProgress);
      await scope.assert(); return { status: 'COMPLETE', codec: CODEC, fileBytes: total, notesIncluded: false, career: metrics };
    } catch (error) {
      if (sink) { try { await sink.abort(error); } catch (_) {} }
      throw error;
    } finally { if (source) source.close(); }
  }
  async function prepare(file, scope, options) {
    scopeRequired(scope); options = options || {}; await scope.assert();
    // Do not let a caller replace this owner's internal atomic participant.
    if (options.nativeParticipant || options.finalizedHistory) fail('OPTIONS');
    var input = await inspect(file), incoming = input.header.annotations.identity;
    var seen = V3.evidence({ identity: incoming }), destination, next;
    var participant = {
      capture: async function (store) {
        destination = await snapshot(store);
        next = options.mode === 'merge' ? merge(destination.portable, incoming) : incoming;
      },
      record: function (record) { seen.record(record); },
      verifyInput: async function (_, proof) {
        seen.finish(); if (await V3.digest(input.text, proof) !== input.proof) fail('INTEGRITY');
        await scope.assert();
      },
      publish: async function (store, route) {
        var current = await snapshot(store);
        if (!same(current.token, destination.token)) fail('DESTINATION_CHANGED');
        if (current.state.identityRevision === Number.MAX_SAFE_INTEGER) fail('REVISION');
        var state = M.validate(Object.assign({}, next, { identityRevision: current.state.identityRevision + 1 }));
        Identity.metadata.writeNext(store, current.rows, current.state, state);
        new Set(current.state.persons.concat(state.persons).map(function (p) { return p.personId; })).forEach(function (id) {
          store.delete(E.key('membership', id)); store.delete(E.key('certificate', id)); store.delete([Validation.NAMESPACE, id]);
        });
        state.persons.forEach(function (p) { store.put(E.membership(p.personId, crypto.randomUUID())); });
        store.put(E.control(route, crypto.randomUUID()));
        // Deliberately no native or Chrome note read/write, acquisition or handoff.
      }
    };
    var staged = await Import.prepare(input.career, Object.assign({}, options, { nativeParticipant: participant }));
    var consumed = false;
    return { preview: Object.assign({}, staged.preview, { codec: CODEC, identity: next, inputProof: input.proof,
      notesIncluded: false, notesPreserved: true, freshValidationRequired: true }), metrics: staged.metrics,
      close: staged.close, publish: async function (confirmation) {
        if (consumed || !confirmation || confirmation.expectedInputProof !== input.proof) fail('CONFIRMATION');
        consumed = true; await scope.assert();
        var result = await staged.publish(confirmation);
        try { await scope.assert(); } catch (_) { fail('UNKNOWN', 'Publication may have committed. Read back; never retry automatically.'); }
        return result;
      } };
  }
  return Object.freeze({ CODEC: CODEC, MAX_FILE_BYTES: MAX, header: header, merge: merge, inspect: inspect, exportFile: exportFile, prepare: prepare });
});
