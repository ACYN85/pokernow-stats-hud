'use strict';
var assert = require('assert');
var Dashboard = require('./playerDashboard.js');
function counters(vpip, pfr, f3b) {
  return { counters: { hands: 100, vpipMade: vpip, vpipOpportunities: 100, pfrMade: pfr, pfrOpportunities: 100,
    threeBetMade: 4, threeBetOpportunities: 100, foldToThreeBet: f3b, foldToThreeBetOpportunities: 100,
    flopCBetMade: 70, flopCBetOpportunities: 100, foldToFlopCBet: 60, foldToFlopCBetOpportunities: 100,
    wtsdMade: 35, wtsdOpportunities: 100, postflopAggressiveActions: 20, postflopCalls: 20, wsdMade: 20, wsdOpportunities: 40 }, coverage: { totalSessionHands: 100, totalCareerHands: 100, positionTrackedHands: 100, matchedPositionHands: 100, situationTrackedHands: 100, matchedSituationHands: 100, tableSize3PlusHands: 100, tableSizeHands: { HU: 0, '3_TO_5': 0, SIX_PLUS: 100 } } };
}
function state() { return { open: true, playerId: 'p1', selfPlayerId: 'hero', displayName: 'Opponent', mode: 'career', position: null, situation: 'overall', opponentMode: 'overall', coreStats: counters(40, 20, 70), careerAnalysisAll3Plus: true, relationalStats: {}, requestToken: 4 }; }
var selected = state();
var html = Dashboard.render(selected);
assert.match(html, /pnhud-dashboard-insights/);
assert.match(html, /Plays more hands than they raise preflop/);
assert.match(html, /Folds to 3-bets often/);
assert.match(html, /F3B 70% · 100 opportunities · Strong/);
assert.match(html, /<strong>Respect their 3-bets more<\/strong><span class="pnhud-dashboard-analysis-reason">3-bets infrequently/);
assert.ok(html.indexOf('pnhud-dashboard-insights') > html.indexOf('Relational stats'), 'Insights follow numeric stats');
var descriptiveOnly = state(); descriptiveOnly.coreStats = counters(30, 27, 50);
Object.assign(descriptiveOnly.coreStats.counters, { threeBetMade: 8, flopCBetMade: 50, foldToFlopCBet: 45, wtsdMade: 28 });
var descriptiveHtml = Dashboard.render(descriptiveOnly);
assert.match(descriptiveHtml, /Participation and preflop raises are close/, 'supported observation without an action remains visible');
assert.doesNotMatch(descriptiveHtml, /pnhud-dashboard-observations/, 'an observation-only section does not collapse its sole evidence');
selected.playerId = 'p2'; selected.coreStats = counters(25, 20, 45);
html = Dashboard.render(selected);
assert.doesNotMatch(html, /Plays more hands than they raise preflop|Folds to 3-bets often/, 'player switch recomputes');
selected.mode = 'session'; selected.coreStats = counters(40, 20, 70);
html = Dashboard.render(selected);
assert.match(html, /Plays more hands than they raise preflop/, 'Session computes independently');
selected.position = 'BTN'; selected.coreStats = null;
assert.doesNotMatch(Dashboard.render(selected), /pnhud-dashboard-insights/, 'missing position slice has no overall fallback');
selected.position = null; selected.situation = 'oop'; selected.coreStats = counters(40, 20, 70);
assert.match(Dashboard.render(selected), /Insights/, 'exact IP or OOP slice can render');
selected.opponentMode = 'self'; selected.relationalStats = {};
assert.doesNotMatch(Dashboard.render(selected), /pnhud-dashboard-insights/, 'missing relational counterpart slice has no overall fallback');
selected.relationalStats = { foldToThreeBet: counters(40, 20, 70) };
assert.match(Dashboard.render(selected), /Folds to 3-bets often/, 'exact relational counterpart slice renders');
assert.doesNotMatch(Dashboard.render(selected), /Plays more hands than they raise preflop/, 'opponent filter excludes overall core observations');
selected.relationalStats.foldToThreeBet.counters.foldToThreeBet = 9;
selected.relationalStats.foldToThreeBet.counters.foldToThreeBetOpportunities = 14;
assert.doesNotMatch(Dashboard.render(selected), /pnhud-dashboard-insights/, 'Weak filtered support suppresses the observation');
selected.relationalStats.foldToThreeBet = counters(40, 20, 70);
selected.loading = true;
assert.doesNotMatch(Dashboard.render(selected), /pnhud-dashboard-insights/, 'loading clears prior Insights');
selected.loading = false; selected.selfPlayerId = 'p2';
assert.doesNotMatch(Dashboard.render(selected), /pnhud-dashboard-insights/, 'self player gets no opponent Insights');
selected.selfPlayerId = 'hero';
var snapshot = { playerId: 'p2', mode: 'session', position: null, situation: 'oop', opponentMode: 'self', requestToken: 4 };
assert.strictEqual(Dashboard.requestMatches(selected, snapshot), true);
['playerId', 'mode', 'position', 'situation', 'opponentMode', 'requestToken'].forEach(function (key) {
  var old = selected[key]; selected[key] = key === 'requestToken' ? 5 : 'changed';
  assert.strictEqual(Dashboard.requestMatches(selected, snapshot), false, 'stale ' + key + ' response is fenced'); selected[key] = old;
});
console.log('Player Dashboard Insights, context, source, and request fencing regressions passed.');
