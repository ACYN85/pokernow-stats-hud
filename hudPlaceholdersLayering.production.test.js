'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');
var overlayStats = require('./overlayStats.js');
var seatOverlay = require('./seatOverlay.js');
var leaderboardStats = require('./leaderboardStats.js');

function renderSeatThroughContent(entry, content) {
  var start = content.indexOf('  function seatOverlayContent(entry)');
  var end = content.indexOf('  function overlayStatItemHtml(', start);
  assert.ok(start >= 0 && end > start, 'the production seat renderer can be isolated');
  var context = {
    PokerOverlayStats: overlayStats,
    PokerSeatOverlay: seatOverlay,
    debugSeatIdentity: false,
    currentStatsScope: 'session',
    preflopDebug: function () {},
    preflopCounterFields: function (value) { return value; },
    escapeHtml: function (value) { return String(value); },
    registerTooltipPlayer: function () { return 'player:test'; },
    statTooltipTargetHtml: function (definition, value) { return '<span data-stat="' + definition.id + '">' + value + '</span>'; },
    entry: entry,
    rendered: null
  };
  vm.runInNewContext(content.slice(start, end) + '\nrendered = seatOverlayContent(entry);', context);
  return context.rendered;
}

function renderLeaderboardCellsThroughContent(stat, definitions, content) {
  var start = content.indexOf('      var cells = leaderboardDefinitions.map');
  var end = content.indexOf("      return '<tr><td>'", start);
  assert.ok(start >= 0 && end > start, 'the production leaderboard cell renderer can be isolated');
  var context = {
    PokerLeaderboardStats: leaderboardStats,
    leaderboardDefinitions: definitions,
    stat: stat,
    playerKey: 'player:test',
    currentStatsScope: 'session',
    statTooltipTargetHtml: function (definition, value) { return '<span data-stat="' + definition.id + '">' + value + '</span>'; },
    cells: null,
    renderedCells: null
  };
  vm.runInNewContext(content.slice(start, end) + '\nrenderedCells = cells;', context);
  return context.renderedCells;
}

function fakeElement(tag, id, className, parent, rect) {
  return {
    tagName: tag,
    nodeName: tag,
    id: id || '',
    className: className || '',
    parentElement: parent || null,
    getBoundingClientRect: function () { return Object.assign({}, rect); }
  };
}

function createSvgDomHarness() {
  function node(tagName) {
    var item = {
      tagName: tagName,
      id: '',
      children: [],
      firstChild: null,
      parentElement: null,
      isConnected: false,
      attributes: {},
      dataset: {},
      classList: { values: [], add: function (value) { this.values.push(value); } },
      style: {
        clipPath: '',
        webkitClipPath: '',
        removeProperty: function (name) {
          if (name === 'clip-path') this.clipPath = '';
          if (name === '-webkit-clip-path') this.webkitClipPath = '';
        }
      },
      setAttribute: function (name, value) { this.attributes[name] = String(value); },
      appendChild: function (child) {
        child.parentElement = this;
        child.isConnected = this.isConnected;
        this.children.push(child);
        this.firstChild = this.children[0] || null;
        return child;
      },
      removeChild: function (child) {
        this.children = this.children.filter(function (candidate) { return candidate !== child; });
        child.parentElement = null;
        child.isConnected = false;
        this.firstChild = this.children[0] || null;
        return child;
      },
      querySelector: function (selector) {
        var match = null;
        function visit(candidate) {
          if (match) return;
          if (selector.charAt(0) === '#' ? candidate.id === selector.slice(1) : String(candidate.tagName).toLowerCase() === selector.toLowerCase()) match = candidate;
          candidate.children.forEach(visit);
        }
        this.children.forEach(visit);
        return match;
      }
    };
    return item;
  }
  var root = node('div');
  root.id = 'pnhud-overlay-root';
  root.isConnected = true;
  var document = {
    createElementNS: function (namespace, tagName) { return node(tagName); },
    getElementById: function (id) { return root.id === id ? root : root.querySelector('#' + id); }
  };
  return { document: document, root: root, createElement: node };
}

function productionClipFunctions(content, harness) {
  var start = content.indexOf('  function ensureNativePanelClipDefinitions()');
  var end = content.indexOf('  function applyNativePanelOcclusion(', start);
  assert.ok(start >= 0 && end > start, 'the production SVG clipping functions can be isolated');
  var context = {
    document: harness.document,
    seatOverlayLayer: harness.root,
    nativePanelClipSvg: null
  };
  vm.runInNewContext(content.slice(start, end), context);
  return context;
}

