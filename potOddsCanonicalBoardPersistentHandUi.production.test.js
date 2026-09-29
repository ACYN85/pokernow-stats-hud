'use strict';

var assert = require('assert');
var harnessApi = require('./testSupport/potOddsProductionVisibilityHarness.js');

function frame(harness, eventName, patch, label) {
  harnessApi.dispatchFrame(harness, harnessApi.socket(eventName, patch), label, harness.now());
  harness.runFor(320, 16);
}

function visiblePanel(harness, callPattern, needPattern, label) {
  var actual = harnessApi.actualDomVisibility(harness);
  var placement = harnessApi.placement(harness);
  assert.strictEqual(actual.visible, true, label + ': panel visible');
  assert.strictEqual(harness.count('#pnhud-pot-odds-root'), 1, label + ': one root');
  assert.strictEqual(harness.count('#pnhud-hero-pot-odds'), 1, label + ': one host');
  assert.strictEqual(harness.count('.pnhud-pot-odds'), 1, label + ': one panel');
  assert.match(actual.host.innerHTML, callPattern, label + ': call');
  assert.match(actual.host.innerHTML, needPattern, label + ': need');
  return { actual: actual, placement: placement };
}

function assertCanonicalPosition(result, expectedUnion, label) {
  var placement = result.placement;
  assert.strictEqual(placement.chosenAnchorType, 'canonical-board-slot', label + ': canonical resolver branch');
  assert.match(placement.canonicalBoardSource, /^explicit five-card slot envelope/, label + ': canonical source');
  assert.deepStrictEqual(placement.canonicalBoardRect, { left: 520, top: 260, width: 306, height: 80, right: 826, bottom: 340 }, label + ': stable five-card slot');
  assert.deepStrictEqual(placement.emptyBoardContainerRect, placement.canonicalBoardRect, label + ': persistent empty owner');
  assert.deepStrictEqual(placement.actualBoardCardUnion, expectedUnion, label + ': actual card union diagnostic');
  assert.deepStrictEqual([placement.chosenPanelRect.left, placement.chosenPanelRect.top], [434, 272], label + ': chosen compact panel rect');
  assert.deepStrictEqual([result.actual.pillRect.left, result.actual.pillRect.top], [434, 272], label + ': rendered coordinates');
  assert.strictEqual(placement.horizontalGap, 10, label + ': exact horizontal contract');
  assert.strictEqual(placement.verticalCenterDelta, 0, label + ': exact vertical-center contract');
  assert.strictEqual(placement.selectedSide, 'left', label + ': preferred side');
}

var harness = harnessApi.createHarness({
  gameId: 'canonical-board-persistent-hand-ui', layout: 'live-full', liveCardDom: true,
  boardDom: false, persistentBoardSlot: true, viewport: { width: 1280, height: 665 }, initialNow: 1000
});
assert.deepStrictEqual(harness.evaluationErrors, []);

var registered = {
  currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 },
  gameState: {
    hI: 'CANONICAL-PERSISTENT-HAND', gT: ['holdem', 0], board: [], pot: 120,
    tB: { playerA: 'check', playerB: 'check' }, cPI: 'playerA', pITT: 'playerA', iHPI: ['playerA', 'playerB'],
    pGS: { playerA: 'inGame', playerB: 'inGame' },
    players: { playerA: { id: 'playerA', name: 'playerA', stack: 420 }, playerB: { id: 'playerB', name: 'playerB', stack: 420 } }
  }
};
frame(harness, 'registered', registered, 'free-action');
var free = visiblePanel(harness, /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, '1 free action');
assertCanonicalPosition(free, null, 'preflop');
assert.strictEqual(free.placement.currentDecisionAvailable, true);
assert.strictEqual(free.placement.panelVisibleReason, 'persistent table companion: ZERO');
var stableHost = harness.document.getElementById('pnhud-hero-pot-odds');

frame(harness, 'gC', { pot: 120, tB: { playerA: 'check', playerB: 40 }, cPI: 'playerA', pITT: 'playerA' }, 'villain-bet-40');
var facingBet = visiblePanel(harness, /Call<\/span><strong>40/, /Need<\/span><strong>25\.0%/, '2 villain bet');
assert.strictEqual(facingBet.placement.currentDecisionAvailable, true);
assert.strictEqual(facingBet.placement.currentAmountToCall, 40);

