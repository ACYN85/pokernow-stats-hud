'use strict';

var assert = require('assert');
var PokerStats = require('./stats.js');
var harnessSupport = require('./testSupport/productionContentScriptHarness');
var frames = require('./testSupport/showdownPostBreakProductionFrames');

function initialStorage(gameId) {
  var keys = harnessSupport.storageKeys(gameId);
  var storage = {};
  storage[keys.schema] = 4;
  storage[keys.playerMap] = { P1: 'P1', P2: 'P2' };
  return { keys: keys, storage: storage };
}

function create(gameId, storage) {
  var harness = harnessSupport.createHarness({ gameId: gameId, initialStorage: storage, showdownDebugEnabled: true, controlledClock: true });
  assert.deepStrictEqual(harness.evaluationErrors, [], gameId + ' loads the exact production manifest/content path');
  return harness;
}

function reductions(harness) {
  return harnessSupport.showdownDebugEntries(harness, 'reducer-invocation').filter(function (entry) { return entry.phase === 'after'; });
}

function stat(harness, keys, playerId) {
  return PokerStats.computePlayerStats(harness.storage[keys.liveEvents] || [], playerId);
}

function assertShowdownTotals(harness, keys, expectedHands, label) {
  var winner = stat(harness, keys, 'P1');
  var loser = stat(harness, keys, 'P2');
  assert.deepStrictEqual(
    [winner.sawFlopForWTSD, winner.wentToShowdown, winner.showdownsForWSD, winner.wonMoneyAtShowdown],
    [expectedHands, expectedHands, expectedHands, expectedHands],
    label + ' winner has one supported WTSD/W$SD contribution per showdown hand'
  );
  assert.deepStrictEqual(
    [loser.sawFlopForWTSD, loser.wentToShowdown, loser.showdownsForWSD, loser.wonMoneyAtShowdown],
    [expectedHands, expectedHands, expectedHands, 0],
    label + ' loser has the denominator but no monetary numerator'
  );
}

function beginAndBreak(gameId) {
  var setup = initialStorage(gameId);
  var harness = create(gameId, setup.storage);
  var initialized = frames.initializedPlay('PRE-' + gameId);
  harnessSupport.dispatchFrames(harness, [initialized.registered].concat(initialized.completeHandFrames), gameId + '-pre', 10000);
  assertShowdownTotals(harness, setup.keys, 1, gameId + ' R1');
  harnessSupport.dispatchFrame(harness, frames.gc(frames.breakPatch({ P1: 1000, P2: 1000 })), gameId + '-break', 15000);
  var breakEntries = harnessSupport.showdownDebugEntries(harness, 'game-break-entry');
  assert.ok(breakEntries.length >= 1, gameId + ' records game-break entry');
  assert.strictEqual(breakEntries[breakEntries.length - 1].priorHandResolved, true, gameId + ' opens the real interruption only after the initialized hand resolves');
  return { harness: harness, setup: setup };
}

function runVariant(name, options) {
  options = options || {};
  var gameId = 'post-break-' + name;
  var state = beginAndBreak(gameId);
  var harness = state.harness;
  if (options.reloadDuringBreak) {
    harness = create(gameId, harness.storage);
    harnessSupport.dispatchFrame(harness, frames.registered(frames.waitingState({ P1: 1000, P2: 1000 })), gameId + '-reload-break', 15100);
  }
  if (!options.startImmediately) {
    var rejoin = frames.rejoinPatch({ P1: 1000, P2: 1000 });
    harnessSupport.dispatchFrame(harness, frames.gc(rejoin), gameId + '-rejoin', 15200);
    if (options.duplicateRejoin) harnessSupport.dispatchFrame(harness, frames.gc(rejoin), gameId + '-rejoin-repeat', 15201);
  }
  if (options.reloadAfterRejoin) {
    harness = create(gameId, harness.storage);
    var returnedBaseline = frames.waitingState({ P1: 1000, P2: 1000 }, 'waitingToStart');
    returnedBaseline.pGS = { P1: 'inGame', P2: 'inGame' };
    returnedBaseline.players.P2.status = 'active';
    harnessSupport.dispatchFrame(harness, frames.registered(returnedBaseline), gameId + '-reload-returned', 15250);
  }
  var reductionCountBefore = reductions(harness).length;
  var handFrames = frames.handPatches('AUTH-' + name.toUpperCase(), options);
  if (options.assertDeferred) {
    harnessSupport.dispatchFrames(harness, handFrames.slice(0, -1), gameId + '-provisional', 20000);
    assert.strictEqual(reductions(harness).length, reductionCountBefore, name + ' does not commit the early settlement');
    var provisional = harnessSupport.showdownDebugEntries(harness, 'provisional-contribution');
    assert.ok(provisional.some(function (entry) { return entry.committed === false && entry.laterCompleteContributionAllowed === true; }), name + ' retains a provisional exact-hand marker');
    harnessSupport.dispatchFrames(harness, handFrames.slice(-1), gameId + '-terminal-ready', 21000);
  } else {
    harnessSupport.dispatchFrames(harness, handFrames, gameId + '-resumed', 20000);
  }
  assert.strictEqual(reductions(harness).length, reductionCountBefore + 1, name + ' reduces the first resumed hand once in this content instance');
  assertShowdownTotals(harness, state.setup.keys, 2, name);
  assert.ok(harnessSupport.showdownDebugEntries(harness, 'first-post-break-hand').length >= 1, name + ' marks the first post-break hand');
  assert.ok(harnessSupport.showdownDebugEntries(harness, 'committed-contribution').some(function (entry) { return entry.reduced && !entry.duplicate; }), name + ' commits one authoritative contribution');
  return { gameId: gameId, setup: state.setup, harness: harness, handFrames: handFrames };
}

