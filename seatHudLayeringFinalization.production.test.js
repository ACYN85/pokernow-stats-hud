'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var seatLayer = Number(css.match(/#pnhud-overlay-root\s*\{[^}]*z-index:\s*(\d+)/)[1]);
var potOddsLayer = Number(css.match(/#pnhud-pot-odds-root\s*\{[^}]*z-index:\s*(\d+)/)[1]);
var leaderboardLayer = Number(css.match(/#pokernow-stats-hud-root\s*\{[^}]*z-index:\s*(\d+)/)[1]);
var settingsLayer = Number(css.match(/#pnhud-settings-panel\s*\{[^}]*z-index:\s*(\d+)/)[1]);
var expandedPanelLayer = Number(css.match(/\.pokernow-hud-expanded-panel-layer\s*\{[^}]*z-index:\s*(\d+)/)[1]);
assert.ok(seatLayer > 9999, 'body-level seat root outranks modeled PokerNow Chat/table layers');
assert.ok(seatLayer < potOddsLayer && seatLayer < leaderboardLayer && seatLayer < settingsLayer, 'seat root remains below extension-owned companion/dashboard/modal layers');
assert.ok(expandedPanelLayer > seatLayer && expandedPanelLayer < settingsLayer, 'expanded PokerNow Session Log/Ledger/Replayer layer is deliberately above Seat HUDs and below Settings');
assert.ok(css.includes('#pnhud-overlay-root.pnhud-seat-huds-blocked { visibility: hidden; pointer-events: none; }'));
assert.ok(css.includes('#pnhud-overlay-root .pnhud-overlay-grip') && css.includes('pointer-events: auto'), 'a HUD and its drag grip remain interactive over ordinary Chat');

function element(options) {
  options = options || {};
  return {
    isConnected: true,
    id: options.id || '', className: options.className || '', tagName: options.tagName || 'DIV',
    innerText: options.text || '', textContent: options.text || '', dataset: options.dataset || {},
    classList: options.classList || [], parentElement: options.parentElement || null,
    getAttribute: function (name) { return options.attributes && options.attributes[name] || null; },
    getBoundingClientRect: function () { return { left: 700, top: 40, width: 420, height: 500 }; }
  };
}

var classifyStart = content.indexOf('  var SEMANTIC_BLOCKING_PANEL_SELECTOR');
var classifyEnd = content.indexOf('  function visibleSeatHudSurfaces()', classifyStart);
var documentRoot = element({ tagName: 'HTML' });
var classifyContext = {
  document: { documentElement: documentRoot },
  isVisible: function () { return true; },
  getComputedStyle: function () { return { opacity: '1' }; },
  Array: Array, Object: Object, String: String, Number: Number
};
vm.runInNewContext(content.slice(classifyStart, classifyEnd), classifyContext);
assert.deepStrictEqual([classifyContext.blockingPanelCandidate(element({ className: 'pokernow-chat-drawer', text: 'Chat' })).kind, classifyContext.blockingPanelCandidate(element({ className: 'pokernow-chat-drawer', text: 'Chat' })).blocking], ['chat', false], 'Chat is positively classified as non-blocking');
assert.deepStrictEqual([classifyContext.blockingPanelCandidate(element({ className: 'ledger-panel', text: 'Full Log' })).kind, classifyContext.blockingPanelCandidate(element({ className: 'ledger-panel', text: 'Full Log' })).blocking, classifyContext.blockingPanelCandidate(element({ className: 'ledger-panel', text: 'Full Log' })).expanded], ['ledger', false, true], 'Ledger / Full Log uses expanded-panel layering rather than global suppression');
assert.strictEqual(classifyContext.blockingPanelCandidate(element({ tagName: 'DIALOG', text: 'Game Settings', attributes: { open: '' } })).kind, 'pokernow-game-settings', 'PokerNow Game Settings requires semantic dialog evidence');
assert.strictEqual(classifyContext.blockingPanelCandidate(element({ className: 'random-drawer', text: 'Settings-ish content' })), null, 'broad ordinary drawers cannot masquerade as a PokerNow modal');
assert.strictEqual(classifyContext.blockingPanelCandidate(element({ id: 'pnhud-player-dashboard', tagName: 'DIALOG', text: 'Game Settings' })), null, 'extension-owned UI is excluded from PokerNow modal discovery');

var applyStart = content.indexOf('  function applyNativePanelOcclusion(');
var applyEnd = content.indexOf('  function scheduleNativePanelOcclusion(', applyStart);
function suppressionHarness(surfaces) {
  var classState = {};
  var root = {
    classList: { toggle: function (name, value) { classState[name] = Boolean(value); } },
    setAttribute: function (name, value) { this[name] = value; }
  };
  var card = { isConnected: true, style: { transform: 'translate3d(321px,222px,0)' }, dataset: {} };
  var sourceMode = 'career';
  var context = {
    nativePanelOcclusionFrame: 1, extensionCleanedUp: false,
    seatOverlayController: { records: new Map([['stable-1', { element: card, lastPlacement: { left: 321, top: 222 }, entry: { statSource: sourceMode } }]]) },
    seatOverlayLayer: root, visibleSeatHudSurfaces: function () { return surfaces; },
    seatHudLogPanelState: { open: false, panel: null, mode: null, panelType: null },
    trackedPlayersState: { open: false },
    hudUiPreferences: { settingsOpen: false, seatHudStatSource: sourceMode },
    seatHudBlockingPanelState: {}, seatHudPositionDiagnostics: new Map([['stable-1', { requestedHudRect: { left: 321, top: 222 }, renderedHudRect: { left: 321, top: 222 } }]]),
    nativePanelLayeringDiagnostics: [], lastNativePanelLayeringSignature: '',
    seatOverlaysVisible: function () { return true; }, removeSeatOverlayClip: function () {},
    applySeatHudExpandedPanelOcclusion: function () {}, PokerSeatOverlay: require('./seatOverlay.js'), getComputedStyle: function () { return {}; }, document: { documentElement: {} },
    applyExpandedPokerNowPanelLayerMarker: function (panel) { return Boolean(panel); }, clearExpandedPokerNowPanelLayerMarker: function () {},
    cloneJson: function (value) { return JSON.parse(JSON.stringify(value)); }, elementLayerDescriptor: function (value) { return { kind: value && value.kind || null }; },
    console: { log: function () {} }, JSON: JSON, Date: Date, String: String, Object: Object, Array: Array, Map: Map, Math: Math
  };
  vm.runInNewContext(content.slice(applyStart, applyEnd), context);
  return { context: context, root: root, card: card, classState: classState };
}

var chat = { kind: 'chat', blocking: false, element: element({ className: 'chat' }) };
var harness = suppressionHarness([chat]);
harness.context.applyNativePanelOcclusion('Chat opened');
assert.strictEqual(harness.classState['pnhud-seat-huds-blocked'], false, 'Chat open never suppresses HUDs');
assert.strictEqual(harness.card.style.transform, 'translate3d(321px,222px,0)', 'Chat open does not move a HUD');
harness.context.visibleSeatHudSurfaces = function () { return []; };
harness.context.applyNativePanelOcclusion('Chat closed');
assert.strictEqual(harness.card.style.transform, 'translate3d(321px,222px,0)', 'Chat close restores without drift because no position changed');

harness.context.hudUiPreferences.settingsOpen = true;
harness.context.applyNativePanelOcclusion('extension Settings opened');
assert.strictEqual(harness.classState['pnhud-seat-huds-blocked'], true, 'extension Settings suppresses HUDs');
assert.strictEqual(harness.context.seatHudBlockingPanelState.extensionSettingsBlocker, true, 'diagnostics name the extension Settings blocker explicitly');
harness.context.hudUiPreferences.settingsOpen = false;
harness.context.applyNativePanelOcclusion('extension Settings closed');
assert.strictEqual(harness.classState['pnhud-seat-huds-blocked'], false, 'closing Settings restores HUD presentation');
assert.strictEqual(harness.card.style.transform, 'translate3d(321px,222px,0)', 'Settings suppression preserves exact position');
harness.context.trackedPlayersState.open = true;
harness.context.hudUiPreferences.settingsOpen = true;
harness.context.applyNativePanelOcclusion('Tracked Players opened');
assert.strictEqual(harness.classState['pnhud-seat-huds-blocked'], true, 'Settings Players tab preserves Settings Seat HUD suppression');
harness.context.trackedPlayersState.open = false;
harness.context.hudUiPreferences.settingsOpen = false;
harness.context.applyNativePanelOcclusion('Tracked Players closed');
assert.strictEqual(harness.classState['pnhud-seat-huds-blocked'], false, 'closing Tracked Players restores Seat HUD presentation');

var ledgerPanel = element({ className: 'ledger', text: 'Full Log' });
var ledger = { kind: 'ledger', blocking: false, expanded: true, element: ledgerPanel };
harness.context.visibleSeatHudSurfaces = function () { return [ledger]; };
harness.context.seatHudLogPanelState = { open: true, panel: ledgerPanel, mode: 'Ledger', panelType: 'ledger' };
harness.context.applyNativePanelOcclusion('ledger open');
assert.strictEqual(harness.classState['pnhud-seat-huds-blocked'], false, 'Ledger / Full Log never globally suppresses HUDs');
assert.strictEqual(harness.context.seatHudBlockingPanelState.expandedPanelAboveSeatHud, true, 'expanded Ledger receives the above-seat-HUD layer');
harness.context.visibleSeatHudSurfaces = function () { return []; };
harness.context.seatHudLogPanelState = { open: false, panel: null, mode: null, panelType: null };
harness.context.applyNativePanelOcclusion('ledger close');
assert.strictEqual(harness.classState['pnhud-seat-huds-blocked'], false);

var gameSettings = { kind: 'pokernow-game-settings', blocking: true, element: element({ tagName: 'DIALOG', text: 'Game Settings' }) };
harness.context.visibleSeatHudSurfaces = function () { return [gameSettings]; };
harness.context.applyNativePanelOcclusion('game settings open');
assert.strictEqual(harness.classState['pnhud-seat-huds-blocked'], true, 'PokerNow Game Settings suppresses HUDs');
harness.context.visibleSeatHudSurfaces = function () { return []; };
harness.context.applyNativePanelOcclusion('game settings close after seat remount');
assert.strictEqual(harness.classState['pnhud-seat-huds-blocked'], false, 'closing Game Settings restores against the current render state');
assert.strictEqual(harness.context.hudUiPreferences.seatHudStatSource, 'career', 'suppression never changes the global stat source');
assert.deepStrictEqual(harness.context.seatOverlayController.records.get('stable-1').lastPlacement, { left: 321, top: 222 }, 'suppression never mutates placement state');

assert.ok(content.includes("scheduleNativePanelOcclusion(open ? 'extension Settings opened' : 'extension Settings closed')"), 'extension Settings uses authoritative open/close state');
assert.ok(content.includes('refreshSeatHudLogPanelState(reason);') && content.includes('applyExpandedPokerNowPanelLayerMarker(surface.element, surface.kind)'), 'each expanded log/menu surface receives a dedicated layer marker');
assert.ok(!content.includes("reasons.push('ledger-full-log')"), 'Log/Ledger/Replayer are absent from global suppression reasons');
assert.ok(content.includes("scheduleSeatDiscovery('PokerNow seat/table DOM mutation')"), 'seat remounts are reconciled even while presentation is suppressed');
assert.ok(content.includes('resolvePlayerVisualGeometry(element, mapping.name, seat.displayedStack)'), 'restoration and remounts position against the current connected player visual anchor');
assert.ok(!content.includes("applySeatOverlayClip("), 'Chat and blocking panels no longer create per-card clipping geometry');

console.log('Seat HUD Chat-above, expanded-panel layering, true-blocker suppression, remount, position, and source-retention tests passed.');
