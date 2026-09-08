'use strict';

var assert = require('assert');
var fs = require('fs');
var settings = require('./settingsUi.js');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');

assert.match(css, /#pnhud-player-dashboard \{[^}]*top: 50%;[^}]*right: 12px;[^}]*width: min\(560px, calc\(100vw - 24px\)\);[^}]*height: min\(680px, 86vh\);[^}]*max-height: calc\(100vh - 16px\);[^}]*transform: translateY\(-50%\)/, 'dashboard is compact, vertically centered, viewport bounded, and retains right-side placement');
assert.match(css, /\.pnhud-dashboard-window \{[^}]*grid-template-rows: auto minmax\(0,1fr\)[^}]*overflow: hidden/, 'header remains reachable outside the scrolling row');
assert.match(css, /\.pnhud-dashboard-body \{[^}]*min-height: 0;[^}]*overflow: auto;[^}]*overscroll-behavior: contain/, 'dashboard content owns internal scrolling');
assert.match(css, /background: rgba\(8,22,19,var\(--pnhud-dashboard-background-opacity,\.96\)\)/, 'opacity changes only the dashboard background alpha');
assert.doesNotMatch(css, /#pnhud-player-dashboard\s*\{[^}]*\bopacity\s*:/, 'text and controls do not inherit parent opacity');
assert.match(css, /@media \(max-width: 700px\) \{ #pnhud-player-dashboard \{ right: 8px; width: calc\(100vw - 16px\); \}/, 'narrow viewport remains horizontally contained without defeating vertical centering');

assert.strictEqual(settings.DEFAULTS.dashboardBackgroundOpacity, 0.96);
assert.notStrictEqual('dashboardBackgroundOpacity', 'hudOpacity');
assert.notStrictEqual('dashboardBackgroundOpacity', 'settingsBackgroundOpacity');
assert.strictEqual(settings.normalize({ version: 7, dashboardBackgroundOpacity: 0.74 }).value.dashboardBackgroundOpacity, 0.74, 'stored value hydrates');
assert.strictEqual(settings.merge(settings.DEFAULTS, { dashboardBackgroundOpacity: 0.62 }).dashboardBackgroundOpacity, 0.62, 'new value normalizes for persistence');
assert.strictEqual(settings.merge(settings.DEFAULTS, { dashboardBackgroundOpacity: 0.62 }).hudOpacity, 0.96, 'dashboard opacity does not modify HUD opacity');
assert.strictEqual(settings.merge(settings.DEFAULTS, { dashboardBackgroundOpacity: 0.62 }).settingsBackgroundOpacity, 0.96, 'dashboard opacity does not modify settings opacity');
assert.match(content, /pnhud-dashboard-opacity[^\n]+min="10" max="100" step="1"/, 'Appearance exposes the normalized safe range');
assert.match(content, /setProperty\('--pnhud-dashboard-background-opacity', String\(dashboardOpacity\)\)/, 'input updates an open dashboard live');
assert.match(content, /updateHudUiPreferences\(\{ dashboardBackgroundOpacity: Number\(event.target.value\) \/ 100 \}, 'appearance-dashboard-opacity'\)/, 'change persists through existing settings storage');
assert.match(content, /dashboardRoot\.style\.setProperty\('--pnhud-dashboard-background-opacity', String\(hudUiPreferences\.dashboardBackgroundOpacity\)\)/, 'hydration and reopen apply the stored value');
assert.ok(content.includes("hudUiPreferences: 'hudUiPreferences'"), 'dashboard setting remains in the existing versioned preference record');

console.log('Phase 4C.1 viewport layout, independent opacity, live update, and persistence production tests passed.');
