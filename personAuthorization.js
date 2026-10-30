/* Dormant production boundary. Chrome supplies sender identity; caller flags never prove a gesture. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPersonAuthorization = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var PORT = 'pnhud-person-management-v1', PAGE = 'personManagement.html';
  var LIMITS = Object.freeze({ ports: 4, queued: 8, bytes: 512 * 1024, consentMs: 30 * 60 * 1000, reviewMs: 2 * 60 * 1000, leaseMs: 1500 });
  var COUNTS = Object.freeze({ status: 0, consent: 1, revoke: 0, read: 0, catalog: 0, name: 3, preview: 3, confirm: 2, previewUnlink: 3, confirmUnlink: 1, eligibility: 1, query: 2, sessionQuery:3, recentQuery:2,trendsQuery:2,history:1, fence: 1 });
  function failure(code) { return Object.assign(new Error(code), { code: code }); }
  function exact(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function senderAllowed(sender, runtime) {
    return !!(sender && sender.id === runtime.id && sender.origin === 'chrome-extension://' + runtime.id &&
      sender.url === runtime.getURL(PAGE) && sender.frameId === 0 && sender.documentLifecycle === 'active' &&
      sender.tab && Number.isSafeInteger(sender.tab.id) && sender.tab.id >= 0 && typeof sender.documentId === 'string' && sender.documentId.length > 0);
  }
  function install(options) {
    var runtime = options.runtime, now = options.now || Date.now, uuid = options.uuid || function () { return crypto.randomUUID(); };
    var connections = new Set(), documents = new Map(), epoch = 0;
    function changed(origin) { connections.forEach(function (c) { if (c !== origin) c.invalidate(); }); }
    runtime.onConnect.addListener(function (port) {
      if (port.name !== PORT) return;
      // Disabled selection refuses before importing/opening any Person native owner.
      if (!options.enabled() || !senderAllowed(port.sender, runtime) || connections.size >= LIMITS.ports) { port.disconnect(); return; }
      var sender = port.sender, previous = documents.get(sender.tab.id);
      if (previous) previous.close();
      var closed = false, accepted = false, consentAt = 0, consentEpoch = epoch, tail = Promise.resolve(), queued = 0, last = 0;
      var ownersPromise, owners, review = null, issuedFence = null, baseline = null, observing = false, mutation = false, observationGeneration = 0;
      var timer = null;
      function send(m) {
        if (closed) return;
        try { port.postMessage(m); }
        catch (e) { close(); (options.reportError || console.warn)('Person response lost; native result may be UNKNOWN: ' + e.message); }
      }
      function authorized() { return !closed && options.enabled() && accepted && consentEpoch === epoch && now() >= consentAt && now() - consentAt < LIMITS.consentMs; }
      function requireAuthorization() { if (!authorized()) throw failure('PERSON_CONSENT_REQUIRED'); }
      function invalidate() { observationGeneration++; review = null; issuedFence = null; send({ changed: true }); }
      function clearConsent() { accepted = false; review = null; issuedFence = null; baseline = null; observationGeneration++; if (timer !== null) (options.clearInterval || clearInterval)(timer); timer = null; }
      function close() {
        if (closed) return;
        closed = true; clearConsent();
        if (documents.get(sender.tab.id) === connection) documents.delete(sender.tab.id);
        // An already dispatched transaction may commit: dropping ACK never means rollback.
        tail.finally(async function () {
          // Observation can be opening owners outside the request tail. Retain
          // the capacity slot until that original open and accepted work drain.
          try { if (ownersPromise) await ownersPromise; }
          finally {
            try { if (owners) Object.values(owners).forEach(function (o) { o.close(); }); }
            finally { connections.delete(connection); }
          }
        }).catch(function (e) { (options.reportError || console.error)(e); });
        port.disconnect();
      }
      var connection = { close: close, invalidate: invalidate, revoke: function () { clearConsent(); send({ revoked: true }); }, settled: function () { return tail; } };
      connections.add(connection); documents.set(sender.tab.id, connection);
      async function open() {
        requireAuthorization();
        if (!ownersPromise) ownersPromise = options.openOwners().then(function (o) { owners = o; return o; });
        var o = await ownersPromise; requireAuthorization(); return o;
      }
      async function observe() {
        if (closed || observing) return;
        if (!authorized()) { connection.revoke(); return; }
        observing = true; var generation = observationGeneration;
        try {
          var o = await open(), version = await o.observer.read();
          var invalid = !mutation && baseline && !exact(baseline, version);
          if (!mutation && issuedFence && !(await o.reader.validateFence(issuedFence)).available) invalid = true;
          if (closed || generation !== observationGeneration || !authorized()) return;
          if (invalid) invalidate();
          baseline = version; send({ observed: true });
        } catch (e) { if (!closed) { invalidate(); close(); } }
        finally { observing = false; }
      }
      async function known(o, ids, revision) {
        var state = await o.identity.read();
        if (state.identityRevision !== revision) throw failure('IDENTITY_REVISION_CONFLICT');
        ids.forEach(function (id) {
          options.model.rawId(id);
          if (!state.players.some(function (p) { return options.model.rawKey(p.playerId) === options.model.rawKey(id); })) throw failure('IDENTITY_AMBIGUOUS_ID');
        });
        return state;
      }
      function saveReview(value, native, kind) {
        var result = Object.assign({}, value, { authorizationReviewId: uuid() });
        review = { result: clone(result), native: native, kind: kind, expires: now() + LIMITS.reviewMs };
        return result;
      }
      function consume(value, kind) {
        var r = review; review = null;
        if (!r || r.kind !== kind || now() >= r.expires || !exact(value, r.result)) throw failure('IDENTITY_STALE_PREVIEW');
        return r;
      }
      async function dispatch(method, args, revocationTails, requestEpoch) {
        if (method === 'status') return { enabled: true, consent: authorized(), policy: 'extension-document-v1', backupReady: false };
        if (method !== 'revoke' && requestEpoch !== epoch) throw failure('PERSON_CONSENT_REQUIRED');
        if (method === 'consent') {
          if (args[0] !== 'manual-person-consent-v1') throw failure('PERSON_CONSENT_REQUIRED');
          // This is trusted extension code's assertion, not worker proof of physical input.
          clearConsent(); accepted = true; consentAt = now(); consentEpoch = epoch;
          timer = (options.setInterval || setInterval)(observe, 250);
          return { consent: true, expiresAt: consentAt + LIMITS.consentMs };
        }
        if (method === 'revoke') { await Promise.all(revocationTails); return { consent: false, retained: true }; }
        requireAuthorization(); var o = await open(); requireAuthorization();
        if (method === 'read') {
          observationGeneration++; baseline = await o.observer.read(); issuedFence = null;
          var state = await o.identity.read(); requireAuthorization();
          // Supersede observers started during either await as well as those
          // already pending when refresh began. Their old fence comparison
          // cannot revoke this completed readback. Later revisions still do.
          observationGeneration++; send({ observed: true }); return state;
        }
        if (method === 'catalog') return o.catalog.read();
        if (method === 'name') {
          var target = options.model.personTarget(args[0].personId);
          if (!exact(target, args[0])) throw failure('IDENTITY_INVALID_TARGET');
          requireAuthorization(); return o.identity.setAssignedName(target, args[1], args[2]);
        }
        if (method === 'preview') {
          review = null;
          if (!Array.isArray(args[0])) throw failure('IDENTITY_INVALID_ID');
          await known(o, args[0], args[1]); requireAuthorization();
          var preview = await o.links.previewPublishedLink(args[0], args[1], args[2] === null ? undefined : args[2]);
          requireAuthorization(); return saveReview(preview, preview, 'link');
        }
        if (method === 'confirm') {
          var link = consume(args[0], 'link');
          if (!exact(args[1], { manualAssertion: true })) throw failure('IDENTITY_MANUAL_ASSERTION_REQUIRED');
          await known(o, link.native.proposedMembers, link.native.identityRevision); requireAuthorization();
          return o.links.confirmPublishedLink(link.native, { manualAssertion: true });
        }
        if (method === 'previewUnlink') {
          review = null; var current = await known(o, [args[1]], args[2]), person = current.persons.find(function (p) { return p.personId === args[0]; });
          options.model.personTarget(args[0]);
          if (!person || !person.members.some(function (id) { return options.model.rawKey(id) === options.model.rawKey(args[1]); })) throw failure('IDENTITY_MEMBERSHIP_CONFLICT');
          requireAuthorization(); return saveReview({ personId: args[0], rawId: args[1], revision: args[2] }, null, 'unlink');
        }
        if (method === 'confirmUnlink') { var unlink = consume(args[0], 'unlink').result; requireAuthorization(); return o.links.unlink(unlink.personId, unlink.rawId, unlink.revision); }
        if (method === 'eligibility') return o.links.readEligibility(args[0]);
        if (['query','sessionQuery','history','recentQuery','trendsQuery'].includes(method)) {
          options.model.personTarget(args[0].personId);
          if (!exact(args[0], options.model.personTarget(args[0].personId))) throw failure('IDENTITY_INVALID_TARGET');
          var result = await (method==='query'?o.reader.query(args[0],args[1]):method==='sessionQuery'?o.reader.querySession(args[0],args[1],args[2]):method==='recentQuery'?o.reader.queryRecent(args[0],args[1]):method==='trendsQuery'?o.reader.queryTrends(args[0],args[1]):o.reader.listSessions(args[0])); requireAuthorization();
          issuedFence = result.available && result.grouped ? clone(result.fence) : null; return result;
        }
        if (method === 'fence') {
          if (!issuedFence || !exact(issuedFence, args[0])) throw failure('PERSON_INVALID_FENCE');
          var valid = await o.reader.validateFence(issuedFence); requireAuthorization(); if (!valid.available) issuedFence = null; return valid;
        }
        throw failure('PERSON_INVALID_REQUEST');
      }
      port.onDisconnect.addListener(close);
      port.onMessage.addListener(function (m) {
        if (closed) return;
        if (!options.enabled() || !m || Object.keys(m).sort().join(',') !== 'args,id,method,version' || m.version !== 1 || !Number.isSafeInteger(m.id) || m.id <= last ||
            !Object.hasOwn(COUNTS, m.method) || !Array.isArray(m.args) || m.args.length !== COUNTS[m.method] || queued >= LIMITS.queued || new TextEncoder().encode(JSON.stringify(m)).length > LIMITS.bytes) { close(); return; }
        last = m.id; queued++;
        var revocationTails = [], requestEpoch = epoch;
        if (m.method === 'revoke') { revocationTails = Array.from(connections).map(function (c) { return c.settled(); }); epoch++; connections.forEach(function (c) { c.revoke(); }); }
        tail = tail.then(async function () {
          if (closed) return;
          var write = ['name', 'confirm', 'confirmUnlink'].indexOf(m.method) >= 0;
          try {
            if (write) { mutation = true; observationGeneration++; issuedFence = null; }
            var value = await dispatch(m.method, m.args, revocationTails, requestEpoch);
            if (['status', 'consent', 'revoke'].indexOf(m.method) < 0) requireAuthorization();
            if (write) { requireAuthorization(); baseline = await owners.observer.read(); changed(connection); }
            send({ id: m.id, ok: true, wire: JSON.stringify(value, function (_, v) { return v === Infinity ? { personNumber: 'Infinity' } : v; }) });
          } catch (e) { send({ id: m.id, ok: false, code: e.code || 'PERSON_NATIVE_ERROR', message: e.message }); }
          finally { queued--; mutation = false; }
        });
      });
    });
    return Object.freeze({ close: function () { Array.from(connections).forEach(function (c) { c.close(); }); } });
  }
  return Object.freeze({ PORT: PORT, PAGE: PAGE, LIMITS: LIMITS, senderAllowed: senderAllowed, install: install });
});
