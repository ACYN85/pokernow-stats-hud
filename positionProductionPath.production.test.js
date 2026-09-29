'use strict';
var assert = require('assert'); var fs = require('fs'); var ledger = require('./semanticHandLedger.js'); var resolver = require('./positionResolver.js');
globalThis.PokerPositionResolver = resolver;
var state = ledger.createState(); var handId = 'POSITION-PROD';
var start = { hI: handId, gN: 1, gT: [1,0], iHPI: ['BTN','SB','BB','UTG','HJ','CO'], dealerID: 'BTN', sBPI: 'SB', bBPI: 'BB', seats: [[1,'BTN'],[2,'SB'],[3,'BB'],[4,'UTG'],[5,'HJ'],[6,'CO']], players: { BTN:{stack:1000},SB:{stack:1000},BB:{stack:1000},UTG:{stack:1000},HJ:{stack:1000},CO:{stack:1000} }, tB:{SB:10,BB:20}, gameResult:null };
ledger.observe(state,{handId:handId,authoritativeHandId:handId,currentState:start,patch:start,frameId:1});
var terminal=Object.assign({},start,{gT:[1,5],gameResult:{BTN:{gained:60}}}); ledger.observe(state,{handId:handId,authoritativeHandId:handId,previousState:start,currentState:terminal,patch:{gT:[1,5],gameResult:terminal.gameResult},sameHand:true,frameId:2});
var finalized=ledger.finalize(state,handId,{timestamp:100}); assert.strictEqual(finalized.finalized,true); assert.strictEqual(finalized.record.positionProvenance.status,'supported'); assert.strictEqual(finalized.record.positionProvenance.assignments.UTG,'UTG'); assert.strictEqual(finalized.record.positionProvenance.assignments.CO,'CO');
function frozenPopulation(id, dealt, blinds) {
  var live = ledger.createState(); var initial = Object.assign({}, start, { hI: id, iHPI: dealt.slice(),
    sBPI: blinds[0], bBPI: blinds[1], players: Object.assign({}, start.players, { AWAY: { stack: 1000, away: true } }),
    seats: start.seats.concat([[7, 'AWAY']]) });
  ledger.observe(live, { handId: id, authoritativeHandId: id, currentState: initial, patch: initial, frameId: 1 });
  var changed = Object.assign({}, initial, { gT: [1, 5], iHPI: [dealt[dealt.length - 1]],
    seats: initial.seats.concat([[8, 'LATE']]), players: Object.assign({}, initial.players, { BTN: { stack: 0, away: true, disconnected: true }, LATE: { stack: 1000 } }),
    gameResult: { BTN: { gained: 60 } } });
  ledger.observe(live, { handId: id, authoritativeHandId: id, previousState: initial, currentState: changed,
    patch: { gT: [1, 5], iHPI: changed.iHPI, seats: changed.seats, players: changed.players, gameResult: changed.gameResult }, sameHand: true, frameId: 2 });
  var result = ledger.finalize(live, id, { timestamp: 100 });
  assert.equal(result.finalized, true);
  return result.record.positionProvenance.dealtPlayerCount;
}
assert.equal(frozenPopulation('FOUR-DEALT', ['BTN','SB','BB','CO'], ['SB','BB']), 4, 'Away seats and a late join do not count');
assert.equal(frozenPopulation('HU-DEALT', ['BTN','BB'], ['BTN','BB']), 2, 'seated sit-outs are excluded and a dealt player who folds/disconnects remains counted');
assert.equal(frozenPopulation('NEXT-THREE', ['BTN','SB','BB'], ['SB','BB']), 3, 'returning participant counts only on the next dealt hand');
var content=fs.readFileSync('./content.js','utf8'); assert.ok(content.includes('PokerFilteredStats.annotateSessionEventRange'), 'production finalization annotates only the committed hand range from the same certified position result');
assert.doesNotMatch(content,/current seated roster.*dealtPosition|domSeats.*dealtPosition/i,'DOM/current seating is not a position source');
console.log('Production semantic finalization freezes dealt-hand position evidence before session/career consumption.');
