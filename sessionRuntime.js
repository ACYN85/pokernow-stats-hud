/* Revision-aware Session persistence planning and invalidation classification. */
(function (root, factory) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerSessionRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var INVALIDATION = Object.freeze({
    finalizedStats: Object.freeze({ leaderboard: true, seatStats: true, dashboardSession: true, geometry: false, style: false }),
    liveUi: Object.freeze({ leaderboard: false, seatStats: false, dashboardSession: false, geometry: false, style: false }),
    seatGeometry: Object.freeze({ leaderboard: false, seatStats: false, dashboardSession: false, geometry: true, style: false }),
    settingsStyle: Object.freeze({ leaderboard: false, seatStats: false, dashboardSession: false, geometry: false, style: true }),
    none: Object.freeze({ leaderboard: false, seatStats: false, dashboardSession: false, geometry: false, style: false })
  });

  function invalidationFor(category) { return INVALIDATION[category] || INVALIDATION.none; }

  // These are the ten scoped legacy authority keys, including recovery/runtime
  // facts. Demo arrays, UI preferences and Career/outbox keys are separate.
  var SESSION_STORAGE_PREFIXES = Object.freeze([
    'pokerNowHudLiveEvents:', 'pokerNowHudLiveEventsRevision:',
    'pokerNowHudLiveFingerprints:', 'pokerNowHudLiveSchemaVersion:',
    'pokerNowHudPlayerMap:', 'pokerNowHudHandSignatures:',
    'pokerNowHudActiveHand:', 'pokerNowHudFinalizedHandIds:',
    'pokerNowHudHostControl:', 'pokerNowHudSessionMeta:'
  ]);
  function isSessionStorageKey(key) {
    return typeof key === 'string' && SESSION_STORAGE_PREFIXES.some(function (prefix) { return key.indexOf(prefix) === 0; });
  }
  function requireNonSessionKeys(keys) {
    if (keys.some(isSessionStorageKey)) throw new Error('SESSION_WRITER_GATEWAY_REQUIRED');
  }
  function createWriterGateway(options) {
    var scope = Object.freeze(Object.assign({}, options.scope));
    var origin = Object.freeze(Object.assign({}, options.origin));
    var authorityKeys = options.authorityKeys.slice();
    var sequence = 0, pending = 0, completed = 0, unresolved = 0, latest = null, writePermit = options.writePermit || null;
    var writerOwner = null, directDispatches = 0, ownedPending = 0, draftUnknown = false;
    function permit() {
      if (draftUnknown) throw Object.assign(new Error('LEGACY_DRAFT_ACK_UNKNOWN'), { code: 'LEGACY_DRAFT_ACK_UNKNOWN' });
      if (writePermit && writePermit() !== true || writerOwner && writerOwner.isCurrent() !== true)
        throw Object.assign(new Error('LEGACY_WRITE_FENCED'), { code: 'LEGACY_WRITE_FENCED' });
    }
    function fenceWrites(check) {
      if (writePermit || typeof check !== 'function') throw new Error('LEGACY_WRITE_FENCE_REUSE');
      writePermit = check; // One binding per original gateway; no unfence/reset API.
    }
    function bindWriterOwner(owner) {
      if (writerOwner) throw new Error('LEGACY_WRITER_OWNER_REUSE');
      if (!owner || typeof owner.run !== 'function' || typeof owner.isCurrent !== 'function') throw new Error('LEGACY_WRITER_OWNER_REQUIRED');
      // An old unbound callback (including callback-free preferences/outbox work)
      // cannot be retroactively turned into a durable BEGIN. Require construction
      // before any original dispatch, rather than claiming a later census is safe.
      if (sequence || directDispatches || pending || unresolved) throw new Error('LEGACY_WRITER_COLD_START_REQUIRED');
      writerOwner = owner;
    }
    function reportDraft(value) {
      if (!writerOwner) return Promise.resolve(false);
      if (typeof value !== 'boolean') return Promise.reject(new Error('LEGACY_DRAFT_STATE_REQUIRED'));
      if (draftUnknown) return Promise.reject(new Error('LEGACY_DRAFT_ACK_UNKNOWN'));
      var result;
      try {
        if (typeof writerOwner.dirty !== 'function') throw new Error('LEGACY_DRAFT_OWNER_REQUIRED');
        result = writerOwner.dirty(value);
      } catch (error) { result = Promise.reject(error); }
      return Promise.resolve(result).catch(function (error) { draftUnknown = true; throw error; });
    }
    function ownedWrite(kind, dispatch) {
      ownedPending++; var started = false;
      return Promise.resolve().then(function () {
        permit();
        return writerOwner.run(kind, function () {
          if (started) throw new Error('LEGACY_WRITER_DISPATCH_REUSED');
          started = true;
          permit();
          return new Promise(function (resolve, reject) {
            dispatch(function (error) { if (error) reject(error); else resolve(); });
          });
        });
      }).then(function () {
        ownedPending--;
        if (!started) throw new Error('LEGACY_WRITER_DISPATCH_UNKNOWN');
        permit(); // A late ACK never revives the original lease.
      }, function (error) { ownedPending--; throw error; });
    }
    function chromeSet(update, callback) { directDispatches++; return options.set(update, callback); }
    function chromeRemove(keys, callback) { directDispatches++; return options.remove(keys, callback); }
    function captureOwned(value) {
      // Preserve the values at the original API call, before BEGIN's await.
      // This private path is deliberately JSON-only; refuse accessors, unusual
      // prototypes and unsupported values instead of normalizing them into a
      // different request that an original native validator would then accept.
      var seen = new Set(), nodes = 0;
      function copy(v, depth) {
        if (++nodes > 150000 || depth > 64) throw new Error('LEGACY_WRITER_SNAPSHOT_LIMIT');
        if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        if (!v || typeof v !== 'object' || seen.has(v)) throw new Error('LEGACY_WRITER_SNAPSHOT_UNSUPPORTED');
        var array = Array.isArray(v), prototype = Object.getPrototypeOf(v);
        if ((array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(v).length)
          throw new Error('LEGACY_WRITER_SNAPSHOT_UNSUPPORTED');
        seen.add(v); var result = array ? [] : {}, descriptors = Object.getOwnPropertyDescriptors(v);
        Object.keys(descriptors).forEach(function (key) {
          if (array && key === 'length') return;
          var d = descriptors[key];
          if (!d.enumerable || !Object.prototype.hasOwnProperty.call(d, 'value')) throw new Error('LEGACY_WRITER_SNAPSHOT_UNSUPPORTED');
          Object.defineProperty(result, key, { value: copy(d.value, depth + 1), writable: true, enumerable: true, configurable: true });
        });
        if (array && result.length !== v.length) throw new Error('LEGACY_WRITER_SNAPSHOT_UNSUPPORTED');
        seen.delete(v); return result;
      }
      return copy(value, 0);
    }
    function submit(request, callback) {
      var state = options.state();
      var keys = Object.keys(request.update);
      var sessionKeys = keys.filter(isSessionStorageKey);
      var operation = {
        version: 1, sequence: ++sequence, purpose: request.purpose,
        scope: scope, origin: origin, authority: 'LEGACY_CHROME',
        authorization: 'LEGACY_AUTHORIZED', status: 'PENDING_PUBLICATION', committed: false,
        sessionIdBefore: state.sessionId, epoch: null,
        mutation: Object.freeze({ method: 'set', sessionKeys: Object.freeze(sessionKeys),
          ancillaryKeys: Object.freeze(keys.filter(function (key) { return !isSessionStorageKey(key); })),
          targetSessionId: request.update[options.sessionMetaKey] ? request.update[options.sessionMetaKey].historicalSessionId : state.sessionId,
          legacyRevision: request.update[options.revisionKey] === undefined ? null : request.update[options.revisionKey] })
      };
      var ticket = Object.freeze({ inspect: function () { return Object.freeze(Object.assign({}, operation)); } });
      latest = ticket;
      var rejection = null;
      if (request.authority && request.authority !== 'LEGACY_CHROME') rejection = 'NEW_AUTHORITY_DISABLED';
      else if (!options.ownsController() || !request.purpose || !sessionKeys.length || sessionKeys.some(function (key) { return authorityKeys.indexOf(key) < 0; })) rejection = 'STALE_OR_UNAUTHORIZED_PRODUCER';
      else if (Object.prototype.hasOwnProperty.call(request, 'expectedSessionId') && request.expectedSessionId !== state.sessionId ||
               Object.prototype.hasOwnProperty.call(request, 'expectedEpoch') && request.expectedEpoch !== null) rejection = 'RESET_OR_EPOCH_MISMATCH';
      if (rejection) {
        operation.authorization = rejection; operation.status = rejection;
        var error = new Error(rejection); error.code = rejection;
        if (typeof callback === 'function') callback(error, ticket.inspect());
        return ticket;
      }
      try { permit(); } catch (error) {
        operation.authorization = operation.status = error.code;
        if (typeof callback === 'function') callback(error, ticket.inspect());
        return ticket;
      }
      // No payload copy, queue, retry, native owner, admission or cross-document
      // lock. The existing queue still owns coalescing and dispatch ordering.
      pending++;
      var settled = false;
      function finish(error) {
        if (settled) return;
        settled = true; pending--;
        operation.status = error ? 'UNRESOLVED_PUBLICATION' : 'LEGACY_COMMITTED';
        operation.committed = !error;
        if (error) unresolved++; else completed++;
      }
      if (writerOwner) {
        var capturedRequest;
        try { capturedRequest = captureOwned(request); }
        catch (error) { finish(error); if (typeof callback === 'function') callback(error, ticket.inspect()); return ticket; }
        ownedWrite('session-write', function (done) {
          if (options.protocol) {
            // BEGIN covers native reservation, Chrome publication and the native
            // completion ACK. The existing protocol remains the sole dispatcher.
            options.protocol.submit(capturedRequest, function (original, protocolDone) {
              try { permit(); chromeSet(original, function () { protocolDone(options.lastError()); }); }
              catch (error) { protocolDone(error); }
            }, done);
          } else chromeSet(capturedRequest.update, function () { done(options.lastError()); });
        }).then(function () {
          finish(null); if (typeof callback === 'function') callback(null, ticket.inspect());
        }, function (error) {
          finish(error); if (typeof callback === 'function') callback(error, ticket.inspect());
        });
        return ticket;
      }
      try {
        if (options.protocol) {
          options.protocol.submit(request, function (original, completed) {
            try { permit(); } catch (error) { completed(error); return; }
            chromeSet(original, function () { completed(options.lastError()); });
          }, function (error) {
            finish(error); if (typeof callback === 'function') callback(error, ticket.inspect());
          });
          return ticket;
        }
        chromeSet(request.update, function () {
          if (settled) return;
          var error = options.lastError();
          finish(error);
          // Runs inside the actual Chrome callback, preserving lastError and
          // the existing caller's success/error boundary. No early durable ack.
          if (typeof callback === 'function') callback(error, ticket.inspect());
        });
      } catch (error) {
        finish(error);
        throw error;
      }
      return ticket;
    }
    function writeNonSession(update, callback) {
      requireNonSessionKeys(Object.keys(update));
      try { permit(); } catch (error) { if (typeof callback === 'function') return callback(error); return Promise.reject(error); }
      if (writerOwner) {
        var capturedUpdate;
        try { capturedUpdate = captureOwned(update); }
        catch (error) { if (typeof callback === 'function') return callback(error); return Promise.reject(error); }
        var pendingWrite = ownedWrite('notes-write', function (done) { chromeSet(capturedUpdate, function () { done(options.lastError()); }); });
        if (typeof callback === 'function') { pendingWrite.then(function () { callback(null); }, callback); return; }
        return pendingWrite;
      }
      // Preserve callback-free calls too; do not introduce a new preference ack.
      return chromeSet(update, callback);
    }
    function removeNonSession(keys, callback) {
      requireNonSessionKeys(Array.isArray(keys) ? keys : [keys]);
      try { permit(); } catch (error) { if (typeof callback === 'function') return callback(error); return Promise.reject(error); }
      if (writerOwner) {
        var capturedKeys;
        try { capturedKeys = captureOwned(keys); }
        catch (error) { if (typeof callback === 'function') return callback(error); return Promise.reject(error); }
        var pendingRemoval = ownedWrite('notes-write', function (done) { chromeRemove(capturedKeys, function () { done(options.lastError()); }); });
        if (typeof callback === 'function') { pendingRemoval.then(function () { callback(null); }, callback); return; }
        return pendingRemoval;
      }
      return chromeRemove(keys, callback);
    }
    if (options.writerOwner) bindWriterOwner(options.writerOwner);
    return Object.freeze({ submit: submit, writeNonSession: writeNonSession, removeNonSession: removeNonSession, fenceWrites: fenceWrites, bindWriterOwner: bindWriterOwner, reportDraft: reportDraft,
      inspect: function () { return { authority: 'LEGACY_CHROME', nativeEnabled: false, pending: pending,
        completed: completed, unresolved: unresolved, writerOwnerBound: Boolean(writerOwner), directDispatches: directDispatches,
        ownedPending: ownedPending, draftUnknown: draftUnknown, latest: latest ? latest.inspect() : null }; } });
  }
  function createPersistencePlanner(options) {
    options = options || {};
    var initial = Math.max(0, Number(options.initialFinalizedRevision || 0));
    var persisted = Math.max(0, Number(options.persistedFinalizedRevision === undefined ? initial : options.persistedFinalizedRevision));
    return {
      queuedFinalizedRevision: persisted,
      persistedFinalizedRevision: persisted,
      plans: 0, finalizedPlans: 0, recoveryOnlyPlans: 0, completed: 0, failures: 0,
      recent: []
    };
  }
  function record(state, entry) { state.recent.push(entry); if (state.recent.length > 30) state.recent.shift(); }
  function planPersistence(state, request) {
    request = request || {};
    var revision = Math.max(0, Number(request.finalizedRevision || 0));
    var includesFinalized = request.forceFinalized === true || revision > state.queuedFinalizedRevision;
    var payload = Object.assign({}, includesFinalized ? request.finalized || {} : {}, request.recovery || {});
    state.plans += 1;
    if (includesFinalized) {
      state.finalizedPlans += 1;
      state.queuedFinalizedRevision = revision;
    } else state.recoveryOnlyPlans += 1;
    var plan = { payload: payload, finalizedRevision: revision, includesFinalized: includesFinalized, reason: String(request.reason || 'unspecified') };
    record(state, { type: 'planned', finalizedRevision: revision, includesFinalized: includesFinalized, reason: plan.reason });
    return plan;
  }
  function completePersistence(state, plan, error) {
    if (!plan) return;
    if (error) {
      state.failures += 1;
      if (plan.includesFinalized && state.queuedFinalizedRevision === plan.finalizedRevision) state.queuedFinalizedRevision = state.persistedFinalizedRevision;
      record(state, { type: 'failed', finalizedRevision: plan.finalizedRevision, includesFinalized: plan.includesFinalized, error: String(error.message || error) });
      return;
    }
    state.completed += 1;
    if (plan.includesFinalized) state.persistedFinalizedRevision = Math.max(state.persistedFinalizedRevision, plan.finalizedRevision);
    record(state, { type: 'completed', finalizedRevision: plan.finalizedRevision, includesFinalized: plan.includesFinalized });
  }
  function observePersistedRevision(state, revision) {
    revision = Math.max(0, Number(revision || 0));
    state.persistedFinalizedRevision = Math.max(state.persistedFinalizedRevision, revision);
    state.queuedFinalizedRevision = Math.max(state.queuedFinalizedRevision, revision);
  }
  function inspectPersistence(state) {
    return {
      queuedFinalizedRevision: state.queuedFinalizedRevision,
      persistedFinalizedRevision: state.persistedFinalizedRevision,
      plans: state.plans, finalizedPlans: state.finalizedPlans, recoveryOnlyPlans: state.recoveryOnlyPlans,
      completed: state.completed, failures: state.failures,
      recent: state.recent.map(function (entry) { return Object.assign({}, entry); })
    };
  }
  function validHistoricalSessionId(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  }
  function newHistoricalSessionId(cryptoSource) {
    var source = cryptoSource || rootCrypto();
    if (!source || typeof source.getRandomValues !== 'function') return null;
    var bytes = new Uint8Array(16);
    try { source.getRandomValues(bytes); } catch (_error) { return null; }
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes).map(function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }
  function rootCrypto() { return typeof globalThis !== 'undefined' ? globalThis.crypto : null; }
  function restoreHistoricalSessionId(meta, gameId, sessionKey) {
    return meta && meta.gameId === gameId && meta.sessionKey === sessionKey && validHistoricalSessionId(meta.historicalSessionId)
      ? meta.historicalSessionId : null;
  }
  return Object.freeze({ SESSION_STORAGE_PREFIXES: SESSION_STORAGE_PREFIXES, isSessionStorageKey: isSessionStorageKey, createWriterGateway: createWriterGateway, INVALIDATION: INVALIDATION, invalidationFor: invalidationFor, createPersistencePlanner: createPersistencePlanner, planPersistence: planPersistence, completePersistence: completePersistence, observePersistedRevision: observePersistedRevision, inspectPersistence: inspectPersistence, validHistoricalSessionId: validHistoricalSessionId, newHistoricalSessionId: newHistoricalSessionId, restoreHistoricalSessionId: restoreHistoricalSessionId });
});
