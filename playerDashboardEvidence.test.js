'use strict';
var assert = require('assert');
var fs = require('fs');
var dashboard = require('./playerDashboard.js');

function session(values) {
  var result = Object.assign({ handsPlayed: 0, vpipHands: 0, vpipOpportunities: 0, pfrHands: 0, pfrOpportunities: 0,
    afDetails: { bets: 0, raises: 0, calls: 0 }, threeBetMade: 0, threeBetOpportunities: 0, foldToThreeBet: 0, foldToThreeBetOpportunities: 0,
    flopCBetMade: 0, flopCBetOpportunities: 0, foldToFlopCBet: 0, foldToFlopCBetOpportunities: 0,
    wentToShowdown: 0, sawFlopForWTSD: 0, wonMoneyAtShowdown: 0, showdownsForWSD: 0 }, values || {});
  result.coverage = result.coverage || { totalSessionHands: result.handsPlayed, positionTrackedHands: result.handsPlayed, matchedPositionHands: result.handsPlayed, situationTrackedHands: result.handsPlayed, matchedSituationHands: result.handsPlayed };
  return result;
}
function career(values) {
  var counters = Object.assign({ hands: 0, vpipMade: 0, vpipOpportunities: 0, pfrMade: 0, pfrOpportunities: 0,
    postflopAggressiveActions: 0, postflopCalls: 0, threeBetMade: 0, threeBetOpportunities: 0, foldToThreeBet: 0, foldToThreeBetOpportunities: 0,
    flopCBetMade: 0, flopCBetOpportunities: 0, foldToFlopCBet: 0, foldToFlopCBetOpportunities: 0,
    wtsdMade: 0, wtsdOpportunities: 0, wsdMade: 0, wsdOpportunities: 0 }, values || {});
  return { counters: counters, coverage: { totalCareerHands: counters.hands, positionTrackedHands: counters.hands, matchedPositionHands: counters.hands, situationTrackedHands: counters.hands, matchedSituationHands: counters.hands } };
}
function byId(cards, id) { return cards.find(function (card) { return card.id === id; }); }

var sessionCards = dashboard.fromSession(session({ handsPlayed: 200, vpipHands: 50, vpipOpportunities: 101, pfrHands: 30, pfrOpportunities: 102,
  afDetails: { bets: 2, raises: 3, calls: 4 }, threeBetMade: 1, threeBetOpportunities: 5, foldToThreeBet: 2, foldToThreeBetOpportunities: 6,
  flopCBetMade: 3, flopCBetOpportunities: 7, foldToFlopCBet: 4, foldToFlopCBetOpportunities: 8,
  wentToShowdown: 5, sawFlopForWTSD: 9, wonMoneyAtShowdown: 6, showdownsForWSD: 10 }), { position: null, situation: 'overall' });
assert.strictEqual(byId(sessionCards, 'vpip').evidence.source, 'session');
assert.deepStrictEqual(['hands','vpip','pfr','af','threeBet','foldToThreeBet','flopCBet','foldToFlopCBet','wtsd','wsd'].map(function (id) { return byId(sessionCards, id).evidence.supportCount; }),
  [200, 101, 102, 9, 5, 6, 7, 8, 9, 10], 'each Session stat uses its own authoritative support basis');
assert.strictEqual(byId(sessionCards, 'vpip').evidence.status, 'strong');

var careerCards = dashboard.fromCareer(career({ hands: 3, vpipMade: 1, vpipOpportunities: 3, pfrMade: 1, pfrOpportunities: 3 }), { position: 'BTN', situation: 'overall' });
assert.strictEqual(byId(careerCards, 'vpip').evidence.source, 'career');
assert.strictEqual(byId(careerCards, 'vpip').evidence.supportCount, 3);
assert.strictEqual(byId(careerCards, 'vpip').evidence.status, 'insufficient', 'Career is not inherently stronger than Session');
assert.strictEqual(byId(careerCards, 'vpip').evidence.context.position, 'BTN');

var sessionCounterShape = dashboard.fromCounterResult(career({ hands: 8, vpipMade: 2, vpipOpportunities: 8 }), 'session', { position: 'SB' });
assert.strictEqual(byId(sessionCounterShape, 'vpip').evidence.source, 'session', 'Session filtered counters retain their Session source identity');

var careerMappings = dashboard.fromCareer(career({ hands: 300, vpipMade: 50, vpipOpportunities: 111, pfrMade: 30, pfrOpportunities: 112,
  postflopAggressiveActions: 6, postflopCalls: 7, threeBetMade: 1, threeBetOpportunities: 14, foldToThreeBet: 2, foldToThreeBetOpportunities: 15,
  flopCBetMade: 3, flopCBetOpportunities: 16, foldToFlopCBet: 4, foldToFlopCBetOpportunities: 17,
  wtsdMade: 5, wtsdOpportunities: 18, wsdMade: 6, wsdOpportunities: 19 }));
assert.deepStrictEqual(['hands','vpip','pfr','af','threeBet','foldToThreeBet','flopCBet','foldToFlopCBet','wtsd','wsd'].map(function (id) { return byId(careerMappings, id).evidence.supportCount; }),
  [300, 111, 112, 13, 14, 15, 16, 17, 18, 19], 'each Career stat uses its own authoritative support basis');

assert.strictEqual(byId(dashboard.fromSession({ handsPlayed: 1 }), 'vpip').evidence.status, 'unavailable', 'missing exact support metadata stays unavailable');
assert.strictEqual(byId(dashboard.fromSession({ handsPlayed: -2, vpipHands: 1, vpipOpportunities: '100' }), 'hands').evidence.status, 'unavailable', 'negative counters are not normalized into evidence');
assert.strictEqual(byId(dashboard.fromSession({ handsPlayed: -2, vpipHands: 1, vpipOpportunities: '100' }), 'vpip').evidence.status, 'unavailable', 'string counters are not normalized into evidence');

