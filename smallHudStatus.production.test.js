'use strict';

var assert = require('assert');
var fs = require('fs');
var settings = require('./settingsUi.js');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');

assert.ok(content.includes('<span class="pnhud-status-area"><span class="pnhud-demo">Connecting\\u2026</span></span>'), 'the connecting bootstrap badge uses the status group');
assert.ok(content.includes('<span class="pnhud-status-area"><span class="pnhud-demo">\' + dataLabel + \'</span></span>'), 'live status uses the same generic status group');
assert.ok(/\.pnhud-status-area\s*\{[^}]*display:\s*inline-flex;[^}]*flex-wrap:\s*wrap;/s.test(css), 'multiple badges group together and may wrap only between badges');
assert.ok(/\.pnhud-demo\s*\{[^}]*white-space:\s*nowrap;/s.test(css), 'badge text can never wrap internally');
assert.ok(/\.pnhud-size-small \.pnhud-status-area\s*\{[^}]*flex-wrap:\s*nowrap;/s.test(css), 'Small keeps two badges on one row');
assert.ok(/\.pnhud-size-small \.pnhud-demo\s*\{[^}]*padding:\s*1px 3px;[^}]*letter-spacing:\s*\.3px;/s.test(css), 'Small uses compact badge spacing');

var small = settings.SIZE_PRESETS.small;
var normal = settings.SIZE_PRESETS.default;
var large = settings.SIZE_PRESETS.large;
assert.ok(small.minWidth < normal.minWidth && small.maxWidth < normal.maxWidth, 'Small remains substantially smaller than Default');
assert.deepStrictEqual(normal, { baseWidth: 170, perStatWidth: 64, minWidth: 320, maxWidth: 520 }, 'Default sizing remains unchanged');
assert.deepStrictEqual(large, { baseWidth: 200, perStatWidth: 76, minWidth: 380, maxWidth: 640 }, 'Large sizing remains unchanged');

console.log('Small HUD generic status grouping, no-wrap, and size isolation tests passed.');
