'use strict';
var assert = require('assert');
var dashboard = require('./playerDashboard.js');

var session = { handsPlayed: 22, vpipHands: 6, vpipOpportunities: 22, pfrHands: 4, pfrOpportunities: 22, afDetails: { bets: 2, raises: 1, calls: 2 }, threeBetMade: 2, threeBetOpportunities: 5, foldToThreeBet: 3, foldToThreeBetOpportunities: 6, flopCBetMade: 2, flopCBetOpportunities: 3, foldToFlopCBet: 0, foldToFlopCBetOpportunities: 0, wentToShowdown: 4, sawFlopForWTSD: 10, wonMoneyAtShowdown: 2, showdownsForWSD: 4 };
var sessionCards = dashboard.fromSession(session);
assert.deepStrictEqual(sessionCards.map(function (card) { return card.label; }), ['Hands', 'VPIP', 'PFR', 'AF', '3Bet', 'F3B', 'CBet', 'FCB', 'WTSD', 'W$SD']);
assert.strictEqual(sessionCards[1].value, '27.3%'); assert.strictEqual(sessionCards[1].sample, '6 / 22');
assert.strictEqual(sessionCards[7].value, '---'); assert.strictEqual(sessionCards[3].value, '1.5');
assert.strictEqual(dashboard.afText(0, 0), '0.0'); assert.strictEqual(dashboard.afText(3, 0), '∞');

var career = { counters: { hands: 1842, vpipMade: 500, vpipOpportunities: 1842, pfrMade: 300, pfrOpportunities: 1842, postflopAggressiveActions: 20, postflopCalls: 5, threeBetMade: 10, threeBetOpportunities: 80, foldToThreeBet: 12, foldToThreeBetOpportunities: 24, flopCBetMade: 15, flopCBetOpportunities: 30, foldToFlopCBet: 9, foldToFlopCBetOpportunities: 20, wtsdMade: 40, wtsdOpportunities: 100, wsdMade: 22, wsdOpportunities: 40 } };
assert.strictEqual(dashboard.fromCareer(career)[0].value, '1842'); assert.deepStrictEqual(dashboard.fromCareer(null), []);
var scores = { Nit: .1, TAG: .8, LAG: .3, 'Tight Passive': .2, 'Loose Passive': .4, 'Calling Station': .35, Maniac: .05 };
var html = dashboard.render({ playerId: 'stable-1', displayName: 'ac73', mode: 'session', sessionStats: session,
  coreStats: { counters: career.counters, coverage: { tableSizeHands: { HU: 0, '3_TO_5': 0, SIX_PLUS: 1842 } } },
  profile: { displayedArchetype: 'TAG', rawArchetype: 'Unknown / Uncertain', rawScores: scores }, note: 'Calls too wide' });
assert.ok(html.includes('data-dashboard-mode="session"')); assert.ok(html.includes('data-dashboard-mode="career"'));
assert.ok(html.includes('Displayed profile: <strong>TAG</strong>')); assert.ok(html.includes('Current raw classification'));
dashboard.PROFILE_ORDER.forEach(function (name) { assert.ok(html.includes(name)); });
assert.ok(html.includes('80%') && html.includes('40%'), 'scores are converted independently rather than normalized');
assert.ok(html.includes('Calls too wide')); assert.ok(html.includes('ID stable-1'));
assert.ok(dashboard.render({ playerId: 'x', mode: 'career', careerStats: null }).includes('No career hands tracked yet.'));
assert.ok(dashboard.render({ playerId: 'x', mode: 'career', loading: true }).includes('Loading career statistics'));
assert.ok(dashboard.render({ playerId: 'x', mode: 'career', error: 'Career statistics could not be loaded.' }).includes('could not be loaded'));
console.log('Player Dashboard core stats, samples, profile-fit, states, and rendering tests passed.');
