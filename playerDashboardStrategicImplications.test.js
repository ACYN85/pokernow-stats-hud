'use strict';
var assert = require('assert');
var Dashboard = require('./playerDashboard.js');
function counters(vpip, threeBet, f3b, fcb, wtsd) {
  return { counters: { hands: 100, vpipMade: vpip, vpipOpportunities: 100, pfrMade: vpip - 10, pfrOpportunities: 100,
    threeBetMade: threeBet, threeBetOpportunities: 40, foldToThreeBet: f3b, foldToThreeBetOpportunities: 40,
    flopCBetMade: 20, flopCBetOpportunities: 40, foldToFlopCBet: fcb, foldToFlopCBetOpportunities: 40,
    wtsdMade: wtsd, wtsdOpportunities: 50, postflopAggressiveActions: 20, postflopCalls: 20,
    wsdMade: 20, wsdOpportunities: 40 }, coverage: { totalSessionHands: 100, totalCareerHands: 100, positionTrackedHands: 100, matchedPositionHands: 100, situationTrackedHands: 100, matchedSituationHands: 100, tableSize3PlusHands: 100, tableSizeHands: { HU: 0, '3_TO_5': 0, SIX_PLUS: 100 } } };
}
function state() { return { open: true, playerId: 'villain', selfPlayerId: 'hero', mode: 'career', position: null,
  situation: 'overall', opponentMode: 'overall', coreStats: counters(45, 12, 32, 30, 22), careerAnalysisAll3Plus: true, relationalStats: {}, requestToken: 7 }; }
var selected = state(); var html = Dashboard.render(selected);
assert.match(html, /pnhud-dashboard-insights/);
assert.match(html, /data-implication-id="implication-loose-aggressive-preflop"/);
assert.match(html, /data-implication-id="implication-fold-prone"/);
assert.match(html, /Plays many hands preflop/);
assert.match(html, /F3B 80% · 40 opportunities · Strong/);
assert.match(html, /Broad adjustments from observed tendencies · not hand-specific advice/);
assert.match(html, /<strong>Apply selective preflop and flop pressure<\/strong><span class="pnhud-dashboard-analysis-reason">Folds to 3-bets and flop CBets often/);
assert.match(html, /<strong>Consider thinner value bets<\/strong><span class="pnhud-dashboard-analysis-reason">Reaches showdown often/);
assert.match(html, /<details class="pnhud-dashboard-observations">/, 'superseded raw observations remain available but collapsed');
assert.doesNotMatch(html, /May indicate:|Meaning &amp; potential adjustment/, 'default cards omit verbose explanation blocks');
assert.strictEqual((html.match(/class="pnhud-dashboard-insight pnhud-dashboard-action"/g) || []).length, 3, 'only three action rows are visible by default');
var insight = html.match(/<li class="pnhud-dashboard-insight" data-insight-id="foldToThreeBet-high">([\s\S]*?)<\/li>/);
assert.ok(insight && insight[1].includes('Folds to 3-bets often'), 'raw source Insight remains available');
assert.ok(!insight[1].includes('Apply selective 3-bet pressure'), 'composite suppresses child adjustment');
assert.ok(html.includes('Apply selective preflop and flop pressure'), 'composite retains broad adjustment');
var divergent = state(); divergent.coreStats = counters(10, 12, 8, 8, 10);
var divergentHtml = Dashboard.render(divergent);
var lowVpipRow = divergentHtml.match(/<li class="pnhud-dashboard-insight" data-insight-id="vpip-low">([\s\S]*?)<\/li>/);
assert.ok(lowVpipRow && lowVpipRow[1].includes('Plays relatively few hands preflop'), 'divergent low-VPIP observation remains available');
assert.ok(!lowVpipRow[1].includes('voluntary involvement may merit more respect'), 'high 3Bet suppresses conflicting broad adjustment');
assert.match(divergentHtml, /Avoid premium-only 3-bet assumptions/, 'specific high-3Bet adjustment remains');
var mixed = state(); mixed.coreStats = counters(30, 3, 32, 5, 14);
var mixedHtml = Dashboard.render(mixed);
assert.match(mixedHtml, /Apply selective 3-bet pressure/, 'preflop pressure stays distinct');
assert.match(mixedHtml, /Bluff flop CBets less; value bet more/, 'flop continuation stays distinct');
var mixedShowdown = state(); mixedShowdown.coreStats = counters(30, 3, 32, 5, 22);
var mixedShowdownHtml = Dashboard.render(mixedShowdown);
assert.match(mixedShowdownHtml, /Bluff flop CBets less; value bet thinner/, 'sticky advice specifies the supported flop behavior');
assert.match(mixedShowdownHtml, /Apply selective 3-bet pressure/, 'preflop fold advice remains separate');
selected.playerId = 'hero'; assert.doesNotMatch(Dashboard.render(selected), /pnhud-dashboard-implication|pnhud-dashboard-insights/, 'self has no opponent implications');
selected = state(); selected.mode = 'session'; assert.match(Dashboard.render(selected), /implication-fold-prone/, 'Session derives independently');
selected.position = 'BTN'; selected.coreStats = null; assert.doesNotMatch(Dashboard.render(selected), /data-implication-id=/, 'missing position never borrows Overall');
selected.coreStats = counters(45, 12, 32, 30, 22); assert.match(Dashboard.render(selected), /from BTN/, 'position label is preserved');
selected.position = null; selected.situation = 'oop'; assert.match(Dashboard.render(selected), /when out of position/, 'situation label is preserved');
selected.situation = 'overall'; selected.opponentMode = 'self'; selected.relationalStats = {};
assert.doesNotMatch(Dashboard.render(selected), /data-implication-id=/, 'missing counterpart never borrows Overall');
selected.relationalStats = { foldToThreeBet: counters(45, 12, 32, 30, 22) };
assert.match(Dashboard.render(selected), /against you/, 'opponent mode is preserved');
assert.doesNotMatch(Dashboard.render(selected), /implication-loose-aggressive-preflop/, 'core Overall data does not enter counterpart filter');
selected.relationalStats.foldToThreeBet.counters.foldToThreeBetOpportunities = 14;
selected.relationalStats.foldToThreeBet.counters.foldToThreeBet = 8;
assert.doesNotMatch(Dashboard.render(selected), /data-implication-id=/, 'Weak sample is clean');
selected.loading = true; assert.doesNotMatch(Dashboard.render(selected), /data-implication-id=/, 'loading clears old implication');
selected.loading = false; var snapshot = { playerId: selected.playerId, mode: selected.mode, position: selected.position,
  situation: selected.situation, opponentMode: selected.opponentMode, requestToken: selected.requestToken };
['playerId', 'mode', 'position', 'situation', 'opponentMode', 'requestToken'].forEach(function (key) {
  var old = selected[key]; selected[key] = key === 'requestToken' ? old + 1 : 'stale';
  assert.strictEqual(Dashboard.requestMatches(selected, snapshot), false, key + ' fences stale publication'); selected[key] = old;
});
console.log('Player Dashboard Strategic Implications, Evidence, filters, self exclusion, and stale-response tests passed.');
