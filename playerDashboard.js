/* Pure presentation and stat-shape adapter for the stable-ID Player Dashboard. */
(function (root, factory) {
  'use strict';
  var evidence = root.PokerStatEvidence;
  var insights = root.PokerPlayerInsights;
  var personal = root.PokerPersonalLeakAnalysis;
  var strategic = root.PokerStrategicImplications;
  if (typeof module !== 'undefined' && module.exports) evidence = require('./statEvidence.js');
  if (typeof module !== 'undefined' && module.exports) insights = require('./playerInsights.js');
  if (typeof module !== 'undefined' && module.exports) personal = require('./personalLeakAnalysis.js');
  if (typeof module !== 'undefined' && module.exports) strategic = require('./strategicImplications.js');
  var api = factory(evidence, insights, personal, strategic);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPlayerDashboard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Evidence, Insights, Personal, Strategic) {
  'use strict';
  var PROFILE_ORDER = Object.freeze(['Nit', 'TAG', 'LAG', 'Tight Passive', 'Loose Passive', 'Calling Station', 'Maniac']);
  // Forty exact observations retain the Career table-context maturity gate.
  var CAREER_CONTEXT_POLICY = Object.freeze({ enabled: true, minimumOpportunities: 40, minimumCoverageRatio: 0.10 });
  var POSITION_OPTIONS = Object.freeze(['BTN', 'CO', 'HJ', 'LJ', 'UTG', 'UTG+1', 'UTG+2', 'SB', 'BB']);
  var SITUATION_OPTIONS = Object.freeze([
    Object.freeze({ value: 'overall', label: 'Overall' }),
    Object.freeze({ value: 'ip', label: 'In position' }),
    Object.freeze({ value: 'oop', label: 'Out of position' })
  ]);
  var TABLE_SIZE_OPTIONS = Object.freeze([{ value: 'all', label: 'All' }, { value: 'HU', label: 'HU' }, { value: '3_TO_5', label: '3–5' }, { value: 'SIX_PLUS', label: '6+' }]);
  var CORE_IDS = Object.freeze(['hands', 'vpip', 'pfr', 'af', 'flopCBet', 'wtsd', 'wsd']);
  var RELATIONAL_IDS = Object.freeze(['threeBet', 'foldToThreeBet', 'foldToFlopCBet']);
  var TREND_IDS = Object.freeze(['vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']);
  function esc(value) { return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function integer(value) { return Math.max(0, Number(value || 0)); }
  function percent(numerator, denominator) { return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null; }
  function percentageText(value) { return value === null || value === undefined ? '---' : (Math.round(Number(value) * 10) / 10) + '%'; }
  function preflopPercentageText(value) { return value === null || value === undefined ? '---' : (Math.round(Number(value) * 10) / 10).toFixed(1) + '%'; }
  function afText(aggressive, calls) { if (!calls) return aggressive > 0 ? '\u221e' : '0.0'; return (Math.round((aggressive / calls) * 100) / 100).toFixed(2).replace(/0$/, ''); }
  function owns(value, field) { return Boolean(value) && Object.prototype.hasOwnProperty.call(value, field); }
  function exactCounter(value) { return Number.isSafeInteger(value) && value >= 0; }
  function fieldsAvailable(value, fields) { return fields.every(function (field) { return owns(value, field) && exactCounter(value[field]); }); }
  function evidenceInput(id, numerator, denominator, options) {
    options = options || {};
    return {
      statKey: id, numerator: numerator, denominator: denominator,
      opportunities: options.opportunities === undefined ? denominator : options.opportunities,
      hands: options.hands === undefined ? numerator : options.hands,
      aggressiveActions: options.aggressiveActions === undefined ? numerator : options.aggressiveActions,
      calls: options.calls === undefined ? denominator : options.calls,
      available: options.available !== false, source: options.source || null, context: options.context || null
    };
  }
  function card(id, label, value, numerator, denominator, sampleLabel, options) {
    return { id: id, label: label, value: value, numerator: numerator, denominator: denominator,
      sample: sampleLabel || (numerator + ' / ' + denominator), evidence: Evidence.evaluateStatEvidence(evidenceInput(id, numerator, denominator, options)) };
  }
  function fromSession(stats, context) {
    stats = stats || {}; var af = stats.afDetails || {};
    var common = { source: 'session', context: context || null };
    return [
      card('hands', 'Hands', String(integer(stats.handsPlayed)), integer(stats.handsPlayed), null, 'Finalized hands', Object.assign({}, common, { available: fieldsAvailable(stats, ['handsPlayed']) })),
      card('vpip', 'VPIP', preflopPercentageText(percent(integer(stats.vpipHands), integer(stats.vpipOpportunities))), integer(stats.vpipHands), integer(stats.vpipOpportunities), null, Object.assign({}, common, { available: fieldsAvailable(stats, ['vpipHands', 'vpipOpportunities']) })),
      card('pfr', 'PFR', preflopPercentageText(percent(integer(stats.pfrHands), integer(stats.pfrOpportunities))), integer(stats.pfrHands), integer(stats.pfrOpportunities), null, Object.assign({}, common, { available: fieldsAvailable(stats, ['pfrHands', 'pfrOpportunities']) })),
      card('af', 'AF', afText(integer(af.bets) + integer(af.raises), integer(af.calls)), integer(af.bets) + integer(af.raises), integer(af.calls), (integer(af.bets) + integer(af.raises)) + ' aggressive / ' + integer(af.calls) + ' calls', Object.assign({}, common, { available: fieldsAvailable(af, ['bets', 'raises', 'calls']), aggressiveActions: integer(af.bets) + integer(af.raises), calls: integer(af.calls) })),
      card('threeBet', '3Bet', percentageText(percent(integer(stats.threeBetMade), integer(stats.threeBetOpportunities))), integer(stats.threeBetMade), integer(stats.threeBetOpportunities), null, Object.assign({}, common, { available: fieldsAvailable(stats, ['threeBetMade', 'threeBetOpportunities']) })),
      card('foldToThreeBet', 'F3B', percentageText(percent(integer(stats.foldToThreeBet), integer(stats.foldToThreeBetOpportunities))), integer(stats.foldToThreeBet), integer(stats.foldToThreeBetOpportunities), null, Object.assign({}, common, { available: fieldsAvailable(stats, ['foldToThreeBet', 'foldToThreeBetOpportunities']) })),
      card('flopCBet', 'CBet', percentageText(percent(integer(stats.flopCBetMade), integer(stats.flopCBetOpportunities))), integer(stats.flopCBetMade), integer(stats.flopCBetOpportunities), null, Object.assign({}, common, { available: fieldsAvailable(stats, ['flopCBetMade', 'flopCBetOpportunities']) })),
      card('foldToFlopCBet', 'FCB', percentageText(percent(integer(stats.foldToFlopCBet), integer(stats.foldToFlopCBetOpportunities))), integer(stats.foldToFlopCBet), integer(stats.foldToFlopCBetOpportunities), null, Object.assign({}, common, { available: fieldsAvailable(stats, ['foldToFlopCBet', 'foldToFlopCBetOpportunities']) })),
      card('wtsd', 'WTSD', percentageText(percent(integer(stats.wentToShowdown), integer(stats.sawFlopForWTSD))), integer(stats.wentToShowdown), integer(stats.sawFlopForWTSD), null, Object.assign({}, common, { available: fieldsAvailable(stats, ['wentToShowdown', 'sawFlopForWTSD']) })),
      card('wsd', 'W$SD', percentageText(percent(integer(stats.wonMoneyAtShowdown), integer(stats.showdownsForWSD))), integer(stats.wonMoneyAtShowdown), integer(stats.showdownsForWSD), null, Object.assign({}, common, { available: fieldsAvailable(stats, ['wonMoneyAtShowdown', 'showdownsForWSD']) }))
    ];
  }
  function fromCounterResult(stats, source, context) {
    if (!stats || !stats.counters) return [];
    var c = stats.counters; var common = { source: source, context: context || null };
    return [
      card('hands', 'Hands', String(integer(c.hands)), integer(c.hands), null, 'Finalized hands', Object.assign({}, common, { available: fieldsAvailable(c, ['hands']) })),
      card('vpip', 'VPIP', preflopPercentageText(percent(integer(c.vpipMade), integer(c.vpipOpportunities))), integer(c.vpipMade), integer(c.vpipOpportunities), null, Object.assign({}, common, { available: fieldsAvailable(c, ['vpipMade', 'vpipOpportunities']) })),
      card('pfr', 'PFR', preflopPercentageText(percent(integer(c.pfrMade), integer(c.pfrOpportunities))), integer(c.pfrMade), integer(c.pfrOpportunities), null, Object.assign({}, common, { available: fieldsAvailable(c, ['pfrMade', 'pfrOpportunities']) })),
      card('af', 'AF', afText(integer(c.postflopAggressiveActions), integer(c.postflopCalls)), integer(c.postflopAggressiveActions), integer(c.postflopCalls), integer(c.postflopAggressiveActions) + ' aggressive / ' + integer(c.postflopCalls) + ' calls', Object.assign({}, common, { available: fieldsAvailable(c, ['postflopAggressiveActions', 'postflopCalls']), aggressiveActions: integer(c.postflopAggressiveActions), calls: integer(c.postflopCalls) })),
      card('threeBet', '3Bet', percentageText(percent(integer(c.threeBetMade), integer(c.threeBetOpportunities))), integer(c.threeBetMade), integer(c.threeBetOpportunities), null, Object.assign({}, common, { available: fieldsAvailable(c, ['threeBetMade', 'threeBetOpportunities']) })),
      card('foldToThreeBet', 'F3B', percentageText(percent(integer(c.foldToThreeBet), integer(c.foldToThreeBetOpportunities))), integer(c.foldToThreeBet), integer(c.foldToThreeBetOpportunities), null, Object.assign({}, common, { available: fieldsAvailable(c, ['foldToThreeBet', 'foldToThreeBetOpportunities']) })),
      card('flopCBet', 'CBet', percentageText(percent(integer(c.flopCBetMade), integer(c.flopCBetOpportunities))), integer(c.flopCBetMade), integer(c.flopCBetOpportunities), null, Object.assign({}, common, { available: fieldsAvailable(c, ['flopCBetMade', 'flopCBetOpportunities']) })),
      card('foldToFlopCBet', 'FCB', percentageText(percent(integer(c.foldToFlopCBet), integer(c.foldToFlopCBetOpportunities))), integer(c.foldToFlopCBet), integer(c.foldToFlopCBetOpportunities), null, Object.assign({}, common, { available: fieldsAvailable(c, ['foldToFlopCBet', 'foldToFlopCBetOpportunities']) })),
      card('wtsd', 'WTSD', percentageText(percent(integer(c.wtsdMade), integer(c.wtsdOpportunities))), integer(c.wtsdMade), integer(c.wtsdOpportunities), null, Object.assign({}, common, { available: fieldsAvailable(c, ['wtsdMade', 'wtsdOpportunities']) })),
      card('wsd', 'W$SD', percentageText(percent(integer(c.wsdMade), integer(c.wsdOpportunities))), integer(c.wsdMade), integer(c.wsdOpportunities), null, Object.assign({}, common, { available: fieldsAvailable(c, ['wsdMade', 'wsdOpportunities']) }))
    ];
  }
  function fromCareer(stats, context) { return fromCounterResult(stats, 'career', context); }
  function cardsFor(value, mode, context) { return mode === 'career' || value && value.counters ? fromCounterResult(value, mode === 'career' ? 'career' : 'session', context) : fromSession(value, context); }
  function analysisBucket(value, state) {
    if (!value || !value.counters || !Number.isSafeInteger(value.counters.hands) || value.counters.hands < 1) return null;
    var selected = state.tableSize || 'all';
    if (selected !== 'all') return value.filters && value.filters.tableSize === selected ? selected : null;
    var counts = value.coverage && value.coverage.tableSizeHands || {};
    var matching = ['HU', '3_TO_5', 'SIX_PLUS'].filter(function (bucket) { return counts[bucket] === value.counters.hands; });
    return matching.length === 1 ? matching[0] : null;
  }
  function cardsByIds(cards, ids) { return ids.map(function (id) { return cards.find(function (item) { return item.id === id; }); }).filter(Boolean); }
  function cardsHtml(cards) { return cards.map(function (item) { var evidence = item.evidence; var title = evidence.explanation + ' Observed result: ' + item.sample + '.'; var strength = evidence.status === 'insufficient' ? '' : '<em> · ' + esc(evidence.label) + '</em>'; return '<article class="pnhud-dashboard-stat pnhud-dashboard-stat-' + esc(item.id) + '"><span>' + esc(item.label) + '</span><strong>' + esc(item.value) + '</strong><small class="pnhud-dashboard-evidence pnhud-dashboard-evidence-' + esc(evidence.status) + '" title="' + esc(title) + '"><span>' + esc(evidence.compactSupportText) + '</span>' + strength + '</small></article>'; }).join(''); }
  function analysisStatLabel(key) { return ({ vpip: 'VPIP', pfr: 'PFR', threeBet: '3Bet', foldToThreeBet: 'F3B', flopCBet: 'CBet', foldToFlopCBet: 'FCB', wtsd: 'WTSD', wsd: 'W$SD' })[key] || key; }
  function analysisEvidence(stat, contextLabel) {
    var unit = stat.supportType === 'supported_showdowns' ? 'showdowns' : 'opportunities';
    return (contextLabel ? contextLabel + ' ' : '') + analysisStatLabel(stat.statKey) + ' ' + percentageText(stat.rate * 100) +
      ' · ' + stat.supportCount + ' ' + unit + ' · ' + stat.evidenceLabel;
  }
  function insightsHtml(state, cards, relationCards, mode, context, bucket) {
    if (state.loading || state.error || (state.selfPlayerId && String(state.playerId) === String(state.selfPlayerId)) || !Insights) return '';
    var scopedRelations = context.opponentMode !== 'overall';
    var selected = scopedRelations ? relationCards : cards;
    var observations = Insights.derive({ cards: selected, source: mode, context: context, tableSize: bucket, tableSizeSupported: Boolean(bucket) });
    if (!observations.length) return '';
    var implications = Strategic ? Strategic.derive({ observations: observations, source: mode, context: context, tableSizeSupported: Boolean(bucket) }) : [];
    var actionable = implications.filter(function (item) { return item.type === 'composite' || item.adjustment; });
    var shownSingles = new Set(actionable.filter(function (item) { return item.type === 'single'; }).map(function (item) { return item.sourceInsightIds[0]; }));
    var rows = actionable.map(function (item) {
      var insightId = item.type === 'single' ? ' data-insight-id="' + esc(item.sourceInsightIds[0]) + '"' : '';
      var evidence = item.supportingStats.map(function (stat) { return '<small class="pnhud-dashboard-analysis-evidence">' + esc(analysisEvidence(stat)) + '</small>'; }).join('');
      return '<li class="pnhud-dashboard-insight pnhud-dashboard-action" data-implication-id="' + esc(item.id) + '"' + insightId +
        '><strong>' + esc(item.actionTitle) + '</strong><span class="pnhud-dashboard-analysis-reason">' + esc(item.reason) + '</span>' + evidence + '</li>';
    }).join('');
    var remaining = observations.filter(function (item) { return !shownSingles.has(item.id); });
    var rawRows = remaining.map(function (item) {
      return '<li class="pnhud-dashboard-insight" data-insight-id="' + esc(item.id) + '"><strong>' + esc(item.title) + '</strong>' +
        item.stats.map(function (stat) { return '<small class="pnhud-dashboard-analysis-evidence">' + esc(analysisEvidence(stat)) + '</small>'; }).join('') + '</li>';
    }).join('');
    var raw = !rawRows ? '' : rows
      ? '<details class="pnhud-dashboard-observations"><summary>Supporting observations (' + remaining.length + ')</summary><ul>' + rawRows + '</ul></details>'
      : '<ul>' + rawRows + '</ul>';
    var scope = context.situation !== 'overall' ? situationLabel(context.situation) : context.position || 'Overall';
    if (scopedRelations) scope += context.opponentMode === 'self' ? ' · Vs You' : ' · Vs Everyone Else';
    return '<section class="pnhud-dashboard-section pnhud-dashboard-insights"><div class="pnhud-dashboard-section-heading"><h3>Insights</h3><small>' + esc(scope) + '</small></div>' + (rows ? '<ul>' + rows + '</ul>' : '') + raw + '<p class="pnhud-dashboard-help">' + (rows ? 'Broad adjustments from observed tendencies · not hand-specific advice' : 'Observed tendencies · not a prediction') + '</p></section>';
  }
  function reviewSignalsHtml(state, cards, mode, context, bucket) {
    if (!Personal || state.loading || state.error || !state.selfPlayerId || String(state.playerId) !== String(state.selfPlayerId)) return '';
    var bundle = state.comparisonContexts;
    var comparisons = [];
    var selectedUnavailable = !state.coreStats && Boolean(context.position || context.situation !== 'overall');
    var comparisonBucket = bucket;
    if (bundle && String(bundle.playerId) === String(state.playerId) && bundle.source === mode &&
        (mode === 'career'
          ? Number.isSafeInteger(state.careerRevision) && bundle.playerRevision === state.careerRevision
          : Number.isSafeInteger(state.sessionRevision) && bundle.sessionRevision === state.sessionRevision)) {
      function add(value, exactContext) {
        if (!value || String(value.playerId) !== String(state.playerId) || !value.filters || value.filters.position !== exactContext.position || value.filters.situation !== (exactContext.situation === 'overall' ? null : exactContext.situation) || value.filters.statId !== null || value.filters.counterpartMode !== null || (value.filters.tableSize || null) !== (state.tableSize && state.tableSize !== 'all' ? state.tableSize : null)) return;
        exactContext.tableSize = state.tableSize || 'all';
        var sliceBucket = analysisBucket(value, state);
        if (selectedUnavailable && !comparisonBucket) comparisonBucket = sliceBucket;
        comparisons.push({ source: mode, context: exactContext, cards: cardsFor(value, mode, exactContext), tableSizeSupported: Boolean(sliceBucket && sliceBucket === comparisonBucket) });
      }
      add(bundle.situations && bundle.situations.ip, { position: null, situation: 'ip', opponentMode: 'overall' });
      add(bundle.situations && bundle.situations.oop, { position: null, situation: 'oop', opponentMode: 'overall' });
      POSITION_OPTIONS.forEach(function (position) {
        add(bundle.positions && bundle.positions[position], { position: position, situation: 'overall', opponentMode: 'overall' });
      });
    }
    var observations = Personal.derive({ cards: cards, source: mode, context: context, comparisons: comparisons, tableSize: bucket, tableSizeSupported: Boolean(bucket), selectedUnavailable: selectedUnavailable });
    if (!observations.length) return '';
    function statScope(stat) { return stat.context.situation !== 'overall' ? stat.context.situation.toUpperCase() : stat.context.position; }
    var rows = observations.map(function (item) {
      var evidence = item.stats.map(function (stat) { return '<small class="pnhud-dashboard-analysis-evidence">' + esc(analysisEvidence(stat, statScope(stat))) + '</small>'; }).join('');
      return '<li class="pnhud-dashboard-insight pnhud-dashboard-review-action" data-review-signal-id="' + esc(item.id) + '"><strong>' + esc(item.reviewTitle) +
        '</strong><span class="pnhud-dashboard-analysis-reason">' + esc(item.reason) + '</span>' + evidence + '</li>';
    }).join('');
    var scope = context.situation !== 'overall' ? situationLabel(context.situation) : context.position || 'Overall';
    return '<section class="pnhud-dashboard-section pnhud-dashboard-review-signals"><div class="pnhud-dashboard-section-heading"><h3>Review Signals</h3><small>' + esc(scope) + '</small></div><ul>' + rows + '</ul><p class="pnhud-dashboard-help">Current filter signals and exact context comparisons · not strategy advice</p></section>';
  }
  function relationalCards(state, mode, overallCards) {
    if (!state.opponentMode || state.opponentMode === 'overall') return cardsByIds(overallCards, RELATIONAL_IDS);
    var sources = state.relationalStats || {}; var context = { position: state.position || null, situation: state.situation || 'overall', opponentMode: state.opponentMode || 'overall', tableSize: state.tableSize || 'all' };
    return RELATIONAL_IDS.map(function (id) { var cards = cardsFor(sources[id], mode, context); return cards.find(function (item) { return item.id === id; }) || card(id, id === 'threeBet' ? '3Bet' : id === 'foldToThreeBet' ? 'F3B' : 'FCB', '---', 0, 0, 'Unavailable', { available: false, source: mode, context: context }); });
  }
  function fitText(value) { var number = Number(value); return Number.isFinite(number) ? (Math.round(number * 1000) / 10) + '%' : '\u2014'; }
  function profileEvidenceHtml(explanation) {
    var supporting = Array.isArray(explanation.supportingEvidence) ? explanation.supportingEvidence : (Array.isArray(explanation.evidence) ? explanation.evidence.filter(function (item) { return item.kind !== 'mixed'; }) : []);
    var mixed = Array.isArray(explanation.counterEvidence) ? explanation.counterEvidence : (Array.isArray(explanation.evidence) ? explanation.evidence.filter(function (item) { return item.kind === 'mixed'; }) : []);
    function rows(title, className, values) {
      if (!values.length) return '';
      return '<h6>' + title + '</h6><ul class="pnhud-dashboard-profile-evidence ' + className + '">' + values.slice(0, 6).map(function (item) {
        return '<li><span><strong>' + esc(item.label) + ': ' + esc(item.valueText) + '</strong><em>' + esc(item.dimension || 'Observed tendency') + (item.strength ? ' · ' + esc(item.strength) : '') + '</em>' + (item.sample ? '<small>Sample: ' + esc(item.sample) + '</small>' : '') + '</span><p>' + esc(item.summary) + '</p></li>';
      }).join('') + '</ul>';
    }
    if (!supporting.length && !mixed.length) return '';
    return '<h5>Why it fits</h5>' + rows('Supporting evidence', 'pnhud-dashboard-profile-supporting', supporting) + rows('Mixed / counterevidence', 'pnhud-dashboard-profile-counter', mixed);
  }
  function profileGateHtml(explanation) {
    var reasons = Array.isArray(explanation.gatingReasons) ? explanation.gatingReasons : [];
    if (!reasons.length) return '';
    return '<h5>' + (explanation.displayedArchetype ? 'Current presentation state' : 'Why no profile is shown') + '</h5><ul class="pnhud-dashboard-profile-gates">' + reasons.map(function (reason) { return '<li>' + esc(reason.message) + '</li>'; }).join('') + '</ul>';
  }
  function profileGuideHtml(explanation) {
    var guide = Array.isArray(explanation.guide) ? explanation.guide : [];
    return '<details class="pnhud-dashboard-profile-guide"><summary>Profile Guide</summary><div>' + guide.map(function (entry) {
      var title = entry.archetype + (entry.fullName && entry.fullName !== entry.archetype ? ' \u2014 ' + entry.fullName : '');
      return '<article><h5>' + esc(title) + '</h5><p>' + esc(entry.description) + '</p>' + (entry.majorTendencies && entry.majorTendencies.length ? '<small>Major classifier tendencies: ' + esc(entry.majorTendencies.join(', ')) + '.</small>' : '') + '</article>';
    }).join('') + '</div></details>';
  }
  function profileAdvancedHtml(explanation) {
    var advanced = explanation.advanced || {};
    var table = explanation.tableSize || {};
    var fits = Array.isArray(explanation.fitScores) ? explanation.fitScores : [];
    return '<details class="pnhud-dashboard-profile-advanced"><summary>Advanced details</summary><dl><div><dt>Top candidate</dt><dd>' + esc(explanation.topCandidateArchetype || explanation.winningArchetype || '\u2014') + ' ' + esc(fitText(explanation.topCandidateFit === undefined ? explanation.winningFit : explanation.topCandidateFit)) + '</dd></div><div><dt>Second-best fit</dt><dd>' + esc(explanation.secondBestArchetype || explanation.runnerUpArchetype || '\u2014') + ' ' + esc(fitText(explanation.secondBestFit === undefined ? explanation.runnerUpFit : explanation.secondBestFit)) + '</dd></div><div><dt>Fit margin</dt><dd>' + esc(fitText(explanation.fitMargin)) + '</dd></div><div><dt>Raw classifier result</dt><dd>' + esc(advanced.rawClassification || '\u2014') + '</dd></div><div><dt>Displayed profile</dt><dd>' + esc(advanced.displayedProfile || 'None') + '</dd></div><div><dt>Presentation state</dt><dd>' + esc(advanced.presentationStatus || '\u2014') + '</dd></div><div><dt>Effective table size</dt><dd>' + esc(table.effectiveTableSize === null || table.effectiveTableSize === undefined ? '\u2014' : table.effectiveTableSize) + '</dd></div></dl><h5>All independent fit scores</h5><div class="pnhud-dashboard-profile-advanced-fits">' + fits.map(function (entry) { return '<span>' + esc(entry.archetype) + '<strong>' + esc(fitText(entry.score)) + '</strong></span>'; }).join('') + '</div><p>' + esc(explanation.confidenceExplanation || '') + '</p><p>' + esc(table.message || '') + '</p></details>';
  }
  function profileExplanationHtml(explanation) {
    if (!explanation) return '<p class="pnhud-dashboard-help">Profile explanation is not available for this player yet.</p>';
    var fits = Array.isArray(explanation.fitScores) ? explanation.fitScores : [];
    var explainedFit = fits.find(function (entry) { return entry.archetype === explanation.explainedArchetype; });
    var currentFit = explainedFit ? explainedFit.score : explanation.winningFit;
    var tableMessage = explanation.tableSize && explanation.tableSize.applied ? '<p class="pnhud-dashboard-profile-table-note">' + esc(explanation.tableSize.message) + '</p>' : '';
    return '<details class="pnhud-dashboard-profile-explanation"><summary><span aria-hidden="true">\u24d8</span> Why this profile?</summary><div class="pnhud-dashboard-profile-explanation-body"><h4>' + esc(explanation.title) + '</h4><p>' + esc(explanation.description) + '</p><dl class="pnhud-dashboard-profile-metrics"><div><dt>Current fit</dt><dd>' + esc(fitText(currentFit)) + '</dd></div><div><dt>Confidence</dt><dd>' + esc(fitText(explanation.confidence)) + '</dd></div><div><dt>Sample</dt><dd>' + esc(explanation.hands) + ' hands</dd></div></dl><p class="pnhud-dashboard-profile-summary">' + esc(explanation.summary) + '</p>' + (explanation.fitCompetition ? '<p class="pnhud-dashboard-profile-competition">' + esc(explanation.fitCompetition) + '</p>' : '') + profileEvidenceHtml(explanation) + profileGateHtml(explanation) + tableMessage + '<p class="pnhud-dashboard-profile-fit-note">' + esc(explanation.fitExplanation) + '</p>' + profileAdvancedHtml(explanation) + '</div></details>' + profileGuideHtml(explanation);
  }
  function profileHtml(profile, mode, bucket) {
    var bucketLabel = ({ HU: 'HU', '3_TO_5': '3–5 handed', SIX_PLUS: '6+ handed' })[bucket];
    var title = (mode === 'career' ? 'Career profile' : 'Current profile') + (bucketLabel ? ' · ' + bucketLabel : '');
    var unavailable = mode === 'career' && profile && profile.availability && profile.availability.message
      ? profile.availability.message
      : mode === 'career' ? 'Career profile inputs are unavailable.' : 'No current profile available.';
    if (!profile) return '<section class="pnhud-dashboard-section"><h3>' + title + '</h3><p class="pnhud-dashboard-empty">' + unavailable + '</p></section>';
    var displayed = profile.displayedArchetype || null; var raw = profile.rawArchetype || null; var scores = profile.rawScores || {};
    var showFit = mode !== 'career' || !profile.availability || profile.availability.available === true;
    var rows = PROFILE_ORDER.map(function (name) { var score = Number(scores[name]); var value = Number.isFinite(score) && score >= 0 ? Math.round(score * 1000) / 10 : 0; return '<div><span>' + esc(name) + '</span><strong>' + value + '%</strong></div>'; }).join('');
    var sample = mode === 'career' && profile ? '<span>Based on ' + integer(profile.hands) + ' Career ' + (integer(profile.hands) === 1 ? 'hand' : 'hands') + ' in this table-size segment</span>' : '';
    var labels = (mode === 'career' && !displayed ? '<p class="pnhud-dashboard-empty">' + unavailable + '</p>' : '') + '<p class="pnhud-dashboard-profile-labels">' + (displayed ? 'Displayed profile: <strong>' + esc(displayed) + '</strong>' : 'Displayed profile unavailable') + (raw && raw !== displayed ? '<span>Current raw classification: <strong>' + esc(raw) + '</strong></span>' : '') + sample + '</p>';
    return '<section class="pnhud-dashboard-section"><h3>' + title + '</h3>' + labels + profileExplanationHtml(profile.explanation) + (showFit ? '<h4>Profile fit</h4><div class="pnhud-dashboard-profile-fit">' + rows + '</div>' : '') + '<p class="pnhud-dashboard-help">Profile uses the selected table-size and context population. Compatibility scores are independent and are not probabilities.</p></section>';
  }
  function unavailableCareerProfile(reason, message, diagnostics) {
    return { displayedArchetype: null, rawArchetype: null, rawScores: {}, hands: diagnostics && diagnostics.careerHands || 0,
      explanation: null, availability: { available: false, reason: reason, message: message, diagnostics: diagnostics || {} } };
  }
  // Thin exact-counter adapter; all classification rules remain in the shared engine.
  function careerProfile(stats, classifier, presentation, explanation) {
    if (!stats || stats.version !== 1 || !stats.counters || !stats.profileContext || stats.profileContext.version !== 2) {
      return unavailableCareerProfile('malformed_or_unavailable_aggregate_inputs', 'Career profile inputs are unavailable.', {});
    }
    var c = stats.counters; var context = stats.profileContext;
    var mapping = { handsPlayed: 'hands', vpipHands: 'vpipMade', vpipOpportunities: 'vpipOpportunities', pfrHands: 'pfrMade', pfrOpportunities: 'pfrOpportunities', threeBetMade: 'threeBetMade', threeBetOpportunities: 'threeBetOpportunities', foldToThreeBet: 'foldToThreeBet', foldToThreeBetOpportunities: 'foldToThreeBetOpportunities', flopCBetMade: 'flopCBetMade', flopCBetOpportunities: 'flopCBetOpportunities', foldToFlopCBet: 'foldToFlopCBet', foldToFlopCBetOpportunities: 'foldToFlopCBetOpportunities', wentToShowdown: 'wtsdMade', sawFlopForWTSD: 'wtsdOpportunities', wonMoneyAtShowdown: 'wsdMade', showdownsForWSD: 'wsdOpportunities' };
    var fields = Object.values(mapping).concat(['postflopAggressiveActions', 'postflopCalls']);
    var malformed = !stats.playerId || fields.some(function (key) { return !Number.isInteger(c[key]) || c[key] < 0; }) ||
      [['vpipMade','vpipOpportunities'],['pfrMade','pfrOpportunities'],['threeBetMade','threeBetOpportunities'],['foldToThreeBet','foldToThreeBetOpportunities'],['flopCBetMade','flopCBetOpportunities'],['foldToFlopCBet','foldToFlopCBetOpportunities'],['wtsdMade','wtsdOpportunities'],['wsdMade','wsdOpportunities']].some(function (pair) { return c[pair[0]] > c[pair[1]]; });
    if (!Number.isInteger(context.preflopTableSizeSum) || !Number.isInteger(context.preflopTableSizeOpportunities) || context.preflopTableSizeOpportunities < 0 || context.preflopTableSizeOpportunities > c.vpipOpportunities ||
        context.preflopTableSizeSum < 2 * context.preflopTableSizeOpportunities || context.preflopTableSizeSum > 9 * context.preflopTableSizeOpportunities) malformed = true;
    var diagnostics = { careerHands: Number.isInteger(c.hands) ? c.hands : 0,
      vpipOpportunities: Number.isInteger(c.vpipOpportunities) ? c.vpipOpportunities : 0,
      pfrOpportunities: Number.isInteger(c.pfrOpportunities) ? c.pfrOpportunities : 0,
      exactTableContextOpportunities: Number.isInteger(context.preflopTableSizeOpportunities) ? context.preflopTableSizeOpportunities : 0,
      tableContextCoverageRatio: c.vpipOpportunities > 0 ? Math.round(context.preflopTableSizeOpportunities / c.vpipOpportunities * 10000) / 10000 : 0,
      effectiveTableSize: context.preflopTableSizeOpportunities > 0 ? Math.round(context.preflopTableSizeSum / context.preflopTableSizeOpportunities * 10000) / 10000 : null,
      minimumTableContextOpportunities: CAREER_CONTEXT_POLICY.minimumOpportunities,
      minimumTableContextCoverageRatio: CAREER_CONTEXT_POLICY.minimumCoverageRatio };
    if (malformed) return unavailableCareerProfile('malformed_or_unavailable_aggregate_inputs', 'Career profile inputs are unavailable.', diagnostics);
    var input = { playerId: String(stats.playerId), player: stats.latestDisplayName,
      preflopTableSizeSum: context.preflopTableSizeSum, preflopTableSizeOpportunities: context.preflopTableSizeOpportunities,
      afDetails: { aggressiveActions: c.postflopAggressiveActions, calls: c.postflopCalls } };
    Object.keys(mapping).forEach(function (key) { input[key] = c[mapping[key]]; });
    var bucket = stats.tableSize || 'SIX_PLUS';
    var calibrated = Insights.thresholdsFor(bucket);
    var classifierOptions = { config: { tableContext: Object.assign({ partialCoverage: CAREER_CONTEXT_POLICY }, Insights.profileTableContextFor(bucket) || {}) } };
    if (calibrated && classifier.DEFAULT_CONFIG && Array.isArray(classifier.DEFAULT_CONFIG.tagRules)) {
      var familyByFeature = { threeBetRate: 'threeBet', foldToThreeBetRate: 'foldToThreeBet', flopCBetRate: 'flopCBet', foldToFlopCBetRate: 'foldToFlopCBet', wtsdRate: 'wtsd' };
      classifierOptions.config.tagRules = classifier.DEFAULT_CONFIG.tagRules.map(function (rule) {
        var family = familyByFeature[rule.feature];
        return family && calibrated[family] ? Object.assign({}, rule, { threshold: calibrated[family][rule.direction] }) : rule;
      });
    }
    var record = classifier.classify(input, classifierOptions); record.hands = input.handsPlayed;
    var displayed = presentation.resolveSnapshotProfile(record);
    diagnostics.tableContextStatus = record.tableContext.status;
    diagnostics.tableContextReason = record.tableContext.unsupportedReason;
    diagnostics.exactTableContextCoverageComplete = record.tableContext.exactCoverageComplete;
    diagnostics.classifierStatus = record.primary.classificationStatus;
    diagnostics.classifierReason = record.primary.unsupportedReason;
    diagnostics.bestCandidate = record.primary.bestCandidate;
    diagnostics.bestScore = record.primary.scores && record.primary.bestCandidate ? record.primary.scores[record.primary.bestCandidate] : null;
    diagnostics.fitMargin = record.primary.scoreMargin;
    diagnostics.presentationStatus = displayed.status;
    diagnostics.presentationReason = displayed.reason;
    var reason = null; var message = null;
    if (c.hands === 0) { reason = 'no_supported_table_size_sample'; message = 'No supported table-size sample is available for profiling.'; }
    else if (c.hands < presentation.DEFAULT_POLICY.minimumVisibleHands) { reason = 'insufficient_table_size_hands'; message = 'Not enough hands in this table-size segment for a reliable profile.'; }
    else if (!record.features.vpipRate.supported || !record.features.pfrRate.supported || !record.features.vpipPfrGap.supported || !record.features.pfrVpipRatio.supported) { reason = 'insufficient_core_stat_support'; message = 'Not enough supported VPIP/PFR history in this table-size segment for a reliable profile.'; }
    else if (!record.tableContext.supported) {
      reason = 'insufficient_table_context_coverage';
      message = 'Not enough exact table-size history for a reliable profile.';
    } else if (record.primary.classificationStatus === 'ambiguous') { reason = 'ambiguous_archetype_fit'; message = 'This table-size sample does not fit one archetype strongly enough yet.'; }
    else if (record.primary.classificationStatus !== 'supported') { reason = 'insufficient_core_stat_support'; message = 'Not enough supported statistical evidence in this table-size segment for a reliable profile.'; }
    else if (!displayed.visible) { reason = 'profile_maturity_or_strength_gate'; message = 'This table-size sample has not yet met the maturity and strength requirements.'; }
    return { displayedArchetype: reason ? null : displayed.archetype, rawArchetype: record.primary.archetype,
      rawScores: record.primary.scores, hands: record.hands,
      availability: { available: !reason, reason: reason, message: message, diagnostics: diagnostics },
      explanation: reason ? null : explanation.explain({ record: record, presentation: displayed, decomposition: classifier.scoreDecomposition(input, classifierOptions) }) };
  }
  function situationLabel(situation) { var option = SITUATION_OPTIONS.find(function (candidate) { return candidate.value === situation; }); return option ? option.label : 'Overall'; }
  function situationControl(situation) {
    var options = SITUATION_OPTIONS.map(function (option) { return '<option value="' + option.value + '"' + (situation === option.value ? ' selected' : '') + '>' + option.label + '</option>'; });
    return '<label class="pnhud-dashboard-situation"><span>Situation</span><select data-dashboard-situation aria-label="Situation filter">' + options.join('') + '</select></label>';
  }
  function positionControl(position, disabled) {
    var options = ['<option value="">All positions</option>'].concat(POSITION_OPTIONS.map(function (label) { return '<option value="' + label + '"' + (position === label ? ' selected' : '') + '>' + label + '</option>'; }));
    return '<label class="pnhud-dashboard-position"><span>Position</span><select data-dashboard-position aria-label="Position filter"' + (disabled ? ' disabled title="Position is available for Overall only"' : '') + '>' + options.join('') + '</select></label>';
  }
  function opponentControl(state) {
    var mode = state.opponentMode || 'overall'; var unavailable = !state.selfPlayerId; var selfDashboard = Boolean(state.selfPlayerId && String(state.selfPlayerId) === String(state.playerId));
    function button(value, text, disabled, title) { return '<button type="button" data-dashboard-opponent="' + value + '" aria-pressed="' + (mode === value) + '" class="' + (mode === value ? 'active' : '') + '"' + (disabled ? ' disabled' : '') + (title ? ' title="' + esc(title) + '"' : '') + '>' + text + '</button>'; }
    return '<div class="pnhud-dashboard-opponent" role="group" aria-label="Relational opponent context"><span>Opponent</span><div>' + button('overall', 'Overall', false) + button('self', 'Vs You', unavailable || selfDashboard, selfDashboard ? 'Self-vs-self comparisons are not meaningful' : unavailable ? 'Canonical self identity is unavailable' : '') + button('others', 'Vs Everyone Else', unavailable, unavailable ? 'Canonical self identity is unavailable' : '') + '</div></div>';
  }
  function coverageHtml(state, coverage, mode, position, situation) {
    coverage = coverage || {}; var total = integer(mode === 'career' ? coverage.totalCareerHands : coverage.totalSessionHands); var tracked = integer(coverage.positionTrackedHands); var matched = integer(coverage.matchedPositionHands); var situationTracked = integer(coverage.situationTrackedHands); var situationMatched = integer(coverage.matchedSituationHands);
    if (situation !== 'overall') return '<p class="pnhud-dashboard-coverage"><strong>' + esc(situationLabel(situation)) + '</strong> · ' + situationMatched + ' exact ' + (situationMatched === 1 ? 'hand' : 'hands') + '<span>' + total + ' total ' + (mode === 'career' ? 'career' : 'session') + ' hands · ' + situationTracked + ' exact heads-up postflop</span></p>';
    if (position) return '<p class="pnhud-dashboard-coverage"><strong>' + esc(position) + '</strong> · ' + matched + ' tracked ' + (matched === 1 ? 'hand' : 'hands') + '<span>' + total + ' total ' + (mode === 'career' ? 'career' : 'session') + ' hands · ' + tracked + ' position-tracked</span></p>';
    return '<p class="pnhud-dashboard-coverage"><strong>All positions</strong> · ' + total + ' total ' + (total === 1 ? 'hand' : 'hands') + '<span>Position-tracked: ' + tracked + ' hands</span></p>';
  }
  function selectTrendWindow(trends, requested) {
    var available = trends && Array.isArray(trends.availableWindows) ? trends.availableWindows.map(Number).filter(function (size) { return [25, 50, 100, 250].indexOf(size) >= 0; }) : [];
    var hasRequested = requested !== null && requested !== undefined && requested !== ''; requested = Number(requested);
    if (hasRequested && available.indexOf(requested) >= 0) return requested;
    if (hasRequested && Number.isFinite(requested) && available.length) return available.slice().sort(function (left, right) { return Math.abs(left - requested) - Math.abs(right - requested) || right - left; })[0];
    return available.indexOf(100) >= 0 ? 100 : available.indexOf(50) >= 0 ? 50 : available.indexOf(25) >= 0 ? 25 : null;
  }
  function signedDelta(value, suffix) { var rounded = Math.round(value * 10) / 10; return (rounded > 0 ? '+' : '') + rounded.toFixed(1) + suffix; }
  function trendDelta(id, recent, baseline) {
    if (!recent || !baseline || !recent.derived || !baseline.derived) return null;
    if (id === 'af') return Number.isFinite(recent.derived.af) && Number.isFinite(baseline.derived.af) ? signedDelta(recent.derived.af - baseline.derived.af, '') : null;
    var value = recent.derived[id]; var base = baseline.derived[id];
    return value !== null && value !== undefined && base !== null && base !== undefined ? signedDelta(value - base, ' pp') : null;
  }
  function careerRevisionsMatch(dashboardResult, trends) {
    var dashboardRevision = Number(dashboardResult && dashboardResult.query && dashboardResult.query.playerRevision);
    var trendRevision = Number(trends && trends.query && trends.query.playerRevision);
    return Number.isSafeInteger(dashboardRevision) && Number.isSafeInteger(trendRevision) && dashboardRevision === trendRevision;
  }
  function trendsHtml(state, mode) {
    if (mode !== 'career') return '';
    if (state.loading) return '<section class="pnhud-dashboard-section pnhud-dashboard-trends"><h3>Recent trends</h3><p class="pnhud-dashboard-empty">Loading overall Career trends...</p></section>';
    if (state.trendError) return '<section class="pnhud-dashboard-section pnhud-dashboard-trends"><h3>Recent trends</h3><p class="pnhud-dashboard-empty">' + esc(state.trendError) + '</p></section>';
    var trends = state.trends; var selected = selectTrendWindow(trends, state.trendWindow);
    if (!trends || !selected || !trends.windows || !trends.windows[String(selected)]) {
      var dated = integer(trends && trends.datedHands); var undated = integer(trends && trends.undatedHands);
      return '<section class="pnhud-dashboard-section pnhud-dashboard-trends"><h3>Recent trends</h3><p class="pnhud-dashboard-empty">Not enough dated Career history for recent trends.</p>' + (undated ? '<p class="pnhud-dashboard-help">' + undated + ' Career ' + (undated === 1 ? 'hand has' : 'hands have') + ' unavailable chronology.</p>' : '') + '<p class="pnhud-dashboard-help">' + dated + ' dated Career ' + (dated === 1 ? 'hand' : 'hands') + '. Recent trends use overall Career hands and are not recalculated by Dashboard filters.</p></section>';
    }
    var buttons = trends.availableWindows.map(function (size) { return '<button type="button" data-dashboard-trend-window="' + size + '" aria-pressed="' + (size === selected) + '" class="' + (size === selected ? 'active' : '') + '">Last ' + size + '</button>'; }).join('');
    var recent = trends.windows[String(selected)].stats; var baseline = trends.baseline; var recentCards = cardsByIds(fromCareer(recent), TREND_IDS); var baselineById = {};
    cardsByIds(fromCareer(baseline), TREND_IDS).forEach(function (item) { baselineById[item.id] = item; });
    var rows = recentCards.map(function (item) { var comparison = baselineById[item.id]; var delta = trendDelta(item.id, recent, baseline); return '<article class="pnhud-dashboard-trend-stat"><span>' + esc(item.label) + '</span><strong>' + esc(item.value) + '</strong><small>' + esc(item.sample) + '</small><em>Career ' + esc(comparison ? comparison.value : '---') + ' · ' + esc(delta || 'No supported delta') + '</em></article>'; }).join('');
    var undatedHelp = trends.undatedHands ? ' ' + integer(trends.undatedHands) + ' Career ' + (integer(trends.undatedHands) === 1 ? 'hand has' : 'hands have') + ' unavailable chronology.' : '';
    return '<section class="pnhud-dashboard-section pnhud-dashboard-trends"><div class="pnhud-dashboard-section-heading"><div><h3>Recent trends</h3><small>Last ' + selected + ' of ' + integer(trends.totalCareerHands) + ' Career hands</small></div><div class="pnhud-dashboard-trend-windows" role="group" aria-label="Recent Career hand window">' + buttons + '</div></div><div class="pnhud-dashboard-trend-grid">' + rows + '</div><p class="pnhud-dashboard-help">Recent trends use overall Career hands and are not recalculated by Dashboard filters.' + undatedHelp + '</p></section>';
  }
  // Presentation-only, page-lifetime floating geometry. The root keeps its original
  // CSS until a pointer actually moves; no stats, storage or table owners are called.
  function createGeometryController(panel, viewport, memory) {
    var doc = panel.ownerDocument; var gesture = null;
    if (memory.positionCustomized !== true) memory.positionCustomized = false;
    function clamp(value) {
      var margin = Math.min(8, viewport.innerWidth / 4, viewport.innerHeight / 4);
      var availableWidth = Math.max(1, viewport.innerWidth - margin * 2);
      var availableHeight = Math.max(1, viewport.innerHeight - margin * 2);
      var width = Math.min(availableWidth, Math.max(Math.min(320, availableWidth), value.width));
      var height = Math.min(availableHeight, Math.max(Math.min(240, availableHeight), value.height));
      return { left: Math.max(margin, Math.min(viewport.innerWidth - margin - width, value.left)),
        top: Math.max(margin, Math.min(viewport.innerHeight - margin - height, value.top)), width: width, height: height };
    }
    function paint() {
      if (!memory.geometry) {
        if (!memory.positionCustomized) { panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; panel.style.transform = ''; }
        return;
      }
      var rect = memory.geometry = clamp(memory.geometry);
      panel.style.width = rect.width + 'px'; panel.style.height = rect.height + 'px';
      if (memory.positionCustomized) {
        panel.style.left = rect.left + 'px'; panel.style.top = rect.top + 'px';
        panel.style.right = 'auto'; panel.style.transform = 'none';
      } else {
        // Empty inline values restore the canonical responsive CSS right/center
        // placement without discarding a separately adjusted current size.
        panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; panel.style.transform = '';
      }
    }
    function finish(event) {
      if (!gesture || event && event.pointerId !== undefined && event.pointerId !== gesture.id) return;
      var id = gesture.id; gesture = null;
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', finish, true);
      doc.removeEventListener('pointercancel', finish, true);
      viewport.removeEventListener('blur', finish);
      panel.classList.remove('pnhud-dashboard-manipulating');
      if (panel.hasPointerCapture && panel.hasPointerCapture(id)) panel.releasePointerCapture(id);
    }
    function move(event) {
      if (!gesture || event.pointerId !== gesture.id) return;
      if (event.buttons === 0 || panel.hidden || !panel.isConnected) return finish();
      var dx = event.clientX - gesture.x; var dy = event.clientY - gesture.y;
      if (!dx && !dy && !gesture.moved) return;
      gesture.moved = true;
      var start = gesture.rect;
      var next = { left: start.left, top: start.top, width: start.width, height: start.height };
      if (gesture.resize) {
        next.width = Math.min(start.width + dx, viewport.innerWidth - 8 - start.left);
        next.height = Math.min(start.height + dy, viewport.innerHeight - 8 - start.top);
      } else { next.left += dx; next.top += dy; }
      memory.geometry = next; memory.positionCustomized = true; paint(); event.preventDefault(); event.stopPropagation();
    }
    function begin(event) {
      if (gesture || panel.hidden || event.button !== 0 || event.isPrimary === false) return;
      var target = event.target; if (!target || !target.closest) return;
      var resize = Boolean(target.closest('.pnhud-dashboard-resize'));
      if (!resize && (!target.closest('.pnhud-dashboard-drag-handle') || target.closest('button, input, select, textarea, a, summary, [contenteditable], [role="button"]'))) return;
      var rect = panel.getBoundingClientRect();
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, resize: resize, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
      doc.addEventListener('pointermove', move, true);
      doc.addEventListener('pointerup', finish, true);
      doc.addEventListener('pointercancel', finish, true);
      viewport.addEventListener('blur', finish);
      if (panel.setPointerCapture) { try { panel.setPointerCapture(event.pointerId); } catch (_) {} }
      panel.classList.add('pnhud-dashboard-manipulating');
      event.preventDefault(); event.stopPropagation();
    }
    function recover() { finish(); paint(); }
    function resizeKey(event) {
      if (!event.target.closest || !event.target.closest('.pnhud-dashboard-resize') || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      var rect = panel.getBoundingClientRect(); var step = event.shiftKey ? 40 : 10;
      memory.geometry = { left: rect.left, top: rect.top, width: rect.width + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), height: rect.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) };
      memory.positionCustomized = true;
      paint(); event.preventDefault(); event.stopPropagation();
    }
    panel.addEventListener('pointerdown', begin);
    panel.addEventListener('lostpointercapture', finish);
    panel.addEventListener('keydown', resizeKey);
    viewport.addEventListener('resize', recover);
    return { sync: paint, cancel: finish, resetPosition: function () { finish(); memory.positionCustomized = false; paint(); }, dispose: function () {
      finish(); panel.removeEventListener('pointerdown', begin); panel.removeEventListener('lostpointercapture', finish);
      panel.removeEventListener('keydown', resizeKey); viewport.removeEventListener('resize', recover);
    } };
  }
  function requestMatches(state, snapshot) {
    return Boolean(state && snapshot && state.open && String(state.playerId) === String(snapshot.playerId) && state.mode === snapshot.mode && (state.position || null) === (snapshot.position || null) && (state.situation || 'overall') === (snapshot.situation || 'overall') && (state.tableSize || 'all') === (snapshot.tableSize || 'all') && (state.opponentMode || 'overall') === (snapshot.opponentMode || 'overall') && state.requestToken === snapshot.requestToken);
  }
  function tableSizeControl(selected) {
    return '<label class="pnhud-dashboard-table-size"><span>Table</span><select data-dashboard-table-size aria-label="Table size filter">' + TABLE_SIZE_OPTIONS.map(function (option) { return '<option value="' + option.value + '"' + (selected === option.value ? ' selected' : '') + '>' + option.label + '</option>'; }).join('') + '</select></label>';
  }
  function render(state) {
    state = state || {}; var mode = state.mode === 'career' ? 'career' : 'session'; var situation = SITUATION_OPTIONS.some(function (option) { return option.value === state.situation; }) ? state.situation : 'overall'; var position = situation === 'overall' && POSITION_OPTIONS.indexOf(state.position) >= 0 ? state.position : null; var modeLabel = mode === 'career' ? 'Career' : 'Current session';
    var tableSize = TABLE_SIZE_OPTIONS.some(function (option) { return option.value === state.tableSize; }) ? state.tableSize : 'all'; var scoped = Boolean(position || situation !== 'overall' || tableSize !== 'all'); var source = scoped ? state.coreStats : state.coreStats || (mode === 'career' ? state.careerStats : state.sessionStats); var missingScopedSource = Boolean(scoped && !source && !state.loading && !state.error); var evidenceContext = { position: position, situation: situation, opponentMode: 'overall', tableSize: tableSize }; var cards = cardsFor(source, mode, evidenceContext); var hands = cards.length ? cards[0].numerator : 0; var coverage = source && source.coverage || {};
    var name = state.displayName || 'Tracked player'; var noteValue = Object.prototype.hasOwnProperty.call(state, 'noteDraft') ? state.noteDraft : state.note; var headerProfile = analysisBucket(source, state) && state.profile && (state.profile.displayedArchetype || state.profile.rawArchetype); var tableLabel = ({ all: 'All table sizes', HU: 'HU', '3_TO_5': '3–5 handed', SIX_PLUS: '6+ handed' })[tableSize]; var context = modeLabel + ' · ' + tableLabel + (situation !== 'overall' ? ' · ' + situationLabel(situation) : position ? ' · ' + position : '') + ' · ' + hands + ' ' + (hands === 1 ? 'hand' : 'hands');
    if (mode === 'career' && state.careerTrackingStartedAt) context += ' · Tracked since ' + new Date(state.careerTrackingStartedAt).toLocaleDateString();
    var coreCards = cardsByIds(cards, CORE_IDS); var relationCards = relationalCards(state, mode, cards); var bucket = analysisBucket(source, state); var exactCoverageAvailable = Boolean(source && source.coverage); var noPositionSample = Boolean(position && !state.loading && exactCoverageAvailable && integer(coverage.matchedPositionHands) === 0); var noSituationSample = Boolean(situation !== 'overall' && !state.loading && exactCoverageAvailable && integer(coverage.matchedSituationHands) === 0); var tracked = coverage.tableSizeHands && ['HU', '3_TO_5', 'SIX_PLUS'].reduce(function (sum, key) { return sum + integer(coverage.tableSizeHands[key]); }, 0); var analysisHelp = !state.loading && !state.error && hands > 0 && !bucket ? '<p class="pnhud-dashboard-help">Select a table-size segment for calibrated player analysis.</p>' : ''; var coverageHelp = tableSize === 'all' && tracked !== undefined ? '<p class="pnhud-dashboard-help">Table-size tracked: ' + tracked + ' / ' + hands + ' hands</p>' : '';
    var coreBody = state.loading ? '<p class="pnhud-dashboard-empty" role="status">Loading career statistics and filters...</p>' : state.error ? '<p class="pnhud-dashboard-error" role="status">' + esc(state.error) + '</p>' : missingScopedSource ? '<p class="pnhud-dashboard-empty">Filtered statistics and evidence are unavailable for this context.</p>' : noPositionSample ? '<p class="pnhud-dashboard-empty">No position-tracked hands for ' + esc(position) + ' yet.</p>' : noSituationSample ? '<p class="pnhud-dashboard-empty">No exact heads-up postflop hands for ' + esc(situationLabel(situation).toLowerCase()) + ' yet.</p>' : !cards.length ? '<p class="pnhud-dashboard-empty">No ' + (mode === 'career' ? 'career' : 'session') + ' hands tracked yet.</p>' : '<div class="pnhud-dashboard-stat-grid pnhud-dashboard-core-grid">' + cardsHtml(coreCards) + '</div>';
    var relationContext = tableLabel + ' · ' + (situation !== 'overall' ? situationLabel(situation) + ' · ' : position ? position + ' · ' : ''); relationContext += state.opponentMode === 'self' ? 'Vs You' : state.opponentMode === 'others' ? 'Vs Everyone Else' : 'Overall';
    var relationBody = state.loading ? '<p class="pnhud-dashboard-empty">Loading relational samples...</p>' : missingScopedSource ? '<p class="pnhud-dashboard-empty">Filtered relational evidence is unavailable for this context.</p>' : noPositionSample ? '<p class="pnhud-dashboard-empty">No supported relational sample for this position.</p>' : noSituationSample ? '<p class="pnhud-dashboard-empty">No supported relational sample for this situation.</p>' : '<div class="pnhud-dashboard-stat-grid pnhud-dashboard-relational-grid">' + cardsHtml(relationCards) + '</div>';
    var relationalCoverage = state.opponentMode && state.opponentMode !== 'overall' ? relationCards.reduce(function (sum, item) { return sum + integer(item.denominator); }, 0) : null;
    var profileBucket = bucket || (tableSize !== 'all' && !state.loading && !state.error && source && hands === 0 ? tableSize : null);
    return '<div class="pnhud-dashboard-window" role="document"><header class="pnhud-dashboard-drag-handle"><div><div class="pnhud-dashboard-title"><h2>' + esc(name) + '</h2>' + (headerProfile ? '<span class="pnhud-dashboard-header-profile">' + esc(headerProfile) + '</span>' : '') + '</div><p>' + esc(context) + '</p><small title="Canonical stable player ID">ID ' + esc(state.playerId) + '</small></div><button type="button" class="pnhud-dashboard-close" aria-label="Close player dashboard">×</button></header><div class="pnhud-dashboard-body"><div class="pnhud-dashboard-filter-row"><div class="pnhud-dashboard-tabs" role="tablist" aria-label="Statistics window"><button type="button" role="tab" data-dashboard-mode="session" aria-selected="' + (mode === 'session') + '" class="' + (mode === 'session' ? 'active' : '') + '">Session</button><button type="button" role="tab" data-dashboard-mode="career" aria-selected="' + (mode === 'career') + '" class="' + (mode === 'career' ? 'active' : '') + '">Career</button></div>' + tableSizeControl(tableSize) + situationControl(situation) + positionControl(position, situation !== 'overall') + '</div><section class="pnhud-dashboard-section"><h3>Core stats</h3>' + coverageHtml(state, coverage, mode, position, situation) + coverageHelp + analysisHelp + coreBody + '</section>' + trendsHtml(state, mode) + '<section class="pnhud-dashboard-section pnhud-dashboard-relational"><div class="pnhud-dashboard-section-heading"><div><h3>Relational stats</h3><small>' + esc(relationContext) + '</small></div>' + opponentControl(state) + '</div>' + relationBody + (relationalCoverage !== null ? '<p class="pnhud-dashboard-help">' + relationalCoverage + ' supported relational ' + (relationalCoverage === 1 ? 'opportunity' : 'opportunities') + ' across 3Bet, F3B, and FCB. Missing counterpart history is excluded.</p>' : '<p class="pnhud-dashboard-help">Opponent context applies only to 3Bet, F3B, and FCB.</p>') + '</section>' + (missingScopedSource || noPositionSample || noSituationSample ? '' : insightsHtml(state, cards, relationCards, mode, { position: position, situation: situation, opponentMode: state.opponentMode || 'overall', tableSize: tableSize }, bucket)) + reviewSignalsHtml(state, cards, mode, evidenceContext, bucket) + (profileBucket ? profileHtml(state.profile, mode, profileBucket) : '') + '<section class="pnhud-dashboard-section"><div class="pnhud-dashboard-notes-heading"><h3>Notes</h3><span class="pnhud-dashboard-note-status" role="status" aria-live="polite">' + esc(state.noteStatus || '') + '</span></div><textarea class="pnhud-dashboard-note" maxlength="5000" aria-label="Notes for ' + esc(name) + '" placeholder="Add a private note about this player...">' + esc(noteValue || '') + '</textarea><div class="pnhud-dashboard-note-actions"><button type="button" class="pnhud-dashboard-save-note">Save Note</button><button type="button" class="pnhud-dashboard-clear-note"' + (!noteValue ? ' disabled' : '') + '>Clear Note</button></div><p class="pnhud-dashboard-help">Notes are keyed only by stable player ID and are unaffected by dashboard filters.</p></section></div><button type="button" class="pnhud-dashboard-resize" aria-label="Resize player dashboard" title="Drag to resize; arrow keys resize when focused"></button></div>';
  }
  return Object.freeze({ PROFILE_ORDER: PROFILE_ORDER, POSITION_OPTIONS: POSITION_OPTIONS, SITUATION_OPTIONS: SITUATION_OPTIONS, TABLE_SIZE_OPTIONS: TABLE_SIZE_OPTIONS, CORE_IDS: CORE_IDS, RELATIONAL_IDS: RELATIONAL_IDS, TREND_IDS: TREND_IDS, CAREER_CONTEXT_POLICY: CAREER_CONTEXT_POLICY, createGeometryController: createGeometryController, careerProfile: careerProfile, fromSession: fromSession, fromCareer: fromCareer, fromCounterResult: fromCounterResult, selectTrendWindow: selectTrendWindow, trendDelta: trendDelta, careerRevisionsMatch: careerRevisionsMatch, requestMatches: requestMatches, render: render, percentageText: percentageText, afText: afText });
});
