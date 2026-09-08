'use strict';

var assert = require('assert');
var settings = require('./settingsUi.js');

var missing = settings.normalize(undefined);
assert.deepStrictEqual(missing.value, {
  version: 11,
  settingsOpen: false,
  selectedSettingsSection: 'general',
  hudOpacity: 0.96,
  settingsBackgroundOpacity: 0.96,
  dashboardBackgroundOpacity: 0.96,
  accentTheme: 'teal',
  hudSize: 'default',
  opportunityStatsLayout: 'combined',
  seatHudStatSource: 'session',
  leaderboardStatSource: 'session',
  showPlayerProfiles: true,
  showPotOdds: true,
  potOddsOffsetX: 0,
  potOddsOffsetY: 0,
  seatOverlaysEnabled: true,
  leaderboardEnabled: false,
  developerToolsVisible: false,
  leaderboardCollapsedByDefault: false
});
assert.strictEqual(missing.defaultUsed, true);

var valid = settings.normalize({
  version: 2,
  settingsOpen: true,
  selectedSettingsSection: 'overlay',
  hudOpacity: 0.72,
  settingsBackgroundOpacity: 0.61,
  dashboardBackgroundOpacity: 0.73,
  accentTheme: 'purple',
  hudSize: 'large',
  developerToolsVisible: true,
  leaderboardCollapsedByDefault: true
});
assert.strictEqual(valid.defaultUsed, false);
assert.strictEqual(valid.value.hudOpacity, 0.72);
assert.strictEqual(valid.value.settingsBackgroundOpacity, 0.61);
assert.strictEqual(valid.value.dashboardBackgroundOpacity, 0.73);
assert.strictEqual(valid.value.accentTheme, 'purple');
assert.strictEqual(valid.value.selectedSettingsSection, 'overlay');
assert.strictEqual(valid.value.opportunityStatsLayout, 'combined', 'v2 preferences safely gain the Combined default');
assert.strictEqual(valid.value.showPlayerProfiles, true, 'older preferences safely gain visible player profiles by default');
assert.strictEqual(valid.migratedFromVersion, 2);

var stacked = settings.normalize(Object.assign({}, valid.value, { version: 10, opportunityStatsLayout: 'stacked', seatHudStatSource: 'career', showPlayerProfiles: false, showPotOdds: false, potOddsOffsetX: -40, potOddsOffsetY: 20 }));
assert.strictEqual(stacked.value.opportunityStatsLayout, 'stacked');
assert.strictEqual(stacked.value.seatHudStatSource, 'career');
assert.strictEqual(stacked.value.showPlayerProfiles, false);
assert.strictEqual(stacked.value.showPotOdds, false);
assert.strictEqual(stacked.value.potOddsOffsetX, -40);
assert.strictEqual(stacked.value.potOddsOffsetY, 20);
assert.strictEqual(stacked.value.seatOverlaysEnabled, true);
assert.strictEqual(stacked.value.leaderboardEnabled, false);
assert.strictEqual(stacked.migratedFromVersion, 10);

var invalid = settings.normalize({
  version: 2,
  settingsOpen: 'yes',
  selectedSettingsSection: 'unknown',
  hudOpacity: 2,
  settingsBackgroundOpacity: 0.05,
  dashboardBackgroundOpacity: 1.5,
  accentTheme: 'neon',
  hudSize: 'huge',
  opportunityStatsLayout: 'wide',
  developerToolsVisible: null
});
assert.strictEqual(invalid.value.settingsOpen, false);
assert.strictEqual(invalid.value.selectedSettingsSection, 'general');
assert.strictEqual(invalid.value.hudOpacity, 0.96);
assert.strictEqual(invalid.value.settingsBackgroundOpacity, 0.1);
assert.strictEqual(invalid.value.dashboardBackgroundOpacity, 1);
assert.strictEqual(invalid.value.accentTheme, 'teal');
assert.strictEqual(invalid.value.hudSize, 'default');
assert.strictEqual(invalid.value.opportunityStatsLayout, 'combined');
assert.ok(invalid.invalidFields.includes('hudOpacity'));
assert.ok(invalid.invalidFields.includes('settingsBackgroundOpacity'));
assert.ok(invalid.invalidFields.includes('dashboardBackgroundOpacity'));
assert.ok(invalid.invalidFields.includes('accentTheme'));
assert.ok(invalid.invalidFields.includes('opportunityStatsLayout'));

