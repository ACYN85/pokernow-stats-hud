/* One revision-keyed cache for every finalized Session-stat consumer. */
(function (root, factory) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerSessionStatsCache = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce(function (result, key) {
      if (value[key] !== undefined) result[key] = canonical(value[key]);
      return result;
    }, {});
  }
  function queryKey(query) { return JSON.stringify(canonical(query || {})); }
  function create(options) {
    options = options || {};
    return {
      revision: Math.max(0, Number(options.initialRevision || 0)),
      maxEntries: Math.max(1, Number(options.maxEntries || 256)),
      entries: new Map(), hits: 0, misses: 0, evictions: 0,
      computeDurationMs: 0, lastInvalidationReason: 'initialization', invalidations: []
    };
  }
  function recordInvalidation(state, reason) {
    state.invalidations.push({ revision: state.revision, reason: String(reason || 'authoritative finalized-session data changed') });
    if (state.invalidations.length > 25) state.invalidations.shift();
  }
  function advance(state, reason) {
    state.revision += 1;
    state.entries.clear();
    state.lastInvalidationReason = String(reason || 'authoritative finalized-session data changed');
    recordInvalidation(state, state.lastInvalidationReason);
    return state.revision;
  }
  function get(state, query, compute) {
    if (!state || !(state.entries instanceof Map)) throw new TypeError('A Session-stat cache created by create() is required');
    if (typeof compute !== 'function') throw new TypeError('Session-stat cache computation must be a function');
    var key = state.revision + '|' + queryKey(query);
    if (state.entries.has(key)) {
      var existing = state.entries.get(key);
      state.entries.delete(key);
      state.entries.set(key, existing);
      state.hits += 1;
      return existing;
    }
    var started = now();
    var value = compute();
    state.computeDurationMs += Math.max(0, now() - started);
    state.misses += 1;
    state.entries.set(key, value);
    while (state.entries.size > state.maxEntries) {
      state.entries.delete(state.entries.keys().next().value);
      state.evictions += 1;
    }
    return value;
  }
  function clear(state, reason) {
    state.entries.clear();
    state.lastInvalidationReason = String(reason || 'cache cleared without a finalized revision change');
  }
  function inspect(state) {
    return {
      revision: state.revision, size: state.entries.size, maxEntries: state.maxEntries,
      hits: state.hits, misses: state.misses, evictions: state.evictions,
      computeDurationMs: Math.round(state.computeDurationMs * 1000) / 1000,
      lastInvalidationReason: state.lastInvalidationReason,
      invalidations: state.invalidations.map(function (entry) { return Object.assign({}, entry); })
    };
  }
  return Object.freeze({ create: create, queryKey: queryKey, get: get, advance: advance, clear: clear, inspect: inspect });
});
