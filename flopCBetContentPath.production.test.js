'use strict';

var assert = require('assert');
var harnessSupport = require('./testSupport/productionContentScriptHarness');
var frames = require('./testSupport/flopCBetProductionFrames');
var a6 = require('./fixtures/capture-derived-preflop/a6-full-allin-3bet-call-runout.sanitized.json');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function initialStorage(gameId) {
  var keys = harnessSupport.storageKeys(gameId);
  var storage = {};
  storage[keys.schema] = 4;
  storage[keys.playerMap] = { P1: 'P1', P2: 'P2' };
  return { keys: keys, storage: storage };
}

function create(gameId, storage, debugEnabled) {
  var harness = harnessSupport.createHarness({
    gameId: gameId,
    initialStorage: storage,
    debugEnabled: debugEnabled !== false
  });
  assert.deepStrictEqual(harness.evaluationErrors, [], gameId + ' loads the exact production manifest order');
  return harness;
}

function pipelineErrors(harness) {
  return harness.logs.filter(function (call) {
    return call[0] === '[HUD] websocket frame processing error' ||
      call[0] === '[HUD PIPELINE FAILURE]' ||
      call[0] === '[HUD] initialization error';
  });
}

function reductions(harness) {
  return harnessSupport.debugEntries(harness, 'flop-cbet-reducer-invocation').filter(function (entry) {
    return entry.phase === 'after';
  });
}

function attachments(harness) {
  return harnessSupport.debugEntries(harness, 'flop-cbet-contribution-attachment');
}

function successfulAttachments(harness) {
  return attachments(harness).filter(function (entry) { return entry.attached; });
}

function statsAttachments(harness) {
  return harnessSupport.debugEntries(harness, 'flop-cbet-stats-attachment');
}

function countersFor(events, playerId) {
  var matching = (events || []).filter(function (event) { return String(event.playerId || '') === String(playerId); });
  return ['flopCBetMade', 'flopCBetOpportunities', 'foldToFlopCBet', 'foldToFlopCBetOpportunities'].map(function (field) {
    return matching.reduce(function (total, event) { return total + Number(event[field] || 0); }, 0);
  });
}

function runOrdinary(kind, suffix) {
  var gameId = 'flop-cbet-' + suffix;
  var setup = initialStorage(gameId);
  var scenario = frames.ordinaryScenario(kind, 'AUTH-' + suffix.toUpperCase());
  var harness = create(gameId, setup.storage);
  harnessSupport.dispatchFrames(harness, scenario.frames, suffix);
  assert.deepStrictEqual(pipelineErrors(harness), []);
  assert.strictEqual(reductions(harness).length, 1);
  return { gameId: gameId, keys: setup.keys, scenario: scenario, harness: harness, reduction: reductions(harness)[0] };
}

