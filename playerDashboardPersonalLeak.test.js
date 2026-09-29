'use strict';
var assert = require('assert');
var Dashboard = require('./playerDashboard.js');
function counters(vpip, pfr, cbet) {
  return { counters: { hands: 100, vpipMade: vpip, vpipOpportunities: 100, pfrMade: pfr, pfrOpportunities: 100,
    threeBetMade: 8, threeBetOpportunities: 100, foldToThreeBet: 50, foldToThreeBetOpportunities: 100,
    flopCBetMade: cbet, flopCBetOpportunities: 100, foldToFlopCBet: 45, foldToFlopCBetOpportunities: 100,
    wtsdMade: 28, wtsdOpportunities: 100, postflopAggressiveActions: 20, postflopCalls: 20,
    wsdMade: 20, wsdOpportunities: 40 }, coverage: { totalSessionHands: 100, totalCareerHands: 100, positionTrackedHands: 100, matchedPositionHands: 100, situationTrackedHands: 100, matchedSituationHands: 100, tableSize3PlusHands: 100, tableSizeHands: { HU: 0, '3_TO_5': 0, SIX_PLUS: 100 } } };
}
function state() { return { open: true, playerId: 'hero-id', selfPlayerId: 'hero-id', displayName: 'Hero', mode: 'session',
  position: null, situation: 'overall', opponentMode: 'overall', coreStats: counters(40, 20, 75), careerAnalysisAll3Plus: true, relationalStats: {}, requestToken: 1 }; }
