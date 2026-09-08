'use strict';

var assert = require('assert');
var fs = require('fs');
var overlays = require('./seatOverlay.js');
var settings = require('./settingsUi.js');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');

function displayed(archetype, extra) {
  return Object.assign({ visible: true, archetype: archetype, status: 'visible_stable', reason: 'raw_profile_matches_display', rawArchetype: archetype, rawScores: { Nit: 0.263, TAG: 0.754, LAG: 0, 'Tight Passive': 0.281, 'Loose Passive': 0, 'Calling Station': 0, Maniac: 0 } }, extra || {});
}

function entry(playerId, seatId, profile, layout, enabled) {
  return {
    playerId: playerId,
    name: 'Player ' + playerId,
    seatId: seatId,
    confirmed: true,
    rect: { left: 50, top: 50, width: 100, height: 24 },
    stats: { handsPlayed: 80, vpip: 25, pfr: 18, af: 2 },
    displayedStatIds: ['hands', 'vpip', 'pfr', 'af'],
    opportunityStatsLayout: layout || 'combined',
    displayedProfile: profile,
    showPlayerProfiles: enabled !== false
  };
}

function fakeAdapter(calls) {
  return {
    create: function (item) {
      var element = { html: overlays.profileChipHtml(item.displayedProfile, item.showPlayerProfiles), seatId: item.seatId };
      calls.created.push({ entry: item, element: element });
      return element;
    },
    update: function (record, item, reason) {
      record.element.html = overlays.profileChipHtml(item.displayedProfile, item.showPlayerProfiles);
      calls.updated.push({ playerId: item.playerId, html: record.element.html, reason: reason });
    },
    move: function (record, item) { record.element.seatId = item.seatId; calls.moved.push(item.playerId); },
    position: function () {},
    remove: function (record) { calls.removed.push({ playerId: record.playerId, html: record.element.html }); },
    skip: function () {}
  };
}

var tagHtml = overlays.profileChipHtml(displayed('TAG'), true);
var loosePassiveHtml = overlays.profileChipHtml(displayed('Loose Passive'), true);
assert.ok(tagHtml.includes('>TAG</span>'), 'V4 combined HUD renders the stabilized TAG chip');
assert.ok(loosePassiveHtml.includes('>Loose Passive</span>'), 'V5 stacked HUD renders the stabilized Loose Passive chip');
assert.ok(overlays.compactStatRows(entry('x', 's', displayed('TAG'), 'combined').stats, undefined, 'combined').length >= 2, 'V4 combined stats remain row-grouped beside the chip');
assert.ok(overlays.compactStatRows(entry('x', 's', displayed('Loose Passive'), 'stacked').stats, undefined, 'stacked').length >= 3, 'V5 stacked stats remain row-grouped beside the chip');

assert.ok(overlays.profileChipHtml(displayed('Calling Station'), true).includes('>Calling Station</span>'), 'V6 Calling Station remains full text');
assert.ok(overlays.profileChipHtml(displayed('Tight Passive'), true).includes('>Tight Passive</span>'), 'V7 Tight Passive remains full text');
assert.ok(css.includes('max-width: 110px'), 'long labels have a bounded, readable chip width');

var partial = overlays.nativePanelVisibleFragments({ left: 10, top: 10, width: 220, height: 24 }, [{ left: 180, top: 0, width: 100, height: 100 }], 64);
assert.strictEqual(partial.occluded, true, 'V8 native-panel overlap is detected for the complete enlarged HUD bounds');
assert.strictEqual(partial.fullyOccluded, false, 'V8 partial occlusion retains the visible chip/stat fragment');
assert.ok(partial.fragments.length > 0 && partial.bounded, 'V8 clipping remains bounded');

function tableLayout(count) {
  var entries = [];
  var sizes = {};
  for (var index = 0; index < count; index += 1) {
    var angle = Math.PI * 2 * index / count;
    var left = 450 + Math.cos(angle) * 300;
    var top = 300 + Math.sin(angle) * 190;
    var id = 'layout-' + index;
    entries.push({ playerId: id, rect: { left: left, top: top, width: 100, height: 28 }, obstacles: [{ left: left, top: top, width: 100, height: 28 }], outward: { x: Math.cos(angle), y: Math.sin(angle) } });
    sizes[id] = { width: 220, height: 28 };
  }
  return overlays.layoutOverlays(entries, sizes, { width: 1000, height: 700 });
}
assert.strictEqual(Array.from(tableLayout(9).values()).filter(Boolean).length, 9, 'V9 a nine-seat table retains collision-aware profile HUD placement');
assert.strictEqual(Array.from(tableLayout(6).values()).filter(Boolean).length, 6, 'V10 a six-seat table retains collision-aware profile HUD placement');

