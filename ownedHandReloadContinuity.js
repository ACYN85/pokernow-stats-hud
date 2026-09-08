/* Strong, lifecycle-independent ownership continuity for a persisted unfinished hand. */
(function (root) {
  'use strict';

  var recovery = root.PokerInterruptedHandRecovery;
  if (!recovery && typeof require === 'function') recovery = require('./interruptedHandRecovery.js');

  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return String(value); }
  }

  function createState(activeHand) {
    var metadata = activeHand && activeHand.recoveryMetadata || {};
    return {
      persistedOwnedHandPresent: Boolean(activeHand && activeHand.handId),
      persistedHandId: activeHand && String(activeHand.handId) || null,
      persistedBoundaryVerified: Boolean(metadata.boundaryVerified),
      bootstrapFingerprintBuilt: false,
      bootstrapFingerprint: null,
      bootstrapFingerprintBuildRejectedReason: null,
      continuityComparisonAttempted: false,
      continuityComparisonResult: null,
      strongContinuityVerified: false,
      continuityEvidence: [],
      continuityRejectedReason: null,
      ownershipRestoreAttempted: false,
      ownershipRestoreSucceeded: false,
      activeHandIdAfterRestore: null,
      stagedHandIdAfterRestore: null,
      socketGameContextHandIdAfterRestore: null,
      normalizedTbRestored: false,
      postReloadCompatibleSnapshots: 0,
      postReloadActionsAccepted: 0,
      markedObservedAt: null,
      settlementObservedAt: null,
      finalizedAt: null
    };
  }

  function validParticipants(activeHand) {
    return activeHand && activeHand.participants
      ? Object.keys(activeHand.participants).map(function (name) {
        return activeHand.participants[name] && activeHand.participants[name].playerId;
      }).filter(Boolean).map(String)
      : [];
  }

  function attempt(state, input) {
    input = input || {};
    var activeHand = input.activeHand || null;
    var bootstrap = input.bootstrapFingerprint || null;
    state.bootstrapFingerprintBuilt = Boolean(bootstrap);
    state.bootstrapFingerprint = bootstrap ? clone(bootstrap) : null;
    state.bootstrapFingerprintBuildRejectedReason = bootstrap ? null : (input.bootstrapFingerprintBuildRejectedReason || 'bootstrap snapshot contains no compatible unfinished-hand fingerprint');
    if (!state.persistedOwnedHandPresent || !activeHand || !activeHand.handId) {
      state.continuityRejectedReason = 'no persisted unfinished hand exists';
      return { claimed: false, reason: state.continuityRejectedReason };
    }
    if (input.alreadyFinalized === true) {
      state.continuityRejectedReason = 'persisted hand is already finalized';
      return { claimed: false, reason: state.continuityRejectedReason };
    }
    if (!state.persistedBoundaryVerified) {
      state.continuityRejectedReason = 'persisted hand lacks verified live-boundary ownership';
      return { claimed: false, reason: state.continuityRejectedReason };
    }
    var participants = validParticipants(activeHand);
    if (participants.length < 2 || !Array.isArray(activeHand.events) || activeHand.events.length < 2) {
      state.continuityRejectedReason = 'persisted hand lacks valid participants or staged ownership';
      return { claimed: false, reason: state.continuityRejectedReason };
    }
    if (!bootstrap) {
      state.continuityRejectedReason = state.bootstrapFingerprintBuildRejectedReason;
      return { claimed: false, reason: state.continuityRejectedReason };
    }
    if (input.verifiedNewHandBoundary === true) {
      state.continuityRejectedReason = 'a distinct verified new-hand boundary supersedes persisted ownership';
      return { claimed: false, reason: state.continuityRejectedReason };
    }
    state.continuityComparisonAttempted = true;
    var bootstrapIdentity = clone(bootstrap);
    var settlementIntroducedOnBootstrap = Boolean(bootstrapIdentity.settlementPresent);
    bootstrapIdentity.settlementPresent = false;
    var comparison = recovery.compare(activeHand.recoveryMetadata && activeHand.recoveryMetadata.fingerprint, bootstrapIdentity);
    if (settlementIntroducedOnBootstrap && comparison.verified) comparison.evidence.push('settlement patch is definitive observation after strong same-hand identity matched');
    state.continuityComparisonResult = clone(comparison);
    state.strongContinuityVerified = Boolean(comparison.verified);
    state.continuityEvidence = comparison.evidence.slice();
    state.continuityRejectedReason = comparison.verified ? null : (comparison.missing.join('; ') || 'strong same-hand continuity was not verified');
    return comparison.verified
      ? { claimed: true, handId: String(activeHand.handId), reason: 'strong persisted owned-hand continuity', comparison: comparison }
      : { claimed: false, reason: state.continuityRejectedReason, comparison: comparison };
  }

  function restored(state, input) {
    input = input || {};
    state.ownershipRestoreAttempted = true;
    state.ownershipRestoreSucceeded = input.succeeded === true;
    state.activeHandIdAfterRestore = input.activeHandId || null;
    state.stagedHandIdAfterRestore = input.stagedHandId || null;
    state.socketGameContextHandIdAfterRestore = input.socketGameContextHandId || null;
    state.normalizedTbRestored = input.normalizedTbRestored === true;
  }

  function markCompatible(state, timestamp) {
    state.postReloadCompatibleSnapshots += 1;
    state.markedObservedAt = state.markedObservedAt || Number(timestamp || Date.now());
  }

  function markAction(state, timestamp) {
    state.postReloadActionsAccepted += 1;
    state.markedObservedAt = Number(timestamp || Date.now());
  }

  function markSettlement(state, timestamp) {
    state.settlementObservedAt = Number(timestamp || Date.now());
    state.markedObservedAt = state.markedObservedAt || state.settlementObservedAt;
  }

  function markFinalized(state, timestamp) {
    state.finalizedAt = Number(timestamp || Date.now());
  }

  function snapshot(state) {
    return clone(state);
  }

  var api = Object.freeze({
    createState: createState,
    attempt: attempt,
    restored: restored,
    markCompatible: markCompatible,
    markAction: markAction,
    markSettlement: markSettlement,
    markFinalized: markFinalized,
    snapshot: snapshot
  });
  root.PokerOwnedHandReloadContinuity = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
