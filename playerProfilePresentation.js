/* Pure, deterministic shadow presentation policy for raw player profiles. */
(function (root) {
  'use strict';

  var SCHEMA_VERSION = 1;
  var UNKNOWN_ARCHETYPES = Object.freeze(['Unknown / Insufficient Sample', 'Unknown / Uncertain', 'Unknown / Unsupported']);
  var ARCHETYPES = Object.freeze(['Nit', 'TAG', 'LAG', 'Tight Passive', 'Loose Passive', 'Calling Station', 'Maniac']);
  var DEFAULT_POLICY = deepFreeze({
    minimumVisibleHands: 40,
    earlyMaximumHands: 79,
    earlyStandard: { minimumScore: 0.50, minimumMargin: 0.12, minimumConfidence: 0.60, updates: 3, hands: 4 },
    matureInitial: { updates: 3, hands: 4 },
    strongInitial: { minimumHands: 80, minimumScore: 0.60, minimumMargin: 0.18, minimumConfidence: 0.70 },
    lag: { minimumHands: 60, earlyMinimumScore: 0.58, earlyMinimumMargin: 0.16, earlyMinimumConfidence: 0.65, earlyUpdates: 4, earlyHands: 8, matureUpdates: 3, matureHands: 5 },
    maniac: { minimumHands: 100, updates: 5, hands: 10 },
    strongAggressive: { minimumScore: 0.70, minimumMargin: 0.25, minimumConfidence: 0.75 },
    replacement: { updates: 4, hands: 8 },
    earlyLagReplacement: { maximumHands: 119, updates: 5, hands: 10 },
    maniacReplacement: { updates: 5, hands: 12 },
    strongReplacement: { updates: 2, hands: 3 },
    unknownHold: { updates: 4, hands: 6, maximumHands: 12 },
    maximumCandidateHands: 20,
    maximumDisagreementHands: 20
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function finite(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function boundedString(value, maximum) {
    if (value === null || value === undefined) return null;
    return String(value).slice(0, maximum || 120);
  }

  function mergePolicy(overrides) {
    if (!overrides || typeof overrides !== 'object') return clone(DEFAULT_POLICY);
    var merged = clone(DEFAULT_POLICY);
    Object.keys(overrides).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(merged, key)) return;
      if (merged[key] && typeof merged[key] === 'object' && !Array.isArray(merged[key]) && overrides[key] && typeof overrides[key] === 'object') {
        Object.assign(merged[key], overrides[key]);
      } else if (Number.isFinite(Number(overrides[key]))) {
        merged[key] = Number(overrides[key]);
      }
    });
    return merged;
  }

  function rawSnapshot(rawProfile) {
    rawProfile = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
    var primary = rawProfile.primary && typeof rawProfile.primary === 'object' ? rawProfile.primary : rawProfile;
    var hands = finite(rawProfile.hands, finite(rawProfile.inputSummary && rawProfile.inputSummary.handsPlayed, finite(primary.hands, 0)));
    var archetype = boundedString(primary.archetype, 80) || 'Unknown / Unsupported';
    var status = boundedString(primary.classificationStatus, 80) || 'unsupported';
    var bestCandidate = boundedString(primary.bestCandidate, 80);
    var scores = primary.scores && typeof primary.scores === 'object' ? primary.scores : {};
    var rawScores = ARCHETYPES.reduce(function (result, name) {
      result[name] = Math.max(0, finite(scores[name], 0));
      return result;
    }, {});
    return {
      hands: Math.max(0, Math.floor(hands)),
      archetype: archetype,
      status: status,
      bestCandidate: bestCandidate,
      bestScore: finite(bestCandidate && scores[bestCandidate], finite(primary.bestScore, 0)),
      scores: rawScores,
      margin: finite(primary.scoreMargin, finite(primary.margin, 0)),
      confidence: finite(primary.confidence, 0)
    };
  }

  function baseState(raw) {
    return {
      version: SCHEMA_VERSION,
      visible: false,
      archetype: null,
      status: 'hidden_insufficient',
      reason: 'minimum_visible_hands_not_met',
      sinceHands: null,
      pendingCandidate: null,
      pendingSinceHands: null,
      pendingUpdates: 0,
      disagreementSinceHands: null,
      rawArchetype: raw.archetype,
      rawStatus: raw.status,
      rawHands: raw.hands,
      rawBestCandidate: raw.bestCandidate,
      rawBestScore: raw.bestScore,
      rawScores: clone(raw.scores),
      rawMargin: raw.margin,
      rawConfidence: raw.confidence,
      lastUpdatedHands: raw.hands
    };
  }

  function withRaw(state, raw) {
    state.rawArchetype = raw.archetype;
    state.rawStatus = raw.status;
    state.rawHands = raw.hands;
    state.rawBestCandidate = raw.bestCandidate;
    state.rawBestScore = raw.bestScore;
    state.rawScores = clone(raw.scores);
    state.rawMargin = raw.margin;
    state.rawConfidence = raw.confidence;
    state.lastUpdatedHands = raw.hands;
    return state;
  }

  function clearPending(state) {
    state.pendingCandidate = null;
    state.pendingSinceHands = null;
    state.pendingUpdates = 0;
    return state;
  }

  function advancePending(state, candidate, hands) {
    if (state.pendingCandidate === candidate) {
      state.pendingUpdates += 1;
    } else {
      state.pendingCandidate = candidate;
      state.pendingSinceHands = hands;
      state.pendingUpdates = 1;
    }
    return state;
  }

  function candidateDuration(state, hands) {
    return state.pendingSinceHands === null ? 0 : Math.max(0, hands - state.pendingSinceHands);
  }

  function strong(raw, policy) {
    return raw.hands >= policy.strongInitial.minimumHands && raw.bestScore >= policy.strongInitial.minimumScore &&
      raw.margin >= policy.strongInitial.minimumMargin && raw.confidence >= policy.strongInitial.minimumConfidence;
  }

  function strongAggressive(raw, policy) {
    return raw.hands >= policy.strongInitial.minimumHands && raw.bestScore >= policy.strongAggressive.minimumScore &&
      raw.margin >= policy.strongAggressive.minimumMargin && raw.confidence >= policy.strongAggressive.minimumConfidence;
  }

  function qualification(raw, policy) {
    if (raw.status !== 'supported' || UNKNOWN_ARCHETYPES.includes(raw.archetype)) return { qualified: false, reason: 'raw_profile_not_supported' };
    if (raw.hands < policy.minimumVisibleHands) return { qualified: false, reason: 'minimum_visible_hands_not_met' };
    if (raw.archetype === 'Maniac' && raw.hands < policy.maniac.minimumHands) return { qualified: false, reason: 'early_maniac_hidden' };
    if (raw.archetype === 'LAG' && raw.hands < policy.lag.minimumHands) return { qualified: false, reason: 'early_lag_hidden' };
    if (raw.hands <= policy.earlyMaximumHands) {
      var minimumScore = raw.archetype === 'LAG' ? policy.lag.earlyMinimumScore : policy.earlyStandard.minimumScore;
      var minimumMargin = raw.archetype === 'LAG' ? policy.lag.earlyMinimumMargin : policy.earlyStandard.minimumMargin;
      var minimumConfidence = raw.archetype === 'LAG' ? policy.lag.earlyMinimumConfidence : policy.earlyStandard.minimumConfidence;
      if (raw.bestScore < minimumScore || raw.margin < minimumMargin || raw.confidence < minimumConfidence) {
        return { qualified: false, reason: 'early_strength_requirements_not_met' };
      }
    }
    return { qualified: true, reason: 'raw_supported_and_presentation_eligible' };
  }

  function initialPersistence(raw, policy) {
    if (raw.archetype === 'Maniac') return { updates: policy.maniac.updates, hands: policy.maniac.hands };
    if (raw.archetype === 'LAG') return raw.hands <= policy.earlyMaximumHands
      ? { updates: policy.lag.earlyUpdates, hands: policy.lag.earlyHands }
      : { updates: policy.lag.matureUpdates, hands: policy.lag.matureHands };
    return raw.hands <= policy.earlyMaximumHands
      ? { updates: policy.earlyStandard.updates, hands: policy.earlyStandard.hands }
      : { updates: policy.matureInitial.updates, hands: policy.matureInitial.hands };
  }

  function replacementPersistence(raw, policy) {
    if (strongAggressive(raw, policy) || strong(raw, policy)) return clone(policy.strongReplacement);
    if (raw.archetype === 'Maniac') return { updates: policy.maniacReplacement.updates, hands: policy.maniacReplacement.hands };
    if (raw.archetype === 'LAG' && raw.hands <= policy.earlyLagReplacement.maximumHands) return { updates: policy.earlyLagReplacement.updates, hands: policy.earlyLagReplacement.hands };
    return { updates: policy.replacement.updates, hands: policy.replacement.hands };
  }

  function persistenceMet(state, hands, requirements, maximumHands) {
    var duration = candidateDuration(state, hands);
    return (state.pendingUpdates >= requirements.updates && duration >= requirements.hands) || duration >= maximumHands;
  }

  function reveal(state, raw, reason) {
    state.visible = true;
    state.archetype = raw.archetype;
    state.status = 'visible_stable';
    state.reason = reason;
    state.sinceHands = raw.hands;
    state.disagreementSinceHands = null;
    clearPending(state);
    return state;
  }

  function hide(state, raw, status, reason) {
    state.visible = false;
    state.archetype = null;
    state.status = status;
    state.reason = reason;
    state.sinceHands = null;
    state.disagreementSinceHands = null;
    clearPending(state);
    return withRaw(state, raw);
  }

  function resolveDisplayedProfile(rawProfile, previousDisplay, options) {
    var raw = rawSnapshot(rawProfile);
    var policy = mergePolicy(options && options.policy);
    var state = previousDisplay && previousDisplay.version === SCHEMA_VERSION ? clone(previousDisplay) : baseState(raw);
    withRaw(state, raw);

    if (raw.status === 'insufficient_sample' || raw.hands < policy.minimumVisibleHands) return hide(state, raw, 'hidden_insufficient', 'minimum_visible_hands_not_met');
    if (raw.status === 'unsupported') return hide(state, raw, 'hidden_unsupported', 'raw_profile_unsupported');

    if (!state.visible) {
      if (raw.status !== 'supported') return hide(state, raw, 'hidden_uncertain', 'raw_profile_ambiguous');
      var initialQualification = qualification(raw, policy);
      if (!initialQualification.qualified) return hide(state, raw, 'hidden_early_or_weak', initialQualification.reason);
      if ((raw.archetype === 'Maniac' && strongAggressive(raw, policy)) || (raw.archetype !== 'Maniac' && strong(raw, policy))) {
        return reveal(state, raw, 'strong_mature_initial_reveal');
      }
      advancePending(state, raw.archetype, raw.hands);
      var initialRequirements = initialPersistence(raw, policy);
      if (persistenceMet(state, raw.hands, initialRequirements, policy.maximumCandidateHands)) return reveal(state, raw, 'initial_candidate_persisted');
      state.status = 'pending_initial';
      state.reason = 'initial_candidate_requires_persistence';
      return state;
    }

    if (raw.status === 'supported' && raw.archetype === state.archetype) {
      state.status = 'visible_stable';
      state.reason = 'raw_profile_matches_display';
      state.disagreementSinceHands = null;
      clearPending(state);
      return state;
    }

    if (state.disagreementSinceHands === null) state.disagreementSinceHands = raw.hands;
    var disagreementDuration = Math.max(0, raw.hands - state.disagreementSinceHands);

    if (raw.status !== 'supported' || UNKNOWN_ARCHETYPES.includes(raw.archetype)) {
      advancePending(state, 'Unknown / Uncertain', raw.hands);
      var unknownDuration = candidateDuration(state, raw.hands);
      if ((state.pendingUpdates >= policy.unknownHold.updates && unknownDuration >= policy.unknownHold.hands) ||
          disagreementDuration >= policy.unknownHold.maximumHands) {
        return hide(state, raw, 'hidden_uncertain', 'sustained_raw_uncertainty');
      }
      state.status = 'visible_holding_uncertain';
      state.reason = 'temporary_raw_uncertainty_held';
      return state;
    }

    var replacementQualification = qualification(raw, policy);
    if (!replacementQualification.qualified) {
      if (disagreementDuration >= policy.maximumDisagreementHands) return hide(state, raw, 'hidden_uncertain', 'maximum_stale_disagreement_reached');
      clearPending(state);
      state.status = 'visible_holding_ineligible_candidate';
      state.reason = replacementQualification.reason;
      return state;
    }

    advancePending(state, raw.archetype, raw.hands);
    var replacementRequirements = replacementPersistence(raw, policy);
    if (persistenceMet(state, raw.hands, replacementRequirements, policy.maximumCandidateHands)) return reveal(state, raw, 'replacement_candidate_persisted');
    if (disagreementDuration >= policy.maximumDisagreementHands) return hide(state, raw, 'hidden_uncertain', 'maximum_stale_disagreement_reached');
    state.status = 'visible_pending_replacement';
    state.reason = 'replacement_candidate_requires_persistence';
    return state;
  }

  function replay(rawProfiles, initialDisplay, options) {
    var state = initialDisplay || null;
    return (rawProfiles || []).map(function (rawProfile) {
      state = resolveDisplayedProfile(rawProfile, state, options);
      return clone(state);
    });
  }

  var api = Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_POLICY: DEFAULT_POLICY,
    rawSnapshot: rawSnapshot,
    // Historical snapshots share qualification gates, but have no temporal holds.
    resolveSnapshotProfile: function (rawProfile) {
      var raw = rawSnapshot(rawProfile); var state = baseState(raw);
      var eligible = qualification(raw, DEFAULT_POLICY);
      return eligible.qualified ? reveal(state, raw, 'qualified_historical_snapshot')
        : hide(state, raw, 'hidden_snapshot', eligible.reason);
    },
    resolveDisplayedProfile: resolveDisplayedProfile,
    replay: replay
  });

  root.PokerPlayerProfilePresentation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
