'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var harnessSupport = require('./testSupport/productionContentScriptHarness');

var source = fs.readFileSync(path.join(__dirname, 'showdownDiagnosticExporter.js'), 'utf8');

function loadWorld(backing, isolated, initiallyEnabled) {
  var contextObject = {
    sessionStorage: harnessSupport.createSessionStorage(backing),
    console: { log: function () {}, warn: function () {}, error: function () {} },
    Date: Date,
    Math: Math
  };
  if (isolated) contextObject.chrome = { runtime: { id: 'showdown-diagnostic-test' } };
  if (initiallyEnabled) contextObject.__PNHUD_SHOWDOWN_DEBUG__ = true;
  contextObject.globalThis = contextObject;
  var context = vm.createContext(contextObject);
  vm.runInContext(source, context, { filename: 'showdownDiagnosticExporter.js' });
  return context;
}

function exportFrom(context) {
  return JSON.parse(vm.runInContext('JSON.stringify(PokerNowHUDDebug.exportShowdownDiagnostics())', context));
}

function recordSuccessfulHand(context, handId) {
  var exporter = context.PokerShowdownDiagnosticExporter;
  var identity = { lifecycleHandId: handId, handId: 'AUTH-' + handId };
  exporter.record('first-post-break-hand', { lifecycleHandId: handId, authoritativeHandId: identity.handId, stablePlayerIds: ['P1', 'P2'], breakEpoch: 2 });
  exporter.record('finalization-readiness', { lifecycleHandId: handId, authoritativeHandId: identity.handId, lifecycleState: 'inGame', ready: true, settlementObserved: true, settlementRetained: true, terminalPhaseKnown: true });
  exporter.record('finalization-attempt', { lifecycleHandId: handId, authoritativeHandId: identity.handId, ready: true, committed: true, reason: 'terminal evidence complete' });
  exporter.record('semantic-finalization', {
    lifecycleHandId: handId,
    finalized: true,
    reason: 'terminal evidence complete',
    handIdentity: identity,
    playerIds: ['P1', 'P2'],
    actions: [{ sequence: 1, street: 'preflop', playerId: 'P1', type: 'raise' }]
  });
  exporter.record('showdown-evidence-completeness', {
    handIdentity: identity,
    flopEntrantPlayerIds: ['P1', 'P2'],
    showdownDetected: true,
    showdownParticipantIds: ['P1', 'P2'],
    playerStates: [{ playerId: 'P1', folded: false, allIn: false, reachedShowdown: true }, { playerId: 'P2', folded: false, allIn: false, reachedShowdown: true }]
  });
  exporter.record('settlement-completeness', { handIdentity: identity, status: 'resolved', awardCount: 1, awardPlayerIds: ['P1'] });
  exporter.record('reducer-invocation', {
    phase: 'after', handId: identity.handId, identityAliases: [handId, identity.handId], reduced: true,
    outputs: {
      P1: { sawFlopForWTSD: 1, wentToShowdown: 1, wonMoneyAtShowdownCandidate: 1, wonMoneyAtShowdownCandidateSupported: true },
      P2: { sawFlopForWTSD: 1, wentToShowdown: 1, wonMoneyAtShowdownCandidate: 0, wonMoneyAtShowdownCandidateSupported: true }
    }
  });
  ['P1', 'P2'].forEach(function (playerId) {
    var won = playerId === 'P1' ? 1 : 0;
    var contributionId = 'showdown:1:' + handId + ':' + playerId;
    exporter.record('stats-ingestion', {
      candidateHandIds: [handId, identity.handId], contributionId: contributionId, eventId: handId + ':' + playerId,
      targetHandId: handId, playerId: playerId, attached: true, skipped: false,
      after: { sawFlopForWTSD: 1, wentToShowdown: 1, showdownsForWSD: 1, wonMoneyAtShowdown: won }
    });
  });
  exporter.record('persistence-save', {
    events: ['P1', 'P2'].map(function (playerId) {
      return {
        eventId: handId + ':' + playerId, handId: handId, playerId: playerId,
        contributionId: 'showdown:1:' + handId + ':' + playerId,
        fields: { sawFlopForWTSD: 1, wentToShowdown: 1, showdownsForWSD: 1, wonMoneyAtShowdown: playerId === 'P1' ? 1 : 0 }
      };
    })
  });
  ['P1', 'P2'].forEach(function (playerId) {
    exporter.record('stats-aggregation', {
      handId: handId, playerId: playerId,
      countersBefore: { sawFlopForWTSD: 0, wentToShowdown: 0, showdownsForWSD: 0, wonMoneyAtShowdown: 0 },
      countersAfter: { sawFlopForWTSD: 1, wentToShowdown: 1, showdownsForWSD: 1, wonMoneyAtShowdown: playerId === 'P1' ? 1 : 0 }
    });
    exporter.record('rendered-totals', {
      candidateHandIds: [handId], playerId: playerId, surface: 'leaderboard',
      fields: { sawFlopForWTSD: 1, wentToShowdown: 1, showdownsForWSD: 1, wonMoneyAtShowdown: playerId === 'P1' ? 1 : 0 },
      formattedWTSD: '100%', formattedWSD: playerId === 'P1' ? '100%' : '0%'
    });
  });
}

