/* Revision-aware Session persistence planning and invalidation classification. */
(function (root, factory) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerSessionRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var INVALIDATION = Object.freeze({
    finalizedStats: Object.freeze({ leaderboard: true, seatStats: true, dashboardSession: true, geometry: false, style: false }),
    liveUi: Object.freeze({ leaderboard: false, seatStats: false, dashboardSession: false, geometry: false, style: false }),
    seatGeometry: Object.freeze({ leaderboard: false, seatStats: false, dashboardSession: false, geometry: true, style: false }),
    settingsStyle: Object.freeze({ leaderboard: false, seatStats: false, dashboardSession: false, geometry: false, style: true }),
    none: Object.freeze({ leaderboard: false, seatStats: false, dashboardSession: false, geometry: false, style: false })
  });

  function invalidationFor(category) { return INVALIDATION[category] || INVALIDATION.none; }
  function createPersistencePlanner(options) {
    options = options || {};
    var initial = Math.max(0, Number(options.initialFinalizedRevision || 0));
    var persisted = Math.max(0, Number(options.persistedFinalizedRevision === undefined ? initial : options.persistedFinalizedRevision));
    return {
      queuedFinalizedRevision: persisted,
      persistedFinalizedRevision: persisted,
      plans: 0, finalizedPlans: 0, recoveryOnlyPlans: 0, completed: 0, failures: 0,
      recent: []
    };
  }
  function record(state, entry) { state.recent.push(entry); if (state.recent.length > 30) state.recent.shift(); }
  function planPersistence(state, request) {
    request = request || {};
    var revision = Math.max(0, Number(request.finalizedRevision || 0));
    var includesFinalized = request.forceFinalized === true || revision > state.queuedFinalizedRevision;
    var payload = Object.assign({}, includesFinalized ? request.finalized || {} : {}, request.recovery || {});
    state.plans += 1;
    if (includesFinalized) {
      state.finalizedPlans += 1;
      state.queuedFinalizedRevision = revision;
    } else state.recoveryOnlyPlans += 1;
    var plan = { payload: payload, finalizedRevision: revision, includesFinalized: includesFinalized, reason: String(request.reason || 'unspecified') };
    record(state, { type: 'planned', finalizedRevision: revision, includesFinalized: includesFinalized, reason: plan.reason });
    return plan;
  }
  function completePersistence(state, plan, error) {
    if (!plan) return;
    if (error) {
      state.failures += 1;
      if (plan.includesFinalized && state.queuedFinalizedRevision === plan.finalizedRevision) state.queuedFinalizedRevision = state.persistedFinalizedRevision;
      record(state, { type: 'failed', finalizedRevision: plan.finalizedRevision, includesFinalized: plan.includesFinalized, error: String(error.message || error) });
      return;
    }
    state.completed += 1;
    if (plan.includesFinalized) state.persistedFinalizedRevision = Math.max(state.persistedFinalizedRevision, plan.finalizedRevision);
    record(state, { type: 'completed', finalizedRevision: plan.finalizedRevision, includesFinalized: plan.includesFinalized });
  }
  function observePersistedRevision(state, revision) {
    revision = Math.max(0, Number(revision || 0));
    state.persistedFinalizedRevision = Math.max(state.persistedFinalizedRevision, revision);
    state.queuedFinalizedRevision = Math.max(state.queuedFinalizedRevision, revision);
  }
  function inspectPersistence(state) {
    return {
      queuedFinalizedRevision: state.queuedFinalizedRevision,
      persistedFinalizedRevision: state.persistedFinalizedRevision,
      plans: state.plans, finalizedPlans: state.finalizedPlans, recoveryOnlyPlans: state.recoveryOnlyPlans,
      completed: state.completed, failures: state.failures,
      recent: state.recent.map(function (entry) { return Object.assign({}, entry); })
    };
  }
  return Object.freeze({ INVALIDATION: INVALIDATION, invalidationFor: invalidationFor, createPersistencePlanner: createPersistencePlanner, planPersistence: planPersistence, completePersistence: completePersistence, observePersistedRevision: observePersistedRevision, inspectPersistence: inspectPersistence });
});