// I1-I8: same page, with the required rejoin/start, ordering, identity, sparse,
// and duplicate variants. I4/I5 reproduce the live failure: settlement first,
// terminal phase/reveals later, with I4 also using distinct lifecycle/authority IDs.
runVariant('i1-rejoin-before-start', {});
runVariant('i2-start-immediately', { startImmediately: true });
runVariant('i3-resume-signal-late', { resumeSignalLate: true });
var i4 = runVariant('i4-late-authoritative-id', { lateAuthoritativeHandId: true, splitSettlement: true, assertDeferred: true });
runVariant('i5-split-settlement', { splitSettlement: true, assertDeferred: true });
runVariant('i6-duplicates', { duplicateRejoin: true, splitSettlement: true, duplicateTerminal: true });
runVariant('i7-sparse-player-metadata', { sparseInitialMetadata: true });
runVariant('i8-page-open', {});

var i4Semantic = harnessSupport.showdownDebugEntries(i4.harness, 'semantic-finalization').filter(function (entry) { return entry.finalized; }).slice(-1)[0];
assert.ok(i4Semantic, 'I4 produces a finalized semantic record');
assert.notStrictEqual(i4Semantic.handIdentity.lifecycleHandId, i4Semantic.handIdentity.handId, 'I4 lifecycle and authoritative hand IDs differ');
assert.strictEqual(i4Semantic.handIdentity.handId, 'AUTH-I4-LATE-AUTHORITATIVE-ID');

// I9/I10: the existing bounded recovery path owns the same exact players and
// post-break hand across reload during the break and immediately after return.
runVariant('i9-reload-during-break', { reloadDuringBreak: true, splitSettlement: true });
runVariant('i10-reload-after-rejoin', { reloadAfterRejoin: true, splitSettlement: true });

// R5 plus reload-after-first-showdown and completed replay: both resumed hands
// count exactly once; the first does not merely unblock the second.
var sequence = runVariant('r5-two-resumed-hands', { splitSettlement: true, duplicateTerminal: true });
var afterFirst = create(sequence.gameId, sequence.harness.storage);
harnessSupport.dispatchFrames(afterFirst, sequence.handFrames.slice(-2), 'completed-first-replay', 30000);
assertShowdownTotals(afterFirst, sequence.setup.keys, 2, 'reload after first resumed showdown');
var secondFrames = frames.handPatches('AUTH-R5-SECOND', { splitSettlement: true, duplicateTerminal: true });
var secondBaseline = frames.initializedPlay('AUTH-R5-SECOND').registered;
harnessSupport.dispatchFrames(afterFirst, [secondBaseline].concat(secondFrames), 'second-resumed', 40000);
assert.strictEqual(reductions(afterFirst).filter(function (entry) { return entry.reduced; }).length, 1, 'only the new second resumed hand reduces after reload');
assertShowdownTotals(afterFirst, sequence.setup.keys, 3, 'first and second resumed showdowns');

var debugOffSetup = initialStorage('showdown-debug-remains-off');
var debugOffHarness = harnessSupport.createHarness({ gameId: 'showdown-debug-remains-off', initialStorage: debugOffSetup.storage, controlledClock: true });
assert.deepStrictEqual(debugOffHarness.evaluationErrors, [], 'debug-off manifest path evaluates');
assert.strictEqual(harnessSupport.showdownDebugEntries(debugOffHarness).length, 0, 'showdown diagnostics remain disabled by default');

console.log('First-post-break showdown I1-I10, split terminal evidence, identity, reload, replay, and two-hand production regression passed.');
