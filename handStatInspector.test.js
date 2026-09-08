'use strict';

var assert = require('assert');
var inspector = require('./handStatInspector');
var explanations = require('./statExplanation');

function entry(contribution, status, reasonCode, reasonText) {
  return {
    decision: { opportunity: contribution === '1/1' || contribution === '0/1', result: contribution === '1/1' },
    semanticContribution: contribution,
    counterContribution: contribution === null ? '0/0' : contribution,
    status: status,
    reasonCode: reasonCode,
    reasonText: reasonText || reasonCode.replace(/_/g, ' '),
    sourceReason: reasonCode,
    contributionId: null,
    candidateContributionId: null,
    attachment: null,
    evidence: []
  };
}

function explanation(handId, playerId) {
  var player = {};
  player.vpip = entry('1/1', 'counted', 'voluntary_preflop_action');
  player.pfr = entry('0/1', 'counted', 'no_preflop_raise');
  player.threeBet = entry('0/0', 'not_applicable', 'short_raise_not_full_three_bet');
  player.foldToThreeBet = entry(null, 'unsupported', 'missing_direct_response');
  player.flopCBet = entry('0/0', 'not_applicable', 'prior_donk_removed_cbet_opportunity');
  player.foldToFlopCBet = entry('0/1', 'counted', 'direct_call_to_qualifying_cbet');
  player.wtsd = entry('0/1', 'counted', 'did_not_reach_contested_showdown');
  player.wsd = entry('0/0', 'not_applicable', 'not_in_showdown_denominator');
  var players = {}; players[playerId || 'stable-player-001'] = player;
  return {
    schemaVersion: 1,
    handId: handId,
    lifecycleHandId: 'life-' + handId,
    finalizedAt: 100,
    finalizationReason: 'terminal settlement',
    players: players,
    ambiguities: { preflop: [], flopCBet: [], showdown: [] },
    provenance: { source: 'test', reducerVersions: { preflop: 1, flopCBet: 1, showdown: 1 } }
  };
}

var older = explanation('older-hand', 'stable-player-001');
var newest = explanation('newest-hand', 'stable-player-002');
var history = [older, newest];
var historyBefore = JSON.stringify(history);
var state = inspector.createState();

// H1: opening selects the newest finalized hand.
inspector.open(state, history);
assert.strictEqual(state.open, true);
assert.strictEqual(state.selectedHandId, 'newest-hand');

// H2: closing affects presentation state only.
inspector.close(state);
assert.strictEqual(state.open, false);
inspector.open(state, history);

// H3: newest finalized hand appears first with a relative indicator.
var model = inspector.buildModel(state, history);
assert.deepStrictEqual(model.hands.map(function (hand) { return hand.handId; }), ['newest-hand', 'older-hand']);
assert.deepStrictEqual(model.hands.map(function (hand) { return hand.orderLabel; }), ['Latest', '1 prior']);

// H4: exact authoritative or lifecycle identity selects an older hand.
assert.strictEqual(inspector.select(state, history, older.lifecycleHandId), true);
model = inspector.buildModel(state, history);
assert.strictEqual(model.selectedHand.handId, 'older-hand');

var rows = model.selectedHand.players[0].rows;
function row(label) { return rows.find(function (value) { return value.label === label; }); }

// H5-H8: all four semantic contribution states remain visually distinct.
assert.deepStrictEqual([row('VPIP').value, row('VPIP').valueKind], ['1/1', 'made']);
assert.deepStrictEqual([row('PFR').value, row('PFR').valueKind], ['0/1', 'declined']);
assert.deepStrictEqual([row('CB').value, row('CB').valueKind], ['0/0', 'none']);
assert.deepStrictEqual([row('F3B').value, row('F3B').valueKind], ['Unsupported', 'unsupported']);
var html = inspector.renderHtml(model);
assert.ok(html.includes('pnhud-hand-stat-made') && html.includes('pnhud-hand-stat-declined') && html.includes('pnhud-hand-stat-none') && html.includes('pnhud-hand-stat-unsupported'));
assert.ok(!html.includes('&quot;schemaVersion&quot;'), 'raw JSON is not dumped into the default hand view');

