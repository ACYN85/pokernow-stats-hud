'use strict';

var assert = require('assert');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = __dirname;

function read(fileName) {
  return fs.readFileSync(path.join(root, fileName), 'utf8');
}

function hash(fileName) {
  return crypto.createHash('sha256').update(read(fileName)).digest('hex');
}

function count(source, expression) {
  return (source.match(expression) || []).length;
}

function betweenFunctions(source, currentName, nextName) {
  var start = source.indexOf('function ' + currentName + '(');
  var end = source.indexOf('function ' + nextName + '(', start + 1);
  assert.ok(start >= 0, currentName + ' must exist');
  assert.ok(end > start, nextName + ' must follow ' + currentName);
  return source.slice(start, end);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function visibleContract(stats, overlayStats, leaderboardStats, seatOverlay, runtime, events) {
  var alice = stats.computePlayerStats(events, 'Alice');
  var ids = overlayStats.DEFAULT_DISPLAYED_STAT_IDS.slice();
  return {
    stats: alice,
    defaultIds: ids,
    catalogIds: Object.keys(overlayStats.STAT_CATALOG),
    definitions: overlayStats.definitionsFor(ids).map(function (definition) {
      return {
        id: definition.id,
        label: definition.label,
        shortLabel: definition.shortLabel,
        tableLabel: definition.tableLabel,
        value: definition.formatValue(definition.getValue(alice))
      };
    }),
    leaderboardDefaults: clone(leaderboardStats.DEFAULTS),
    seatOverlayLabel: seatOverlay.compactStatsLabel(alice, ids),
    statuses: {
      live: runtime.presentation('live'),
      paused: runtime.presentation('live-socket'),
      waiting: runtime.presentation('waiting'),
      connecting: runtime.presentation('initializing'),
      disconnected: runtime.presentation('disconnected')
    }
  };
}

var protectedFiles = [
  'semanticHandLedger.js',
  'handFinalization.js',
  'stats.js',
  'overlayStats.js',
  'leaderboardStats.js',
  'seatOverlay.js',
  'hudRuntimeStatus.js',
  'popup.js',
  'popup.html',
  'hud.css'
];
var hashesBefore = Object.fromEntries(protectedFiles.map(function (fileName) {
  return [fileName, hash(fileName)];
}));

var reducerSource = read('preflopOpportunityReducer.js');
var contentSource = read('content.js');
var manifest = JSON.parse(read('manifest.json'));

assert.doesNotMatch(reducerSource, /\b(?:document|MutationObserver|WebSocket|XMLHttpRequest)\b|querySelector|createElement|appendChild|innerHTML/, 'the reducer has no DOM or WebSocket dependency');
assert.doesNotMatch(reducerSource, /chrome\s*\.\s*storage|\b(?:localStorage|sessionStorage)\b/, 'the reducer performs no persistence');
assert.doesNotMatch(reducerSource, /\b(?:addEventListener|removeEventListener|setTimeout|setInterval|requestAnimationFrame|cancelAnimationFrame)\b/, 'the reducer installs no listeners or timers');
assert.doesNotMatch(reducerSource, /\bconsole\s*\./, 'the reducer does not log during normal production use');
assert.doesNotMatch(reducerSource, /\b(?:render|refreshHud|PokerStats|PokerOverlayStats|PokerLeaderboardStats|PokerSeatOverlay|PokerHudRuntimeStatus)\b/, 'the reducer has no statistic, renderer, overlay, or runtime-label dependency');
assert.doesNotMatch(reducerSource, /testSupport|rawFixtureFactExtractor|fixtures[\\/]+raw-websocket|\brequire\s*\(/, 'the production reducer imports no test-only or CommonJS dependency');

var forbiddenAccesses = [];
var sandbox = {
  module: { exports: {} },
  exports: {},
  window: undefined
};
[
  'document',
  'chrome',
  'WebSocket',
  'MutationObserver',
  'XMLHttpRequest',
  'fetch',
  'addEventListener',
  'removeEventListener',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'console'
].forEach(function (name) {
  Object.defineProperty(sandbox, name, {
    configurable: true,
    get: function () {
      forbiddenAccesses.push(name);
      throw new Error('forbidden runtime dependency accessed: ' + name);
    }
  });
});
vm.createContext(sandbox);
vm.runInContext(reducerSource, sandbox, { filename: 'preflopOpportunityReducer.js' });

var vmReducer = sandbox.PokerPreflopOpportunityReducer;
assert.ok(vmReducer, 'the reducer registers its isolated-world global without another module');
assert.strictEqual(sandbox.module.exports, vmReducer, 'the CommonJS test export and production global expose the same pure API');
assert.deepStrictEqual(forbiddenAccesses, [], 'module evaluation accesses no DOM, storage, transport, listener, timer, or console surface');

var finalizedRecord = {
  schemaVersion: 1,
  status: 'finalized',
  handIdentity: { handId: 'neutral-shadow-hand', lifecycleHandId: 'lifecycle-neutral-shadow-hand' },
  players: [
    { playerId: 'opener', startingStack: 500 },
    { playerId: 'three-bettor', startingStack: 500 }
  ],
  actions: [
    {
      sequence: 1,
      sourceSequence: 10,
      street: 'preflop',
      playerId: 'opener',
      type: 'raise',
      amountTo: 60,
      minimumRaiseToBefore: 40,
      isAllIn: null,
      isFullRaise: true,
      isShortAllInRaise: null,
      confidence: 'proven'
    },
    {
      sequence: 2,
      sourceSequence: 11,
      street: 'preflop',
      playerId: 'three-bettor',
      type: 'raise',
      amountTo: 180,
      minimumRaiseToBefore: 100,
      isAllIn: null,
      isFullRaise: true,
      isShortAllInRaise: null,
      confidence: 'proven'
    },
    {
      sequence: 3,
      sourceSequence: 12,
      street: 'preflop',
      playerId: 'opener',
      type: 'fold',
      amountTo: null,
      minimumRaiseToBefore: 300,
      isAllIn: null,
      isFullRaise: null,
      isShortAllInRaise: null,
      confidence: 'proven'
    }
  ],
  streets: { preflop: { entrants: ['opener', 'three-bettor'] } },
  preflopRoles: { openingAggressor: 'opener', threeBettor: 'three-bettor' },
  ambiguities: [],
  provenance: {
    finalizationReason: 'accepted production hand commit',
    historyComplete: true,
    recovered: false
  }
};

var vmState = vmReducer.createState({ maxRecords: 2, maxAttempts: 10, maxPlayers: 10 });
var vmReduction = vmReducer.reduce(vmState, finalizedRecord);
assert.strictEqual(vmReduction.reduced, true, 'the isolated pure reducer can reduce a finalized semantic record');
assert.deepStrictEqual(forbiddenAccesses, [], 'record reduction accesses no forbidden production surface');
var vmInspection = JSON.parse(JSON.stringify(vmReducer.inspect(vmState)));
assert.deepStrictEqual(vmInspection.bounds, {
  maxContributionRecords: 2,
  maxReductionAttempts: 10,
  maxPlayerTotals: 10,
  reducedIdentitySet: 'session-scoped; cleared by Reset Session'
}, 'inspection exposes explicit bounded-history and session-reset contracts');
assert.strictEqual(vmInspection.contributionRecords.length, 1);
assert.strictEqual(vmInspection.reductionAttempts.length, 1);

var mainBlock = manifest.content_scripts.find(function (entry) { return entry.world === 'MAIN'; });
var isolatedBlock = manifest.content_scripts.find(function (entry) { return !entry.world || entry.world === 'ISOLATED'; });
assert.ok(mainBlock && isolatedBlock, 'the manifest retains separate MAIN and isolated-world blocks');
assert.ok(!mainBlock.js.includes('preflopOpportunityReducer.js'), 'the shadow reducer is never injected into MAIN/page world');
var ledgerIndex = isolatedBlock.js.indexOf('semanticHandLedger.js');
var reducerIndex = isolatedBlock.js.indexOf('preflopOpportunityReducer.js');
var firstUiIndex = isolatedBlock.js.indexOf('overlayStats.js');
var contentIndex = isolatedBlock.js.indexOf('content.js');
assert.strictEqual(reducerIndex, ledgerIndex + 1, 'the reducer loads immediately after the finalized semantic ledger');
assert.ok(reducerIndex < firstUiIndex && reducerIndex < contentIndex, 'the reducer loads before UI modules and content initialization');
assert.strictEqual(isolatedBlock.js.filter(function (fileName) { return fileName === 'preflopOpportunityReducer.js'; }).length, 1, 'the reducer is packaged exactly once');
assert.doesNotMatch(JSON.stringify(manifest), /testSupport|rawFixtureFactExtractor|fixtures[\\/]|\.test\.js/, 'no test-only reducer or fixture asset enters the extension manifest');

assert.match(contentSource, /\['PokerPreflopOpportunityReducer',\s*globalThis\.PokerPreflopOpportunityReducer,\s*'preflopOpportunityReducer\.js'\]/, 'stage 1.4 retains a required-module assertion for the exact reducer global');
assert.strictEqual(count(contentSource, /PokerPreflopOpportunityReducer\.reduce\s*\(/g), 1, 'production has one reducer entry point');
var commitBlock = betweenFunctions(contentSource, 'applyHandCommitResult', 'beginStatsHand');
assert.match(commitBlock, /var semanticResult\s*=\s*PokerSemanticHandLedger\.finalize\(/, 'the reducer consumes the semantic finalization result rather than raw frames');
assert.match(commitBlock, /if\s*\(\s*semanticResult\.finalized\s*&&\s*semanticResult\.record\s*\)\s*\{[\s\S]*?var reductionResult\s*=\s*PokerPreflopOpportunityReducer\.reduce\(preflopOpportunityState,\s*semanticResult\.record\);[\s\S]*?applyFinalizedPreflopContribution\(result,\s*reductionResult,\s*finalizedRange\);/, 'only a newly finalized semantic record reaches the reducer and hand-local authoritative stats seam, with optional later shadow reducers inside the same finalized-record guard');
assert.doesNotMatch(contentSource.replace(commitBlock, ''), /PokerPreflopOpportunityReducer\.reduce\s*\(/, 'no competing reduction path exists');

assert.match(contentSource, /preflopOpportunityState\s*=\s*PokerPreflopOpportunityReducer\.createState\(\{\s*finalizedHandIds:\s*restoredFinalizedIds\s*\|\|\s*\[\],\s*maxRecords:\s*50,\s*maxAttempts:\s*100,\s*maxPlayers:\s*200\s*\}\)/, 'storage restore seeds reducer duplicate exclusion while live counters restore through finalized events');
var resetBlock = betweenFunctions(contentSource, 'resetCurrentSession', 'refreshHud');
assert.match(resetBlock, /handAccounting\s*=\s*PokerHandFinalization\.createState\(\{\s*finalizedEvents:\s*\[\]\s*\}\);\s*semanticLedgerState\s*=\s*PokerSemanticHandLedger\.createState\([\s\S]*?preflopOpportunityState\s*=\s*PokerPreflopOpportunityReducer\.createState\(\{\s*maxRecords:\s*50,\s*maxAttempts:\s*100,\s*maxPlayers:\s*200\s*\}\);/, 'Reset Session recreates and clears semantic and preflop shadow state');
assert.match(contentSource, /shadowPreflopOpportunities:\s*PokerPreflopOpportunityReducer\.inspect\(preflopOpportunityState\)/, 'bounded reducer inspection is available through existing development diagnostics');
assert.strictEqual(count(contentSource, /PokerPreflopOpportunityReducer\.createState\s*\(/g), 3, 'shadow state exists only for initial creation, restore, and Reset Session');

var storageBlockMatch = contentSource.match(/var STORAGE_KEYS\s*=\s*\{([\s\S]*?)\n  \};/);
assert.ok(storageBlockMatch, 'the production storage-key registry is inspectable');
var storageKeyNames = Array.from(storageBlockMatch[1].matchAll(/^\s{4}([A-Za-z0-9_]+):/gm)).map(function (match) { return match[1]; });
assert.deepStrictEqual(storageKeyNames, [
  'session',
  'allTime',
  'live',
  'liveRevision',
  'fingerprints',
  'schema',
  'playerMap',
  'handSignatures',
  'activeHand',
  'finalizedHandIds',
  'hostControl',
  'potOddsBoardReset',
  'sessionMeta',
  'playerDashboard',
  'mode',
  'displayMode',
  'showOverlayBoxes',
  'debugSeatIdentity',
  'showWithheldPlaceholders',
  'presentationPreferencesSchema',
  'overlayDraggingUnlocked',
  'manualOverlayPositions',
  'overlayStatPreferences',
  'leaderboardStatPreferences',
  'leaderboardHudPosition',
  'hudUiPreferences',
  'diagnosticsLevel',
  'pauseLifecycleCaptureEnabled',
  'playerNotes'
], 'the storage registry contains the per-game Dashboard state but no shadow-stat persistence key');
assert.doesNotMatch(storageBlockMatch[0], /preflop|three.?bet|fold.?to/i);
assert.strictEqual(count(contentSource, /chrome\.storage\.local\.set\s*\(/g), 25, 'storage write sites remain bounded with the Dashboard visibility preference');
assert.strictEqual(count(contentSource, /queueAuthoritativeStorageSnapshot\s*\(/g), 3, 'one queue definition plus revision-aware hand-accounting persistence and explicit reset share the ordered authoritative snapshot path');
assert.match(contentSource, /function reconcileSocketHandId[\s\S]*?persistHandAccounting\(null, 'authoritative hand identity correction'\);/, 'hand-ID reconciliation now enters the same revision-aware persistence planner');
assert.strictEqual(count(contentSource, /chrome\.storage\.local\.get\s*\(/g), 4, 'ordinary startup reads remain bounded; the only additional full-key read is the explicit user-triggered Reset Seat HUD Positions action');
assert.match(contentSource, /function resetOverlayPositions[\s\S]*?chrome\.storage\.local\.get\(null,[\s\S]*?chrome\.storage\.local\.remove\(keys/, 'the explicit reset enumerates only to clear every per-game Seat HUD manual-offset namespace');
assert.strictEqual(count(contentSource, /chrome\.storage\.local\.getKeys\s*\(/g), 0, 'the content context never enumerates career storage keys');

assert.strictEqual(count(contentSource, /\.addEventListener\s*\(/g), 66, 'listener declarations remain bounded; the three V1.1 additions are the single-root Tracked Players click/input/change handlers');
assert.strictEqual(count(contentSource, /window\.addEventListener\s*\(/g), 6, 'no extra window listener was introduced');
assert.strictEqual(count(contentSource, /document\.addEventListener\s*\(/g), 25, 'the single controller-claim listener is added while Pot Odds retains only bounded move/up/cancel drag listeners and no visibility listener returns');
assert.strictEqual(count(contentSource, /new\s+MutationObserver\s*\(/g), 6, 'only the current hero seat/card observer remains from the pot-odds integration');
assert.doesNotMatch(contentSource, /potOddsIntegrityObserver|heroPotOddsIntegrityIssue/, 'pot odds do not observe their own extension-owned root attributes or styles');
assert.match(contentSource, /heroPotOddsAnchorMutationObserver\.observe\(observerElement, \{ childList: true, subtree: true \}\)/, 'pot-odds replacement observation is child-list-only and scoped to the current board or hero fallback anchor');
assert.strictEqual(count(contentSource, /chrome\.runtime\.onMessage\.addListener\s*\(/g), 1, 'the runtime message listener contract is unchanged');

assert.ok(read('overlayStats.js').includes("shortLabel: '3B'"), 'validated 3Bet is intentionally exposed through the shared registry');
assert.ok(read('overlayStats.js').includes("shortLabel: 'F3B'"), 'validated Fold-to-3Bet is intentionally exposed through the shared registry');
[
  'semanticHandLedger.js',
  'stats.js',
  'overlayStats.js',
  'leaderboardStats.js',
  'seatOverlay.js',
  'hudRuntimeStatus.js',
  'popup.js',
  'popup.html',
  'hud.css'
].forEach(function (fileName) {
  assert.doesNotMatch(read(fileName), /PokerPreflopOpportunityReducer|preflopOpportunityReducer|shadowPreflopOpportunities/, fileName + ' remains isolated from the new reducer');
});

var stats = require('./stats.js');
var overlayStats = require('./overlayStats.js');
var leaderboardStats = require('./leaderboardStats.js');
var seatOverlay = require('./seatOverlay.js');
var runtime = require('./hudRuntimeStatus.js');
var reducer = require('./preflopOpportunityReducer.js');
var events = [
  { handId: 'visible-contract', player: 'Alice', action: 'dealt', street: 'preflop' },
  { handId: 'visible-contract', player: 'Alice', action: 'raise', street: 'preflop', amount: 20 },
  { handId: 'visible-contract', player: 'Alice', action: 'bet', street: 'flop', amount: 30 },
  { handId: 'visible-contract', player: 'Bob', action: 'dealt', street: 'preflop' },
  { handId: 'visible-contract', player: 'Bob', action: 'call', street: 'preflop', amount: 20 },
  { handId: 'visible-contract', player: 'Bob', action: 'call', street: 'flop', amount: 30 }
];
var eventsReference = events;
var eventsBytesBefore = JSON.stringify(events);
var visibleBefore = visibleContract(stats, overlayStats, leaderboardStats, seatOverlay, runtime, events);

assert.deepStrictEqual(visibleBefore.defaultIds, ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']);
assert.deepStrictEqual(visibleBefore.catalogIds, ['hands', 'vpip', 'pfr', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd', 'af']);
assert.deepStrictEqual(visibleBefore.leaderboardDefaults, {
  version: 2,
  syncWithOverlay: true,
  displayedStatIds: ['hands', 'vpip', 'pfr', 'af', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']
});
assert.strictEqual(visibleBefore.seatOverlayLabel, 'H 1 | VPIP 100% | PFR 100% | AF \u221e | 3B --- | F3B --- | CB --- | FCB --- | WTSD --- | W$SD ---');
assert.deepStrictEqual(visibleBefore.statuses, {
  live: { label: 'Live', note: 'PokerNow game is actively running.' },
  paused: { label: 'Paused', note: 'PokerNow game is paused.' },
  waiting: { label: 'Waiting', note: 'PokerNow connected · waiting for the game to resume' },
  connecting: { label: 'Connecting…', note: 'Connecting to the PokerNow game state' },
  disconnected: { label: 'Disconnected', note: 'PokerNow socket unavailable' }
});

var directState = reducer.createState({ maxRecords: 2, maxAttempts: 10, maxPlayers: 10 });
assert.strictEqual(reducer.reduce(directState, clone(finalizedRecord)).reduced, true);
assert.strictEqual(events, eventsReference, 'shadow reduction preserves the production statistic-event array identity');
assert.strictEqual(JSON.stringify(events), eventsBytesBefore, 'shadow reduction does not mutate a production statistic event');
assert.deepStrictEqual(visibleContract(stats, overlayStats, leaderboardStats, seatOverlay, runtime, events), visibleBefore, 'direct shadow reduction leaves all computed statistics, overlays, registries, and runtime labels value-for-value unchanged');

var popupHtml = read('popup.html');
assert.deepStrictEqual(Array.from(popupHtml.matchAll(/data-mode="([^"]+)"/g)).map(function (match) { return match[1]; }), ['session', 'allTime'], 'popup statistic ranges remain unchanged');
assert.deepStrictEqual(Array.from(popupHtml.matchAll(/data-display-mode="([^"]+)"/g)).map(function (match) { return match[1]; }), ['seat-overlays-only', 'seat-overlays-leaderboard', 'leaderboard-only', 'hidden'], 'popup exposes the four canonical HUD visibility combinations without changing statistic ranges');

var hashesAfter = Object.fromEntries(protectedFiles.map(function (fileName) {
  return [fileName, hash(fileName)];
}));
assert.deepStrictEqual(hashesAfter, hashesBefore, 'exercising the shadow reducer does not mutate semantic-ledger, stats, UI, popup, or runtime module files');

console.log('Shadow reducer remains bounded, finalized-record-only, non-persistent, listener-free, and inert until its finalized contribution is explicitly integrated.');