var selected = state(); var html = Dashboard.render(selected);
var changingSupport = state();
changingSupport.coreStats = counters(10, 10, 55);
changingSupport.coreStats.counters.hands = 49;
changingSupport.coreStats.counters.vpipOpportunities = 49;
changingSupport.coreStats.counters.pfrOpportunities = 49;
changingSupport.coreStats.coverage.totalSessionHands = 49;
changingSupport.coreStats.coverage.tableSize3PlusHands = 49;
changingSupport.coreStats.coverage.tableSizeHands.SIX_PLUS = 49;
assert.doesNotMatch(Dashboard.render(changingSupport), /data-review-signal-id="self-vpip-low"/, '49 supported opportunities remain below Moderate');
changingSupport.coreStats.counters.hands = 50;
changingSupport.coreStats.counters.vpipMade = 11;
changingSupport.coreStats.counters.pfrMade = 11;
changingSupport.coreStats.counters.vpipOpportunities = 50;
changingSupport.coreStats.counters.pfrOpportunities = 50;
changingSupport.coreStats.coverage.totalSessionHands = 50;
changingSupport.coreStats.coverage.tableSize3PlusHands = 50;
changingSupport.coreStats.coverage.tableSizeHands.SIX_PLUS = 50;
assert.match(Dashboard.render(changingSupport), /data-review-signal-id="self-vpip-low"/, 'newly Moderate support reveals a qualifying self signal');
changingSupport.playerId = 'opponent-id';
assert.match(Dashboard.render(changingSupport), /pnhud-dashboard-insights/, 'the same refreshed snapshot can reveal opponent Insights');
changingSupport.playerId = 'hero-id';
changingSupport.coreStats.counters.hands = 51;
changingSupport.coreStats.counters.vpipMade = 12;
changingSupport.coreStats.counters.pfrMade = 12;
changingSupport.coreStats.counters.vpipOpportunities = 51;
changingSupport.coreStats.counters.pfrOpportunities = 51;
changingSupport.coreStats.coverage.totalSessionHands = 51;
changingSupport.coreStats.coverage.tableSize3PlusHands = 51;
changingSupport.coreStats.coverage.tableSizeHands.SIX_PLUS = 51;
assert.doesNotMatch(Dashboard.render(changingSupport), /data-review-signal-id="self-vpip-low"/, 'the signal disappears once the updated rate no longer qualifies');
assert.match(html, /pnhud-dashboard-review-signals/);
assert.match(html, /Review Signals/);
assert.match(html, /<strong>Review passive preflop entries<\/strong><span class="pnhud-dashboard-analysis-reason">You enter substantially more pots than you raise/);
assert.match(html, /VPIP 40% · 100 opportunities · Strong/);
assert.match(html, /CBet 75% · 100 opportunities · Strong/);
assert.doesNotMatch(html, /Worth reviewing across similar situations|This supported rate is at an observed extreme/, 'verbose explanation paragraphs are gone');
[
  [{ vpipMade: 20, pfrMade: 15 }, 'self-vpip-low', 'Consider widening preflop participation'],
  [{ vpipMade: 40, pfrMade: 35 }, 'self-vpip-high', 'Review whether you enter too many pots'],
  [{ foldToThreeBet: 70 }, 'self-foldToThreeBet-high', 'Review whether you overfold to 3-bets'],
  [{ foldToThreeBet: 20 }, 'self-foldToThreeBet-low', 'Review whether you continue too widely vs 3-bets'],
  [{ foldToFlopCBet: 70 }, 'self-foldToFlopCBet-high', 'Review whether you overfold to flop CBets'],
  [{ foldToFlopCBet: 20 }, 'self-foldToFlopCBet-low', 'Review whether you continue too widely on flops'],
  [{ wtsdMade: 40 }, 'self-wtsd-high', 'Review whether you call down too often'],
  [{ wtsdMade: 10 }, 'self-wtsd-low', 'Review whether you give up too early']
].forEach(function (testCase) {
  var example = state(); example.coreStats = counters(30, 25, 55);
  Object.assign(example.coreStats.counters, testCase[0]);
  var rendered = Dashboard.render(example);
  assert.ok(rendered.includes('data-review-signal-id="' + testCase[1] + '"><strong>' + testCase[2] + '</strong>'),
    testCase[1] + ' displays a cautious review action before its reason');
});
selected.coreStats.counters.wtsdMade = 35;
html = Dashboard.render(selected);
assert.match(html, /W\$SD 50% · 40 showdowns · Strong/, 'W$SD context uses its showdown support unit');
selected.coreStats.counters.wtsdMade = 28;
assert.doesNotMatch(html, /pnhud-dashboard-insights/, 'self does not receive opponent Insights');
selected.playerId = 'other-id'; html = Dashboard.render(selected);
assert.doesNotMatch(html, /pnhud-dashboard-review-signals/, 'opponent never receives self analysis');
assert.match(html, /pnhud-dashboard-insights/, 'opponent Insights remain available');
selected.selfPlayerId = null; selected.playerId = 'hero-id';
assert.doesNotMatch(Dashboard.render(selected), /pnhud-dashboard-review-signals/, 'unknown canonical identity hides self analysis');
selected.selfPlayerId = 'hero-id'; selected.coreStats = counters(30, 25, 55);
assert.doesNotMatch(Dashboard.render(selected), /pnhud-dashboard-review-signals/, 'no qualifying signals hides section');
selected.mode = 'career'; selected.coreStats = counters(40, 20, 75);
assert.match(Dashboard.render(selected), /pnhud-dashboard-review-signals/, 'Career is derived independently');
selected.mode = 'session'; selected.coreStats = counters(30, 25, 55);
assert.doesNotMatch(Dashboard.render(selected), /pnhud-dashboard-review-signals/, 'source switch cannot retain Career signal');
selected.coreStats = counters(40, 20, 75); selected.position = 'BTN';
assert.match(Dashboard.render(selected), /Review Signals<\/h3><small>BTN/, 'exact selected position is labeled');
selected.coreStats = null;
assert.doesNotMatch(Dashboard.render(selected), /pnhud-dashboard-review-signals/, 'unavailable exact position does not borrow Overall');
selected.position = null; selected.situation = 'oop'; selected.coreStats = counters(40, 20, 75);
assert.match(Dashboard.render(selected), /Review Signals<\/h3><small>Out of position/, 'exact situation is labeled');
selected.opponentMode = 'others';
assert.match(Dashboard.render(selected), /pnhud-dashboard-review-signals/, 'opponent relational filter does not change self core cards');
selected.loading = true;
assert.doesNotMatch(Dashboard.render(selected), /pnhud-dashboard-review-signals/, 'loading hides stale self analysis');
selected.loading = false; selected.error = 'Unavailable';
assert.doesNotMatch(Dashboard.render(selected), /pnhud-dashboard-review-signals/, 'error hides self analysis');
selected.error = null; selected.mode = 'career';
var snapshot = { playerId: 'hero-id', mode: 'career', position: null, situation: 'oop', opponentMode: 'others', requestToken: 1 };
assert.strictEqual(Dashboard.requestMatches(selected, snapshot), true);
['playerId', 'mode', 'position', 'situation', 'opponentMode', 'requestToken'].forEach(function (key) {
  var prior = selected[key]; selected[key] = key === 'requestToken' ? 2 : 'changed';
  assert.strictEqual(Dashboard.requestMatches(selected, snapshot), false, 'stale ' + key + ' request fenced'); selected[key] = prior;
});
function exactSlice(position, situation, values) {
  var value = counters(30, 25, 55);
  Object.assign(value.counters, values);
  return Object.assign(value, { playerId: 'hero-id', filters: { position: position, situation: situation, statId: null, counterpartMode: null } });
}
var compared = state(); compared.coreStats = counters(30, 25, 55); compared.sessionRevision = 1;
compared.comparisonContexts = { playerId: 'hero-id', source: 'session', sessionRevision: 1,
  situations: {
    ip: exactSlice(null, 'ip', { flopCBetMade: 12, flopCBetOpportunities: 15, foldToFlopCBet: 12, foldToFlopCBetOpportunities: 15 }),
    oop: exactSlice(null, 'oop', { flopCBetMade: 8, flopCBetOpportunities: 15, foldToFlopCBet: 8, foldToFlopCBetOpportunities: 15 })
  }, positions: {
    BTN: exactSlice('BTN', null, { vpipMade: 40, vpipOpportunities: 60 }),
    CO: exactSlice('CO', null, { vpipMade: 18, vpipOpportunities: 60 }),
    BB: exactSlice('BB', null, { vpipMade: 36, vpipOpportunities: 60 })
  } };
