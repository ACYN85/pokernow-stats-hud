'use strict';

var assert = require('assert');
var manifest = require('./manifest.json');
var harnessApi = require('./testSupport/potOddsProductionVisibilityHarness.js');

function closeTo(actual, expected, label) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) < 0.01, label + ': expected ' + expected + ', received ' + actual);
}

function dispatchCall80(harness, suffix) {
  harnessApi.dispatchFrame(harness, harnessApi.socket('registered', {
    currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 },
    gameState: {
      hI: 'BOARD-ANCHOR-CALL-80-' + suffix, gT: ['holdem', 1], pot: 120,
      tB: { playerA: 'check', playerB: 80 }, cPI: 'playerA', pITT: 'playerA', iHPI: ['playerA', 'playerB'],
      pGS: { playerA: 'inGame', playerB: 'inGame' },
      players: { playerA: { id: 'playerA', name: 'playerA', stack: 420 }, playerB: { id: 'playerB', name: 'playerB', stack: 420 } }
    }
  }), 'board-anchor-call80-' + suffix, harness.now());
}

function assertManifestHarness(harness) {
  assert.deepStrictEqual(harness.evaluationErrors, [], 'exact isolated-world scripts evaluate cleanly');
  var isolated = manifest.content_scripts.find(function (entry) { return entry.world !== 'MAIN' && entry.js.includes('content.js'); }).js;
  assert.deepStrictEqual(harness.isolatedScripts, isolated, 'fixture loads the exact manifest content-script order');
}

function assertBoardPlacement(harness, expectedSide, expectedPanelLeft, label) {
  var placement = harnessApi.placement(harness);
  var actual = harnessApi.actualDomVisibility(harness);
  var expectedBoard = { left: 520, top: 260, width: 306, height: 80, right: 826, bottom: 340 };
  assert.strictEqual(actual.visible, true, label + ': independent DOM visibility passes');
  assert.strictEqual(placement.actualVisibility.visible, true, label + ': production mounted visibility passes');
  assert.strictEqual(placement.chosenAnchorType, 'canonical-board-slot', label + ': canonical community-board owner is the chosen anchor');
  assert.strictEqual(placement.chosenAnchor, 'canonical-board-slot');
  assert.strictEqual(placement.fallbackUsed, false, label + ': hero-card fallback is not used');
  assert.strictEqual(placement.selectedSide, expectedSide, label + ': expected horizontal side is selected');
  assert.strictEqual(placement.horizontalGap, 10, label + ': exact board gap');
  assert.strictEqual(placement.verticalCenterDelta, 0, label + ': panel and board centers align');
  ['left', 'top', 'width', 'height', 'right', 'bottom'].forEach(function (field) {
    closeTo(placement.boardRectUsed[field], expectedBoard[field], label + ' board rect ' + field);
  });
  closeTo(placement.proposedPanelRect.left, expectedPanelLeft, label + ' proposed panel left');
  closeTo(actual.pillRect.left, expectedPanelLeft, label + ' rendered panel left');
  closeTo(actual.pillRect.top, 270, label + ' rendered panel top');
  assert.strictEqual(actual.pillRect.width, 100, label + ': compact vertical width is preserved');
  assert.strictEqual(actual.pillRect.height, 60, label + ': compact vertical height is preserved');
  assert.strictEqual(actual.host.style.transform || '', '', label + ': direct left/top placement has no transform');
  assert.strictEqual(actual.host.style.left, expectedPanelLeft + 'px', label + ': direct left coordinate');
  assert.strictEqual(actual.host.style.top, '270px', label + ': direct top coordinate');
  assert.strictEqual(placement.collision.card, false, label + ': panel does not overlap the board');
  assert.strictEqual(placement.suppressionReason, null, label + ': placement is not suppressed');
  assert.strictEqual(harness.count('#pnhud-pot-odds-root'), 1);
  assert.strictEqual(harness.count('#pnhud-hero-pot-odds'), 1);
  assert.strictEqual(harness.count('.pnhud-pot-odds'), 1);
  assert.match(actual.host.innerHTML, /pnhud-pot-odds-title[^>]*>POT ODDS/);
  assert.match(actual.host.innerHTML, /pnhud-pot-odds-label[^>]*>Call/);
  assert.match(actual.host.innerHTML, /pnhud-pot-odds-label[^>]*>Need/);
  return { placement: placement, actual: actual };
}

var left = harnessApi.createHarness({ gameId: 'pot-odds-board-left', layout: 'live-full', liveCardDom: true, boardDom: true, persistentBoardSlot: true, viewport: { width: 1280, height: 665 }, initialNow: 1000 });
assertManifestHarness(left);
dispatchCall80(left, 'left');
left.runFor(1200, 16);
var leftDecision = harnessApi.decision(left);
assert.deepStrictEqual([leftDecision.status, leftDecision.amountToCall, leftDecision.currentEligiblePot, leftDecision.potAfterCall, Math.round(leftDecision.requiredEquity * 1000) / 10], ['supported', 80, 120, 200, 40], 'CALL 80 into 120 arithmetic is unchanged');
var leftResult = assertBoardPlacement(left, 'left', 410, 'visible flop board-left placement without resize');
assert.strictEqual(leftResult.placement.heroAnchorDiagnostic.boardCandidateCount, 1);
assert.strictEqual(leftResult.placement.heroAnchorDiagnostic.selectedBoardCards.length, 3);
assert.match(leftResult.placement.heroAnchorDiagnostic.boardAcquisitionStrategy, /^explicit five-card slot envelope/);
assert.strictEqual(harnessApi.timeline(left).events.some(function (event) { return event.eventType === 'viewport-change'; }), false, 'initial board placement needs no resize or DevTools signal');

