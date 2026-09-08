/*
 * Bounded, debug-only WTSD/W$SD production-path diagnostics.
 *
 * This file is intentionally loaded in both manifest worlds. The MAIN-world
 * instance owns the page-console API and debug flag bridge. The isolated-world
 * instance accepts sanitized records from production modules. sessionStorage
 * is used only as the bounded bridge between those two worlds.
 */
(function (root) {
  'use strict';

  var SCHEMA_VERSION = 1;
  var STORAGE_KEY = '__pnhud_showdown_diagnostics_v1__';
  var ENABLED_KEY = '__pnhud_showdown_diagnostics_enabled_v1__';
  var CLEAR_KEY = '__pnhud_showdown_diagnostics_clear_v1__';
  var LIMITS = Object.freeze({ hands: 20, finalizationAttempts: 50, attachmentAttempts: 50 });
  var forbiddenKeyPattern = /(?:hole.?cards?|cards?|chat|raw(?:Frame|Message|Payload|WebSocket)?|payload|socket(?:Id|Url)?|cookie|token|authorization|dom|node|element|html|selector|visibleText)/i;

  function forbiddenKey(key) {
    if (/^discarded$/i.test(String(key || ''))) return false;
    if (/^(?:currentState|previousState|socketState|frame|frames|message|messages|patch)$/i.test(String(key || ''))) return true;
    return forbiddenKeyPattern.test(String(key || ''));
  }

  function storage() {
    try {
      return root && root.sessionStorage && typeof root.sessionStorage.getItem === 'function' ? root.sessionStorage : null;
    } catch (_error) {
      return null;
    }
  }

  function readItem(key) {
    var target = storage();
    if (!target) return null;
    try { return target.getItem(key); } catch (_error) { return null; }
  }

  function writeItem(key, value) {
    var target = storage();
    if (!target) return false;
    try { target.setItem(key, String(value)); return true; } catch (_error) { return false; }
  }

  function safeParse(value) {
    if (!value) return null;
    try { return JSON.parse(value); } catch (_error) { return null; }
  }

  function nowIso() {
    try { return new Date().toISOString(); } catch (_error) { return null; }
  }

  function primitive(value) {
    if (value === null || value === undefined) return value === undefined ? null : value;
    if (typeof value === 'string') return value.slice(0, 300);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    return null;
  }

  function sanitize(value, key, depth, seen) {
    depth = Number(depth || 0);
    if (key && forbiddenKey(key)) return undefined;
    if (value === null || value === undefined || ['string', 'boolean', 'number'].includes(typeof value)) return primitive(value);
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || depth >= 7) return undefined;
    seen = seen || new Set();
    if (seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) {
      var array = value.slice(0, 100).map(function (entry) { return sanitize(entry, '', depth + 1, seen); }).filter(function (entry) { return entry !== undefined; });
      seen.delete(value);
      return array;
    }
    var clean = {};
    Object.keys(value).slice(0, 100).forEach(function (property) {
      if (forbiddenKey(property)) return;
      var next = sanitize(value[property], property, depth + 1, seen);
      if (next !== undefined) clean[property] = next;
    });
    seen.delete(value);
    return clean;
  }

  function uniqueStrings(values) {
    var result = [];
    (values || []).forEach(function (value) {
      if (value === null || value === undefined || String(value) === '') return;
      value = String(value);
      if (!result.includes(value)) result.push(value);
    });
    return result.slice(0, 100);
  }

  function countFields(value) {
    value = value || {};
    return {
      sawFlopForWTSD: Number(value.sawFlopForWTSD || 0),
      wentToShowdown: Number(value.wentToShowdown || 0),
      showdownsForWSD: Number(value.showdownsForWSD || 0),
      wonMoneyAtShowdown: Number(value.wonMoneyAtShowdown || 0)
    };
  }

  function blankCapture(id) {
    return {
      captureId: id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lifecycleHandId: null,
      authoritativeHandId: null,
      identityAliases: [],
      lifecycleState: null,
      gameBreakRejoin: {
        gameBreakObserved: false,
        playerReturnObserved: false,
        firstPostBreakHand: false,
        breakEpoch: null,
        markers: []
      },
      stablePlayerIds: [],
      preflopActions: [],
      flopEntrants: [],
      liveContenders: [],
      showdownMembershipEvidence: { detected: null, participantIds: [], playerStates: [] },
      settlement: { observed: false, retained: false, terminalPhaseObserved: false, status: null, awardCount: 0, awardPlayerIds: [], refundPlayerIds: [] },
      finalizationReadiness: null,
      finalizationAttemptIds: [],
      finalization: { finalized: false, duplicate: false, reason: null },
      reducerInvocationCount: 0,
      reducerOutputByPlayer: {},
      contributionIds: [],
      attachmentAttemptIds: [],
      duplicateRejectionReasons: [],
      persistedFinalizedEventFieldsByPlayer: {},
      aggregatedTotalsBeforeByPlayer: {},
      aggregatedTotalsAfterByPlayer: {},
      renderedTotalsByPlayer: {},
      unsupportedReasons: [],
      classification: 'unknown'
    };
  }

  function emptyState(clearToken) {
    return {
      hands: [],
      finalizationAttempts: [],
      attachmentAttempts: [],
      nextHandSequence: 0,
      nextFinalizationSequence: 0,
      nextAttachmentSequence: 0,
      clearToken: clearToken || readItem(CLEAR_KEY) || ''
    };
  }

  function publicEnvelope(state) {
    var hands = state.hands.map(function (capture) {
      var copy = sanitize(capture, '', 0, new Set());
      copy.classification = classify(copy);
      return copy;
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      enabled: enabled(),
      generatedAt: nowIso(),
      limits: { hands: LIMITS.hands, finalizationAttempts: LIMITS.finalizationAttempts, attachmentAttempts: LIMITS.attachmentAttempts },
      hands: hands,
      finalizationAttempts: sanitize(state.finalizationAttempts, '', 0, new Set()) || [],
      attachmentAttempts: sanitize(state.attachmentAttempts, '', 0, new Set()) || []
    };
  }

  function hydratedState() {
    var envelope = safeParse(readItem(STORAGE_KEY));
    var state = emptyState();
    if (!envelope || envelope.schemaVersion !== SCHEMA_VERSION) return state;
    state.hands = Array.isArray(envelope.hands) ? envelope.hands.slice(-LIMITS.hands) : [];
    state.finalizationAttempts = Array.isArray(envelope.finalizationAttempts) ? envelope.finalizationAttempts.slice(-LIMITS.finalizationAttempts) : [];
    state.attachmentAttempts = Array.isArray(envelope.attachmentAttempts) ? envelope.attachmentAttempts.slice(-LIMITS.attachmentAttempts) : [];
    state.nextHandSequence = state.hands.length;
    state.nextFinalizationSequence = state.finalizationAttempts.length;
    state.nextAttachmentSequence = state.attachmentAttempts.length;
    return state;
  }

  var localFlag = root && root.__PNHUD_SHOWDOWN_DEBUG__ === true;
  if (localFlag) writeItem(ENABLED_KEY, 'true');

  function enabled() {
    return localFlag === true || readItem(ENABLED_KEY) === 'true';
  }

  function installFlagBridge() {
    if (!root || typeof Object.defineProperty !== 'function') return;
    var descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(root, '__PNHUD_SHOWDOWN_DEBUG__'); } catch (_error) { return; }
    if (descriptor && descriptor.configurable === false) return;
    try {
      Object.defineProperty(root, '__PNHUD_SHOWDOWN_DEBUG__', {
        configurable: true,
        enumerable: false,
        get: function () { return localFlag === true || readItem(ENABLED_KEY) === 'true'; },
        set: function (value) {
          localFlag = value === true;
          writeItem(ENABLED_KEY, localFlag ? 'true' : 'false');
        }
      });
    } catch (_error) {}
  }

  installFlagBridge();
  var state = hydratedState();
  var pendingMarkers = [];

  function synchronizeClear() {
    var token = readItem(CLEAR_KEY) || '';
    if (token === state.clearToken) return;
    state = emptyState(token);
    pendingMarkers = [];
  }

  function persist() {
    writeItem(STORAGE_KEY, JSON.stringify(publicEnvelope(state)));
  }

  function identities(details) {
    details = details || {};
    var identity = details.handIdentity || {};
    return uniqueStrings([
      details.lifecycleHandId,
      details.authoritativeHandId,
      details.targetHandId,
      details.handId,
      identity.lifecycleHandId,
      identity.handId
    ].concat(details.identityAliases || []).concat(details.candidateHandIds || []).concat((details.events || []).map(function (event) { return event && event.handId; })));
  }

  function findCapture(aliases) {
    aliases = uniqueStrings(aliases);
    for (var index = state.hands.length - 1; index >= 0; index -= 1) {
      var capture = state.hands[index];
      if (aliases.some(function (alias) { return capture.identityAliases.includes(alias); })) return capture;
    }
    return null;
  }

  function ensureCapture(details) {
    var aliases = identities(details);
    var capture = findCapture(aliases);
    if (!capture) {
      capture = blankCapture('showdown-hand-' + (++state.nextHandSequence));
      state.hands.push(capture);
      if (state.hands.length > LIMITS.hands) state.hands.shift();
      if (pendingMarkers.length) {
        capture.gameBreakRejoin.markers = pendingMarkers.slice(-10);
        capture.gameBreakRejoin.gameBreakObserved = pendingMarkers.some(function (marker) { return marker.stage === 'game-break-entry'; });
        capture.gameBreakRejoin.playerReturnObserved = pendingMarkers.some(function (marker) { return marker.stage === 'player-return'; });
      }
    }
    capture.identityAliases = uniqueStrings(capture.identityAliases.concat(aliases));
    var identity = details.handIdentity || {};
    if (details.lifecycleHandId !== null && details.lifecycleHandId !== undefined) capture.lifecycleHandId = String(details.lifecycleHandId);
    else if (identity.lifecycleHandId !== null && identity.lifecycleHandId !== undefined) capture.lifecycleHandId = String(identity.lifecycleHandId);
    if (details.authoritativeHandId !== null && details.authoritativeHandId !== undefined) capture.authoritativeHandId = String(details.authoritativeHandId);
    else if (identity.handId !== null && identity.handId !== undefined) capture.authoritativeHandId = String(identity.handId);
    capture.updatedAt = nowIso();
    return capture;
  }

  function addUnsupported(capture, reason) {
    if (!reason) return;
    reason = String(reason).slice(0, 300);
    if (!capture.unsupportedReasons.includes(reason)) capture.unsupportedReasons.push(reason);
    capture.unsupportedReasons = capture.unsupportedReasons.slice(-30);
  }

  function recordFinalizationAttempt(capture, details) {
    var attempt = {
      attemptId: 'showdown-finalization-' + (++state.nextFinalizationSequence),
      timestamp: nowIso(),
      lifecycleHandId: capture.lifecycleHandId,
      authoritativeHandId: capture.authoritativeHandId,
      reason: details.reason || null,
      source: details.source || null,
      ready: details.ready === true ? true : details.ready === false ? false : null,
      committed: details.committed === true,
      duplicate: details.duplicate === true,
      discarded: details.discarded === true,
      resultReason: details.resultReason || details.exactReason || null
    };
    state.finalizationAttempts.push(attempt);
    if (state.finalizationAttempts.length > LIMITS.finalizationAttempts) state.finalizationAttempts.shift();
    capture.finalizationAttemptIds.push(attempt.attemptId);
    capture.finalizationAttemptIds = capture.finalizationAttemptIds.slice(-LIMITS.finalizationAttempts);
    if (attempt.duplicate) capture.duplicateRejectionReasons.push(attempt.resultReason || attempt.reason || 'duplicate finalization');
  }

  function attachmentKey(details) {
    return [details.contributionId || '', details.playerId || '', details.eventId || '', details.targetHandId || ''].join('|');
  }

  function recordAttachment(capture, stage, details) {
    var key = attachmentKey(details);
    var attempt = state.attachmentAttempts.find(function (entry) { return entry.key === key && key !== '|||'; });
    if (!attempt) {
      attempt = {
        attachmentAttemptId: 'showdown-attachment-' + (++state.nextAttachmentSequence),
        key: key,
        timestamp: nowIso(),
        stages: [],
        lifecycleHandId: capture.lifecycleHandId,
        authoritativeHandId: capture.authoritativeHandId,
        contributionId: details.contributionId || null,
        eventId: details.eventId || null,
        targetHandId: details.targetHandId || null,
        playerId: details.playerId === null || details.playerId === undefined ? null : String(details.playerId),
        attached: null,
        skipped: null,
        duplicate: false,
        reason: null,
        fields: null
      };
      state.attachmentAttempts.push(attempt);
      if (state.attachmentAttempts.length > LIMITS.attachmentAttempts) state.attachmentAttempts.shift();
      capture.attachmentAttemptIds.push(attempt.attachmentAttemptId);
      capture.attachmentAttemptIds = capture.attachmentAttemptIds.slice(-LIMITS.attachmentAttempts);
    }
    if (!attempt.stages.includes(stage)) attempt.stages.push(stage);
    if (details.attached === true || details.accepted === true) attempt.attached = true;
    if (details.attached === false || details.accepted === false) attempt.attached = false;
    if (details.skipped !== undefined) attempt.skipped = Boolean(details.skipped);
    attempt.duplicate = attempt.duplicate || details.duplicate === true || details.rejectedAsDuplicate === true;
    attempt.reason = details.reason || attempt.reason;
    attempt.fields = countFields(details.after || details.counts || details.fields || {});
    if (attempt.contributionId && !capture.contributionIds.includes(attempt.contributionId)) capture.contributionIds.push(attempt.contributionId);
    if (attempt.duplicate && attempt.reason) capture.duplicateRejectionReasons.push(String(attempt.reason));
  }

  function updateCapture(stage, details) {
    if (stage === 'game-break-entry' || stage === 'player-return') {
      pendingMarkers.push(Object.assign({ stage: stage, timestamp: nowIso() }, sanitize(details, '', 0, new Set()) || {}));
      pendingMarkers = pendingMarkers.slice(-10);
      if (!identities(details).length) return null;
    }
    var capture = ensureCapture(details);
    if (details.lifecycleState || details.newLifecycleState) capture.lifecycleState = details.lifecycleState || details.newLifecycleState;
    if (stage === 'first-post-break-hand') {
      capture.gameBreakRejoin.firstPostBreakHand = true;
      capture.gameBreakRejoin.breakEpoch = details.breakEpoch === undefined ? null : details.breakEpoch;
      capture.gameBreakRejoin.playerReturnObserved = true;
      capture.stablePlayerIds = uniqueStrings(capture.stablePlayerIds.concat(details.stablePlayerIds || []));
    } else if (stage === 'semantic-finalization') {
      capture.finalization.finalized = details.finalized === true;
      capture.finalization.duplicate = details.duplicate === true;
      capture.finalization.reason = details.reason || null;
      capture.stablePlayerIds = uniqueStrings(capture.stablePlayerIds.concat(details.playerIds || []));
      capture.preflopActions = (details.actions || []).filter(function (action) { return action.street === 'preflop'; }).slice(0, 80);
    } else if (stage === 'showdown-evidence-completeness') {
      capture.flopEntrants = uniqueStrings(details.flopEntrantPlayerIds || []);
      capture.showdownMembershipEvidence = {
        detected: details.showdownDetected === true ? true : details.showdownDetected === false ? false : null,
        participantIds: uniqueStrings(details.showdownParticipantIds || []),
        playerStates: sanitize(details.playerStates || [], '', 0, new Set()) || []
      };
      capture.liveContenders = uniqueStrings((details.playerStates || []).filter(function (player) { return player && player.folded !== true; }).map(function (player) { return player.playerId; }));
    } else if (stage === 'settlement-completeness') {
      capture.settlement.observed = Boolean(details.status || Number(details.awardCount || 0) > 0);
      capture.settlement.status = details.status || null;
      capture.settlement.awardCount = Number(details.awardCount || 0);
      capture.settlement.awardPlayerIds = uniqueStrings(details.awardPlayerIds || []);
      (details.ambiguityCodes || []).forEach(function (reason) { addUnsupported(capture, reason); });
    } else if (stage === 'settlement-evidence') {
      capture.settlement.observed = true;
      capture.settlement.status = details.settlementStatus || capture.settlement.status;
      capture.settlement.awardCount = (details.awards || []).length;
      capture.settlement.awardPlayerIds = uniqueStrings((details.awards || []).map(function (award) { return award.playerId; }));
      capture.settlement.refundPlayerIds = uniqueStrings((details.refunds || []).map(function (refund) { return refund.playerId; }));
    } else if (stage === 'finalization-readiness') {
      capture.finalizationReadiness = sanitize(details, '', 0, new Set());
      capture.settlement.observed = details.settlementObserved === true;
      capture.settlement.retained = details.settlementRetained === true;
      capture.settlement.terminalPhaseObserved = details.terminalPhaseKnown === true;
      if (details.ready !== true) addUnsupported(capture, details.reason);
    } else if (stage === 'finalization-attempt') {
      recordFinalizationAttempt(capture, details);
    } else if (stage === 'reducer-invocation' && details.phase === 'after') {
      capture.reducerInvocationCount += 1;
      Object.keys(details.outputs || {}).forEach(function (playerId) {
        capture.reducerOutputByPlayer[String(playerId)] = sanitize(details.outputs[playerId], '', 0, new Set());
        addUnsupported(capture, details.outputs[playerId] && details.outputs[playerId].unsupportedReason);
      });
      addUnsupported(capture, details.reason && details.reduced !== true ? details.reason : null);
    } else if (stage === 'wtsd-decision') {
      var playerId = String(details.playerId);
      capture.reducerOutputByPlayer[playerId] = sanitize(details, '', 0, new Set());
      addUnsupported(capture, details.unsupportedReason || details.wonMoneyAtShowdownCandidateReason);
    } else if (stage === 'committed-contribution') {
      if (details.contributionId && !capture.contributionIds.includes(details.contributionId)) capture.contributionIds.push(String(details.contributionId));
      if (details.duplicate) capture.duplicateRejectionReasons.push(details.reason || 'reducer duplicate');
    } else if (stage === 'stats-ingestion' || stage === 'authoritative-stats-attachment' || stage === 'shadow-attachment') {
      recordAttachment(capture, stage, details);
      addUnsupported(capture, details.skipped ? details.reason : null);
    } else if (stage === 'persistence-save' || stage === 'persistence-restore') {
      (details.events || []).forEach(function (event) {
        var eventAliases = uniqueStrings([event.handId].concat(event.identityAliases || []));
        var target = findCapture(eventAliases) || capture;
        var playerId = String(event.playerId || 'unknown');
        target.persistedFinalizedEventFieldsByPlayer[playerId] = {
          eventId: event.eventId || null,
          handId: event.handId || null,
          contributionId: event.contributionId || null,
          fields: countFields(event.fields || event)
        };
      });
      if (details.error) addUnsupported(capture, details.error);
    } else if (stage === 'stats-aggregation') {
      var aggregatePlayerId = String(details.playerId || 'unknown');
      if (details.countersBefore) capture.aggregatedTotalsBeforeByPlayer[aggregatePlayerId] = countFields(details.countersBefore);
      capture.aggregatedTotalsAfterByPlayer[aggregatePlayerId] = countFields(details.countersAfter || {});
      if (details.rejectedAsDuplicate) capture.duplicateRejectionReasons.push('duplicate statistics event rejected during aggregation');
    } else if (stage === 'rendered-totals') {
      capture.renderedTotalsByPlayer[String(details.playerId || 'unknown')] = {
        surface: details.surface || null,
        fields: countFields(details.fields || details),
        formattedWTSD: details.formattedWTSD || null,
        formattedWSD: details.formattedWSD || null
      };
    } else if (stage === 'duplicate-rejection' || stage === 'duplicate-or-upgrade-rejection') {
      capture.duplicateRejectionReasons.push(String(details.reason || 'duplicate rejected'));
    } else if (stage === 'provisional-contribution') {
      addUnsupported(capture, details.reason);
    }
    capture.duplicateRejectionReasons = uniqueStrings(capture.duplicateRejectionReasons).slice(-30);
    capture.updatedAt = nowIso();
    return capture;
  }

  function anyObjectValue(object, predicate) {
    return Object.keys(object || {}).some(function (key) { return predicate(object[key], key); });
  }

  function classify(capture) {
    var finalizationAttempts = state.finalizationAttempts.filter(function (attempt) { return capture.finalizationAttemptIds.includes(attempt.attemptId); });
    if (finalizationAttempts.some(function (attempt) { return attempt.committed && attempt.ready === false; })) return 'finalized_too_early';
    if ((capture.unsupportedReasons || []).some(function (reason) { return /history|malformed action|partial sequence/i.test(String(reason)); })) return 'unsupported_history';
    var generated = capture.reducerInvocationCount > 0 && Object.keys(capture.reducerOutputByPlayer || {}).length > 0;
    var authoritativeAttachments = state.attachmentAttempts.filter(function (attempt) {
      return capture.attachmentAttemptIds.includes(attempt.attachmentAttemptId) && attempt.stages.includes('stats-ingestion') && attempt.attached === true;
    });
    if (generated && !authoritativeAttachments.length && !capture.finalization.duplicate) return 'contribution_generated_not_attached';
    var persisted = Object.keys(capture.persistedFinalizedEventFieldsByPlayer || {}).length > 0;
    if (authoritativeAttachments.length && !persisted) return 'contribution_attached_not_persisted';
    var aggregated = Object.keys(capture.aggregatedTotalsAfterByPlayer || {}).length > 0;
    if (persisted && !aggregated) return 'persisted_not_aggregated';
    var outputDenominatorOnly = anyObjectValue(capture.reducerOutputByPlayer, function (player) {
      return Number(player && player.sawFlopForWTSD || 0) === 1 && Number(player && player.wentToShowdown || 0) === 0;
    });
    if (outputDenominatorOnly) return 'wtsd_denominator_only';
    var unsupportedWsd = anyObjectValue(capture.reducerOutputByPlayer, function (player) {
      return Number(player && player.wentToShowdown || 0) === 1 && (player.wonMoneyAtShowdownCandidateSupported === false || player.wonMoneyAtShowdownCandidate === null);
    });
    if (unsupportedWsd) return 'showdown_supported_wsd_unsupported';
    var rendered = Object.keys(capture.renderedTotalsByPlayer || {}).length > 0;
    if (generated && authoritativeAttachments.length && persisted && aggregated && rendered) return 'counted_correctly';
    if (capture.duplicateRejectionReasons && capture.duplicateRejectionReasons.length) return 'duplicate_rejected';
    if (!capture.finalization.finalized && !finalizationAttempts.some(function (attempt) { return attempt.committed; })) return 'no_finalization';
    return 'unknown';
  }

  function record(stage, details) {
    if (!enabled()) return false;
    synchronizeClear();
    stage = String(stage || 'unknown').slice(0, 80);
    var clean = sanitize(details || {}, '', 0, new Set()) || {};
    updateCapture(stage, clean);
    persist();
    return true;
  }

  function exportDiagnostics() {
    var stored = safeParse(readItem(STORAGE_KEY));
    if (!stored || stored.schemaVersion !== SCHEMA_VERSION) return publicEnvelope(emptyState(readItem(CLEAR_KEY) || ''));
    return sanitize(stored, '', 0, new Set());
  }

  function latestDiagnostic() {
    var exported = exportDiagnostics();
    return exported.hands && exported.hands.length ? exported.hands[exported.hands.length - 1] : null;
  }

  function clearDiagnostics() {
    var token = String(Date.now()) + ':' + String(Math.random()).slice(2, 10);
    writeItem(CLEAR_KEY, token);
    state = emptyState(token);
    pendingMarkers = [];
    persist();
    return true;
  }

  var pageApi = Object.freeze({
    exportShowdownDiagnostics: exportDiagnostics,
    latestShowdownDiagnostic: latestDiagnostic,
    clearShowdownDiagnostics: clearDiagnostics
  });
  root.PokerNowHUDDebug = pageApi;

  var internalApi = Object.freeze({
    enabled: enabled,
    record: record,
    exportShowdownDiagnostics: exportDiagnostics,
    latestShowdownDiagnostic: latestDiagnostic,
    clearShowdownDiagnostics: clearDiagnostics,
    limits: LIMITS
  });
  root.PokerShowdownDiagnosticExporter = internalApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = internalApi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
