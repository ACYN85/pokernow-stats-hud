'use strict';
var assert = require('assert');
var fs = require('fs');
var potOdds = require('./potOdds.js');
var tbTrace = require('./tbTrace.js');
var harnessSupport = require('./testSupport/productionContentScriptHarness.js');

function decision(continuity) {
  return potOdds.resolve(Object.assign({}, potOdds.liveStateFromContinuity(continuity), {
    enabled: true, localPlayerId: 'playerA', actorSource: 'pITT/cPI', actionSource: 'semantic live continuity'
  }));
}

var call100 = {
  hI: 'LIVE-CALL-100', gT: ['holdem', 1], pot: 460, tB: { playerA: 'check', playerB: 100 }, cPI: 'playerA', pITT: 'playerA',
  iHPI: ['playerA', 'playerB'], pGS: { playerA: 'inGame', playerB: 'inGame' }, players: { playerA: { stack: 420 }, playerB: { stack: 420 } }
};
var continuity = potOdds.createLiveStateContinuity();
potOdds.observeLiveStateContinuity(continuity, { handId: call100.hI, authoritativeHandId: call100.hI, frameId: 'call100-1', timestamp: 100, eventName: 'gC', source: 'authoritative merged PokerNow game state', currentState: call100, patch: call100 });
var before = decision(continuity);
assert.strictEqual(before.status, 'supported'); assert.strictEqual(before.amountToCall, 100); assert.strictEqual(before.currentEligiblePot, 460); assert.strictEqual(before.potAfterCall, 560); assert.strictEqual(potOdds.formatPercent(before.requiredEquity), '17.9%');

[
  'confirmed seat resized', 'hero cards resized', 'opponent seat resized', 'viewport resized', 'HUD rerender', 'HUD drag/move',
  'player dashboard opened/closed', 'Settings opened/closed', 'seat DOM rediscovery', 'player-name text refresh',
  'overlay reconciliation', 'responsive layout mode changed'
].forEach(function (reason, index) {
  var preserved = potOdds.preserveLiveStateOnVisualReconcile(continuity, reason, 200 + index);
  assert.strictEqual(preserved.handId, 'LIVE-CALL-100'); assert.strictEqual(preserved.revision, 1);
  var after = decision(continuity);
  assert.strictEqual(after.status, 'supported', reason + ' preserves supported decision');
  assert.strictEqual(after.amountToCall, 100); assert.strictEqual(after.currentEligiblePot, 460); assert.strictEqual(potOdds.formatPercent(after.requiredEquity), '17.9%');
});
var info = potOdds.liveStateContinuityInfo(continuity);
assert.strictEqual(info.preservedVisualReconcileCount, 12); assert.strictEqual(info.lastReconcile.semanticMutation, false); assert.strictEqual(info.lastAuthoritativeUpdate.handId, 'LIVE-CALL-100');

var sparsePatch = { players: { playerA: { stack: 420 } } };
var merged = tbTrace.mergeSnapshot(call100, sparsePatch);
potOdds.observeLiveStateContinuity(continuity, { handId: 'LIVE-CALL-100', frameId: 'call100-2', timestamp: 300, eventName: 'gC', source: 'authoritative sparse merged patch', previousState: call100, currentState: merged, patch: sparsePatch });
var afterSparse = decision(continuity);
assert.strictEqual(afterSparse.status, 'supported', 'missing sparse fields do not mean clear'); assert.strictEqual(afterSparse.evidence.actor, 'playerA'); assert.strictEqual(afterSparse.evidence.currentPot, 460); assert.strictEqual(afterSparse.evidence.streetCommitmentTotal, 100);

var placement = potOdds.heroPlacement({ viewport: { width: 1024, height: 768 }, size: { width: 250, height: 30 }, cardRect: { left: 466, top: 596, width: 92, height: 56 }, obstacleRects: [{ left: 392, top: 660, width: 240, height: 24 }] });
assert.strictEqual(placement.safe, true); assert.strictEqual(placement.selectedSide, 'left'); assert.ok(potOdds.widgetHtml(afterSparse).includes('Call 100 · Need 17.9%'), 'preserved supported decision still requests visible left-of-card widget');

var nextHand = { hI: 'LIVE-NEXT', gT: ['holdem', 0], pot: 30, tB: { playerA: 20, playerB: 10 }, cPI: 'playerB', pITT: 'playerB', iHPI: ['playerA', 'playerB'], pGS: { playerA: 'inGame', playerB: 'inGame' }, players: { playerA: { stack: 400 }, playerB: { stack: 410 } } };
potOdds.observeLiveStateContinuity(continuity, { handId: 'LIVE-NEXT', frameId: 'next-1', timestamp: 400, eventName: 'gC', source: 'authoritative new hand', currentState: nextHand, patch: nextHand });
assert.strictEqual(continuity.currentHandId, 'LIVE-NEXT'); assert.strictEqual(potOdds.liveStateContinuityInfo(continuity).lastReset.reason, 'authoritative new hand superseded prior live hand'); assert.notStrictEqual(decision(continuity).status, 'supported', 'actor advance/new hand clears stale CALL 100');

