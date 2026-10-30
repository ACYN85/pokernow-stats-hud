/* Internal validation/confirmation owner. No manifest entry or public link route. */
(function (root, factory) {
  'use strict';
  var model = root.PokerPlayerIdentity, adapter = root.PokerPlayerIdentityStore, indexed = root.PokerCareerIndexedStore, validation = root.PokerPlayerIdentityValidation;
  var eligibility = root.PokerPlayerIdentityEligibility;
  if (typeof module !== 'undefined' && module.exports) {
    model = require('./playerIdentity.js'); adapter = require('./playerIdentityStore.js'); indexed = require('./careerIndexedStore.js'); validation = require('./playerIdentityValidation.js');
    eligibility = require('./playerIdentityEligibility.js');
  }
  var api = factory(model, adapter, indexed, validation, eligibility);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPlayerIdentityLinkStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Model, Adapter, Indexed, V, E) {
  'use strict';
  function error(code, message) { var e = new Error(message); e.code = code; return e; }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function request(r) { return new Promise(function (resolve, reject) { r.onsuccess = function () { resolve(r.result); }; r.onerror = function () { reject(r.error); }; }); }
  function done(tx) { return new Promise(function (resolve, reject) { tx.oncomplete = resolve; tx.onerror = tx.onabort = function () { reject(tx.error || error('IDENTITY_TRANSACTION_FAILED', 'Identity transaction aborted')); }; }); }
  async function outbox() {
    if (typeof chrome === 'undefined' || !chrome.storage || typeof chrome.storage.local.getKeys !== 'function') return { complete: false, pending: true };
    var keys = await chrome.storage.local.getKeys();
    return { complete: true, pending: keys.some(function (key) { return key.indexOf(Indexed.OUTBOX_PREFIX) === 0; }) };
  }
  async function open(indexedDB, options) {
    options = options || {};
    var R = Indexed.routing, db = await R.openDatabase(indexedDB), foundation = await Adapter.open(indexedDB), receipts = new Map();
    var readOutbox = options.readOutbox || outbox;
    async function transaction(names, mode, expected, action) {
      var tx;
      try { tx = await R.transaction(db, names, mode, expected); }
      catch (e) { if (expected) throw error('IDENTITY_STALE_PREVIEW', 'Career authority changed or became unavailable; create another preview'); throw e; }
      var completion = done(tx); completion.catch(function () {});
      try { var value = await action(tx); await completion; return value; }
      catch (e) { try { tx.abort(); } catch (_abort) {} await completion.catch(function () {}); throw e; }
    }
    function rowsIn(tx) { return request(tx.objectStore(R.controlStore).getAll(IDBKeyRange.bound([Adapter.NAMESPACE], [Adapter.NAMESPACE + '\u0000'], false, true), Adapter.metadata.maxRows + 1)); }
    async function stateIn(tx) { return Adapter.metadata.stateFor(await rowsIn(tx)); }
    function publishedSnapshot(personId, mode, expected, action) {
      if (!E) throw error('IDENTITY_POLICY_UNAVAILABLE', 'Published-ledger policy is unavailable');
      return transaction([R.controlStore], mode || 'readonly', expected, async function (tx) {
        var store = tx.objectStore(R.controlStore), values = await Promise.all([rowsIn(tx), request(store.get(E.key('control'))),
          request(store.get(E.key('membership', personId))), request(store.get(E.key('certificate', personId)))]);
        var current = { rows: values[0], state: Adapter.metadata.stateFor(values[0]), route: copy(tx.route), publication: values[1], member: values[2], saved: values[3] };
        return action ? action(tx, current) : current;
      });
    }
    function snapshot(personId) {
      return transaction([R.controlStore], 'readonly', null, async function (tx) {
        var reads = [stateIn(tx)];
        if (personId !== undefined) reads.push(request(tx.objectStore(R.controlStore).get([V.NAMESPACE, personId])));
        var values = await Promise.all(reads); return { state: values[0], route: copy(tx.route), saved: values[1] };
      });
    }
    function bounds(settings) {
      settings = settings || {}; var result = {};
      ['candidates', 'groups', 'deadlineMs'].forEach(function (key) {
        var value = settings[key] === undefined ? V.LIMITS[key] : settings[key];
        if (!Number.isSafeInteger(value) || value < 1 || value > V.LIMITS[key]) throw error('IDENTITY_INVALID_BUDGET', 'Validation budget must be positive and within the documented hard cap');
        result[key] = value;
      });
      result.signal = settings.signal; result.started = Date.now(); return result;
    }
    function check(budget) {
      if (budget.signal && budget.signal.aborted) throw error('VALIDATION_CANCELLED', 'Validation cancelled; retry with a new preview');
      if (Date.now() - budget.started >= budget.deadlineMs) throw error('VALIDATION_DEADLINE', 'Validation deadline reached; retry with a smaller retained history or after publication settles');
    }
    function page(alias, after, route, limit, budget) {
      return transaction([Indexed.STORES.records], 'readonly', route, function (tx) {
        return new Promise(function (resolve, reject) {
          var refs = [], issues = [], last = after, skipped = !after;
          var scan = tx.objectStore(Indexed.STORES.records).index('playerIds').openCursor(IDBKeyRange.only(alias));
          scan.onerror = function () { reject(scan.error); };
          scan.onsuccess = function () { try {
            check(budget); var cursor = scan.result;
            if (!cursor) { resolve({ refs: refs, issues: issues, after: last, complete: true }); return; }
            if (!skipped) {
              var order = indexedDB.cmp(cursor.primaryKey, after);
              if (order < 0) { cursor.continuePrimaryKey(alias, after); return; }
              if (order === 0) { skipped = true; cursor.continue(); return; }
              skipped = true;
            }
            var wrapper = cursor.value, record = wrapper && wrapper.record;
            if (!record || typeof record.handKey !== 'string' || record.handKey.length > 2048 ||
                !Array.isArray(wrapper.playerIds) || !Array.isArray(record.players) ||
                JSON.stringify(wrapper.playerIds) !== JSON.stringify(record.players.map(function (p) { return String(p && p.playerId); })))
              issues.push(V.issue('MALFORMED_INDEXED_WRAPPER'));
            else refs.push(record.handKey);
            last = cursor.primaryKey;
            if (refs.length + issues.length >= limit) { resolve({ refs: refs, issues: issues, after: last, complete: false }); return; }
            cursor.continue();
          } catch (e) { reject(e); } };
        });
      });
    }
    function physicalGroup(handKey, route, budget) {
      return transaction([Indexed.STORES.records], 'readonly', route, async function (tx) {
        var records = [], keys = new Set(), fingerprints = new Set(), bytes = 0, incomplete = null;
        var store = tx.objectStore(Indexed.STORES.records);
        async function peers(key) {
          if (keys.has(key) || incomplete) return; keys.add(key);
          await new Promise(function (resolve, reject) {
            var scan = store.index('handKey').openCursor(IDBKeyRange.only(key));
            scan.onerror = function () { reject(scan.error); };
            scan.onsuccess = function () { try {
              check(budget); var cursor = scan.result;
              if (!cursor) { resolve(); return; }
              var wrapper = cursor.value, record = wrapper && wrapper.record;
              var size = new TextEncoder().encode(JSON.stringify(wrapper)).length;
              if (records.length >= V.LIMITS.peers || bytes + size > V.LIMITS.bytes) { incomplete = 'PHYSICAL_CONTEXT_BUDGET'; resolve(); return; }
              bytes += size;
              if (!record || record.handKey !== key || record.fingerprint !== cursor.primaryKey || !Array.isArray(record.players) ||
                  JSON.stringify(wrapper.playerIds) !== JSON.stringify(record.players.map(function (p) { return String(p && p.playerId); }))) {
                incomplete = 'MALFORMED_PHYSICAL_WRAPPER'; resolve(); return;
              }
              records.push(record); fingerprints.add(record.fingerprint); cursor.continue();
            } catch (e) { reject(e); } };
          });
        }
        await peers(handKey);
        // Include all foreign predecessor peers too. Missing and over-budget context
        // never gets substituted with a tip-only resolution.
        for (var i = 0; i < records.length && !incomplete; i += 1) {
          var predecessor = records[i].supersedesFingerprint;
          if (predecessor && !fingerprints.has(predecessor)) {
            check(budget); var wrapper = await request(store.get(predecessor));
            if (!wrapper || !wrapper.record || typeof wrapper.record.handKey !== 'string') { incomplete = 'MISSING_PREDECESSOR'; break; }
            await peers(wrapper.record.handKey);
            if (!fingerprints.has(predecessor)) incomplete = 'INCOMPLETE_PREDECESSOR_PEERS';
          }
        }
        var evidence = V.group(budget.members, handKey, records, !incomplete);
        if (incomplete) evidence = V.summarize([evidence], incomplete);
        return { evidence: evidence, count: records.length, bytes: bytes, provenance: records.filter(function (record) {
          return evidence.status !== 'UNRESOLVED' && record.handKey === handKey && record.schemaVersion >= 4 && record.session && typeof record.session.sessionId === 'string' && record.namespace;
        }).slice(0, 1).map(function (record) { return { sessionId: record.session.sessionId, namespace: JSON.stringify([record.namespace.provider, record.namespace.host, record.namespace.gameId]) }; }) };
      });
    }
    async function scan(ids, original, settings, published) {
      ids = V.members(ids); var budget = bounds(settings); budget.members = ids;
      var visited = new Set(), evidence = V.summarize([]), metrics = { pages: 0, candidates: 0, groups: 0, maxPhysicalRecords: 0, maxGroupBytes: 0 };
      var sessions = new Map();
      try {
        if (!V.usableRoute(original.route)) throw error('MISSING_CAREER_REVISION', 'Career revision is unavailable');
        for (var id of ids) {
          var after = null, complete = false;
          while (!complete) {
            check(budget);
            var chunk = await page(String(id), after, original.route, Math.min(V.LIMITS.page, budget.candidates - metrics.candidates + 1), budget);
            metrics.pages += 1; metrics.candidates += chunk.refs.length + chunk.issues.length;
            if (metrics.candidates > budget.candidates) throw error('CANDIDATE_SCAN_BUDGET', 'Candidate scan budget reached');
            evidence = V.summarize([evidence, { status: chunk.issues.length ? 'UNRESOLVED' : 'SAFE', overlaps: [], unresolved: chunk.issues }]);
            for (var handKey of chunk.refs) {
              if (visited.has(handKey)) continue;
              if (visited.size >= budget.groups) throw error('CANONICAL_GROUP_BUDGET', 'Canonical group budget reached');
              visited.add(handKey); check(budget);
              var physical = await physicalGroup(handKey, original.route, budget);
              metrics.groups += 1; metrics.maxPhysicalRecords = Math.max(metrics.maxPhysicalRecords, physical.count); metrics.maxGroupBytes = Math.max(metrics.maxGroupBytes, physical.bytes);
              evidence = V.summarize([evidence, physical.evidence]);
              physical.provenance.forEach(function (entry) {
                if (sessions.has(entry.sessionId) && sessions.get(entry.sessionId) !== entry.namespace)
                  evidence = V.summarize([evidence], 'CONTRADICTORY_SESSION_NAMESPACE');
                sessions.set(entry.sessionId, entry.namespace);
              });
            }
            after = chunk.after; complete = chunk.complete;
            // No open transaction while yielding; the next chunk rechecks the route.
            if (!complete) await new Promise(function (resolve) { setTimeout(resolve, 0); });
          }
        }
        check(budget);
        var final = await snapshot(); V.requireFresh({ identityRevision: original.state.identityRevision, route: original.route }, final.state, final.route);
      } catch (e) {
        // Native storage failures are errors, not evidence that can replace a proof.
        if (typeof e.code !== 'string') throw e;
        evidence = V.summarize([evidence], e.code);
        if (e.code === 'IDENTITY_STALE_PREVIEW' || e.code === 'IDENTITY_REVISION_CONFLICT') evidence.status = 'UNRESOLVED';
      }
      if (published && sessions.size > E.LIMITS.sessions) evidence = V.summarize([evidence], 'SESSION_WITNESS_BUDGET');
      if (published) evidence.sessionNamespaces = Array.from(sessions, function (entry) { return { sessionId: entry[0], namespace: entry[1] }; });
      return Object.assign(evidence, { metrics: metrics });
    }
    async function pendingEvidence(evidence) {
      var pending;
      try { pending = await readOutbox(); } catch (_read) { pending = { complete: false, pending: true }; }
      if (!pending || pending.complete !== true || pending.pending !== false)
        return V.summarize([evidence], pending && pending.complete === true ? 'PENDING_FINALIZED_OUTBOX' : 'OUTBOX_EVIDENCE_UNAVAILABLE');
      return evidence;
    }
    async function observedEvidence(evidence, original) {
      var result = await pendingEvidence(evidence), final = await snapshot();
      if (final.state.identityRevision !== original.state.identityRevision || !V.sameRoute(final.route, original.route)) {
        result = V.summarize([result], 'OBSERVATION_CHANGED_RETRY'); result.status = 'UNRESOLVED';
      }
      return result;
    }
    async function previewLink(ids, expectedRevision, personId, settings) {
      ids = V.members(ids); personId = personId === undefined ? Model.createPersonId(globalThis.crypto) : Model.personTarget(personId).personId;
      var original = await snapshot();
      if (original.state.identityRevision !== expectedRevision) throw error('IDENTITY_REVISION_CONFLICT', 'Identity changed; reread before previewing');
      var proposal = V.proposal(original.state, ids, personId), retained = await scan(proposal.proposedMembers, original, settings), evidence = await observedEvidence(retained, original);
      var preview = Object.assign(proposal, evidence, { retainedStatus: retained.status, metrics: retained.metrics,
        identityRevision: original.state.identityRevision, route: original.route, previewId: Model.createPersonId(globalThis.crypto),
        confirmationAvailable: false, confirmationBlocker: 'OUTBOX_ATOMIC_BARRIER_UNAVAILABLE' });
      while (receipts.size >= 4) receipts.delete(receipts.keys().next().value);
      receipts.set(preview.previewId, { preview: copy(preview), expires: Date.now() + 5 * 60 * 1000 }); return copy(preview);
    }
    async function confirmLink(preview, settings) {
      var receipt = preview && receipts.get(preview.previewId);
      if (!receipt || receipt.expires < Date.now() || JSON.stringify(receipt.preview) !== JSON.stringify(preview))
        throw error('IDENTITY_STALE_PREVIEW', 'Preview expired, changed or belongs to another connection');
      var original = await snapshot(); V.requireFresh(preview, original.state, original.route);
      var proposal = V.proposal(original.state, preview.rawIds, preview.personId);
      if (proposal.requiresExplicitNameResolution) throw error('IDENTITY_NAME_CONFLICT', 'Resolve assigned names explicitly before linking');
      var evidence = await pendingEvidence(await scan(proposal.proposedMembers, original, settings));
      if (evidence.status !== 'SAFE') throw error('IDENTITY_' + evidence.status, 'Fresh validation failed: ' + JSON.stringify(evidence));
      var final = await snapshot(); V.requireFresh(preview, final.state, final.route);
      // chrome.storage.local.set in content.js can race even a queued native RW
      // transaction. An empty outbox read cannot authorize a validated commit.
      throw error('OUTBOX_ATOMIC_BARRIER_UNAVAILABLE', 'Validated linking is blocked until finalized outbox admission and identity confirmation share a durable atomic fence');
    }
    async function revalidatePerson(personId, settings) {
      Model.personTarget(personId); var original = await snapshot(personId), person = original.state.persons.find(function (p) { return p.personId === personId; });
      if (!person) throw error('IDENTITY_PERSON_NOT_FOUND', 'Person does not exist');
      var retained = person.members.length ? await scan(person.members, original, settings) : V.summarize([]);
      var saved = V.proof(person, original.state, original.route, retained);
      // A failed/aborted validation publication never overwrites prior evidence.
      await transaction([R.controlStore], 'readwrite', original.route, async function (tx) {
        var state = await stateIn(tx); V.requireFresh({ identityRevision: original.state.identityRevision, route: original.route }, state, tx.route);
        tx.objectStore(R.controlStore).put(saved);
      });
      var published = { status: saved.status, overlaps: saved.overlaps, unresolved: saved.unresolved };
      return Object.assign(await observedEvidence(published, original), { retainedStatus: retained.status, combinedAvailable: false, confirmationBlocker: 'OUTBOX_ATOMIC_BARRIER_UNAVAILABLE', metrics: retained.metrics,
        identityRevision: original.state.identityRevision, route: original.route });
    }
    async function readValidity(personId) {
      Model.personTarget(personId); var current = await snapshot(personId), person = current.state.persons.find(function (p) { return p.personId === personId; });
      if (!person) throw error('IDENTITY_PERSON_NOT_FOUND', 'Person does not exist');
      return Object.assign(await observedEvidence(V.validity(current.saved, person, current.state, current.route), current), { combinedAvailable: false,
        identityRevision: current.state.identityRevision, route: current.route });
    }
    async function previewPublishedLink(ids, expectedRevision, personId, settings) {
      if (!E) throw error('IDENTITY_POLICY_UNAVAILABLE', 'Published-ledger policy is unavailable');
      ids = V.members(ids); personId = personId === undefined ? Model.createPersonId(globalThis.crypto) : Model.personTarget(personId).personId;
      var original = await publishedSnapshot(personId);
      if (original.state.identityRevision !== expectedRevision) throw error('IDENTITY_REVISION_CONFLICT', 'Identity changed; create another preview');
      var proposal = V.proposal(original.state, ids, personId), retained = await scan(proposal.proposedMembers, original, settings, true);
      var preview = Object.assign(proposal, retained, { policy: E.POLICY, manualAssertionRequired: true, pendingOutboxCovered: false,
        validationComplete: retained.status === 'SAFE', identityRevision: original.state.identityRevision, route: original.route,
        previewId: Model.createPersonId(globalThis.crypto), confirmationAvailable: retained.status === 'SAFE' && !proposal.requiresExplicitNameResolution });
      while (receipts.size >= 4) receipts.delete(receipts.keys().next().value);
      receipts.set(preview.previewId, { preview: copy(preview), original: original, expires: Date.now() + 5 * 60 * 1000 }); return copy(preview);
    }
    async function confirmPublishedLink(preview, settings) {
      var receipt = preview && receipts.get(preview.previewId);
      if (!E || !receipt || !receipt.original || receipt.expires <= Date.now() || JSON.stringify(receipt.preview) !== JSON.stringify(preview))
        throw error('IDENTITY_STALE_PREVIEW', 'Published preview expired, changed or belongs to another connection');
      // Capture caller-owned data before acquiring asynchronous transactions.
      preview = copy(receipt.preview); settings = settings && Object.assign({}, settings);
      if (preview.policy !== E.POLICY) throw error('IDENTITY_WRONG_POLICY', 'Explicit published-ledger policy required');
      if (!settings || settings.manualAssertion !== true) throw error('IDENTITY_MANUAL_ASSERTION_REQUIRED', 'Explicit manual common-identity assertion required');
      var original = receipt.original;
      if (preview.requiresExplicitNameResolution) throw error('IDENTITY_NAME_CONFLICT', 'Resolve assigned names explicitly before linking');
      if (!preview.validationComplete || preview.status !== 'SAFE') throw error('IDENTITY_' + preview.status, 'Complete SAFE published evidence required');
      var observed = await publishedSnapshot(preview.personId); V.requireFresh(preview, observed.state, observed.route);
      // Repeat complete validation. No chrome.storage observation licenses this policy.
      var retained = await scan(preview.proposedMembers, original, settings, true);
      if (retained.status !== 'SAFE') throw error('IDENTITY_' + retained.status, 'Fresh published validation failed');
      var committed = await publishedSnapshot(preview.personId, 'readwrite', original.route, function (tx, current) {
        V.requireFresh(preview, current.state, current.route);
        var proposal = V.proposal(current.state, preview.rawIds, preview.personId);
        if (JSON.stringify(proposal) !== JSON.stringify(V.proposal(original.state, preview.rawIds, preview.personId)) ||
            JSON.stringify(current.publication) !== JSON.stringify(original.publication) || JSON.stringify(current.member) !== JSON.stringify(original.member) || JSON.stringify(current.saved) !== JSON.stringify(original.saved))
          throw error('IDENTITY_STALE_PREVIEW', 'Membership or proof changed; create another preview');
        var next = Model.linkInternal(current.state, preview.rawIds, preview.personId, preview.identityRevision);
        // Certificate activation/renewal itself changes the identity revision.
        if (next.identityRevision === current.state.identityRevision) {
          if (next.identityRevision === Number.MAX_SAFE_INTEGER) throw error('IDENTITY_REVISION_EXHAUSTED', 'Identity revision exhausted');
          next.identityRevision += 1; next = Model.validate(next);
        }
        var person = next.persons.find(function (p) { return p.personId === preview.personId; }), priorPerson = current.state.persons.find(function (p) { return p.personId === preview.personId; });
        var member = current.member;
        if (member && !E.validMembership(member, preview.personId)) throw error('IDENTITY_INVALID_METADATA', 'Malformed membership epoch');
        if (!member || !priorPerson || JSON.stringify(priorPerson.members) !== JSON.stringify(person.members)) member = E.membership(preview.personId, Model.createPersonId(globalThis.crypto));
        var publication = E.validControl(current.publication, current.route) ? current.publication : E.control(current.route, Model.createPersonId(globalThis.crypto));
        var saved = E.certificate(person, next, current.route, publication, member, retained, retained.sessionNamespaces, Date.now());
        var store = tx.objectStore(R.controlStore);
        Adapter.metadata.writeNext(store, current.rows, current.state, next);
        store.put(member); store.put(publication); store.put(saved);
        return { state: next, certificate: saved, eligibility: E.check(next, person.personId, current.route, publication, member, saved, Date.now()) };
      });
      receipts.delete(preview.previewId); return committed;
    }
    async function readEligibility(personId) {
      Model.personTarget(personId);
      try { var current = await publishedSnapshot(personId); return E.check(current.state, personId, current.route, current.publication, current.member, current.saved, Date.now()); }
      catch (unavailable) { return { eligible: false, status: 'UNRESOLVED', reason: typeof unavailable.code === 'string' && unavailable.code.indexOf('IDENTITY_') === 0 ? 'INVALID_IDENTITY_METADATA' : 'AUTHORITY_UNAVAILABLE', policy: E && E.POLICY, pendingOutboxCovered: false }; }
    }
    return Object.freeze({ previewLink: previewLink, confirmLink: confirmLink, revalidatePerson: revalidatePerson, readValidity: readValidity,
      previewPublishedLink: previewPublishedLink, confirmPublishedLink: confirmPublishedLink, readEligibility: readEligibility,
      unlink: function (personId, id, expectedRevision) { return foundation.unlinkInternal(personId, id, expectedRevision); },
      close: function () { receipts.clear(); foundation.close(); db.close(); } });
  }
  return Object.freeze({ open: open });
});