var ordinary = runOrdinary('bet-fold', 'ordinary');
var semanticFinalization = harnessSupport.debugEntries(ordinary.harness, 'semantic-finalization').find(function (entry) {
  return entry.finalized && entry.handIdentity && entry.handIdentity.handId === ordinary.scenario.handId;
});
assert.ok(semanticFinalization, 'real content dispatch finalizes the authoritative semantic hand');
assert.notStrictEqual(
  semanticFinalization.handIdentity.lifecycleHandId,
  semanticFinalization.handIdentity.handId,
  'the production regression deliberately exercises differing lifecycle and authoritative IDs'
);
assert.deepStrictEqual([
  ordinary.reduction.contributions.P1.flopCBetMade,
  ordinary.reduction.contributions.P1.flopCBetOpportunities
], [1, 1]);
assert.deepStrictEqual([
  ordinary.reduction.contributions.P2.foldToFlopCBet,
  ordinary.reduction.contributions.P2.foldToFlopCBetOpportunities
], [1, 1]);
var ordinaryAttachments = successfulAttachments(ordinary.harness);
assert.strictEqual(ordinaryAttachments.length, 2, 'one shadow attachment is recorded for each stable player ID');
assert.strictEqual(statsAttachments(ordinary.harness).filter(function (entry) { return entry.attached; }).length, 2, 'the authoritative stats path ingests both supported player contributions');
assert.deepStrictEqual(plain(ordinaryAttachments[0].candidateHandIds), [
  semanticFinalization.handIdentity.lifecycleHandId,
  ordinary.scenario.handId
], 'attachment prefers lifecycleHandId, then authoritative handId');
assert.ok(ordinaryAttachments.every(function (entry) {
  return entry.targetHandId === semanticFinalization.handIdentity.lifecycleHandId;
}), 'both contributions attach to the finalized lifecycle event identity');
var storedEvents = ordinary.harness.storage[ordinary.keys.liveEvents];
assert.ok(Array.isArray(storedEvents) && storedEvents.length > 0);
assert.deepStrictEqual(countersFor(storedEvents, 'P1'), [1, 1, 0, 0], 'P1 aggressor counters persist through the existing live-events key');
assert.deepStrictEqual(countersFor(storedEvents, 'P2'), [0, 0, 1, 1], 'P1 defender counters persist through the existing live-events key');
assert.strictEqual(JSON.stringify(ordinary.harness.storage).includes('shadowFlopCBetOpportunities'), false, 'shadow aggregates are not persisted');

var called = runOrdinary('bet-call', 'called');
assert.deepStrictEqual(countersFor(called.harness.storage[called.keys.liveEvents], 'P1'), [1, 1, 0, 0]);
assert.deepStrictEqual(countersFor(called.harness.storage[called.keys.liveEvents], 'P2'), [0, 0, 0, 1], 'P2 call is a supported denominator and zero folds');

var repeatedGame = 'flop-cbet-repeated-settlement';
var repeatedSetup = initialStorage(repeatedGame);
var repeatedScenario = frames.ordinaryScenario('bet-fold', 'AUTH-REPEATED');
var repeatedHarness = create(repeatedGame, repeatedSetup.storage);
var throughTerminal = repeatedScenario.frames.slice(0, -1);
harnessSupport.dispatchFrames(
  repeatedHarness,
  throughTerminal.concat([repeatedScenario.terminalFrame, repeatedScenario.terminalFrame, repeatedScenario.nextFrame]),
  'repeated'
);
assert.deepStrictEqual(pipelineErrors(repeatedHarness), []);
assert.strictEqual(reductions(repeatedHarness).length, 1, 'replayed terminal and settlement frames invoke the reducer exactly once');
assert.strictEqual(successfulAttachments(repeatedHarness).length, 2, 'replayed settlement cannot duplicate player attachments');
assert.deepStrictEqual(countersFor(repeatedHarness.storage[repeatedSetup.keys.liveEvents], 'P1'), [1, 1, 0, 0]);
assert.deepStrictEqual(countersFor(repeatedHarness.storage[repeatedSetup.keys.liveEvents], 'P2'), [0, 0, 1, 1], 'P11 repeated terminal frames persist each contribution once');

var checkBack = runOrdinary('check-back', 'check-back');
assert.deepStrictEqual([
  checkBack.reduction.contributions.P1.flopCBetMade,
  checkBack.reduction.contributions.P1.flopCBetOpportunities
], [0, 1]);
assert.deepStrictEqual([
  checkBack.reduction.contributions.P2.foldToFlopCBet,
  checkBack.reduction.contributions.P2.foldToFlopCBetOpportunities
], [0, 0]);
assert.deepStrictEqual(countersFor(checkBack.harness.storage[checkBack.keys.liveEvents], 'P1'), [0, 1, 0, 0], 'P3 check-back stores only the aggressor denominator');

