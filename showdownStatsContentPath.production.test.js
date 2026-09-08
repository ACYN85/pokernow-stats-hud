'use strict';

var assert = require('assert');
var fs = require('fs');
var harnessSupport = require('./testSupport/productionContentScriptHarness');
var frames = require('./testSupport/showdownStatsProductionFrames');
var cbetFrames = require('./testSupport/flopCBetProductionFrames');
var a3 = require('./fixtures/capture-derived-preflop/a3-open-coldcall-squeeze-showdown-chop.sanitized.json');
var a6 = require('./fixtures/capture-derived-preflop/a6-full-allin-3bet-call-runout.sanitized.json');

function initialStorage(gameId, playerIds) {
  var keys = harnessSupport.storageKeys(gameId);
  var storage = {};
  storage[keys.schema] = 4;
  storage[keys.playerMap] = {};
  (playerIds || ['P1', 'P2']).forEach(function (playerId) { storage[keys.playerMap][playerId] = playerId; });
  return { keys: keys, storage: storage };
}

function create(gameId, storage, debug) {
  var harness = harnessSupport.createHarness({ gameId: gameId, initialStorage: storage, showdownDebugEnabled: debug !== false });
  assert.deepStrictEqual(harness.evaluationErrors, [], gameId + ' loads exact production manifest order');
  return harness;
}

function pipelineErrors(harness) {
  return harness.logs.filter(function (call) {
    return call[0] === '[HUD] websocket frame processing error' || call[0] === '[HUD PIPELINE FAILURE]' || call[0] === '[HUD] initialization error';
  });
}

function reductions(harness) {
  return harnessSupport.showdownDebugEntries(harness, 'reducer-invocation').filter(function (entry) { return entry.phase === 'after'; });
}

function decisions(harness) { return harnessSupport.showdownDebugEntries(harness, 'wtsd-decision'); }
function decision(harness, playerId) { return decisions(harness).find(function (entry) { return entry.playerId === playerId; }); }
function attachments(harness) { return harnessSupport.showdownDebugEntries(harness, 'shadow-attachment'); }
function successfulAttachments(harness) { return attachments(harness).filter(function (entry) { return entry.attached; }); }

function runOrdinary(kind, suffix) {
  var gameId = 'showdown-' + suffix;
  var setup = initialStorage(gameId);
  var scenario = frames.ordinary(kind, 'AUTH-' + suffix.toUpperCase());
  var harness = create(gameId, setup.storage);
  harnessSupport.dispatchFrames(harness, scenario.frames, suffix);
  assert.deepStrictEqual(pipelineErrors(harness), []);
  assert.strictEqual(reductions(harness).length, 1, suffix + ' produces one production shadow reduction');
  return { gameId: gameId, keys: setup.keys, scenario: scenario, harness: harness };
}

function assertBoundedAuthoritativeFieldsOnly(run) {
  var encoded = JSON.stringify(run.harness.storage[run.keys.liveEvents] || []);
  ['showdownOutcome', 'wonMoneyAtShowdownCandidate', 'contestedGrossAward', 'excludedReturnAmount', 'potsEligible', 'evidence'].forEach(function (field) {
    assert.strictEqual(encoded.includes(field), false, field + ' rich shadow evidence remains absent from authoritative finalized events');
  });
  assert.strictEqual(JSON.stringify(run.harness.storage).includes('shadowShowdownStats'), false, 'shadow inspection has no storage key');
}

// D1 - saw flop, folded turn.
var d1 = runOrdinary('turn-fold', 'd1-turn-fold');
assert.deepStrictEqual([decision(d1.harness, 'P2').sawFlopForWTSD, decision(d1.harness, 'P2').wentToShowdown], [1, 0]);
assert.strictEqual(decision(d1.harness, 'P2').wonMoneyAtShowdownCandidate, null);

// D2 - saw flop, folded river.
var d2 = runOrdinary('river-fold', 'd2-river-fold');
assert.deepStrictEqual([decision(d2.harness, 'P2').sawFlopForWTSD, decision(d2.harness, 'P2').wentToShowdown], [1, 0]);

