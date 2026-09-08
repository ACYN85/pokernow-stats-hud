/* PokerNow lifecycle normalization and bounded raw-patch discovery. */
(function (root) {
  'use strict';

  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return String(value); }
  }

  function rootStatus(value) {
    if (!value || typeof value !== 'object') return null;
    if (typeof value.status === 'string') return { path: '$.status', value: value.status };
    if (value.gameState && typeof value.gameState.status === 'string') return { path: '$.gameState.status', value: value.gameState.status };
    return null;
  }

  function statusClassification(status) {
    var normalized = String(status || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (/^(?:waiting|waitingtostart|waitingforplayer)$/.test(normalized)) return 'waiting';
    if (normalized === 'paused') return 'paused';
    if (/^(?:stopped|closed|ended)$/.test(normalized)) return 'stopped';
    if (/^(?:broken|inactive|notenoughplayers)$/.test(normalized)) return 'broken';
    if (/^(?:inprogress|active|running|playing)$/.test(normalized)) return 'active';
    return 'unknown';
  }

  var CONTROL_FIELD = /^(?:command|action|type|method|name|operation|op|subtype|mode|state|status|message|text|reason|notice)$/i;
  var PAUSE_COMMAND = /^(?:pause|paused|pausegame|gamepause)$/;
  var RESUME_COMMAND = /^(?:resume|resumed|resumegame|gameresume|continue|unpause)$/;
  var PAUSE_NOTICE = /\b(?:room\s+owner|host|game)\s+(?:has\s+)?paused\s+(?:the\s+)?game\b/i;
  var RESUME_NOTICE = /\b(?:room\s+owner|host|game)\s+(?:has\s+)?(?:resumed|continued|unpaused)\s+(?:the\s+)?game\b/i;

  function authoritativeControl(eventName, payload, direction) {
    if (String(direction || '').toLowerCase() !== 'incoming' || !payload || typeof payload !== 'object') return null;
    var evidence = [];
    function visit(value, path, depth) {
      if (depth > 6 || evidence.length >= 40 || value === null || value === undefined) return;
      if (Array.isArray(value)) {
        value.slice(0, 20).forEach(function (item, index) { visit(item, path + '[' + index + ']', depth + 1); });
        return;
      }
      if (typeof value === 'object') {
        Object.keys(value).slice(0, 40).forEach(function (key) {
          visit(value[key], path + '.' + key, depth + 1);
        });
        return;
      }
      var key = String(path).replace(/\[\d+\]$/g, '').split('.').pop();
      if (!CONTROL_FIELD.test(key) || typeof value !== 'string') return;
      var text = value.trim();
      var normalized = text.toLowerCase().replace(/[\s_-]+/g, '');
      var classification = PAUSE_COMMAND.test(normalized) || PAUSE_NOTICE.test(text)
        ? 'paused'
        : (RESUME_COMMAND.test(normalized) || RESUME_NOTICE.test(text) ? 'resumed' : null);
      if (classification) evidence.push({ path: path, value: text.slice(0, 160), classification: classification });
    }
    visit(payload, '$', 0);
    var classifications = Array.from(new Set(evidence.map(function (item) { return item.classification; })));
    if (classifications.length !== 1) return null;
    return {
      classification: classifications[0],
      confidence: 'authoritative',
      eventName: String(eventName || ''),
      direction: 'incoming',
      evidencePaths: evidence.map(function (item) { return item.path; }),
      currentPatchEvidence: clone(evidence),
      reason: 'incoming PokerNow Socket.IO lifecycle control explicitly reported ' + classifications[0]
    };
  }

  function authoritativeContribution(eventName, payload) {
    if (!/^gc$/i.test(String(eventName || '')) || !payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return {
      patch: payload,
      path: '$',
      score: 100,
      reason: 'PokerNow mixed-case gC authoritative game-state patch'
    };
  }

  function normalize(input) {
    input = input || {};
    var patchStatus = rootStatus(input.currentPatch);
    var mergedStatus = rootStatus(input.mergedState);
    var selected = patchStatus || mergedStatus;
    var classification = selected ? statusClassification(selected.value) : 'unknown';
    var confidence = patchStatus && classification !== 'active' ? 'authoritative' : (selected ? 'corroborated' : 'insufficient');
    var reason = selected
      ? (patchStatus ? 'current PokerNow gC status patch' : 'cached PokerNow game-state status') + ' is "' + selected.value + '"' +
        (classification === 'active' ? '; inProgress alone is not authoritative resume evidence' : '')
      : 'no recognized PokerNow lifecycle status is present';
    if (Number(input.eligiblePlayerCount) < 2 && Number(input.occupiedPlayerCount) >= 1) {
      classification = 'broken';
      confidence = patchStatus ? 'authoritative' : 'corroborated';
      reason = 'fewer than two eligible in-game players';
    }
    return {
      classification: classification,
      confidence: confidence,
      evidencePaths: selected ? [selected.path] : [],
      currentPatchEvidence: patchStatus ? [clone(patchStatus)] : [],
      mergedStateEvidence: mergedStatus ? [clone(mergedStatus)] : [],
      reason: reason,
      rawStatus: selected && selected.value || null
    };
  }

  function createTraceState() {
    return {
      recentPatches: [],
      recentEventNames: [],
      lastPauseCandidateAt: null,
      lastResumeCandidateAt: null,
      unrecognizedLifecycleCandidates: [],
      lifecycleOnlyPatchesAccepted: 0,
      lifecycleOnlyPatchesRejected: 0
    };
  }

  function flatten(value, path, output, depth) {
    if (output.length >= 160 || depth > 8) return;
    if (value === null || typeof value !== 'object') {
      output.push({ path: path || '$', value: clone(value), valueType: value === null ? 'null' : typeof value });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(function (item, index) { flatten(item, (path || '$') + '[' + index + ']', output, depth + 1); });
      return;
    }
    Object.keys(value).forEach(function (key) { flatten(value[key], (path || '$') + '.' + key, output, depth + 1); });
  }

  function valueAtPath(value, path) {
    if (!value || path === '$') return value;
    var tokens = String(path).replace(/^\$\./, '').replace(/\[(\d+)\]/g, '.$1').split('.');
    var current = value;
    for (var index = 0; index < tokens.length; index += 1) {
      if (current === null || current === undefined) return undefined;
      current = current[tokens[index]];
    }
    return current;
  }

  function recordEventName(state, input) {
    state.recentEventNames.push({
      frameId: input.frameId || null,
      timestamp: Number(input.timestamp || Date.now()),
      direction: input.direction || null,
      eventName: input.eventName || null
    });
    if (state.recentEventNames.length > 30) state.recentEventNames.shift();
  }

  function recordPatch(state, input) {
    input = input || {};
    recordEventName(state, input);
    var rawPatch = input.contribution && input.contribution.patch || input.payload || {};
    var leaves = [];
    flatten(rawPatch, '$', leaves, 0);
    var changed = leaves.map(function (leaf) {
      var previous = valueAtPath(input.previousMergedState, leaf.path);
      return {
        path: leaf.path,
        previousRawValue: clone(previous),
        currentRawValue: clone(leaf.value),
        existsDirectlyInCurrentPatch: true,
        existsOnlyInMergedCachedState: false,
        valueType: leaf.valueType,
        normalizedInterpretation: /\.status$/i.test(leaf.path) ? statusClassification(leaf.value) : null
      };
    }).filter(function (item) { return !Object.is(item.previousRawValue, item.currentRawValue); });
    var signal = normalize({
      currentPatch: rawPatch,
      mergedState: input.previousMergedState,
      eligiblePlayerCount: input.eligiblePlayerCount,
      occupiedPlayerCount: input.occupiedPlayerCount
    });
    var record = {
      frameId: input.frameId || null,
      eventName: input.eventName || null,
      timestamp: Number(input.timestamp || Date.now()),
      contributionPath: input.contribution && input.contribution.path || null,
      contributionAccepted: Boolean(input.contribution),
      changedRawPaths: changed,
      currentPatchLifecycleCandidates: signal.currentPatchEvidence,
      mergedLifecycleCandidates: signal.mergedStateEvidence,
      classificationBefore: input.classificationBefore || null,
      classificationAfter: null,
      statusBefore: input.statusBefore || null,
      statusAfter: null,
      normalizedSignal: signal
    };
    if (!input.contribution && /^gc$/i.test(String(input.eventName || ''))) state.lifecycleOnlyPatchesRejected += 1;
    if (signal.classification === 'paused' || signal.classification === 'stopped' || signal.classification === 'broken') state.lastPauseCandidateAt = record.timestamp;
    if (signal.classification === 'active') state.lastResumeCandidateAt = record.timestamp;
    var unknown = changed.filter(function (item) {
      return item.normalizedInterpretation === null && !/(?:^|\.)(?:now|pre|sN|uP|mEV|fv)$/i.test(item.path);
    }).slice(0, 30);
    if (unknown.length) {
      state.unrecognizedLifecycleCandidates.push({ frameId: record.frameId, eventName: record.eventName, timestamp: record.timestamp, fields: unknown });
      if (state.unrecognizedLifecycleCandidates.length > 30) state.unrecognizedLifecycleCandidates.shift();
    }
    state.recentPatches.push(record);
    if (state.recentPatches.length > 30) state.recentPatches.shift();
    return record;
  }

  function completePatch(state, record, input) {
    if (!record) return null;
    input = input || {};
    record.classificationAfter = input.classificationAfter || record.classificationBefore;
    record.statusAfter = input.statusAfter || record.statusBefore;
    if (input.normalizedSignal) {
      record.normalizedSignal = clone(input.normalizedSignal);
      record.currentPatchLifecycleCandidates = clone(input.normalizedSignal.currentPatchEvidence || []);
      record.mergedLifecycleCandidates = clone(input.normalizedSignal.mergedStateEvidence || []);
    }
    if (record.contributionAccepted && input.lifecycleOnly === true) state.lifecycleOnlyPatchesAccepted += 1;
    return record;
  }

  function snapshot(state) {
    return clone(state);
  }

  var api = Object.freeze({
    authoritativeContribution: authoritativeContribution,
    authoritativeControl: authoritativeControl,
    normalize: normalize,
    createTraceState: createTraceState,
    recordEventName: recordEventName,
    recordPatch: recordPatch,
    completePatch: completePatch,
    snapshot: snapshot
  });
  root.PokerNowLifecycleSignal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