var donk = runOrdinary('donk-bet', 'donk');
assert.deepStrictEqual([
  donk.reduction.contributions.P1.flopCBetMade,
  donk.reduction.contributions.P1.flopCBetOpportunities
], [0, 0]);
assert.deepStrictEqual([
  donk.reduction.contributions.P2.foldToFlopCBet,
  donk.reduction.contributions.P2.foldToFlopCBetOpportunities
], [0, 0]);
assert.strictEqual(donk.reduction.contributions.P1.flopCBet.reason, 'opponent_bet_before_aggressor_action');
assert.deepStrictEqual(countersFor(donk.harness.storage[donk.keys.liveEvents], 'P1'), [0, 0, 0, 0]);
assert.deepStrictEqual(countersFor(donk.harness.storage[donk.keys.liveEvents], 'P2'), [0, 0, 0, 0], 'P4 donk bet creates no stored denominator');

var fourBet = runOrdinary('deep-bet-fold', 'four-bet');
assert.strictEqual(fourBet.reduction.contributions.P1.flopCBet.reason, 'qualifying_flop_cbet');
assert.deepStrictEqual([
  fourBet.reduction.contributions.P1.flopCBetMade,
  fourBet.reduction.contributions.P1.flopCBetOpportunities
], [1, 1], 'the final full 4-bettor owns the production-path CBet');
assert.deepStrictEqual(countersFor(fourBet.harness.storage[fourBet.keys.liveEvents], 'P1'), [1, 1, 0, 0]);

var fourBetCheckBack = runOrdinary('deep-check-back', 'four-bet-check-back');
assert.deepStrictEqual([
  fourBetCheckBack.reduction.contributions.P1.flopCBetMade,
  fourBetCheckBack.reduction.contributions.P1.flopCBetOpportunities
], [0, 1], 'the final full 4-bettor receives a declined opportunity after checking back');

var fiveBet = runOrdinary('deep-five-bet', 'five-bet');
assert.deepStrictEqual([
  fiveBet.reduction.contributions.P2.flopCBetMade,
  fiveBet.reduction.contributions.P2.flopCBetOpportunities
], [1, 1], 'ordered full-raise sizing carries final-aggressor ownership through a 5Bet without mR');

var automaticGame = 'flop-cbet-automatic-runout';
var automaticSetup = initialStorage(automaticGame);
var automaticHarness = create(automaticGame, automaticSetup.storage);
harnessSupport.dispatchFrames(automaticHarness, frames.authoritativeFixtureFrames(a6), 'automatic-runout');
assert.deepStrictEqual(pipelineErrors(automaticHarness), []);
var automaticReduction = reductions(automaticHarness);
assert.strictEqual(automaticReduction.length, 1);
Object.keys(automaticReduction[0].contributions).forEach(function (playerId) {
  var player = automaticReduction[0].contributions[playerId];
  assert.deepStrictEqual([
    player.flopCBetMade,
    player.flopCBetOpportunities,
    player.foldToFlopCBet,
    player.foldToFlopCBetOpportunities
  ], [0, 0, 0, 0]);
});
assert.strictEqual(automaticReduction[0].contributions.P1.flopCBet.reason, 'final_preflop_aggressor_already_all_in');
assert.deepStrictEqual(countersFor(automaticHarness.storage[automaticSetup.keys.liveEvents], 'P1'), [0, 0, 0, 0]);
assert.deepStrictEqual(countersFor(automaticHarness.storage[automaticSetup.keys.liveEvents], 'P2'), [0, 0, 0, 0], 'P8 automatic runout leaves all counters unchanged');