assert.strictEqual(overlays.profileChipHtml(displayed('TAG'), false), '', 'V11 toggle OFF hides profiles');
assert.ok(overlays.profileChipHtml(displayed('TAG'), true), 'V12 toggle ON restores profiles');
assert.strictEqual(settings.DEFAULTS.showPlayerProfiles, true, 'profile visibility defaults ON in the existing settings schema');

var rawUnknownDisplayedTag = displayed('TAG', { rawArchetype: 'Unknown / Uncertain', rawBestCandidate: 'LAG', rawBestScore: 0.99, rawConfidence: 0.99 });
assert.ok(overlays.profileChipHtml(rawUnknownDisplayedTag, true).includes('>TAG</span>'), 'V13 raw Unknown does not replace a stabilized displayed TAG');
var normalTooltip = overlays.profileTooltipHtml(displayed('TAG'), true);
assert.ok(normalTooltip.includes('Tight-aggressive player.'), 'current displayed archetype retains its short description');
['Nit', 'TAG', 'LAG', 'Tight Passive', 'Loose Passive', 'Calling Station', 'Maniac'].forEach(function (name) { assert.ok(normalTooltip.includes('<span>' + name + '</span>'), 'tooltip includes ' + name); });
['26%', '75%', '0%', '28%'].forEach(function (percentage) { assert.ok(normalTooltip.includes(percentage), 'raw score uses whole-percentage rounding: ' + percentage); });
assert.ok(normalTooltip.includes('statistical compatibility, not probability'));
assert.ok(!normalTooltip.includes('Displayed profile:'), 'matching displayed/raw TAG stays compact');
assert.ok(overlays.PROFILE_ARCHETYPE_ORDER.reduce(function (sum, name) { return sum + Math.round(displayed('TAG').rawScores[name] * 100); }, 0) !== 100, 'displayed fit scores are not normalized');
var unknownTooltip = overlays.profileTooltipHtml(rawUnknownDisplayedTag, true);
assert.ok(unknownTooltip.includes('Displayed profile: <strong>TAG</strong>') && unknownTooltip.includes('Current raw classification: <strong>Unknown / Uncertain</strong>'), 'retained TAG clearly distinguishes raw Unknown');
var changedTooltip = overlays.profileTooltipHtml(displayed('TAG', { rawArchetype: 'Tight Passive' }), true);
assert.ok(changedTooltip.includes('Displayed profile: <strong>TAG</strong>') && changedTooltip.includes('Current raw classification: <strong>Tight Passive</strong>'), 'retained TAG clearly distinguishes another raw archetype');
assert.strictEqual(overlays.profileTooltipHtml({ visible: false, archetype: 'TAG', rawScores: displayed('TAG').rawScores }, true), '', 'hidden profile has no tooltip');
assert.strictEqual(overlays.profileChipHtml({ visible: false, archetype: 'TAG', rawArchetype: 'TAG' }, true), '', 'V14 a hidden displayed state removes the chip');
assert.strictEqual(overlays.profileChipHtml({ visible: false, archetype: null, status: 'hidden_insufficient', rawArchetype: 'TAG' }, true), '', 'V16 below-threshold presentation renders no fallback');
['Unknown / Uncertain', 'Unknown / Insufficient Sample', 'Unknown / Unsupported', 'Unknown', '?'].forEach(function (unknown) {
  assert.strictEqual(overlays.profileChipHtml(displayed(unknown), true), '', 'unknown label is never visible: ' + unknown);
});

var calls = { created: [], updated: [], moved: [], removed: [] };
var controller = overlays.createController(fakeAdapter(calls));
controller.reconcile([entry('A', 'seat-3', displayed('TAG'))], { displayMode: 'seat-overlays-only' });
controller.reconcile([entry('B', 'seat-3', { visible: false, archetype: null, status: 'hidden_insufficient' })], { displayMode: 'seat-overlays-only' });
assert.strictEqual(calls.removed.length, 1, 'V1/V3 reused seat removes Player A overlay before replacement');
assert.strictEqual(calls.removed[0].playerId, 'A');
assert.strictEqual(controller.records.get('B').element.html, '', 'V1/V3 Player B never inherits Player A TAG chip');

