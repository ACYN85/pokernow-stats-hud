'use strict';
var assert = require('assert');
var ledger = require('./semanticHandLedger.js');
var potOdds = require('./potOdds.js');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function observe(state, current, previous, patch, id) { return ledger.observe(state, { handId: 'LIVE-1', authoritativeHandId: 'LIVE-1', previousHandId: previous ? 'LIVE-1' : null, previousAuthoritativeHandId: previous ? 'LIVE-1' : null, frameId: id, timestamp: Number(id.slice(-1)) * 10, eventName: 'gC', previousState: previous, currentState: current, patch: patch }); }
var start = { hI: 'LIVE-1', gT: ['holdem',0], pot: 1.5, tB: { hero: .5, bb: 1 }, cPI: 'raiser', pITT: 'raiser', sBPI: 'hero', bBPI: 'bb', iHPI: ['hero','bb','raiser'], pGS: { hero:'inGame',bb:'inGame',raiser:'inGame' }, players: { hero:{stack:99.5},bb:{stack:99},raiser:{stack:100} } };
var state = ledger.createState(); observe(state,start,null,start,'f1');
var raised = clone(start); raised.tB.raiser=4; raised.players.raiser.stack=96; raised.cPI='hero'; raised.pITT='hero'; raised.pot=5.5; observe(state,raised,start,{tB:{raiser:4},players:{raiser:{stack:96}},cPI:'hero',pITT:'hero',pot:5.5},'f2');
var live = ledger.liveBettingState(state,'LIVE-1');
assert.strictEqual(live.actingPlayerId,'hero'); assert.strictEqual(live.street,'preflop');
assert.deepStrictEqual(live.players.map(function(p){return [p.playerId,p.streetContribution,p.totalContribution];}).sort(),[['bb',1,1],['hero',.5,.5],['raiser',4,4]]);
var decision = potOdds.resolve(Object.assign({},live,{enabled:true,localPlayerId:'hero',actorSource:'pITT/cPI',actionSource:'semantic ledger'}));
assert.strictEqual(decision.status,'supported'); assert.strictEqual(decision.amountToCall,3.5); assert.strictEqual(decision.currentEligiblePot,5.5); assert.strictEqual(decision.potAfterCall,9); assert.strictEqual(potOdds.formatPercent(decision.requiredEquity),'38.9%');
var moved = clone(raised); moved.cPI='bb'; moved.pITT='bb'; observe(state,moved,raised,{cPI:'bb',pITT:'bb'},'f3');
assert.strictEqual(potOdds.resolve(Object.assign({},ledger.liveBettingState(state,'LIVE-1'),{enabled:true,localPlayerId:'hero'})).reasonCode,'NOT_USERS_TURN','actor advance clears stale odds');
var turn = clone(moved); turn.gT=['holdem',1]; turn.tB={hero:'check'}; turn.cPI='hero'; turn.pITT='hero'; observe(state,turn,moved,{gT:turn.gT,tB:turn.tB,cPI:'hero',pITT:'hero'},'f4');
assert.strictEqual(potOdds.resolve(Object.assign({},ledger.liveBettingState(state,'LIVE-1'),{enabled:true,localPlayerId:'hero'})).reasonCode,'NO_CALL_REQUIRED','street transition does not leak prior call');