var c12Game = 'flop-cbet-c12';
var c12Setup = initialStorage(c12Game);
var c12Scenario = frames.ordinaryScenario('bet-fold', 'AUTH-C12');
var c12BeforeReload = create(c12Game, c12Setup.storage);
harnessSupport.dispatchFrames(c12BeforeReload, c12Scenario.frames.slice(0, c12Scenario.splitAfterPreflop), 'c12-before');
var c12Active = c12BeforeReload.storage[c12Setup.keys.activeHand];
assert.ok(c12Active && c12Active.semanticHandLedgerSnapshot, 'C12 persists bounded exact semantic observations with the existing active hand');
assert.strictEqual(c12Active.semanticHandLedgerSnapshot.hand.historyComplete, true);
var c12AfterReload = create(c12Game, c12BeforeReload.storage);
harnessSupport.dispatchFrames(
  c12AfterReload,
  [c12Scenario.reloadPreflopRegistered].concat(c12Scenario.frames.slice(c12Scenario.splitAfterPreflop)),
  'c12-after'
);
assert.deepStrictEqual(pipelineErrors(c12AfterReload), []);
var c12Restore = harnessSupport.debugEntries(c12AfterReload, 'flop-cbet-semantic-restore');
assert.strictEqual(c12Restore.length, 1);
assert.strictEqual(c12Restore[0].restored, true);
assert.strictEqual(c12Restore[0].historyComplete, true);
assert.strictEqual(reductions(c12AfterReload).length, 1);
assert.deepStrictEqual([
  reductions(c12AfterReload)[0].contributions.P1.flopCBetMade,
  reductions(c12AfterReload)[0].contributions.P1.flopCBetOpportunities,
  reductions(c12AfterReload)[0].contributions.P2.foldToFlopCBet,
  reductions(c12AfterReload)[0].contributions.P2.foldToFlopCBetOpportunities
], [1, 1, 1, 1], 'C12 reconstructs the eventual opportunity and result exactly once');
assert.strictEqual(successfulAttachments(c12AfterReload).length, 2);
assert.deepStrictEqual(countersFor(c12AfterReload.storage[c12Setup.keys.liveEvents], 'P1'), [1, 1, 0, 0]);
assert.deepStrictEqual(countersFor(c12AfterReload.storage[c12Setup.keys.liveEvents], 'P2'), [0, 0, 1, 1], 'P12 reload after preflop persists one final contribution');
var c12Persisted = JSON.stringify(c12AfterReload.storage[c12Setup.keys.liveEvents]);
var c12Restored = create(c12Game, c12AfterReload.storage);
assert.strictEqual(JSON.stringify(c12Restored.storage[c12Setup.keys.liveEvents]), c12Persisted, 'extension restoration retains P12 counters without a second contribution');

var c13Game = 'flop-cbet-c13';
var c13Setup = initialStorage(c13Game);
var c13Scenario = frames.ordinaryScenario('bet-fold', 'AUTH-C13');
var c13BeforeReload = create(c13Game, c13Setup.storage);
harnessSupport.dispatchFrames(c13BeforeReload, c13Scenario.frames.slice(0, c13Scenario.splitBeforeSettlement), 'c13-before');
var c13AfterReload = create(c13Game, c13BeforeReload.storage);
harnessSupport.dispatchFrames(
  c13AfterReload,
  [c13Scenario.reloadFlopCompleteRegistered, c13Scenario.terminalFrame, c13Scenario.terminalFrame, c13Scenario.nextFrame],
  'c13-after'
);
assert.deepStrictEqual(pipelineErrors(c13AfterReload), []);
assert.strictEqual(reductions(c13AfterReload).length, 1);
assert.deepStrictEqual([
  reductions(c13AfterReload)[0].contributions.P1.flopCBetMade,
  reductions(c13AfterReload)[0].contributions.P1.flopCBetOpportunities,
  reductions(c13AfterReload)[0].contributions.P2.foldToFlopCBet,
  reductions(c13AfterReload)[0].contributions.P2.foldToFlopCBetOpportunities
], [1, 1, 1, 1], 'C13 preserves the completed flop result until settlement');
var c13Semantic = harnessSupport.debugEntries(c13AfterReload, 'semantic-finalization').find(function (entry) {
  return entry.finalized && entry.handIdentity && entry.handIdentity.handId === c13Scenario.handId;
});
assert.deepStrictEqual(plain(c13Semantic.flopActions.map(function (action) {
  return [action.playerId, action.type];
})), [['P2', 'check'], ['P1', 'bet'], ['P2', 'fold']], 'C13 reload retains each ordered flop action once');
assert.strictEqual(successfulAttachments(c13AfterReload).length, 2, 'C13 settlement replay attaches each player once');
assert.deepStrictEqual(countersFor(c13AfterReload.storage[c13Setup.keys.liveEvents], 'P1'), [1, 1, 0, 0]);
assert.deepStrictEqual(countersFor(c13AfterReload.storage[c13Setup.keys.liveEvents], 'P2'), [0, 0, 1, 1], 'P13 reload after flop completion persists one final contribution');

