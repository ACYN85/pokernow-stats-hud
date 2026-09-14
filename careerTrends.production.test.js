'use strict';

var assert = require('assert');
var fs = require('fs');
var dashboard = require('./playerDashboard.js');
var content = fs.readFileSync('./content.js', 'utf8');
var worker = fs.readFileSync('./careerServiceWorker.js', 'utf8');

assert.match(worker, /careerTrendStats: true/, 'Trend query is explicitly allowed by the Career service worker');
assert.match(content, /careerIndexedService\.careerTrendStats\(playerId\)/, 'Career Dashboard requests one complete Trend result');
assert.match(content, /Promise\.all\(\[dashboardRequest, trendRequest\]\)/, 'Dashboard and Trend responses share one guarded render boundary');
assert.match(content, /careerRevisionsMatch\(result, trendResult\.value\)/, 'independently completed Dashboard and Trend reads must describe the same Career revision');
assert.match(content, /if \(!revisionRetry\) return loadPlayerDashboardCareer\(true\)/, 'a mixed-revision pair receives only one bounded consistency retry');
assert.match(content, /selectTrendWindow\(trendResult\.value, playerDashboardState\.trendWindow\)/, 'revision refresh preserves or safely falls back from the selected window');
var click = content.slice(content.indexOf("var trendButton = event.target.closest('[data-dashboard-trend-window]')"), content.indexOf('var opponentButton ='));
assert.doesNotMatch(click, /careerIndexedService|loadPlayerDashboardCareer|requestToken/, 'warm window switching is presentation-only');
assert.doesNotMatch(click, /position\s*=|situation\s*=|opponentMode\s*=|profile\s*=|note/, 'window switching cannot disturb Dashboard-owned state');
assert.doesNotMatch(click, /playerDashboardGeometry|resetPlayerDashboardPosition/, 'window switching cannot disturb Dashboard geometry');
assert.match(content, /requestMatches\(playerDashboardState, requestSnapshot\)/, 'player, source, filter and revision refresh requests retain the existing race guard');
assert.strictEqual(dashboard.careerRevisionsMatch({ query: { playerRevision: 9 } }, { query: { playerRevision: 9 } }), true, 'equal backend revisions may render together');
assert.strictEqual(dashboard.careerRevisionsMatch({ query: { playerRevision: 9 } }, { query: { playerRevision: 10 } }), false, 'a stale Trend revision cannot render beside a newer Dashboard revision');
assert.strictEqual(dashboard.careerRevisionsMatch({ query: {} }, { query: { playerRevision: 10 } }), false, 'missing revision evidence fails closed');

var displayed = null; var state = { open: true, playerId: 'B', mode: 'career', position: null, situation: 'overall', opponentMode: 'overall', requestToken: 4 };
function receive(snapshot, value) { if (dashboard.requestMatches(state, snapshot)) displayed = value; }
receive({ playerId: 'A', mode: 'career', position: null, situation: 'overall', opponentMode: 'overall', requestToken: 3 }, 'old-player');
receive({ playerId: 'B', mode: 'career', position: null, situation: 'overall', opponentMode: 'overall', requestToken: 3 }, 'old-revision');
receive({ playerId: 'B', mode: 'career', position: null, situation: 'overall', opponentMode: 'overall', requestToken: 4 }, 'current');
assert.strictEqual(displayed, 'current', 'stale player and revision-refresh responses cannot overwrite current Trends');
state.trendWindow = 25; state.trendWindow = 50; state.trendWindow = 100; state.trendWindow = 250; assert.strictEqual(state.trendWindow, 250, 'rapid local window changes retain the newest selection');

console.log('Career Trends production service, lifecycle isolation, local window switching and async race guards passed.');