var allIds = overlayStats.DEFAULT_DISPLAYED_STAT_IDS.slice();
var visibleLeaderboardIds = allIds.filter(function (id) { return id !== 'hands'; });
var emptyStats = { handsPlayed: 0, vpip: 0, pfr: 0, af: 0 };
var emptySeatLabels = seatOverlay.compactStatLabels(emptyStats, allIds);
var emptyLeaderboardDefinitions = leaderboardStats.definitions(visibleLeaderboardIds);
var emptyLeaderboardValues = emptyLeaderboardDefinitions.map(function (definition) {
  return leaderboardStats.formatValue(definition, emptyStats);
});

assert.strictEqual(overlayStats.UNAVAILABLE_PLACEHOLDER, '---');
assert.deepStrictEqual(emptySeatLabels, ['H 0', 'VPIP ---', 'PFR ---', 'AF ---', '3B ---', 'F3B ---', 'CB ---', 'FCB ---', 'WTSD ---', 'W$SD ---']);
assert.deepStrictEqual(emptyLeaderboardValues, ['---', '---', '---', '---', '---', '---', '---', '---', '---']);
emptySeatLabels.slice(1).concat(emptyLeaderboardValues).forEach(function (value) {
  assert.ok(value.includes('---'), 'unavailable output uses exactly three ASCII hyphens');
  assert.ok(!/[\u2010-\u2015\u2212]/.test(value), 'unavailable output contains no Unicode dash');
});

var meaningfulZero = {
  handsPlayed: 10, vpip: 0, pfr: 0, af: 0,
  threeBetMade: 0, threeBetOpportunities: 4,
  foldToThreeBet: 0, foldToThreeBetOpportunities: 0,
  flopCBetMade: 0, flopCBetOpportunities: 4,
  foldToFlopCBet: 0, foldToFlopCBetOpportunities: 0,
  wentToShowdown: 0, sawFlopForWTSD: 5,
  wonMoneyAtShowdown: 0, showdownsForWSD: 3
};
assert.deepStrictEqual(seatOverlay.compactStatLabels(meaningfulZero, allIds), ['H 10', 'VPIP 0%', 'PFR 0%', 'AF 0.0', '3B 0%', 'F3B ---', 'CB 0%', 'FCB ---', 'WTSD 0%', 'W$SD 0%']);
assert.deepStrictEqual(emptyLeaderboardDefinitions.map(function (definition) {
  return leaderboardStats.formatValue(definition, meaningfulZero);
}), ['0.0%', '0.0%', '0.0', '0%', '---', '0%', '---', '0%', '0%']);

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var renderedSeat = renderSeatThroughContent({ playerId: 'p1', name: 'Player', stats: emptyStats, displayedStatIds: allIds, opportunityStatsLayout: 'combined' }, content);
assert.ok(renderedSeat.includes('H 0') && renderedSeat.includes('VPIP ---') && renderedSeat.includes('PFR ---') && renderedSeat.includes('AF ---'));
assert.ok(renderedSeat.includes('3B ---') && renderedSeat.includes('F3B ---') && renderedSeat.includes('CB ---') && renderedSeat.includes('FCB ---'), 'the actual content.js seat renderer emits the ASCII placeholder');
assert.ok(renderedSeat.includes('WTSD ---') && renderedSeat.includes('W$SD ---'), 'the actual content.js seat renderer emits showdown placeholders');
var renderedCells = renderLeaderboardCellsThroughContent(emptyStats, emptyLeaderboardDefinitions, content);
emptyLeaderboardDefinitions.forEach(function (definition) {
  assert.ok(renderedCells.includes('data-stat="' + definition.id + '">---</span>'), 'the actual content.js leaderboard path emits --- for ' + definition.id);
});

