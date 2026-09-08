/* Pure, centrally owned HUD runtime-status derivation. */
(function (root) {
  'use strict';

  var BREAK_STATUS = /waiting|stopped|break|need.*player|not.*enough/i;
  var PAUSED_STATUS = /paused/i;
  var ACTIVE_STATUS = /inprogress|in_progress|running|active|playing/i;
  var BREAK_CLASSIFICATION = /waiting|stopped|broken/i;
  var PAUSED_CLASSIFICATION = /paused/i;
  var ACTIVE_CLASSIFICATION = /active|resumed/i;

  function createState(options) {
    options = options || {};
    return {
      displayedStatus: 'initializing',
      derivedStatus: 'initializing',
      previousStatus: null,
      lastStatusTransitionAt: Number(options.timestamp || Date.now()),
      lastStatusTransitionReason: 'initialization-replay',
      tableStatus: null,
      tableClassification: null,
      lifecycleClassification: null,
      lifecycleConfidence: null,
      lifecycleEvidence: null,
      localLifecycleCommand: null,
      authoritativePauseState: null,
      authoritativePauseEvidence: null,
      verifiedInactiveReason: null,
      verifiedActiveReason: null,
      waitingToStart: false,
      gamePaused: false,
      gameStopped: false,
      gameBroken: false,
      eligiblePlayerCount: 0,
      socketHookInstalled: false,
      socketHookStatusObserved: false,
      transportConnected: false,
      framesCaptured: 0,
      packetsDecoded: 0,
      gameStatePatchesMerged: 0,
      freshLiveActivityObserved: false,
      lastFreshGameStateAt: null,
      freshMergedStateAt: null,
      activeHandPresent: false,
      initializedWhileWaiting: false,
      resumedAfterWaiting: false,
      transportDisconnected: false,
      duplicateStatusListenerPreventions: 0,
      transitionCount: 0
    };
  }

  function normalizeText(value) {
    return String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  }

  function derive(state, input) {
    var tableStatus = normalizeText(input.tableStatus !== undefined ? input.tableStatus : state.tableStatus);
    var classification = normalizeText(input.tableClassification !== undefined ? input.tableClassification : state.tableClassification);
    var eligiblePlayerCount = Number(input.eligiblePlayerCount !== undefined ? input.eligiblePlayerCount : state.eligiblePlayerCount || 0);
    var hookInstalled = input.socketHookInstalled !== undefined ? Boolean(input.socketHookInstalled) : Boolean(state.socketHookInstalled);
    var hookStatusObserved = input.socketHookStatusObserved !== undefined ? Boolean(input.socketHookStatusObserved) : Boolean(state.socketHookStatusObserved);
    var disconnected = input.transportDisconnected !== undefined ? Boolean(input.transportDisconnected) : Boolean(state.transportDisconnected);
    var freshGameState = input.freshGameState === true || Boolean(state.freshLiveActivityObserved);
    var socketConnected = !disconnected && (Boolean(state.transportConnected) || freshGameState);
    var explicitlyWaiting = BREAK_STATUS.test(tableStatus) || Boolean(input.waitingToStart !== undefined ? input.waitingToStart : state.waitingToStart);
    var explicitlyPaused = PAUSED_STATUS.test(tableStatus) ||
      PAUSED_CLASSIFICATION.test(classification) ||
      Boolean(input.gamePaused !== undefined ? input.gamePaused : state.gamePaused);
    var lifecycleWaiting = BREAK_CLASSIFICATION.test(classification) && !explicitlyPaused ||
      Boolean(input.gameStopped !== undefined ? input.gameStopped : state.gameStopped) ||
      Boolean(input.gameBroken !== undefined ? input.gameBroken : state.gameBroken);
    var lifecycleActive = ACTIVE_CLASSIFICATION.test(classification);
    var explicitlyActive = ACTIVE_STATUS.test(tableStatus);
    var tableActive = lifecycleActive || (explicitlyActive && eligiblePlayerCount >= 2);
    var localLifecycleCommand = normalizeText(input.localLifecycleCommand !== undefined ? input.localLifecycleCommand : state.localLifecycleCommand);
    var locallyPaused = localLifecycleCommand === 'paused-local-command' || localLifecycleCommand === 'resume-pending-confirmation';
    var authoritativePauseState = normalizeText(input.authoritativePauseState !== undefined ? input.authoritativePauseState : state.authoritativePauseState);
    var authoritativelyPaused = authoritativePauseState === 'paused';

    // Presentation precedence is fixed: disconnected, connecting, waiting/break,
    // authoritative pause, then verified live. This selector is read-only and must
    // never create lifecycle, hand, epoch, or statistics transitions.
    if (disconnected || (hookStatusObserved && !hookInstalled)) return { status: 'disconnected', reason: disconnected ? 'socket-disconnected' : 'socket-hook-unavailable', precedenceBranch: 'socket-unavailable' };
    if (!hookInstalled || !socketConnected || !freshGameState) return { status: 'initializing', reason: 'socket-connecting-or-awaiting-current-game-state', precedenceBranch: 'awaiting-authoritative-state' };
    if (explicitlyWaiting || lifecycleWaiting) return { status: 'waiting', reason: state.displayedStatus === 'live' || state.displayedStatus === 'live-socket' ? 'table-entered-game-break' : 'bootstrap-waiting', precedenceBranch: 'full-break-stopped-or-waiting' };
    if (locallyPaused || explicitlyPaused || authoritativelyPaused) {
      return {
        status: 'live-socket',
        reason: locallyPaused
          ? (localLifecycleCommand === 'paused-local-command' ? 'verified-local-host-pause-command' : 'local-host-resume-awaiting-game-progression')
          : (authoritativelyPaused ? 'verified-authoritative-room-owner-pause' : 'table-paused'),
        precedenceBranch: 'verified-pause'
      };
    }
    if (tableActive) {
      var resumed = state.displayedStatus === 'waiting' || state.initializedWhileWaiting;
      return { status: 'live', reason: resumed ? 'table-resumed' : (state.displayedStatus === 'initializing' ? 'bootstrap-active' : 'fresh-active-game-state'), precedenceBranch: 'verified-active-game' };
    }
    return { status: 'waiting', reason: input.reason || 'connected-game-state-is-not-verified-active', precedenceBranch: 'safe-connected-fallback' };
  }

  function presentation(status) {
    if (status === 'live') return { label: 'Live', note: 'PokerNow game is actively running.' };
    if (status === 'live-socket') return { label: 'Paused', note: 'PokerNow game is paused.' };
    if (status === 'waiting') return { label: 'Waiting', note: 'PokerNow connected · waiting for the game to resume' };
    if (status === 'disconnected') return { label: 'Disconnected', note: 'PokerNow socket unavailable' };
    return { label: 'Connecting\u2026', note: 'Connecting to the PokerNow game state' };
  }

  function reconcile(state, input) {
    input = input || {};
    var timestamp = Number(input.timestamp || Date.now());
    if (input.tableStatus !== undefined) state.tableStatus = input.tableStatus;
    if (input.tableClassification !== undefined) {
      state.tableClassification = input.tableClassification;
      state.lifecycleClassification = input.tableClassification;
    }
    if (input.lifecycleConfidence !== undefined) state.lifecycleConfidence = input.lifecycleConfidence;
    if (input.lifecycleEvidence !== undefined) state.lifecycleEvidence = cloneSafe(input.lifecycleEvidence);
    if (input.localLifecycleCommand !== undefined) state.localLifecycleCommand = input.localLifecycleCommand;
    if (input.authoritativePauseState !== undefined) state.authoritativePauseState = input.authoritativePauseState;
    if (input.authoritativePauseEvidence !== undefined) state.authoritativePauseEvidence = cloneSafe(input.authoritativePauseEvidence);
    if (input.verifiedInactiveReason !== undefined) state.verifiedInactiveReason = input.verifiedInactiveReason;
    if (input.verifiedActiveReason !== undefined) state.verifiedActiveReason = input.verifiedActiveReason;
    ['waitingToStart', 'gamePaused', 'gameStopped', 'gameBroken'].forEach(function (key) {
      if (input[key] !== undefined) state[key] = Boolean(input[key]);
    });
    if (input.eligiblePlayerCount !== undefined) state.eligiblePlayerCount = Number(input.eligiblePlayerCount || 0);
    if (input.socketHookInstalled !== undefined) state.socketHookInstalled = Boolean(input.socketHookInstalled);
    if (input.socketHookStatusObserved !== undefined) state.socketHookStatusObserved = Boolean(input.socketHookStatusObserved);
    if (input.framesCaptured !== undefined) state.framesCaptured = Number(input.framesCaptured || 0);
    if (input.packetsDecoded !== undefined) state.packetsDecoded = Number(input.packetsDecoded || 0);
    if (input.gameStatePatchesMerged !== undefined) state.gameStatePatchesMerged = Number(input.gameStatePatchesMerged || 0);
    if (input.activeHandPresent !== undefined) state.activeHandPresent = Boolean(input.activeHandPresent);
    if (input.transportDisconnected !== undefined) {
      state.transportDisconnected = Boolean(input.transportDisconnected);
      state.transportConnected = !state.transportDisconnected;
      if (state.transportDisconnected) {
        state.freshLiveActivityObserved = false;
        state.lastFreshGameStateAt = null;
      }
    }
    if (input.freshGameState === true) {
      state.transportConnected = true;
      state.freshLiveActivityObserved = true;
      state.lastFreshGameStateAt = timestamp;
      state.freshMergedStateAt = timestamp;
    }

    var result = derive(state, input);
    var changed = result.status !== state.displayedStatus;
    if (changed) {
      var previous = state.displayedStatus;
      state.previousStatus = previous;
      state.displayedStatus = result.status;
      state.derivedStatus = result.status;
      state.lastStatusTransitionAt = timestamp;
      state.lastStatusTransitionReason = result.reason;
      state.transitionCount += 1;
      if (result.status === 'waiting' && previous === 'initializing') state.initializedWhileWaiting = true;
      if (result.status === 'live' && (previous === 'waiting' || state.initializedWhileWaiting)) state.resumedAfterWaiting = true;
    } else {
      state.derivedStatus = result.status;
    }
    return {
      changed: changed,
      status: result.status,
      previousStatus: changed ? state.previousStatus : state.displayedStatus,
      reason: result.reason,
      precedenceBranch: result.precedenceBranch
    };
  }

  function snapshot(state) {
    return Object.assign({}, state);
  }

  function cloneSafe(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return String(value); }
  }

  var api = Object.freeze({
    createState: createState,
    derive: derive,
    presentation: presentation,
    reconcile: reconcile,
    snapshot: snapshot
  });
  root.PokerHudRuntimeStatus = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
