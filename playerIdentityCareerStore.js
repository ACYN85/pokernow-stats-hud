/* Internal native Person Career reader. Deliberately absent from production routes. */
(function (root, factory) {
  'use strict';
  var m = root.PokerPlayerIdentity, s = root.PokerPlayerIdentityStore, e = root.PokerPlayerIdentityEligibility, c = root.PokerPlayerIdentityCareer, i = root.PokerCareerIndexedStore, f = root.PokerFilteredStats, v = root.PokerPlayerIdentityValidation;
  if (typeof module !== 'undefined' && module.exports) { m = require('./playerIdentity.js'); s = require('./playerIdentityStore.js'); e = require('./playerIdentityEligibility.js'); c = require('./playerIdentityCareer.js'); i = require('./careerIndexedStore.js'); f = require('./filteredStats.js'); v = require('./playerIdentityValidation.js'); }
  var api = factory(m, s, e, c, i, f, v);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPlayerIdentityCareerStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, S, E, C, I, F, V) {
  'use strict';
  var LIMITS = Object.freeze({ entries: 32, cacheBytes: 2 * 1024 * 1024, resultBytes: 256 * 1024, bytes: 32 * 1024 * 1024, candidates: V.LIMITS.candidates, groups: V.LIMITS.groups, deadlineMs: V.LIMITS.deadlineMs });
  function copy(value) { return structuredClone(value); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function error(code) { var e = Error(code); e.code = code; return e; }
  function request(r) { return new Promise(function (resolve, reject) { r.onsuccess = function () { resolve(r.result); }; r.onerror = function () { reject(r.error || Error('Identity Career read failed')); }; }); }
  function done(tx) { return new Promise(function (resolve, reject) { tx.oncomplete = resolve; tx.onerror = tx.onabort = function () { reject(tx.error || Error('Identity Career transaction failed')); }; }); }
  function unavailable(reason, eligibility, retry) { return { available: false, grouped: true, status: retry ? 'RETRY' : 'UNAVAILABLE', reason: reason, eligibility: eligibility || { eligible: false, status: 'UNRESOLVED', reason: reason, policy: E.POLICY, pendingOutboxCovered: false } }; }
  function bytes(row) { return new TextEncoder().encode(JSON.stringify(row)).length; }
  function selectedScope(selection){return {'history-catalog':'person-career-history','historical-session':'person-career-session','recent-sessions':'person-career-recent','session-trends':'person-career-trends'}[selection.kind];}
  async function open(indexedDB) {
    var R = I.routing, raw = await I.createIndexedService(indexedDB, {}, {}), db;
    try { db = await R.openDatabase(indexedDB); } catch (e) { raw.close(); throw e; }
    var cache = new Map(), cacheBytes = 0;
    function clear(personId) { cache.forEach(function (row, key) { if (row.personId === personId) { cacheBytes -= row.bytes; cache.delete(key); } }); }
    async function transaction(action) {
      var tx = await R.transaction(db, [R.controlStore, I.STORES.records, I.STORES.metadata, I.STORES.aggregates, I.STORES.playerHeads], 'readonly'), completion = done(tx);
      completion.catch(function () {});
      try { var result = await action(tx); await completion; return result; }
      catch (e) { try { tx.abort(); } catch (_abort) {} await completion.catch(function () {}); throw e; }
    }
    async function snapshot(tx, target, filters, selection) {
      var control = tx.objectStore(R.controlStore), rows = await request(control.getAll(IDBKeyRange.bound([S.NAMESPACE], [S.NAMESPACE + '\u0000'], false, true), S.metadata.maxRows + 1));
      var state = S.metadata.stateFor(rows), personId = target.kind === 'person' ? target.personId : (state.players.find(function (p) { return M.rawKey(p.playerId) === M.rawKey(target.playerId); }) || {}).personId;
      if (!personId) {
        var rawHead=await request(tx.objectStore(I.STORES.playerHeads).get(String(target.playerId)));
        if(rawHead&&(rawHead.playerId!==String(target.playerId)||!Number.isSafeInteger(rawHead.revision)||rawHead.revision<0))throw error('MALFORMED_CAREER_HEAD');
        return {raw:true,state:state,rawFence:{schemaVersion:1,scope:'raw-career',target:copy(target),filters:copy(filters),identityRevision:state.identityRevision,route:copy(tx.route),metadata:await request(tx.objectStore(I.STORES.metadata).get('career'))||null,head:rawHead?{playerId:rawHead.playerId,revision:rawHead.revision}:null}};
      }
      var values = await Promise.all([request(control.get(E.key('control'))), request(control.get(E.key('membership', personId))), request(control.get(E.key('certificate', personId)))]);
      var gate = E.check(state, personId, tx.route, values[0], values[1], values[2], Date.now());
      if (!gate.eligible) { clear(personId); return { failure: unavailable(gate.reason, gate) }; }
      var pairs = await Promise.all(gate.members.map(function (id) { return Promise.all([request(tx.objectStore(I.STORES.aggregates).get(String(id))), request(tx.objectStore(I.STORES.playerHeads).get(String(id)))]); }));
      var revisions = pairs.map(function (pair, n) { return { playerId: gate.members[n], revision: pair[1] ? pair[1].revision : null }; });
      var fence = { schemaVersion: 1, scope: 'career', target: M.personTarget(personId), members: gate.members.slice(), membershipSignature: JSON.stringify(gate.members.map(M.rawKey)),
        identityRevision: gate.identityRevision, membershipToken: gate.membershipToken, policy: gate.policy, epoch: gate.epoch, certificate: copy(values[2]), route: copy(tx.route), memberRevisions: revisions, filters: copy(filters), expiresAt: gate.expiresAt };
      if (selection) { fence.scope = selectedScope(selection); fence.selection = copy(selection); }
      // Broad identity/ledger revisions bind the RESPONSE, but do not discard an
      // unchanged population after unrelated, correctly tracked publications.
      var populationKey = JSON.stringify([personId, fence.membershipSignature, fence.membershipToken, fence.epoch, fence.policy, fence.route.bank, fence.route.careerGeneration, fence.certificate, revisions]);
      if (selection) populationKey = JSON.stringify([populationKey, selection]);
      var cacheKey = JSON.stringify([populationKey, filters]);
      return { personId: personId, state: state, gate: gate, pairs: pairs, fence: fence, cacheKey: cacheKey, populationKey: populationKey, metadata: await request(tx.objectStore(I.STORES.metadata).get('career')) };
    }
    async function selectedRecords(tx, ids, metrics) {
      var store = tx.objectStore(I.STORES.records), hands = new Set(), records = new Map(), started = Date.now(), totalBytes = 0;
      function budget() { if (Date.now() - started >= LIMITS.deadlineMs) throw error('GROUPED_QUERY_BUDGET'); }
      function wrapper(row, primaryKey) {
        if (!row || !row.record || row.record.fingerprint !== primaryKey || !Array.isArray(row.record.players) || typeof row.record.handKey !== 'string' || row.record.handKey.length > 2048 ||
            !same(row.playerIds, row.record.players.map(function (p) { return String(p && p.playerId); }))) throw error('MALFORMED_CAREER_WRAPPER');
        return row.record;
      }
      async function cursor(index, key, visit) {
        metrics.indexReads += 1;
        return new Promise(function (resolve, reject) {
          var r = store.index(index).openCursor(IDBKeyRange.only(key)); r.onerror = function () { reject(r.error); };
          r.onsuccess = function () { try { budget(); var row = r.result; if (!row) { resolve(); return; } visit(wrapper(row.value, row.primaryKey), row.value); row.continue(); } catch (e) { reject(e); } };
        });
      }
      for (var id of ids) await cursor('playerIds', String(id), function (record) {
        metrics.candidates += 1; if (metrics.candidates > LIMITS.candidates) throw error('GROUPED_QUERY_BUDGET');
        hands.add(record.handKey); if (hands.size > LIMITS.groups) throw error('GROUPED_QUERY_BUDGET');
      });
      var visited = new Set();
      async function peers(handKey, group) {
        if (visited.has(handKey)) return; visited.add(handKey); metrics.groups += 1;
        if (visited.size > LIMITS.groups) throw error('GROUPED_QUERY_BUDGET');
        // The keyPath is record.fingerprint, so getAll retains primary-key
        // validation while avoiding a second cursor event per peer. The peer
        // bound and all family/predecessor validation remain authoritative.
        budget(); metrics.indexReads += 1;
        var peerRows = await request(store.index('handKey').getAll(IDBKeyRange.only(handKey), V.LIMITS.peers + 1)); budget();
        if (peerRows.length > V.LIMITS.peers) throw error('GROUPED_QUERY_BUDGET');
        for (var row of peerRows) { var record = wrapper(row, row.record&&row.record.fingerprint);
          var size = bytes(row); totalBytes += size; group.bytes += size;
          if (group.records.length >= V.LIMITS.peers || group.bytes > V.LIMITS.bytes || totalBytes > LIMITS.bytes) throw error('GROUPED_QUERY_BUDGET');
          group.records.push(record); records.set(record.fingerprint, record); metrics.physicalRecordsRead += 1;
        }
      }
      for (var handKey of hands) {
        var group = { records: [], bytes: 0 }; await peers(handKey, group);
        for (var record of group.records) {
          if (record.supersedesFingerprint && !group.records.some(function (r) { return r.fingerprint === record.supersedesFingerprint; })) {
            budget(); var predecessor = await request(store.get(record.supersedesFingerprint)); metrics.predecessorReads += 1;
            if (!predecessor || !predecessor.record) throw error('AMBIGUOUS_CAREER_AUTHORITY');
            var prior = wrapper(predecessor, record.supersedesFingerprint); await peers(prior.handKey, group);
            if (!group.records.some(function (r) { return r.fingerprint === record.supersedesFingerprint; })) throw error('AMBIGUOUS_CAREER_AUTHORITY');
          }
        }
        var evidence = V.group(ids, handKey, group.records, true);
        if (evidence.status !== 'SAFE') throw error(evidence.status === 'CONFLICTING' ? 'PUBLISHED_OVERLAP' : 'AMBIGUOUS_CAREER_AUTHORITY');
      }
      metrics.physicalBytes = totalBytes; return Array.from(records.values());
    }
    async function validateFence(fence) {
      try {
        if(fence?.scope==='raw-career'){var rawTarget=M.validateTarget(fence.target);if(rawTarget.kind!=='player'||!Number.isSafeInteger(fence.issuedAt)||!Number.isSafeInteger(fence.expiresAt)||Date.now()<fence.issuedAt||Date.now()>=fence.expiresAt||fence.expiresAt<=fence.issuedAt||fence.expiresAt-fence.issuedAt>5000)return unavailable('INVALID_QUERY_FENCE');var currentRaw=await transaction(tx=>snapshot(tx,rawTarget,F.normalizeFilters(fence.filters),null)),expectedRaw=copy(fence);delete expectedRaw.issuedAt;delete expectedRaw.expiresAt;return currentRaw.raw&&same(currentRaw.rawFence,expectedRaw)?{available:true,current:true,fence:copy(fence)}:unavailable('GROUPED_SNAPSHOT_CHANGED',null,true);}
        if (!fence || fence.schemaVersion !== 1 || !['career', 'person-career-session', 'person-career-history','person-career-recent','person-career-trends'].includes(fence.scope)) return unavailable('INVALID_QUERY_FENCE');
        var target = M.validateTarget(fence.target), filters = F.normalizeFilters(fence.filters);
        if (target.kind !== 'person') return unavailable('INVALID_QUERY_FENCE');
        var selection = null;
        if (fence.scope === 'person-career-session') {
          if (!fence.selection || fence.selection.kind !== 'historical-session' || Object.keys(fence.selection).sort().join('|') !== 'kind|sessionId') return unavailable('INVALID_QUERY_FENCE');
          selection = { kind: 'historical-session', sessionId: C.historicalSessionId(fence.selection.sessionId) };
        }
        if (fence.scope === 'person-career-history') {
          if (!fence.selection || fence.selection.kind !== 'history-catalog' || Object.keys(fence.selection).join('|') !== 'kind' || !same(filters,F.normalizeFilters({}))) return unavailable('INVALID_QUERY_FENCE');
          selection = {kind:'history-catalog'};
        }
        if(['person-career-recent','person-career-trends'].includes(fence.scope)){
          if(!fence.selection||Object.keys(fence.selection).sort().join('|')!=='count|kind'||selectedScope(fence.selection)!==fence.scope||!same(filters,F.normalizeFilters({})))return unavailable('INVALID_QUERY_FENCE');
          selection={kind:fence.selection.kind,count:C.recentCount(fence.selection.count)};
        }
        var current = await transaction(function (tx) { return snapshot(tx, target, filters, selection); });
        if (current.failure) return current.failure;
        if (!same(current.fence, fence)) return unavailable('GROUPED_SNAPSHOT_CHANGED', current.gate, true);
        // Expiry may occur while a native transaction completes.
        if (Date.now() < fence.certificate.issuedAt || Date.now() >= fence.expiresAt) { clear(target.personId); return unavailable('EXPIRED_CERTIFICATE'); }
        return { available: true, current: true, fence: copy(current.fence) };
      } catch (e) { return unavailable(typeof e.code === 'string' ? e.code : 'AUTHORITY_UNAVAILABLE'); }
    }
    async function query(target, requestedFilters, selection) {
      target = M.validateTarget(target); var filters = F.normalizeFilters(requestedFilters);
      if (selection && target.kind !== 'person') throw error('HISTORICAL_PERSON_TARGET_REQUIRED');
      try {
        var result = await transaction(async function (tx) {
          var snap = await snapshot(tx, target, filters, selection); if (snap.failure) return snap.failure;
          if (snap.raw) return { raw: true, rawFence:snap.rawFence };
          var metrics = { cacheHit: false, maintainedAggregates: false, candidates: 0, groups: 0, indexReads: 0, physicalRecordsRead: 0, physicalBytes: 0, predecessorReads: 0 }, entry = cache.get(snap.cacheKey), statistics, disjoint = false;
          if (entry) { statistics = copy(entry.statistics); metrics.cacheHit = true; }
          else {
            var baseline = !selection && Array.from(cache.values()).find(function (row) { return row.populationKey === snap.populationKey && row.disjoint; });
            disjoint = !!baseline;
            if (baseline) statistics = C.fromProjection(snap.personId, baseline.statistics, filters);
            if (!statistics) {
              var records = await selectedRecords(tx, snap.gate.members, metrics);
              if (selection) {
                statistics = selection.kind === 'history-catalog' ? C.historyFromRecords(snap.gate.members,records) : ['recent-sessions','session-trends'].includes(selection.kind)?C.recentFromRecords(snap.personId,snap.gate.members,records,selection.count,selection.kind==='session-trends'):C.fromSessionRecords(snap.personId, snap.gate.members, records, selection.sessionId, filters);
                if (!statistics) return unavailable('HISTORICAL_SESSION_NOT_FOUND', snap.gate);
              }
              disjoint = !selection && C.disjointSingleVersion(snap.gate.members, records);
              if (disjoint && C.maintainedPopulationMatches(snap.gate.members, snap.pairs, records) && snap.metadata && snap.metadata.playerSummaryVersion === I.PLAYER_SUMMARY_VERSION) statistics = C.fromMaintained(snap.personId, snap.pairs, filters);
              metrics.maintainedAggregates = !selection && !!statistics;
              if (!statistics) statistics = C.fromRecords(snap.personId, snap.gate.members, records, filters);
            } else metrics.maintainedAggregates = true;
          }
          var response = { available: true, grouped: true, status: 'AVAILABLE', target: M.personTarget(snap.personId), requestedTarget: copy(target), eligibility: snap.gate,
            fence: snap.fence, displayName: M.resolveDisplayName(snap.state, M.personTarget(snap.personId), statistics.player && statistics.player.latestDisplayName), statistics: statistics,
            careerTrackingStartedAt: snap.metadata && snap.metadata.careerTrackingStartedAt || null, query: metrics, cacheKey: snap.cacheKey, populationKey: snap.populationKey, disjoint: disjoint };
          if (selection) { response.selection = copy(selection); response.populationScope = {'history-catalog':'RETAINED_PUBLISHED_PERSON_HISTORY','historical-session':'RETAINED_PUBLISHED_PERSON_SESSION','recent-sessions':'RETAINED_PUBLISHED_PERSON_RECENT','session-trends':'RETAINED_PUBLISHED_PERSON_TRENDS'}[selection.kind]; }
          return response;
        });
        if (result.raw) {
          // Delegate without altering any V1.5 raw aggregation or filter contract.
          var dashboard = await raw.careerDashboardStats(target.playerId, filters);
          var rawIssuedAt=Date.now(),rawResult={ available: true, grouped: false, status: 'AVAILABLE', target: copy(target), fence:Object.assign(result.rawFence,{issuedAt:rawIssuedAt,expiresAt:rawIssuedAt+5000}), statistics: Object.assign({ player: await raw.careerStats(target.playerId), filtered: await raw.careerStatsFiltered(target.playerId, filters) }, dashboard) };
          var rawCurrent=await validateFence(rawResult.fence);return rawCurrent.available?rawResult:rawCurrent;
        }
        if (!result.available) return result;
        var current = await validateFence(result.fence); if (!current.available) return current;
        if (!result.query.cacheHit) {
          var resultSize = bytes(result.statistics), size = bytes([result.cacheKey, result.populationKey, result.statistics]);
          if (resultSize <= LIMITS.resultBytes) {
            var old = cache.get(result.cacheKey); if (old) cacheBytes -= old.bytes;
            cache.set(result.cacheKey, { personId: result.target.personId, populationKey: result.populationKey, disjoint: result.disjoint, statistics: copy(result.statistics), bytes: size }); cacheBytes += size;
            while (cache.size > LIMITS.entries || cacheBytes > LIMITS.cacheBytes) { var first = cache.keys().next().value; cacheBytes -= cache.get(first).bytes; cache.delete(first); }
          }
        }
        delete result.cacheKey; delete result.populationKey; delete result.disjoint;
        if (Date.now() < result.fence.certificate.issuedAt || Date.now() >= result.fence.expiresAt) { clear(result.target.personId); return unavailable('EXPIRED_CERTIFICATE'); }
        return result;
      } catch (e) { var code = typeof e.code === 'string' ? e.code : 'AUTHORITY_UNAVAILABLE'; return unavailable(code.indexOf('IDENTITY') === 0 ? 'INVALID_IDENTITY_METADATA' : code); }
    }
    async function validateSessionFence(fence, sessionId) {
      if (!fence || fence.scope !== 'person-career-session' || !fence.selection || fence.selection.sessionId !== C.historicalSessionId(sessionId)) return unavailable('INVALID_QUERY_FENCE');
      return validateFence(fence);
    }
    async function validateRecentFence(fence,count,trends){
      count=C.recentCount(count);var kind=trends===true?'session-trends':'recent-sessions';
      if(!fence||fence.scope!==selectedScope({kind:kind})||!same(fence.selection,{kind:kind,count:count}))return unavailable('INVALID_QUERY_FENCE');
      return validateFence(fence);
    }
    return Object.freeze({ query: function (target, filters) { return query(target, filters, null); }, listSessions:function(target){return query(target,{}, {kind:'history-catalog'});},queryRecent:function(target,count){return query(target,{}, {kind:'recent-sessions',count:C.recentCount(count)});},queryTrends:function(target,count){return query(target,{}, {kind:'session-trends',count:C.recentCount(count)});}, querySession: function (target, sessionId, filters) { return query(target, filters, { kind: 'historical-session', sessionId: C.historicalSessionId(sessionId) }); }, validateRecentFence:validateRecentFence,validateFence: validateFence, validateSessionFence: validateSessionFence, close: function () { cache.clear(); cacheBytes = 0; db.close(); raw.close(); } });
  }
  return Object.freeze({ LIMITS: LIMITS, open: open });
});
