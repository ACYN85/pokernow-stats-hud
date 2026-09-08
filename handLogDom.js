/* Full Log DOM diagnostics and explicit display-only ownership policy. */
(function (root) {
  'use strict';

  var WITHHELD_REASON = 'Full Log is display/history-only; live WebSocket owns session statistics';

  function createState() {
    return {
      observerSequence: 0,
      installationCount: 0,
      activeObserverId: null,
      activeContainerId: null,
      seenContainerIds: new Set(),
      seenFingerprints: new Set(),
      nodeFingerprints: new Map(),
      traces: []
    };
  }

  function installObserver(state, containerId, timestamp) {
    containerId = String(containerId || 'unknown-container');
    if (state.activeObserverId && state.activeContainerId === containerId) {
      return { installed: false, observerId: state.activeObserverId, installationCount: state.installationCount, containerReplacement: false };
    }
    var previousObserverId = state.activeObserverId;
    var previousContainerId = state.activeContainerId;
    state.observerSequence += 1;
    state.installationCount += 1;
    state.activeObserverId = 'hand-log-observer-' + state.observerSequence;
    state.activeContainerId = containerId;
    var replacement = Boolean(previousObserverId && previousContainerId !== containerId);
    state.seenContainerIds.add(containerId);
    return {
      installed: true,
      observerId: state.activeObserverId,
      installationCount: state.installationCount,
      containerReplacement: replacement,
      previousObserverId: previousObserverId || null,
      previousContainerId: previousContainerId || null
    };
  }

  function disconnectObserver(state, observerId) {
    if (!state.activeObserverId || (observerId && String(observerId) !== state.activeObserverId)) return false;
    state.activeObserverId = null;
    state.activeContainerId = null;
    return true;
  }

  function classifyMutation(state, input) {
    input = input || {};
    var nodeId = input.nodeId === null || input.nodeId === undefined ? null : String(input.nodeId);
    var fingerprint = input.textFingerprint ? String(input.textFingerprint) : null;
    var previousFingerprint = nodeId ? state.nodeFingerprints.get(nodeId) || null : null;
    var fingerprintPreviouslySeen = Boolean(fingerprint && state.seenFingerprints.has(fingerprint));
    var nodePreviouslySeen = Boolean(previousFingerprint);
    var classification = 'lazy-render';
    if (input.containerReplacement) classification = 'container-replacement';
    else if (input.removed) classification = 'virtualized-row-unmount';
    else if (input.firstRender) classification = 'first-render';
    else if (nodePreviouslySeen && fingerprint && previousFingerprint !== fingerprint) classification = 'recycled-dom-node';
    else if (fingerprintPreviouslySeen) classification = 'virtualized-row-remount';
    else if (input.characterData) classification = 'recycled-dom-node';

    if (!input.removed && nodeId && fingerprint) state.nodeFingerprints.set(nodeId, fingerprint);
    if (!input.removed && fingerprint) state.seenFingerprints.add(fingerprint);

    var trace = {
      timestamp: Number(input.timestamp || Date.now()),
      observerInstanceId: input.observerInstanceId || state.activeObserverId,
      observerInstallationCount: Number(input.observerInstallationCount || state.installationCount),
      targetContainerIdentity: input.containerId || state.activeContainerId,
      addedNodeIdentity: input.removed ? null : nodeId,
      removedNodeIdentity: input.removed ? nodeId : null,
      nodePreviouslySeen: nodePreviouslySeen,
      textFingerprint: fingerprint,
      previousTextFingerprint: previousFingerprint,
      parsedPokerNowHandId: input.parsedPokerNowHandId || null,
      sourceClassification: 'full-log-display-history',
      renderClassification: classification,
      firstRender: classification === 'first-render',
      lazyRender: classification === 'lazy-render',
      virtualizedRowRemount: classification === 'virtualized-row-remount',
      recycledDomNode: classification === 'recycled-dom-node',
      containerReplacement: classification === 'container-replacement',
      actualNewLiveLogLine: false,
      actualNewLiveLogLineReason: 'DOM insertion or text replacement is not accepted as proof of a new hand',
      resultingCommitAttempt: {
        attempted: false,
        accepted: false,
        rejectionReason: WITHHELD_REASON
      }
    };
    state.traces.push(trace);
    if (state.traces.length > 500) state.traces.shift();
    return trace;
  }

  function statsOwnershipDecision() {
    return { mutateStats: false, commitAttempted: false, reason: WITHHELD_REASON, owner: 'live-websocket' };
  }

  function snapshot(state) {
    return state.traces.map(function (trace) { return JSON.parse(JSON.stringify(trace)); });
  }

  var api = Object.freeze({
    WITHHELD_REASON: WITHHELD_REASON,
    createState: createState,
    installObserver: installObserver,
    disconnectObserver: disconnectObserver,
    classifyMutation: classifyMutation,
    statsOwnershipDecision: statsOwnershipDecision,
    snapshot: snapshot
  });
  root.PokerHandLogDom = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
