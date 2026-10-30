/* Pure ownership checks for an unfinished hand restored during a verified paused reload. */
(function (root) {
  'use strict';

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function sorted(values) {
    return Array.from(new Set((values || []).filter(function (value) {
      return value !== null && value !== undefined && value !== '' && value !== '<D>';
    }).map(String))).sort();
  }

  // A mapped PokerNow hand fact, not source/account authorization. hI alone is
  // insufficient: require the observed Hold'em frame, counter, roster and blinds.
  function pokerNowHandIdentity(s) {
    function id(v) { return typeof v === 'string' && v.length > 0 && v.length <= 500 && v !== '<D>' && !/[\u0000-\u001f\u007f]/.test(v); }
    if (!s || !id(s.hI) || !Number.isSafeInteger(s.gN) || s.gN < 1 || !Array.isArray(s.gT) || s.gT.length !== 2 || s.gT[0] !== 1 || ![0,1,2,3,5].includes(s.gT[1])) return null;
    var roster = s.iHPI;
    if (!Array.isArray(roster) || roster.length < 2 || !roster.every(id) || new Set(roster).size !== roster.length || !id(s.sBPI) || !id(s.bBPI) || s.sBPI === s.bBPI || !roster.includes(s.sBPI) || !roster.includes(s.bBPI) || !s.players || typeof s.players !== 'object' || roster.some(function (p) { return !s.players[p] || typeof s.players[p] !== 'object'; })) return null;
    if (['handId','hand_id','handUuid','currentHandId'].some(function (k) { return s[k] !== undefined && s[k] !== s.hI; })) return null;
    return { handId:s.hI, gameNumber:s.gN, dealer: id(s.dealerID) && roster.includes(s.dealerID) ? s.dealerID : null };
  }

  function retainedFingerprint(hand) {
    var meta=hand && hand.recoveryMetadata, original=meta && meta.fingerprint;
    if (!original || !meta.boundaryVerified) return original;
    var shadow=hand.semanticHandLedgerSnapshot, saved=shadow && shadow.schemaVersion===1 && shadow.kind==='semantic-active-hand-shadow' && shadow.hand;
    if (!saved || String(saved.handId)!==String(hand.handId) || saved.historyComplete!==true || !Array.isArray(saved.observations) || !saved.observations.length) return original;
    var fact=pokerNowHandIdentity(saved.observations[0].currentState);
    if (!fact || saved.observations.some(function (o) { var s=o.currentState;return !s || s.hI!==fact.handId || s.gN!==fact.gameNumber; })) return original;
    if (original.explicitHandId && String(original.explicitHandId)!==fact.handId || original.dealerOrButton && fact.dealer && original.dealerOrButton!==fact.dealer || original.pokerNowGameNumber && original.pokerNowGameNumber!==fact.gameNumber) return original;
    return Object.assign({}, original, { explicitHandId:original.explicitHandId || fact.handId, dealerOrButton:original.dealerOrButton || fact.dealer, pokerNowGameNumber:fact.gameNumber });
  }

  function sameArray(left, right) {
    left = sorted(left);
    right = sorted(right);
    return left.length === right.length && left.every(function (value, index) { return value === right[index]; });
  }

  function createState(activeHand) {
    var metadata = activeHand && activeHand.recoveryMetadata || null;
    return {
      armed: false,
      armReason: null,
      persistedUnfinishedHandPresent: Boolean(activeHand && activeHand.handId),
      persistedHandId: activeHand && String(activeHand.handId) || null,
      persistedFingerprint: metadata && clone(metadata.fingerprint) || null,
      persistedPausedVerified: Boolean(metadata && metadata.pausedVerified),
      bootstrapPausedVerified: false,
      bootstrapFingerprint: null,
      sameHandVerified: false,
      sameHandEvidence: [],
      recoveryAttemptedAt: null,
      recoverySucceeded: false,
      recoveryRejectedReason: null,
      restoredActionCount: activeHand && Array.isArray(activeHand.events) ? activeHand.events.length : 0,
      duplicateActionsSkipped: 0,
      missingPreReloadEvidence: [],
      claimedByPath: null,
      restoredHandId: null,
      socketGameContextHandIdAfterRestore: null,
      ownershipRestoredBeforeSettlement: false,
      settlementObservedAt: null,
      finalizedAfterRecovery: false,
      staleRecoveryClears: 0
    };
  }

  function fingerprint(input) {
    input = input || {};
    var result = {
      explicitHandId: input.explicitHandId === null || input.explicitHandId === undefined ? null : String(input.explicitHandId),
      participantIds: sorted(input.participantIds),
      smallBlindPlayerId: input.smallBlindPlayerId === null || input.smallBlindPlayerId === undefined ? null : String(input.smallBlindPlayerId),
      bigBlindPlayerId: input.bigBlindPlayerId === null || input.bigBlindPlayerId === undefined ? null : String(input.bigBlindPlayerId),
      dealerOrButton: input.dealerOrButton === null || input.dealerOrButton === undefined ? null : String(input.dealerOrButton),
      boardCardCount: Number(input.boardCardCount || 0),
      settlementPresent: Boolean(input.settlementPresent)
    };
    if(Number.isSafeInteger(input.pokerNowGameNumber) && input.pokerNowGameNumber>0)result.pokerNowGameNumber=input.pokerNowGameNumber;
    return result;
  }

  function compare(persisted, current) {
    persisted = fingerprint(persisted);
    current = fingerprint(current);
    var evidence = [];
    var missing = [];
    var explicitMatch = Boolean(persisted.explicitHandId && current.explicitHandId && persisted.explicitHandId === current.explicitHandId);
    if (explicitMatch) evidence.push('exact PokerNow hand/deal identifier');
    else if (persisted.explicitHandId && current.explicitHandId) missing.push('PokerNow hand/deal identifier changed');
    var participantsMatch = persisted.participantIds.length >= 2 && sameArray(persisted.participantIds, current.participantIds);
    if (participantsMatch) evidence.push('exact persisted in-hand participant identities');
    else missing.push('in-hand participant identities do not match');
    var blindsMatch = Boolean(
      persisted.smallBlindPlayerId && persisted.bigBlindPlayerId &&
      persisted.smallBlindPlayerId === current.smallBlindPlayerId &&
      persisted.bigBlindPlayerId === current.bigBlindPlayerId
    );
    if (blindsMatch) evidence.push('small/big blind identities match');
    else missing.push('blind identities do not match');
    var dealerMatch = Boolean(persisted.dealerOrButton && persisted.dealerOrButton === current.dealerOrButton);
    if (dealerMatch) evidence.push('dealer/button identity matches');
    else missing.push('dealer/button identity does not match');
    var boardCompatible = current.boardCardCount >= persisted.boardCardCount;
    if (boardCompatible) evidence.push('board progression is non-regressive');
    else missing.push('board regressed relative to persisted unfinished hand');
    var explicitConflict=Boolean(persisted.explicitHandId && current.explicitHandId && !explicitMatch);
    var sourceCounterConflict=Boolean(persisted.pokerNowGameNumber && persisted.pokerNowGameNumber!==current.pokerNowGameNumber);
    var positionConflict=['smallBlindPlayerId','bigBlindPlayerId','dealerOrButton'].some(function(k){return persisted[k] && current[k] && persisted[k]!==current[k];});
    if(sourceCounterConflict)missing.push('PokerNow game counter is missing or changed');
    var verified = !explicitConflict && !sourceCounterConflict && !positionConflict && !current.settlementPresent && boardCompatible && (
      explicitMatch && participantsMatch ||
      participantsMatch && blindsMatch && dealerMatch
    );
    return { verified: verified, evidence: evidence, missing: missing, persisted: persisted, current: current };
  }

  function attempt(state, input) {
    input = input || {};
    state.recoveryAttemptedAt = Number(input.timestamp || Date.now());
    state.bootstrapFingerprint = fingerprint(input.bootstrapFingerprint);
    if (!state.persistedUnfinishedHandPresent || !state.persistedFingerprint) {
      state.recoveryRejectedReason = 'no persisted unfinished hand fingerprint';
      return { claimed: false, reason: state.recoveryRejectedReason };
    }
    if (input.lifecycleInactive !== true) {
      state.recoveryRejectedReason = 'bootstrap lifecycle is not authoritatively inactive';
      return { claimed: false, reason: state.recoveryRejectedReason };
    }
    var comparison = compare(state.persistedFingerprint, state.bootstrapFingerprint);
    state.bootstrapPausedVerified = true;
    state.sameHandVerified = comparison.verified;
    state.sameHandEvidence = comparison.evidence.slice();
    state.missingPreReloadEvidence = comparison.missing.slice();
    if (!comparison.verified) {
      state.recoveryRejectedReason = comparison.missing.join('; ') || 'same-hand identity was not verified';
      return { claimed: false, reason: state.recoveryRejectedReason, comparison: comparison };
    }
    var pausePersisted = state.persistedPausedVerified || input.persistedPausedVerified === true;
    state.armed = true;
    state.armReason = pausePersisted
      ? 'persisted verified pause plus matching bootstrap fingerprint'
      : 'authoritative paused bootstrap upgraded pause marker after storage race';
    state.persistedPausedVerified = true;
    state.recoverySucceeded = true;
    state.recoveryRejectedReason = null;
    state.claimedByPath = 'interrupted-unfinished-hand-recovery';
    state.restoredHandId = state.persistedHandId;
    return { claimed: true, handId: state.persistedHandId, reason: 'verified same unfinished hand after paused reload', comparison: comparison };
  }

  function remainsSameHand(state, currentFingerprint) {
    if (!state.recoverySucceeded || !state.persistedFingerprint) return false;
    return compare(state.persistedFingerprint, currentFingerprint).verified;
  }

  function finalize(state, handId) {
    if (!state.recoverySucceeded || String(handId) !== String(state.persistedHandId)) return false;
    state.armed = false;
    state.finalizedAfterRecovery = true;
    return true;
  }

  function clearStale(state, reason) {
    state.armed = false;
    state.staleRecoveryClears += 1;
    state.recoveryRejectedReason = reason || 'stale interrupted-hand recovery cleared';
  }

  function snapshot(state) {
    return clone(state);
  }

  var api = Object.freeze({
    createState: createState,
    fingerprint: fingerprint,
    pokerNowHandIdentity: pokerNowHandIdentity,
    retainedFingerprint: retainedFingerprint,
    compare: compare,
    attempt: attempt,
    remainsSameHand: remainsSameHand,
    finalize: finalize,
    clearStale: clearStale,
    snapshot: snapshot
  });
  root.PokerInterruptedHandRecovery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