var shared = {};
var page = loadWorld(shared, false, false);
assert.ok(page.PokerNowHUDDebug, 'page-world PokerNowHUDDebug exists');
assert.strictEqual(typeof page.PokerNowHUDDebug.exportShowdownDiagnostics, 'function');
assert.strictEqual(typeof page.PokerNowHUDDebug.latestShowdownDiagnostic, 'function');
assert.strictEqual(typeof page.PokerNowHUDDebug.clearShowdownDiagnostics, 'function');
assert.strictEqual(exportFrom(page).enabled, false, 'diagnostics are disabled by default');

var neutralStats = { sawFlopForWTSD: 4, wentToShowdown: 2, showdownsForWSD: 2, wonMoneyAtShowdown: 1 };
var neutralBefore = JSON.stringify(neutralStats);
assert.strictEqual(page.PokerShowdownDiagnosticExporter.record('semantic-finalization', { lifecycleHandId: 'OFF' }), false, 'disabled collector ignores records');
assert.strictEqual(exportFrom(page).hands.length, 0, 'disabled collector remains empty');
assert.strictEqual(JSON.stringify(neutralStats), neutralBefore, 'enabling/collection does not mutate statistics');

vm.runInContext('__PNHUD_SHOWDOWN_DEBUG__ = true', page);
var isolated = loadWorld(shared, true, false);
assert.strictEqual(isolated.PokerShowdownDiagnosticExporter.enabled(), true, 'page flag bridges to the isolated collector');
recordSuccessfulHand(isolated, 'GOOD-1');
var successful = exportFrom(page);
assert.strictEqual(successful.hands.length, 1);
assert.strictEqual(successful.hands[0].classification, 'counted_correctly', 'successful trace covers reducer through rendering');
assert.deepStrictEqual(successful.hands[0].stablePlayerIds, ['P1', 'P2']);
assert.strictEqual(successful.hands[0].reducerInvocationCount, 1);
assert.ok(successful.hands[0].contributionIds.length >= 2);
assert.doesNotThrow(function () { JSON.stringify(successful); }, 'export is JSON-safe');

isolated.PokerShowdownDiagnosticExporter.record('semantic-finalization', {
  lifecycleHandId: 'GOOD-1',
  holeCards: ['As', 'Kh'],
  chatContent: 'private chat marker',
  rawWebSocket: { cards: ['As', 'Kh'] },
  currentState: { privateCards: ['As', 'Kh'], accessToken: 'secret-token-value' },
  safeCycle: (function () { var value = {}; value.self = value; return value; })()
});
var redactedText = JSON.stringify(exportFrom(page));
assert.ok(!redactedText.includes('As') && !redactedText.includes('Kh') && !redactedText.includes('private chat marker') && !redactedText.includes('secret-token-value'), 'hole cards, raw state, tokens, and chat never enter the export');