// H9: the concise copy summary contains selected-hand/player decisions.
var summary = inspector.summaryText(model);
assert.ok(summary.includes('Hand older-hand'));
assert.ok(summary.includes('Player ' + inspector.shortStableId('stable-player-001')));
assert.ok(summary.includes('FCB 0/1 - called qualifying CBet'));
assert.ok(summary.includes('F3B Unsupported - direct response was not observed'));

// H10: Copy JSON returns exactly the selected JSON-safe explanation.
assert.deepStrictEqual(JSON.parse(inspector.jsonText(model)), older);

// H11: a newly finalized hand appears first while an explicitly selected older hand remains selected.
var latest = explanation('just-finalized', 'stable-player-003');
var updatedModel = inspector.buildModel(state, history.concat(latest));
assert.strictEqual(updatedModel.hands[0].handId, 'just-finalized');
assert.strictEqual(updatedModel.selectedHand.handId, 'older-hand');

// H12: empty history has a readable status and disabled copy actions.
var emptyState = inspector.createState();
inspector.open(emptyState, []);
var emptyModel = inspector.buildModel(emptyState, []);
var emptyHtml = inspector.renderHtml(emptyModel);
assert.strictEqual(emptyModel.empty, true);
assert.ok(emptyHtml.includes('No finalized hand explanations yet'));
assert.ok(emptyHtml.includes('pnhud-copy-hand-stat-json') && emptyHtml.includes(' disabled'));

// H13: the inspector consumes the existing exact 30-hand FIFO without adding storage.
var explanationState = explanations.createState({ maxHands: 30 });
for (var index = 1; index <= 31; index += 1) {
  explanations.record(explanationState, {
    semanticRecord: {
      schemaVersion: 1,
      status: 'finalized',
      handIdentity: { handId: 'fifo-' + index, lifecycleHandId: 'fifo-life-' + index },
      players: [], actions: [], streets: {}, ambiguities: [], provenance: { finalizationReason: 'fifo test' }
    },
    basicContributionsByPlayer: {}, finalizedAt: index
  });
}
var fifoHistory = explanations.list(explanationState);
var fifoState = inspector.createState();
inspector.open(fifoState, fifoHistory);
var fifoModel = inspector.buildModel(fifoState, fifoHistory);
assert.strictEqual(fifoModel.hands.length, 30);
assert.strictEqual(fifoModel.hands[0].handId, 'fifo-31');
assert.strictEqual(fifoModel.hands.some(function (hand) { return hand.handId === 'fifo-1'; }), false);

// H14-H15: modeling/rendering does not mutate statistics, explanations, or profile-shaped data.
var stats = { handsPlayed: 7, wentToShowdown: 2 };
var profile = { playerId: 'stable-player-001', archetype: 'TAG', revision: 4 };
var neutralBefore = JSON.stringify({ history: history, stats: stats, profile: profile });
inspector.renderHtml(inspector.buildModel(state, history));
assert.strictEqual(JSON.stringify({ history: history, stats: stats, profile: profile }), neutralBefore);
assert.strictEqual(JSON.stringify(history), historyBefore);

// H16: current seat turnover cannot rename or re-key an old explanation.
var turnoverNames = { 'new-seat-player': 'New Occupant' };
var turnoverModel = inspector.buildModel(state, history, turnoverNames);
assert.strictEqual(turnoverModel.selectedHand.players[0].label, 'Player ' + inspector.shortStableId('stable-player-001'));
assert.strictEqual(inspector.renderHtml(turnoverModel).includes('New Occupant'), false);

console.log('Hand Stat Inspector H1-H16 model, filtering, copy, FIFO, and neutrality tests passed.');
