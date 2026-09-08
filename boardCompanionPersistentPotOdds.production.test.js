'use strict';

var assert = require('assert');
var harnessApi = require('./testSupport/potOddsProductionVisibilityHarness.js');

function frame(harness, eventName, patch, label) {
  harnessApi.dispatchFrame(harness, harnessApi.socket(eventName, patch), label, harness.now());
  harness.runFor(360, 16);
}

function panel(harness, state, label) {
  var actual = harnessApi.actualDomVisibility(harness);
  var placement = harnessApi.placement(harness);
  assert.strictEqual(actual.visible, true, label + ': visible');
  assert.strictEqual(placement.contentState, state, label + ': content state');
  assert.strictEqual(harness.count('#pnhud-hero-pot-odds'), 1, label + ': one host');
  assert.strictEqual(harness.count('.pnhud-pot-odds'), 1, label + ': one pill');
  if (state === 'CALL') {
    assert.match(actual.host.innerHTML, /Call<\/span><strong>[1-9]/, label + ': real chip call value');
    assert.doesNotMatch(actual.host.innerHTML, /Need<\/span><strong>—/, label + ': real equity threshold');
  } else if (state === 'ZERO') {
    assert.match(actual.host.innerHTML, /Call<\/span><strong>0<\/strong>/, label + ': Call 0 chips');
    assert.match(actual.host.innerHTML, /Need<\/span><strong>—<\/strong>/, label + ': Need dash');
  } else {
    assert.match(actual.host.innerHTML, /Call<\/span><strong>—<\/strong>/, label + ': unknown call dash');
    assert.match(actual.host.innerHTML, /Need<\/span><strong>—<\/strong>/, label + ': unknown need dash');
  }
  assert.strictEqual(placement.chosenAnchorType, 'canonical-board-slot', label + ': shared board service');
  assert.strictEqual(placement.selectedSide, 'left', label + ': fixed LEFT slot');
  assert.strictEqual(placement.horizontalGap, 10, label + ': exact 10px gap');
  return { actual: actual, placement: placement };
}

function activeState(handId, values) {
  return Object.assign({
    hI: handId, gT: ['holdem', 0], board: [], pot: 120,
    tB: { playerA: 'check', playerB: 'check' }, cPI: 'playerA', pITT: 'playerA', iHPI: ['playerA', 'playerB'],
    pGS: { playerA: 'inGame', playerB: 'inGame' },
    players: { playerA: { id: 'playerA', name: 'playerA', stack: 420 }, playerB: { id: 'playerB', name: 'playerB', stack: 420 } }
  }, values || {});
}

var harness = harnessApi.createHarness({
  gameId: 'board-companion-table-lifetime', layout: 'live-full', liveCardDom: true,
  boardDom: false, persistentBoardSlot: true, viewport: { width: 1280, height: 665 }, initialNow: 1000
});
assert.deepStrictEqual(harness.evaluationErrors, []);

frame(harness, 'registered', {
  currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 },
  gameState: { pot: 0, board: [], iHPI: [], pGS: { playerA: 'inGame', playerB: 'inGame' }, players: { playerA: { id: 'playerA', name: 'playerA', stack: 420 }, playerB: { id: 'playerB', name: 'playerB', stack: 420 } } }
}, 'before-hand');
var before = panel(harness, 'ZERO', '11 before hand');
var stableHost = harness.document.getElementById('pnhud-hero-pot-odds');
assert.strictEqual(before.placement.tableLifecycleState, 'between-hands');

frame(harness, 'gC', activeState('TABLE-LIFETIME-1'), 'free-preflop');
panel(harness, 'ZERO', '12 free preflop');

frame(harness, 'gC', { pot: 180, tB: { playerA: 'check', playerB: 60 }, cPI: 'playerA', pITT: 'playerA' }, 'facing-raise');
var facing = panel(harness, 'CALL', '13 facing raise');
assert.strictEqual(facing.placement.presentationAmountToCall, 60);

frame(harness, 'gC', { pot: 240, tB: { playerA: 60, playerB: 60 }, cPI: 'playerB', pITT: 'playerB' }, 'hero-call');
panel(harness, 'ZERO', '14 hero calls');

