/* Production normalization and lifecycle wrapper for PokerNow tB actions. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && !isSupportedRuntimePage(root.PokerNowRuntimeScope, window.location)) return;

  function isSupportedRuntimePage(scope, loc) {
    if (scope && typeof scope.isPokerNowGamePage === 'function') return scope.isPokerNowGamePage(loc);
    var host = String(loc && loc.hostname || '').toLowerCase();
    return String(loc && loc.protocol || '').toLowerCase() === 'https:' &&
      (host === 'pokernow.com' || host === 'www.pokernow.com') &&
      /^\/games\/[^/]+\/?$/.test(String(loc && loc.pathname || ''));
  }

  var inference = root.PokerActionInference;
  if (!inference && typeof require !== 'undefined') inference = require('./actionInference.js');

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function findExactKeyValue(payload, wantedKey, expectedKind) {
    var found;
    function visit(value, depth) {
      if (found !== undefined || !value || typeof value !== 'object' || depth > 8) return;
      if (Object.prototype.hasOwnProperty.call(value, wantedKey)) {
        var candidate = value[wantedKey];
        var matches = expectedKind === 'array'
          ? Array.isArray(candidate)
          : expectedKind === 'object'
            ? candidate && typeof candidate === 'object' && !Array.isArray(candidate)
            : true;
        if (matches) { found = candidate; return; }
      }
      Object.keys(value).forEach(function (key) { visit(value[key], depth + 1); });
    }
    visit(payload, 0);
    return found;
  }

  function findScalar(payload, keys) {
    var found;
    function visit(value, depth) {
      if (found !== undefined || !value || typeof value !== 'object' || depth > 8) return;
      for (var index = 0; index < keys.length; index += 1) {
        var candidate = value[keys[index]];
        if (typeof candidate === 'string' || typeof candidate === 'number') { found = candidate; return; }
      }
      Object.keys(value).forEach(function (key) { visit(value[key], depth + 1); });
    }
    visit(payload, 0);
    return found;
  }

  function findPlayers(payload) {
    return findExactKeyValue(payload, 'players', 'object') || {};
  }

  function stackValue(player) {
    if (!player || typeof player !== 'object') return null;
    var keys = ['stack', 'chips', 'balance'];
    for (var index = 0; index < keys.length; index += 1) {
      if (typeof player[keys[index]] === 'number') return player[keys[index]];
    }
    return null;
  }

  function findPot(payload) {
    var value = findScalar(payload, ['pot', 'potSize', 'pot_size', 'currentPot', 'current_pot', 'totalPot', 'total_pot']);
    return typeof value === 'number' ? value : null;
  }

  function containsSettlement(payload) {
    var found = false;
    function visit(value, depth) {
      if (found || !value || typeof value !== 'object' || depth > 8) return;
      Object.keys(value).forEach(function (key) {
        if (found) return;
        if (/^(?:gameResult|game_result|settlement|results?|winners?)$/i.test(key)) {
          var candidate = value[key];
          if (candidate && typeof candidate === 'object' && Object.keys(candidate).length) { found = true; return; }
        }
        visit(value[key], depth + 1);
      });
    }
    visit(payload, 0);
    return found;
  }

  function normalizeTbMap(rawTb) {
    var normalized = {};
    Object.keys(rawTb || {}).forEach(function (playerId) {
      var value = rawTb[playerId];
      if (typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) normalized[String(playerId)] = Number(value);
      else normalized[String(playerId)] = value;
    });
    return normalized;
  }

  function normalizeMergedPatch(previousSnapshot, currentSnapshot, metadata) {
    var tB = findExactKeyValue(currentSnapshot, 'tB', 'object');
    if (!tB) return null;
    var rawPlayers = findPlayers(currentSnapshot);
    var players = {};
    Object.keys(rawPlayers).forEach(function (playerId) { players[String(playerId)] = { stack: stackValue(rawPlayers[playerId]) }; });
    var previousPot = findPot(previousSnapshot);
    var currentPot = findPot(currentSnapshot);
    return {
      recordId: metadata.recordId,
      timestamp: metadata.timestamp,
      players: players,
      tB: normalizeTbMap(tB),
      cPI: findScalar(currentSnapshot, ['cPI']),
      pITT: findScalar(currentSnapshot, ['pITT']),
      cRPI: clone(findExactKeyValue(currentSnapshot, 'cRPI', 'array') || []),
      bBPI: findScalar(currentSnapshot, ['bBPI']),
      sBPI: findScalar(currentSnapshot, ['sBPI']),
      settlement: containsSettlement(metadata.incomingPatch),
      potDelta: typeof previousPot === 'number' && typeof currentPot === 'number' ? currentPot - previousPot : null
    };
  }

  function createState(options) {
    options = options || {};
    return {
      handId: options.handId || null,
      schemaConfirmedByContract: options.schemaConfirmed === true,
      tracker: inference.createTbTracker({ street: options.street || 'preflop', maxPatchDistance: options.maxPatchDistance || 8, maxWindowMs: options.maxWindowMs || 5000, schemaConfirmed: options.schemaConfirmed === true }),
      lifecycle: [],
      candidates: {},
      invariant: { created: 0, pending: 0, confirmed: 0, rejected: 0, expired: 0, valid: true }
    };
  }

  function pendingKey(pending) {
    return [pending.recordId, pending.playerId, pending.action, pending.targetAmount].join('|');
  }

  function candidateId(state, pending, candidate) {
    var sourceRecordId = pending ? pending.recordId : (candidate.sourceRecordId || candidate.recordId);
    var playerId = pending ? pending.playerId : candidate.playerId;
    var action = pending ? pending.action : candidate.action;
    var amount = pending ? pending.targetAmount : (candidate.targetAmount || candidate.amount || 0);
    return [state.handId, sourceRecordId, playerId, action, amount].join('|');
  }

  function ensureCandidate(state, id, seed) {
    if (!state.candidates[id]) {
      state.candidates[id] = Object.assign({ candidateId: id, state: 'pending' }, seed || {});
      state.invariant.created += 1;
    }
    return state.candidates[id];
  }

  function transitionCandidate(state, id, nextState, details) {
    var entry = ensureCandidate(state, id, details);
    if (entry.state === 'confirmed' || entry.state === 'rejected' || entry.state === 'expired') return entry;
    entry.state = nextState;
    entry.terminalAt = details && details.timestamp;
    entry.reason = details && details.reason;
    return entry;
  }

  function updateInvariant(state) {
    var entries = Object.keys(state.candidates).map(function (key) { return state.candidates[key]; });
    state.invariant.pending = entries.filter(function (entry) { return entry.state === 'pending'; }).length;
    state.invariant.confirmed = entries.filter(function (entry) { return entry.state === 'confirmed'; }).length;
    state.invariant.rejected = entries.filter(function (entry) { return entry.state === 'rejected'; }).length;
    state.invariant.expired = entries.filter(function (entry) { return entry.state === 'expired'; }).length;
    state.invariant.valid = state.invariant.created === state.invariant.pending + state.invariant.confirmed + state.invariant.rejected + state.invariant.expired;
    return Object.assign({}, state.invariant);
  }

  function lifecycleRecord(kind, state, normalized, pending, candidate, metadata) {
    var patchDistance = pending ? state.tracker.patchIndex - pending.patchIndex : 0;
    var ageMs = pending ? normalized.timestamp - pending.timestamp : 0;
    return {
      kind: kind,
      candidateId: pending || candidate ? candidateId(state, pending, candidate || {}) : null,
      handId: state.handId,
      street: (pending && pending.street) || (candidate && candidate.street) || state.tracker.street,
      playerId: (pending && pending.playerId) || (candidate && candidate.playerId) || null,
      tBPrevious: pending ? pending.previousTbValue : null,
      tBCurrent: pending ? pending.currentTbValue : null,
      actor: normalized.cPI || normalized.pITT || null,
      patchRecordId: normalized.recordId,
      sourceRecordId: pending ? pending.recordId : (candidate && candidate.sourceRecordId),
      pendingAgePatches: patchDistance,
      pendingAgeMilliseconds: ageMs,
      laterStackEvidence: pending && normalized.players[pending.playerId] ? {
        stackAtCreation: pending.stackAtCreation,
        currentStack: normalized.players[pending.playerId].stack,
        decrease: typeof pending.stackAtCreation === 'number' && typeof normalized.players[pending.playerId].stack === 'number' ? pending.stackAtCreation - normalized.players[pending.playerId].stack : null,
        settlementPatch: normalized.settlement,
        potDelta: normalized.potDelta
      } : null,
      finalClassification: (pending && pending.action) || (candidate && candidate.action) || null,
      reason: candidate && candidate.reason,
      codeBranch: metadata && metadata.codeBranch,
      normalizedLiveFields: {
        tB: clone(normalized.tB),
        cPI: normalized.cPI,
        pITT: normalized.pITT,
        cRPI: clone(normalized.cRPI),
        sBPI: normalized.sBPI,
        bBPI: normalized.bBPI,
        stack: pending && normalized.players[pending.playerId] ? normalized.players[pending.playerId].stack : null,
        potDelta: normalized.potDelta,
        settlement: normalized.settlement
      },
      metadata: metadata || null
    };
  }

  function finalizePending(state, normalized, reason, codeBranch, terminalKind) {
    var lifecycle = [];
    terminalKind = terminalKind || 'rejected';
    (state.tracker.pending || []).forEach(function (pending) {
      var candidate = { playerId: pending.playerId, action: pending.action, amount: pending.amount, sourceRecordId: pending.recordId, reason: reason, street: pending.street };
      var metadata = { codeBranch: codeBranch };
      var record = lifecycleRecord(terminalKind, state, normalized, pending, candidate, metadata);
      transitionCandidate(state, record.candidateId, terminalKind, { timestamp: normalized.timestamp, reason: reason });
      lifecycle.push(record);
    });
    state.tracker.pending = [];
    updateInvariant(state);
    return lifecycle;
  }

  function finalizeHand(state, metadata) {
    metadata = metadata || {};
    var normalized = metadata.normalized || {
      recordId: metadata.recordId || 'hand-end',
      timestamp: metadata.timestamp || Date.now(),
      players: metadata.players || {},
      tB: metadata.tB || {},
      cPI: metadata.cPI || null,
      pITT: metadata.pITT || null,
      cRPI: metadata.cRPI || [],
      sBPI: metadata.sBPI || null,
      bBPI: metadata.bBPI || null,
      settlement: Boolean(metadata.settlement),
      potDelta: metadata.potDelta === undefined ? null : metadata.potDelta
    };
    var lifecycle = finalizePending(state, normalized, metadata.reason || 'hand ended before delayed action evidence arrived', metadata.codeBranch || 'finalizeHand', 'rejected');
    state.lifecycle = state.lifecycle.concat(lifecycle).slice(-500);
    return { lifecycle: lifecycle, pendingCount: 0, invariant: updateInvariant(state) };
  }

  function handleMergedPatch(state, previousSnapshot, currentSnapshot, metadata) {
    metadata = metadata || {};
    var normalized = normalizeMergedPatch(previousSnapshot, currentSnapshot, metadata);
    var preLifecycle = [];
    if (metadata.newHand && (!state.tracker || String(state.handId) !== String(metadata.handId))) {
      if (state.tracker && state.tracker.pending.length) {
        var handEndNormalized = normalized || { recordId: metadata.recordId, timestamp: metadata.timestamp, players: {}, tB: {}, cPI: null, pITT: null, cRPI: [], sBPI: null, bBPI: null, settlement: false, potDelta: null };
        preLifecycle = finalizePending(state, handEndNormalized, 'new hand boundary arrived before delayed action evidence', 'handleMergedPatch:new-hand-reset', 'rejected');
      }
      state.handId = metadata.handId;
      state.tracker = inference.createTbTracker({ street: metadata.street || 'preflop', maxPatchDistance: 8, maxWindowMs: 5000, schemaConfirmed: state.schemaConfirmedByContract });
    } else if (metadata.newHand && String(state.handId) === String(metadata.handId)) {
      state.lifecycle.push({ kind: 'hand-boundary-deduplicated', handId: state.handId, patchRecordId: metadata.recordId });
    }
    if (!normalized) {
      state.lifecycle = state.lifecycle.concat(preLifecycle).slice(-500);
      return { handled: false, normalized: null, inference: { events: [], candidates: [], diagnostics: [], gates: [] }, lifecycle: preLifecycle, pendingCount: state.tracker ? state.tracker.pending.length : 0, invariant: updateInvariant(state), invariantViolations: [] };
    }
    var pendingBefore = new Map((state.tracker.pending || []).map(function (pending) { return [pendingKey(pending), Object.assign({}, pending)]; }));
    var result = inference.processTbPatch(state.tracker, normalized);
    var lifecycle = [];

    result.candidates.forEach(function (candidate) {
      if (candidate.pending) {
        var created = state.tracker.pending.find(function (pending) { return pending.recordId === candidate.recordId && pending.playerId === candidate.playerId && pending.action === candidate.action; });
        if (!created) created = { recordId: candidate.recordId, playerId: candidate.playerId, action: candidate.action, targetAmount: candidate.targetAmount, previousTbValue: candidate.previousTbValue, currentTbValue: candidate.currentTbValue, timestamp: candidate.timestamp, patchIndex: state.tracker.patchIndex, street: candidate.street };
        var createdRecord = lifecycleRecord('created', state, normalized, created, candidate, Object.assign({}, metadata, { codeBranch: 'handleMergedPatch:candidate.pending' }));
        ensureCandidate(state, createdRecord.candidateId, { playerId: created.playerId, handId: state.handId, street: created.street, sourceRecordId: created.recordId, tBPrevious: created.previousTbValue, tBCurrent: created.currentTbValue });
        lifecycle.push(createdRecord);
      } else if (candidate.accepted) {
        var source = Array.from(pendingBefore.values()).find(function (pending) { return pending.recordId === candidate.sourceRecordId && pending.playerId === candidate.playerId; });
        if (!source && candidate.pendingSnapshot) source = candidate.pendingSnapshot;
        var confirmedRecord = lifecycleRecord('confirmed', state, normalized, source, candidate, Object.assign({}, metadata, { codeBranch: 'handleMergedPatch:candidate.accepted' }));
        ensureCandidate(state, confirmedRecord.candidateId, { playerId: candidate.playerId, handId: state.handId, street: candidate.street, sourceRecordId: candidate.sourceRecordId || candidate.recordId });
        transitionCandidate(state, confirmedRecord.candidateId, 'confirmed', { timestamp: normalized.timestamp, reason: candidate.reason });
        lifecycle.push(confirmedRecord);
      } else if (!candidate.forcedBlind) {
        var expired = /expired/i.test(candidate.reason || '');
        var rejectedSource = Array.from(pendingBefore.values()).find(function (pending) { return pending.playerId === candidate.playerId && pending.action === candidate.action; });
        var terminalKind = expired ? 'expired' : 'rejected';
        var rejectedRecord = lifecycleRecord(terminalKind, state, normalized, rejectedSource, candidate, Object.assign({}, metadata, { codeBranch: expired ? 'handleMergedPatch:candidate.expired' : 'handleMergedPatch:candidate.rejected' }));
        ensureCandidate(state, rejectedRecord.candidateId, { playerId: candidate.playerId, handId: state.handId, street: candidate.street, sourceRecordId: candidate.sourceRecordId || candidate.recordId });
        transitionCandidate(state, rejectedRecord.candidateId, terminalKind, { timestamp: normalized.timestamp, reason: candidate.reason });
        lifecycle.push(rejectedRecord);
      }
    });

    state.tracker.pending.forEach(function (pending) {
      var key = pendingKey(pending);
      if (pendingBefore.has(key) && !lifecycle.some(function (item) { return item.sourceRecordId === pending.recordId && item.playerId === pending.playerId && item.kind !== 'retained'; })) {
        var retainedRecord = lifecycleRecord('retained', state, normalized, pending, null, Object.assign({}, metadata, { codeBranch: 'handleMergedPatch:pending.retained' }));
        ensureCandidate(state, retainedRecord.candidateId, { playerId: pending.playerId, handId: state.handId, street: pending.street, sourceRecordId: pending.recordId });
        lifecycle.push(retainedRecord);
      }
    });
    if (normalized.settlement && state.tracker.pending.length) {
      lifecycle = lifecycle.concat(finalizePending(state, normalized, 'settlement began before delayed action evidence arrived', 'handleMergedPatch:settlement-finalize', 'rejected'));
    }
    var activePendingIds = new Set(state.tracker.pending.map(function (pending) { return candidateId(state, pending, {}); }));
    var invariantViolations = [];
    Object.keys(state.candidates).forEach(function (id) {
      var entry = state.candidates[id];
      if (entry.state === 'pending' && !activePendingIds.has(id)) {
        var violation = Object.assign({}, entry, {
          kind: 'invariant-violation',
          candidateId: id,
          handId: state.handId,
          patchRecordId: normalized.recordId,
          codeBranch: 'handleMergedPatch:post-process-ledger-audit',
          normalizedLiveFields: { tB: clone(normalized.tB), cPI: normalized.cPI, pITT: normalized.pITT, cRPI: clone(normalized.cRPI), sBPI: normalized.sBPI, bBPI: normalized.bBPI, stack: normalized.players[entry.playerId] && normalized.players[entry.playerId].stack, potDelta: normalized.potDelta, settlement: normalized.settlement }
        });
        invariantViolations.push(violation);
      }
    });
    var invariant = updateInvariant(state);
    if (!invariant.valid) invariantViolations.push({ kind: 'invariant-violation', codeBranch: 'handleMergedPatch:count-audit', handId: state.handId, patchRecordId: normalized.recordId, invariant: invariant });
    state.lifecycle = state.lifecycle.concat(preLifecycle, lifecycle).slice(-500);
    return { handled: true, normalized: normalized, inference: result, lifecycle: preLifecycle.concat(lifecycle), pendingCount: state.tracker.pending.length, invariant: invariant, invariantViolations: invariantViolations };
  }

  var api = { createState: createState, normalizeMergedPatch: normalizeMergedPatch, handleMergedPatch: handleMergedPatch, finalizeHand: finalizeHand, updateInvariant: updateInvariant };
  root.PokerLiveActionPipeline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
