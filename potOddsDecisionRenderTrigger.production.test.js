'use strict';
var assert = require('assert');
var fs = require('fs');
var potOdds = require('./potOdds.js');
var harnessSupport = require('./testSupport/productionContentScriptHarness.js');

function supported(input, label) {
  var result = potOdds.resolve(input);
  assert.strictEqual(result.status, 'supported', label);
  return result;
}
function fingerprint(decision, enabled) { return potOdds.decisionRenderFingerprint(decision, enabled); }
function socket(eventName, payload) { return '42[' + JSON.stringify(eventName) + ',' + JSON.stringify(payload) + ']'; }

var call100Input = {
  enabled: true, localPlayerId: 'playerA', actingPlayerId: 'playerA', handId: 'LIVE-CALL-100', street: 'flop', currentPot: 460,
  players: [{ playerId: 'playerA', streetContribution: 0, stack: 420, active: true, inHand: true }, { playerId: 'playerB', streetContribution: 100, stack: 420, active: true, inHand: true }]
};
var call100 = supported(call100Input, 'ordinary bet into hero');
assert.strictEqual(call100.amountToCall, 100); assert.strictEqual(call100.currentEligiblePot, 460); assert.strictEqual(potOdds.formatPercent(call100.requiredEquity), '17.9%');

var call200 = supported(Object.assign({}, call100Input, { currentPot: 660, players: [{ playerId: 'playerA', streetContribution: 0, stack: 420, active: true, inHand: true }, { playerId: 'playerB', streetContribution: 200, stack: 320, active: true, inHand: true }] }), 'raise into hero');
var preflop = supported({ enabled: true, localPlayerId: 'playerA', actingPlayerId: 'playerA', handId: 'PREFLOP', street: 'preflop', currentPot: 0, players: [{ playerId: 'playerA', streetContribution: 20, stack: 980 }, { playerId: 'sb', streetContribution: 10, stack: 990 }, { playerId: 'opener', streetContribution: 60, stack: 940 }] }, 'preflop open reaches hero');
var allIn = supported({ enabled: true, localPlayerId: 'playerA', actingPlayerId: 'playerA', handId: 'ALLIN', street: 'flop', currentPot: 740, players: [{ playerId: 'playerA', streetContribution: 0, totalContribution: null, stack: 460, active: true, inHand: true }, { playerId: 'playerB', streetContribution: 460, totalContribution: 460, stack: 0, allIn: true, active: true, inHand: true }] }, 'all-in reaches hero');
var multiway = supported({ enabled: true, localPlayerId: 'playerA', actingPlayerId: 'playerA', handId: 'MULTI', street: 'flop', currentPot: 120, players: [{ playerId: 'playerA', streetContribution: 0, stack: 420 }, { playerId: 'bettor', streetContribution: 40, stack: 380 }, { playerId: 'caller', streetContribution: 40, stack: 380 }] }, 'multiway caller acts before hero');
var potUpdated = supported(Object.assign({}, call100Input, { currentPot: 560 }), 'pot updates before hero action');
var advanced = potOdds.resolve(Object.assign({}, call100Input, { actingPlayerId: 'playerB' }));
assert.strictEqual(advanced.status, 'idle');

var eventFingerprints = [call100, call200, preflop, allIn, multiway, potUpdated, advanced].map(function (decision) { return fingerprint(decision, true); });
assert.strictEqual(new Set(eventFingerprints).size, eventFingerprints.length, 'every render-relevant production event changes the compact fingerprint');
assert.notStrictEqual(fingerprint(call100, true), fingerprint(call100, false), 'Show Pot Odds ON/OFF changes the render fingerprint');
assert.strictEqual(potOdds.formatPercent(preflop.requiredEquity), '30.8%');
assert.strictEqual(potOdds.formatPercent(allIn.requiredEquity), '38.3%');