var html = fakeElement('HTML', '', '', null, { left: 0, top: 0, width: 1280, height: 720 });
var body = fakeElement('BODY', '', '', html, { left: 0, top: 0, width: 1280, height: 720 });
var pokerNowApp = fakeElement('DIV', 'game-app', 'game-shell', body, { left: 0, top: 0, width: 1280, height: 720 });
var nativePanel = fakeElement('ASIDE', '', 'chat-drawer', pokerNowApp, { left: 850, top: 0, width: 430, height: 720 });
var extensionRoot = fakeElement('DIV', 'pnhud-overlay-root', '', body, { left: 0, top: 0, width: 1280, height: 720 });
var overlappingSeat = fakeElement('DIV', 'pnhud-seat-overlay-p1', 'pnhud-seat-overlay', extensionRoot, { left: 820, top: 220, width: 180, height: 42 });
var clearSeat = fakeElement('DIV', 'pnhud-seat-overlay-p2', 'pnhud-seat-overlay', extensionRoot, { left: 100, top: 220, width: 180, height: 42 });
var ordinaryTableLayers = [
  { name: 'avatar', element: fakeElement('DIV', '', 'player-avatar', pokerNowApp, overlappingSeat.getBoundingClientRect()), zIndex: 2 },
  { name: 'player name/stack', element: fakeElement('DIV', '', 'player-name-stack', pokerNowApp, overlappingSeat.getBoundingClientRect()), zIndex: 4 },
  { name: 'hole cards', element: fakeElement('DIV', '', 'hole-cards', pokerNowApp, overlappingSeat.getBoundingClientRect()), zIndex: 12 },
  { name: 'chips/bet marker', element: fakeElement('DIV', '', 'bet-chips', pokerNowApp, overlappingSeat.getBoundingClientRect()), zIndex: 20 },
  { name: 'emoji/reaction', element: fakeElement('DIV', '', 'player-reaction', pokerNowApp, overlappingSeat.getBoundingClientRect()), zIndex: 30 }
];
var styles = new Map([
  [html, { position: 'static', zIndex: 'auto', opacity: '1', transform: 'none', filter: 'none', isolation: 'auto', contain: 'none' }],
  [body, { position: 'static', zIndex: 'auto', opacity: '1', transform: 'none', filter: 'none', isolation: 'auto', contain: 'none' }],
  [pokerNowApp, { position: 'relative', zIndex: '0', opacity: '1', transform: 'translateZ(0)', filter: 'none', isolation: 'auto', contain: 'layout' }],
  [nativePanel, { position: 'fixed', zIndex: '9999', opacity: '1', transform: 'none', filter: 'none', isolation: 'auto', contain: 'none' }],
  [extensionRoot, { position: 'fixed', zIndex: '2147483643', opacity: '1', transform: 'none', filter: 'none', isolation: 'auto', contain: 'layout style' }]
]);
ordinaryTableLayers.forEach(function (layer) {
  styles.set(layer.element, { position: 'absolute', zIndex: String(layer.zIndex), opacity: '1', transform: 'translateZ(0)', filter: 'none', isolation: 'auto', contain: 'none' });
});
var getStyle = function (element) { return styles.get(element) || {}; };
var panelChain = seatOverlay.stackingContextChain(nativePanel, getStyle, html);
var extensionChain = seatOverlay.stackingContextChain(extensionRoot, getStyle, html);
assert.ok(panelChain.some(function (entry) { return entry.id === 'game-app' && entry.reasons.includes('transform'); }), 'the modeled native drawer is trapped inside PokerNow app stacking context');
assert.ok(extensionChain.some(function (entry) { return entry.id === 'pnhud-overlay-root' && entry.reasons.includes('position:fixed'); }), 'the body-level extension root is a separate sibling stacking context');
var overlayLayerMatch = css.match(/#pnhud-overlay-root\s*\{[^}]*z-index:\s*(\d+)/);
assert.ok(overlayLayerMatch);
var overlayLayer = Number(overlayLayerMatch[1]);
assert.strictEqual(overlayLayer, 2147483643, 'the body-level seat root outranks PokerNow table and Chat stacking contexts');
ordinaryTableLayers.forEach(function (layer) {
  assert.ok(overlayLayer > layer.zIndex, 'seat HUD layer outranks modeled PokerNow ' + layer.name + ' layer');
  assert.ok(seatOverlay.stackingContextChain(layer.element, getStyle, html).length >= 2, layer.name + ' remains inside the modeled PokerNow application stacking chain');
});

var panelScenarios = [
  { name: 'Chat', rect: nativePanel.getBoundingClientRect() },
  { name: 'Full Log/Ledger', rect: { left: 900, top: 80, width: 380, height: 600 } },
  { name: 'native drawer/modal', rect: { left: 950, top: 120, width: 330, height: 520 } }
];
panelScenarios.forEach(function (scenario) {
  var originalPosition = overlappingSeat.getBoundingClientRect();
  var visibleRegion = seatOverlay.nativePanelVisibleFragments(originalPosition, [scenario.rect]);
  assert.strictEqual(visibleRegion.occluded, true, scenario.name + ' clips an overlapping seat HUD');
  assert.strictEqual(visibleRegion.fullyOccluded, false, scenario.name + ' does not hide the whole partially overlapping HUD');
  assert.ok(visibleRegion.fragments.length > 0, scenario.name + ' preserves uncovered visible pixels');
  assert.deepStrictEqual(overlappingSeat.getBoundingClientRect(), originalPosition, scenario.name + ' clipping does not mutate the saved/placed coordinates');
  assert.strictEqual(seatOverlay.nativePanelVisibleFragments(clearSeat.getBoundingClientRect(), [scenario.rect]).occluded, false, scenario.name + ' leaves a non-overlapping seat HUD visible and interactive');
});
var fullyCovered = seatOverlay.nativePanelVisibleFragments(overlappingSeat.getBoundingClientRect(), [{ left: 800, top: 180, width: 400, height: 200 }]);
assert.strictEqual(fullyCovered.fullyOccluded, true, 'full intersection has no visible pixels while the panel is present');
assert.deepStrictEqual(overlappingSeat.getBoundingClientRect(), { left: 820, top: 220, width: 180, height: 42 }, 'full intersection preserves the intended HUD position');
var restoredAfterClose = seatOverlay.nativePanelVisibleFragments(overlappingSeat.getBoundingClientRect(), []);
assert.strictEqual(restoredAfterClose.occluded, false, 'the full HUD restores after the native panel closes');
assert.deepStrictEqual(restoredAfterClose.fragments.map(function (fragment) { return [fragment.left, fragment.top, fragment.width, fragment.height]; }), [[0, 0, 180, 42]]);
assert.strictEqual(seatOverlay.nativePanelVisibleFragments(overlappingSeat.getBoundingClientRect(), [{ left: 0, top: 0, width: 200, height: 100 }]).occluded, false, 'the full HUD restores after the native panel moves away');
var multiplePanels = seatOverlay.nativePanelVisibleFragments(overlappingSeat.getBoundingClientRect(), [
  { left: 820, top: 220, width: 40, height: 42 },
  { left: 940, top: 220, width: 60, height: 42 }
]);
assert.strictEqual(multiplePanels.occluded, true);
assert.strictEqual(multiplePanels.fullyOccluded, false);
assert.ok(multiplePanels.fragments.some(function (fragment) { return fragment.left >= 40 && fragment.right <= 120; }), 'multiple panel rectangles preserve the middle uncovered fragment');
multiplePanels.fragments.forEach(function (fragment) {
  multiplePanels.occlusions.forEach(function (occlusion) {
    assert.strictEqual(seatOverlay.rectsOverlap(fragment, occlusion), false, 'visible fragments never leak pixels into the union of panel rectangles');
  });
});

assert.ok(css.includes('#pnhud-overlay-root { position: fixed; z-index: 2147483643;'), 'the seat root is above PokerNow Chat while remaining below extension modal layers');
assert.ok(css.includes('#pnhud-overlay-root.pnhud-seat-huds-blocked { visibility: hidden;'), 'blocking UI suppresses presentation at the root without destroying seat records');
assert.ok(!css.includes('[data-pnhud-native-panel-occluded="true"]'), 'the all-or-nothing hidden-card rule is removed');
assert.ok(!content.includes("element.dataset.pnhudNativePanelOccluded = 'true'"), 'production never marks a whole card hidden for panel overlap');
assert.ok(!content.includes("document.createElementNS('http://www.w3.org/2000/svg', 'clipPath')"), 'obsolete Chat/panel pixel clipping is not created');
assert.ok(content.includes("seatOverlayLayer.classList.toggle('pnhud-seat-huds-blocked', seatHudBlockingPanelState.blocked)"), 'one reversible presentation class owns blocking-panel suppression');
assert.ok(content.includes("if (isPokerNowChatSurface(element)) return { element: element, rect: rect, kind: 'chat', blocking: false }"), 'Chat is explicitly classified as non-blocking');
assert.ok(content.includes('[class*="chat" i]') && content.includes('[class*="ledger" i]'), 'production discovers chat and ledger panel surfaces');
assert.ok(content.includes('[role="dialog"], [aria-modal="true"]'), 'production requires semantic dialog evidence for PokerNow modals');
assert.ok(content.includes('isExtensionOwnedUiElement(element)'), 'extension Settings and leaderboard roots are excluded from native-panel suppression');
assert.ok(css.includes('#pnhud-settings-panel') && css.includes('z-index: 2147483647'), 'Settings layering remains unchanged');
assert.ok(css.includes('#pokernow-stats-hud-root') && css.includes('z-index: 2147483645'), 'leaderboard remains above seat HUDs but below its launcher and active dialogs');
assert.ok(css.includes('.pnhud-toggle') && css.includes('z-index: 2147483646'), 'the leaderboard launcher remains clickable above the leaderboard');
assert.ok(css.includes('#pnhud-stat-tooltip') && css.includes('z-index: 2147483647'), 'active tooltip layering remains unchanged above its source HUD');
assert.ok(css.includes('#pnhud-overlay-root .pnhud-seat-overlay') && css.includes('pointer-events: auto'), 'seat dragging and interaction remain enabled when panels are closed');
assert.ok(css.includes('.pnhud-seat-stat-row { display: inline-flex; flex-wrap: wrap;'), 'the combined row still wraps safely');
assert.ok(!/text-decoration:\s*underline\s+dotted|border-bottom:\s*[^;]*dotted/.test(css), 'no dotted underline is introduced');

console.log('Production ASCII placeholders and native-panel layering correction passed.');
