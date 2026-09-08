'use strict';

var assert = require('assert');
var finalization = require('./handFinalization.js');
var filtered = require('./filteredStats.js');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function semanticKey(event) { return [event.player, event.action, event.street, Number(event.amount || 0)].join('|'); }
function mergeReference(existing, incoming) {
  var result = existing.slice(); var existingCounts = new Map(); var incomingCounts = new Map();
  existing.forEach(function (event) { var key = semanticKey(event); existingCounts.set(key, (existingCounts.get(key) || 0) + 1); });
  incoming.forEach(function (event) { var key = semanticKey(event); var occurrence = (incomingCounts.get(key) || 0) + 1; incomingCounts.set(key, occurrence); if (occurrence > (existingCounts.get(key) || 0)) result.push(clone(event)); });
  return result;
}
function referenceCommit(state, handId, timestamp) {
  handId = String(handId); var hand = state.stagedHands[handId]; var participants = Object.keys(hand.participants);
  var staged = hand.events.filter(function (event) { return participants.includes(String(event.player)); });
  var existingForHand = state.finalizedEvents.filter(function (event) { return String(event.handId) === handId; });
  participants.forEach(function (player) { if (!staged.some(function (event) { return event.player === player; }) && !existingForHand.some(function (event) { return event.player === player; })) staged.push({ handId: handId, playerId: hand.participants[player].playerId, player: player, action: 'dealt', street: 'preflop', amount: 0, timestamp: timestamp }); });
  var fact = { playersDealtCount: participants.length, playersDealtCountVersion: 1, playersDealtCountSource: 'finalized-hand-participants' };
  var merged = mergeReference(existingForHand, staged).map(function (event) { return Object.assign({}, event, fact); });
  state.finalizedEvents = state.finalizedEvents.filter(function (event) { return String(event.handId) !== handId; }).concat(merged);
  return state.finalizedEvents;
}
function event(handId, playerId, action, street, extra) { return Object.assign({ handId: handId, playerId: playerId, player: playerId, action: action, street: street || 'preflop', amount: action === 'fold' || action === 'check' ? 0 : 10, timestamp: 100 }, extra || {}); }

var scenarios = {
  ordinary: [event('ordinary', 'p1', 'raise'), event('ordinary', 'p2', 'fold')],
  bbWalk: [event('walk', 'sb', 'fold'), event('walk', 'bb', 'blind', 'preflop', { blindType: 'big', amount: 2 })],
  multiway: [event('multi', 'p1', 'raise'), event('multi', 'p2', 'call'), event('multi', 'p3', 'fold')],
  threeBetFold: [event('3bet', 'p1', 'raise'), event('3bet', 'p2', 'raise', 'preflop', { threeBetMade: 1 }), event('3bet', 'p1', 'fold', 'preflop', { foldToThreeBet: 1 })],
  cbetFold: [event('cbet', 'p1', 'bet', 'flop', { flopCBetMade: 1 }), event('cbet', 'p2', 'fold', 'flop', { foldToFlopCBet: 1 })],
  muckedShowdown: [event('muck', 'p1', 'call', 'river', { sawFlopForWTSD: 1, wentToShowdown: 1 }), event('muck', 'p2', 'check', 'river', { sawFlopForWTSD: 1, wentToShowdown: 1, mucked: true })],
  sidePotRefund: [event('side', 'p1', 'call', 'river', { potId: 'main', award: 30 }), event('side', 'p2', 'call', 'river', { potId: 'side', refund: 5 }), event('side', 'p3', 'fold')],
  breakRejoin: [event('rejoin', 'p1', 'blind', 'preflop', { resumedAfterBreak: true }), event('rejoin', 'p2', 'fold')]
};

var history = [];
for (var hand = 0; hand < 1000; hand += 1) history.push(event('old-' + hand, 'legacy', 'fold'));
Object.keys(scenarios).forEach(function (name) {
  var optimized = finalization.createState({ finalizedEvents: history });
  var reference = finalization.createState({ finalizedEvents: history });
  scenarios[name].forEach(function (value) {
    finalization.stageEvent(optimized, value, { playerId: value.playerId, reason: name });
    finalization.stageEvent(reference, value, { playerId: value.playerId, reason: name });
  });
  var expected = referenceCommit(reference, scenarios[name][0].handId, 200);
  var result = finalization.commitHand(optimized, scenarios[name][0].handId, name, 200);
  assert.deepStrictEqual(optimized.finalizedEvents, expected, name + ' optimized finalization is structurally identical to the reference behavior');
  assert.strictEqual(result.finalizedRangeStart, history.length, name + ' exposes the appended hand-local range');
  assert.strictEqual(result.finalizedRangeLength, optimized.finalizedEvents.length - history.length);
  assert.strictEqual(result.work.fullHistoryScans, 0, name + ' new-hand commit performs no whole-history scan');
});

var annotatedBase = history.concat(scenarios.threeBetFold);
var semanticRecord = { handIdentity: { handId: '3bet' }, positionProvenance: { status: 'supported', dealtPlayerCount: 2, assignments: { p1: 'BTN', p2: 'BB' } } };
var preflopContribution = { hand: { openRaiser: 'p1', threeBettor: 'p2' }, players: { p1: { foldToThreeBet: { opportunity: true } }, p2: { threeBet: { opportunity: true } } } };
var referenceAnnotated = filtered.annotateSessionEvents(annotatedBase, semanticRecord, preflopContribution, null);
var optimizedAnnotated = clone(annotatedBase);
var optimizedArrayIdentity = optimizedAnnotated;
filtered.annotateSessionEventRange(optimizedAnnotated, history.length, scenarios.threeBetFold.length, semanticRecord, preflopContribution, null);
assert.strictEqual(optimizedAnnotated, optimizedArrayIdentity, 'hand-local annotation preserves the authoritative array identity');
assert.deepStrictEqual(optimizedAnnotated, referenceAnnotated, 'hand-local annotation output equals the former whole-array reference output');

console.log('Ordinary, walk, multiway, opportunity-stat, showdown, side-pot/refund, and break/rejoin finalization equivalence passed.');