frame(harness, 'gC', { gT: ['holdem', 1], board: ['Ah', 'Kd', '2c'], pot: 240, tB: { playerA: 'check', playerB: 'check' }, cPI: 'playerA', pITT: 'playerA' }, 'flop-free');
harness.fixture.mountCommunityBoard(harnessApi.boardRectsForLayout('live-full'));
harness.runFor(240, 16);
frame(harness, 'gC', { pot: 300, tB: { playerA: 60, playerB: 'check' }, cPI: 'playerB', pITT: 'playerB' }, 'hero-bet');
panel(harness, 'ZERO', '15 hero bets');

frame(harness, 'gC', { pot: 420, tB: { playerA: 60, playerB: 180 }, cPI: 'playerA', pITT: 'playerA' }, 'opponent-raise');
panel(harness, 'CALL', 'opponent raise before hero reraises');
frame(harness, 'gC', { pot: 600, tB: { playerA: 240, playerB: 180 }, cPI: 'playerB', pITT: 'playerB' }, 'hero-reraise');
panel(harness, 'ZERO', '16 hero raises');
panel(harness, 'ZERO', '17 opponent acts');

var wrapperRawLeft = harness.fixture.boardSlot.getBoundingClientRect().left;
var liveInfo = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo())'));
assert.strictEqual(wrapperRawLeft, 430, 'production-shaped wrapper is deliberately wider than the slot envelope');
assert.strictEqual(liveInfo.canonicalBoardRect.left, 520, 'canonical board left comes from slot children, not wrapper.left');
assert.strictEqual(liveInfo.leftCompanionRect.right, 510);
assert.strictEqual(liveInfo.rightCompanionRect.left, 836);

harness.fixture.removeBoardSlotOwner();
harness.runFor(240, 16);
var cached = panel(harness, 'ZERO', 'same-table temporary board DOM loss');
var cachedInfo = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.layoutInfo())'));
assert.strictEqual(cachedInfo.cachedGeometryReused, true, 'temporary geometry loss reuses last verified same-table geometry');
assert.strictEqual(cached.actual.pillRect.left, 410, 'temporary loss does not move the widget');
harness.fixture.restoreBoardSlotOwner();
harness.runFor(240, 16);
panel(harness, 'ZERO', 'same-table board owner remount');

frame(harness, 'gC', { pGS: { playerA: 'fold', playerB: 'inGame' }, cPI: 'playerB', pITT: 'playerB' }, 'hero-fold');
panel(harness, 'ZERO', '18 hero folds');

frame(harness, 'gC', activeState('TABLE-LIFETIME-2'), 'next-hand-for-allin');
panel(harness, 'ZERO', 'next active hand starts');
frame(harness, 'gC', {
  pot: 960, tB: { playerA: 420, playerB: 420 }, cPI: 'playerB', pITT: 'playerB',
  players: { playerA: { id: 'playerA', name: 'playerA', stack: 0, allIn: true }, playerB: { id: 'playerB', name: 'playerB', stack: 0, allIn: true } }
}, 'hero-all-in');
panel(harness, 'ZERO', '19 hero all-in');

frame(harness, 'gC', { gT: ['holdem', 1], board: ['Ah', 'Kd', '2c'], cPI: null, pITT: null }, 'allin-flop');
panel(harness, 'ZERO', '20 board runs out while all-in flop');
var turnRects = harnessApi.boardRectsForLayout('live-full').concat([harnessApi.rect(706, 260, 58, 80)]);
harness.fixture.mountCommunityBoard(turnRects);
frame(harness, 'gC', { gT: ['holdem', 2], board: ['Ah', 'Kd', '2c', '7s'] }, 'allin-turn');
panel(harness, 'ZERO', '20 board runs out while all-in turn');
var riverRects = turnRects.concat([harnessApi.rect(768, 260, 58, 80)]);
harness.fixture.mountCommunityBoard(riverRects);
frame(harness, 'gC', { gT: ['holdem', 3], board: ['Ah', 'Kd', '2c', '7s', 'Jh'], showdown: true }, 'showdown');
panel(harness, 'ZERO', '21 showdown');

frame(harness, 'gC', { gameResult: { winnerId: 'playerB', complete: true }, cPI: null, pITT: null }, 'hand-end');
panel(harness, 'ZERO', '22 hand ends');
harness.fixture.removeCommunityBoard();
harness.runFor(240, 16);
panel(harness, 'ZERO', '23 between hands');

