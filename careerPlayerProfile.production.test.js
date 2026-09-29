'use strict';
const assert=require('assert');
const support=require('./testSupport/productionContentScriptHarness.js');
const agg=require('./careerStatsAggregator.js');
const requests=[];const trendRequests=[];
const stats={version:agg.PROFILE_PROJECTION_VERSION,playerId:'a',recordCount:500,latestDisplayName:'Same', profileContext:{version:agg.PROFILE_CONTEXT_VERSION,preflopTableSizeSum:4500,preflopTableSizeOpportunities:500},counters:Object.assign(agg.emptyCounters(),{hands:500,vpipMade:120,vpipOpportunities:500,pfrMade:100,pfrOpportunities:500,postflopAggressiveActions:160,postflopCalls:80,threeBetMade:12,threeBetOpportunities:150,foldToThreeBet:30,foldToThreeBetOpportunities:60,flopCBetMade:60,flopCBetOpportunities:100,foldToFlopCBet:40,foldToFlopCBetOpportunities:90,wtsdMade:55,wtsdOpportunities:175,wsdMade:28,wsdOpportunities:55})};
const h=support.createHarness({gameId:'career-profile',transformContentSource:s=>s.replace(/\n\}\)\(\);\s*$/,`
 globalThis.profileTest={open:openPlayerDashboard,close:closePlayerDashboard,change:function(mode){handlePlayerDashboardClick({target:{closest:function(s){return s==='[data-dashboard-mode]'?{dataset:{dashboardMode:mode}}:null;}}});},invalidate:invalidateLeaderboardCareerStats,state:function(){return playerDashboardState;},stop:function(){cleanupExtension('profile test');}};
})();`),runtimeSendMessage:(m,cb)=>{if(m.method==='careerDashboardStats')requests.push({id:m.args[0],cb});else if(m.method==='careerTrendStats')trendRequests.push({id:m.args[0],cb});else cb({ok:true,value:{}});}});
const run=s=>h.evaluateInIsolatedWorld('profileTest.'+s);
const state=()=>JSON.parse(JSON.stringify(run('state()')));
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function reply(request, snapshot, overallHands, activeRecords){const revision=snapshot.counters.hands;request.cb({ok:true,value:{core:{counters:Object.assign({},snapshot.counters,{hands:overallHands||revision}),coverage:{totalCareerHands:overallHands||revision,activeRecordCount:activeRecords||snapshot.recordCount,tableSizeHands:{HU:0,'3_TO_5':0,SIX_PLUS:revision}}},comparisonContexts:{playerId:snapshot.playerId,source:'career',playerRevision:revision,situations:{},positions:{}},profileStats:snapshot,relational:{},query:{playerRevision:revision}}});const index=trendRequests.findIndex(candidate=>candidate.id===request.id);assert.notStrictEqual(index,-1,'matching Trend request exists');trendRequests.splice(index,1)[0].cb({ok:true,value:{query:{playerRevision:revision}}});}
(async()=>{
 await flush();assert.deepStrictEqual(h.evaluationErrors,[]);
 run('open("a","Same")');reply(requests.at(-1),stats);await flush();assert.equal(state().profile.displayedArchetype,'TAG');assert.equal(state().coreStats.coverage.tableSizeHands.SIX_PLUS,500,'same accepted revision proves one table-size bucket');assert.equal(state().sessionStats.handsPlayed,0);
 run('change("session")');assert.equal(state().profile,null);
 run('change("career")');assert.equal(state().profile,null,'no Session profile leaks during loading');reply(requests.at(-1),stats);await flush();assert.equal(state().profile.hands,500);run('change("session")');assert.equal(state().profile,null,'Career subset state does not leak back into Session');run('change("career")');reply(requests.at(-1),stats);await flush();
 run('invalidate(["a"],"revision")');const newer=JSON.parse(JSON.stringify(stats));newer.counters.hands=501;reply(requests.at(-1),newer);await flush();assert.equal(state().profile.hands,501);
 run('invalidate(["a"],"revision N pending")');const staleRevision=requests.at(-1);
 run('invalidate(["a"],"revision N+1")');const currentRevision=requests.at(-1);
 reply(staleRevision,stats);await flush();assert.equal(state().loading,true,'old Career revision response stays rejected while newer request is pending');assert.equal(state().comparisonContexts,null,'old comparison bundle is not published');
 newer.recordCount=501;reply(currentRevision,newer);await flush();assert.equal(state().profile.hands,501);assert.equal(state().comparisonContexts.playerRevision,501,'selected cards and comparison bundle accept the same newer revision');
 run('invalidate(["a"],"mixed HU history")');reply(requests.at(-1),newer,502,502);await flush();assert.equal(state().coreStats.counters.hands,502);assert.equal(state().coreStats.coverage.tableSizeHands.SIX_PLUS,501,'mixed Career denominator cannot inherit a single-bucket profile');
 run('open("a","Renamed")');const old=requests.at(-1);run('open("b","Same")');const current=requests.at(-1);reply(current,Object.assign({},stats,{playerId:'b'}));await flush();reply(old,stats);await flush();assert.equal(state().playerId,'b');assert.equal(state().profile.displayedArchetype,'TAG');
 assert.equal(state().comparisonContexts.playerId,'b','prior-player comparison bundle remains rejected');
 run('invalidate(["b"],"missing")');reply(requests.at(-1),Object.assign({},stats,{playerId:'b',profileContext:null}));await flush();assert.equal(state().profile.availability.reason,'malformed_or_unavailable_aggregate_inputs');
 run('open("a","Switch")');const staleSource=requests.at(-1);run('change("session")');reply(staleSource,stats);await flush();
 assert.equal(state().mode,'session');assert.equal(state().comparisonContexts.source,'session','late Career bundle cannot replace Session contexts');
 run('stop()');console.log('Career Dashboard unseated/absent identity, source switch, revision refresh, stale responses and missing-input production tests passed.');
})();
