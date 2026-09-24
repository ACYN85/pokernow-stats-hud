/* Pure sample-support policy for displayed player statistics. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerStatEvidence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LEVELS = Object.freeze({ unavailable: -1, insufficient: 0, weak: 1, moderate: 2, strong: 3 });
  var LABELS = Object.freeze({ unavailable: 'Unavailable', insufficient: 'Insufficient', weak: 'Weak', moderate: 'Moderate', strong: 'Strong' });
  var HAND_THRESHOLDS = Object.freeze({ weak: 20, moderate: 50, strong: 100 });
  var CONDITIONAL_THRESHOLDS = Object.freeze({ weak: 5, moderate: 15, strong: 40 });
  var AF_THRESHOLDS = Object.freeze({ weak: 10, moderate: 30, strong: 75 });
  var POLICIES = Object.freeze({
    hands: Object.freeze({ supportType: 'finalized_hands', thresholds: HAND_THRESHOLDS, singular: 'finalized hand', plural: 'finalized hands', compactSingular: 'hand', compactPlural: 'hands', empty: 'No finalized hands' }),
    vpip: Object.freeze({ supportType: 'qualified_preflop_opportunities', thresholds: HAND_THRESHOLDS, singular: 'qualified preflop opportunity', plural: 'qualified preflop opportunities', compactSingular: 'opp', compactPlural: 'opps', empty: 'No opportunities' }),
    pfr: Object.freeze({ supportType: 'qualified_preflop_opportunities', thresholds: HAND_THRESHOLDS, singular: 'qualified preflop opportunity', plural: 'qualified preflop opportunities', compactSingular: 'opp', compactPlural: 'opps', empty: 'No opportunities' }),
    af: Object.freeze({ supportType: 'observed_postflop_aggression_actions', thresholds: AF_THRESHOLDS, singular: 'observed postflop aggressive action or call', plural: 'observed postflop aggressive actions and calls', compactSingular: 'action', compactPlural: 'actions', empty: 'No qualifying actions' }),
    threeBet: Object.freeze({ supportType: 'three_bet_opportunities', thresholds: CONDITIONAL_THRESHOLDS, singular: 'qualifying 3-bet opportunity', plural: 'qualifying 3-bet opportunities', compactSingular: 'opp', compactPlural: 'opps', empty: 'No opportunities' }),
    foldToThreeBet: Object.freeze({ supportType: 'fold_to_three_bet_opportunities', thresholds: CONDITIONAL_THRESHOLDS, singular: 'qualifying response to a 3-bet', plural: 'qualifying responses to a 3-bet', compactSingular: 'opp', compactPlural: 'opps', empty: 'No opportunities' }),
    flopCBet: Object.freeze({ supportType: 'flop_cbet_opportunities', thresholds: CONDITIONAL_THRESHOLDS, singular: 'qualifying flop c-bet opportunity', plural: 'qualifying flop c-bet opportunities', compactSingular: 'opp', compactPlural: 'opps', empty: 'No opportunities' }),
    foldToFlopCBet: Object.freeze({ supportType: 'fold_to_flop_cbet_opportunities', thresholds: CONDITIONAL_THRESHOLDS, singular: 'qualifying response to a flop c-bet', plural: 'qualifying responses to a flop c-bet', compactSingular: 'opp', compactPlural: 'opps', empty: 'No opportunities' }),
    wtsd: Object.freeze({ supportType: 'supported_saw_flop_population', thresholds: CONDITIONAL_THRESHOLDS, singular: 'supported saw-flop decision', plural: 'supported saw-flop decisions', compactSingular: 'opp', compactPlural: 'opps', empty: 'No opportunities' }),
    wsd: Object.freeze({ supportType: 'supported_showdowns', thresholds: CONDITIONAL_THRESHOLDS, singular: 'supported showdown', plural: 'supported showdowns', compactSingular: 'showdown', compactPlural: 'showdowns', empty: 'No showdowns' })
  });

  function nonnegativeInteger(value) { return Number.isSafeInteger(value) && value >= 0; }
  function cloneContext(value) {
    if (!value || typeof value !== 'object') return null;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
  }
  function thresholdCopy(policy) { return { weak: policy.thresholds.weak, moderate: policy.thresholds.moderate, strong: policy.thresholds.strong }; }
  function unavailable(statKey, input, policy, reason) {
    return Object.freeze({
      statKey: statKey, status: 'unavailable', label: LABELS.unavailable, level: LEVELS.unavailable,
      supportCount: null, supportType: policy ? policy.supportType : 'unsupported', supportText: 'Support unavailable', compactSupportText: 'Unavailable',
      reason: reason, explanation: 'Evidence unavailable because exact support metadata is not available for this statistic.',
      thresholds: policy ? Object.freeze(thresholdCopy(policy)) : null, nextStatus: null, nextMinimum: null, remainingToNext: null,
      source: input && input.source || null, context: cloneContext(input && input.context)
    });
  }
  function supportCount(statKey, input) {
    if (statKey === 'hands') return nonnegativeInteger(input.hands) ? input.hands : null;
    if (statKey === 'af') {
      if (!nonnegativeInteger(input.aggressiveActions) || !nonnegativeInteger(input.calls)) return null;
      return input.aggressiveActions + input.calls;
    }
    var opportunities = input.opportunities === undefined ? input.denominator : input.opportunities;
    if (!nonnegativeInteger(input.numerator) || !nonnegativeInteger(opportunities) || input.numerator > opportunities) return null;
    return opportunities;
  }
  function statusFor(count, thresholds) {
    if (count >= thresholds.strong) return 'strong';
    if (count >= thresholds.moderate) return 'moderate';
    if (count >= thresholds.weak) return 'weak';
    return 'insufficient';
  }
  function nextThreshold(status, thresholds) {
    if (status === 'insufficient') return { status: 'weak', minimum: thresholds.weak };
    if (status === 'weak') return { status: 'moderate', minimum: thresholds.moderate };
    if (status === 'moderate') return { status: 'strong', minimum: thresholds.strong };
    return { status: null, minimum: null };
  }
  function evaluateStatEvidence(input) {
    input = input && typeof input === 'object' ? input : {};
    var statKey = String(input.statKey || '');
    var policy = POLICIES[statKey];
    if (!policy) return unavailable(statKey, input, null, 'unsupported_stat');
    if (input.available === false) return unavailable(statKey, input, policy, 'support_metadata_unavailable');
    var count = supportCount(statKey, input);
    if (count === null) return unavailable(statKey, input, policy, 'invalid_or_incomplete_support_metadata');
    var status = statusFor(count, policy.thresholds);
    var supportText = count === 0 ? policy.empty : count + ' ' + (count === 1 ? policy.singular : policy.plural);
    var compactSupportText = count === 0 ? policy.empty : count + ' ' + (count === 1 ? policy.compactSingular : policy.compactPlural);
    var next = nextThreshold(status, policy.thresholds);
    var thresholdText = next.minimum === null ? 'This meets the Strong sample-support threshold.' : (next.minimum - count) + ' more ' + (next.minimum - count === 1 ? policy.singular : policy.plural) + ' to reach ' + LABELS[next.status] + '.';
    var explanation = status === 'insufficient'
      ? supportText + '. More observations are needed before an evidence-strength label is shown. Evidence reflects sample support, not probability or proof that a tendency is real.'
      : LABELS[status] + ' evidence · ' + supportText + '. ' + thresholdText + ' Evidence labels describe sample support, not probability or proof that a tendency is real.';
    return Object.freeze({
      statKey: statKey, status: status, label: LABELS[status], level: LEVELS[status], supportCount: count,
      supportType: policy.supportType, supportText: supportText, compactSupportText: compactSupportText,
      reason: count === 0 ? 'no_qualifying_support' : 'sample_support_threshold', explanation: explanation,
      thresholds: Object.freeze(thresholdCopy(policy)), nextStatus: next.status, nextMinimum: next.minimum,
      remainingToNext: next.minimum === null ? null : Math.max(0, next.minimum - count),
      source: input.source || null, context: cloneContext(input.context)
    });
  }
  function meets(evidence, minimum) {
    var required = LEVELS[String(minimum || '')];
    return Boolean(evidence && Number.isInteger(required) && required >= 0 && Number(evidence.level) >= required);
  }

  return Object.freeze({ LEVELS: LEVELS, LABELS: LABELS, POLICIES: POLICIES, evaluateStatEvidence: evaluateStatEvidence, meets: meets });
});
