'use strict';

var assert = require('assert');
var fs = require('fs');
var harnessSupport = require('./testSupport/productionContentScriptHarness');
var frames = require('./testSupport/showdownStatsProductionFrames');
var cbetFrames = require('./testSupport/flopCBetProductionFrames');
var a3 = require('./fixtures/capture-derived-preflop/a3-open-coldcall-squeeze-showdown-chop.sanitized.json');
var a6 = require('./fixtures/capture-derived-preflop/a6-full-allin-3bet-call-runout.sanitized.json');

var COUNTER_FIELDS = ['sawFlopForWTSD', 'wentToShowdown', 'showdownsForWSD', 'wonMoneyAtShowdown'];
var RICH_FIELDS = ['showdownOutcome', 'wonMoneyAtShowdownCandidate', 'contestedGrossAward', 'excludedReturnAmount', 'potsEligible', 'evidence'];

function plain(value) { return JSON.parse(JSON.stringify(value)); }

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
  assert.deepStrictEqual(harness.evaluationErrors, [], gameId + ' loads the production manifest without evaluation errors');
  return harness;
}

function dispatchOrdinary(kind, suffix) {
  var gameId = 'showdown-authoritative-' + suffix;
  var setup = initialStorage(gameId);
  var scenario = frames.ordinary(kind, 'AUTH-' + suffix.toUpperCase());
  var harness = create(gameId, setup.storage);
  harnessSupport.dispatchFrames(harness, scenario.frames, suffix);
  return { gameId: gameId, keys: setup.keys, scenario: scenario, harness: harness };
}

function storedEvents(run) { return run.harness.storage[run.keys.liveEvents] || []; }
function stats(run, playerName) { return plain(run.harness.context.PokerStats.computePlayerStats(storedEvents(run), playerName)); }
function counters(run, playerName) {
  var value = stats(run, playerName);
  return COUNTER_FIELDS.map(function (field) { return value[field]; });
}
function attached(run) {
  return harnessSupport.showdownDebugEntries(run.harness, 'authoritative-stats-attachment').filter(function (entry) { return entry.attached; });
}
function annotatedEvents(run) {
  return storedEvents(run).filter(function (event) { return event.showdownStatsContributionId; });
}
function assertBoundedAnnotations(run) {
  annotatedEvents(run).forEach(function (event) {
    COUNTER_FIELDS.forEach(function (field) { assert.ok(event[field] === 0 || event[field] === 1, field + ' is persisted as a binary counter'); });
    assert.strictEqual(typeof event.showdownStatsReducerVersion, 'number');
    assert.strictEqual(typeof event.showdownStatsContributionId, 'string');
    assert.strictEqual(event.showdownStatsMatchedHandId, event.handId);
    RICH_FIELDS.forEach(function (field) { assert.strictEqual(Object.prototype.hasOwnProperty.call(event, field), false, field + ' remains shadow-only'); });
  });
}

// A1 - turn fold.
var a1 = dispatchOrdinary('turn-fold', 'a1-turn-fold');
assert.deepStrictEqual(counters(a1, 'P2'), [1, 0, 0, 0]);

// A2 - river fold.
var a2 = dispatchOrdinary('river-fold', 'a2-river-fold');
assert.deepStrictEqual(counters(a2, 'P2'), [1, 0, 0, 0]);

// A3 - heads-up winner and loser.
var a3Run = dispatchOrdinary('showdown', 'a3-heads-up');
assert.deepStrictEqual(counters(a3Run, 'P1'), [1, 1, 1, 1]);
assert.deepStrictEqual(counters(a3Run, 'P2'), [1, 1, 1, 0]);
assert.strictEqual((stats(a3Run, 'P1').wentToShowdown / stats(a3Run, 'P1').sawFlopForWTSD) * 100, 100);
assert.strictEqual((stats(a3Run, 'P2').wonMoneyAtShowdown / stats(a3Run, 'P2').showdownsForWSD) * 100, 0);

// A4 - river foldout, both flop entrants receive only the WTSD denominator.
var a4 = dispatchOrdinary('river-fold', 'a4-river-foldout');
assert.deepStrictEqual(counters(a4, 'P1'), [1, 0, 0, 0]);
assert.deepStrictEqual(counters(a4, 'P2'), [1, 0, 0, 0]);

