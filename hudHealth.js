/* Pure pipeline-health panel rendering and incremental DOM updates. */
(function (root) {
  'use strict';

  var METRICS = Object.freeze([
    ['WebSocket hook installed', 'hookInstalled'],
    ['Frames captured', 'framesCaptured'],
    ['Frames relayed', 'framesRelayed'],
    ['Packets decoded', 'packetsDecoded'],
    ['Game-state patches merged', 'gameStatePatchesMerged'],
    ['Socket player IDs discovered', 'socketPlayerIdsDiscovered'],
    ['DOM seats discovered', 'domSeatsDiscovered'],
    ['Confirmed player mappings', 'confirmedPlayerMappings'],
    ['Rejected mapping candidates', 'rejectedMappingCandidates'],
    ['Hand boundaries detected', 'handBoundariesDetected'],
    ['Poker events emitted', 'pokerEventsEmitted'],
    ['Stats events stored', 'statsEventsStored'],
    ['Restored stats events', 'restoredStatsEvents'],
    ['Injected test events', 'injectedTestEvents'],
    ['Real live events', 'realLiveEvents'],
    ['Action candidates', 'actionCandidates'],
    ['Checks detected', 'checksDetected'],
    ['Calls detected', 'callsDetected'],
    ['Bets detected', 'betsDetected'],
    ['Raises detected', 'raisesDetected'],
    ['Folds detected', 'foldsDetected'],
    ['Ambiguous actions rejected', 'ambiguousActionsRejected'],
    ['Pending action candidates', 'pendingActionCandidates'],
    ['Confirmed action candidates', 'confirmedActionCandidates'],
    ['Rejected action candidates', 'rejectedActionCandidates'],
    ['Expired action candidates', 'expiredActionCandidates'],
    ['Raw tB transitions seen', 'rawTbTransitionsSeen'],
    ['Normalized tB transitions seen', 'normalizedTbTransitionsSeen'],
    ['Voluntary tB transitions gated', 'voluntaryTbTransitionsGated'],
    ['Active staged events', 'activeStagedEvents'],
    ['Finalized hands', 'finalizedHands'],
    ['Finalized stats events', 'finalizedStatsEvents'],
    ['Confirmed mapped players', 'confirmedMappedPlayers'],
    ['Eligible overlay players', 'eligibleOverlayPlayers'],
    ['Overlay elements created', 'overlayElementsCreated'],
    ['Overlay elements attached', 'overlayElementsAttached'],
    ['Overlay elements visible', 'overlayElementsVisible'],
    ['Overlay placement failures', 'overlayPlacementFailures'],
    ['Visible socket players', 'visibleSocketPlayers'],
    ['Visible occupied seats', 'visibleOccupiedSeats'],
    ['Successful assignments', 'successfulAssignments'],
    ['Assignments withheld', 'assignmentsWithheld'],
    ['WebSocket hook installations', 'websocketHookInstallationCount'],
    ['Page-bridge listeners', 'pageBridgeListenerCount'],
    ['DOM Hand Log observers', 'domHandLogObserverCount'],
    ['Full Log parser installations', 'fullLogParserInstallationCount'],
    ['Storage restoration callbacks', 'storageRestorationCallbackCount'],
    ['Initialization replays', 'initializationReplayCount'],
    ['Queued startup frames', 'queuedFrameCount'],
    ['Replayed startup frames', 'replayedFrameCount'],
    ['Duplicate frame fingerprints', 'duplicateFrameFingerprintCount'],
    ['Top mapping rejection reason', 'topMappingRejectionReason']
  ]);

  function displayValue(key, value) {
    return key === 'hookInstalled' ? (value ? 'yes' : 'no') : value;
  }

  function renderHtml(health, escapeHtml, options) {
    health = health || {};
    options = options || {};
    escapeHtml = escapeHtml || function (value) { return String(value); };
    var items = METRICS.map(function (metric) {
      var label = metric[0];
      var key = metric[1];
      return '<div><dt>' + escapeHtml(label) + '</dt><dd data-health="' + key + '">' + escapeHtml(displayValue(key, health[key])) + '</dd></div>';
    }).join('');
    var commonActions = '<button class="pnhud-copy-diagnostics">Copy Diagnostics</button>';
    var developerActions = options.developerToolsVisible === false ? '' : '<button class="pnhud-inspect-seats">Inspect Seats</button><button class="pnhud-mark-hand-start">Mark Hand Start</button><button class="pnhud-mark-hand-end">Mark Hand End</button><button class="pnhud-copy-hand-sequence">Copy Hand Sequence</button><button class="pnhud-copy-action-sequence">Copy Action Sequence</button><button class="pnhud-inject-test">Inject Test Event</button>';
    return '<section class="pnhud-health"><div class="pnhud-health-title"><span>Pipeline health</span><div class="pnhud-health-actions">' + commonActions + developerActions + '</div></div><dl>' +
      items + '<div class="pnhud-health-failure"><dt>Last failure reason</dt><dd data-health="lastFailureReason">' + escapeHtml(health.lastFailureReason) + '</dd></div></dl></section>';
  }

  function update(rootElement, health) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') return 0;
    var updated = 0;
    Object.keys(health || {}).forEach(function (key) {
      var target = rootElement.querySelector('[data-health="' + key + '"]');
      if (!target) return;
      target.textContent = String(displayValue(key, health[key]));
      updated += 1;
    });
    return updated;
  }

  var api = Object.freeze({ METRICS: METRICS, displayValue: displayValue, renderHtml: renderHtml, update: update });
  root.PokerHudHealth = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