var allInState = ledger.createState();
var beforeJam = { hI:'LIVE-ALLIN-740', gT:['holdem',1], pot:280, tB:{playerA:0,playerB:0}, cPI:'playerB', pITT:'playerB', iHPI:['playerA','playerB'], pGS:{playerA:'inGame',playerB:'inGame'}, players:{playerA:{stack:460},playerB:{stack:460}} };
var afterJam = clone(beforeJam); afterJam.pot=740; afterJam.tB={playerA:'check',playerB:460}; afterJam.cPI='playerA'; afterJam.pITT='playerA'; afterJam.pGS.playerB='allIn'; afterJam.players.playerB.stack=0;
function observeAllIn(current, previous, patch, id) { return ledger.observe(allInState, { handId:'LIVE-ALLIN-740', authoritativeHandId:'LIVE-ALLIN-740', previousHandId:previous?'LIVE-ALLIN-740':null, previousAuthoritativeHandId:previous?'LIVE-ALLIN-740':null, frameId:id, timestamp:id==='ai1'?100:200, eventName:id==='ai1'?'registered':'gC', previousState:previous, currentState:current, patch:patch }); }
observeAllIn(beforeJam,null,beforeJam,'ai1');
observeAllIn(afterJam,beforeJam,{pot:740,tB:{playerA:'check',playerB:460},cPI:'playerA',pITT:'playerA',pGS:{playerB:'allIn'},players:{playerB:{stack:0}}},'ai2');
var allInLive = ledger.liveBettingState(allInState,'LIVE-ALLIN-740');
assert.strictEqual(allInLive.actingPlayerId,'playerA','PokerNow actor fields, not CHECK text, identify the live decision owner');
assert.strictEqual(allInLive.currentPot,740,'named merged pot reaches liveBettingState');
assert.strictEqual(allInLive.players.find(function(p){return p.playerId==='playerB';}).streetContribution,460,'all-in wager remains a live street commitment');
assert.strictEqual(allInLive.players.find(function(p){return p.playerId==='playerB';}).allIn,true,'all-in status survives the production projection');
var allInDecision = potOdds.resolve(Object.assign({},allInLive,{enabled:true,localPlayerId:'playerA',actorSource:'pITT/cPI',actionSource:'PokerSemanticHandLedger.liveBettingState'}));
assert.strictEqual(allInDecision.status,'supported'); assert.strictEqual(allInDecision.reasonCode,'SUPPORTED'); assert.strictEqual(allInDecision.amountToCall,460); assert.strictEqual(allInDecision.currentEligiblePot,740); assert.strictEqual(allInDecision.potAfterCall,1200); assert.strictEqual(allInDecision.requiredEquity,460/1200); assert.strictEqual(potOdds.formatPercent(allInDecision.requiredEquity),'38.3%');
assert.strictEqual(allInDecision.evidence.actor,'playerA'); assert.strictEqual(allInDecision.evidence.highestLiveContestableContribution,460); assert.strictEqual(allInDecision.evidence.selfContribution,0); assert.strictEqual(allInDecision.evidence.selfStack,460); assert.strictEqual(allInDecision.evidence.headsUpAllInProof,true); assert.ok(potOdds.widgetHtml(allInDecision).includes('Need 38.3%'),'screenshot-equivalent production decision mounts a visible HUD row');
var afterFold = clone(afterJam); afterFold.cPI='playerB'; afterFold.pITT='playerB'; afterFold.pGS.playerA='fold';
observeAllIn(afterFold,afterJam,{cPI:'playerB',pITT:'playerB',pGS:{playerA:'fold'}},'ai3');
assert.notStrictEqual(potOdds.resolve(Object.assign({},ledger.liveBettingState(allInState,'LIVE-ALLIN-740'),{enabled:true,localPlayerId:'playerA'})).status,'supported','fold/actor advance clears the live widget');

var call100State = ledger.createState();
var beforeBet100 = { hI:'LIVE-CALL-100', gT:['holdem',1], pot:360, tB:{playerA:'check',playerB:0}, cPI:'playerB', pITT:'playerB', iHPI:['playerA','playerB'], pGS:{playerA:'inGame',playerB:'inGame'}, players:{playerA:{stack:420},playerB:{stack:520}} };
var afterBet100 = clone(beforeBet100); afterBet100.pot=460; afterBet100.tB={playerA:'check',playerB:100}; afterBet100.cPI='playerA'; afterBet100.pITT='playerA'; afterBet100.players.playerB.stack=420;
function observeCall100(current, previous, patch, id) { return ledger.observe(call100State, { handId:'LIVE-CALL-100', authoritativeHandId:'LIVE-CALL-100', previousHandId:previous?'LIVE-CALL-100':null, previousAuthoritativeHandId:previous?'LIVE-CALL-100':null, frameId:id, timestamp:id==='c100-1'?300:400, eventName:id==='c100-1'?'registered':'gC', previousState:previous, currentState:current, patch:patch }); }
observeCall100(beforeBet100,null,beforeBet100,'c100-1');
observeCall100(afterBet100,beforeBet100,{pot:460,tB:{playerA:'check',playerB:100},cPI:'playerA',pITT:'playerA',players:{playerB:{stack:420}}},'c100-2');
var call100Live = ledger.liveBettingState(call100State,'LIVE-CALL-100');
var call100Decision = potOdds.resolve(Object.assign({},call100Live,{enabled:true,localPlayerId:'playerA',actorSource:'pITT/cPI',actionSource:'PokerSemanticHandLedger.liveBettingState'}));
assert.strictEqual(call100Decision.status,'supported'); assert.strictEqual(call100Decision.reasonCode,'SUPPORTED'); assert.strictEqual(call100Decision.playerId,'playerA'); assert.strictEqual(call100Decision.street,'flop'); assert.strictEqual(call100Decision.evidence.actor,'playerA');
assert.strictEqual(call100Decision.amountToCall,100); assert.strictEqual(call100Decision.currentEligiblePot,460); assert.strictEqual(call100Decision.potAfterCall,560); assert.strictEqual(call100Decision.requiredEquity,100/560); assert.strictEqual(potOdds.formatPercent(call100Decision.requiredEquity),'17.9%');
assert.strictEqual(call100Decision.evidence.selfStreetContribution,0); assert.strictEqual(call100Decision.evidence.highestStreetContribution,100); assert.strictEqual(call100Decision.evidence.namedPot,460); assert.strictEqual(call100Decision.evidence.streetCommitmentTotal,100); assert.strictEqual(call100Decision.evidence.potSource,'authoritative named current pot; no all-in eligibility ambiguity'); assert.strictEqual(call100Decision.evidence.eligibilitySource,call100Decision.evidence.potSource); assert.strictEqual(call100Decision.evidence.rejectionGate,null);
assert.ok(potOdds.widgetHtml(call100Decision).includes('Call 100 · Need 17.9%'),'supported CALL 100 decision produces visible widget content');
console.log('Semantic merged-state to live pot-odds decision production path tests passed.');
