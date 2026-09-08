'use strict';

var assert = require('assert');
var fs = require('fs');
var reducer = require('./preflopOpportunityReducer.js');

function action(sequence, playerId, type, details) {
  return Object.assign({
    sequence: sequence,
    sourceSequence: sequence * 10,
    street: 'preflop',
    playerId: playerId,
    type: type,
    amountTo: null,
    minimumRaiseToBefore: null,
    isAllIn: null,
    isFullRaise: null,
    isShortAllInRaise: null,
    confidence: 'proven'
  }, details || {});
}

function finalizedRecord(identity) {
  return {
    schemaVersion: 1,
    status: 'finalized',
    handIdentity: Object.assign({ handId: 'authoritative-1', lifecycleHandId: 'lifecycle-1' }, identity || {}),
    players: [
      { playerId: 'opener', startingStack: 1000 },
      { playerId: 'three-bettor', startingStack: 1000 }
    ],
    actions: [
      action(1, 'opener', 'raise', { amountTo: 60, minimumRaiseToBefore: 40, isFullRaise: true, raiseContext: 'open_raise' }),
      action(2, 'three-bettor', 'raise', { amountTo: 180, minimumRaiseToBefore: 100, isFullRaise: true, raiseContext: 'three_bet' }),
      action(3, 'opener', 'fold', { minimumRaiseToBefore: 300 })
    ],
    preflopRoles: { openingAggressor: 'opener' },
    ambiguities: [],
    provenance: {
      historyComplete: true,
      recovered: false,
      finalizationReason: 'accepted production commit'
    }
  };
}

var state = reducer.createState({ maxRecords: 2, maxAttempts: 10, maxPlayers: 10 });
var first = reducer.reduce(state, finalizedRecord());
assert.strictEqual(first.reduced, true);
assert.strictEqual(first.duplicate, false);
assert.deepStrictEqual(reducer.inspect(state).totalsByPlayer.opener.foldToThreeBet, { opportunities: 1, folds: 1 });
assert.deepStrictEqual(reducer.inspect(state).totalsByPlayer['three-bettor'].threeBet, { opportunities: 1, made: 1 });

var beforeDuplicate = reducer.inspect(state);
var terminalReplay = reducer.reduce(state, finalizedRecord());
assert.strictEqual(terminalReplay.reduced, false);
assert.strictEqual(terminalReplay.duplicate, true);
var afterTerminalReplay = reducer.inspect(state);
assert.deepStrictEqual(afterTerminalReplay.totalsByPlayer, beforeDuplicate.totalsByPlayer, 'replayed terminal record cannot alter shadow totals');
assert.deepStrictEqual(afterTerminalReplay.contributionRecords, beforeDuplicate.contributionRecords, 'replayed terminal record cannot append a contribution');

var authoritativeAliasReplay = finalizedRecord({ lifecycleHandId: 'reconnected-lifecycle-id' });
var aliasDuplicate = reducer.reduce(state, authoritativeAliasReplay);
assert.strictEqual(aliasDuplicate.duplicate, true, 'the authoritative hand alias prevents reconnect double-counting');
assert.deepStrictEqual(reducer.inspect(state).totalsByPlayer, beforeDuplicate.totalsByPlayer);

var restored = reducer.createState({
  finalizedHandIds: ['lifecycle-1'],
  maxRecords: 2,
  maxAttempts: 10,
  maxPlayers: 10
});
var reloadReplay = reducer.reduce(restored, finalizedRecord());
assert.strictEqual(reloadReplay.reduced, false);
assert.strictEqual(reloadReplay.duplicate, true, 'restored finalized lifecycle identities exclude reload replay');
assert.deepStrictEqual(reducer.inspect(restored).totalsByPlayer, {}, 'shadow totals are not fabricated or persisted during reload exclusion');
assert.strictEqual(reducer.inspect(restored).coverage.seededFinalizedHandCount, 1);

var pauseResumeSnapshot = reducer.inspect(state).totalsByPlayer;
assert.deepStrictEqual(reducer.inspect(state).totalsByPlayer, pauseResumeSnapshot, 'pause/resume without finalization is inert');
assert.strictEqual(reducer.inspect(state).contributionRecords.length, 1, 'game breaks without finalization cannot emit records');

var resetState = reducer.createState({ maxRecords: 2, maxAttempts: 10, maxPlayers: 10 });
assert.deepStrictEqual(reducer.inspect(resetState).totalsByPlayer, {}, 'Reset Session recreates empty shadow totals');
assert.strictEqual(reducer.inspect(resetState).contributionRecords.length, 0);
assert.strictEqual(reducer.inspect(resetState).coverage.reducedHandCount, 0);
var firstRestartHand = reducer.reduce(resetState, finalizedRecord({ handId: 'authoritative-2', lifecycleHandId: 'lifecycle-2' }));
assert.strictEqual(firstRestartHand.reduced, true, 'the first new finalized hand after reset/restart contributes normally');
assert.strictEqual(reducer.inspect(resetState).totalsByPlayer.opener.foldToThreeBet.opportunities, 1);

for (var duplicateIndex = 0; duplicateIndex < 50; duplicateIndex += 1) reducer.reduce(state, finalizedRecord());
assert.strictEqual(reducer.inspect(state).reductionAttempts.length, 10, 'duplicate observability remains bounded');
assert.strictEqual(reducer.inspect(state).contributionRecords.length, 1, 'duplicates never consume contribution history capacity');

var content = fs.readFileSync('./content.js', 'utf8').replace(/\r\n/g, '\n');
function count(needle) {
  return content.split(needle).length - 1;
}
assert.strictEqual(count('PokerPreflopOpportunityReducer.reduce(preflopOpportunityState, semanticResult.record);'), 1, 'one production hand-finalization seam feeds the reducer');
assert.ok(content.includes('if (semanticResult.finalized && semanticResult.record) {'), 'only a newly finalized semantic record is reduced');
assert.ok(content.includes('preflopOpportunityState = PokerPreflopOpportunityReducer.createState({ finalizedHandIds: restoredFinalizedIds || []'), 'reload restoration seeds finalized aliases without persistence');
assert.ok(content.includes('handAccounting = PokerHandFinalization.createState({ finalizedEvents: [] });\n    semanticLedgerState = PokerSemanticHandLedger.createState(') && content.includes('preflopOpportunityState = PokerPreflopOpportunityReducer.createState({ maxRecords: 50'), 'Reset Session clears both semantic and preflop exactly-once state beside existing session accounting');
assert.strictEqual(count('PokerPreflopOpportunityReducer.reduce('), 1, 'raw frames, pause/resume, and game-break paths do not invoke the reducer');

console.log('shadow preflop reducer lifecycle: finalization-only feed, replay/reload dedupe, bounded inspection, and Reset Session behavior verified');