// D3 - heads-up check-through showdown with positive and zero contested awards.
var d3 = runOrdinary('showdown', 'd3-check-through');
assert.deepStrictEqual([decision(d3.harness, 'P1').wentToShowdown, decision(d3.harness, 'P2').wentToShowdown], [1, 1]);
assert.deepStrictEqual([decision(d3.harness, 'P1').wonMoneyAtShowdownCandidate, decision(d3.harness, 'P2').wonMoneyAtShowdownCandidate], [1, 0]);
assert.deepStrictEqual([decision(d3.harness, 'P1').contestedGrossAward, decision(d3.harness, 'P2').contestedGrossAward], [120, 0]);

// D4 - final river fold is uncontested for every flop entrant.
var d4 = runOrdinary('river-fold', 'd4-final-river-fold');
assert.ok(decisions(d4.harness).every(function (entry) { return entry.sawFlopForWTSD === 1 && entry.wentToShowdown === 0 && entry.wonMoneyAtShowdownCandidate === null; }));

// D5 - one visible hand plus a complete river check-through by every live
// entrant and retained terminal settlement supports the unshown/mucked loser.
var d5 = runOrdinary('muck', 'd5-muck-supported-by-complete-river');
assert.ok(decisions(d5.harness).every(function (entry) { return entry.wentToShowdown === 1; }));
assert.deepStrictEqual([decision(d5.harness, 'P1').wonMoneyAtShowdownCandidate, decision(d5.harness, 'P2').wonMoneyAtShowdownCandidate], [1, 0]);

// D5b - a terminal river call proves that the non-folding caller reached
// showdown even when only the winner's cards remain visible.
var d5b = runOrdinary('river-call-muck', 'd5b-river-call-muck');
assert.ok(decisions(d5b.harness).every(function (entry) { return entry.wentToShowdown === 1; }));
assert.deepStrictEqual([decision(d5b.harness, 'P1').wonMoneyAtShowdownCandidate, decision(d5b.harness, 'P2').wonMoneyAtShowdownCandidate], [1, 0]);
assert.strictEqual(decision(d5b.harness, 'P2').wonMoneyAtShowdownCandidateReason, 'complete_contested_settlement_proves_no_award');
var d5bSemantic = harnessSupport.showdownDebugEntries(d5b.harness, 'semantic-finalization').find(function (entry) {
  return entry.finalized && entry.handIdentity && entry.handIdentity.handId === d5b.scenario.handId;
});
assert.ok(d5bSemantic, 'the realistic river-call fixture finalizes through the semantic ledger');
assert.notStrictEqual(d5bSemantic.handIdentity.lifecycleHandId, d5bSemantic.handIdentity.handId, 'the corrected showdown contribution crosses differing lifecycle and authoritative hand identities');

var d5cGame = 'showdown-d5c-three-way-muck';
var d5cSetup = initialStorage(d5cGame, ['P1', 'P2', 'P3']);
var d5cScenario = frames.multiwayMuck('AUTH-D5C-THREE-WAY-MUCK');
var d5c = create(d5cGame, d5cSetup.storage);
harnessSupport.dispatchFrames(d5c, d5cScenario.frames, 'd5c');
assert.deepStrictEqual(pipelineErrors(d5c), []);
assert.strictEqual(reductions(d5c).length, 1);
assert.deepStrictEqual(['P1', 'P2', 'P3'].map(function (playerId) { return decision(d5c, playerId).wentToShowdown; }), [1, 1, 1], 'all three terminal live river checkers reached showdown');
assert.deepStrictEqual(['P1', 'P2', 'P3'].map(function (playerId) { return decision(d5c, playerId).wonMoneyAtShowdownCandidate; }), [1, 0, 0], 'the visible winner and both mucked losers share one corrected W$SD population');

