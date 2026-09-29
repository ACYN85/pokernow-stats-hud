/* Pure, descriptive self-review signals from exact Dashboard stat cards. */
(function (root, factory) {
  'use strict';
  var insights = root.PokerPlayerInsights;
  if (typeof module !== 'undefined' && module.exports) insights = require('./playerInsights.js');
  var api = factory(insights);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPersonalLeakAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Insights) {
  'use strict';
  // Product heuristics, not optimal ranges. Single-stat boundaries are shared
  // with Insights; cross-context deltas are conservative review cutoffs.
  var THRESHOLDS = Object.freeze({ positionVpipDelta: 0.20, situationCBetDelta: 0.25, situationFoldToCBetDelta: 0.25 });
  var ORDER = Object.freeze(['vpipPfr', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd',
    'positionVpip', 'situationCBet', 'situationFoldToCBet']);
  var SINGLE = Object.freeze({
    threeBet: Object.freeze({ low: '3Bet is low in this sample', high: '3Bet is high in this sample' }),
    foldToThreeBet: Object.freeze({ low: 'Fold to 3Bet is low in this sample', high: 'Fold to 3Bet is high in this sample' }),
    flopCBet: Object.freeze({ low: 'Flop CBet is low in this sample', high: 'Flop CBet is high in this sample' }),
    foldToFlopCBet: Object.freeze({ low: 'Fold to flop CBet is low in this sample', high: 'Fold to flop CBet is high in this sample' }),
    wtsd: Object.freeze({ low: 'Reaches showdown infrequently', high: 'Reaches showdown frequently' })
  });
  var REVIEW_COPY = Object.freeze({
    vpipPfr: Object.freeze({
      low: ['Consider widening preflop participation', 'Your observed VPIP is low'],
      high: ['Review whether you enter too many pots', 'Your observed VPIP is high'],
      'gap-high': ['Review passive preflop entries', 'You enter substantially more pots than you raise']
    }),
    threeBet: Object.freeze({
      low: ['Review whether you 3-bet too seldom', 'Your observed 3Bet rate is low'],
      high: ['Review whether you 3-bet too often', 'Your observed 3Bet rate is high']
    }),
    foldToThreeBet: Object.freeze({
      low: ['Review whether you continue too widely vs 3-bets', 'You continue against 3-bets frequently'],
      high: ['Review whether you overfold to 3-bets', 'You fold to 3-bets frequently']
    }),
    flopCBet: Object.freeze({
      low: ['Review your selective flop CBets', 'Your observed flop CBet rate is low'],
      high: ['Review whether you CBet too often', 'Your observed flop CBet rate is high']
    }),
    foldToFlopCBet: Object.freeze({
      low: ['Review whether you continue too widely on flops', 'You continue against flop CBets frequently'],
      high: ['Review whether you overfold to flop CBets', 'You fold to flop CBets frequently']
    }),
    wtsd: Object.freeze({
      low: ['Review whether you give up too early', 'You reach showdown relatively infrequently'],
      high: ['Review whether you call down too often', 'You reach showdown frequently']
    })
  });
  var POSITION_ORDER = Object.freeze(['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  function scope(value) {
    var context = Insights.copyContext(value);
    if (!context || context.opponentMode !== 'overall') return null;
    if (context.situation === 'overall' && (context.position === null || POSITION_ORDER.indexOf(context.position) >= 0)) return context;
    if ((context.situation === 'ip' || context.situation === 'oop') && context.position === null) return context;
    return null;
  }
  function supported(cards, source, context) {
    var result = Object.create(null);
    if (!Array.isArray(cards)) return result;
    cards.forEach(function (card) {
      if (!card || typeof card.id !== 'string' || result[card.id]) return;
      var item = Insights.support(card, source, context);
      if (item) result[card.id] = item;
    });
    return result;
  }
  function stat(item, context) { return Object.freeze(Object.assign({}, item, { context: Insights.copyContext(context) })); }
  function contextPhrase(context) {
    if (!context) return '';
    if (context.position) return ' from ' + context.position;
    if (context.situation === 'ip') return ' when in position';
    if (context.situation === 'oop') return ' when out of position';
    return '';
  }
  function reviewPresentation(family, direction, stats, context) {
    if (REVIEW_COPY[family]) {
      var copy = REVIEW_COPY[family][direction];
      return { reviewTitle: copy[0], reason: copy[1] + contextPhrase(context) + '.' };
    }
    var higher = stats[0].context.position || stats[0].context.situation.toUpperCase();
    var lower = stats[1].context.position || stats[1].context.situation.toUpperCase();
    if (family === 'positionVpip') return { reviewTitle: 'Review your position-based participation gap',
      reason: 'Your VPIP is higher from ' + higher + ' than ' + lower + '.' };
    if (family === 'situationCBet') return { reviewTitle: 'Review your IP/OOP CBet gap',
      reason: 'Your flop CBet rate is higher ' + higher + ' than ' + lower + '.' };
    return { reviewTitle: 'Review your IP/OOP CBet defense gap',
      reason: 'Your fold to flop CBet rate is higher ' + higher + ' than ' + lower + '.' };
  }
  function signal(id, family, direction, title, explanation, items, source, context, comparedContexts) {
    var stats = Object.freeze(items.map(function (entry) { return stat(entry.item, entry.context); }));
    var presentation = reviewPresentation(family, direction, stats, context);
    return Object.freeze({ id: id, family: family, direction: direction, title: title, explanation: explanation,
      reviewTitle: presentation.reviewTitle, reason: presentation.reason,
      stats: stats, evidenceLevel: Math.min.apply(null, stats.map(function (item) { return item.evidenceLevel; })),
      evidenceLabel: stats.some(function (item) { return item.evidenceLabel === 'Moderate'; }) ? 'Moderate' : 'Strong',
      source: source, context: Insights.copyContext(context),
      comparedContexts: comparedContexts ? Object.freeze(comparedContexts.map(Insights.copyContext)) : null });
  }
  function entry(item, context) { return { item: item, context: context }; }
  function singleSignals(byId, source, context, thresholds) {
    var result = []; var vpip = byId.vpip; var pfr = byId.pfr;
    if (vpip && pfr && vpip.rate - pfr.rate >= thresholds.vpipPfrGap.high)
      result.push(signal('self-vpip-pfr-gap', 'vpipPfr', 'gap-high', 'Large VPIP/PFR gap',
        'You entered substantially more supported hands than you raised preflop. Worth reviewing as a recurring preflop pattern.',
        [entry(vpip, context), entry(pfr, context)], source, context));
    if (!result.length && vpip) {
      var participation = Insights.direction(vpip.rate, thresholds.vpip);
      if (participation) result.push(signal('self-vpip-' + participation, 'vpipPfr', participation,
        participation === 'high' ? 'High observed participation' : 'Low observed participation',
        'Your supported preflop participation is at an observed extreme. Worth reviewing in context.', [entry(vpip, context)], source, context));
    }
    ['threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd'].forEach(function (family) {
      var item = byId[family]; if (!item) return;
      var direction = Insights.direction(item.rate, thresholds[family]); if (!direction) return;
      var items = [entry(item, context)];
      // W$SD adds context only to a supported WTSD observation; it never creates one.
      if (family === 'wtsd' && byId.wsd) items.push(entry(byId.wsd, context));
      result.push(signal('self-' + family + '-' + direction, family, direction, SINGLE[family][direction],
        'This supported rate is at an observed extreme. Worth reviewing across similar situations.', items, source, context));
    });
    return result;
  }
  function comparisonSignals(comparisons, source, tableSize) {
    if (!Array.isArray(comparisons)) return [];
    var contexts = Object.create(null);
    comparisons.forEach(function (slice) {
      var context = scope(slice && slice.context);
      if (!context || slice.source !== source || context.tableSize !== tableSize || !Array.isArray(slice.cards) || slice.tableSizeSupported !== true) return;
      var key = JSON.stringify(context);
      if (!contexts[key]) contexts[key] = { context: context, byId: supported(slice.cards, source, context) };
    });
    var slices = Object.keys(contexts).map(function (key) { return contexts[key]; });
    var result = [];
    function compare(left, right, id, family, cutoff, title) {
      var a = left && left.byId[id]; var b = right && right.byId[id];
      if (!a || !b || Math.abs(a.rate - b.rate) < cutoff) return;
      var higher = a.rate > b.rate ? left : right; var lower = a.rate > b.rate ? right : left;
      var high = a.rate > b.rate ? a : b; var low = a.rate > b.rate ? b : a;
      var names = family === 'positionVpip' ? [higher.context.position, lower.context.position] : [higher.context.situation.toUpperCase(), lower.context.situation.toUpperCase()];
      result.push(signal('self-' + family + '-' + names.join('-'), family, 'higher-' + names[0], title(names[0], names[1]),
        'These two exact supported contexts differ substantially. Worth reviewing; the difference alone does not establish a mistake.',
        [entry(high, higher.context), entry(low, lower.context)], source, null, [higher.context, lower.context]));
    }
    var ip = slices.find(function (slice) { return slice.context.situation === 'ip'; });
    var oop = slices.find(function (slice) { return slice.context.situation === 'oop'; });
    compare(ip, oop, 'flopCBet', 'situationCBet', THRESHOLDS.situationCBetDelta,
      function (higher, lower) { return 'Higher flop CBet rate ' + higher + ' than ' + lower; });
    compare(ip, oop, 'foldToFlopCBet', 'situationFoldToCBet', THRESHOLDS.situationFoldToCBetDelta,
      function (higher, lower) { return 'Higher fold to flop CBet rate ' + higher + ' than ' + lower; });
    var positions = slices.filter(function (slice) { return slice.context.situation === 'overall' && slice.context.position; })
      .sort(function (a, b) { return POSITION_ORDER.indexOf(a.context.position) - POSITION_ORDER.indexOf(b.context.position); });
    // One largest supported position contrast keeps this panel compact.
    var best = null;
    positions.forEach(function (left, i) { positions.slice(i + 1).forEach(function (right) {
      var a = left.byId.vpip; var b = right.byId.vpip; if (!a || !b) return;
      var delta = Math.abs(a.rate - b.rate);
      if (delta >= THRESHOLDS.positionVpipDelta && (!best || delta > best.delta)) best = { left: left, right: right, delta: delta };
    }); });
    if (best) compare(best.left, best.right, 'vpip', 'positionVpip', THRESHOLDS.positionVpipDelta,
      function (higher, lower) { return 'Higher VPIP in ' + higher + ' than ' + lower; });
    return result;
  }
  function derive(input) {
    input = input && typeof input === 'object' ? input : {};
    var context = scope(input.context);
    if ((input.source !== 'session' && input.source !== 'career') || !context || !Array.isArray(input.cards) ||
        (input.tableSizeSupported !== true && input.selectedUnavailable !== true)) return [];
    var thresholds = Insights.thresholdsFor(input.tableSize || context.tableSize || 'SIX_PLUS');
    var observations = (input.tableSizeSupported === true && thresholds ? singleSignals(supported(input.cards, input.source, context), input.source, context, thresholds) : [])
      .concat(comparisonSignals(input.comparisons, input.source, context.tableSize));
    return observations.sort(function (a, b) { return ORDER.indexOf(a.family) - ORDER.indexOf(b.family) || a.id.localeCompare(b.id); });
  }
  return Object.freeze({ THRESHOLDS: THRESHOLDS, ORDER: ORDER, derive: derive });
});