html = Dashboard.render(compared);
assert.match(html, /data-review-signal-id="self-situationCBet-IP-OOP"/);
assert.match(html, /data-review-signal-id="self-situationFoldToCBet-IP-OOP"/);
assert.match(html, /data-review-signal-id="self-positionVpip-BTN-CO"/);
assert.match(html, /IP CBet 80% · 15 opportunities · Moderate<\/small><small class="pnhud-dashboard-analysis-evidence">OOP CBet 53\.3% · 15 opportunities · Moderate/,
  'comparison states both exact contexts, percentages, support counts, and Evidence sides');
assert.match(html, /IP FCB 80% · 15 opportunities · Moderate<\/small><small class="pnhud-dashboard-analysis-evidence">OOP FCB 53\.3% · 15 opportunities · Moderate/);
assert.match(html, /BTN VPIP 66\.7% · 60 opportunities · Moderate<\/small><small class="pnhud-dashboard-analysis-evidence">CO VPIP 30% · 60 opportunities · Moderate/);
assert.match(html, /<strong>Review your IP\/OOP CBet gap<\/strong><span class="pnhud-dashboard-analysis-reason">Your flop CBet rate is higher IP than OOP/);
var headsUpComparison = structuredClone(compared);
headsUpComparison.comparisonContexts.positions.BTN.coverage.tableSize3PlusHands = 0;
headsUpComparison.comparisonContexts.situations.ip.coverage.tableSize3PlusHands = 0;
headsUpComparison.comparisonContexts.positions.BTN.coverage.tableSizeHands = { HU: 100, '3_TO_5': 0, SIX_PLUS: 0 };
headsUpComparison.comparisonContexts.situations.ip.coverage.tableSizeHands = { HU: 100, '3_TO_5': 0, SIX_PLUS: 0 };
assert.doesNotMatch(Dashboard.render(headsUpComparison), /self-positionVpip-BTN-|self-situationCBet-|self-situationFoldToCBet-/,
  'a HU comparison side cannot borrow the 3+ threshold even when both sides have Moderate Evidence');