// D6 - authoritative preflop all-in automatic runout.
var d6Game = 'showdown-d6-preflop-allin';
var d6Setup = initialStorage(d6Game);
var d6 = create(d6Game, d6Setup.storage);
harnessSupport.dispatchFrames(d6, cbetFrames.authoritativeFixtureFrames(a6), 'd6');
assert.strictEqual(reductions(d6).length, 1);
assert.deepStrictEqual([decision(d6, 'P1').wentToShowdown, decision(d6, 'P2').wentToShowdown], [1, 1]);
assert.deepStrictEqual([decision(d6, 'P1').wonMoneyAtShowdownCandidate, decision(d6, 'P2').wonMoneyAtShowdownCandidate], [0, 1]);

// D7 - postflop all-in runout.
var d7 = runOrdinary('postflop-allin', 'd7-postflop-allin');
assert.ok(decisions(d7.harness).every(function (entry) { return entry.wentToShowdown === 1; }));

var d7b = runOrdinary('postflop-allin-muck', 'd7b-postflop-allin-unshown');
assert.ok(decisions(d7b.harness).every(function (entry) { return entry.wentToShowdown === 1; }), 'an action-free all-in board runout does not require visible cards');
assert.deepStrictEqual([decision(d7b.harness, 'P1').wonMoneyAtShowdownCandidate, decision(d7b.harness, 'P2').wonMoneyAtShowdownCandidate], [1, 0]);

// D8 - equal split retains both positive aggregate awards without inventing rich pot structure.
var d8 = runOrdinary('split', 'd8-equal-split');
assert.ok(decisions(d8.harness).every(function (entry) { return entry.wentToShowdown === 1 && entry.wonMoneyAtShowdownCandidate === 1; }));
assert.ok(decisions(d8.harness).every(function (entry) { return entry.outcomeSupported === false && entry.showdownOutcome === 'unsupported'; }));

// D9/D10 - real captured multiway showdown, aggregate awards, and unresolved pot identity.
var d9Game = 'showdown-d9-d10-multiway';
var d9Setup = initialStorage(d9Game, ['P1', 'P2', 'P3']);
var d9 = create(d9Game, d9Setup.storage);
harnessSupport.dispatchFrames(d9, cbetFrames.authoritativeFixtureFrames(a3), 'd9');
assert.strictEqual(reductions(d9).length, 1);
assert.deepStrictEqual(['P1', 'P2', 'P3'].map(function (id) { return decision(d9, id).wentToShowdown; }), [1, 1, 1]);
assert.deepStrictEqual([decision(d9, 'P1').contestedGrossAward, decision(d9, 'P2').contestedGrossAward, decision(d9, 'P3').contestedGrossAward], [330, 0, 330]);
assert.ok(decisions(d9).every(function (entry) { return entry.showdownOutcome === 'unsupported' && entry.outcomeSupported === false; }), 'D10 never fabricates pot eligibility');

// D11 - an inferred uncalled return is excluded from the positive contested award.
var d11 = runOrdinary('return-showdown', 'd11-return');
assert.deepStrictEqual([decision(d11.harness, 'P1').contestedGrossAward, decision(d11.harness, 'P1').excludedReturnAmount], [400, 100]);
assert.strictEqual(decision(d11.harness, 'P1').wonMoneyAtShowdownCandidate, 1);

// D12 - showdown membership can be supported while settlement remains unresolved.
var d12 = runOrdinary('missing-settlement', 'd12-missing-settlement');
assert.ok(decisions(d12.harness).every(function (entry) { return entry.wentToShowdown === 1 && entry.wonMoneyAtShowdownCandidate === null; }));
assert.ok(decisions(d12.harness).every(function (entry) { return entry.wonMoneyAtShowdownCandidateReason === 'settlement_unresolved'; }));

