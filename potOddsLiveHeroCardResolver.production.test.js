'use strict';

var assert = require('assert');
var manifest = require('./manifest.json');
var harnessApi = require('./testSupport/potOddsProductionVisibilityHarness.js');

function dispatchCall80(harness) {
  harnessApi.dispatchFrame(harness, harnessApi.socket('registered', {
    currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 },
    gameState: {
      hI: 'LIVE-CARD-NON-ANCHOR-CALL-80', gT: ['holdem', 1], pot: 120,
      tB: { playerA: 'check', playerB: 80 }, cPI: 'playerA', pITT: 'playerA', iHPI: ['playerA', 'playerB'],
      pGS: { playerA: 'inGame', playerB: 'inGame' },
      players: { playerA: { id: 'playerA', name: 'playerA', stack: 420 }, playerB: { id: 'playerB', name: 'playerB', stack: 420 } }
    }
  }), 'live-card-non-anchor-call80', harness.now());
}

function assertBoardCompanionPanel(harness, expectedBoardLeft, label) {
  var placement = harnessApi.placement(harness);
  var actual = harnessApi.actualDomVisibility(harness);
  assert.strictEqual(actual.visible, true, label + ': visible');
  assert.strictEqual(placement.chosenAnchorType, 'canonical-board-slot', label + ': hero cards are not an anchor');
  assert.strictEqual(placement.heroCardRect, null, label + ': no hero-card fallback geometry is consumed');
  assert.strictEqual(placement.canonicalBoardRect.left, expectedBoardLeft, label + ': canonical board left');
  assert.strictEqual(actual.pillRect.right, expectedBoardLeft - 10, label + ': fixed LEFT companion contract');
  assert.strictEqual(placement.horizontalGap, 10);
  assert.strictEqual(placement.verticalCenterDelta, 0);
  return { placement: placement, actual: actual };
}

var harness = harnessApi.createHarness({
  gameId: 'pot-odds-live-card-non-anchor', layout: 'live-full', liveCardDom: true,
  persistentBoardSlot: true, viewport: { width: 1280, height: 665 }, initialNow: 1000
});
assert.deepStrictEqual(harness.evaluationErrors, []);
var isolatedScripts = manifest.content_scripts.find(function (entry) { return entry.world !== 'MAIN' && entry.js.includes('content.js'); }).js;
assert.deepStrictEqual(harness.isolatedScripts, isolatedScripts, 'test runs exact production manifest order');

var liveSeat = harness.fixture.hero.seat;
assert.strictEqual(liveSeat.matches('.table-player.table-player-1.decision-current.you-player'), true);
assert.strictEqual(liveSeat.querySelectorAll('.card-container.card-p1, .card-container.card-p2').length, 2, 'observed hero cards exist but are deliberately irrelevant to companion placement');

dispatchCall80(harness);
harness.runFor(1200, 16);
var decision = harnessApi.decision(harness);
assert.deepStrictEqual([decision.status, decision.amountToCall, decision.currentEligiblePot, decision.potAfterCall, Math.round(decision.requiredEquity * 1000) / 10], ['supported', 80, 120, 200, 40], 'CALL 80 arithmetic is unchanged');
var initial = assertBoardCompanionPanel(harness, 520, 'initial live layout');
var stableHost = harness.document.getElementById('pnhud-hero-pot-odds');

var previousCards = harness.fixture.cards.elements.slice();
harness.fixture.mountHeroCards([harnessApi.rect(420, 410, 74, 86.1), harnessApi.rect(470, 410, 74, 86.1)]);
harness.runFor(240, 16);
previousCards.forEach(function (card) { assert.strictEqual(card.isConnected, false); });
var afterHeroCardMove = assertBoardCompanionPanel(harness, 520, 'hero-card DOM replacement');
assert.deepStrictEqual(afterHeroCardMove.actual.pillRect, initial.actual.pillRect, 'hero-card changes cannot move the board companion');
assert.strictEqual(harness.document.getElementById('pnhud-hero-pot-odds'), stableHost);

var opponentCard = harness.document.createElement('div');
opponentCard.className = 'card-container card-p1';
opponentCard.setRect(harnessApi.rect(120, 120, 74, 86.1));
harness.fixture.opponent.seat.appendChild(opponentCard);
harness.runFor(240, 16);
assert.deepStrictEqual(assertBoardCompanionPanel(harness, 520, 'opponent-card mutation').actual.pillRect, initial.actual.pillRect, 'opponent cards cannot contaminate board discovery');

harness.fixture.setLayout('live-narrow');
harness.setViewport(900, 665, true);
harness.runFor(500, 16);
var narrowed = assertBoardCompanionPanel(harness, 370, 'responsive board layout');
assert.strictEqual(harness.document.getElementById('pnhud-hero-pot-odds'), stableHost, 'responsive layout reuses the host');
assert.strictEqual(narrowed.placement.currentRenderFingerprint, initial.placement.currentRenderFingerprint, 'visual resize preserves semantic decision');

var stableStats = harnessApi.clone(narrowed.placement.visibilityStats);
var timelineCount = harnessApi.timeline(harness).events.length;
harness.runFor(30000, 100);
var after = harnessApi.placement(harness).visibilityStats;
assert.strictEqual(after.placementAttempts, stableStats.placementAttempts);
assert.strictEqual(after.domWrites, stableStats.domWrites);
assert.strictEqual(after.timerRetries, 0);
assert.strictEqual(harnessApi.timeline(harness).events.length, timelineCount);
assert.deepStrictEqual(harness.pendingWork(), { timers: 0, animationFrames: 0, mutationRecords: 0 });

console.log('Hero-card non-anchor and shared board-companion production regression passed:', JSON.stringify({ initial: initial.actual.pillRect, afterHeroCardMove: afterHeroCardMove.actual.pillRect, narrowed: narrowed.actual.pillRect }));
