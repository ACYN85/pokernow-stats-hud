'use strict';
var assert = require('assert');
var harnessSupport = require('./testSupport/productionContentScriptHarness.js');
var frames = require('./testSupport/flopCBetProductionFrames.js');
var careerStore = require('./careerContributionStore.js');

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function create(gameId, storage) {
  var harness = harnessSupport.createHarness({ gameId: gameId, initialStorage: storage, debugEnabled: true, showdownDebugEnabled: true });
  assert.deepStrictEqual(harness.evaluationErrors, [], 'exact production manifest loads the career modules before content.js');
  return harness;
}
function api(harness, expression) { return plain(harness.evaluateInIsolatedWorld(expression)); }
function recordKeys(storage) { return Object.keys(storage).filter(function (key) { return key.indexOf(careerStore.RECORD_PREFIX) === 0; }); }
function pipelineErrors(harness) {
  return harness.logs.filter(function (call) { return call[0] === '[HUD] websocket frame processing error' || call[0] === '[HUD PIPELINE FAILURE]' || call[0] === '[HUD] initialization error'; });
}

var gameId = 'career-production-path';
var keys = harnessSupport.storageKeys(gameId);
var existingSessionEvent = { eventKey: 'old:P1', handId: 'OLD-SESSION-HAND', playerId: 'P1', player: 'P1', action: 'dealt', street: 'preflop', amount: 0, timestamp: 1 };
var storage = {};
storage[keys.schema] = 4;
storage[keys.playerMap] = { P1: 'P1', P2: 'P2' };
storage[keys.liveEvents] = [existingSessionEvent];
storage[keys.finalizedHandIds] = ['OLD-SESSION-HAND'];

var first = create(gameId, storage);
assert.strictEqual(api(first, 'PokerNowHUDCareer.careerLedgerInfo()').ledgerRecordCount, 0, 'upgrade initialization never backfills existing session events');
assert.strictEqual(api(first, 'PokerNowHUDCareer.careerStats("P1")'), null, 'pre-career session aggregate is not imported');

var h1 = frames.ordinaryScenario('deep-bet-fold', 'CAREER-DEEP-H1');
var h1Frames = h1.frames.slice(0, -1);
harnessSupport.dispatchFrames(first, h1Frames.concat([h1.terminalFrame, h1.terminalFrame]), 'career-h1');
assert.deepStrictEqual(pipelineErrors(first), []);
var firstInfo = api(first, 'PokerNowHUDCareer.careerLedgerInfo()');
assert.strictEqual(firstInfo.ledgerRecordCount, 1, '4Bet-pot finalized hand creates one immutable career hand bundle');
assert.strictEqual(firstInfo.meta.firstAcceptedHandKey, 'pokernow|pokernow.com|' + gameId + '|CAREER-DEEP-H1');
assert.strictEqual(recordKeys(first.storage).length, 1);
var firstRecord = first.storage[recordKeys(first.storage)[0]];
assert.strictEqual(firstRecord.authoritativeHandId, 'CAREER-DEEP-H1');
assert.ok(firstRecord.lifecycleHandIds.length === 1 && firstRecord.lifecycleHandIds[0] !== firstRecord.authoritativeHandId, 'lifecycle identity remains an alias while hI owns the durable key');
assert.deepStrictEqual([firstRecord.players.find(function (p) { return p.playerId === 'P1'; }).counters.flopCBetMade, firstRecord.players.find(function (p) { return p.playerId === 'P1'; }).counters.flopCBetOpportunities], [1, 1], 'career consumes the certified final 4-bettor CBet contribution');
assert.deepStrictEqual([firstRecord.players.find(function (p) { return p.playerId === 'P2'; }).counters.foldToFlopCBet, firstRecord.players.find(function (p) { return p.playerId === 'P2'; }).counters.foldToFlopCBetOpportunities], [1, 1]);

var reloaded = create(gameId, first.storage);
assert.strictEqual(api(reloaded, 'PokerNowHUDCareer.careerLedgerInfo()').ledgerRecordCount, 1, 'career ledger hydrates before new frames are accepted');
harnessSupport.dispatchFrames(reloaded, h1Frames.concat([h1.terminalFrame, h1.terminalFrame]), 'career-h1-replay');
assert.deepStrictEqual(pipelineErrors(reloaded), []);
assert.strictEqual(api(reloaded, 'PokerNowHUDCareer.careerLedgerInfo()').ledgerRecordCount, 1, 'reload, reconnect-style replay, and repeated settlement cannot duplicate H1');
assert.strictEqual(api(reloaded, 'PokerNowHUDCareer.careerLedgerInfo()').diagnostics.duplicates, 1, 'new lifecycle alias resolves as a semantic duplicate rather than a conflict');
assert.strictEqual(recordKeys(reloaded.storage).length, 1);

var afterReplay = create(gameId, reloaded.storage);
var h2 = frames.ordinaryScenario('deep-five-bet', 'CAREER-DEEP-H2');
harnessSupport.dispatchFrames(afterReplay, h2.frames.slice(0, -1).concat([h2.terminalFrame]), 'career-h2');
assert.deepStrictEqual(pipelineErrors(afterReplay), []);
var secondInfo = api(afterReplay, 'PokerNowHUDCareer.careerLedgerInfo()');
assert.strictEqual(secondInfo.ledgerRecordCount, 2, 'a new finalized 5Bet-pot hand appends after reload');
assert.strictEqual(recordKeys(afterReplay.storage).length, 2, 'each hand is a separate immutable Chrome-storage item');
var p1 = api(afterReplay, 'PokerNowHUDCareer.careerStats("P1")');
var p2 = api(afterReplay, 'PokerNowHUDCareer.careerStats("P2")');
assert.deepStrictEqual([p1.counters.hands, p2.counters.hands], [2, 2]);
assert.deepStrictEqual([p1.counters.flopCBetMade, p1.counters.flopCBetOpportunities], [1, 1]);
assert.deepStrictEqual([p2.counters.flopCBetMade, p2.counters.flopCBetOpportunities], [1, 1], 'second hand preserves final 5-bettor ownership');
assert.deepStrictEqual(api(afterReplay, 'PokerNowHUDCareer.rebuildCareerStats()'), afterReplay.storage[careerStore.CACHE_KEY].exactAggregate, 'persisted disposable cache equals deterministic replay');
assert.strictEqual(JSON.stringify(afterReplay.storage[careerStore.CACHE_KEY]).includes('percentage'), false, 'no percentage is persisted as authoritative career state');

var finalReload = create(gameId, afterReplay.storage);
assert.strictEqual(api(finalReload, 'PokerNowHUDCareer.careerLedgerInfo()').ledgerRecordCount, 2);
assert.deepStrictEqual(api(finalReload, 'PokerNowHUDCareer.careerStats("P1")').counters, p1.counters, 'second reload rebuilds exact counters from immutable records');
console.log('Production career raw-state lifecycle, deep CBet, persistence, reload, replay, and upgrade-boundary regression passed.');