// D13 - repeated terminal settlement frames produce one reduction and do not double awards.
var d13Game = 'showdown-d13-duplicate-settlement';
var d13Setup = initialStorage(d13Game);
var d13Scenario = frames.ordinary('showdown', 'AUTH-D13');
var d13 = create(d13Game, d13Setup.storage);
harnessSupport.dispatchFrames(d13, d13Scenario.frames.slice(0, -2).concat([d13Scenario.terminalFrame, d13Scenario.terminalFrame, d13Scenario.nextFrame]), 'd13');
assert.strictEqual(reductions(d13).length, 1);
assert.strictEqual(successfulAttachments(d13).length, 2);
assert.deepStrictEqual([decision(d13, 'P1').contestedGrossAward, decision(d13, 'P2').contestedGrossAward], [120, 0]);

// D14 - reload after river and before settlement restores exact semantic observations once.
var d14Game = 'showdown-d14-reload-before-settlement';
var d14Setup = initialStorage(d14Game);
var d14Scenario = frames.ordinary('showdown', 'AUTH-D14');
var d14Before = create(d14Game, d14Setup.storage);
harnessSupport.dispatchFrames(d14Before, d14Scenario.frames.slice(0, d14Scenario.splitBeforeTerminal), 'd14-before');
assert.ok(d14Before.storage[d14Setup.keys.activeHand].semanticHandLedgerSnapshot);
var d14After = create(d14Game, d14Before.storage);
harnessSupport.dispatchFrames(d14After, [d14Scenario.reloadBeforeTerminalRegistered, d14Scenario.terminalFrame, d14Scenario.nextFrame], 'd14-after');
assert.strictEqual(reductions(d14After).length, 1);
assert.strictEqual(successfulAttachments(d14After).length, 2);

// D15 - reload during/replaying settlement produces one post-reload result and one association per player.
var d15Game = 'showdown-d15-reload-during-settlement';
var d15Setup = initialStorage(d15Game);
var d15Scenario = frames.ordinary('showdown', 'AUTH-D15');
var d15Before = create(d15Game, d15Setup.storage);
harnessSupport.dispatchFrames(d15Before, d15Scenario.frames.slice(0, d15Scenario.splitBeforeTerminal), 'd15-before');
assert.strictEqual(reductions(d15Before).length, 0);
var d15After = create(d15Game, d15Before.storage);
harnessSupport.dispatchFrames(d15After, [d15Scenario.reloadBeforeTerminalRegistered, d15Scenario.terminalFrame, d15Scenario.terminalFrame, d15Scenario.nextFrame], 'd15-after');
assert.strictEqual(reductions(d15After).length, 1);
assert.strictEqual(successfulAttachments(d15After).length, 2);

// D16 - completed-hand reload produces no new reduction or association.
var d16Game = 'showdown-d16-completed-reload';
var d16Setup = initialStorage(d16Game);
var d16Scenario = frames.ordinary('showdown', 'AUTH-D16');
var d16Before = create(d16Game, d16Setup.storage);
harnessSupport.dispatchFrames(d16Before, d16Scenario.frames, 'd16-before');
assert.strictEqual(reductions(d16Before).length, 1);
// A completed production hand whose Full Log identity has reconciled is restored by its exact authoritative alias.
d16Before.storage[d16Setup.keys.finalizedHandIds].push(d16Scenario.handId);
var d16After = create(d16Game, d16Before.storage);
harnessSupport.dispatchFrames(d16After, d16Scenario.frames, 'd16-complete-replay');
assert.strictEqual(reductions(d16After).length, 1);
assert.strictEqual(reductions(d16After)[0].reduced, false);
assert.strictEqual(reductions(d16After)[0].duplicate, true);
assert.strictEqual(successfulAttachments(d16After).length, 0);

// D17 - reconnect replay in one content instance is exactly once.
var d17Game = 'showdown-d17-reconnect';
var d17Setup = initialStorage(d17Game);
var d17Scenario = frames.ordinary('showdown', 'AUTH-D17');
var d17 = create(d17Game, d17Setup.storage);
harnessSupport.dispatchFrames(d17, d17Scenario.frames.slice(0, -2).concat([
  d17Scenario.terminalFrame,
  d17Scenario.terminalFrame,
  d17Scenario.terminalFrame,
  d17Scenario.nextFrame
]), 'd17');
assert.strictEqual(reductions(d17).length, 1);
assert.strictEqual(successfulAttachments(d17).length, 2);

