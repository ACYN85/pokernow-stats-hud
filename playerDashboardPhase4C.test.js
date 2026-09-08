'use strict';
var assert = require('assert'); var dashboard = require('./playerDashboard.js');
function counters(values) { return { counters: Object.assign({ hands: 0, vpipMade: 0, vpipOpportunities: 0, pfrMade: 0, pfrOpportunities: 0, postflopAggressiveActions: 0, postflopCalls: 0, threeBetMade: 0, threeBetOpportunities: 0, foldToThreeBet: 0, foldToThreeBetOpportunities: 0, flopCBetMade: 0, flopCBetOpportunities: 0, foldToFlopCBet: 0, foldToFlopCBetOpportunities: 0, wtsdMade: 0, wtsdOpportunities: 0, wsdMade: 0, wsdOpportunities: 0 }, values || {}), coverage: { totalCareerHands: 1000, positionTrackedHands: 312, matchedPositionHands: values && values.hands || 0 } }; }
var profile = { displayedArchetype: 'TAG', rawArchetype: 'TAG', rawScores: { TAG: .8 } };
var base = { open: true, playerId: 'villain', selfPlayerId: 'hero', displayName: 'Villain', mode: 'career', position: null, opponentMode: 'overall', coreStats: counters({ hands: 1000, vpipMade: 250, vpipOpportunities: 1000, threeBetMade: 10, threeBetOpportunities: 40, foldToThreeBet: 5, foldToThreeBetOpportunities: 10, flopCBetMade: 30, flopCBetOpportunities: 50, foldToFlopCBet: 8, foldToFlopCBetOpportunities: 20 }), profile: profile, note: 'Stable note', noteDraft: 'Stable note' };
var html = dashboard.render(base);
assert.ok(html.includes('<option value="" selected>') || html.includes('<option value="">All positions</option>'), 'Position defaults to All');
assert.deepStrictEqual(dashboard.POSITION_OPTIONS, ['BTN','CO','HJ','LJ','UTG','UTG+1','UTG+2','SB','BB']);
dashboard.POSITION_OPTIONS.forEach(function (position) { assert.ok(html.includes('value="' + position + '"')); });
assert.ok(html.includes('aria-pressed="true" class="active">Overall'));
assert.ok(html.includes('Opponent context applies only to 3Bet, F3B, and FCB'));
var coreSection = html.slice(html.indexOf('<h3>Core stats'), html.indexOf('pnhud-dashboard-relational'));
assert.ok(coreSection.includes('VPIP') && coreSection.includes('CBet') && !coreSection.includes('3Bet') && !coreSection.includes('F3B') && !coreSection.includes('FCB'));
var relationalSection = html.slice(html.indexOf('pnhud-dashboard-relational'), html.indexOf('Current profile'));
assert.ok(relationalSection.includes('3Bet') && relationalSection.includes('F3B') && relationalSection.includes('FCB'));
assert.ok(!relationalSection.includes('VPIP') && !relationalSection.includes('CBet</span>'));

var filteredCore = counters({ hands: 84, vpipMade: 21, vpipOpportunities: 84, pfrMade: 10, pfrOpportunities: 84, flopCBetMade: 4, flopCBetOpportunities: 8 });
var vsYou = {
  threeBet: counters({ threeBetMade: 2, threeBetOpportunities: 5 }),
  foldToThreeBet: counters({ foldToThreeBet: 5, foldToThreeBetOpportunities: 7 }),
  foldToFlopCBet: counters({ foldToFlopCBet: 2, foldToFlopCBetOpportunities: 5 })
};
html = dashboard.render(Object.assign({}, base, { position: 'SB', opponentMode: 'self', coreStats: filteredCore, relationalStats: vsYou }));
assert.ok(html.includes('Career · SB · 84 hands'));
assert.ok(html.includes('<strong>SB</strong> · 84 tracked hands'));
assert.ok(html.includes('SB · Vs You'));
assert.ok(html.includes('71.4%') && html.includes('5 / 7'), 'F3B Vs You exact sample');
assert.ok(html.includes('40%') && html.includes('2 / 5'), 'FCB Vs You exact sample');
assert.ok(html.includes('2 / 5'), '3Bet Vs You exact sample');
assert.ok(html.includes('Stable note') && html.includes('Displayed profile: <strong>TAG</strong>'), 'filters do not alter notes/profile presentation');
assert.ok(coreSection.indexOf('VPIP') >= 0, 'nonrelational stats remain available independently of opponent context');

var zero = counters({ hands: 0 }); zero.coverage.matchedPositionHands = 0;
html = dashboard.render(Object.assign({}, base, { position: 'CO', coreStats: zero }));
assert.ok(html.includes('No position-tracked hands for CO yet.'));
html = dashboard.render(Object.assign({}, base, { opponentMode: 'self', relationalStats: { threeBet: counters(), foldToThreeBet: counters(), foldToFlopCBet: counters() } }));
assert.ok((html.match(/<strong>---<\/strong>/g) || []).length >= 3, 'zero relational opportunities render unavailable');

html = dashboard.render(Object.assign({}, base, { selfPlayerId: null }));
assert.ok(html.includes('data-dashboard-opponent="self"') && html.includes('data-dashboard-opponent="others"'));
assert.ok((html.match(/disabled/g) || []).length >= 2, 'relational modes are disabled without canonical self identity');
html = dashboard.render(Object.assign({}, base, { playerId: 'hero', selfPlayerId: 'hero' }));
var selfButton = html.slice(html.indexOf('data-dashboard-opponent="self"'), html.indexOf('data-dashboard-opponent="others"'));
assert.ok(selfButton.includes('disabled') && selfButton.includes('Self-vs-self'));
var othersButton = html.slice(html.indexOf('data-dashboard-opponent="others"'));
assert.ok(!othersButton.slice(0, othersButton.indexOf('</button>')).includes('disabled'), 'self dashboard retains Vs Everyone Else');

var current = { open: true, playerId: 'villain', mode: 'career', position: 'BB', opponentMode: 'self', requestToken: 9 };
assert.strictEqual(dashboard.requestMatches(current, { playerId: 'villain', mode: 'career', position: 'BB', opponentMode: 'self', requestToken: 9 }), true);
['BTN','SB'].forEach(function (stale) { assert.strictEqual(dashboard.requestMatches(current, { playerId: 'villain', mode: 'career', position: stale, opponentMode: 'self', requestToken: 9 }), false); });
assert.strictEqual(dashboard.requestMatches(current, { playerId: 'villain', mode: 'career', position: 'BB', opponentMode: 'others', requestToken: 9 }), false);
assert.strictEqual(dashboard.requestMatches(current, { playerId: 'villain', mode: 'career', position: 'BB', opponentMode: 'self', requestToken: 8 }), false);
console.log('Phase 4C position, relational, cross-filter, empty, self-dashboard, coverage, and async race UI tests passed.');
