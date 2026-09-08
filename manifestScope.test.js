'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');

var manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
assert.strictEqual(manifest.background.service_worker, 'careerServiceWorker.js', 'extension-origin career storage has one MV3 service worker owner');
manifest.content_scripts.forEach(function (entry) {
  assert.deepStrictEqual(entry.matches, ['https://pokernow.com/games/*', 'https://www.pokernow.com/games/*']);
  assert.strictEqual(entry.js[0], 'runtimeScope.js');
  assert.ok(!entry.matches.includes('<all_urls>'));
});

var consoleCalls = [];
var newTabLocation = { hostname: 'newtab', pathname: '/', origin: 'chrome://newtab' };
var contentContext = {
  location: newTabLocation,
  window: { location: newTabLocation },
  console: { log: function () { consoleCalls.push(Array.from(arguments)); }, error: function () { consoleCalls.push(Array.from(arguments)); } }
};
vm.runInNewContext(fs.readFileSync('./content.js', 'utf8'), contentContext, { filename: 'content.js' });
assert.ok(consoleCalls.some(function (call) { return call[0] === '[HUD UI BOOT ABORT]'; }), 'a manually invoked out-of-scope content script reports its guard abort');
assert.ok(!consoleCalls.some(function (call) { return call[0] === '[HUD UI BOOT 3] UI initialization started'; }), 'content UI initialization must not start on New Tab');

var websocketWindow = { location: newTabLocation };
vm.runInNewContext(fs.readFileSync('./websocketHook.js', 'utf8'), { window: websocketWindow }, { filename: 'websocketHook.js' });
assert.strictEqual(websocketWindow.__POKERNOW_HUD_WEBSOCKET_HOOKED__, undefined, 'WebSocket hook must not install on New Tab');

var pipelineWindow = { location: newTabLocation };
vm.runInNewContext(fs.readFileSync('./liveActionPipeline.js', 'utf8'), { window: pipelineWindow, globalThis: pipelineWindow }, { filename: 'liveActionPipeline.js' });
assert.strictEqual(pipelineWindow.PokerLiveActionPipeline, undefined, 'live action pipeline must not install on New Tab');

var traceWindow = { location: newTabLocation };
vm.runInNewContext(fs.readFileSync('./tbTrace.js', 'utf8'), { window: traceWindow, globalThis: traceWindow }, { filename: 'tbTrace.js' });
assert.strictEqual(traceWindow.PokerTbTrace, undefined, 'tB trace module must not install on New Tab');

var handWindow = { location: newTabLocation };
vm.runInNewContext(fs.readFileSync('./handFinalization.js', 'utf8'), { window: handWindow, globalThis: handWindow }, { filename: 'handFinalization.js' });
assert.strictEqual(handWindow.PokerHandFinalization, undefined, 'hand finalization module must not install on New Tab');

var ledgerEntries = manifest.content_scripts.filter(function (entry) { return entry.js.includes('semanticHandLedger.js'); });
assert.strictEqual(ledgerEntries.length, 1, 'the semantic shadow ledger is injected exactly once');
assert.ok(!ledgerEntries[0].world || ledgerEntries[0].world === 'ISOLATED', 'the semantic shadow ledger belongs to the isolated content-script world');
var ledgerWindow = { location: newTabLocation };
ledgerWindow.window = ledgerWindow;
ledgerWindow.globalThis = ledgerWindow;
vm.runInNewContext(fs.readFileSync('./semanticHandLedger.js', 'utf8'), ledgerWindow, { filename: 'semanticHandLedger.js' });
assert.strictEqual(ledgerWindow.PokerSemanticHandLedger, undefined, 'semantic shadow ledger must not install on New Tab');

var reducerEntries = manifest.content_scripts.filter(function (entry) { return entry.js.includes('preflopOpportunityReducer.js'); });
assert.strictEqual(reducerEntries.length, 1, 'the shadow preflop reducer is injected exactly once');
assert.ok(!reducerEntries[0].world || reducerEntries[0].world === 'ISOLATED', 'the shadow preflop reducer belongs to the isolated content-script world');
var reducerWindow = { location: newTabLocation };
reducerWindow.window = reducerWindow;
reducerWindow.globalThis = reducerWindow;
vm.runInNewContext(fs.readFileSync('./preflopOpportunityReducer.js', 'utf8'), reducerWindow, { filename: 'preflopOpportunityReducer.js' });
assert.strictEqual(reducerWindow.PokerPreflopOpportunityReducer, undefined, 'shadow preflop reducer must not install on New Tab');

var flopReducerEntries = manifest.content_scripts.filter(function (entry) { return entry.js.includes('flopCBetOpportunityReducer.js'); });
assert.strictEqual(flopReducerEntries.length, 1, 'the shadow flop CBet reducer is injected exactly once');
assert.ok(!flopReducerEntries[0].world || flopReducerEntries[0].world === 'ISOLATED', 'the shadow flop CBet reducer belongs to the isolated content-script world');
var flopReducerWindow = { location: newTabLocation };
flopReducerWindow.window = flopReducerWindow;
flopReducerWindow.globalThis = flopReducerWindow;
vm.runInNewContext(fs.readFileSync('./flopCBetOpportunityReducer.js', 'utf8'), flopReducerWindow, { filename: 'flopCBetOpportunityReducer.js' });
assert.strictEqual(flopReducerWindow.PokerFlopCBetOpportunityReducer, undefined, 'shadow flop CBet reducer must not install on New Tab');

