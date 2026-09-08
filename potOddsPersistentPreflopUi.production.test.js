'use strict';

var assert = require('assert');
var manifest = require('./manifest.json');
var settings = require('./settingsUi.js');
var harnessApi = require('./testSupport/potOddsProductionVisibilityHarness.js');

function dispatchRegistered(harness, values) {
  values = values || {};
  var contribution = Number(values.amountToCall || 0);
  harnessApi.dispatchFrame(harness, harnessApi.socket('registered', {
    currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 },
    gameState: {
      hI: values.handId || 'PERSISTENT-POT-ODDS', gT: ['holdem', Number(values.streetIndex || 0)], board: values.board || [], pot: Number(values.pot || 120),
      tB: { playerA: 'check', playerB: contribution > 0 ? contribution : 'check' }, cPI: 'playerA', pITT: 'playerA', iHPI: ['playerA', 'playerB'],
      pGS: { playerA: 'inGame', playerB: 'inGame' }, players: { playerA: { id: 'playerA', name: 'playerA', stack: 420 }, playerB: { id: 'playerB', name: 'playerB', stack: 420 } }
    }
  }), 'persistent-pot-odds-' + String(values.handId || 'hand'), harness.now());
}

function decisionFrame(harness, amountToCall, values) {
  values = values || {};
  harnessApi.dispatchFrame(harness, harnessApi.socket('gC', {
    gT: values.streetIndex === undefined ? undefined : ['holdem', Number(values.streetIndex)], board: values.board,
    pot: Number(values.pot || 120), tB: { playerA: 'check', playerB: Number(amountToCall) > 0 ? Number(amountToCall) : 'check' },
    cPI: 'playerA', pITT: 'playerA', iHPI: ['playerA', 'playerB'], pGS: { playerA: 'inGame', playerB: 'inGame' }
  }), 'decision-' + amountToCall + '-' + harness.now(), harness.now());
  harness.runFor(320, 16);
}

function assertPanel(harness, state, callPattern, needPattern, label) {
  var actual = harnessApi.actualDomVisibility(harness);
  var placement = harnessApi.placement(harness);
  assert.strictEqual(actual.visible, true, label + ': visible');
  assert.strictEqual(placement.contentState, state, label + ': state');
  assert.strictEqual(placement.chosenAnchorType, 'canonical-board-slot');
  assert.strictEqual(placement.canonicalBoardRect.left, 520);
  assert.strictEqual(actual.pillRect.right, 510);
  assert.strictEqual(placement.horizontalGap, 10);
  assert.strictEqual(placement.selectedSide, 'left');
  assert.match(actual.host.innerHTML, callPattern);
  assert.match(actual.host.innerHTML, needPattern);
  assert.strictEqual(harness.count('#pnhud-hero-pot-odds'), 1);
  assert.strictEqual(harness.count('.pnhud-pot-odds'), 1);
  return { actual: actual, placement: placement };
}

var isolated = manifest.content_scripts.find(function (entry) { return entry.world !== 'MAIN' && entry.js.includes('content.js'); }).js;
var harness = harnessApi.createHarness({ gameId: 'pot-odds-persistent-preflop', layout: 'live-full', liveCardDom: true, boardDom: false, persistentBoardSlot: true, viewport: { width: 1280, height: 665 }, initialNow: 1000 });
assert.deepStrictEqual(harness.evaluationErrors, []);
assert.deepStrictEqual(harness.isolatedScripts, isolated);

dispatchRegistered(harness, { handId: 'PREFLOP-PERSISTENT', amountToCall: 80, pot: 120 });
harness.runFor(600, 16);
var call = assertPanel(harness, 'CALL', /Call<\/span><strong>80/, /Need<\/span><strong>40\.0%/, 'preflop facing raise');
assert.deepStrictEqual([harnessApi.decision(harness).status, harnessApi.decision(harness).street, harnessApi.decision(harness).amountToCall], ['supported', 'preflop', 80]);
assert.match(call.placement.canonicalBoardSource, /^explicit five-card slot envelope/);
assert.strictEqual(call.placement.heroCardRect, null, 'preflop never anchors to hero cards');
assert.deepStrictEqual(call.placement.canonicalBoardRect, { left: 520, top: 260, width: 306, height: 80, right: 826, bottom: 340 });
var stableHost = harness.document.getElementById('pnhud-hero-pot-odds');
var stableRect = call.actual.pillRect;

