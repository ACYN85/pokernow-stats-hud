'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');
var guard = require('./runtimeScope.js');
assert.strictEqual(Object.isFrozen(guard), true, 'runtime scope namespace is immutable');
assert.strictEqual(guard.isSupportedLocation, guard.isPokerNowGamePage, 'legacy semantic alias points to the one standardized function');

assert.strictEqual(guard.isSupportedLocation({ protocol: 'https:', hostname: 'www.pokernow.com', pathname: '/games/table-123' }), true);
assert.strictEqual(guard.isPokerNowGamePage('https://pokernow.com/games/synthetic-game-route'), true, 'exact captured non-www production URL must pass');
assert.strictEqual(guard.isPokerNowGamePage('https://www.pokernow.com/games/synthetic-game-route'), true, 'exact captured production path also passes on www');
assert.strictEqual(guard.isPokerNowGamePage('https://www.pokernow.com/games/table-123/?view=table#seat-2'), true, 'exact game URL with trailing slash, query, and hash must pass');
assert.strictEqual(guard.isPokerNowGamePage({ protocol: 'https:', hostname: 'pokernow.com', pathname: '/games/table-123/' }), true, 'bare production hostname is accepted');
assert.strictEqual(guard.isPokerNowGamePage({ protocol: 'https:', hostname: 'www.pokernow.com', pathname: '/games/' }), false, 'empty game ID is rejected');
assert.strictEqual(guard.isPokerNowGamePage({ protocol: 'https:', hostname: 'www.pokernow.com', pathname: '/games//ledger' }), false, 'empty first path segment is not a game ID');
assert.strictEqual(guard.isSupportedLocation({ protocol: 'https:', hostname: 'www.pokernow.com', pathname: '/' }), false);
assert.strictEqual(guard.isSupportedLocation({ protocol: 'https:', hostname: 'www.pokernow.com', pathname: '/about' }), false);
assert.strictEqual(guard.isSupportedLocation({ protocol: 'https:', hostname: 'example.com', pathname: '/games/table-123' }), false);
assert.strictEqual(guard.isSupportedLocation({ protocol: 'chrome:', hostname: 'newtab', pathname: '/' }), false);

var manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
assert.strictEqual(Object.prototype.hasOwnProperty.call(manifest, 'host_permissions'), false, 'manifest should have no unnecessary host permissions');
manifest.content_scripts.forEach(function (entry) {
  assert.deepStrictEqual(entry.matches, ['https://pokernow.com/games/*', 'https://www.pokernow.com/games/*']);
  assert.strictEqual(entry.js[0], 'runtimeScope.js', 'standard runtime scope must load before every consumer in each execution world');
});
var uiScripts = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); }).js;
assert.ok(uiScripts.indexOf('seatOverlay.js') < uiScripts.indexOf('uiBootstrap.js'), 'display/overlay module loads before UI bootstrap');
assert.ok(uiScripts.indexOf('uiBootstrap.js') < uiScripts.indexOf('content.js'), 'root bootstrap loads before content renderer');

var guardedScripts = ['content.js', 'websocketHook.js', 'stats.js', 'mockData.js', 'parser.js', 'actionInference.js', 'tbTrace.js', 'liveActionPipeline.js', 'handFinalization.js', 'seatOverlay.js', 'uiBootstrap.js'];
guardedScripts.forEach(function (file) {
  assert.match(fs.readFileSync(file, 'utf8'), /PokerNowRuntimeScope/, file + ' must use the standardized runtime scope');
});

function loadSeatOverlayAt(location) {
  var context = { window: { location: location }, location: location, console: { log: function () {} } };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('./runtimeScope.js', 'utf8'), context, { filename: 'runtimeScope.js' });
  vm.runInNewContext(fs.readFileSync('./playerProfileExplanation.js', 'utf8'), context, { filename: 'playerProfileExplanation.js' });
  vm.runInNewContext(fs.readFileSync('./seatOverlay.js', 'utf8'), context, { filename: 'seatOverlay.js' });
  return context.PokerSeatOverlay;
}

assert.ok(loadSeatOverlayAt({ protocol: 'https:', hostname: 'www.pokernow.com', pathname: '/games/table-123' }), 'HUD module should initialize on a PokerNow game URL');
assert.strictEqual(loadSeatOverlayAt({ protocol: 'https:', hostname: 'www.pokernow.com', pathname: '/' }), undefined, 'HUD module must not initialize on PokerNow homepage');
assert.strictEqual(loadSeatOverlayAt({ protocol: 'https:', hostname: 'other.example', pathname: '/games/table-123' }), undefined, 'HUD module must not initialize on another website');
assert.strictEqual(loadSeatOverlayAt({ protocol: 'chrome:', hostname: 'newtab', pathname: '/' }), undefined, 'HUD module must not initialize on New Tab');

var contentSource = fs.readFileSync('./content.js', 'utf8');
assert.match(contentSource, /pokerNowHudDisplayMode/);
assert.doesNotMatch(contentSource, /pokerNowHudLeaderboardOpen/, 'legacy duplicate details-visibility state should remain removed');
assert.match(contentSource, /chrome\.storage\.local\.set\(update\)/, 'display preferences should be persisted in extension storage');

console.log('Shared runtime scope and initialization tests passed.');
