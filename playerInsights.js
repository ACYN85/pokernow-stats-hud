/* Pure, query-free observations from the Dashboard's exact displayed stat cards. */
(function (root, factory) {
  'use strict';
  var evidence = root.PokerStatEvidence;
  if (typeof module !== 'undefined' && module.exports) evidence = require('./statEvidence.js');
  var api = factory(evidence);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPlayerInsights = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Evidence) {
  'use strict';

  // Product heuristics on raw observed rates, not Profile's stabilized features.
  // Conditional cutoffs align with established Profile tag boundaries; the
  // VPIP/PFR observations use wider, conservative descriptive bands.
  var SIX_PLUS_THRESHOLDS = Object.freeze({
    vpip: Object.freeze({ low: 0.22, high: 0.38 }),
    vpipPfrGap: Object.freeze({ high: 0.15, close: 0.06, closeMinimumVpip: 0.25 }),
    threeBet: Object.freeze({ low: 0.055, high: 0.12 }),
    foldToThreeBet: Object.freeze({ low: 0.38, high: 0.62 }),
    flopCBet: Object.freeze({ low: 0.42, high: 0.65 }),
    foldToFlopCBet: Object.freeze({ low: 0.34, high: 0.58 }),
    wtsd: Object.freeze({ low: 0.22, high: 0.34 })
  });
  // Conservative descriptive product bands, with neutral space in every family.
  var THRESHOLD_SETS = Object.freeze({
    HU: Object.freeze({
      vpip: Object.freeze({ low: 0.35, high: 0.70 }),
      vpipPfrGap: Object.freeze({ high: 0.22, close: 0.08, closeMinimumVpip: 0.45 }),
      threeBet: Object.freeze({ low: 0.08, high: 0.22 }),
      foldToThreeBet: Object.freeze({ low: 0.30, high: 0.72 }),
      flopCBet: Object.freeze({ low: 0.38, high: 0.75 }),
      foldToFlopCBet: Object.freeze({ low: 0.28, high: 0.65 }),
      wtsd: Object.freeze({ low: 0.25, high: 0.44 })
    }),
    '3_TO_5': Object.freeze({
      vpip: Object.freeze({ low: 0.25, high: 0.48 }),
      vpipPfrGap: Object.freeze({ high: 0.18, close: 0.07, closeMinimumVpip: 0.30 }),
      threeBet: Object.freeze({ low: 0.065, high: 0.16 }),
      foldToThreeBet: Object.freeze({ low: 0.34, high: 0.67 }),
      flopCBet: Object.freeze({ low: 0.40, high: 0.70 }),
      foldToFlopCBet: Object.freeze({ low: 0.31, high: 0.61 }),
      wtsd: Object.freeze({ low: 0.23, high: 0.38 })
    }),
    SIX_PLUS: SIX_PLUS_THRESHOLDS
  });
  var THRESHOLDS = SIX_PLUS_THRESHOLDS;
  function thresholdsFor(bucket) { return THRESHOLD_SETS[bucket] || null; }
  // Classifier table-context compatibility is separate from raw-rate Insight bands.
  var PROFILE_TABLE_CONTEXT = Object.freeze({
    HU: Object.freeze({ minimumSupportedSize: 2, referenceSize: 9,
      maximumShiftAtMinimumSize: Object.freeze({ vpipRate: 0.30, pfrRate: 0.25, vpipPfrGap: 0.05, threeBetRate: 0.12 }) })
  });
  function profileTableContextFor(bucket) { return PROFILE_TABLE_CONTEXT[bucket] || null; }
  var ORDER = Object.freeze(['vpipPfr', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd']);
  var RULES = Object.freeze({
    threeBet: Object.freeze({ low: '3-bets infrequently', high: '3-bets frequently' }),
    foldToThreeBet: Object.freeze({ low: 'Folds to 3-bets infrequently', high: 'Folds to 3-bets often' }),
    flopCBet: Object.freeze({ low: 'Continuation-bets infrequently', high: 'Continuation-bets frequently' }),
    foldToFlopCBet: Object.freeze({ low: 'Folds to continuation bets infrequently', high: 'Folds to continuation bets often' }),
    wtsd: Object.freeze({ low: 'Reaches showdown infrequently', high: 'Reaches showdown often' })
  });
  function exact(value) { return Number.isSafeInteger(value) && value >= 0; }
  function copyContext(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
  }
  function sameContext(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
  function support(card, source, context) {
    if (!card || !card.evidence || !exact(card.numerator) || !exact(card.denominator) || card.denominator === 0 || card.numerator > card.denominator) return null;
    var proof = card.evidence;
    if (proof.statKey !== card.id || proof.source !== source || !sameContext(proof.context, context) || proof.supportCount !== card.denominator ||
      proof.level !== Evidence.LEVELS[proof.status] || proof.label !== Evidence.LABELS[proof.status] || !Evidence.meets(proof, 'moderate')) return null;
    return Object.freeze({ statKey: card.id, numerator: card.numerator, denominator: card.denominator,
      rate: card.numerator / card.denominator, supportCount: proof.supportCount, supportType: proof.supportType,
      evidenceLevel: proof.level, evidenceStatus: proof.status, evidenceLabel: proof.label });
  }
  function make(id, family, direction, title, stats, source, context) {
    return Object.freeze({ id: id, family: family, direction: direction, title: title, stats: Object.freeze(stats),
      evidenceLevel: Math.min.apply(null, stats.map(function (item) { return item.evidenceLevel; })),
      evidenceLabel: stats.some(function (item) { return item.evidenceLevel === Evidence.LEVELS.moderate; }) ? 'Moderate' : 'Strong',
      source: source, context: copyContext(context) });
  }
  function direction(rate, boundaries) { return rate <= boundaries.low ? 'low' : rate >= boundaries.high ? 'high' : null; }
  function derive(input) {
    input = input && typeof input === 'object' ? input : {};
    var source = input.source;
    var context = copyContext(input.context);
    if ((source !== 'session' && source !== 'career') || !context || !Array.isArray(input.cards) || input.tableSizeSupported !== true) return [];
    var thresholds = thresholdsFor(input.tableSize || context.tableSize || 'SIX_PLUS');
    if (!thresholds) return [];
    var byId = Object.create(null);
    input.cards.forEach(function (card) {
      if (!card || typeof card.id !== 'string' || byId[card.id]) return;
      var item = support(card, source, context);
      if (item) byId[card.id] = item;
    });
    var observations = [];
    var vpip = byId.vpip; var pfr = byId.pfr;
    if (vpip && pfr) {
      var gap = vpip.rate - pfr.rate;
      if (gap >= thresholds.vpipPfrGap.high) observations.push(make('vpip-pfr-gap-high', 'vpipPfr', 'gap-high', 'Plays more hands than they raise preflop', [vpip, pfr], source, context));
      else if (gap >= 0 && gap <= thresholds.vpipPfrGap.close && vpip.rate >= thresholds.vpipPfrGap.closeMinimumVpip) observations.push(make('vpip-pfr-gap-close', 'vpipPfr', 'gap-close', 'Participation and preflop raises are close', [vpip, pfr], source, context));
    }
    // A relationship observation replaces the broad participation observation.
    if (!observations.length && vpip) {
      var participation = direction(vpip.rate, thresholds.vpip);
      if (participation) observations.push(make('vpip-' + participation, 'vpipPfr', participation,
        participation === 'low' ? 'Plays relatively few hands preflop' : 'Plays many hands preflop', [vpip], source, context));
    }
    ['threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd'].forEach(function (family) {
      var item = byId[family]; if (!item) return;
      var selected = direction(item.rate, thresholds[family]); if (!selected) return;
      observations.push(make(family + '-' + selected, family, selected, RULES[family][selected], [item], source, context));
    });
    return observations.sort(function (a, b) { return ORDER.indexOf(a.family) - ORDER.indexOf(b.family); });
  }
  // Shared, pure observation primitives. Self analysis applies separate product
  // wording and comparison rules to the same validated Dashboard cards.
  return Object.freeze({ THRESHOLDS: THRESHOLDS, THRESHOLD_SETS: THRESHOLD_SETS, thresholdsFor: thresholdsFor, PROFILE_TABLE_CONTEXT: PROFILE_TABLE_CONTEXT, profileTableContextFor: profileTableContextFor, ORDER: ORDER, support: support,
    direction: direction, copyContext: copyContext, sameContext: sameContext, derive: derive });
});