// A5 - authoritative all-in automatic runout.
var a5Game = 'showdown-authoritative-a5-allin';
var a5Setup = initialStorage(a5Game);
var a5Harness = create(a5Game, a5Setup.storage);
harnessSupport.dispatchFrames(a5Harness, cbetFrames.authoritativeFixtureFrames(a6), 'a5');
var a5 = { harness: a5Harness, keys: a5Setup.keys };
assert.deepStrictEqual(counters(a5, 'P1'), [1, 1, 1, 0]);
assert.deepStrictEqual(counters(a5, 'P2'), [1, 1, 1, 1]);

// A6 - split recipients are binary wins, not fractions.
var a6Run = dispatchOrdinary('split', 'a6-split');
assert.deepStrictEqual(counters(a6Run, 'P1'), [1, 1, 1, 1]);
assert.deepStrictEqual(counters(a6Run, 'P2'), [1, 1, 1, 1]);

// A7 - authoritative multiway showdown.
var a7Game = 'showdown-authoritative-a7-multiway';
var a7Setup = initialStorage(a7Game, ['P1', 'P2', 'P3']);
var a7Harness = create(a7Game, a7Setup.storage);
harnessSupport.dispatchFrames(a7Harness, cbetFrames.authoritativeFixtureFrames(a3), 'a7');
var a7 = { harness: a7Harness, keys: a7Setup.keys };
assert.deepStrictEqual(counters(a7, 'P1'), [1, 1, 1, 1]);
assert.deepStrictEqual(counters(a7, 'P2'), [1, 1, 1, 0]);
assert.deepStrictEqual(counters(a7, 'P3'), [1, 1, 1, 1]);

// A8 - a return-only losing participant does not receive a false numerator.
var a8 = dispatchOrdinary('return-showdown', 'a8-return');
assert.deepStrictEqual(counters(a8, 'P1'), [1, 1, 1, 1]);
assert.deepStrictEqual(counters(a8, 'P2'), [1, 1, 1, 0]);
assert.strictEqual(harnessSupport.showdownDebugEntries(a8.harness, 'wtsd-decision').find(function (entry) { return entry.playerId === 'P1'; }).excludedReturnAmount, 100);

// A9/A21 - WTSD is authoritative while missing settlement leaves W$SD untouched.
var a9 = dispatchOrdinary('missing-settlement', 'a9-missing-settlement');
assert.deepStrictEqual(counters(a9, 'P1'), [1, 1, 0, 0]);
assert.deepStrictEqual(counters(a9, 'P2'), [1, 1, 0, 0]);

// A10 - duplicate settlement frames annotate once.
var a10Game = 'showdown-authoritative-a10-duplicate';
var a10Setup = initialStorage(a10Game);
var a10Scenario = frames.ordinary('showdown', 'AUTH-A10');
var a10Harness = create(a10Game, a10Setup.storage);
harnessSupport.dispatchFrames(a10Harness, a10Scenario.frames.slice(0, -2).concat([a10Scenario.terminalFrame, a10Scenario.terminalFrame, a10Scenario.nextFrame]), 'a10');
var a10 = { harness: a10Harness, keys: a10Setup.keys };
assert.deepStrictEqual(counters(a10, 'P1'), [1, 1, 1, 1]);
assert.strictEqual(annotatedEvents(a10).filter(function (event) { return event.playerId === 'P1'; }).length, 1);

// A11 - reload before settlement produces and persists one eventual contribution.
var a11Game = 'showdown-authoritative-a11-reload-before';
var a11Setup = initialStorage(a11Game);
var a11Scenario = frames.ordinary('showdown', 'AUTH-A11');
var a11Before = create(a11Game, a11Setup.storage);
harnessSupport.dispatchFrames(a11Before, a11Scenario.frames.slice(0, a11Scenario.splitBeforeTerminal), 'a11-before');
var a11After = create(a11Game, a11Before.storage);
harnessSupport.dispatchFrames(a11After, [a11Scenario.reloadBeforeTerminalRegistered, a11Scenario.terminalFrame, a11Scenario.nextFrame], 'a11-after');
var a11 = { harness: a11After, keys: a11Setup.keys };
assert.deepStrictEqual(counters(a11, 'P1'), [1, 1, 1, 1]);
assert.strictEqual(annotatedEvents(a11).filter(function (event) { return event.playerId === 'P1'; }).length, 1);

