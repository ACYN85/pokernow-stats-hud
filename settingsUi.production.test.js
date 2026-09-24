'use strict';

var assert = require('assert');
var fs = require('fs');
var manifest = require('./manifest.json');
var overlays = require('./seatOverlay.js');
var bootstrap = require('./uiBootstrap.js');
var productionHarness = require('./testSupport/potOddsProductionVisibilityHarness.js');
var pointer = require('./testSupport/productionPointerEventHarness.js');
var settings = require('./settingsUi.js');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var isolated = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });
var renderStart = content.indexOf('  function render(saved)');
var renderEnd = content.indexOf('  function healthPanelHtml', renderStart);
var normalHudRenderer = content.slice(renderStart, renderEnd);

assert.ok(isolated.js.includes('settingsUi.js'));
assert.ok(isolated.js.indexOf('settingsUi.js') < isolated.js.indexOf('content.js'));
assert.ok(isolated.js.includes('handStatInspector.js'), 'the production settings path packages the Hand Stat Inspector');
assert.ok(isolated.js.indexOf('handStatInspector.js') < isolated.js.indexOf('content.js'), 'the inspector registers before content startup validation');
assert.ok(content.includes("var settingsLauncherId = 'pnhud-settings-launcher'"));
assert.ok(content.includes("var settingsPanelId = 'pnhud-settings-panel'"));
assert.ok(content.includes("settingsLauncher.dataset.pnhudSettingsBound !== 'true'"), 'launcher listener is guarded');
assert.ok(content.includes("settingsPanel.dataset.pnhudSettingsBound !== 'true'"), 'panel delegation listeners are guarded');
assert.ok(content.includes('if (panelCreatedNow || !settingsPanel.innerHTML) renderSettingsPanel();'), 'routine live HUD refreshes do not rebuild an open settings editor');
assert.ok(content.includes('if (!settingsKeydownListener)'), 'Escape listener has one owner');
assert.ok(content.includes("event.key === 'Escape'"));
assert.ok(content.includes('settingsLauncher.focus()'), 'closing restores launcher focus');
assert.ok(content.includes('focusTarget.focus()'), 'opening moves focus into settings');
assert.ok(content.includes('settingsUi: cloneJson(settingsUiDiagnostics)'), 'Copy Diagnostics includes UI health');
assert.ok(content.includes("hudUiPreferences: 'hudUiPreferences'"));
assert.strictEqual((content.match(/chrome\.storage\.local\.get\(keysToRead/g) || []).length, 1, 'settings reuse the centralized storage restoration callback');

['general', 'overlay', 'hud', 'appearance', 'career-data', 'diagnostics', 'about'].forEach(function (section) {
  assert.ok(content.includes("data-settings-content=\"" + section + "\""), section + ' section is independently rendered');
});
assert.ok(content.includes('overlayStatCustomizerHtml()'), 'working overlay editor is reused');
assert.ok(content.includes('Opportunity stats layout'), 'the overlay settings section exposes the existing Combined/Stacked preference');
assert.ok(content.includes('pnhud-settings-opportunity-layout'), 'the production settings path binds the opportunity layout selector');
assert.ok(content.includes("updateHudUiPreferences({ opportunityStatsLayout: event.target.value }, 'overlay-opportunity-layout')"), 'layout changes use the existing UI preference persistence path');
assert.ok(content.includes('Show Player Profiles'), 'the seat-overlay settings expose the profile visibility preference');
assert.ok(content.includes('pnhud-settings-player-profiles'), 'the production settings path binds the profile toggle');
assert.ok(content.includes("updateHudUiPreferences({ showPlayerProfiles: event.target.checked }, 'overlay-player-profiles')"), 'profile visibility uses the existing versioned UI preference persistence path');
assert.ok(content.includes('bindOverlayStatCustomizer(settingsPanel)'), 'overlay editor behavior is rebound only to its current settings view');
assert.ok(content.includes("updateDisplayedStatIds(next, 'drag-reorder')") || content.includes("'drag-reorder'"), 'existing central overlay preference update remains');

assert.ok(!normalHudRenderer.includes('healthPanelHtml('), 'normal HUD contains no pipeline counter block');
assert.ok(!normalHudRenderer.includes('overlayStatCustomizerHtml('), 'normal HUD contains no overlay editor');
assert.ok(!normalHudRenderer.includes('pnhud-inject-test'), 'normal HUD contains no developer actions');
assert.ok(normalHudRenderer.includes('pnhud-title'));
assert.ok(normalHudRenderer.includes("['session', 'career'].map"));
assert.ok(normalHudRenderer.includes('data-leaderboard-source="'));
assert.ok(normalHudRenderer.includes('updateLeaderboardSource(button.dataset.leaderboardSource)'));
assert.ok(!normalHudRenderer.includes('pnhud-reset'), 'Reset Session has one authoritative owner under Settings > Data');
assert.ok(content.includes('pnhud-data-reset-session'));
assert.ok(normalHudRenderer.includes('<table>'));

assert.ok(content.includes("return copyDiagnostics()"));
assert.ok(content.includes("return inspectSeats('settings diagnostics')"));
assert.ok(content.includes("return injectTestEvent()"));
assert.ok(content.includes('developerToolsVisible: developerToolsVisible'));
assert.ok(content.includes('pnhud-settings-developer-tools'));
assert.ok(content.includes('Hand Stat Inspector'), 'the existing diagnostics section exposes the inspector launcher');
assert.ok(content.includes('pnhud-hand-stat-inspector-host'), 'the inspector renders inside the existing settings system');
assert.ok(content.includes('openHandStatInspector()'), 'the settings click path owns inspector opening');
assert.ok(content.includes('closeHandStatInspector()'), 'the settings click and Escape paths own inspector closing');

assert.ok(css.includes('#pnhud-settings-launcher'));
assert.ok(css.includes('#pnhud-settings-panel[hidden]'));
assert.ok(css.includes('#pnhud-settings-panel .pnhud-hand-stat-inspector'), 'inspector styling is scoped to the existing settings panel');
assert.ok(css.includes('max-height: calc(100vh - 64px)'));
assert.ok(css.includes('--pnhud-hud-opacity'));
assert.ok(css.includes('--pnhud-surface-opacity'));
assert.ok(css.includes('--pnhud-accent'));
assert.ok(content.includes("type=\"range\" min=\"10\" max=\"100\""));
assert.ok(content.includes('HUD background opacity'));
assert.ok(content.includes('Settings panel background opacity'));
assert.ok(content.includes('Player dashboard background opacity'));
assert.ok(content.includes('settingsBackgroundOpacity'));
assert.ok(content.includes('dashboardBackgroundOpacity'));
assert.ok(content.includes('--pnhud-settings-background-opacity'));
assert.ok(content.includes('--pnhud-dashboard-background-opacity'));
assert.ok(!/#pnhud-settings-panel\s*\{[^}]*\bopacity\s*:/.test(css), 'settings panel does not fade child content');
assert.ok(!/#pokernow-stats-hud-root\s*\{[^}]*\bopacity\s*:/.test(css), 'outer HUD does not fade child content');
assert.ok(!/#pnhud-player-dashboard\s*\{[^}]*\bopacity\s*:/.test(css), 'dashboard does not fade text or controls through parent opacity');
assert.ok(css.includes('overscroll-behavior: contain'));
assert.ok(css.includes('scrollbar-gutter: stable'));
assert.ok(css.includes('#pnhud-settings-panel main { box-sizing: border-box; min-width: 0; min-height: 0; height: 100%; overflow-x: hidden; overflow-y: auto;'), 'only the content pane owns settings scrolling');
assert.ok(css.includes('#pnhud-details-root.pnhud-size-small { --pnhud-font-size: 10px;'), 'small uses coordinated layout tokens');
assert.ok(css.includes('--pnhud-cell-pad-y: 4px'));
assert.ok(css.includes('#pnhud-details-root.pnhud-size-large { --pnhud-font-size: 13px;'));
assert.ok(content.includes('PokerHudSettings.ACCENT_THEMES'));

assert.deepStrictEqual(overlays.visibilityForMode('hidden'), { mode: 'hidden', overlaysVisible: false, detailsVisible: false });
assert.deepStrictEqual(bootstrap.visibilityForMode('hidden'), { mode: 'hidden', overlaysVisible: false, detailsVisible: false });
assert.ok(content.includes('var stableRootIds = [detailsRootId, overlayRootId, toggleRootId, settingsLauncherId, settingsPanelId]'), 'root recovery watches persistent Settings ownership; Players is tab content');

function clickProductionControl(harness, selector) {
  var target = harness.document.querySelector(selector);
  assert.ok(target, 'production Settings contains ' + selector);
  pointer.bubble(harness, target, pointer.pointerEvent('click', target));
  harness.runFor(80, 16);
  return target;
}

function changeProductionCheckbox(harness, selector, checked) {
  var target = harness.document.querySelector(selector);
  assert.ok(target, 'production Settings contains ' + selector);
  target.checked = checked;
  pointer.bubble(harness, target, pointer.pointerEvent('change', target));
  harness.runFor(80, 16);
}

// Exercise the real production Settings renderer and delegated event handlers. This
// catches controls placed in a different conditional section than the user opens.
var seatHudPreferences = settings.merge(settings.DEFAULTS, {
  settingsOpen: false,
  selectedSettingsSection: 'general',
  seatOverlaysEnabled: true,
  leaderboardEnabled: true,
  showPotOdds: true
});
var seatHudHarness = productionHarness.createHarness({
  gameId: 'settings-seat-hud-visibility',
  layout: 'live-full',
  initialStorage: {
    pokerNowHudDisplayMode: 'seat-overlays-leaderboard',
    hudUiPreferences: seatHudPreferences
  }
});
assert.deepStrictEqual(seatHudHarness.evaluationErrors, [], 'production Settings visibility harness starts cleanly');

clickProductionControl(seatHudHarness, '#pnhud-settings-launcher');
assert.strictEqual(seatHudHarness.document.getElementById('pnhud-settings-panel').hidden, false, 'Settings opens from the production launcher');
clickProductionControl(seatHudHarness, '[data-settings-section="overlay"]');

var seatHudPanel = seatHudHarness.document.getElementById('pnhud-settings-panel');
var seatHudCheckbox = seatHudHarness.document.querySelector('.pnhud-settings-overlays-visible');
assert.ok(seatHudCheckbox, 'Overlay renders the Seat HUD visibility checkbox');
assert.ok(seatHudCheckbox.hasAttribute('checked'), 'the rendered checkbox reflects the enabled preference');
assert.match(seatHudPanel.innerHTML, /class="pnhud-settings-overlays-visible"[^>]* checked> Show Seat HUD<\/label>/, 'the visible production checkbox has the exact Show Seat HUD label');
assert.strictEqual(seatHudHarness.document.querySelectorAll('.pnhud-settings-overlays-visible').length, 1, 'the active Settings view contains one Seat HUD visibility control');
assert.ok(seatHudHarness.document.querySelector('.pnhud-seat-hud-source'), 'the nearby Seat HUD Stats control remains available');
assert.ok(seatHudHarness.document.querySelector('.pnhud-settings-opportunity-layout'), 'the nearby opportunity layout control remains available');

changeProductionCheckbox(seatHudHarness, '.pnhud-settings-overlays-visible', false);
assert.strictEqual(seatHudHarness.document.getElementById('pnhud-overlay-root').style.display, 'none', 'turning the production checkbox off hides the Seat HUD layer');
assert.strictEqual(seatHudHarness.storage.hudUiPreferences.seatOverlaysEnabled, false, 'the off state persists through the existing preference');
assert.strictEqual(seatHudHarness.storage.hudUiPreferences.leaderboardEnabled, true, 'the independent leaderboard preference is unchanged');
assert.strictEqual(seatHudHarness.storage.hudUiPreferences.showPotOdds, true, 'the independent Pot Odds preference is unchanged');

clickProductionControl(seatHudHarness, '.pnhud-settings-close');
clickProductionControl(seatHudHarness, '#pnhud-settings-launcher');
assert.ok(seatHudHarness.document.querySelector('[data-settings-content="overlay"]'), 'reopening Settings restores the persisted Overlay section');
assert.ok(!seatHudHarness.document.querySelector('.pnhud-settings-overlays-visible').hasAttribute('checked'), 'reopening Settings reflects the persisted off state');

changeProductionCheckbox(seatHudHarness, '.pnhud-settings-overlays-visible', true);
assert.strictEqual(seatHudHarness.document.getElementById('pnhud-overlay-root').style.display, 'block', 'turning the production checkbox on restores the Seat HUD layer');
assert.strictEqual(seatHudHarness.storage.hudUiPreferences.seatOverlaysEnabled, true, 'the restored state persists through the existing preference');

clickProductionControl(seatHudHarness, '[data-settings-section="general"]');
assert.strictEqual(seatHudHarness.document.querySelectorAll('.pnhud-settings-overlays-visible').length, 0, 'General does not duplicate the Overlay-owned Seat HUD control');
clickProductionControl(seatHudHarness, '[data-settings-section="hud"]');
assert.strictEqual(seatHudHarness.document.querySelectorAll('.pnhud-settings-overlays-visible').length, 0, 'HUD does not duplicate the Overlay-owned Seat HUD control');
assert.ok(seatHudHarness.document.querySelector('.pnhud-settings-leaderboard-visible'), 'the Leaderboard visibility control remains available');
assert.ok(seatHudHarness.document.querySelector('.pnhud-settings-pot-odds'), 'the Pot Odds visibility control remains available');
clickProductionControl(seatHudHarness, '[data-settings-section="overlay"]');
assert.strictEqual(seatHudHarness.document.querySelectorAll('.pnhud-settings-overlays-visible').length, 1, 'returning to Overlay renders exactly one Seat HUD control');

console.log('Dedicated in-page settings architecture and simplified HUD production tests passed.');
