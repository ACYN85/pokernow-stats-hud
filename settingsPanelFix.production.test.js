'use strict';

var assert = require('assert');
var fs = require('fs');
var settings = require('./settingsUi.js');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');

assert.ok(css.includes('#pnhud-settings-launcher { position: fixed; z-index: 2147483646; top: 12px; left: 4px;'), 'launcher shifts left from 12px to 4px');
assert.ok(css.includes('max-width: calc(100vw - 8px)'), 'launcher stays within the viewport');
assert.strictEqual((content.match(/settingsLauncher = document\.createElement\('button'\)/g) || []).length, 1, 'one launcher creation owner remains');
assert.ok(content.includes('launcherDefaultOffset: { top: 12, left: 4 }'));
assert.ok(content.includes('launcherOverlapsPokerNowLogo()'));

assert.strictEqual(settings.DEFAULTS.settingsBackgroundOpacity, 0.96);
assert.strictEqual(settings.normalize(Object.assign({}, settings.DEFAULTS, { settingsBackgroundOpacity: 0.1 })).value.settingsBackgroundOpacity, 0.1);
assert.strictEqual(settings.normalize(Object.assign({}, settings.DEFAULTS, { settingsBackgroundOpacity: 1 })).value.settingsBackgroundOpacity, 1);
assert.ok(content.includes("settingsPanel.style.setProperty('--pnhud-settings-background-opacity'"), 'range input applies settings opacity immediately');
assert.ok(content.includes("updateHudUiPreferences({ settingsBackgroundOpacity:"), 'settings opacity persists through shared UI preferences');
assert.ok(css.includes('background: rgba(8, 22, 19, var(--pnhud-settings-background-opacity, .96))'));
assert.ok(!/#pnhud-settings-panel\s*\{[^}]*\bopacity\s*:/.test(css));

assert.ok(css.includes('height: min(620px, calc(100vh - 64px))'), 'compact settings shell has a definite viewport-constrained height');
assert.ok(css.includes('grid-template-rows: auto minmax(0, 1fr)'), 'fixed header owns the first grid row');
assert.ok(css.includes('grid-template-columns: 124px minmax(0, 1fr)'), 'compact fixed sidebar owns the first grid column');
assert.ok(css.includes('.pnhud-settings-layout { display: grid;'));
assert.ok(css.includes('min-height: 0; height: 100%; overflow: hidden;'), 'nested grid can shrink to form the scrollport');
assert.ok(css.includes('overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable;'), 'right content pane exclusively scrolls and contains wheel chaining');
assert.ok(css.includes('padding: 10px 12px 20px'), 'final diagnostics controls retain bottom reachability in the compact pane');
assert.ok(content.includes('contentPaneCanScroll: canScroll'));
assert.ok(content.includes('contentPaneScrollHeight'));
assert.ok(content.includes('settingsUiDiagnostics.activeSection = layoutDiagnostics.activeSection'));
assert.strictEqual((content.match(/settingsPanel = document\.createElement\('section'\)/g) || []).length, 1, 'settings panel is not duplicated');
assert.ok(content.includes("settingsPanel.dataset.pnhudSettingsBound !== 'true'"), 'delegated listeners remain singular after recovery');

console.log('Launcher placement, independent settings opacity, and generic settings scroll ownership tests passed.');
