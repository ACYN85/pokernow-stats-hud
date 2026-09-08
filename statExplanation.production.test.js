'use strict';

var assert = require('assert');
var manifest = require('./manifest.json');
var harnessSupport = require('./testSupport/productionContentScriptHarness');
var frames = require('./testSupport/flopCBetProductionFrames');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

var gameId = 'stat-explanation-production';
var keys = harnessSupport.storageKeys(gameId);
var initialStorage = {};
initialStorage[keys.schema] = 4;
initialStorage[keys.playerMap] = { P1: 'P1', P2: 'P2' };

var harness = harnessSupport.createHarness({ gameId: gameId, initialStorage: initialStorage });
assert.deepStrictEqual(harness.evaluationErrors, [], 'the explanation API loads in exact production manifest order');
var api = harness.context.PokerNowHUDProfiles;
assert.ok(api, 'PokerNowHUDProfiles exists in the isolated content-script world');
assert.strictEqual(typeof api.lastHandStatExplanation, 'function');
assert.strictEqual(typeof api.handStatExplanation, 'function');
assert.strictEqual(typeof api.handStatExplanations, 'function');
assert.strictEqual(typeof api.explainLastHand, 'function');
assert.strictEqual(api.lastHandStatExplanation(), null, 'no explanation exists before a finalized hand');

var scenario = frames.ordinaryScenario('bet-call', 'AUTH-STAT-EXPLANATION');
harnessSupport.dispatchFrames(harness, scenario.frames, 'stat-explanation');
var pipelineErrors = harness.logs.filter(function (call) {
  return call[0] === '[HUD] websocket frame processing error' || call[0] === '[HUD PIPELINE FAILURE]' || call[0] === '[HUD] initialization error';
});
assert.deepStrictEqual(pipelineErrors, []);

var latest = plain(api.lastHandStatExplanation());
assert.ok(latest);
assert.strictEqual(latest.handId, scenario.handId);
assert.ok(latest.lifecycleHandId && latest.lifecycleHandId !== latest.handId, 'both authoritative and lifecycle identities are retained');
assert.strictEqual(latest.players.P1.flopCBet.semanticContribution, '1/1');
assert.strictEqual(latest.players.P1.flopCBet.counterContribution, '1/1');
assert.strictEqual(latest.players.P1.flopCBet.reasonCode, 'final_preflop_aggressor_bet_flop');
assert.ok(/^flop-cbet:/.test(latest.players.P1.flopCBet.contributionId), 'the persisted contribution ID is correlated');
assert.strictEqual(latest.players.P2.foldToFlopCBet.semanticContribution, '0/1');
assert.strictEqual(latest.players.P2.foldToFlopCBet.counterContribution, '0/1');
assert.strictEqual(latest.players.P2.foldToFlopCBet.reasonCode, 'direct_call_to_qualifying_cbet');
assert.strictEqual(latest.players.P2.foldToFlopCBet.attachment.attached, true);
assert.strictEqual(latest.players.P2.wsd.semanticContribution, null, 'unsupported production showdown evidence remains semantically null');
assert.strictEqual(latest.players.P2.wsd.counterContribution, '0/0', 'unsupported W$SD evidence changes no persisted counter');
assert.strictEqual(latest.players.P2.wsd.status, 'unsupported');

assert.deepStrictEqual(plain(api.handStatExplanation(latest.handId)), latest, 'lookup accepts the authoritative hand ID');
assert.deepStrictEqual(plain(api.handStatExplanation(latest.lifecycleHandId)), latest, 'lookup accepts the lifecycle hand ID');
assert.strictEqual(plain(api.handStatExplanations()).length, 1);
assert.ok(plain(api.explainLastHand()).some(function (line) { return line.includes('P2: FCB 0/1'); }));
assert.doesNotThrow(function () { JSON.stringify(latest); });
assert.strictEqual(JSON.stringify(latest).includes('cards'), false, 'the API does not expose card values');
assert.strictEqual(/rawPayload|socketUrl|websocket-frame/.test(JSON.stringify(latest)), false, 'the API does not expose transport objects');

harnessSupport.dispatchFrames(harness, [scenario.terminalFrame, scenario.nextFrame], 'stat-explanation-duplicate');
assert.strictEqual(plain(api.handStatExplanations()).length, 1, 'duplicate terminal replay cannot duplicate an explanation');

var stored = harness.storage[keys.liveEvents] || [];
var p1 = harness.context.PokerStats.computePlayerStatsByIdentity(stored, 'P1', 'P1');
var p2 = harness.context.PokerStats.computePlayerStatsByIdentity(stored, 'P2', 'P2');
assert.deepStrictEqual([p1.flopCBetMade, p1.flopCBetOpportunities, p2.foldToFlopCBet, p2.foldToFlopCBetOpportunities], [1, 1, 0, 1], 'read-only explanations do not change counters');
assert.strictEqual(Object.keys(harness.storage).some(function (key) { return /statExplanation|handExplanation/i.test(key); }), false, 'no explanation storage key is created');

var isolated = manifest.content_scripts.find(function (entry) { return entry.world !== 'MAIN' && entry.js.includes('content.js'); });
var main = manifest.content_scripts.find(function (entry) { return entry.world === 'MAIN'; });
assert.ok(isolated.js.indexOf('statExplanation.js') > isolated.js.indexOf('showdownStatsReducer.js'));
assert.ok(isolated.js.indexOf('statExplanation.js') < isolated.js.indexOf('content.js'));
assert.strictEqual(main.js.includes('statExplanation.js'), false, 'no MAIN-world bridge is added');

console.log('Production finalized-hand statistic explanation API, identity lookup, exact IDs, read-only neutrality, and manifest isolation passed.');