// A12 - reload during repeated settlement does not double a denominator or award.
var a12Game = 'showdown-authoritative-a12-reload-during';
var a12Setup = initialStorage(a12Game);
var a12Scenario = frames.ordinary('showdown', 'AUTH-A12');
var a12Before = create(a12Game, a12Setup.storage);
harnessSupport.dispatchFrames(a12Before, a12Scenario.frames.slice(0, a12Scenario.splitBeforeTerminal), 'a12-before');
var a12After = create(a12Game, a12Before.storage);
harnessSupport.dispatchFrames(a12After, [a12Scenario.reloadBeforeTerminalRegistered, a12Scenario.terminalFrame, a12Scenario.terminalFrame, a12Scenario.nextFrame], 'a12-after');
var a12 = { harness: a12After, keys: a12Setup.keys };
assert.deepStrictEqual(counters(a12, 'P1'), [1, 1, 1, 1]);

// A13 - completed-hand restoration rejects an exact authoritative alias replay.
var a13Game = 'showdown-authoritative-a13-completed';
var a13Setup = initialStorage(a13Game);
var a13Scenario = frames.ordinary('showdown', 'AUTH-A13');
var a13Before = create(a13Game, a13Setup.storage);
harnessSupport.dispatchFrames(a13Before, a13Scenario.frames, 'a13-before');
a13Before.storage[a13Setup.keys.finalizedHandIds].push(a13Scenario.handId);
var a13After = create(a13Game, a13Before.storage);
harnessSupport.dispatchFrames(a13After, a13Scenario.frames, 'a13-after');
var a13 = { harness: a13After, keys: a13Setup.keys };
assert.deepStrictEqual(counters(a13, 'P1'), [1, 1, 1, 1]);
assert.strictEqual(attached(a13).length, 0, 'restored exact identity prevents an additional authoritative annotation');

// A14 - completed-hand terminal replay in one lifecycle is exactly once.
var a14Game = 'showdown-authoritative-a14-reconnect';
var a14Setup = initialStorage(a14Game);
var a14Scenario = frames.ordinary('showdown', 'AUTH-A14');
var a14Harness = create(a14Game, a14Setup.storage);
harnessSupport.dispatchFrames(a14Harness, a14Scenario.frames.slice(0, -2).concat([a14Scenario.terminalFrame, a14Scenario.terminalFrame, a14Scenario.terminalFrame, a14Scenario.nextFrame]), 'a14');
var a14 = { harness: a14Harness, keys: a14Setup.keys };
assert.deepStrictEqual(counters(a14, 'P1'), [1, 1, 1, 1]);
assert.strictEqual(attached(a14).filter(function (entry) { return entry.playerId === 'P1'; }).length, 1);

// A15 - lifecycle identity differs from authoritative identity and is preferred exactly.
var a15Semantic = harnessSupport.showdownDebugEntries(a7Harness, 'semantic-finalization').find(function (entry) { return entry.finalized; });
assert.notStrictEqual(a15Semantic.handIdentity.lifecycleHandId, a15Semantic.handIdentity.handId);
assert.ok(attached(a7).every(function (entry) {
  return entry.candidateHandIds[0] === a15Semantic.handIdentity.lifecycleHandId &&
    entry.candidateHandIds[1] === a15Semantic.handIdentity.handId &&
    entry.targetHandId === a15Semantic.handIdentity.lifecycleHandId;
}));

// A16 - incomplete recovered history creates no false counters.
var a16Game = 'showdown-authoritative-a16-recovery';
var a16Setup = initialStorage(a16Game);
var a16Scenario = frames.ordinary('showdown', 'AUTH-A16');
var a16Before = create(a16Game, a16Setup.storage);
harnessSupport.dispatchFrames(a16Before, a16Scenario.frames.slice(0, a16Scenario.splitBeforeTerminal), 'a16-before');
delete a16Before.storage[a16Setup.keys.activeHand].semanticHandLedgerSnapshot;
var a16After = create(a16Game, a16Before.storage);
harnessSupport.dispatchFrames(a16After, [a16Scenario.reloadBeforeTerminalRegistered, a16Scenario.terminalFrame, a16Scenario.nextFrame], 'a16-after');
var a16 = { harness: a16After, keys: a16Setup.keys };
assert.deepStrictEqual(counters(a16, 'P1'), [0, 0, 0, 0]);
assert.strictEqual(annotatedEvents(a16).length, 0);