var content = fs.readFileSync('./content.js', 'utf8');
assert.match(content, /function commitPotOddsDecision\(next, reason, presentationContext\)/, 'one decision/presentation commit path owns render-relevant changes');
assert.match(content, /decisionRenderFingerprint\(next, hudUiPreferences\.showPotOdds\)/, 'the commit path preserves the compact arithmetic-decision fingerprint');
assert.match(content, /heroPotOddsDecisionRevision \+= 1;[\s\S]*scheduleHeroPotOddsRender\(reason/, 'every fingerprint change increments the revision and schedules UI work');
assert.match(content, /function scheduleHeroPotOddsRender\(reason\)[\s\S]*heroPotOddsRenderFrame = requestAnimationFrame/, 'rendering is one-frame event driven');
assert.match(content, /if \(heroPotOddsRenderFrame !== null\)[\s\S]*coalescedRequestCount \+= 1/, 'rapid frames coalesce behind one pending render');
assert.match(content, /commitPotOddsDecision\(next, 'pot odds decision changed: '/, 'authoritative refresh commits through the scheduler');
assert.match(content, /pnhud-settings-pot-odds[\s\S]*refreshPotOddsFromLedger\('setting changed'\)/, 'Show Pot Odds changes immediately refresh the decision');
assert.match(content, /reconcilePotOddsPresentationDependencies\('seat\/table reconcile:/, 'visual reconcile re-derives readiness before its harmless reposition/render signal');
assert.doesNotMatch(content.slice(content.indexOf('function scheduleHeroPotOddsRender'), content.indexOf('function positionHeroPotOdds')), /setInterval|setTimeout/, 'decision rendering uses no polling timer');

var gameState = {
  hI: 'LIVE-CALL-100', gT: ['holdem', 1], pot: 460, tB: { playerA: 'check', playerB: 100 }, cPI: 'playerA', pITT: 'playerA',
  iHPI: ['playerA', 'playerB'], pGS: { playerA: 'inGame', playerB: 'inGame' }, players: { playerA: { stack: 420 }, playerB: { stack: 420 } }
};
var harness = harnessSupport.createHarness({ gameId: 'pot-odds-no-resize-render', controlledAnimationFrames: true, controlledClock: true, initialNow: 1000 });
assert.deepStrictEqual(harness.evaluationErrors, []);
harness.flushAnimationFrames();
var baseline = JSON.parse(harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDPotOdds.placementInfo())'));

harnessSupport.dispatchFrame(harness, socket('registered', { currentPlayer: { id: 'playerA' }, gameState: gameState }), 'registered-call100', 1100);
var beforeFlushDecision = JSON.parse(harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDPotOdds.currentDecision())'));
var beforeFlushPlacement = JSON.parse(harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDPotOdds.placementInfo())'));
assert.strictEqual(beforeFlushDecision.status, 'supported'); assert.strictEqual(beforeFlushDecision.amountToCall, 100); assert.strictEqual(potOdds.formatPercent(beforeFlushDecision.requiredEquity), '17.9%');
assert.strictEqual(beforeFlushPlacement.renderPending, true, 'supported decision independently schedules a render before any visual event');
assert.ok(beforeFlushPlacement.currentDecisionRevision > baseline.currentDecisionRevision);
assert.strictEqual(beforeFlushPlacement.lastRenderExecutedTimestamp, baseline.lastRenderExecutedTimestamp, 'scheduled work has not been disguised as a resize render');

var firstFlush = harness.flushAnimationFrames();
assert.ok(firstFlush.executed >= 1); assert.strictEqual(firstFlush.pending, 0);
var afterFlushPlacement = JSON.parse(harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDPotOdds.placementInfo())'));
assert.strictEqual(afterFlushPlacement.renderPending, false); assert.strictEqual(afterFlushPlacement.supportedDecision, true); assert.strictEqual(afterFlushPlacement.renderRequested, true);
assert.strictEqual(afterFlushPlacement.lastRenderScheduledTimestamp, 1100); assert.strictEqual(afterFlushPlacement.lastRenderExecutedTimestamp, 1100);
assert.match(afterFlushPlacement.renderTrigger, /pot odds decision changed: live merged state|BoardCompanion revision/, 'semantic render may be followed by the authoritative first geometry-ready revision');
assert.strictEqual(harness.evaluateInIsolatedWorld("document.getElementById('pnhud-hero-pot-odds').hidden"), false, 'decision-triggered pass mounts and unhides the pill without resize');
assert.match(harness.evaluateInIsolatedWorld("document.getElementById('pnhud-hero-pot-odds').innerHTML"), /Call 100 .* Need 17\.9%/);

var coalescedBefore = afterFlushPlacement.coalescedRequestCount;
harnessSupport.dispatchFrame(harness, socket('gC', { pot: 560, cPI: 'playerA', pITT: 'playerA' }), 'pot-update', 1150);
assert.strictEqual(JSON.parse(harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDPotOdds.placementInfo())')).renderPending, true);
harnessSupport.dispatchFrame(harness, socket('gC', { pot: 660, tB: { playerA: 'check', playerB: 200 }, cPI: 'playerA', pITT: 'playerA' }), 'raise-call200', 1200);
var updatePending = JSON.parse(harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDPotOdds.placementInfo())'));
assert.strictEqual(updatePending.renderPending, true, 'supported-to-supported change schedules immediately');
assert.strictEqual(updatePending.lastRequestCoalesced, true); assert.ok(updatePending.coalescedRequestCount > coalescedBefore, 'rapid authoritative frames share one pending render');
harness.flushAnimationFrames();
var updatedDecision = JSON.parse(harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDPotOdds.currentDecision())'));
assert.strictEqual(updatedDecision.status, 'supported'); assert.strictEqual(updatedDecision.amountToCall, 200);
assert.match(harness.evaluateInIsolatedWorld("document.getElementById('pnhud-hero-pot-odds').innerHTML"), /Call 200/);

harnessSupport.dispatchFrame(harness, socket('gC', { cPI: 'playerB', pITT: 'playerB' }), 'actor-advanced', 1300);
assert.strictEqual(JSON.parse(harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDPotOdds.placementInfo())')).renderPending, true, 'supported call to between-action zero presentation schedules an update');
harness.flushAnimationFrames();
var clearedDecision = JSON.parse(harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDPotOdds.currentDecision())'));
var clearedPlacement = JSON.parse(harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDPotOdds.placementInfo())'));
assert.strictEqual(clearedDecision.status, 'idle'); assert.strictEqual(clearedPlacement.renderRequested, true); assert.strictEqual(clearedPlacement.currentDecisionAvailable, false);
assert.strictEqual(clearedPlacement.presentationAmountToCall, 0); assert.strictEqual(clearedPlacement.presentationRequiredEquity, null);
assert.strictEqual(harness.evaluateInIsolatedWorld("document.getElementById('pnhud-hero-pot-odds').hidden"), false, 'pill remains mounted while villain acts');
assert.match(harness.evaluateInIsolatedWorld("document.getElementById('pnhud-hero-pot-odds').innerHTML"), /Call 0 .* Need —/, 'stale call values are replaced by the persistent zero presentation');

harnessSupport.dispatchFrame(harness, socket('gC', { pot: 460, tB: { playerA: 'check', playerB: 100 }, cPI: 'playerA', pITT: 'playerA' }), 'call100-restored', 1400);
harness.flushAnimationFrames();
var stableDecision = harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDPotOdds.currentDecision())');
var stableElement = harness.evaluateInIsolatedWorld("document.getElementById('pnhud-hero-pot-odds')");
(harness.listeners.resize || []).forEach(function (listener) { listener(); });
assert.strictEqual(harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDPotOdds.currentDecision())'), stableDecision, 'DevTools-style resize does not mutate semantic decision state');
assert.strictEqual(harness.evaluateInIsolatedWorld("document.getElementById('pnhud-hero-pot-odds')"), stableElement, 'resize reuses the single mounted pill');

var visiblePlacement = potOdds.heroPlacement({ viewport: { width: 1024, height: 768 }, size: { width: 250, height: 30 }, cardRect: { left: 466, top: 596, width: 92, height: 56 }, obstacleRects: [{ left: 392, top: 660, width: 240, height: 24 }] });
assert.strictEqual(visiblePlacement.safe, true); assert.strictEqual(visiblePlacement.selectedSide, 'left'); assert.strictEqual(visiblePlacement.horizontalGap, 10); assert.strictEqual(visiblePlacement.verticalCenterDelta, 0);

console.log('Pot-odds decision revision, coalesced no-resize render, update, removal, settings fingerprint, event matrix, and harmless resize regressions passed.');
