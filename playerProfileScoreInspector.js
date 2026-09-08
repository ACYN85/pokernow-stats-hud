/* Pure presentation model for the read-only Player Profile Score Decomposition inspector. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && !isSupportedRuntimePage(root.PokerNowRuntimeScope, window.location)) return;

  var FEATURE_LABELS = Object.freeze({ vpipRate: 'VPIP', pfrRate: 'PFR', vpipPfrGap: 'VPIP-PFR gap', pfrVpipRatio: 'PFR/VPIP ratio', threeBetRate: '3Bet', foldToThreeBetRate: 'F3B', flopCBetRate: 'CBet', foldToFlopCBetRate: 'FCB', wtsdRate: 'WTSD', wsdRate: 'W$SD', aggressionFrequency: 'Aggression Frequency', aggressionFactor: 'AF' });
  var ARCHETYPES = Object.freeze(['Nit', 'TAG', 'LAG', 'Tight Passive', 'Loose Passive', 'Calling Station', 'Maniac']);

  function isSupportedRuntimePage(scope, loc) {
    if (scope && typeof scope.isPokerNowGamePage === 'function') return scope.isPokerNowGamePage(loc);
    var host = String(loc && loc.hostname || '').toLowerCase();
    return String(loc && loc.protocol || '').toLowerCase() === 'https:' && (host === 'pokernow.com' || host === 'www.pokernow.com') && /^\/games\/[^/]+\/?$/.test(String(loc && loc.pathname || ''));
  }
  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function escapeHtml(value) { return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (character) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]; }); }
  function shortStableId(playerId) { playerId = String(playerId || 'unknown'); return playerId.length <= 16 ? playerId : playerId.slice(0, 8) + '…' + playerId.slice(-5); }
  function number(value, digits) { return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits === undefined ? 3 : digits) : '—'; }
  function percent(value) { return typeof value === 'number' && Number.isFinite(value) ? (value * 100).toFixed(1) + '%' : '—'; }
  function featureValue(feature, value) { return feature === 'aggressionFactor' || feature === 'pfrVpipRatio' ? number(value) : percent(value); }
  function rawFeatureValue(feature, value) { return value === 'infinity' ? '∞' : featureValue(feature, value); }
  function rawAuditValue(feature) {
    var raw = rawFeatureValue(feature.feature, feature.rawValue);
    if (!Number.isFinite(feature.numerator) || !Number.isFinite(feature.denominator)) return raw;
    if (feature.feature === 'aggressionFactor') return raw + ' (' + feature.numerator + ' aggressive actions / ' + feature.denominator + ' calls)';
    return raw + ' (' + feature.numerator + '/' + feature.denominator + ')';
  }
  function label(feature) { return FEATURE_LABELS[feature] || feature; }
  function createState() { return { selectedPlayerId: null, decomposition: null, record: null, details: {} }; }
  function players(entries) {
    return (Array.isArray(entries) ? entries : []).filter(function (entry) { return entry && entry.playerId; }).map(function (entry) {
      return { playerId: String(entry.playerId), displayName: String(entry.displayName || 'Unknown player'), hands: Number(entry.hands || 0) };
    }).sort(function (left, right) { return left.displayName.localeCompare(right.displayName) || left.playerId.localeCompare(right.playerId); });
  }
  function clearSelection(state) { state.selectedPlayerId = null; state.decomposition = null; state.record = null; }
  function select(state, entries, playerId) {
    var id = String(playerId || '');
    var found = players(entries).some(function (entry) { return entry.playerId === id; });
    if (!found) { clearSelection(state); return false; }
    state.selectedPlayerId = id; state.decomposition = null; state.record = null; return true;
  }
  function inspect(state, entries, lookup) {
    var selected = players(entries).find(function (entry) { return entry.playerId === state.selectedPlayerId; });
    if (!selected) { state.decomposition = null; state.record = null; return false; }
    var result = lookup && lookup(selected.playerId);
    state.decomposition = result && result.decomposition ? clone(result.decomposition) : null;
    state.record = result && result.record ? clone(result.record) : null;
    return Boolean(state.decomposition);
  }
  function toggleDetails(state, archetype) { state.details[archetype] = !state.details[archetype]; return state.details[archetype]; }
  function createUiController(options) {
    options = options || {};
    var revision = 0;
    var defer = typeof options.defer === 'function' ? options.defer : function (callback) { setTimeout(callback, 0); };
    function currentEntries() { return typeof options.entries === 'function' ? options.entries() : []; }
    function readLatest() { return inspect(options.state, currentEntries(), options.lookup); }
    function change(playerId) {
      var changed = select(options.state, currentEntries(), playerId);
      var selectedPlayerId = options.state.selectedPlayerId;
      var scheduledRevision = ++revision;
      defer(function () {
        if (scheduledRevision !== revision || options.state.selectedPlayerId !== selectedPlayerId) return;
        readLatest();
        if (typeof options.render === 'function') options.render('.pnhud-profile-score-player');
      });
      return changed;
    }
    function inspectLatest() {
      revision += 1;
      var inspected = readLatest();
      if (typeof options.render === 'function') options.render('.pnhud-inspect-profile-score');
      return inspected;
    }
    function ensureSelection() {
      var entries = currentEntries();
      var selectedExists = entries.some(function (entry) { return entry && String(entry.playerId) === options.state.selectedPlayerId; });
      if (!selectedExists) {
        if (!entries.length) { clearSelection(options.state); return false; }
        select(options.state, entries, entries[0].playerId);
      }
      if (!options.state.decomposition) readLatest();
      return Boolean(options.state.decomposition);
    }
    return Object.freeze({ change: change, inspectLatest: inspectLatest, ensureSelection: ensureSelection });
  }
  function model(state, entries) {
    var available = players(entries);
    var selected = available.find(function (entry) { return entry.playerId === state.selectedPlayerId; }) || null;
    var decomposition = selected ? state.decomposition : null;
    var record = selected ? state.record || {} : {};
    var primary = record.primary || {};
    var supported = decomposition && decomposition.supportedFeatures || {};
    var featureDiagnostics = decomposition && decomposition.featureDiagnostics || {};
    var ranks = decomposition && decomposition.ranking || [];
    var rankByName = {};
    ranks.forEach(function (name, index) { rankByName[name] = index + 1; });
    var archetypes = decomposition ? ARCHETYPES.map(function (name) {
      var entry = decomposition.archetypes && decomposition.archetypes[name] || {};
      return { name: name, rank: rankByName[name] || null, finalScore: entry.finalScore, unadjustedScore: entry.unadjustedScore, weightedScore: entry.weightedScore, normalizationDenominator: entry.normalizationDenominator, evidenceCoverage: entry.evidenceCoverage, eligibility: entry.semanticEligibility || {}, compatibility: entry.scoreCompatibility || {}, evidence: entry.evidence || [], expanded: Boolean(state.details[name]) };
    }) : [];
    var bestCandidate = primary.bestCandidate || ranks[0] || null;
    var runnerUp = primary.runnerUp || ranks[1] || null;
    function archetypeScore(name) { return name && decomposition.archetypes && decomposition.archetypes[name] ? decomposition.archetypes[name].finalScore : null; }
    return {
      players: available,
      selected: selected,
      decomposition: decomposition,
      empty: available.length === 0,
      unavailable: Boolean(selected && !decomposition),
      summary: decomposition ? {
        asOfHand: decomposition.asOfHand || decomposition.lastFinalizedHandId || null,
        snapshotVersion: decomposition.snapshotVersion,
        hands: record.hands === undefined ? selected.hands : record.hands,
        effectiveTableSize: decomposition.tableContext && decomposition.tableContext.effectiveTableSize,
        tableStatus: decomposition.tableContext && decomposition.tableContext.status,
        tableUnsupportedReason: decomposition.tableContext && decomposition.tableContext.unsupportedReason,
        rawClassification: primary.archetype || 'Unavailable',
        status: primary.classificationStatus || 'unavailable',
        unsupportedReason: primary.unsupportedReason || null,
        bestCandidate: bestCandidate,
        bestScore: archetypeScore(bestCandidate),
        runnerUp: runnerUp,
        runnerUpScore: archetypeScore(runnerUp),
        margin: primary.scoreMargin,
        minimumPrimaryHands: decomposition.gates && decomposition.gates.minimumPrimaryHands,
        provisionalScores: primary.classificationStatus === 'insufficient_sample',
        hasScoreEvidence: archetypes.some(function (entry) { return Number(entry.normalizationDenominator || 0) > 0; }),
        features: Object.keys(FEATURE_LABELS).map(function (feature) {
          var diagnostic = featureDiagnostics[feature]; var scoringValue = supported[feature];
          if (!diagnostic) return { feature: feature, label: label(feature), numerator: null, denominator: null, rawValue: null, stabilizedValue: scoringValue && scoringValue.stabilizedRate, opportunities: scoringValue && scoringValue.opportunities, confidence: scoringValue && scoringValue.confidence, dataAvailable: Boolean(scoringValue), scoringSupported: Boolean(scoringValue), scoringUnsupportedReason: null };
          return { feature: feature, label: label(feature), numerator: diagnostic.numerator, denominator: diagnostic.denominator, rawValue: diagnostic.rawValue === 'infinity' ? 'infinity' : diagnostic.rawRate, stabilizedValue: diagnostic.stabilizedRate, opportunities: diagnostic.opportunities, confidence: diagnostic.confidence, dataAvailable: diagnostic.dataAvailable === true, scoringSupported: diagnostic.scoringSupported === true, scoringUnsupportedReason: diagnostic.scoringUnsupportedReason || null };
        })
      } : null,
      archetypes: archetypes
    };
  }
  function summaryText(modelValue) {
    if (!modelValue || !modelValue.selected) return 'No player is selected.';
    if (!modelValue.decomposition) return 'Profile decomposition unavailable for ' + modelValue.selected.displayName + ' (' + modelValue.selected.playerId + ').';
    var s = modelValue.summary;
    var lines = ['Player: ' + modelValue.selected.displayName, 'Stable ID: ' + modelValue.selected.playerId, 'As of hand: ' + (s.asOfHand || '—'), 'Snapshot version: ' + (Number.isFinite(s.snapshotVersion) ? s.snapshotVersion : '—'), 'Hands: ' + s.hands, 'Effective Table Size: ' + number(s.effectiveTableSize, 2), 'Classification: ' + s.rawClassification + ' (' + s.status + ')'];
    if (!s.provisionalScores || s.hasScoreEvidence) lines.push((s.provisionalScores ? 'Diagnostic/provisional top candidate: ' : 'Top candidate: ') + s.bestCandidate + ' ' + number(s.bestScore), 'Second-best fit: ' + s.runnerUp + ' ' + number(s.runnerUpScore), 'Fit margin: ' + number(s.margin));
    else lines.push('Archetype scores: gated; available features do not yet meet classifier scoring-support thresholds.');
    lines.push('Features: ' + s.features.map(function (feature) { return feature.label + ' ' + (feature.dataAvailable ? 'raw ' + rawAuditValue(feature) + ', stabilized ' + featureValue(feature.feature, feature.stabilizedValue) + ' (n=' + feature.opportunities + ', c=' + number(feature.confidence) + ')' : 'unsupported'); }).join('; '));
    var tag = modelValue.archetypes.find(function (entry) { return entry.name === 'TAG'; });
    if (tag && (!s.provisionalScores || s.hasScoreEvidence)) lines.push('TAG: VPIP membership ' + membershipText(tag, 'vpipRate') + '; unadjusted ' + number(tag.unadjustedScore) + '; compatibility ' + number(tag.compatibility && tag.compatibility.scale) + '; final ' + number(tag.finalScore));
    if (!s.provisionalScores || s.hasScoreEvidence) lines.push((s.provisionalScores ? 'Diagnostic/provisional scores: ' : 'Scores: ') + modelValue.archetypes.map(function (entry) { return entry.name + ' ' + number(entry.finalScore); }).join('; '));
    return lines.join('\n');
  }
  function jsonText(modelValue) { return JSON.stringify(modelValue && modelValue.decomposition ? modelValue.decomposition : null, null, 2); }
  function membershipText(entry, feature) { var evidence = (entry.evidence || []).find(function (item) { return item.feature === feature; }); return evidence ? number(evidence.membership) : '—'; }
  function featureRows(summary) { return summary.features.map(function (feature) { var status = feature.scoringSupported ? 'Scoring eligible' : feature.dataAvailable ? 'Available; provisional' : 'Unsupported'; return '<tr><th>' + escapeHtml(feature.label) + '</th><td>' + (feature.dataAvailable ? escapeHtml(rawAuditValue(feature)) : 'Unsupported') + '</td><td>' + (feature.dataAvailable ? featureValue(feature.feature, feature.stabilizedValue) : '—') + '</td><td>' + (feature.dataAvailable ? escapeHtml(feature.opportunities) : '—') + '</td><td>' + (feature.dataAvailable ? number(feature.confidence) : '—') + '</td><td title="' + escapeHtml(feature.scoringUnsupportedReason || '') + '">' + escapeHtml(status) + '</td></tr>'; }).join(''); }
  function listContains(list, feature) { return Array.isArray(list) && list.indexOf(feature) >= 0; }
  function requirementState(eligibility, feature) {
    if (listContains(eligibility.unsupportedRequiredFeatures, feature)) return 'Required / unsupported';
    if (listContains(eligibility.contradictoryFeatures, feature)) return 'Required / contradictory';
    if (listContains(eligibility.compatibleRequiredFeatures, feature)) return 'Required / compatible';
    if (listContains(eligibility.requiredFeatures, feature)) return 'Required';
    if (listContains(eligibility.positiveFeatures, feature)) return 'Positive gate';
    return 'Optional';
  }
  function evidenceRows(entry) {
    var eligibility = entry.eligibility || {};
    var rows = (entry.evidence || []).map(function (item) { return { item: item, supported: true, gate: requirementState(eligibility, item.feature) }; });
    (eligibility.unsupportedRequiredFeatures || []).forEach(function (feature) {
      if (!rows.some(function (row) { return row.item.feature === feature; })) rows.push({ item: { feature: feature }, supported: false, gate: 'Required / unsupported' });
    });
    return rows;
  }
  function evidenceHtml(entry) {
    var eligibility = entry.eligibility || {};
    var rows = evidenceRows(entry);
    var gate = eligibility.eligible ? 'Pass' : 'Fail';
    if (eligibility.reason) gate += ': ' + eligibility.reason;
    return '<details class="pnhud-profile-score-evidence"' + (entry.expanded ? ' open' : '') + '><summary><button type="button" data-pnhud-profile-score-details="' + escapeHtml(entry.name) + '">' + (entry.expanded ? 'Hide' : 'Show') + ' evidence</button><span>Coverage ' + number(entry.evidenceCoverage) + ' · Gate ' + escapeHtml(gate) + '</span></summary><div class="pnhud-profile-score-evidence-scroll"><table><thead><tr><th>Feature</th><th>Value</th><th>Member.</th><th>Weight</th><th>Conf.</th><th>Eff. weight</th><th>Contribution</th><th>Support</th><th>Requirement / gate</th></tr></thead><tbody>' + (rows.length ? rows.map(function (row) { var item = row.item; return '<tr><th>' + escapeHtml(label(item.feature)) + '</th><td>' + featureValue(item.feature, item.stabilizedRate) + '</td><td>' + number(item.membership) + '</td><td>' + number(item.weight) + '</td><td>' + number(item.confidence) + '</td><td>' + number(item.effectiveWeight) + '</td><td>' + number(item.weightedContribution) + '</td><td>' + (row.supported ? 'Supported' : 'Unsupported') + '</td><td>' + escapeHtml(row.gate) + '</td></tr>'; }).join('') : '<tr><td colspan="9">No supported evidence.</td></tr>') + '</tbody></table></div></details>';
  }
  function renderHtml(modelValue) {
    var options = modelValue.players.map(function (player) { return '<option value="' + escapeHtml(player.playerId) + '"' + (modelValue.selected && player.playerId === modelValue.selected.playerId ? ' selected' : '') + '>' + escapeHtml(player.displayName) + ' — ' + escapeHtml(shortStableId(player.playerId)) + '</option>'; }).join('');
    var controls = '<div class="pnhud-profile-score-controls"><label>Player <select class="pnhud-profile-score-player"' + (modelValue.empty ? ' disabled' : '') + '><option value="">Select a player</option>' + options + '</select></label><button type="button" class="pnhud-inspect-profile-score"' + (modelValue.selected ? '' : ' disabled') + '>Refresh</button></div>';
    if (modelValue.empty) return '<section class="pnhud-profile-score-inspector"><h3>Player Profile Score Decomposition</h3>' + controls + '<p class="pnhud-profile-score-empty" role="status">No player profiles are available yet.</p></section>';
    if (!modelValue.decomposition) return '<section class="pnhud-profile-score-inspector"><h3>Player Profile Score Decomposition</h3>' + controls + '<p class="pnhud-profile-score-empty" role="status">' + (modelValue.selected ? 'Profile decomposition unavailable for this player.' : 'Select a player, then inspect the latest decomposition.') + '</p></section>';
    var s = modelValue.summary;
    var rows = modelValue.archetypes.map(function (entry) {
      var tag = entry.name === 'TAG'; var eligibility = entry.eligibility || {};
      var gateText = eligibility.eligible ? 'Pass' : 'Fail' + (eligibility.reason ? ': ' + eligibility.reason : '');
      return '<tr><th>' + escapeHtml(entry.name) + '</th><td>' + (entry.rank || '—') + '</td><td>' + number(entry.finalScore) + '</td><td>' + number(entry.unadjustedScore) + '</td><td>' + escapeHtml(gateText) + '</td><td>' + (tag ? membershipText(entry, 'vpipRate') : '—') + '</td><td>' + (tag ? number(entry.compatibility && entry.compatibility.scale) : '—') + '</td></tr><tr class="pnhud-profile-score-detail-row"><td colspan="7">' + evidenceHtml(entry) + '</td></tr>';
    }).join('');
    var reason = s.unsupportedReason || s.tableUnsupportedReason;
    var scoreSummary = s.provisionalScores && !s.hasScoreEvidence ? '<div class="pnhud-profile-score-summary-wide"><dt>Archetype scoring</dt><dd>Gated — available feature data does not yet meet classifier scoring-support thresholds.</dd></div>' : '<div><dt>' + (s.provisionalScores ? 'Provisional top candidate' : 'Top candidate') + '</dt><dd>' + escapeHtml(s.bestCandidate) + ' ' + number(s.bestScore) + '</dd></div><div><dt>Second-best fit</dt><dd>' + escapeHtml(s.runnerUp) + ' ' + number(s.runnerUpScore) + '</dd></div><div><dt>Fit margin</dt><dd>' + number(s.margin) + '</dd></div>';
    var scoreSection = s.provisionalScores && !s.hasScoreEvidence ? '<h4>Archetype scores</h4><p class="pnhud-profile-score-gated">No provisional archetype score is shown because none of the available features yet meets the unchanged classifier scoring-support thresholds. Classification still requires at least ' + escapeHtml(s.minimumPrimaryHands) + ' hands.</p>' : '<h4>' + (s.provisionalScores ? 'Diagnostic / provisional archetype scores' : 'Archetype scores') + '</h4><div class="pnhud-profile-score-table-scroll"><table><thead><tr><th>Archetype</th><th>Rank</th><th>Final score</th><th>Unadjusted score</th><th>Eligibility / gate</th><th>TAG VPIP membership</th><th>TAG compatibility scale</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    return '<section class="pnhud-profile-score-inspector" aria-labelledby="pnhud-profile-score-title"><div class="pnhud-profile-score-heading"><div><h3 id="pnhud-profile-score-title">Player Profile Score Decomposition</h3><p>Read-only current classifier evidence</p></div></div>' + controls + '<div class="pnhud-profile-score-body" tabindex="0"><dl class="pnhud-profile-score-summary"><div class="pnhud-profile-score-summary-player"><dt>Player</dt><dd><strong class="pnhud-profile-score-player-name">' + escapeHtml(modelValue.selected.displayName) + '</strong><small class="pnhud-profile-score-player-id">' + escapeHtml(modelValue.selected.playerId) + '</small></dd></div><div><dt>As of hand</dt><dd>' + escapeHtml(s.asOfHand || '—') + '</dd></div><div><dt>Snapshot version</dt><dd>' + (Number.isFinite(s.snapshotVersion) ? s.snapshotVersion : '—') + '</dd></div><div><dt>Hands</dt><dd>' + s.hands + '</dd></div><div><dt>Effective table size</dt><dd>' + number(s.effectiveTableSize, 2) + '</dd></div><div><dt>Classification</dt><dd>' + escapeHtml(s.rawClassification) + '</dd></div><div><dt>Status</dt><dd>' + escapeHtml(s.status) + '</dd></div>' + scoreSummary + (reason ? '<div class="pnhud-profile-score-summary-wide"><dt>Diagnostic reason</dt><dd>' + escapeHtml(reason) + '</dd></div>' : '') + '</dl><h4>Feature data</h4><div class="pnhud-profile-score-table-scroll"><table><thead><tr><th>Feature</th><th>Raw (count)</th><th>Stabilized</th><th>Opp.</th><th>Conf.</th><th>Classifier scoring</th></tr></thead><tbody>' + featureRows(s) + '</tbody></table></div>' + scoreSection + '</div><div class="pnhud-profile-score-copy-actions"><button type="button" class="pnhud-copy-profile-score-summary">Copy Summary</button><button type="button" class="pnhud-copy-profile-score-json">Copy JSON</button><span class="pnhud-profile-score-copy-status" role="status" aria-live="polite"></span></div></section>';
  }
  var api = Object.freeze({ FEATURE_LABELS: FEATURE_LABELS, ARCHETYPES: ARCHETYPES, createState: createState, createUiController: createUiController, select: select, inspect: inspect, toggleDetails: toggleDetails, buildModel: model, summaryText: summaryText, jsonText: jsonText, renderHtml: renderHtml, shortStableId: shortStableId });
  root.PokerPlayerProfileScoreInspector = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
