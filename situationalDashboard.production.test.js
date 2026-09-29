'use strict';

var assert = require('assert');
var fs = require('fs');
var dashboard = require('./playerDashboard.js');
var content = fs.readFileSync('./content.js', 'utf8');

assert.match(content, /function dashboardScopeFilters\(\)[\s\S]*?situation === 'ip'[\s\S]*?situation === 'oop'[\s\S]*?\{ situation: playerDashboardState\.situation \}/, 'Session queries use the exact situation scope');
assert.match(content, /careerDashboardStats\(playerId, \{[\s\S]*?position: position,[\s\S]*?situation: situation,[\s\S]*?opponentMode: opponentMode/, 'Career requests carry situation in the combined dashboard query');
assert.match(content, /annotateSessionEventRange\([\s\S]*?showdownReductionResult && showdownReductionResult\.contribution\s*\)/, 'Session events receive certified showdown evidence for exact IP\/OOP annotation');
assert.match(content, /playerDashboardState\.overallPosition = playerDashboardState\.position;\s*playerDashboardState\.position = null;/, 'entering IP\/OOP preserves and clears the Overall-only position selection');
assert.match(content, /playerDashboardState\.position = playerDashboardState\.overallPosition \|\| null;\s*playerDashboardState\.overallPosition = null;/, 'returning to Overall restores the prior position selection');
assert.match(content, /requestSnapshot = \{[^}]*situation: situation/, 'async Career snapshots include situation');
assert.doesNotMatch(content.slice(content.indexOf('function savePlayerDashboardNote'), content.indexOf('function clearPlayerDashboardNote')), /situation|dashboardScopeFilters/, 'notes remain independent of situation');
assert.match(content, /playerDashboardState\.profile = bucket && coreCounters/, 'Session profile uses the selected exact population');
assert.match(content, /playerDashboardState\.profile = result\.profileStats/, 'Career profile uses the cached selected projection');
var modeHandler = content.slice(content.indexOf('var modeButton ='), content.indexOf('var opponentButton ='));
assert.doesNotMatch(modeHandler, /situation\s*=/, 'Session\/Career switching preserves the selected situation');

function snapshot(playerId, situation, token) { return { playerId: playerId, mode: 'career', position: null, situation: situation, opponentMode: 'overall', requestToken: token }; }
var state = Object.assign({ open: true }, snapshot('A', 'oop', 3));
var displayed = null;
function receive(request, value) { if (dashboard.requestMatches(state, request)) displayed = value; }
var releaseIp; var releaseA;
var oldIp = new Promise(function (resolve) { releaseIp = resolve; }).then(function () { receive(snapshot('A', 'ip', 1), 'old-ip'); });
var oldPlayer = new Promise(function (resolve) { releaseA = resolve; }).then(function () { receive(snapshot('A', 'oop', 2), 'old-player'); });
receive(snapshot('A', 'oop', 3), 'new-oop');
releaseIp(); releaseA();
Promise.all([oldIp, oldPlayer]).then(function () {
  assert.strictEqual(displayed, 'new-oop', 'rapid situation changes and a stale player request cannot overwrite the newest view');
  state = Object.assign({ open: true }, snapshot('B', 'ip', 4));
  receive(snapshot('A', 'ip', 4), 'wrong-player');
  assert.notStrictEqual(displayed, 'wrong-player', 'player A response cannot overwrite player B');
  console.log('Situational Dashboard production wiring, position restoration, finalized provenance and async race isolation passed.');
}).catch(function (error) { console.error(error); process.exit(1); });