var showdownReducerEntries = manifest.content_scripts.filter(function (entry) { return entry.js.includes('showdownStatsReducer.js'); });
assert.strictEqual(showdownReducerEntries.length, 1, 'the shadow showdown reducer is injected exactly once');
assert.ok(!showdownReducerEntries[0].world || showdownReducerEntries[0].world === 'ISOLATED', 'the shadow showdown reducer belongs to the isolated content-script world');
var showdownReducerWindow = { location: newTabLocation };
showdownReducerWindow.window = showdownReducerWindow;
showdownReducerWindow.globalThis = showdownReducerWindow;
vm.runInNewContext(fs.readFileSync('./showdownStatsReducer.js', 'utf8'), showdownReducerWindow, { filename: 'showdownStatsReducer.js' });
assert.strictEqual(showdownReducerWindow.PokerShowdownStatsReducer, undefined, 'shadow showdown reducer must not install on New Tab');

var careerEntries = manifest.content_scripts.filter(function (entry) { return entry.js.includes('careerStatsAggregator.js') || entry.js.includes('careerContributionStore.js') || entry.js.includes('careerIndexedStore.js'); });
assert.strictEqual(careerEntries.length, 1, 'both career foundation modules belong to one isolated-world manifest entry');
assert.ok(!careerEntries[0].world || careerEntries[0].world === 'ISOLATED');
assert.strictEqual(careerEntries[0].js.filter(function (file) { return file === 'careerStatsAggregator.js'; }).length, 1);
assert.strictEqual(careerEntries[0].js.filter(function (file) { return file === 'careerContributionStore.js'; }).length, 1);
assert.strictEqual(careerEntries[0].js.filter(function (file) { return file === 'careerIndexedStore.js'; }).length, 1);
var careerWindow = { location: newTabLocation, PokerNowRuntimeScope: { isPokerNowGamePage: function () { return false; } } };
careerWindow.window = careerWindow; careerWindow.globalThis = careerWindow;
vm.runInNewContext(fs.readFileSync('./careerStatsAggregator.js', 'utf8'), careerWindow, { filename: 'careerStatsAggregator.js' });
vm.runInNewContext(fs.readFileSync('./careerContributionStore.js', 'utf8'), careerWindow, { filename: 'careerContributionStore.js' });
vm.runInNewContext(fs.readFileSync('./careerIndexedStore.js', 'utf8'), careerWindow, { filename: 'careerIndexedStore.js' });
assert.strictEqual(careerWindow.PokerCareerStatsAggregator, undefined, 'career aggregation must not install on New Tab');
assert.strictEqual(careerWindow.PokerCareerContributionStore, undefined, 'career storage must not install on New Tab');
assert.strictEqual(careerWindow.PokerCareerIndexedStore, undefined, 'indexed career storage must not install on New Tab');

var explanationEntries = manifest.content_scripts.filter(function (entry) { return entry.js.includes('statExplanation.js'); });
assert.strictEqual(explanationEntries.length, 1, 'stat explanations are injected exactly once');
assert.ok(!explanationEntries[0].world || explanationEntries[0].world === 'ISOLATED', 'stat explanations belong to the isolated content-script world');
var explanationWindow = { location: newTabLocation };
explanationWindow.window = explanationWindow;
explanationWindow.globalThis = explanationWindow;
vm.runInNewContext(fs.readFileSync('./statExplanation.js', 'utf8'), explanationWindow, { filename: 'statExplanation.js' });
assert.strictEqual(explanationWindow.PokerHandStatExplanation, undefined, 'stat explanations must not install on New Tab');

var inspectorEntries = manifest.content_scripts.filter(function (entry) { return entry.js.includes('handStatInspector.js'); });
assert.strictEqual(inspectorEntries.length, 1, 'the Hand Stat Inspector is injected exactly once');
assert.ok(!inspectorEntries[0].world || inspectorEntries[0].world === 'ISOLATED', 'the Hand Stat Inspector belongs to the isolated content-script world');
var inspectorWindow = { location: newTabLocation };
inspectorWindow.window = inspectorWindow;
inspectorWindow.globalThis = inspectorWindow;
vm.runInNewContext(fs.readFileSync('./handStatInspector.js', 'utf8'), inspectorWindow, { filename: 'handStatInspector.js' });
assert.strictEqual(inspectorWindow.PokerHandStatInspector, undefined, 'the Hand Stat Inspector must not install on New Tab');

var profileInspectorEntries = manifest.content_scripts.filter(function (entry) { return entry.js.includes('playerProfileScoreInspector.js'); });
assert.strictEqual(profileInspectorEntries.length, 1, 'the profile score inspector is injected exactly once');
assert.ok(!profileInspectorEntries[0].world || profileInspectorEntries[0].world === 'ISOLATED', 'the profile score inspector belongs to the isolated content-script world');
var profileInspectorWindow = { location: newTabLocation };
profileInspectorWindow.window = profileInspectorWindow;
profileInspectorWindow.globalThis = profileInspectorWindow;
vm.runInNewContext(fs.readFileSync('./playerProfileScoreInspector.js', 'utf8'), profileInspectorWindow, { filename: 'playerProfileScoreInspector.js' });
assert.strictEqual(profileInspectorWindow.PokerPlayerProfileScoreInspector, undefined, 'the profile score inspector must not install on New Tab');

console.log('Manifest scope and New Tab runtime guards passed.');