frame(harness, 'gC', activeState('TABLE-LIFETIME-3'), 'next-hand');
panel(harness, 'ZERO', '24 next hand');
assert.strictEqual(harness.document.getElementById('pnhud-hero-pot-odds'), stableHost, '24 next hand reuses the same host');

var enabledPreferences = harnessApi.clone(harness.storage.hudUiPreferences);
var disabledPreferences = Object.assign({}, enabledPreferences, { showPotOdds: false });
harness.emitStorageChange({ hudUiPreferences: { oldValue: enabledPreferences, newValue: disabledPreferences } });
harness.runFor(180, 16);
assert.strictEqual(harnessApi.actualDomVisibility(harness).visible, false, '25 setting OFF hides');
harness.emitStorageChange({ hudUiPreferences: { oldValue: disabledPreferences, newValue: enabledPreferences } });
harness.runFor(240, 16);
panel(harness, 'ZERO', '26 setting ON restores');
assert.strictEqual(harness.document.getElementById('pnhud-hero-pot-odds'), stableHost, 'setting cycle retains host identity');

frame(harness, 'gC', { pGS: { playerA: 'out', playerB: 'inGame' }, iHPI: ['playerB'] }, 'hero-left-seat');
assert.strictEqual(harnessApi.actualDomVisibility(harness).visible, false, '27 hero leaves seat hides');
assert.strictEqual(harnessApi.placement(harness).panelHiddenReason, 'canonical local player is no longer seated');

var snapshot = JSON.parse(harness.evaluate('JSON.stringify(PokerNowHUDBoardCompanion.captureLayoutSnapshot())'));
var serializedSnapshot = JSON.stringify(snapshot);
assert.ok(snapshot.canonicalBoardRect && snapshot.leftCompanionRect && snapshot.rightCompanionRect, 'layout snapshot exports both companion contracts');
assert.ok(!/playerA|playerB|Ah|Kd|2c|7s|Jh/.test(serializedSnapshot), 'snapshot excludes names and card values');

var unknownHarness = harnessApi.createHarness({
  gameId: 'board-companion-unknown', layout: 'live-full', liveCardDom: true,
  boardDom: false, persistentBoardSlot: true, viewport: { width: 1280, height: 665 }, initialNow: 5000
});
frame(unknownHarness, 'registered', {
  currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 },
  gameState: { hI: 'UNKNOWN-SEMANTICS', board: [], iHPI: ['playerA', 'playerB'], pGS: { playerA: 'inGame', playerB: 'inGame' }, players: { playerA: { id: 'playerA', name: 'playerA', stack: 420 }, playerB: { id: 'playerB', name: 'playerB', stack: 420 } } }
}, 'unknown-semantics');
panel(unknownHarness, 'UNKNOWN', '29 temporary semantic uncertainty');

var routeHarness = harnessApi.createHarness({
  gameId: 'board-companion-route', layout: 'live-full', liveCardDom: true,
  boardDom: false, persistentBoardSlot: true, viewport: { width: 1280, height: 665 }, initialNow: 7000
});
frame(routeHarness, 'registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: activeState('ROUTE-HAND') }, 'route-active');
panel(routeHarness, 'ZERO', 'route before fail-close');
routeHarness.contextWindow.location.pathname = '/';
routeHarness.contextWindow.location.href = 'https://pokernow.com/';
routeHarness.dispatchWindowEvent('popstate');
routeHarness.runFor(80, 16);
assert.strictEqual(routeHarness.count('#pnhud-pot-odds-root'), 0, '28 route fail-closed cleanup hides and removes the root');
assert.strictEqual(routeHarness.evaluate('typeof PokerNowHUDBoardCompanion'), 'undefined', 'route cleanup removes companion diagnostic API');

console.log('Board-companion persistent pot-odds production regressions passed:', JSON.stringify({ hostStable: harness.document.getElementById('pnhud-hero-pot-odds') === stableHost, wrapperLeft: wrapperRawLeft, canonicalLeft: liveInfo.canonicalBoardRect.left, unknown: harnessApi.placement(unknownHarness).contentState }));
