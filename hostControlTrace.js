/* Bounded, sanitized diagnostics for outgoing PokerNow table-control commands. */
(function (root) {
  'use strict';

  var SAFE_FIELD = /^(?:command|action|type|method|name|operation|op|subtype|mode|state|status|enabled|value|code)$/i;
  var SENSITIVE_FIELD = /(?:token|auth|cookie|email|password|secret|session|card|hole)/i;
  var POKER_ACTION = /^(?:fold|check|call|bet|raise|allin|up|atb)$/i;

  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return String(value); }
  }

  function fingerprint(value) {
    var text = JSON.stringify(value || {});
    var hash = 2166136261;
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function primitive(value) {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
  }

  function sanitize(payload) {
    var fields = [];
    var shape = [];
    function visit(value, path, depth) {
      if (depth > 5 || fields.length >= 40) return;
      if (primitive(value)) {
        var key = String(path || '$').split('.').pop();
        if (SENSITIVE_FIELD.test(path)) return;
        var sanitizedValue = value;
        if (typeof value === 'string' && (
          value.length > 120 ||
          /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ||
          /^Bearer\s+/i.test(value) ||
          /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/.test(value)
        )) sanitizedValue = '[redacted-sensitive-string]';
        fields.push({
          path: path || '$',
          key: key,
          value: sanitizedValue,
          valueType: value === null ? 'null' : typeof value,
          commandNamedField: SAFE_FIELD.test(key)
        });
        return;
      }
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        shape.push({ path: path || '$', type: 'array', length: Math.min(value.length, 20) });
        value.slice(0, 20).forEach(function (item, index) { visit(item, (path || '$') + '[' + index + ']', depth + 1); });
        return;
      }
      var keys = Object.keys(value).filter(function (key) { return !SENSITIVE_FIELD.test(key); }).slice(0, 30);
      shape.push({ path: path || '$', type: 'object', keys: keys });
      keys.forEach(function (key) { visit(value[key], (path || '$') + '.' + key, depth + 1); });
    }
    visit(payload, '$', 0);
    return { topLevelArgumentShape: shape.slice(0, 20), primitiveCommandFields: fields };
  }

  function classify(fields) {
    var semantic = null;
    var pokerAction = false;
    (fields || []).filter(function (field) { return field.commandNamedField; }).forEach(function (field) {
      var normalized = String(field.value === null ? '' : field.value).trim().toLowerCase().replace(/[\s_-]+/g, '');
      if (POKER_ACTION.test(normalized)) pokerAction = true;
      if (/^(?:pause|paused|pausegame|gamepause)$/.test(normalized)) semantic = semantic || 'pause';
      if (/^(?:resume|resumed|resumegame|gameresume|continue|unpause)$/.test(normalized)) semantic = semantic || 'resume';
    });
    return {
      command: semantic,
      knownPokerAction: pokerAction,
      appearsTableControl: Boolean(semantic) && !pokerAction
    };
  }

  // Production Pause/Resume recognition is intentionally narrow: only an outgoing
  // action with an exact top-level UP/UR type from the verified table owner qualifies.
  // UI clicks and diagnostic markers are corroboration only and cannot satisfy this gate.
  function recognizeVerifiedHostPauseResume(input) {
    input = input || {};
    var direction = String(input.direction || '').toLowerCase();
    var eventName = String(input.eventName || '');
    var payload = input.payload;
    var exactObject = Boolean(payload && typeof payload === 'object' && !Array.isArray(payload));
    var hasTopLevelType = exactObject && Object.prototype.hasOwnProperty.call(payload, 'type');
    var commandType = hasTopLevelType && typeof payload.type === 'string' ? payload.type : null;
    var candidateCommand = commandType === 'UP' ? 'pause' : (commandType === 'UR' ? 'resume' : null);
    var localPlayerId = input.localUserPlayerId === undefined || input.localUserPlayerId === null || input.localUserPlayerId === '<D>' ? null : String(input.localUserPlayerId);
    var tableOwnerPlayerId = input.tableOwnerPlayerId === undefined || input.tableOwnerPlayerId === null || input.tableOwnerPlayerId === '<D>' ? null : String(input.tableOwnerPlayerId);
    var ownershipAvailable = Boolean(localPlayerId && tableOwnerPlayerId);
    var localUserIsVerifiedHost = ownershipAvailable && localPlayerId === tableOwnerPlayerId;
    var structuralMatch = direction === 'outgoing' && eventName === 'action' && Boolean(candidateCommand);
    var rejectionReason = null;
    if (direction !== 'outgoing') rejectionReason = 'not-outgoing';
    else if (eventName !== 'action') rejectionReason = 'event-name-not-action';
    else if (!exactObject) rejectionReason = 'payload-not-object';
    else if (!hasTopLevelType || !candidateCommand) rejectionReason = 'exact-top-level-command-type-not-matched';
    else if (!ownershipAvailable) rejectionReason = 'host-verification-unavailable';
    else if (!localUserIsVerifiedHost) rejectionReason = 'verified-local-user-is-not-owner';
    return {
      matched: structuralMatch && localUserIsVerifiedHost,
      candidateCommand: structuralMatch ? candidateCommand : null,
      recognizedCommand: structuralMatch && localUserIsVerifiedHost ? candidateCommand : null,
      commandType: structuralMatch ? commandType : null,
      recognizerBranch: structuralMatch && localUserIsVerifiedHost
        ? (candidateCommand === 'pause' ? 'verified-host-outgoing-action-up-pause' : 'verified-host-outgoing-action-ur-resume')
        : null,
      source: structuralMatch && localUserIsVerifiedHost ? 'verified-host-outgoing-command' : null,
      ownershipAvailable: ownershipAvailable,
      localUserIsVerifiedHost: localUserIsVerifiedHost,
      localUserPlayerId: localPlayerId,
      tableOwnerPlayerId: tableOwnerPlayerId,
      rejectionReason: structuralMatch && localUserIsVerifiedHost ? null : rejectionReason
    };
  }

  function createState(saved) {
    saved = saved || {};
    return {
      recentOutgoingCommands: [],
      unverifiedCandidates: [],
      lastPauseCommand: clone(saved.lastPauseCommand || null),
      lastResumeCommand: clone(saved.lastResumeCommand || null),
      pauseCommandRecognized: Boolean(saved.pauseCommandRecognized),
      resumeCommandRecognized: Boolean(saved.resumeCommandRecognized),
      commandPayloadFingerprint: saved.commandPayloadFingerprint || null,
      localUserIsVerifiedHost: false,
      commandPersistenceRequestedAt: saved.commandPersistenceRequestedAt || null,
      commandPersistenceCompletedAt: saved.commandPersistenceCompletedAt || null,
      activeLocalCommand: saved.activeLocalCommand || null,
      authoritativePauseState: saved.authoritativePauseState || null,
      authoritativePauseEvidence: clone(saved.authoritativePauseEvidence || null),
      authoritativeTransitionCount: Number(saved.authoritativeTransitionCount || 0)
    };
  }
  function record(state, input) {
    input = input || {};
    var sanitized = sanitize(input.payload);
    var diagnosticClassification = classify(sanitized.primitiveCommandFields);
    var recognition = recognizeVerifiedHostPauseResume(input);
    var record = {
      frameId: input.frameId || null,
      timestamp: Number(input.timestamp || Date.now()),
      direction: input.direction || null,
      eventName: input.eventName || null,
      namespace: input.namespace || '/',
      topLevelArgumentShape: sanitized.topLevelArgumentShape,
      primitiveCommandFields: sanitized.primitiveCommandFields,
      changedCommandIdentifiers: sanitized.primitiveCommandFields.map(function (field) { return { path: field.path, value: field.value }; }),
      immediatelyAfterPauseOrResumeClick: input.immediatelyAfterPauseOrResumeClick || null,
      knownPokerAction: diagnosticClassification.knownPokerAction && !recognition.candidateCommand,
      appearsTableControl: Boolean(recognition.recognizedCommand),
      diagnosticSemanticCommand: diagnosticClassification.command,
      candidateCommand: recognition.candidateCommand,
      recognizedCommand: recognition.recognizedCommand,
      commandType: recognition.commandType,
      recognizerBranch: recognition.recognizerBranch,
      source: recognition.source,
      ownershipAvailable: recognition.ownershipAvailable,
      localUserIsVerifiedHost: recognition.localUserIsVerifiedHost,
      localUserPlayerId: recognition.localUserPlayerId,
      tableOwnerPlayerId: recognition.tableOwnerPlayerId,
      rejectionReason: recognition.rejectionReason,
      payloadFingerprint: fingerprint({ eventName: input.eventName || null, fields: sanitized.primitiveCommandFields })
    };
    state.localUserIsVerifiedHost = recognition.localUserIsVerifiedHost;
    state.commandPayloadFingerprint = record.payloadFingerprint;
    state.recentOutgoingCommands.push(record); if (state.recentOutgoingCommands.length > 20) state.recentOutgoingCommands.shift();
    if (recognition.candidateCommand && !recognition.recognizedCommand) { state.unverifiedCandidates.push(clone(record)); if (state.unverifiedCandidates.length > 20) state.unverifiedCandidates.shift(); }
    if (recognition.recognizedCommand === 'pause') { state.pauseCommandRecognized = true; state.lastPauseCommand = clone(record); }
    if (recognition.recognizedCommand === 'resume') { state.resumeCommandRecognized = true; state.lastResumeCommand = clone(record); }
    return record;
  }

  function applyRecognizedCommand(state, record, timestamp) {
    if (!record || !record.recognizedCommand || !record.localUserIsVerifiedHost || record.source !== 'verified-host-outgoing-command') return { applied: false, changed: false, previousState: state.authoritativePauseState || null, nextState: state.authoritativePauseState || null, evidence: null };
    var previousState = state.authoritativePauseState || null;
    var nextState = record.recognizedCommand === 'pause' ? 'paused' : 'resumed';
    var changed = previousState !== nextState;
    var evidence = {
      frameId: record.frameId || null,
      timestamp: Number(timestamp || record.timestamp || Date.now()),
      eventName: record.eventName,
      commandType: record.commandType,
      recognizedCommand: record.recognizedCommand,
      recognizerBranch: record.recognizerBranch,
      localUserPlayerId: record.localUserPlayerId,
      tableOwnerPlayerId: record.tableOwnerPlayerId,
      localUserIsVerifiedHost: true,
      source: 'verified-host-outgoing-command',
      payloadFingerprint: record.payloadFingerprint,
      previousAuthoritativePauseState: previousState,
      nextAuthoritativePauseState: nextState,
      transitionChanged: changed
    };
    state.authoritativePauseState = nextState;
    state.authoritativePauseEvidence = clone(evidence);
    state.activeLocalCommand = nextState === 'paused' ? 'paused-local-command' : null;
    if (changed) state.authoritativeTransitionCount += 1;
    return { applied: true, changed: changed, previousState: previousState, nextState: nextState, evidence: evidence };
  }
  function persistentSnapshot(state) {
    return {
      lastPauseCommand: clone(state.lastPauseCommand),
      lastResumeCommand: clone(state.lastResumeCommand),
      pauseCommandRecognized: state.pauseCommandRecognized,
      resumeCommandRecognized: state.resumeCommandRecognized,
      commandPayloadFingerprint: state.commandPayloadFingerprint,
      commandPersistenceRequestedAt: state.commandPersistenceRequestedAt,
      commandPersistenceCompletedAt: state.commandPersistenceCompletedAt,
      activeLocalCommand: state.activeLocalCommand,
      authoritativePauseState: state.authoritativePauseState,
      authoritativePauseEvidence: clone(state.authoritativePauseEvidence),
      authoritativeTransitionCount: state.authoritativeTransitionCount
    };
  }
  function snapshot(state) {
    return clone(state);
  }

  var api = Object.freeze({
    createState: createState,
    sanitize: sanitize,
    classify: classify,
    recognizeVerifiedHostPauseResume: recognizeVerifiedHostPauseResume,
    record: record,
    applyRecognizedCommand: applyRecognizedCommand,
    persistentSnapshot: persistentSnapshot,
    snapshot: snapshot
  });
  root.PokerHostControlTrace = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