frame(harness, 'gC', { pot: 220, tB: { playerA: 100, playerB: 40 }, cPI: 'playerB', pITT: 'playerB' }, 'hero-raise');
var afterRaise = visiblePanel(harness, /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, '3 hero raises');
assert.strictEqual(harnessApi.decision(harness).status, 'idle', 'arithmetic decision remains NOT_USERS_TURN');
assert.strictEqual(afterRaise.placement.currentDecisionAvailable, false);
assert.strictEqual(afterRaise.placement.presentationAmountToCall, 0);
assert.strictEqual(afterRaise.placement.presentationRequiredEquity, null);
assert.strictEqual(afterRaise.placement.persistentZeroState, true);
assert.strictEqual(afterRaise.placement.panelVisibleReason, 'persistent table companion: ZERO');
assert.doesNotMatch(afterRaise.actual.host.innerHTML, /<strong>40<\/strong>|25\.0%/, 'no stale prior call survives the raise');

frame(harness, 'gC', { cPI: 'playerB', pITT: 'playerB' }, 'waiting-on-villain');
visiblePanel(harness, /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, '4 waiting on villain');

frame(harness, 'gC', { pot: 360, tB: { playerA: 100, playerB: 180 }, cPI: 'playerA', pITT: 'playerA' }, 'villain-reraise');
var reraise = visiblePanel(harness, /Call<\/span><strong>80/, /Need<\/span><strong>18\.2%/, '5 villain reraises');
assert.strictEqual(reraise.placement.currentDecisionAvailable, true);
assert.strictEqual(reraise.placement.presentationAmountToCall, 80);
assert.ok(Math.abs(reraise.placement.presentationRequiredEquity - 80 / 440) < 1e-12);

frame(harness, 'gC', { pot: 440, tB: { playerA: 180, playerB: 180 }, cPI: 'playerB', pITT: 'playerB' }, 'hero-call');
var afterCall = visiblePanel(harness, /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, '6 hero calls');
assert.strictEqual(afterCall.placement.currentDecisionAvailable, false);
assert.strictEqual(afterCall.placement.persistentZeroState, true);

var boardRects = harnessApi.boardRectsForLayout('live-full');
harness.fixture.mountCommunityBoard(boardRects);
frame(harness, 'gC', { gT: ['holdem', 1], board: ['Ah', 'Kd', '2c'], pot: 440, tB: { playerA: 'check', playerB: 'check' }, cPI: 'playerB', pITT: 'playerB' }, 'flop');
var flop = visiblePanel(harness, /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, '7 flop waiting');
assertCanonicalPosition(flop, { left: 520, top: 260, width: 182, height: 80, right: 702, bottom: 340 }, 'flop');

var turnRects = boardRects.concat([harnessApi.rect(706, 260, 58, 80)]);
harness.fixture.mountCommunityBoard(turnRects);
frame(harness, 'gC', { gT: ['holdem', 2], board: ['Ah', 'Kd', '2c', '7s'], tB: { playerA: 'check', playerB: 'check' } }, 'turn');
var turn = visiblePanel(harness, /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, 'turn');
assertCanonicalPosition(turn, { left: 520, top: 260, width: 244, height: 80, right: 764, bottom: 340 }, 'turn');

var riverRects = turnRects.concat([harnessApi.rect(768, 260, 58, 80)]);
harness.fixture.mountCommunityBoard(riverRects);
frame(harness, 'gC', { gT: ['holdem', 3], board: ['Ah', 'Kd', '2c', '7s', 'Jh'], tB: { playerA: 'check', playerB: 'check' } }, 'river');
var river = visiblePanel(harness, /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, 'river');
assertCanonicalPosition(river, { left: 520, top: 260, width: 306, height: 80, right: 826, bottom: 340 }, 'river');

assert.strictEqual(harness.document.getElementById('pnhud-hero-pot-odds'), stableHost, 'all decisions and streets reuse the same host');
assert.strictEqual(harness.count('.pnhud-pot-odds'), 1, 'all decisions and streets keep one panel');

frame(harness, 'gC', { cPI: 'playerB', pITT: 'playerB', iHPI: ['playerA', 'playerB'], pGS: { playerA: 'fold', playerB: 'inGame' } }, 'hero-fold');
var foldedPanel = visiblePanel(harness, /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, '8 hero fold persists');
var folded = foldedPanel.placement;
assert.strictEqual(folded.heroFolded, true);
assert.strictEqual(folded.contentState, 'ZERO');
assert.strictEqual(folded.panelHiddenReason, null);
assert.strictEqual(harness.document.getElementById('pnhud-hero-pot-odds'), stableHost, 'fold retains the same host');

console.log('Canonical-board and persistent active-hand pot-odds production regression passed:', JSON.stringify({
  preflop: free.actual.pillRect, flop: flop.actual.pillRect, turn: turn.actual.pillRect, river: river.actual.pillRect,
  stableHost: harness.document.getElementById('pnhud-hero-pot-odds') === stableHost
}));