// D18 - lifecycle and authoritative IDs differ, lifecycle alias is preferred, and exact player IDs associate once.
var d18Semantic = harnessSupport.showdownDebugEntries(d9, 'semantic-finalization').find(function (entry) { return entry.finalized; });
assert.notStrictEqual(d18Semantic.handIdentity.lifecycleHandId, d18Semantic.handIdentity.handId);
assert.ok(successfulAttachments(d9).every(function (entry) {
  return entry.candidateHandIds[0] === d18Semantic.handIdentity.lifecycleHandId && entry.candidateHandIds[1] === d18Semantic.handIdentity.handId && entry.targetHandId === d18Semantic.handIdentity.lifecycleHandId;
}));

// D19 - recovery without the bounded semantic snapshot remains explicitly unsupported.
var d19Game = 'showdown-d19-incomplete-recovery';
var d19Setup = initialStorage(d19Game);
var d19Scenario = frames.ordinary('showdown', 'AUTH-D19');
var d19Before = create(d19Game, d19Setup.storage);
harnessSupport.dispatchFrames(d19Before, d19Scenario.frames.slice(0, d19Scenario.splitBeforeTerminal), 'd19-before');
delete d19Before.storage[d19Setup.keys.activeHand].semanticHandLedgerSnapshot;
var d19After = create(d19Game, d19Before.storage);
harnessSupport.dispatchFrames(d19After, [d19Scenario.reloadBeforeTerminalRegistered, d19Scenario.terminalFrame, d19Scenario.nextFrame], 'd19-after');
assert.strictEqual(reductions(d19After).length, 1);
assert.ok(decisions(d19After).every(function (entry) { return entry.sawFlopForWTSD === null && entry.wentToShowdown === null && entry.wonMoneyAtShowdownCandidate === null; }));
assert.ok(decisions(d19After).every(function (entry) { return entry.unsupportedReason === 'HISTORY_INCOMPLETE'; }));

// D20 - uncontested preflop hand creates no WTSD or monetary denominator.
var d20Game = 'showdown-d20-preflop';
var d20Setup = initialStorage(d20Game);
var d20 = create(d20Game, d20Setup.storage);
harnessSupport.dispatchFrames(d20, frames.preflopFold('AUTH-D20').frames, 'd20');
assert.strictEqual(reductions(d20).length, 1);
assert.ok(decisions(d20).every(function (entry) { return entry.sawFlopForWTSD === 0 && entry.wentToShowdown === 0 && entry.wonMoneyAtShowdownCandidate === null; }));

[d1, d2, d3, d4, d5, d7, d8, d11, d12].forEach(assertBoundedAuthoritativeFieldsOnly);
assertBoundedAuthoritativeFieldsOnly({ harness: d9, keys: d9Setup.keys });
assertBoundedAuthoritativeFieldsOnly({ harness: d6, keys: d6Setup.keys });

var quietGame = 'showdown-debug-default';
var quietSetup = initialStorage(quietGame);
var quiet = create(quietGame, quietSetup.storage, false);
harnessSupport.dispatchFrames(quiet, frames.ordinary('showdown', 'AUTH-QUIET').frames, 'quiet');
assert.strictEqual(harnessSupport.showdownDebugEntries(quiet).length, 0, 'showdown diagnostics are disabled by default');

var uiSource = ['overlayStats.js', 'leaderboardStats.js', 'seatOverlay.js', 'settingsUi.js', 'statTooltip.js', 'popup.js'].map(function (file) { return fs.readFileSync(file, 'utf8'); }).join('\n');
assert.match(uiSource, /\bWTSD\b/);
assert.match(uiSource, /W\$SD/);
assert.ok(d3.harness.isolatedScripts.indexOf('showdownStatsReducer.js') < d3.harness.isolatedScripts.indexOf('content.js'));

console.log('Production content-path showdown shadow D1-D20, exact identity, reload, duplicate, candidate, return, and neutrality tests passed.');
