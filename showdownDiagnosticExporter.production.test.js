'use strict';

var assert = require('assert');
var vm = require('vm');
var PokerStats = require('./stats.js');
var harnessSupport = require('./testSupport/productionContentScriptHarness');
var frames = require('./testSupport/showdownPostBreakProductionFrames');

var gameId = 'showdown-diagnostic-production-path';
var keys = harnessSupport.storageKeys(gameId);
var initialStorage = {};
initialStorage[keys.schema] = 4;
initialStorage[keys.playerMap] = { P1: 'P1', P2: 'P2' };
var sharedSessionStorage = {};
var harness = harnessSupport.createHarness({
  gameId: gameId,
  initialStorage: initialStorage,
  sessionStorageBacking: sharedSessionStorage,
  showdownDebugEnabled: true,
  controlledClock: true
});
assert.deepStrictEqual(harness.evaluationErrors, [], 'exact isolated manifest path evaluates with the exporter');
assert.strictEqual(vm.runInContext('typeof PokerNowHUDDebug.exportShowdownDiagnostics', harness.context), 'function', 'runtime exposes diagnostic API');

var successful = frames.initializedPlay('SHOWDOWN-DIAGNOSTIC-SUCCESS');
harnessSupport.dispatchFrames(harness, [successful.registered].concat(successful.completeHandFrames), 'showdown-success', 10000);

function exported() {
  return JSON.parse(vm.runInContext('JSON.stringify(PokerNowHUDDebug.exportShowdownDiagnostics())', harness.context));
}

var output = exported();
var target = output.hands.find(function (hand) {
  return hand.authoritativeHandId === 'SHOWDOWN-DIAGNOSTIC-SUCCESS' || hand.identityAliases.includes('SHOWDOWN-DIAGNOSTIC-SUCCESS');
});
assert.ok(target, 'real content pipeline creates a structured hand capture');
assert.strictEqual(target.finalization.finalized, true, 'semantic finalization is traced');
assert.ok(target.finalizationAttemptIds.length >= 1, 'finalization attempt and reason are traced');
assert.strictEqual(target.reducerInvocationCount, 1, 'showdown reducer invocation is traced once');
assert.deepStrictEqual(target.stablePlayerIds.sort(), ['P1', 'P2']);
assert.deepStrictEqual(target.flopEntrants.sort(), ['P1', 'P2']);
assert.deepStrictEqual(target.showdownMembershipEvidence.participantIds.sort(), ['P1', 'P2']);
assert.strictEqual(target.settlement.observed, true);
assert.strictEqual(target.settlement.retained, true);
assert.strictEqual(target.settlement.terminalPhaseObserved, true);
assert.ok(Object.keys(target.reducerOutputByPlayer).length >= 2, 'per-player WTSD/W$SD decisions are present');
assert.ok(target.attachmentAttemptIds.length >= 2, 'authoritative attachment attempts are present');
assert.ok(Object.keys(target.persistedFinalizedEventFieldsByPlayer).length >= 2, 'persisted finalized event fields are present');
assert.ok(Object.keys(target.aggregatedTotalsAfterByPlayer).length >= 2, 'stats aggregation is present');
assert.ok(Object.keys(target.renderedTotalsByPlayer).length >= 2, 'rendered totals are present');
assert.strictEqual(target.classification, 'counted_correctly', 'successful production path is classified end to end');

var eventsBeforeDuplicate = JSON.stringify(harness.storage[keys.liveEvents]);
var totalsBeforeDuplicate = ['P1', 'P2'].map(function (playerId) {
  var stat = PokerStats.computePlayerStats(harness.storage[keys.liveEvents], playerId);
  return [stat.sawFlopForWTSD, stat.wentToShowdown, stat.showdownsForWSD, stat.wonMoneyAtShowdown];
});
harnessSupport.dispatchFrames(harness, successful.completeHandFrames.slice(-2), 'showdown-success-duplicate', 20000);
var duplicateOutput = exported();
var duplicateTarget = duplicateOutput.hands.find(function (hand) { return hand.identityAliases.includes('SHOWDOWN-DIAGNOSTIC-SUCCESS'); });
assert.ok(duplicateTarget, 'duplicate replay retains the original bounded diagnostic capture');
assert.strictEqual(JSON.stringify(harness.storage[keys.liveEvents]), eventsBeforeDuplicate, 'duplicate settlement does not change persisted events');
var totalsAfterDuplicate = ['P1', 'P2'].map(function (playerId) {
  var stat = PokerStats.computePlayerStats(harness.storage[keys.liveEvents], playerId);
  return [stat.sawFlopForWTSD, stat.wentToShowdown, stat.showdownsForWSD, stat.wonMoneyAtShowdown];
});
assert.deepStrictEqual(totalsAfterDuplicate, totalsBeforeDuplicate, 'duplicate settlement does not change WTSD/W$SD counters');
assert.doesNotThrow(function () { JSON.stringify(duplicateOutput); }, 'production export remains JSON-safe');
assert.ok(!/(?:holeCards|chatContent|rawWebSocket)/i.test(JSON.stringify(duplicateOutput)), 'production export contains no prohibited raw fields');

console.log('Production manifest showdown diagnostics trace finalization through rendering and preserve duplicate neutrality.');
