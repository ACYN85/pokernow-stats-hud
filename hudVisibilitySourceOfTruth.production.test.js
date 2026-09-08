'use strict';

var assert = require('assert');
var fs = require('fs');
var settings = require('./settingsUi.js');
var overlays = require('./seatOverlay.js');
var bootstrap = require('./uiBootstrap.js');
var inspector = require('./handStatInspector.js');
var harnessSupport = require('./testSupport/productionContentScriptHarness.js');

var content = fs.readFileSync('./content.js', 'utf8');
var popup = fs.readFileSync('./popup.js', 'utf8');
var popupHtml = fs.readFileSync('./popup.html', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');

function FakeElement(tagName, ownerDocument) {
  this.tagName = String(tagName || 'div').toUpperCase();
  this.ownerDocument = ownerDocument;
  this.parentElement = null;
  this.children = [];
  this.style = {};
  this._id = '';
}
Object.defineProperty(FakeElement.prototype, 'id', {
  get: function () { return this._id; },
  set: function (value) { this._id = String(value || ''); if (this._id) this.ownerDocument.ids.set(this._id, this); }
});
FakeElement.prototype.appendChild = function (child) { child.parentElement = this; this.children.push(child); if (child.id) this.ownerDocument.ids.set(child.id, child); return child; };

function fakeDocument() {
  var documentLike = { ids: new Map() };
  documentLike.createElement = function (tagName) { return new FakeElement(tagName, documentLike); };
  documentLike.getElementById = function (id) { return documentLike.ids.get(String(id)) || null; };
  documentLike.documentElement = documentLike.createElement('html');
  documentLike.body = documentLike.createElement('body');
  documentLike.documentElement.appendChild(documentLike.body);
  return documentLike;
}

function renderedVisibility(seatEnabled, leaderboardEnabled) {
  var mode = settings.modeForVisibility(seatEnabled, leaderboardEnabled);
  var roots = bootstrap.ensureRoots(fakeDocument(), mode);
  return { mode: mode, overlayDisplay: roots.overlayRoot.style.display, leaderboardDisplay: roots.detailsRoot.style.display };
}

// V1: fresh defaults are internally consistent.
var fresh = settings.normalizeVisibility(undefined, undefined);
assert.deepStrictEqual([fresh.value.seatOverlaysEnabled, fresh.value.leaderboardEnabled, fresh.displayMode], [true, false, 'seat-overlays-only']);

// V2-V6: dropdown/checkbox combinations map one-to-one to rendered surfaces.
assert.deepStrictEqual(renderedVisibility(true, true), { mode: 'seat-overlays-leaderboard', overlayDisplay: 'block', leaderboardDisplay: 'block' }, 'V2/V3 Both renders both surfaces');
assert.deepStrictEqual(renderedVisibility(true, false), { mode: 'seat-overlays-only', overlayDisplay: 'block', leaderboardDisplay: 'none' }, 'V4 overlays-only renders only overlays');
assert.deepStrictEqual(renderedVisibility(false, true), { mode: 'leaderboard-only', overlayDisplay: 'none', leaderboardDisplay: 'block' }, 'V5 leaderboard-only renders only leaderboard');
assert.deepStrictEqual(renderedVisibility(false, false), { mode: 'hidden', overlayDisplay: 'none', leaderboardDisplay: 'none' }, 'V6 Off renders neither surface');

// V7-V8: page and extension reloads retain canonical booleans, not transient checkbox DOM.
var persistedBoth = settings.merge(settings.DEFAULTS, { seatOverlaysEnabled: true, leaderboardEnabled: true, accentTheme: 'purple' });
var pageReload = settings.normalizeVisibility(JSON.parse(JSON.stringify(persistedBoth)), 'seat-overlays-only');
var extensionReload = settings.normalizeVisibility(JSON.parse(JSON.stringify(pageReload.value)), pageReload.displayMode);
assert.deepStrictEqual([pageReload.displayMode, extensionReload.displayMode], ['seat-overlays-leaderboard', 'seat-overlays-leaderboard']);
assert.strictEqual(extensionReload.value.accentTheme, 'purple', 'V7/V8 reload migration preserves unrelated preferences');
var reloadHarness = harnessSupport.createHarness({
  gameId: 'visibility-reload-v8',
  initialStorage: { pokerNowHudDisplayMode: 'seat-overlays-only', hudUiPreferences: persistedBoth }
});
assert.deepStrictEqual(reloadHarness.evaluationErrors, [], 'V8 real content startup loads without errors');
assert.strictEqual(reloadHarness.storage.pokerNowHudDisplayMode, 'seat-overlays-leaderboard', 'V8 startup synchronizes the derived compatibility mode');
assert.deepStrictEqual([reloadHarness.storage.hudUiPreferences.seatOverlaysEnabled, reloadHarness.storage.hudUiPreferences.leaderboardEnabled], [true, true]);
assert.strictEqual(reloadHarness.evaluateInIsolatedWorld("document.getElementById('pnhud-overlay-root').style.display"), 'block');
assert.strictEqual(reloadHarness.evaluateInIsolatedWorld("document.getElementById('pnhud-details-root').style.display"), 'block');

// V8A-V8G: the Settings checkbox drives the canonical production persistence path without disturbing independent state.
var visibilityGameId = 'seat-hud-visibility-setting';
var manualPositionsKey = 'pokerNowHudManualOverlayPositions:game:' + visibilityGameId;
var savedManualPositions = { 'stable-player': { playerId: 'stable-player', seatId: 'seat-3', offsetX: 34, offsetY: -12 } };
var visibilityPreferences = settings.merge(settings.DEFAULTS, {
  seatOverlaysEnabled: true,
  leaderboardEnabled: true,
  showPotOdds: false,
  dashboardBackgroundOpacity: 0.73,
  selectedSettingsSection: 'overlay'
});
var visibilityStorage = { pokerNowHudDisplayMode: 'seat-overlays-leaderboard', hudUiPreferences: visibilityPreferences };
visibilityStorage[manualPositionsKey] = savedManualPositions;
var visibilityHarness = harnessSupport.createHarness({
  gameId: visibilityGameId,
  initialStorage: visibilityStorage,
  transformContentSource: function (source) {
    return source.replace(/\n\}\)\(\);\s*$/, '\n  globalThis.__PNHUD_SEAT_HUD_VISIBILITY__ = { setDashboardOpen: function () { playerDashboardState.open = true; }, toggle: function (enabled) { return writeVisibilityState(enabled, leaderboardVisible(), \'test-seat-hud-setting\'); }, resetPositions: function () { return resetOverlayPositions(\'test-seat-hud-setting\'); }, snapshot: function () { var overlayRoot = document.getElementById(overlayRootId); var detailsRoot = document.getElementById(detailsRootId); return { seatHudEnabled: seatOverlaysVisible(), leaderboardEnabled: leaderboardVisible(), showPotOdds: hudUiPreferences.showPotOdds, dashboardOpen: playerDashboardState.open, dashboardBackgroundOpacity: hudUiPreferences.dashboardBackgroundOpacity, displayMode: displayMode, overlayDisplay: overlayRoot && overlayRoot.style.display, leaderboardDisplay: detailsRoot && detailsRoot.style.display, manualOverlayPositions: cloneJson(manualOverlayPositions), settingsHtml: settingsPanel && settingsPanel.innerHTML || \'\' }; } };\n})();\n');
  }
});
assert.deepStrictEqual(visibilityHarness.evaluationErrors, [], 'V8A production visibility harness starts cleanly');
visibilityHarness.evaluateInIsolatedWorld('__PNHUD_SEAT_HUD_VISIBILITY__.setDashboardOpen()');
var visibilityOn = JSON.parse(visibilityHarness.evaluateInIsolatedWorld('JSON.stringify(__PNHUD_SEAT_HUD_VISIBILITY__.snapshot())'));
assert.strictEqual(visibilityOn.seatHudEnabled, true, 'V8A Seat HUD defaults/restores ON');
assert.strictEqual(visibilityOn.overlayDisplay, 'block', 'V8A restored Seat HUD is visible');
assert.ok(visibilityOn.settingsHtml.includes('> Show Seat HUD</label>'), 'V8A Settings uses the canonical Show Seat HUD label');