// An ordinary hero-seat replacement wakes normal table reconciliation but must
// neither replace the stable pot-odds host nor move it away from the board.
var stableHost = left.document.getElementById('pnhud-hero-pot-odds');
var stableFingerprint = leftResult.placement.currentRenderFingerprint;
left.fixture.replaceHeroSeat(harnessApi.cardRectsForLayout('live-full'));
left.runFor(1500, 16);
var reconciled = assertBoardPlacement(left, 'left', 410, 'ordinary seat/table reconcile');
assert.strictEqual(left.document.getElementById('pnhud-hero-pot-odds'), stableHost, 'ordinary reconcile reuses the stable host');
assert.strictEqual(reconciled.placement.currentRenderFingerprint, stableFingerprint, 'ordinary reconcile preserves the semantic decision');

// A pot display occupying LEFT is diagnosed but cannot move pot odds into the
// RIGHT slot, which is reserved for a future board companion.
var right = harnessApi.createHarness({ gameId: 'pot-odds-board-right', layout: 'live-full', liveCardDom: true, boardDom: true, persistentBoardSlot: true, viewport: { width: 1280, height: 665 }, initialNow: 5000 });
assertManifestHarness(right);
right.fixture.setPotGeometry(harnessApi.rect(410, 270, 100, 60));
dispatchCall80(right, 'right');
right.runFor(1200, 16);
var rightResult = assertBoardPlacement(right, 'left', 410, 'fixed board-left slot when pot overlaps');
assert.strictEqual(rightResult.placement.collisionInfo.candidates[0].side, 'left');
assert.strictEqual(rightResult.placement.collisionInfo.candidates[0].safe, true, 'LEFT remains authoritative');
assert.ok(rightResult.placement.collisionInfo.candidates[0].collision.obstacleIndexes.length > 0, 'overlap is diagnosed');
assert.strictEqual(rightResult.placement.collisionInfo.candidates[1].side, 'right-reserved');
assert.match(rightResult.placement.collisionReason, /fixed LEFT companion overlaps/);
assert.ok(rightResult.placement.collisionInfo.obstacles.some(function (entry) { return entry.type === 'pot-display'; }), 'diagnostics identify the pot-display obstacle');

// A postflop decision can arrive before its board DOM. The supported decision
// remains retained during the bounded burst; a board mutation then resolves it
// without viewport input and before hero-card fallback is unlocked.
var delayed = harnessApi.createHarness({ gameId: 'pot-odds-board-delayed', layout: 'live-full', liveCardDom: true, boardDom: false, persistentBoardSlot: true, viewport: { width: 1280, height: 665 }, initialNow: 9000 });
assertManifestHarness(delayed);
dispatchCall80(delayed, 'delayed');
delayed.runFor(32, 16);
var waiting = harnessApi.placement(delayed);
assert.strictEqual(harnessApi.decision(delayed).status, 'supported', 'supported decision is retained while board geometry is absent');
assert.strictEqual(waiting.visible, true);
assert.strictEqual(waiting.chosenAnchorType, 'canonical-board-slot');
assert.strictEqual(waiting.fallbackUsed, false, 'bounded board acquisition does not immediately jump to hero cards');
assert.strictEqual(waiting.suppressionReason, null);
assert.strictEqual(waiting.visibilityStats.animationFrameRetries, 0, 'persistent slots require no acquisition burst');
delayed.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full'));
delayed.runFor(800, 16);
var delayedResult = assertBoardPlacement(delayed, 'left', 410, 'board mutation reacquisition without resize');
assert.strictEqual(delayedResult.placement.visibilityStats.animationFrameRetries, 0, 'card mount changes no persistent-slot acquisition policy');
assert.strictEqual(delayedResult.placement.retryState, 'visible-stable', 'board mutation ends in the stable visible state');
assert.strictEqual(harnessApi.timeline(delayed).events.some(function (event) { return event.eventType === 'viewport-change'; }), false, 'board reacquisition needs no resize');

var stableStats = harnessApi.clone(reconciled.placement.visibilityStats);
var stableTimeline = harnessApi.timeline(left).events.length;
left.runFor(30000, 100);
var stableAfter = harnessApi.placement(left);
assert.strictEqual(stableAfter.visibilityStats.placementAttempts, stableStats.placementAttempts, '30 stable seconds add no placement attempts');
assert.strictEqual(stableAfter.visibilityStats.domWrites, stableStats.domWrites, '30 stable seconds add no DOM writes');
assert.strictEqual(stableAfter.visibilityStats.timerRetries, 0, 'stable board placement has no timer retries');
assert.strictEqual(harnessApi.timeline(left).events.length, stableTimeline, '30 stable seconds add no diagnostic noise');
assert.deepStrictEqual(left.pendingWork(), { timers: 0, animationFrames: 0, mutationRecords: 0 }, 'stable board placement ends quiescent');

console.log('Community-board pot-odds placement production regression passed:', JSON.stringify({
  boardLeft: leftResult.actual.pillRect,
  fixedBoardLeftDuringCollision: rightResult.actual.pillRect,
  delayedBoardFrames: delayedResult.placement.visibilityStats.animationFrameRetries,
  stableThirtySeconds: { placementAttempts: stableAfter.visibilityStats.placementAttempts, domWrites: stableAfter.visibilityStats.domWrites, timerRetries: stableAfter.visibilityStats.timerRetries }
}));