var merged = settings.merge(missing.value, { selectedSettingsSection: 'diagnostics', hudOpacity: 0.4, accentTheme: 'amber' });
assert.strictEqual(merged.selectedSettingsSection, 'diagnostics');
assert.strictEqual(merged.hudOpacity, 0.4);
assert.strictEqual(merged.accentTheme, 'amber');
assert.strictEqual(settings.equal(merged, settings.merge(merged, {})), true);
assert.strictEqual(settings.equal(merged, missing.value), false);
assert.deepStrictEqual(settings.SECTIONS, ['general', 'overlay', 'hud', 'appearance', 'career-data', 'diagnostics', 'about']);
assert.deepStrictEqual(Object.keys(settings.ACCENT_THEMES), ['teal', 'blue', 'purple', 'amber']);
assert.deepStrictEqual(settings.OPPORTUNITY_STATS_LAYOUTS, ['combined', 'stacked']);
assert.deepStrictEqual(settings.SEAT_HUD_STAT_SOURCES, ['session', 'career']);
assert.strictEqual(settings.normalize(Object.assign({}, missing.value, { hudOpacity: 0.1 })).value.hudOpacity, 0.1);
assert.strictEqual(settings.normalize(Object.assign({}, missing.value, { hudOpacity: 0.09 })).value.hudOpacity, 0.96);
assert.strictEqual(settings.normalize(Object.assign({}, missing.value, { settingsBackgroundOpacity: 0.1 })).value.settingsBackgroundOpacity, 0.1);
assert.strictEqual(settings.normalize(Object.assign({}, missing.value, { settingsBackgroundOpacity: 1 })).value.settingsBackgroundOpacity, 1);
assert.strictEqual(settings.normalize(Object.assign({}, missing.value, { settingsBackgroundOpacity: 1.01 })).value.settingsBackgroundOpacity, 1);
assert.strictEqual(settings.normalize(Object.assign({}, missing.value, { dashboardBackgroundOpacity: 0.1 })).value.dashboardBackgroundOpacity, 0.1);
assert.strictEqual(settings.normalize(Object.assign({}, missing.value, { dashboardBackgroundOpacity: 1.01 })).value.dashboardBackgroundOpacity, 1);
var migratedV1 = settings.normalize({
  version: 1,
  settingsOpen: true,
  selectedSettingsSection: 'appearance',
  hudOpacity: 0.35,
  accentTheme: 'purple',
  hudSize: 'small',
  developerToolsVisible: true,
  leaderboardCollapsedByDefault: true
});
assert.strictEqual(migratedV1.value.version, 11);
assert.strictEqual(migratedV1.value.settingsBackgroundOpacity, 0.96);
assert.strictEqual(migratedV1.value.dashboardBackgroundOpacity, 0.96);
assert.strictEqual(migratedV1.value.hudOpacity, 0.35);
assert.strictEqual(migratedV1.value.accentTheme, 'purple');
assert.strictEqual(migratedV1.value.hudSize, 'small');
assert.strictEqual(migratedV1.value.opportunityStatsLayout, 'combined');
assert.strictEqual(migratedV1.value.seatHudStatSource, 'session');
assert.strictEqual(migratedV1.value.showPlayerProfiles, true);
assert.strictEqual(migratedV1.value.showPotOdds, true);
assert.strictEqual(migratedV1.value.potOddsOffsetX, 0);
assert.strictEqual(migratedV1.value.potOddsOffsetY, 0);
assert.strictEqual(migratedV1.migratedFromVersion, 1);
assert.ok(settings.SIZE_PRESETS.small.minWidth < settings.SIZE_PRESETS.default.minWidth);
assert.ok(settings.SIZE_PRESETS.small.maxWidth < settings.SIZE_PRESETS.default.maxWidth);
assert.ok(settings.SIZE_PRESETS.large.maxWidth <= 640, 'large remains desktop viewport-safe');

console.log('Settings UI preference normalization tests passed.');