visibilityHarness.evaluateInIsolatedWorld('__PNHUD_SEAT_HUD_VISIBILITY__.toggle(false)');
var visibilityOff = JSON.parse(visibilityHarness.evaluateInIsolatedWorld('JSON.stringify(__PNHUD_SEAT_HUD_VISIBILITY__.snapshot())'));
assert.deepStrictEqual({ seatHudEnabled: visibilityOff.seatHudEnabled, displayMode: visibilityOff.displayMode, overlayDisplay: visibilityOff.overlayDisplay }, { seatHudEnabled: false, displayMode: 'leaderboard-only', overlayDisplay: 'none' }, 'V8B OFF hides only the Seat HUD through production rendering');
assert.ok(!visibilityOff.settingsHtml.includes('class="pnhud-settings-overlays-visible" checked'), 'V8B Settings rerenders the Seat HUD checkbox unchecked');
assert.deepStrictEqual({ leaderboardEnabled: visibilityOff.leaderboardEnabled, leaderboardDisplay: visibilityOff.leaderboardDisplay, showPotOdds: visibilityOff.showPotOdds, dashboardOpen: visibilityOff.dashboardOpen, dashboardBackgroundOpacity: visibilityOff.dashboardBackgroundOpacity }, { leaderboardEnabled: true, leaderboardDisplay: 'block', showPotOdds: false, dashboardOpen: true, dashboardBackgroundOpacity: 0.73 }, 'V8C Leaderboard, Pot Odds, and Dashboard state remain independent');
assert.deepStrictEqual(visibilityOff.manualOverlayPositions, savedManualPositions, 'V8D hiding preserves saved Seat HUD offsets');
assert.strictEqual(visibilityHarness.storage.hudUiPreferences.seatOverlaysEnabled, false, 'V8E OFF persists through the existing HUD preference record');

