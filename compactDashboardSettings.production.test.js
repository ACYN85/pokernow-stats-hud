'use strict';

var assert = require('assert');
var fs = require('fs');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var dashboard = require('./playerDashboard.js');

assert.match(css, /#pnhud-player-dashboard \{[^}]*width: min\(560px, calc\(100vw - 24px\)\)/, 'desktop dashboard width is materially reduced from 620px');
assert.match(css, /#pnhud-settings-panel \{[^}]*width: min\(680px, calc\(100vw - 24px\)\)[^}]*height: min\(620px, calc\(100vh - 64px\)\)/, 'Settings is materially reduced from 780 by 680px');
assert.match(css, /pnhud-settings-layout \{[^}]*grid-template-columns: 124px minmax\(0, 1fr\)/, 'sidebar is narrower while preserving a dedicated readable column');
assert.match(css, /pnhud-settings-nav-button \{[^}]*padding: 6px 7px/, 'sidebar labels retain normal typography and usable padding');
assert.match(css, /pnhud-settings-panel main \{[^}]*overflow-y: auto[^}]*padding: 10px 12px 20px/, 'compact Settings content preserves internal scrolling');
assert.match(css, /input\[type="range"\] \{[^}]*width: min\(400px, 100%\);[^}]*min-height: 20px/, 'Appearance sliders remain comfortably usable');
assert.match(css, /pnhud-dashboard-body \{[^}]*overflow: auto[^}]*padding: 8px 10px 14px/, 'dashboard internal scrolling and compact padding coexist');
assert.match(css, /pnhud-dashboard-stat \{[^}]*padding: 5px 4px/, 'stat cards remove unused padding');
assert.match(css, /pnhud-dashboard-stat > strong \{[^}]*font-size: 16px/, 'primary values remain readable');
assert.match(css, /pnhud-dashboard-stat > small \{[^}]*min-height: 2\.2em[^}]*font-size: 8px/, 'exact samples remain present without oversized cards');
assert.match(css, /pnhud-dashboard-profile-fit \{[^}]*repeat\(2,minmax\(0,1fr\)\)[^}]*gap: 2px 10px/, 'profile fits remain complete in a denser two-column grid');
assert.match(css, /pnhud-dashboard-note \{[^}]*min-height: 68px[^}]*resize: vertical/, 'Notes remains usable and resizable at a compact initial height');
assert.match(css, /@media \(min-width: 701px\) and \(max-width: 1280px\)[^{]*\{[^}]*#pnhud-settings-panel[^}]*55vw[^}]*\}[^}]*#pnhud-player-dashboard[^}]*45vw/, 'mid-sized viewports divide available width between coexisting panels');
assert.doesNotMatch(content, /setSettingsOpen\(false, 'player-dashboard-open'\)/, 'opening the dashboard no longer forces Settings closed');
assert.match(content, /pnhud-settings-opacity/);
assert.match(content, /pnhud-settings-panel-opacity/);
assert.match(content, /pnhud-dashboard-opacity/);

var html = dashboard.render({ open: true, playerId: 'p1', displayName: 'Player', mode: 'session', position: null, opponentMode: 'overall', sessionStats: { handsPlayed: 1 }, coreStats: { stats: {}, counters: { hands: 1 }, coverage: { totalHands: 1, positionTrackedHands: 1, matchedHands: 1, tableSizeHands: { HU: 0, '3_TO_5': 0, SIX_PLUS: 1 } } }, relationalStats: {}, profile: { displayedArchetype: 'TAG', rawScores: { TAG: 1, LAG: 0.5, Nit: 0.4, CallingStation: 0.3, Maniac: 0.2, Rock: 0.1, Unknown: 0 } }, note: 'note' });
['Session', 'Career', 'Position', 'Core stats', 'Relational stats', 'Overall', 'Vs You', 'Vs Everyone Else', 'Current profile', 'Profile fit', 'Notes'].forEach(function (label) { assert.ok(html.includes(label), label + ' remains rendered'); });

console.log('Compact dashboard and Settings sizing, density, responsiveness, coexistence, and content preservation tests passed.');
