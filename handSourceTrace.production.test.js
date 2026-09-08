'use strict';

var assert = require('assert');
var fs = require('fs');
var hands = require('./handFinalization.js');
var stats = require('./stats.js');

var fixture = JSON.parse(fs.readFileSync('./fixtures/hand-source-replay.json', 'utf8'));

function commitRepresentation(state, handId, players, source) {
  hands.beginHand(state, handId, { activate: false, timestamp: 1 });
  players.forEach(function (player, index) {
    hands.stageEvent(state, { handId: handId, player: player, action: 'blind', street: 'preflop', amount: index + 1, timestamp: 2 + index, eventKey: source + '|' + handId + '|' + player }, { reason: source + ' participant' });
  });
  return hands.commitHand(state, handId, source + ' finalization', 10);
}

var diagnosticState = hands.createState();
fixture.hands.forEach(function (hand) { commitRepresentation(diagnosticState, hand.liveHandId, hand.players, 'live-websocket'); });
assert.deepStrictEqual({ PlayerA: stats.computePlayerStats(diagnosticState.finalizedEvents, 'PlayerA').handsPlayed, PlayerB: stats.computePlayerStats(diagnosticState.finalizedEvents, 'PlayerB').handsPlayed }, { PlayerA: 6, PlayerB: 5 }, 'six live hands have the expected participation counts before Full Log opens');
fixture.hands.forEach(function (hand) { commitRepresentation(diagnosticState, hand.logHandId, hand.players, 'full-log-parser'); });
assert.deepStrictEqual({ PlayerA: stats.computePlayerStats(diagnosticState.finalizedEvents, 'PlayerA').handsPlayed, PlayerB: stats.computePlayerStats(diagnosticState.finalizedEvents, 'PlayerB').handsPlayed }, { PlayerA: 12, PlayerB: 10 }, 'the old direct-commit model demonstrates why live/log hand-ID dedupe cannot protect against cross-source overcount');

var source = fs.readFileSync('./content.js', 'utf8');
assert.match(source, /\[HUD HAND COMMIT TRACE\]/, 'every production commit attempt has a structured trace');
assert.match(source, /handCommitTraces: cloneJson\(handCommitTraces\)/, 'Copy Diagnostics exports handCommitTraces');
assert.match(source, /handSourceTraces: cloneJson\(handSourceTraces\)/, 'Copy Diagnostics exports handSourceTraces');
assert.match(source, /handIdentityComparisons:/, 'Copy Diagnostics exports cross-source identity comparisons');
assert.match(source, /sourceClassification: source === 'full-log' \? \(backfillingFullLog \? 'full-log-parser' : 'hand-log-dom'\) : source/, 'initial Full Log parsing and later DOM lines remain distinguishable in parser diagnostics');
assert.match(source, /duplicateFrameFingerprintCount/);
assert.match(source, /domHandLogObserverCount/);
assert.match(source, /storageRestorationCallbackCount/);
assert.match(source, /initializationReplayCount/);
assert.match(source, /full-log-stats-withheld/, 'production records the Full Log display-only ownership decision');
assert.match(source, /handLogDomMutationTraces: PokerHandLogDom\.snapshot\(handLogDomState\)/, 'Copy Diagnostics exports Full Log DOM mutation classifications');

var hookSource = fs.readFileSync('./websocketHook.js', 'utf8');
assert.match(hookSource, /hookInstallationCount:/, 'MAIN-world hook reports actual installation count');

console.log('Hand-source diagnostics passed; fixture captures the old cross-source failure that the Full Log ownership gate prevents.');