page.PokerNowHUDDebug.clearShowdownDiagnostics();
assert.strictEqual(page.PokerNowHUDDebug.latestShowdownDiagnostic(), null, 'clear removes diagnostics');
assert.strictEqual(vm.runInContext('__PNHUD_SHOWDOWN_DEBUG__', page), true, 'clear does not disable the debug flag');
isolated.PokerShowdownDiagnosticExporter.record('semantic-finalization', {
  lifecycleHandId: 'INCOMPLETE', finalized: true, handIdentity: { lifecycleHandId: 'INCOMPLETE', handId: 'AUTH-INCOMPLETE' }, playerIds: ['P1']
});
isolated.PokerShowdownDiagnosticExporter.record('reducer-invocation', {
  phase: 'after', handId: 'AUTH-INCOMPLETE', identityAliases: ['INCOMPLETE', 'AUTH-INCOMPLETE'], reduced: true,
  outputs: { P1: { sawFlopForWTSD: 1, wentToShowdown: 1, wonMoneyAtShowdownCandidate: null, wonMoneyAtShowdownCandidateSupported: false, wonMoneyAtShowdownCandidateReason: 'settlement ownership is incomplete' } }
});
isolated.PokerShowdownDiagnosticExporter.record('stats-ingestion', {
  candidateHandIds: ['INCOMPLETE', 'AUTH-INCOMPLETE'], contributionId: 'showdown:1:INCOMPLETE:P1', eventId: 'INCOMPLETE:P1',
  targetHandId: 'INCOMPLETE', playerId: 'P1', attached: true,
  after: { sawFlopForWTSD: 1, wentToShowdown: 1, showdownsForWSD: 0, wonMoneyAtShowdown: 0 }
});
isolated.PokerShowdownDiagnosticExporter.record('persistence-save', {
  events: [{ eventId: 'INCOMPLETE:P1', handId: 'INCOMPLETE', playerId: 'P1', contributionId: 'showdown:1:INCOMPLETE:P1', fields: { sawFlopForWTSD: 1, wentToShowdown: 1, showdownsForWSD: 0, wonMoneyAtShowdown: 0 } }]
});
isolated.PokerShowdownDiagnosticExporter.record('stats-aggregation', {
  handId: 'INCOMPLETE', playerId: 'P1', countersBefore: {},
  countersAfter: { sawFlopForWTSD: 1, wentToShowdown: 1, showdownsForWSD: 0, wonMoneyAtShowdown: 0 }
});
assert.strictEqual(exportFrom(page).hands[0].classification, 'showdown_supported_wsd_unsupported', 'incomplete showdown is explicitly classified');

page.PokerNowHUDDebug.clearShowdownDiagnostics();
recordSuccessfulHand(isolated, 'DUPLICATE');
var beforeDuplicate = JSON.stringify(exportFrom(page).hands[0].persistedFinalizedEventFieldsByPlayer);
isolated.PokerShowdownDiagnosticExporter.record('duplicate-rejection', { lifecycleHandId: 'DUPLICATE', reason: 'duplicate settlement frame rejected' });
var duplicate = exportFrom(page).hands[0];
assert.ok(duplicate.duplicateRejectionReasons.includes('duplicate settlement frame rejected'), 'duplicate settlement is recorded');
assert.strictEqual(JSON.stringify(duplicate.persistedFinalizedEventFieldsByPlayer), beforeDuplicate, 'duplicate diagnostic does not change counters');

page.PokerNowHUDDebug.clearShowdownDiagnostics();
for (var index = 0; index < 60; index += 1) {
  var handId = 'BOUND-' + index;
  isolated.PokerShowdownDiagnosticExporter.record('semantic-finalization', { lifecycleHandId: handId, finalized: true, handIdentity: { lifecycleHandId: handId, handId: 'AUTH-' + handId } });
  isolated.PokerShowdownDiagnosticExporter.record('finalization-attempt', { lifecycleHandId: handId, committed: true, reason: 'bounded attempt ' + index });
  isolated.PokerShowdownDiagnosticExporter.record('stats-ingestion', { candidateHandIds: [handId], contributionId: 'C-' + index, playerId: 'P1', eventId: 'E-' + index, attached: true });
}
var bounded = exportFrom(page);
assert.strictEqual(bounded.hands.length, 20, 'hand captures use 20-entry FIFO');
assert.strictEqual(bounded.finalizationAttempts.length, 50, 'finalization attempts use 50-entry FIFO');
assert.strictEqual(bounded.attachmentAttempts.length, 50, 'attachment attempts use 50-entry FIFO');
assert.strictEqual(page.PokerNowHUDDebug.latestShowdownDiagnostic().lifecycleHandId, 'BOUND-59', 'latest returns the newest capture');

console.log('Bounded page-world showdown diagnostic exporter, safety, classifications, duplicate neutrality, and limits passed.');