var persistedOffReload = settings.normalizeVisibility(JSON.parse(JSON.stringify(visibilityHarness.storage.hudUiPreferences)), visibilityHarness.storage.pokerNowHudDisplayMode);
assert.deepStrictEqual([persistedOffReload.value.seatOverlaysEnabled, persistedOffReload.displayMode], [false, 'leaderboard-only'], 'V8E OFF survives settings/page reload normalization');
var offReloadHarness = harnessSupport.createHarness({ gameId: visibilityGameId, initialStorage: JSON.parse(JSON.stringify(visibilityHarness.storage)) });
assert.deepStrictEqual(offReloadHarness.evaluationErrors, [], 'V8E production page reload restores cleanly');
assert.strictEqual(offReloadHarness.evaluateInIsolatedWorld("document.getElementById('pnhud-overlay-root').style.display"), 'none', 'V8E production page reload keeps the Seat HUD hidden');
assert.strictEqual(offReloadHarness.evaluateInIsolatedWorld("document.getElementById('pnhud-details-root').style.display"), 'block', 'V8E production page reload keeps the independent Leaderboard visible');
assert.deepStrictEqual(offReloadHarness.storage[manualPositionsKey], savedManualPositions, 'V8E production page reload preserves Seat HUD offsets');

visibilityHarness.evaluateInIsolatedWorld('__PNHUD_SEAT_HUD_VISIBILITY__.toggle(true)');
var visibilityRestored = JSON.parse(visibilityHarness.evaluateInIsolatedWorld('JSON.stringify(__PNHUD_SEAT_HUD_VISIBILITY__.snapshot())'));
assert.deepStrictEqual({ seatHudEnabled: visibilityRestored.seatHudEnabled, displayMode: visibilityRestored.displayMode, overlayDisplay: visibilityRestored.overlayDisplay }, { seatHudEnabled: true, displayMode: 'seat-overlays-leaderboard', overlayDisplay: 'block' }, 'V8F ON restores the Seat HUD without a new hand');
assert.ok(visibilityRestored.settingsHtml.includes('class="pnhud-settings-overlays-visible" checked'), 'V8F Settings rerenders the Seat HUD checkbox checked');
assert.deepStrictEqual(visibilityRestored.manualOverlayPositions, savedManualPositions, 'V8F ON restores with the existing saved offsets');

visibilityHarness.evaluateInIsolatedWorld('__PNHUD_SEAT_HUD_VISIBILITY__.resetPositions()');
var visibilityAfterReset = JSON.parse(visibilityHarness.evaluateInIsolatedWorld('JSON.stringify(__PNHUD_SEAT_HUD_VISIBILITY__.snapshot())'));
assert.deepStrictEqual(visibilityAfterReset.manualOverlayPositions, {}, 'V8G Reset Seat HUD Positions still clears offsets explicitly');
assert.deepStrictEqual(visibilityHarness.storage[manualPositionsKey], {}, 'V8G reset persists the cleared current-game offset map');
assert.deepStrictEqual({ seatHudEnabled: visibilityAfterReset.seatHudEnabled, leaderboardEnabled: visibilityAfterReset.leaderboardEnabled, showPotOdds: visibilityAfterReset.showPotOdds, dashboardOpen: visibilityAfterReset.dashboardOpen }, { seatHudEnabled: true, leaderboardEnabled: true, showPotOdds: false, dashboardOpen: true }, 'V8G position reset does not change surface visibility or Dashboard state');