potOdds.resetLiveStateContinuity(continuity, 'authoritative terminal settlement', 'merged lifecycle', 500);
assert.strictEqual(potOdds.liveStateFromContinuity(continuity), null); assert.strictEqual(potOdds.liveStateContinuityInfo(continuity).lastReset.reason, 'authoritative terminal settlement');

var reconnected = potOdds.createLiveStateContinuity();
potOdds.observeLiveStateContinuity(reconnected, { handId: 'LIVE-CALL-100', frameId: 'registered-active', timestamp: 600, eventName: 'registered', source: 'authoritative reconnect active snapshot', currentState: call100, patch: call100 });
assert.strictEqual(decision(reconnected).status, 'supported', 'active reconnect reconstructs when sufficient authoritative state arrives');
potOdds.resetLiveStateContinuity(reconnected, 'authoritative table lifecycle waiting', 'authoritative reconnect no-active-hand', 700);
assert.strictEqual(potOdds.liveStateFromContinuity(reconnected), null, 'authoritative reconnect into no active hand clears stale state');

var content = fs.readFileSync('./content.js', 'utf8');
assert.match(content, /var currentAuthoritativeHandId = typeof currentSnapshot\.hI === 'string'/, 'PokerNow authoritative hI is read without changing durable lifecycle identity');
assert.match(content, /var liveBettingHandId = currentAuthoritativeHandId \|\| currentMergedHandId/, 'authoritative hI directly owns live decision continuity when lifecycle identity is not established');
assert.match(content, /observeLiveStateContinuity\(potOddsLiveState/, 'every authoritative merged snapshot feeds independent live decision continuity');
assert.ok(content.indexOf('observeLiveStateContinuity(potOddsLiveState') < content.indexOf('var semanticLedgerOwnedHand'), 'live decision observation is not gated by finalization-owned active-hand state');
assert.match(content, /var liveState = PokerPotOdds\.liveStateFromContinuity\(potOddsLiveState\)/, 'production pot odds consume the continuity ledger');
assert.match(content, /preserveLiveStateOnVisualReconcile\(potOddsLiveState/, 'visual reconciliation records preservation without semantic mutation');
assert.match(content, /authoritative terminal settlement/); assert.match(content, /authoritative table lifecycle/); assert.match(content, /authoritative local user left active table\/seat/); assert.match(content, /explicit Reset Session/); assert.match(content, /extension\/table lifecycle cleanup/);
assert.doesNotMatch(content, /CALL\s*100[\s\S]*PokerPotOdds\.resolve|querySelector[^\n]*CALL/i, 'production never synthesizes decisions from CALL button text');
assert.match(content, /liveStateProvenance: PokerPotOdds\.liveStateContinuityInfo\(potOddsLiveState\)/, 'currentDecision exposes bounded update/reset/reconcile provenance');

function socket(eventName, payload) { return '42[' + JSON.stringify(eventName) + ',' + JSON.stringify(payload) + ']'; }
var harness = harnessSupport.createHarness({ gameId: 'pot-odds-call-100-reconcile', controlledAnimationFrames: true });
assert.deepStrictEqual(harness.evaluationErrors, []);
harnessSupport.dispatchFrame(harness, socket('registered', { currentPlayer: { id: 'playerA' }, gameState: call100 }), 'call100-registered', 800);
harnessSupport.dispatchFrame(harness, socket('gC', { cPI: 'playerA' }), 'call100-sparse', 900);
harness.flushAnimationFrames();
var productionDecision = JSON.parse(harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDPotOdds.currentDecision())'));
var productionPlacement = JSON.parse(harness.evaluateInIsolatedWorld('JSON.stringify(PokerNowHUDPotOdds.placementInfo())'));
assert.strictEqual(productionDecision.status, 'supported'); assert.strictEqual(productionDecision.handId, 'LIVE-CALL-100'); assert.strictEqual(productionDecision.amountToCall, 100); assert.strictEqual(productionDecision.currentEligiblePot, 460); assert.strictEqual(potOdds.formatPercent(productionDecision.requiredEquity), '17.9%');
assert.strictEqual(productionDecision.evidence.liveStateProvenance.currentHandId, 'LIVE-CALL-100'); assert.strictEqual(productionDecision.evidence.liveStateProvenance.lastAuthoritativeUpdate.source, 'authoritative merged PokerNow game state');
assert.strictEqual(productionPlacement.renderRequested, true); assert.strictEqual(productionPlacement.supportedDecision, true, 'exact content-script path requests rendering after authoritative CALL-100 continuity');
assert.strictEqual(placement.safe, true, 'with real hero-card fixture geometry the requested production render is visibly placeable');

console.log('Pot-odds authoritative live-state continuity, visual reconcile preservation, valid reset, reconnect, CALL-100 render, and no-DOM-fallback regressions passed.');
