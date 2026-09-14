'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var applyStart = content.indexOf('  function applyNativePanelOcclusion(');
var applyEnd = content.indexOf('  function scheduleNativePanelOcclusion(', applyStart);
assert.ok(applyStart >= 0 && applyEnd > applyStart);

function panel() {
  return { isConnected: true, getBoundingClientRect: function () { return { left: 180, top: 60, width: 760, height: 560 }; } };
}

function harness() {
  var classState = {};
  var markerCalls = [];
  var card = { isConnected: true, style: { transform: 'translate3d(410px,260px,0)' }, dataset: {} };
  var statState = { handsPlayed: 159, vpipHands: 74 };
  var context = {
    nativePanelOcclusionFrame: 1, extensionCleanedUp: false,
    seatOverlayController: { records: new Map([['stable-player', { element: card, lastPlacement: { left: 410, top: 260 }, stats: statState }]]) },
    seatOverlayLayer: { classList: { toggle: function (name, value) { classState[name] = Boolean(value); } }, setAttribute: function (name, value) { this[name] = value; } },
    visibleSeatHudSurfaces: function () { return []; },
    seatHudLogPanelState: { open: false, panel: null, mode: null, panelType: null, revision: 0 },
    trackedPlayersState: { open: false },
    hudUiPreferences: { settingsOpen: false, seatHudStatSource: 'career' },
    seatHudBlockingPanelState: {},
    seatHudPositionDiagnostics: new Map([['stable-player', { manualOffsetX: 31, manualOffsetY: -17, requestedHudRect: { left: 410, top: 260 }, renderedHudRect: { left: 410, top: 260 } }]]),
    nativePanelLayeringDiagnostics: [], lastNativePanelLayeringSignature: '',
    seatOverlaysVisible: function () { return true; }, removeSeatOverlayClip: function () {},
    applySeatHudExpandedPanelOcclusion: function () {}, PokerSeatOverlay: require('./seatOverlay.js'), getComputedStyle: function () { return {}; }, document: { documentElement: {} },
    applyExpandedPokerNowPanelLayerMarker: function (element, type) { markerCalls.push({ element: element, type: type }); return Boolean(element); },
    clearExpandedPokerNowPanelLayerMarker: function () { markerCalls.push({ element: null, type: null }); },
    cloneJson: function (value) { return JSON.parse(JSON.stringify(value)); }, elementLayerDescriptor: function () { return null; },
    console: { log: function () {} }, JSON: JSON, Date: Date, String: String, Object: Object, Array: Array, Map: Map, Math: Math
  };
  vm.runInNewContext(content.slice(applyStart, applyEnd), context);
  return { context: context, classState: classState, card: card, statState: statState, markerCalls: markerCalls };
}

var value = harness();
[
  { mode: 'Session Log', type: 'session_log' },
  { mode: 'Ledger', type: 'ledger' },
  { mode: 'Replayer', type: 'replayer' },
  { mode: 'Account/game menu', type: 'account_game_menu' }
].forEach(function (fixture) {
  for (var cycle = 0; cycle < 3; cycle += 1) {
    var expanded = panel();
    value.context.visibleSeatHudSurfaces = function () { return [{ element: expanded, kind: fixture.type, expanded: true, blocking: false }]; };
    value.context.seatHudLogPanelState = { open: true, panel: expanded, mode: fixture.mode, panelType: fixture.type, revision: cycle * 2 + 1 };
    value.context.applyNativePanelOcclusion(fixture.mode + ' opened');
    assert.strictEqual(value.classState['pnhud-seat-huds-blocked'], false, fixture.mode + ' does not globally suppress the seat root');
    assert.strictEqual(value.context.seatHudBlockingPanelState.expandedPokerNowPanelDetected, true);
    assert.strictEqual(value.context.seatHudBlockingPanelState.expandedPanelType, fixture.type);
    assert.strictEqual(value.context.seatHudBlockingPanelState.expandedPanelAboveSeatHud, true);
    assert.strictEqual(value.context.seatHudBlockingPanelState.reasons.length, 0);
    value.context.seatHudLogPanelState = { open: false, panel: null, mode: null, panelType: null, revision: cycle * 2 + 2 };
    value.context.visibleSeatHudSurfaces = function () { return []; };
    value.context.applyNativePanelOcclusion(fixture.mode + ' closed');
    assert.strictEqual(value.classState['pnhud-seat-huds-blocked'], false, fixture.mode + ' close requires no HUD restoration/remount');
    assert.strictEqual(value.card.style.transform, 'translate3d(410px,260px,0)', 'repeated layering cycles never move a card');
    assert.deepStrictEqual(value.context.seatOverlayController.records.get('stable-player').lastPlacement, { left: 410, top: 260 });
    assert.strictEqual(value.context.hudUiPreferences.seatHudStatSource, 'career', 'layering preserves the source');
    assert.strictEqual(value.context.seatOverlayController.records.get('stable-player').stats, value.statState, 'layering preserves stat state identity');
  }
});

value.context.visibleSeatHudSurfaces = function () { return [{ kind: 'chat', blocking: false, element: {} }]; };
value.context.applyNativePanelOcclusion('Chat open');
assert.strictEqual(value.classState['pnhud-seat-huds-blocked'], false, 'Chat remains non-blocking');

var seatLayer = Number(css.match(/#pnhud-overlay-root\s*\{[^}]*z-index:\s*(\d+)/)[1]);
var expandedLayer = Number(css.match(/\.pokernow-hud-expanded-panel-layer\s*\{[^}]*z-index:\s*(\d+)/)[1]);
assert.ok(expandedLayer > seatLayer, 'expanded PokerNow panel marker paints above Seat HUDs');
assert.ok(content.includes("labels = ['Session Log', 'Full Log', 'Ledger', 'Replayer', 'Replay', 'Log']"), 'expanded-panel detection is rooted in exact known controls');
assert.ok(content.includes('matchingControls >= 2 || activeControl || panelDescriptor'), 'ordinary launcher controls cannot become expanded panels without expanded-panel evidence');
assert.ok(!content.includes("reasons.push('ledger-full-log')"), 'Log/Ledger/Replayer no longer enter global Seat HUD suppression reasons');
assert.ok(content.includes("'style', 'hidden', 'aria-hidden', 'aria-expanded', 'aria-selected'"), 'open/close attribute transitions wake layer reconciliation without polling');

console.log('Seat HUD Session Log/Ledger/Replayer partial-occlusion layering, repeated-cycle drift, source/stat/offset, and Chat preservation passed.');