var c14Game = 'flop-cbet-c14';
var c14Setup = initialStorage(c14Game);
var c14Scenario = frames.ordinaryScenario('bet-fold', 'AUTH-C14');
var c14BeforeReload = create(c14Game, c14Setup.storage);
harnessSupport.dispatchFrames(c14BeforeReload, c14Scenario.frames.slice(0, -1), 'c14-before');
assert.strictEqual(reductions(c14BeforeReload).length, 1);
var c14PersistedEvents = JSON.stringify(c14BeforeReload.storage[c14Setup.keys.liveEvents]);
var c14AfterReload = create(c14Game, c14BeforeReload.storage);
harnessSupport.dispatchFrames(
  c14AfterReload,
  [c14Scenario.reloadFlopCompleteRegistered, c14Scenario.terminalFrame, c14Scenario.terminalFrame, c14Scenario.nextFrame],
  'c14-after'
);
assert.deepStrictEqual(pipelineErrors(c14AfterReload), []);
assert.strictEqual(reductions(c14AfterReload).length, 0, 'C14 replay after completed-hand reload never invokes the reducer again');
assert.strictEqual(successfulAttachments(c14AfterReload).length, 0);
assert.strictEqual(JSON.stringify(c14AfterReload.storage[c14Setup.keys.liveEvents]), c14PersistedEvents, 'C14 does not mutate previously finalized live events');
assert.deepStrictEqual(countersFor(c14AfterReload.storage[c14Setup.keys.liveEvents], 'P1'), [1, 1, 0, 0]);
assert.deepStrictEqual(countersFor(c14AfterReload.storage[c14Setup.keys.liveEvents], 'P2'), [0, 0, 1, 1], 'P14 completed-hand replay retains the original counters once');

var legacySetup = initialStorage('flop-cbet-legacy');
legacySetup.storage[legacySetup.keys.liveEvents] = [
  { handId: 'legacy-hand', playerId: 'LEGACY', player: 'Legacy', action: 'raise', street: 'preflop', amount: 60, timestamp: 1, threeBetMade: 1, threeBetOpportunities: 1 }
];
legacySetup.storage[legacySetup.keys.finalizedHandIds] = ['legacy-hand'];
var legacyHarness = create('flop-cbet-legacy', legacySetup.storage);
var legacyStats = plain(legacyHarness.context.PokerStats.computePlayerStats(legacyHarness.storage[legacySetup.keys.liveEvents], 'Legacy'));
assert.deepStrictEqual(countersFor(legacyHarness.storage[legacySetup.keys.liveEvents], 'LEGACY'), [0, 0, 0, 0], 'P15 older persisted events restore missing counters as zero');
assert.deepStrictEqual([legacyStats.vpipHands, legacyStats.pfrHands, legacyStats.af, legacyStats.threeBetMade, legacyStats.threeBetOpportunities], [1, 1, 0, 1, 1], 'P15 existing persisted values remain unchanged');

var quietSetup = initialStorage('flop-cbet-debug-default');
var quiet = create('flop-cbet-debug-default', quietSetup.storage, false);
harnessSupport.dispatchFrames(quiet, frames.ordinaryScenario('bet-fold', 'AUTH-QUIET').frames, 'quiet');
assert.strictEqual(harnessSupport.debugEntries(quiet).length, 0, 'the reused structured debug channel remains disabled by default');

var manifestOrder = ordinary.harness.isolatedScripts;
assert.ok(manifestOrder.indexOf('flopCBetOpportunityReducer.js') >= 0);
assert.ok(manifestOrder.indexOf('flopCBetOpportunityReducer.js') < manifestOrder.indexOf('content.js'));

console.log('Production content-path Flop CBet counter persistence, C12-C14 reload, and exactly-once tests passed.');