var mixedEvidence = structuredClone(compared);
mixedEvidence.comparisonContexts.situations.ip.counters.flopCBetMade = 32;
mixedEvidence.comparisonContexts.situations.ip.counters.flopCBetOpportunities = 40;
assert.match(Dashboard.render(mixedEvidence), /IP CBet 80% · 40 opportunities · Strong<\/small><small class="pnhud-dashboard-analysis-evidence">OOP CBet 53\.3% · 15 opportunities · Moderate/,
  'comparison keeps each side’s actual Evidence label instead of a combined label');
assert.strictEqual((html.match(/data-review-signal-id="self-positionVpip-/g) || []).length, 1, 'one deterministic position contrast');
compared.sessionRevision = 2;
assert.doesNotMatch(Dashboard.render(compared), /data-review-signal-id="self-situation/, 'stale Session bundle cannot join current cards');
compared.sessionRevision = 1;
compared.mode = 'career'; compared.careerRevision = 9; compared.comparisonContexts.source = 'career'; compared.comparisonContexts.playerRevision = 9;
assert.match(Dashboard.render(compared), /self-situationCBet-IP-OOP/, 'Career comparisons use the same exact card projection');
compared.careerRevision = 10;
assert.doesNotMatch(Dashboard.render(compared), /data-review-signal-id="self-situation/, 'stale Career revision cannot join current cards');
compared.mode = 'session'; compared.comparisonContexts.source = 'session';
compared.comparisonContexts.situations.oop.counters.flopCBetMade = 9;
compared.comparisonContexts.situations.oop.counters.foldToFlopCBet = 9;
html = Dashboard.render(compared);
assert.doesNotMatch(html, /self-situationCBet-/);
assert.doesNotMatch(html, /self-situationFoldToCBet-/);
compared.comparisonContexts.situations.oop.counters.flopCBetMade = 8;
compared.comparisonContexts.situations.oop.counters.foldToFlopCBet = 8;
compared.comparisonContexts.situations.oop.counters.flopCBetOpportunities = 14;
compared.comparisonContexts.situations.oop.counters.foldToFlopCBetOpportunities = 14;
html = Dashboard.render(compared);
assert.doesNotMatch(html, /self-situationCBet-/);
assert.doesNotMatch(html, /self-situationFoldToCBet-/);
compared.comparisonContexts.situations.oop = null;
assert.doesNotMatch(Dashboard.render(compared), /self-situationCBet-/, 'missing side cannot borrow Overall');
compared.coreStats = null; compared.position = 'UTG';
assert.match(Dashboard.render(compared), /self-positionVpip-BTN-CO/, 'comparison signal survives an unavailable selected filter');
compared.coreStats = counters(30, 25, 55); compared.position = null;
compared.comparisonContexts.positions.CO.counters.vpipOpportunities = 49;
assert.doesNotMatch(Dashboard.render(compared), /self-positionVpip-/, 'each compared position needs Moderate Evidence');
compared.comparisonContexts.source = 'career';
assert.doesNotMatch(Dashboard.render(compared), /data-review-signal-id="self-situation/, 'source mismatch hides comparison bundle');
compared.comparisonContexts.source = 'session'; compared.playerId = 'opponent-id';
assert.doesNotMatch(Dashboard.render(compared), /pnhud-dashboard-review-signals/, 'comparisons remain self-only');
console.log('Hero-only Dashboard Review Signals, source/filter, and request fencing regressions passed.');
