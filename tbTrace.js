/* End-to-end tracing helpers for PokerNow's player-keyed tB action field. */
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

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function findTbMaps(payload) {
    var found = [];
    function visit(value, path, depth) {
      if (!value || typeof value !== 'object' || depth > 9) return;
      if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'tB') && value.tB && typeof value.tB === 'object' && !Array.isArray(value.tB)) {
        found.push({ path: path + '.tB', value: clone(value.tB) });
      }
      if (Array.isArray(value)) value.forEach(function (item, index) { visit(item, path + '[' + index + ']', depth + 1); });
      else Object.keys(value).forEach(function (key) { visit(value[key], path + '.' + key, depth + 1); });
    }
    visit(payload, '$', 0);
    return found;
  }

  function preferredTb(payload) {
    var maps = findTbMaps(payload);
    maps.sort(function (left, right) {
      if (left.path === '$.tB') return -1;
      if (right.path === '$.tB') return 1;
      return Object.keys(right.value).length - Object.keys(left.value).length;
    });
    return maps[0] || null;
  }

  function valueType(value) {
    if (value === undefined) return 'missing';
    if (value === null) return 'null';
    return typeof value;
  }

  function mapTransitions(previousValues, currentValues, initialized) {
    var transitions = [];
    Object.keys(currentValues || {}).forEach(function (playerId) {
      var previous = previousValues[playerId];
      var current = currentValues[playerId];
      if (initialized && !Object.is(previous, current)) transitions.push({ playerId: String(playerId), previous: previous, current: current, previousType: valueType(previous), currentType: valueType(current) });
    });
    return transitions;
  }

  function mergeSnapshot(previous, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return clone(patch);
    var merged = previous && typeof previous === 'object' && !Array.isArray(previous) ? clone(previous) : {};
    Object.keys(patch).forEach(function (key) {
      var value = patch[key];
      if (value && typeof value === 'object' && !Array.isArray(value) && merged[key] && typeof merged[key] === 'object' && !Array.isArray(merged[key])) merged[key] = mergeSnapshot(merged[key], value);
      else merged[key] = clone(value);
    });
    return merged;
  }

  function createState() {
    return { rawValues: {}, rawInitialized: false, normalizedValues: {}, normalizedInitialized: false, rawTransitions: 0, normalizedTransitions: 0, voluntaryGates: 0, records: [] };
  }

  function traceRaw(state, eventName, payload, metadata) {
    var maps = findTbMaps(payload);
    var selected = preferredTb(payload);
    var transitions = selected ? mapTransitions(state.rawValues, selected.value, state.rawInitialized) : [];
    if (selected) {
      state.rawValues = mergeSnapshot(state.rawValues, selected.value);
      state.rawInitialized = true;
      state.rawTransitions += transitions.length;
    }
    var record = { stage: 'raw', eventName: eventName, metadata: metadata || null, tBExists: Boolean(selected), exactRawPath: selected && selected.path, rawMaps: maps, rawPerPlayer: selected && selected.value, transitions: transitions };
    state.records.push(record);
    return record;
  }

  function traceMerge(state, previousSnapshot, patch, mergedSnapshot, metadata) {
    var before = preferredTb(previousSnapshot);
    var patchTb = preferredTb(patch);
    var merged = preferredTb(mergedSnapshot);
    var record = { stage: 'merged', metadata: metadata || null, beforeMerge: before && before.value, beforePath: before && before.path, patchTb: patchTb && patchTb.value, patchPath: patchTb && patchTb.path, mergedTb: merged && merged.value, mergedPath: merged && merged.path, patchMissingTbPreserved: !patchTb && Boolean(before) && JSON.stringify(before.value) === JSON.stringify(merged && merged.value) };
    state.records.push(record);
    return record;
  }

  function traceNormalized(state, normalized, metadata) {
    var current = normalized && normalized.tB ? normalized.tB : {};
    var previous = clone(state.normalizedValues);
    var wasInitialized = state.normalizedInitialized;
    var transitions = normalized ? mapTransitions(previous, current, wasInitialized) : [];
    if (normalized) {
      state.normalizedValues = clone(current);
      state.normalizedInitialized = true;
      state.normalizedTransitions += transitions.length;
    }
    var record = { stage: 'normalized', metadata: metadata || null, previousNormalizedTb: previous, normalizedTb: clone(current), transitions: transitions };
    state.records.push(record);
    return record;
  }

  function recordGates(state, gates, metadata) {
    var voluntary = (gates || []).filter(function (gate) { return gate.voluntaryTransition; });
    state.voluntaryGates += voluntary.length;
    var record = { stage: 'candidate-gate', metadata: metadata || null, gates: clone(gates || []), voluntaryTransitionsGated: voluntary.length };
    state.records.push(record);
    if (state.records.length > 1000) state.records.splice(0, state.records.length - 1000);
    return record;
  }

  function decodeSocketIoEventFrame(rawFrame) {
    var raw = String(rawFrame || '');
    var arrayStart = raw.indexOf('[');
    if (arrayStart < 0) return null;
    var decoded = JSON.parse(raw.slice(arrayStart));
    if (!Array.isArray(decoded) || typeof decoded[0] !== 'string') return null;
    return { eventName: decoded[0], payload: decoded[1] };
  }

  var api = { createState: createState, findTbMaps: findTbMaps, preferredTb: preferredTb, mergeSnapshot: mergeSnapshot, traceRaw: traceRaw, traceMerge: traceMerge, traceNormalized: traceNormalized, recordGates: recordGates, decodeSocketIoEventFrame: decodeSocketIoEventFrame };
  root.PokerTbTrace = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
