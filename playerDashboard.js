/* Pure presentation and stat-shape adapter for the stable-ID Player Dashboard. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPlayerDashboard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var PROFILE_ORDER = Object.freeze(['Nit', 'TAG', 'LAG', 'Tight Passive', 'Loose Passive', 'Calling Station', 'Maniac']);
  var POSITION_OPTIONS = Object.freeze(['BTN', 'CO', 'HJ', 'LJ', 'UTG', 'UTG+1', 'UTG+2', 'SB', 'BB']);
  var CORE_IDS = Object.freeze(['hands', 'vpip', 'pfr', 'af', 'flopCBet', 'wtsd', 'wsd']);
  var RELATIONAL_IDS = Object.freeze(['threeBet', 'foldToThreeBet', 'foldToFlopCBet']);
  function esc(value) { return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function integer(value) { return Math.max(0, Number(value || 0)); }
  function percent(numerator, denominator) { return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null; }
  function percentageText(value) { return value === null || value === undefined ? '---' : (Math.round(Number(value) * 10) / 10) + '%'; }
  function afText(aggressive, calls) { if (!calls) return aggressive > 0 ? '\u221e' : '0.0'; return (Math.round((aggressive / calls) * 100) / 100).toFixed(2).replace(/0$/, ''); }
  function card(id, label, value, numerator, denominator, sampleLabel) { return { id: id, label: label, value: value, numerator: numerator, denominator: denominator, sample: sampleLabel || (numerator + ' / ' + denominator) }; }
  function fromSession(stats) {
    stats = stats || {}; var af = stats.afDetails || {};
    return [
      card('hands', 'Hands', String(integer(stats.handsPlayed)), integer(stats.handsPlayed), null, 'Finalized hands'),
      card('vpip', 'VPIP', percentageText(percent(integer(stats.vpipHands), integer(stats.vpipOpportunities))), integer(stats.vpipHands), integer(stats.vpipOpportunities)),
      card('pfr', 'PFR', percentageText(percent(integer(stats.pfrHands), integer(stats.pfrOpportunities))), integer(stats.pfrHands), integer(stats.pfrOpportunities)),
      card('af', 'AF', afText(integer(af.bets) + integer(af.raises), integer(af.calls)), integer(af.bets) + integer(af.raises), integer(af.calls), (integer(af.bets) + integer(af.raises)) + ' aggressive / ' + integer(af.calls) + ' calls'),
      card('threeBet', '3Bet', percentageText(percent(integer(stats.threeBetMade), integer(stats.threeBetOpportunities))), integer(stats.threeBetMade), integer(stats.threeBetOpportunities)),
      card('foldToThreeBet', 'F3B', percentageText(percent(integer(stats.foldToThreeBet), integer(stats.foldToThreeBetOpportunities))), integer(stats.foldToThreeBet), integer(stats.foldToThreeBetOpportunities)),
      card('flopCBet', 'CBet', percentageText(percent(integer(stats.flopCBetMade), integer(stats.flopCBetOpportunities))), integer(stats.flopCBetMade), integer(stats.flopCBetOpportunities)),
      card('foldToFlopCBet', 'FCB', percentageText(percent(integer(stats.foldToFlopCBet), integer(stats.foldToFlopCBetOpportunities))), integer(stats.foldToFlopCBet), integer(stats.foldToFlopCBetOpportunities)),
      card('wtsd', 'WTSD', percentageText(percent(integer(stats.wentToShowdown), integer(stats.sawFlopForWTSD))), integer(stats.wentToShowdown), integer(stats.sawFlopForWTSD)),
      card('wsd', 'W$SD', percentageText(percent(integer(stats.wonMoneyAtShowdown), integer(stats.showdownsForWSD))), integer(stats.wonMoneyAtShowdown), integer(stats.showdownsForWSD))
    ];
  }
  function fromCareer(stats) {
    if (!stats || !stats.counters) return [];
    var c = stats.counters;
    return [
      card('hands', 'Hands', String(integer(c.hands)), integer(c.hands), null, 'Finalized hands'),
      card('vpip', 'VPIP', percentageText(percent(integer(c.vpipMade), integer(c.vpipOpportunities))), integer(c.vpipMade), integer(c.vpipOpportunities)),
      card('pfr', 'PFR', percentageText(percent(integer(c.pfrMade), integer(c.pfrOpportunities))), integer(c.pfrMade), integer(c.pfrOpportunities)),
      card('af', 'AF', afText(integer(c.postflopAggressiveActions), integer(c.postflopCalls)), integer(c.postflopAggressiveActions), integer(c.postflopCalls), integer(c.postflopAggressiveActions) + ' aggressive / ' + integer(c.postflopCalls) + ' calls'),
      card('threeBet', '3Bet', percentageText(percent(integer(c.threeBetMade), integer(c.threeBetOpportunities))), integer(c.threeBetMade), integer(c.threeBetOpportunities)),
      card('foldToThreeBet', 'F3B', percentageText(percent(integer(c.foldToThreeBet), integer(c.foldToThreeBetOpportunities))), integer(c.foldToThreeBet), integer(c.foldToThreeBetOpportunities)),
      card('flopCBet', 'CBet', percentageText(percent(integer(c.flopCBetMade), integer(c.flopCBetOpportunities))), integer(c.flopCBetMade), integer(c.flopCBetOpportunities)),
      card('foldToFlopCBet', 'FCB', percentageText(percent(integer(c.foldToFlopCBet), integer(c.foldToFlopCBetOpportunities))), integer(c.foldToFlopCBet), integer(c.foldToFlopCBetOpportunities)),
      card('wtsd', 'WTSD', percentageText(percent(integer(c.wtsdMade), integer(c.wtsdOpportunities))), integer(c.wtsdMade), integer(c.wtsdOpportunities)),
      card('wsd', 'W$SD', percentageText(percent(integer(c.wsdMade), integer(c.wsdOpportunities))), integer(c.wsdMade), integer(c.wsdOpportunities))
    ];
  }
  function cardsFor(value, mode) { return mode === 'career' || value && value.counters ? fromCareer(value) : fromSession(value); }
  function cardsByIds(cards, ids) { return ids.map(function (id) { return cards.find(function (item) { return item.id === id; }); }).filter(Boolean); }
  function cardsHtml(cards) { return cards.map(function (item) { return '<article class="pnhud-dashboard-stat pnhud-dashboard-stat-' + esc(item.id) + '"><span>' + esc(item.label) + '</span><strong>' + esc(item.value) + '</strong><small>' + esc(item.sample) + '</small></article>'; }).join(''); }
  function relationalCards(state, mode, overallCards) {
    if (!state.opponentMode || state.opponentMode === 'overall') return cardsByIds(overallCards, RELATIONAL_IDS);
    var sources = state.relationalStats || {};
    return RELATIONAL_IDS.map(function (id) { var cards = cardsFor(sources[id], mode); return cards.find(function (item) { return item.id === id; }) || card(id, id === 'threeBet' ? '3Bet' : id === 'foldToThreeBet' ? 'F3B' : 'FCB', '---', 0, 0); });
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
  function profileHtml(profile) {
    if (!profile) return '<section class="pnhud-dashboard-section"><h3>Current profile</h3><p class="pnhud-dashboard-empty">No current profile available.</p></section>';
    var displayed = profile.displayedArchetype || null; var raw = profile.rawArchetype || null; var scores = profile.rawScores || {};
    var rows = PROFILE_ORDER.map(function (name) { var score = Number(scores[name]); var value = Number.isFinite(score) && score >= 0 ? Math.round(score * 1000) / 10 : 0; return '<div><span>' + esc(name) + '</span><strong>' + value + '%</strong></div>'; }).join('');
    var labels = '<p class="pnhud-dashboard-profile-labels">' + (displayed ? 'Displayed profile: <strong>' + esc(displayed) + '</strong>' : 'Displayed profile unavailable') + (raw && raw !== displayed ? '<span>Current raw classification: <strong>' + esc(raw) + '</strong></span>' : '') + '</p>';
    return '<section class="pnhud-dashboard-section"><h3>Current profile</h3>' + labels + profileExplanationHtml(profile.explanation) + '<h4>Profile fit</h4><div class="pnhud-dashboard-profile-fit">' + rows + '</div><p class="pnhud-dashboard-help">Current profile is not recalculated by dashboard filters. Compatibility scores are independent and are not probabilities.</p></section>';
  }
  function positionControl(position) {
    var options = ['<option value="">All positions</option>'].concat(POSITION_OPTIONS.map(function (label) { return '<option value="' + label + '"' + (position === label ? ' selected' : '') + '>' + label + '</option>'; }));
    return '<label class="pnhud-dashboard-position"><span>Position</span><select data-dashboard-position aria-label="Position filter">' + options.join('') + '</select></label>';
  }
  function opponentControl(state) {
    var mode = state.opponentMode || 'overall'; var unavailable = !state.selfPlayerId; var selfDashboard = Boolean(state.selfPlayerId && String(state.selfPlayerId) === String(state.playerId));
    function button(value, text, disabled, title) { return '<button type="button" data-dashboard-opponent="' + value + '" aria-pressed="' + (mode === value) + '" class="' + (mode === value ? 'active' : '') + '"' + (disabled ? ' disabled' : '') + (title ? ' title="' + esc(title) + '"' : '') + '>' + text + '</button>'; }
    return '<div class="pnhud-dashboard-opponent" role="group" aria-label="Relational opponent context"><span>Opponent</span><div>' + button('overall', 'Overall', false) + button('self', 'Vs You', unavailable || selfDashboard, selfDashboard ? 'Self-vs-self comparisons are not meaningful' : unavailable ? 'Canonical self identity is unavailable' : '') + button('others', 'Vs Everyone Else', unavailable, unavailable ? 'Canonical self identity is unavailable' : '') + '</div></div>';
  }
  function coverageHtml(state, coverage, mode, position) {
    coverage = coverage || {}; var total = integer(mode === 'career' ? coverage.totalCareerHands : coverage.totalSessionHands); var tracked = integer(coverage.positionTrackedHands); var matched = integer(coverage.matchedPositionHands);
    if (position) return '<p class="pnhud-dashboard-coverage"><strong>' + esc(position) + '</strong> · ' + matched + ' tracked ' + (matched === 1 ? 'hand' : 'hands') + '<span>' + total + ' total ' + (mode === 'career' ? 'career' : 'session') + ' hands · ' + tracked + ' position-tracked</span></p>';
    return '<p class="pnhud-dashboard-coverage"><strong>All positions</strong> · ' + total + ' total ' + (total === 1 ? 'hand' : 'hands') + '<span>Position-tracked: ' + tracked + ' hands</span></p>';
  }
  function requestMatches(state, snapshot) {
    return Boolean(state && snapshot && state.open && String(state.playerId) === String(snapshot.playerId) && state.mode === snapshot.mode && (state.position || null) === (snapshot.position || null) && (state.opponentMode || 'overall') === (snapshot.opponentMode || 'overall') && state.requestToken === snapshot.requestToken);
  }
  function render(state) {
    state = state || {}; var mode = state.mode === 'career' ? 'career' : 'session'; var position = POSITION_OPTIONS.indexOf(state.position) >= 0 ? state.position : null; var modeLabel = mode === 'career' ? 'Career' : 'Current session';
    var source = state.coreStats || (mode === 'career' ? state.careerStats : state.sessionStats); var cards = cardsFor(source, mode); var hands = cards.length ? cards[0].numerator : 0; var coverage = source && source.coverage || {};
    var name = state.displayName || 'Tracked player'; var noteValue = Object.prototype.hasOwnProperty.call(state, 'noteDraft') ? state.noteDraft : state.note; var headerProfile = state.profile && (state.profile.displayedArchetype || state.profile.rawArchetype); var context = modeLabel + (position ? ' · ' + position : '') + ' · ' + hands + ' ' + (hands === 1 ? 'hand' : 'hands');
    if (mode === 'career' && state.careerTrackingStartedAt) context += ' · Tracked since ' + new Date(state.careerTrackingStartedAt).toLocaleDateString();
    var coreCards = cardsByIds(cards, CORE_IDS); var relationCards = relationalCards(state, mode, cards); var noPositionSample = Boolean(position && !state.loading && integer(coverage.matchedPositionHands) === 0);
    var coreBody = state.loading ? '<p class="pnhud-dashboard-empty" role="status">Loading career statistics and filters...</p>' : state.error ? '<p class="pnhud-dashboard-error" role="status">' + esc(state.error) + '</p>' : noPositionSample ? '<p class="pnhud-dashboard-empty">No position-tracked hands for ' + esc(position) + ' yet.</p>' : !cards.length ? '<p class="pnhud-dashboard-empty">No ' + (mode === 'career' ? 'career' : 'session') + ' hands tracked yet.</p>' : '<div class="pnhud-dashboard-stat-grid pnhud-dashboard-core-grid">' + cardsHtml(coreCards) + '</div>';
    var relationContext = position ? position + ' · ' : ''; relationContext += state.opponentMode === 'self' ? 'Vs You' : state.opponentMode === 'others' ? 'Vs Everyone Else' : 'Overall';
    var relationBody = state.loading ? '<p class="pnhud-dashboard-empty">Loading relational samples...</p>' : noPositionSample ? '<p class="pnhud-dashboard-empty">No supported relational sample for this position.</p>' : '<div class="pnhud-dashboard-stat-grid pnhud-dashboard-relational-grid">' + cardsHtml(relationCards) + '</div>';
    var relationalCoverage = state.opponentMode && state.opponentMode !== 'overall' ? relationCards.reduce(function (sum, item) { return sum + integer(item.denominator); }, 0) : null;
    return '<div class="pnhud-dashboard-window" role="document"><header><div><div class="pnhud-dashboard-title"><h2>' + esc(name) + '</h2>' + (headerProfile ? '<span class="pnhud-dashboard-header-profile">' + esc(headerProfile) + '</span>' : '') + '</div><p>' + esc(context) + '</p><small title="Canonical stable player ID">ID ' + esc(state.playerId) + '</small></div><button type="button" class="pnhud-dashboard-close" aria-label="Close player dashboard">×</button></header><div class="pnhud-dashboard-body"><div class="pnhud-dashboard-filter-row"><div class="pnhud-dashboard-tabs" role="tablist" aria-label="Statistics window"><button type="button" role="tab" data-dashboard-mode="session" aria-selected="' + (mode === 'session') + '" class="' + (mode === 'session' ? 'active' : '') + '">Session</button><button type="button" role="tab" data-dashboard-mode="career" aria-selected="' + (mode === 'career') + '" class="' + (mode === 'career' ? 'active' : '') + '">Career</button></div>' + positionControl(position) + '</div><section class="pnhud-dashboard-section"><h3>Core stats</h3>' + coverageHtml(state, coverage, mode, position) + coreBody + '</section><section class="pnhud-dashboard-section pnhud-dashboard-relational"><div class="pnhud-dashboard-section-heading"><div><h3>Relational stats</h3><small>' + esc(relationContext) + '</small></div>' + opponentControl(state) + '</div>' + relationBody + (relationalCoverage !== null ? '<p class="pnhud-dashboard-help">' + relationalCoverage + ' supported relational ' + (relationalCoverage === 1 ? 'opportunity' : 'opportunities') + ' across 3Bet, F3B, and FCB. Missing counterpart history is excluded.</p>' : '<p class="pnhud-dashboard-help">Opponent context applies only to 3Bet, F3B, and FCB.</p>') + '</section>' + profileHtml(state.profile) + '<section class="pnhud-dashboard-section"><div class="pnhud-dashboard-notes-heading"><h3>Notes</h3><span class="pnhud-dashboard-note-status" role="status" aria-live="polite">' + esc(state.noteStatus || '') + '</span></div><textarea class="pnhud-dashboard-note" maxlength="5000" aria-label="Notes for ' + esc(name) + '" placeholder="Add a private note about this player...">' + esc(noteValue || '') + '</textarea><div class="pnhud-dashboard-note-actions"><button type="button" class="pnhud-dashboard-save-note">Save Note</button><button type="button" class="pnhud-dashboard-clear-note"' + (!noteValue ? ' disabled' : '') + '>Clear Note</button></div><p class="pnhud-dashboard-help">Notes are keyed only by stable player ID and are unaffected by dashboard filters.</p></section></div></div>';
  }
  return Object.freeze({ PROFILE_ORDER: PROFILE_ORDER, POSITION_OPTIONS: POSITION_OPTIONS, CORE_IDS: CORE_IDS, RELATIONAL_IDS: RELATIONAL_IDS, fromSession: fromSession, fromCareer: fromCareer, requestMatches: requestMatches, render: render, percentageText: percentageText, afText: afText });
});
