/* Bounded, opt-in raw transport diagnostics for pause/resume investigation. */
(function (root) {
  'use strict';

  var MAX_FRAMES = 240;
  var MAX_WARNINGS = 80;
  var MAX_CHECKPOINTS = 30;
  var MAX_RAW_EXCERPT = 1800;
  var MAX_DECODED_EXCERPT = 2400;
  var PAUSE_LIKE = /pause|paused|stop|stopped|suspend|break|waiting/i;
  var RESUME_LIKE = /resume|resumed|unpause|continue|start|started|running/i;

  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return String(value); }
  }

  function excerpt(value, limit) {
    var text;
    try { text = typeof value === 'string' ? value : JSON.stringify(value); } catch (error) { text = String(value); }
    text = String(text === undefined ? '' : text);
    return {
      text: text.slice(0, limit),
      originalLength: text.length,
      truncated: text.length > limit
    };
  }

  function decodedExcerpt(value) {
    var bounded = excerpt(value, MAX_DECODED_EXCERPT);
    if (!bounded.truncated) {
      try { return { value: JSON.parse(bounded.text), originalLength: bounded.originalLength, truncated: false }; } catch (error) {}
    }
    return { value: bounded.text, originalLength: bounded.originalLength, truncated: bounded.truncated };
  }

  function createState(options) {
    options = options || {};
    return {
      enabled: options.enabled === true,
      buildId: String(options.buildId || 'unknown-build'),
      contentScriptInstanceId: String(options.contentScriptInstanceId || 'unknown-content-instance'),
      websocketHookInstanceId: options.websocketHookInstanceId || null,
      runtimeStatusStoreInstanceId: String(options.runtimeStatusStoreInstanceId || 'unknown-runtime-store'),
      hudRendererInstanceId: String(options.hudRendererInstanceId || 'unknown-renderer'),
      createdAt: Number(options.createdAt || Date.now()),
      sequence: 0,
      frames: [],
      checkpoints: [],
      warnings: [],
      counters: {
        rawPauseLikePacketsObserved: 0,
        rawResumeLikePacketsObserved: 0,
        recognizedPauseSignals: 0,
        recognizedResumeSignals: 0,
        persistedPauseStateWrites: 0,
        pauseStateClears: 0,
        runtimeStatusRecalculations: 0,
        badgeRenders: 0
      },
      lastRuntimeRecord: null,
      lastRenderRecord: null,
      lastPersistedPauseState: null
    };
  }

  function setEnabled(state, enabled, timestamp) {
    state.enabled = enabled === true;
    state.enabledChangedAt = Number(timestamp || Date.now());
    return state.enabled;
  }

  function setHookInstance(state, hookInstanceId) {
    if (hookInstanceId) state.websocketHookInstanceId = String(hookInstanceId);
    return state.websocketHookInstanceId;
  }

  function warning(state, code, message, details, timestamp) {
    var entry = {
      timestamp: Number(timestamp || Date.now()),
      code: String(code || 'unknown-warning'),
      message: String(message || ''),
      details: clone(details || {})
    };
    state.warnings.push(entry);
    if (state.warnings.length > MAX_WARNINGS) state.warnings.shift();
    return entry;
  }

  function recordFrame(state, input) {
    if (!state.enabled) return null;
    input = input || {};
    var raw = excerpt(input.rawFrame || '', MAX_RAW_EXCERPT);
    var decoded = decodedExcerpt(input.decodedArgumentList === undefined ? null : input.decodedArgumentList);
    var searchable = [raw.text, typeof decoded.value === 'string' ? decoded.value : JSON.stringify(decoded.value || '')].join(' ');
    var pauseLike = PAUSE_LIKE.test(searchable);
    var resumeLike = RESUME_LIKE.test(searchable);
    if (pauseLike) state.counters.rawPauseLikePacketsObserved += 1;
    if (resumeLike) state.counters.rawResumeLikePacketsObserved += 1;
    var record = {
      recordId: 'pause-frame-' + (++state.sequence),
      frameId: input.frameId || null,
      timestamp: Number(input.timestamp || Date.now()),
      transportDirection: input.transportDirection || null,
      engineIoPacketType: input.engineIoPacketType || null,
      socketIoPacketType: input.socketIoPacketType || null,
      namespace: input.namespace || null,
      eventName: input.eventName || null,
      decodedSuccessfully: input.decodedSuccessfully === true,
      decodedArgumentList: decoded.value,
      decodedArgumentListOriginalLength: decoded.originalLength,
      decodedArgumentListTruncated: decoded.truncated,
      rawPayloadExcerpt: raw.text,
      rawPayloadOriginalLength: raw.originalLength,
      rawPayloadTruncated: raw.truncated,
      engineIoRecordSeparatorCount: (raw.text.match(/\x1e/g) || []).length,
      batchedPacketCandidate: raw.text.indexOf('\x1e') >= 0,
      rawPauseLike: pauseLike,
      rawResumeLike: resumeLike,
      recognizerMatched: null,
      recognizerBranch: null,
      recognizerBranchName: null,
      normalizedLifecycleSignal: null,
      previousPersistedPauseState: null,
      nextPersistedPauseState: null,
      persistenceReason: null,
      runtimeRecalculationCountBefore: state.counters.runtimeStatusRecalculations,
      runtimeStatusInputsAfterProcessing: null,
      selectedStatus: null,
      renderedBadgeText: null,
      renderedFooterText: null,
      instances: {
        contentScriptInstanceId: state.contentScriptInstanceId,
        websocketHookInstanceId: input.websocketHookInstanceId || state.websocketHookInstanceId,
        runtimeStatusStoreInstanceId: state.runtimeStatusStoreInstanceId,
        hudRendererInstanceId: state.hudRendererInstanceId
      }
    };
    state.frames.push(record);
    if (state.frames.length > MAX_FRAMES) state.frames.shift();
    return record;
  }

  function completeFrame(state, record, input) {
    if (!state.enabled || !record) return null;
    input = input || {};
    if (input.socketIoPacketType !== undefined) record.socketIoPacketType = input.socketIoPacketType;
    if (input.namespace !== undefined) record.namespace = input.namespace;
    if (input.eventName !== undefined) record.eventName = input.eventName;
    if (input.decodedSuccessfully !== undefined) record.decodedSuccessfully = input.decodedSuccessfully === true;
    if (input.decodedArgumentList !== undefined) {
      var decoded = decodedExcerpt(input.decodedArgumentList);
      record.decodedArgumentList = decoded.value;
      record.decodedArgumentListOriginalLength = decoded.originalLength;
      record.decodedArgumentListTruncated = decoded.truncated;
      var searchable = typeof decoded.value === 'string' ? decoded.value : JSON.stringify(decoded.value || '');
      if (!record.rawPauseLike && PAUSE_LIKE.test(searchable)) {
        record.rawPauseLike = true;
        state.counters.rawPauseLikePacketsObserved += 1;
      }
      if (!record.rawResumeLike && RESUME_LIKE.test(searchable)) {
        record.rawResumeLike = true;
        state.counters.rawResumeLikePacketsObserved += 1;
      }
    }
    record.recognizerMatched = input.recognizerMatched === true;
    record.recognizerBranch = input.recognizerBranch || null;
    record.recognizerBranchName = input.recognizerBranchName || null;
    record.normalizedLifecycleSignal = clone(input.normalizedLifecycleSignal || null);
    record.previousPersistedPauseState = input.previousPersistedPauseState === undefined ? null : input.previousPersistedPauseState;
    record.nextPersistedPauseState = input.nextPersistedPauseState === undefined ? null : input.nextPersistedPauseState;
    record.persistenceReason = input.persistenceReason || null;
    record.runtimeStatusInputsAfterProcessing = clone(input.runtimeStatusInputsAfterProcessing || null);
    record.selectedStatus = input.selectedStatus || null;
    record.renderedBadgeText = input.renderedBadgeText || null;
    record.renderedFooterText = input.renderedFooterText || null;
    if (input.recognizerBranch === 'pause') state.counters.recognizedPauseSignals += 1;
    if (input.recognizerBranch === 'resume') state.counters.recognizedResumeSignals += 1;
    if (record.rawPauseLike && !record.recognizerMatched) {
      warning(state, 'pause-like-unrecognized', 'pause-like raw packet observed but no recognizer matched', { frameId: record.frameId, eventName: record.eventName }, record.timestamp);
    }
    if (record.rawResumeLike && !record.recognizerMatched) {
      warning(state, 'resume-like-unrecognized', 'resume-like raw packet observed but no recognizer matched', { frameId: record.frameId, eventName: record.eventName }, record.timestamp);
    }
    var idempotentVerifiedHostCommand = Boolean(record.normalizedLifecycleSignal && record.normalizedLifecycleSignal.authoritativeApplication && record.normalizedLifecycleSignal.authoritativeApplication.changed === false);
    if (record.recognizerMatched && record.previousPersistedPauseState === record.nextPersistedPauseState && !idempotentVerifiedHostCommand) {
      warning(state, 'recognized-state-unchanged', 'lifecycle signal was recognized but persisted pause state was unchanged', {
        frameId: record.frameId,
        branch: record.recognizerBranch,
        branchName: record.recognizerBranchName,
        pauseState: record.nextPersistedPauseState
      }, record.timestamp);
    }
    if (record.previousPersistedPauseState !== record.nextPersistedPauseState &&
        state.counters.runtimeStatusRecalculations === record.runtimeRecalculationCountBefore) {
      warning(state, 'state-changed-without-runtime-recalculation', 'persisted pause state changed without a runtime-status recalculation', {
        frameId: record.frameId,
        previousPersistedPauseState: record.previousPersistedPauseState,
        nextPersistedPauseState: record.nextPersistedPauseState
      }, record.timestamp);
    }
    return record;
  }

  function recordRuntimeRecalculation(state, input) {
    if (!state.enabled) return null;
    input = input || {};
    state.counters.runtimeStatusRecalculations += 1;
    var previousPause = input.previousPersistedPauseState === undefined ? state.lastPersistedPauseState : input.previousPersistedPauseState;
    var nextPause = input.nextPersistedPauseState === undefined ? previousPause : input.nextPersistedPauseState;
    if (previousPause !== 'paused' && nextPause === 'paused') state.counters.persistedPauseStateWrites += 1;
    if (previousPause === 'paused' && nextPause !== 'paused') state.counters.pauseStateClears += 1;
    if (previousPause === 'paused' && nextPause !== 'paused' && input.verifiedResume !== true) {
      warning(state, 'pause-overwritten-without-resume', 'persisted pause was overwritten without verified resume evidence', {
        previousStatus: input.previousRuntimeStatus,
        nextStatus: input.nextRuntimeStatus,
        reason: input.reason,
        eventType: input.eventType
      }, input.timestamp);
    }
    state.lastPersistedPauseState = nextPause;
    state.lastRuntimeRecord = clone(Object.assign({}, input, {
      previousPersistedPauseState: previousPause,
      nextPersistedPauseState: nextPause
    }));
    return state.lastRuntimeRecord;
  }

  function recordRender(state, input) {
    if (!state.enabled) return null;
    input = input || {};
    state.counters.badgeRenders += 1;
    state.lastRenderRecord = clone(input);
    if (input.selectedStatus === 'live-socket' && input.actualBadgeText && input.actualBadgeText !== input.expectedBadgeText) {
      warning(state, 'stale-badge-render', 'runtime status is paused but the visible badge differs', input, input.timestamp);
    }
    if (input.runtimeStatusStoreInstanceId && input.runtimeStatusStoreInstanceId !== state.runtimeStatusStoreInstanceId) {
      warning(state, 'runtime-store-instance-mismatch', 'renderer read a different runtime-status store instance', input, input.timestamp);
    }
    if (input.hudRendererInstanceId && input.hudRendererInstanceId !== state.hudRendererInstanceId) {
      warning(state, 'renderer-instance-mismatch', 'status render used an unexpected HUD renderer instance', input, input.timestamp);
    }
    return state.lastRenderRecord;
  }

  function markCheckpoint(state, label, input, timestamp) {
    if (!state.enabled) return null;
    var entry = {
      checkpointId: 'pause-checkpoint-' + (state.checkpoints.length + 1),
      timestamp: Number(timestamp || Date.now()),
      label: String(label || 'checkpoint'),
      state: clone(input || {})
    };
    state.checkpoints.push(entry);
    if (state.checkpoints.length > MAX_CHECKPOINTS) state.checkpoints.shift();
    return entry;
  }

  function snapshot(state) {
    return clone(state);
  }

  var api = Object.freeze({
    createState: createState,
    setEnabled: setEnabled,
    setHookInstance: setHookInstance,
    recordFrame: recordFrame,
    completeFrame: completeFrame,
    recordRuntimeRecalculation: recordRuntimeRecalculation,
    recordRender: recordRender,
    markCheckpoint: markCheckpoint,
    warning: warning,
    snapshot: snapshot
  });
  root.PokerPauseLifecycleCapture = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