var ip = dashboard.fromCareer(career({ hands: 24, threeBetMade: 2, threeBetOpportunities: 4 }), { situation: 'ip' });
var oop = dashboard.fromCareer(career({ hands: 60, threeBetMade: 20, threeBetOpportunities: 40 }), { situation: 'oop' });
assert.strictEqual(byId(ip, 'threeBet').value, '50%');
assert.strictEqual(byId(oop, 'threeBet').value, '50%');
assert.strictEqual(byId(ip, 'threeBet').evidence.status, 'insufficient');
assert.strictEqual(byId(oop, 'threeBet').evidence.status, 'strong');
assert.strictEqual(byId(ip, 'threeBet').evidence.context.situation, 'ip');
assert.strictEqual(byId(oop, 'threeBet').evidence.context.situation, 'oop');

var overall = session({ handsPlayed: 200, vpipHands: 60, vpipOpportunities: 200, pfrHands: 40, pfrOpportunities: 200 });
var filtered = session({ handsPlayed: 4, vpipHands: 2, vpipOpportunities: 4, pfrHands: 1, pfrOpportunities: 4 });
var filteredHtml = dashboard.render({ open: true, playerId: 'p1', mode: 'session', position: 'CO', sessionStats: overall, coreStats: filtered, relationalStats: {}, situation: 'overall', opponentMode: 'overall' });
assert.ok(filteredHtml.includes('4 opps'));
assert.ok(!filteredHtml.includes('Insufficient'), 'tiny samples show the exact support without a visible Insufficient label');
assert.ok(filteredHtml.includes('More observations are needed before an evidence-strength label is shown.'), 'the tooltip explains why no strength label is shown');
assert.ok(!filteredHtml.includes('200 opps'), 'overall support is not reused beside position-filtered values');

var tinyHandsHtml = dashboard.render({ open: true, playerId: 'p1', mode: 'session', sessionStats: session({ handsPlayed: 12, vpipHands: 2, vpipOpportunities: 12, pfrHands: 1, pfrOpportunities: 12 }), relationalStats: {}, situation: 'overall', opponentMode: 'overall' });
assert.ok(tinyHandsHtml.includes('<span>12 hands</span>'));
assert.ok(!tinyHandsHtml.includes('12 hands</span><em>'), 'Hands omits the low-support strength suffix');
var zeroHtml = dashboard.render({ open: true, playerId: 'p0', mode: 'session', sessionStats: session({ handsPlayed: 0 }), relationalStats: {}, situation: 'overall', opponentMode: 'overall' });
assert.ok(zeroHtml.includes('No opportunities'));
assert.ok(!zeroHtml.includes('No opportunities</span><em>'), 'zero support retains clear wording without a strength suffix');

var missingFilteredHtml = dashboard.render({ open: true, playerId: 'p1', mode: 'session', position: 'BTN', sessionStats: overall, coreStats: null, relationalStats: {}, situation: 'overall', opponentMode: 'overall' });
assert.ok(missingFilteredHtml.includes('Filtered statistics and evidence are unavailable for this context.'));
assert.ok(!missingFilteredHtml.includes('200 opps'), 'missing position payload cannot fall back to overall support');

var relational = {
  threeBet: career({ threeBetMade: 2, threeBetOpportunities: 5 }),
  foldToThreeBet: career({ foldToThreeBet: 1, foldToThreeBetOpportunities: 2 }),
  foldToFlopCBet: career({ foldToFlopCBet: 20, foldToFlopCBetOpportunities: 40 })
};
var relationalHtml = dashboard.render({ open: true, playerId: 'p2', selfPlayerId: 'hero', mode: 'career', situation: 'ip', opponentMode: 'self', coreStats: career({ hands: 10 }), relationalStats: relational });
assert.ok(relationalHtml.includes('5 opps') && relationalHtml.includes('Weak'), 'opponent-context 3Bet uses its exact support');
assert.ok(relationalHtml.includes('2 opps') && !relationalHtml.includes('Insufficient'), 'opponent-context F3B shows exact support without a low-support label');
assert.ok(relationalHtml.includes('40 opps') && relationalHtml.includes('Strong'), 'opponent-context FCB uses its exact support');

var switchedHtml = dashboard.render({ open: true, playerId: 'p1', mode: 'career', position: null, situation: 'overall', opponentMode: 'overall', coreStats: career({ hands: 100, vpipMade: 31, vpipOpportunities: 100 }) });
assert.ok(switchedHtml.includes('100 opps') && switchedHtml.includes('Strong'), 'source/filter rerender recomputes evidence from the new result');
assert.strictEqual(dashboard.requestMatches({ open: true, playerId: 'p1', mode: 'career', position: null, situation: 'ip', opponentMode: 'self', requestToken: 8 },
  { playerId: 'p1', mode: 'career', position: null, situation: 'oop', opponentMode: 'self', requestToken: 8 }), false, 'stale situation response cannot overwrite newer evidence');

var dashboardSource = fs.readFileSync('./playerDashboard.js', 'utf8');
var evidenceSource = fs.readFileSync('./statEvidence.js', 'utf8');
assert.strictEqual(dashboardSource.includes('careerIndexedService'), false);
assert.strictEqual(evidenceSource.includes('careerIndexedService'), false, 'evidence rendering has no Career query path');

console.log('Dashboard evidence source, position, IP/OOP, relational, refresh, async-race, and no-query tests passed.');
