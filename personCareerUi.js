/* Unshipped consumer of the existing native grouped Career query/fence owner. */
(function(root,factory){
  var node=typeof module!=='undefined'&&module.exports;
  var api=factory(node?require('./playerIdentity'):root.PokerPlayerIdentity,
    node?require('./playerIdentityEligibility'):root.PokerPlayerIdentityEligibility,
    node?require('./filteredStats'):root.PokerFilteredStats,
    node?require('./playerDashboard'):root.PokerPlayerDashboard);
  if(node)module.exports=api;root.PokerPersonCareerUi=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(M,E,F,Dashboard){
  'use strict';
  var METRICS=[['hands','Total Hands'],['vpip','VPIP'],['pfr','PFR'],['af','AF'],['threeBet','3Bet'],['foldToThreeBet','F3B'],['flopCBet','FCBet'],['wtsd','WTSD'],['wsd','W$SD']];
  function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
  function fail(reason){throw Object.assign(new Error(reason),{reason:reason});}
  function unavailable(reason){return {status:'UNAVAILABLE',reason:reason,cards:[]};}
  function scope(selection){return selection?{'history-catalog':'person-career-history','historical-session':'person-career-session','recent-sessions':'person-career-recent','session-trends':'person-career-trends'}[selection.kind]:'career';}
  function safe(gate,state,person,at){return gate&&gate.eligible===true&&gate.status==='SAFE'&&gate.policy===E.POLICY&&gate.pendingOutboxCovered===false&&
    gate.personId===person.personId&&same(gate.members,person.members)&&gate.identityRevision===state.identityRevision&&gate.expiresAt>at;}
  function inspect(result,state,person,gate,at,selection){
    if(!safe(gate,state,person,at))fail('Eligibility suspended, expired or changed. Refresh identity before loading Career.');
    if(!result||result.available!==true)fail('Combined Career unavailable: '+(result&&result.reason||'authority unavailable')+'.');
    var f=result.fence,c=f&&f.certificate;
    if(result.grouped!==true||result.status!=='AVAILABLE'||!same(result.target,M.personTarget(person.personId))||!same(result.requestedTarget,result.target)||
      !same(result.eligibility,gate)||!f||f.schemaVersion!==1||f.scope!==scope(selection)||!same(f.target,result.target)||
      !same(f.members,person.members)||f.membershipSignature!==JSON.stringify(person.members.map(M.rawKey))||f.identityRevision!==state.identityRevision||
      f.membershipToken!==gate.membershipToken||f.epoch!==gate.epoch||f.policy!==E.POLICY||!same(f.route,gate.route)||!same(f.filters,F.normalizeFilters({}))||
      !E.validCertificate(c,person.personId)||c.status!=='SAFE'||!same(c.members,f.members)||c.membershipToken!==f.membershipToken||c.epoch!==f.epoch||
      c.identityRevision>f.identityRevision||c.route.bank!==f.route.bank||c.route.careerGeneration!==f.route.careerGeneration||
      f.expiresAt!==c.expiresAt||f.expiresAt!==gate.expiresAt||at<c.issuedAt||at>=f.expiresAt||
      !Array.isArray(f.memberRevisions)||f.memberRevisions.length!==person.members.length||f.memberRevisions.some(function(row,n){return !row||M.rawKey(row.playerId)!==M.rawKey(person.members[n])||(row.revision!==null&&(!Number.isSafeInteger(row.revision)||row.revision<0));}))
      fail('Combined Career response is stale or lacks matching native authority evidence. Refresh identity and retry.');
    if(selection&&(!same(f.selection,selection)||!same(result.selection,selection)||result.populationScope!=={'history-catalog':'RETAINED_PUBLISHED_PERSON_HISTORY','historical-session':'RETAINED_PUBLISHED_PERSON_SESSION','recent-sessions':'RETAINED_PUBLISHED_PERSON_RECENT','session-trends':'RETAINED_PUBLISHED_PERSON_TRENDS'}[selection.kind]))fail('Historical selection does not match the native read.');
    if(!selection&&(f.selection||result.selection))fail('Unexpected historical selection.');
    if(!selection||!['history-catalog','session-trends'].includes(selection.kind))if(!result.statistics||!result.statistics.player||!same(result.statistics.player.target,result.target)||!result.statistics.player.counters||!result.statistics.player.derived)fail('Combined Career statistics are incomplete or belong to another target.');
    return f;
  }
  function createAdapter(injection){
    injection=injection||{};var owner=injection.owner||{},kind=injection.evidence;
    var enabled=['native-owner','fixture'].indexOf(kind)>=0&&typeof owner.query==='function'&&typeof owner.validateFence==='function';
    var historyEnabled=enabled&&typeof owner.querySession==='function'&&typeof owner.listSessions==='function';
    var recentEnabled=historyEnabled&&typeof owner.queryRecent==='function'&&typeof owner.queryTrends==='function';
    async function read(state,personId,gate,now,selection){
      if(!enabled)return unavailable('Native grouped Career adapter unavailable.');
      now=now||Date.now;
      try{
        state=M.validate(state);var person=state.persons.find(function(p){return p.personId===personId;});
        if(!person||!person.members.length||!safe(gate,state,person,now()))return unavailable('Eligibility suspended, expired or changed. Refresh identity before loading Career.');
        // Query and validateFence invoke the existing central native eligibility checker.
        // A locally plausible certificate alone is never sufficient permission.
        if(selection&&!historyEnabled)return unavailable('Native historical Session adapter unavailable.');
        var target=M.personTarget(personId),result=structuredClone(await (!selection?owner.query(target,{}):selection.kind==='history-catalog'?owner.listSessions(target):selection.kind==='historical-session'?owner.querySession(target,selection.sessionId,{}):selection.kind==='recent-sessions'?owner.queryRecent(target,selection.count):owner.queryTrends(target,selection.count)));
        var fence=inspect(result,state,person,gate,now(),selection);
        var current=await owner.validateFence(structuredClone(fence));
        if(!current||current.available!==true||current.current!==true||!same(current.fence,fence))return unavailable('Combined Career became stale or suspended during validation. Refresh identity and retry.');
        inspect(result,state,person,gate,now(),selection);
        if(selection&&['recent-sessions','session-trends'].includes(selection.kind)){
          var coverage=result.statistics&&result.statistics.recent;
          if(!coverage||coverage.ordering!=='LAST_RETAINED_CONTRIBUTION'||coverage.requestedSessions!==selection.count||coverage.wholeSessionComplete!==false||!Array.isArray(coverage.selectedSessionIds)||coverage.selectedSessionIds.length>selection.count||new Set(coverage.selectedSessionIds).size!==coverage.selectedSessionIds.length||!Number.isSafeInteger(coverage.totalSessions)||coverage.totalSessions<coverage.selectedSessionIds.length||!Number.isSafeInteger(coverage.unassignedHands)||coverage.unassignedHands<0)fail('Recent coverage unavailable.');
          coverage.selectedSessionIds.forEach(sessionId);
          if(selection.kind==='session-trends'){
            var rows=result.statistics.sessions;if(!Array.isArray(rows)||!same(rows.map(function(r){return r.sessionId;}),coverage.selectedSessionIds))fail('Trend selection mismatch.');
            return {status:kind==='fixture'?'FIXTURE_VALIDATED':'NATIVE_FENCE_VALIDATED',selection:selection,issuedAt:fence.certificate.issuedAt,expiresAt:fence.expiresAt,fence:fence,cards:[],recent:coverage,trends:rows.map(function(row){if(!row.counters||!row.derived||!Number.isSafeInteger(row.hands)||row.hands<0||row.hands!==row.counters.hands)fail('Trend statistics unavailable.');return {sessionId:row.sessionId,cards:cards({counters:row.counters,derived:row.derived}).filter(function(c){return ['hands','vpip','pfr','af'].includes(c.id);})};})};
          }
        }
        if(selection&&selection.kind==='history-catalog'){
          var h=result.statistics;
          if(!h||!Array.isArray(h.sessions)||h.sessions.length>50||!Number.isSafeInteger(h.totalSessions)||h.totalSessions<h.sessions.length||h.limited!==(h.totalSessions>50)||!Number.isSafeInteger(h.unassignedHands)||h.unassignedHands<0)fail('Historical coverage unavailable.');
          var seen=new Set();h.sessions.forEach(function(row){sessionId(row.sessionId);if(seen.has(row.sessionId)||!Number.isSafeInteger(row.hands)||row.hands<=0||!Number.isSafeInteger(row.firstRetainedAt)||!Number.isSafeInteger(row.lastRetainedAt)||row.firstRetainedAt<0||row.lastRetainedAt<row.firstRetainedAt)fail('Historical coverage unavailable.');seen.add(row.sessionId);});
          return {status:kind==='fixture'?'FIXTURE_VALIDATED':'NATIVE_FENCE_VALIDATED',issuedAt:fence.certificate.issuedAt,expiresAt:fence.expiresAt,fence:fence,history:h,cards:[]};
        }
        var player=result.statistics.player;
        return {status:kind==='fixture'?'FIXTURE_VALIDATED':'NATIVE_FENCE_VALIDATED',reason:'',selection:selection||null,recent:result.statistics.recent||null,expiresAt:fence.expiresAt,issuedAt:fence.certificate.issuedAt,fence:structuredClone(fence),cards:cards(player)};
      }catch(e){return unavailable(e.reason||'Combined Career authority could not be verified. Refresh identity and retry.');}
    }
    function recent(state,id,gate,count,now,trends){if(!recentEnabled||!Number.isSafeInteger(count)||count<1||count>12)return Promise.resolve(unavailable('Recent Session adapter or selection unavailable.'));return read(state,id,gate,now,{kind:trends?'session-trends':'recent-sessions',count:count});}
    return Object.freeze({enabled:enabled,historyEnabled:historyEnabled,recentEnabled:recentEnabled,readRecent:function(s,id,g,count,now){return recent(s,id,g,count,now,false);},readTrends:function(s,id,g,count,now){return recent(s,id,g,count,now,true);},read:function(state,id,gate,now){return read(state,id,gate,now);},readSession:function(state,id,gate,value,now){try{return read(state,id,gate,now,{kind:'historical-session',sessionId:sessionId(value)});}catch(e){return Promise.resolve(unavailable(e.reason));}},list:function(state,id,gate,now){return read(state,id,gate,now,{kind:'history-catalog'});}});
  }
  function cards(player){return METRICS.map(function(metric){return {id:metric[0],label:metric[1],value:Dashboard.careerMetricText(metric[0],metric[0]==='hands'?player.counters.hands:player.derived[metric[0]])};});}
  function sessionId(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))fail('Enter an exact historical Session UUID.');return value;}
  function current(projection,at){return projection&&['FIXTURE_VALIDATED','NATIVE_FENCE_VALIDATED'].indexOf(projection.status)>=0&&at>=projection.issuedAt&&at<projection.expiresAt;}
  return Object.freeze({createAdapter:createAdapter,unavailable:unavailable,current:current});
});