var moveCalls = { created: [], updated: [], moved: [], removed: [] };
var moveController = overlays.createController(fakeAdapter(moveCalls));
moveController.reconcile([entry('A', 'seat-3', displayed('TAG'))], { displayMode: 'seat-overlays-only' });
moveController.reconcile([entry('A', 'seat-7', displayed('TAG'))], { displayMode: 'seat-overlays-only' });
assert.deepStrictEqual(moveCalls.moved, ['A'], 'V2 the stable player overlay follows the player to a new seat');
assert.ok(moveController.records.get('A').element.html.includes('>TAG</span>'));

var replacementCalls = { created: [], updated: [], moved: [], removed: [] };
var replacementController = overlays.createController(fakeAdapter(replacementCalls));
replacementController.reconcile([entry('A', 'seat-1', displayed('TAG'))], { displayMode: 'seat-overlays-only' });
replacementController.reconcile([entry('A', 'seat-1', displayed('Loose Passive'))], { displayMode: 'seat-overlays-only' });
replacementController.reconcile([entry('A', 'seat-1', displayed('Loose Passive'))], { displayMode: 'seat-overlays-only' });
assert.strictEqual(replacementCalls.updated.length, 1, 'V15 displayed archetype replacement updates exactly once');
assert.ok(replacementCalls.updated[0].html.includes('>Loose Passive</span>'));

var tagWithSecondaryData = displayed('TAG', { tags: [{ tag: '3B Heavy' }], rawScore: 0.88, confidence: 0.93 });
var safeHtml = overlays.profileChipHtml(tagWithSecondaryData, true);
assert.ok(!safeHtml.includes('3B Heavy'), 'V17 secondary tags remain shadow-only');
assert.ok(!/confidence|bestCandidate|runnerUp|margin/i.test(safeHtml), 'V18 normal DOM exposes no confidence or candidate internals');
assert.deepStrictEqual(Object.keys(overlays.PROFILE_PRESENTATIONS), ['Nit', 'TAG', 'LAG', 'Tight Passive', 'Loose Passive', 'Calling Station', 'Maniac']);
Object.keys(overlays.PROFILE_PRESENTATIONS).forEach(function (archetype) {
  var presentation = overlays.PROFILE_PRESENTATIONS[archetype];
  assert.ok(presentation.description && !/score|confidence|margin|hysteresis/i.test(presentation.description), 'V18 tooltip is descriptive only for ' + archetype);
});

var seatRenderer = content.slice(content.indexOf('  function seatOverlayContent(entry)'), content.indexOf('  function seatOverlayHasVisibleContent('));
assert.ok(seatRenderer.includes('PokerSeatOverlay.profileChipHtml(entry.displayedProfile, entry.showPlayerProfiles, entry.profileStatSource, entry.statSource)'), 'production seat renderer consumes the displayed-profile entry plus explicit truthful source labels only');
assert.ok(content.includes('PokerPlayerProfileShadowStore.displayedProfile(playerProfileShadowState, stringPlayerId)'), 'production reconciliation looks up the presentation result by stable player ID');
assert.ok(!seatRenderer.includes('.primary') && !seatRenderer.includes('bestCandidate') && !seatRenderer.includes('rawArchetype'), 'production renderer has no raw classifier fallback');
assert.ok(content.includes("refreshShadowProfiles('finalized-hand-commit'"), 'profile refresh remains at finalized-hand commit');
assert.ok(!content.includes('effectiveTableSize') || !seatRenderer.includes('effectiveTableSize'), 'table-size context is not rendered in the seat HUD');
assert.ok(content.includes('.pnhud-profile-tooltip-target'), 'profile tooltip reuses delegated hover/focus infrastructure');
assert.ok(content.includes('PokerStatTooltip.choosePlacement(profileAnchor'), 'profile tooltip reuses established viewport placement');
assert.ok(content.includes("seatOverlayLayer.setAttribute('aria-hidden', overlaysVisible && !seatHudBlockingPanelState.blocked ? 'false' : 'true')"), 'visible, non-blocked seat overlays expose their focusable profile/stat targets to accessibility APIs');
assert.ok(css.includes('.pnhud-profile-chip--calling-station'));
assert.ok(css.includes('.pnhud-profile-tooltip-target:focus-visible'), 'profile chip has a keyboard-visible focus treatment');
assert.ok(!/animation[^;]*:|@keyframes/.test(css.slice(css.indexOf('.pnhud-profile-chip'), css.indexOf('.pnhud-anchor-box'))), 'profile chips do not animate');

console.log('Visible player-profile seat HUD V1-V18 production-path tests passed.');
