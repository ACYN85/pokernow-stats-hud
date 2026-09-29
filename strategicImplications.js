/* Broad opponent implications derived only from supported Player Insights. */
(function (root, factory) {
  'use strict';
  var insights = root.PokerPlayerInsights;
  var evidence = root.PokerStatEvidence;
  if (typeof module !== 'undefined' && module.exports) {
    insights = require('./playerInsights.js');
    evidence = require('./statEvidence.js');
  }
  var api = factory(insights, evidence);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerStrategicImplications = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Insights, Evidence) {
  'use strict';

  var POSITIONS = Object.freeze(['BTN', 'CO', 'HJ', 'LJ', 'UTG', 'UTG+1', 'UTG+2', 'SB', 'BB']);
  var RULES = Object.freeze({
    'vpip-low': { family: 'vpipPfr', direction: 'low', stats: ['vpip'], threshold: 'vpip',
      interpretation: function (scope) { return 'This player has entered relatively few pots' + scope + '; voluntary entries may be more concentrated toward stronger holdings.'; },
      adjustment: 'Preflop: voluntary involvement may merit more respect than against a loose participant.' },
    'vpip-high': { family: 'vpipPfr', direction: 'high', stats: ['vpip'], threshold: 'vpip',
      interpretation: function (scope) { return 'This player has entered many pots' + scope + '; their postflop holdings may be more varied.'; },
      adjustment: 'Preflop: participation alone may merit less credit for strength; wider value ranges may be worth considering.' },
    'vpip-pfr-gap-high': { family: 'vpipPfr', direction: 'gap-high', stats: ['vpip', 'pfr'],
      interpretation: function (scope) { return 'This player has entered substantially more pots than they raised' + scope + '; the gap may reflect more passive entries.'; },
      adjustment: 'Preflop: value-oriented isolation or pressure may be worth considering without treating every call as unusually strong.' },
    'threeBet-low': { family: 'threeBet', direction: 'low', stats: ['threeBet'], threshold: 'threeBet',
      interpretation: function (scope) { return 'This player has reraised preflop infrequently' + scope + '; those reraises may come from a more selective range.'; },
      adjustment: 'Preflop: light continuing against their reraises may deserve more caution.' },
    'threeBet-high': { family: 'threeBet', direction: 'high', stats: ['threeBet'], threshold: 'threeBet',
      interpretation: function (scope) { return 'This player has reraised preflop frequently' + scope + '; those reraises may include more than premium holdings.'; },
      adjustment: 'Preflop: avoid premium-only assumptions or automatic overfolding solely because this player reraised.' },
    'foldToThreeBet-low': { family: 'foldToThreeBet', direction: 'low', stats: ['foldToThreeBet'], threshold: 'foldToThreeBet',
      interpretation: function (scope) { return 'This player has continued often after facing 3-bets' + scope + '.'; },
      adjustment: 'Preflop: light 3-bets may get fewer folds; value-oriented reraising may be worth considering.' },
    'foldToThreeBet-high': { family: 'foldToThreeBet', direction: 'high', stats: ['foldToThreeBet'], threshold: 'foldToThreeBet',
      interpretation: function (scope) { return 'This player has folded often after facing 3-bets' + scope + '; their continuing range may be more selective.'; },
      adjustment: 'Preflop: selective light 3-bet pressure may generate more folds in similar spots.' },
    'flopCBet-low': { family: 'flopCBet', direction: 'low', stats: ['flopCBet'], threshold: 'flopCBet',
      interpretation: function (scope) { return 'This player has continuation-bet selectively as the qualifying preflop aggressor' + scope + '.'; },
      adjustment: 'Flop: their observed CBet may merit more caution than one from a frequent continuation bettor.' },
    'flopCBet-high': { family: 'flopCBet', direction: 'high', stats: ['flopCBet'], threshold: 'flopCBet',
      interpretation: function (scope) { return 'This player has continuation-bet frequently as the qualifying preflop aggressor' + scope + '.'; },
      adjustment: 'Flop: the mere presence of their CBet may be less diagnostic of strength by itself.' },
    'foldToFlopCBet-low': { family: 'foldToFlopCBet', direction: 'low', stats: ['foldToFlopCBet'], threshold: 'foldToFlopCBet',
      interpretation: function (scope) { return 'This player has continued often against qualifying flop CBets' + scope + '.'; },
      adjustment: 'Flop: bluff-heavy CBets may get fewer folds; value-oriented betting may be worth considering when other conditions support it.' },
    'foldToFlopCBet-high': { family: 'foldToFlopCBet', direction: 'high', stats: ['foldToFlopCBet'], threshold: 'foldToFlopCBet',
      interpretation: function (scope) { return 'This player has folded often to qualifying flop CBets' + scope + '.'; },
      adjustment: 'Flop: selective continuation-bet pressure may generate more folds in similar spots.' },
    'wtsd-low': { family: 'wtsd', direction: 'low', stats: ['wtsd'], threshold: 'wtsd',
      interpretation: function (scope) { return 'This player has reached showdown relatively infrequently after seeing the flop' + scope + '.'; },
      adjustment: 'Later streets: selective pressure may have more room to win before showdown, but this rate alone does not identify a folding spot.' },
    'wtsd-high': { family: 'wtsd', direction: 'high', stats: ['wtsd'], threshold: 'wtsd',
      interpretation: function (scope) { return 'This player has reached showdown often after seeing the flop' + scope + '; they may continue deeper into hands.'; },
      adjustment: 'Later streets: bluff-heavy lines may be called down more often; thinner value may be worth considering when your range supports it.' }
  });
  var COMPOSITES = Object.freeze([
    { id: 'sticky-showdown', family: 'sticky', title: 'Continues frequently across situations', required: ['wtsd-high'], any: ['foldToFlopCBet-low', 'foldToThreeBet-low'],
      interpretation: function (scope) { return 'Supported showdown and defense observations point to frequent continuation' + scope + '.'; },
      adjustment: 'Across the supported spots: bluff-heavy pressure may get fewer folds; value-oriented lines may be worth considering when your range supports them.' },
    { id: 'fold-prone', family: 'foldProne', title: 'Folds to pressure in multiple observed spots', required: ['foldToThreeBet-high', 'foldToFlopCBet-high'],
      interpretation: function (scope) { return 'This player has surrendered frequently to supported preflop and flop aggression' + scope + '.'; },
      adjustment: 'Preflop and flop: selective pressure in the observed spots may generate folds more often.' },
    { id: 'tight-selective-preflop', family: 'tightSelective', title: 'Selective preflop entry and reraising', required: ['vpip-low', 'threeBet-low'],
      interpretation: function (scope) { return 'Both voluntary entry and reraising have been infrequent' + scope + '.'; },
      adjustment: 'Preflop: aggression from this player may warrant more respect than from a loose reraiser.' },
    { id: 'loose-aggressive-preflop', family: 'looseAggressive', title: 'Frequent preflop entry and reraising', required: ['vpip-high', 'threeBet-high'],
      interpretation: function (scope) { return 'Both voluntary entry and reraising have been frequent' + scope + '.'; },
      adjustment: 'Preflop: avoid automatically assigning premium-only ranges to this player’s reraises.' }
  ]);
  // Presentation copy is separate from rule eligibility and the longer
  // interpretation/adjustment metadata. No new classification is made here.
  var ACTION_TITLES = Object.freeze({
    'vpip-low': 'Respect preflop involvement more',
    'vpip-high': 'Give preflop entries less automatic credit',
    'vpip-pfr-gap-high': 'Pressure passive preflop entries selectively',
    'threeBet-low': 'Respect their 3-bets more',
    'threeBet-high': 'Avoid premium-only 3-bet assumptions',
    'foldToThreeBet-low': 'Bluff 3-bet less; value 3-bet more',
    'foldToThreeBet-high': 'Apply selective 3-bet pressure',
    'flopCBet-low': 'Respect their flop CBets more',
    'flopCBet-high': 'Give flop CBets less automatic credit',
    'foldToFlopCBet-low': 'Bluff flop CBets less; value bet more',
    'foldToFlopCBet-high': 'Apply selective flop pressure',
    'wtsd-low': 'Consider selective pressure before showdown',
    'wtsd-high': 'Consider thinner value bets'
  });
  var COMPOSITE_COPY = Object.freeze({
    'sticky-showdown': Object.freeze({ actionTitle: 'Bluff less; value bet thinner', reason: 'Continues frequently and reaches showdown often' }),
    'fold-prone': Object.freeze({ actionTitle: 'Apply selective preflop and flop pressure', reason: 'Folds to 3-bets and flop CBets often' }),
    'tight-selective-preflop': Object.freeze({ actionTitle: 'Respect their preflop aggression more', reason: 'Enters and reraises infrequently preflop' }),
    'loose-aggressive-preflop': Object.freeze({ actionTitle: 'Avoid premium-only preflop assumptions', reason: 'Enters and reraises frequently preflop' })
  });

  function exact(value) { return Number.isSafeInteger(value) && value >= 0; }
  function evidenceLabel(level) { return level === Evidence.LEVELS.strong ? Evidence.LABELS.strong : Evidence.LABELS.moderate; }
  function contextCopy(context) { return Insights.copyContext(context); }
  function sameContext(left, right) { return Insights.sameContext(left, right); }
  function validContext(context) {
    if (!context || typeof context !== 'object' || Array.isArray(context)) return false;
    if (context.opponentMode !== 'overall' && context.opponentMode !== 'self' && context.opponentMode !== 'others') return false;
    if (context.situation !== 'overall' && context.situation !== 'ip' && context.situation !== 'oop') return false;
    if (context.position !== null && POSITIONS.indexOf(context.position) < 0) return false;
    return context.situation === 'overall' || context.position === null;
  }
  function scopePhrase(context) {
    var parts = [];
    if (context.position) parts.push('from ' + context.position);
    else if (context.situation === 'ip') parts.push('when in position');
    else if (context.situation === 'oop') parts.push('when out of position');
    if (context.opponentMode === 'self') parts.push('against you');
    if (context.opponentMode === 'others') parts.push('against other players');
    return parts.length ? ' ' + parts.join(' ') : '';
  }
  function validStat(stat, statKey, source, context) {
    if (!stat || stat.statKey !== statKey || !exact(stat.numerator) || !exact(stat.denominator) || !stat.denominator ||
        stat.numerator > stat.denominator || stat.supportCount !== stat.denominator ||
        typeof stat.rate !== 'number' || Math.abs(stat.rate - stat.numerator / stat.denominator) > 1e-12) return false;
    var proof = Evidence.evaluateStatEvidence({ statKey: statKey, numerator: stat.numerator,
      opportunities: stat.denominator, source: source, context: context });
    return Evidence.meets(proof, 'moderate') && stat.supportType === proof.supportType &&
      stat.evidenceStatus === proof.status && stat.evidenceLevel === proof.level && stat.evidenceLabel === proof.label;
  }
  function validObservation(observation, rule, source, context) {
    if (!observation || observation.id !== rule.id || observation.family !== rule.family ||
        observation.direction !== rule.direction || observation.source !== source ||
        !sameContext(observation.context, context) || !Array.isArray(observation.stats) ||
        observation.stats.length !== rule.stats.length) return false;
    if (!rule.stats.every(function (key, index) { return validStat(observation.stats[index], key, source, context); })) return false;
    var minimum = Math.min.apply(null, observation.stats.map(function (stat) { return stat.evidenceLevel; }));
    if (observation.evidenceLevel !== minimum || observation.evidenceLabel !== evidenceLabel(minimum)) return false;
    if (rule.threshold) return Insights.direction(observation.stats[0].rate, Insights.THRESHOLDS[rule.threshold]) === rule.direction;
    return observation.stats[0].rate - observation.stats[1].rate >= Insights.THRESHOLDS.vpipPfrGap.high;
  }
  function supportStats(observations) {
    return Object.freeze(observations.flatMap(function (observation) {
      return observation.stats.map(function (stat) {
        return Object.freeze({ sourceInsightId: observation.id, statKey: stat.statKey, numerator: stat.numerator,
          denominator: stat.denominator, rate: stat.rate, supportCount: stat.supportCount,
          supportType: stat.supportType, evidenceLevel: stat.evidenceLevel, evidenceLabel: stat.evidenceLabel });
      });
    }));
  }
  function compositePresentation(definition, observations) {
    if (definition.id !== 'sticky-showdown') return COMPOSITE_COPY[definition.id];
    var flop = observations.some(function (item) { return item.id === 'foldToFlopCBet-low'; });
    var preflop = observations.some(function (item) { return item.id === 'foldToThreeBet-low'; });
    if (flop && preflop) return COMPOSITE_COPY['sticky-showdown'];
    return flop
      ? { actionTitle: 'Bluff flop CBets less; value bet thinner', reason: 'Continues vs flop CBets and reaches showdown often' }
      : { actionTitle: 'Bluff 3-bet less; value bet thinner', reason: 'Continues vs 3-bets and reaches showdown often' };
  }
  function makeItem(type, definition, observations, source, context, suppressedBy) {
    var level = Math.min.apply(null, observations.map(function (observation) { return observation.evidenceLevel; }));
    var sources = Object.freeze(observations.map(function (observation) {
      return Object.freeze({ insightId: observation.id, level: observation.evidenceLevel, label: observation.evidenceLabel });
    }));
    var presentation = type === 'composite' ? compositePresentation(definition, observations) : null;
    return Object.freeze({ id: type === 'single' ? 'implication-' + observations[0].id : 'implication-' + definition.id,
      type: type, family: definition.family, title: type === 'composite' ? definition.title : null,
      actionTitle: type === 'composite' ? presentation.actionTitle : ACTION_TITLES[observations[0].id],
      reason: (type === 'composite' ? presentation.reason : observations[0].title) + scopePhrase(context) + '.',
      sourceInsightIds: Object.freeze(observations.map(function (observation) { return observation.id; })),
      interpretation: definition.interpretation(scopePhrase(context)),
      adjustment: suppressedBy ? null : definition.adjustment,
      adjustmentSuppressedBy: suppressedBy || null,
      evidence: Object.freeze({ level: level, label: evidenceLabel(level), sources: sources }),
      supportingStats: supportStats(observations), source: source, context: Object.freeze(contextCopy(context)) });
  }
  function derive(input) {
    input = input && typeof input === 'object' ? input : {};
    var source = input.source; var context = contextCopy(input.context);
    if ((source !== 'session' && source !== 'career') || !validContext(context) || !Array.isArray(input.observations) || input.tableSizeSupported !== true) return Object.freeze([]);
    var byId = new Map();
    input.observations.forEach(function (observation) {
      var rule = observation && RULES[observation.id];
      if (!rule || byId.has(observation.id)) return;
      var expected = Object.assign({ id: observation.id }, rule);
      if (validObservation(observation, expected, source, context)) byId.set(observation.id, observation);
    });
    var suppressed = new Map(); var composites = [];
    COMPOSITES.forEach(function (definition) {
      if (!definition.required.every(function (id) { return byId.has(id); })) return;
      var ids = definition.required.concat((definition.any || []).filter(function (id) { return byId.has(id); }));
      if (definition.any && ids.length === definition.required.length) return;
      composites.push(makeItem('composite', definition, ids.map(function (id) { return byId.get(id); }), source, context));
      ids.forEach(function (id) { if (!suppressed.has(id)) suppressed.set(id, 'implication-' + definition.id); });
    });
    // A specific reraising rate takes precedence over broad participation advice
    // when their directions differ; both observations and interpretations remain.
    if (byId.has('vpip-low') && byId.has('threeBet-high')) suppressed.set('vpip-low', 'implication-threeBet-high');
    if (byId.has('vpip-high') && byId.has('threeBet-low')) suppressed.set('vpip-high', 'implication-threeBet-low');
    var singles = Array.from(byId.keys()).sort(function (left, right) {
      var a = Insights.ORDER.indexOf(RULES[left].family); var b = Insights.ORDER.indexOf(RULES[right].family);
      return a - b || left.localeCompare(right);
    }).map(function (id) {
      return makeItem('single', RULES[id], [byId.get(id)], source, context, suppressed.get(id));
    });
    return Object.freeze(composites.concat(singles));
  }
  return Object.freeze({ derive: derive });
});