// V9-V10: settings and inspector presentation state cannot mutate visibility.
var visibilityBefore = JSON.stringify(persistedBoth);
var inspectorState = inspector.createState();
inspector.open(inspectorState, []);
inspector.close(inspectorState);
assert.strictEqual(JSON.stringify(persistedBoth), visibilityBefore, 'V9/V10 settings/inspector open-close is visibility-neutral');
assert.ok(content.includes("else {\n      settingsUiDiagnostics.settingsCloseCount += 1;\n      PokerHandStatInspector.close(handStatInspectorState);"));

// V11: the launcher remains above the visible leaderboard.
var leaderboardZ = Number((css.match(/#pokernow-stats-hud-root\s*\{[^}]*z-index:\s*(\d+)/) || [])[1]);
var launcherZ = Number((css.match(/\.pnhud-toggle\s*\{[^}]*z-index:\s*(\d+)/) || [])[1]);
assert.ok(launcherZ > leaderboardZ, 'V11 leaderboard launcher remains clickable with both surfaces visible');

// V12-V13: changing one checkbox preserves the other canonical boolean.
assert.strictEqual(settings.modeForVisibility(false, true), 'leaderboard-only', 'V12 disabling overlays preserves leaderboard');
assert.strictEqual(settings.modeForVisibility(true, true), 'seat-overlays-leaderboard', 'V12 enabling overlays preserves leaderboard');
assert.strictEqual(settings.modeForVisibility(true, false), 'seat-overlays-only', 'V13 disabling leaderboard preserves overlays');
assert.strictEqual(settings.modeForVisibility(true, true), 'seat-overlays-leaderboard', 'V13 enabling leaderboard preserves overlays');

// V14: all state projections use the canonical booleans, making contradictory UI impossible.
assert.ok(content.includes("(seatOverlaysVisible() ? ' checked' : '')"));
assert.ok(content.includes("(leaderboardVisible() ? ' checked' : '')"));
assert.ok(content.includes('> Show Seat HUD</label>'), 'Settings exposes the requested Seat HUD checkbox label');
assert.ok(!content.includes('> Enable seat overlays</label>'), 'Settings no longer presents competing overlay terminology for the visibility control');
assert.ok(content.includes('synchronizeDerivedDisplayMode()'));
assert.ok(content.includes("update[STORAGE_KEYS.hudUiPreferences] = nextPreferences"));
assert.ok(content.includes("update[STORAGE_KEYS.displayMode] = normalized"));
assert.ok(!content.includes('displayMode = PokerSeatOverlay.normalizeDisplayMode(saved[STORAGE_KEYS.displayMode])'));

// V15: exact screenshot contradiction normalizes to Both because explicit new state wins.
var screenshotState = settings.normalizeVisibility({ version: 5, seatOverlaysEnabled: true, leaderboardEnabled: true }, 'seat-overlays-only');
assert.deepStrictEqual([screenshotState.value.seatOverlaysEnabled, screenshotState.value.leaderboardEnabled, screenshotState.displayMode], [true, true, 'seat-overlays-leaderboard']);
var partialExplicit = settings.normalizeVisibility({ version: 5, leaderboardEnabled: true }, 'seat-overlays-only');
assert.deepStrictEqual([partialExplicit.value.seatOverlaysEnabled, partialExplicit.value.leaderboardEnabled, partialExplicit.displayMode], [true, true, 'seat-overlays-leaderboard'], 'explicit leaderboard boolean wins while legacy fills the missing overlay field');

// V16: legacy-only installations migrate every old enum deterministically.
[
  ['seat-overlays-only', true, false],
  ['seat-overlays-leaderboard', true, true],
  ['leaderboard-only', false, true],
  ['hidden', false, false]
].forEach(function (fixture) {
  var migrated = settings.normalizeVisibility({ version: 4, hudOpacity: 0.72, accentTheme: 'amber' }, fixture[0]);
  assert.deepStrictEqual([migrated.value.seatOverlaysEnabled, migrated.value.leaderboardEnabled, migrated.displayMode], fixture.slice(1).concat(fixture[0]));
  assert.strictEqual(migrated.value.hudOpacity, 0.72);
  assert.strictEqual(migrated.value.accentTheme, 'amber');
});

assert.ok(popup.includes("update[HUD_UI_PREFERENCES_KEY] = Object.assign({}, currentPreferences, visibility, { version: 5 })"), 'popup writes canonical booleans without resetting unrelated preferences');
assert.ok(popupHtml.includes('data-display-mode="hidden">Off</button>'), 'popup exposes all four canonical combinations');
assert.strictEqual(overlays.modeForVisibility(true, true), settings.modeForVisibility(true, true), 'seat renderer and settings agree on the derived compatibility enum');

console.log('HUD visibility source-of-truth V1-V16 migration, persistence, reconciliation, and UI consistency tests passed.');