decisionFrame(harness, 0, { streetIndex: 0, board: [], pot: 120 });
var free = assertPanel(harness, 'ZERO', /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, 'preflop free check');
assert.deepStrictEqual(free.actual.pillRect, stableRect);
assert.strictEqual(harness.document.getElementById('pnhud-hero-pot-odds'), stableHost);

decisionFrame(harness, 60, { streetIndex: 0, board: [], pot: 180 });
assertPanel(harness, 'CALL', /Call<\/span><strong>60/, /Need<\/span><strong>25\.0%/, 'free check to facing bet');

var boardRects = harnessApi.boardRectsForLayout('live-full');
harness.fixture.mountCommunityBoard(boardRects);
decisionFrame(harness, 0, { streetIndex: 1, board: ['Ah', 'Kd', '2c'], pot: 180 });
var flop = assertPanel(harness, 'ZERO', /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, 'flop free check');
assert.deepStrictEqual(flop.actual.pillRect, stableRect, 'preflop and flop use one coordinate system');

var turnRects = boardRects.concat([harnessApi.rect(706, 260, 58, 80)]);
harness.fixture.mountCommunityBoard(turnRects);
decisionFrame(harness, 0, { streetIndex: 2, board: ['Ah', 'Kd', '2c', '7s'], pot: 180 });
assert.deepStrictEqual(assertPanel(harness, 'ZERO', /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, 'turn').actual.pillRect, stableRect);

var riverRects = turnRects.concat([harnessApi.rect(768, 260, 58, 80)]);
harness.fixture.mountCommunityBoard(riverRects);
decisionFrame(harness, 0, { streetIndex: 3, board: ['Ah', 'Kd', '2c', '7s', 'Jh'], pot: 180 });
assert.deepStrictEqual(assertPanel(harness, 'ZERO', /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, 'river').actual.pillRect, stableRect);

harness.fixture.removeCommunityBoard();
harness.runFor(240, 16);
assert.deepStrictEqual(assertPanel(harness, 'ZERO', /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, 'between cards remount').actual.pillRect, stableRect);

var disabled = settings.merge(settings.DEFAULTS, { showPotOdds: false });
harness.emitStorageChange({ hudUiPreferences: { oldValue: settings.DEFAULTS, newValue: disabled } });
harness.runFor(240, 16);
assert.strictEqual(harnessApi.actualDomVisibility(harness).visible, false, 'setting OFF hides');
harness.emitStorageChange({ hudUiPreferences: { oldValue: disabled, newValue: settings.DEFAULTS } });
harness.runFor(240, 16);
assertPanel(harness, 'ZERO', /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, 'setting ON restores');

harnessApi.dispatchFrame(harness, harnessApi.socket('gC', { cPI: 'playerB', pITT: 'playerB', iHPI: ['playerB'], pGS: { playerA: 'folded', playerB: 'inGame' } }), 'hero-folded', harness.now());
harness.runFor(320, 16);
assertPanel(harness, 'ZERO', /Call<\/span><strong>0<\/strong>/, /Need<\/span><strong>—<\/strong>/, 'fold persists');
assert.strictEqual(harness.document.getElementById('pnhud-hero-pot-odds'), stableHost);

console.log('Persistent preflop/table-lifetime pot-odds production regressions passed:', JSON.stringify({ preflop: call.actual.pillRect, flop: flop.actual.pillRect, hostStable: harness.document.getElementById('pnhud-hero-pot-odds') === stableHost }));