// A17 - legacy events normalize missing counters without changing existing statistics.
var a17Game = 'showdown-authoritative-a17-legacy';
var a17Setup = initialStorage(a17Game, ['LEGACY']);
a17Setup.storage[a17Setup.keys.liveEvents] = [{ handId: 'legacy-hand', playerId: 'LEGACY', player: 'Legacy', action: 'raise', street: 'preflop', amount: 60, timestamp: 1, threeBetMade: 1, threeBetOpportunities: 1, flopCBetMade: 1, flopCBetOpportunities: 1 }];
a17Setup.storage[a17Setup.keys.finalizedHandIds] = ['legacy-hand'];
var a17Harness = create(a17Game, a17Setup.storage);
var a17 = { harness: a17Harness, keys: a17Setup.keys };
assert.deepStrictEqual(counters(a17, 'Legacy'), [0, 0, 0, 0]);
assert.deepStrictEqual([stats(a17, 'Legacy').vpipHands, stats(a17, 'Legacy').pfrHands, stats(a17, 'Legacy').threeBetMade, stats(a17, 'Legacy').flopCBetMade], [1, 1, 1, 1]);

// A18 - seat metadata and restoration do not change stable-player counter ownership.
var a18Storage = plain(a3Run.harness.storage);
a18Storage[a3Run.keys.liveEvents].forEach(function (event) {
  if (event.playerId === 'P1') event.seat = 9;
});
var a18Harness = create(a3Run.gameId, a18Storage);
var a18 = { harness: a18Harness, keys: a3Run.keys };
assert.deepStrictEqual(counters(a18, 'P1'), [1, 1, 1, 1]);
assert.strictEqual(annotatedEvents(a18).find(function (event) { return event.playerId === 'P1'; }).seat, 9);

// A19 - the existing session reset storage contract clears all four counters.
var a19Storage = plain(a3Run.harness.storage);
a19Storage[a3Run.keys.liveEvents] = [];
a19Storage[a3Run.keys.finalizedHandIds] = [];
a19Storage[a3Run.keys.activeHand] = null;
var a19Harness = create(a3Run.gameId, a19Storage);
var a19 = { harness: a19Harness, keys: a3Run.keys };
assert.deepStrictEqual(counters(a19, 'P1'), [0, 0, 0, 0]);
var contentSource = fs.readFileSync('./content.js', 'utf8');
assert.ok(contentSource.includes('liveEvents = [];') && contentSource.includes('showdownStatsState = PokerShowdownStatsReducer.createState'), 'Reset Session clears live events and recreates showdown reducer state');

// A20 - supported-only multi-hand aggregation.
function eventsFor(run, playerId, handSuffix) {
  return storedEvents(run).filter(function (event) { return event.playerId === playerId; }).map(function (event) {
    return Object.assign({}, event, { handId: String(event.handId) + ':' + handSuffix, playerId: 'MIX', player: 'Mixed Player' });
  });
}
var mixedEvents = []
  .concat(eventsFor(a1, 'P2', 'fold'))
  .concat(eventsFor(a3Run, 'P1', 'win'))
  .concat(eventsFor(a3Run, 'P2', 'loss'))
  .concat(eventsFor(a6Run, 'P1', 'split'))
  .concat(eventsFor(a9, 'P1', 'missing'))
  .concat(eventsFor(a16, 'P1', 'unsupported'));
var mixedStats = plain(a3Run.harness.context.PokerStats.computePlayerStats(mixedEvents, 'Mixed Player'));
assert.deepStrictEqual(COUNTER_FIELDS.map(function (field) { return mixedStats[field]; }), [5, 4, 3, 2]);

[a1, a2, a3Run, a4, a5, a6Run, a7, a8, a9, a10, a11, a12, a13, a14, a17, a18].forEach(assertBoundedAnnotations);
assert.strictEqual(JSON.stringify(a3Run.harness.storage).includes('showdownStatsContributionId'), true, 'authoritative annotations persist through the existing live-events key');
assert.strictEqual(Object.keys(a3Run.harness.storage).some(function (key) { return /^pokerNowHud(?:Showdown|WTSD|WSD)/i.test(key); }), false, 'no showdown-specific storage key is introduced');

var uiSource = ['overlayStats.js', 'leaderboardStats.js', 'seatOverlay.js', 'settingsUi.js', 'statTooltip.js', 'popup.js'].map(function (file) { return fs.readFileSync(file, 'utf8'); }).join('\n');
assert.match(uiSource, /\bWTSD\b/);
assert.match(uiSource, /W\$SD/);
assert.ok(contentSource.includes("var LIVE_SCHEMA_VERSION = 4;"), 'missing numeric fields normalize without a persistence schema migration');
assert.ok(contentSource.includes('globalThis.PokerNowRuntimeScope.buildId'), 'content consumes the shared V1.4 Build ID');

console.log('Authoritative showdown A1-A21 ingestion, persistence, exact identity, reset, legacy, and aggregation tests passed.');
