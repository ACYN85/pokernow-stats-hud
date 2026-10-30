/* Unshipped, read-only discovery. Stored Career scalars never prove wire ID type. */
(function(root,factory){
  var node=typeof module!=='undefined'&&module.exports;
  var api=factory(node?require('./playerIdentity'):root.PokerPlayerIdentity,
    node?require('./careerStatsAggregator'):root.PokerCareerStatsAggregator,
    node?require('./careerIndexedStore'):root.PokerCareerIndexedStore,
    node?require('./playerIdentityStore'):root.PokerPlayerIdentityStore,node?require('./sessionPublication'):root.PokerSessionPublication,node?require('./sessionHistoryArchive'):root.PokerSessionHistoryArchive);
  if(node)module.exports=api;root.PokerPlayerIdentityCatalog=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(M,A,Indexed,Identity,Publication,History){
  'use strict';
  var LIMITS=Object.freeze({records:4096,players:1024,bytes:8*1024*1024,recordBytes:256*1024,deadlineMs:2000});
  function fail(code){throw Object.assign(new Error(code),{code:code});}
  function bytes(v){return new TextEncoder().encode(JSON.stringify(v)).length;}
  function name(value){return typeof value==='string'?value.slice(0,200):'';}
  function createScan(revision,now){
    now=now||Date.now;var started=now(),count=0,total=0,entries=new Map(),failed=null;
    return Object.freeze({
      add:function(wrapper){
        if(failed)throw failed;
        try{
        if(++count>LIMITS.records||now()-started>=LIMITS.deadlineMs)fail('CATALOG_LIMIT');
        var size=bytes(wrapper);total+=size;
        if(size>LIMITS.recordBytes||total>LIMITS.bytes)fail('CATALOG_LIMIT');
        var r=wrapper&&wrapper.record;
        if(!r||A.validateRecord(r)||!Array.isArray(wrapper.playerIds)||JSON.stringify(wrapper.playerIds)!==JSON.stringify(r.players.map(function(p){return String(p.playerId);})))fail('CATALOG_INVALID_EVIDENCE');
        r.players.forEach(function(p){
          var id=M.rawId(p.playerId),key=M.rawKey(id),prior=entries.get(key),at=Number.isFinite(r.finalizedAt)?r.finalizedAt:0;
          if(!prior||at>=prior.at)entries.set(key,{storedId:id,name:name(p.displayName),at:at});
          if(entries.size>LIMITS.players)fail('CATALOG_LIMIT');
        });
        }catch(e){failed=e;throw e;}
      },
      finish:function(){if(failed)throw failed;return {identityRevision:revision,historyComplete:true,entries:Array.from(entries.values())};}
    });
  }
  function project(state,history,warning){
    state=M.validate(state);
    if(history){
      if(history.identityRevision!==state.identityRevision)fail('IDENTITY_REVISION_CONFLICT');
      if(history.historyComplete!==true||!Array.isArray(history.entries)||history.entries.length>LIMITS.players||bytes(history)>LIMITS.bytes)fail('CATALOG_INVALID_EVIDENCE');
    }
    var rows=state.players.map(function(p){return {playerId:p.playerId,storedId:p.playerId,name:p.assignedName||'',historicalName:'',
      personId:p.personId,selectable:true,source:'saved-typed-metadata',reason:''};});
    var aliases=new Map(rows.map(function(row){return [String(row.playerId),row];})),seen=new Set();
    (history&&history.entries||[]).forEach(function(entry){
      var id=M.rawId(entry.storedId),key=M.rawKey(id);
      if(seen.has(key)||typeof entry.name!=='string'||entry.name.length>200||!Number.isFinite(entry.at))fail('CATALOG_INVALID_EVIDENCE');
      seen.add(key);var known=aliases.get(String(id));
      // This join is a presentation hint only. It never supplies the selectable ID.
      if(known){known.historicalName=entry.name;return;}
      rows.push({playerId:null,storedId:id,name:'',historicalName:entry.name,personId:null,selectable:false,
        source:'retained-career',reason:'Original ID type unverified; Career stores normalized IDs.'});
    });
    return {identityRevision:state.identityRevision,rows:rows,historyComplete:!!history,
      warning:warning||(!history?'Career discovery unavailable. Only saved typed identity metadata is selectable.':'Historical labels do not verify original ID type or real-world identity.')};
  }
  async function open(indexedDB){
    var R=Indexed.routing,db=await R.openDatabase(indexedDB);
    return Object.freeze({read:async function(){
      var tx=await R.transaction(db,[R.controlStore,Indexed.STORES.records],'readonly');
      var completion=new Promise(function(resolve,reject){tx.oncomplete=resolve;tx.onabort=tx.onerror=function(){reject(tx.error||new Error('Catalog read failed'));};});
      completion.catch(function(){});
      try{
        var rows=await new Promise(function(resolve,reject){var req=tx.objectStore(R.controlStore).getAll(IDBKeyRange.bound([Identity.NAMESPACE],[Identity.NAMESPACE+'\u0000'],false,true),Identity.metadata.maxRows+1);req.onsuccess=function(){resolve(req.result);};req.onerror=function(){reject(req.error);};});
        var state=Identity.metadata.stateFor(rows),scan=createScan(state.identityRevision);
        await new Promise(function(resolve,reject){
          var req=tx.objectStore(Indexed.STORES.records).openCursor();
          req.onerror=function(){reject(req.error);};
          req.onsuccess=function(){try{var cursor=req.result;if(!cursor){resolve();return;}scan.add(cursor.value);cursor.continue();}catch(e){reject(e);}};
        });
        await completion;return scan.finish();
      }catch(e){try{tx.abort();}catch(_abort){}await completion.catch(function(){});throw e;}
    },close:function(){db.close();}});
  }
  // A bounded sample from the native authority owner, never Career text keys.
  // Calling this pure validator does not itself authenticate a supplied object.
  function nativePlayers(snapshot){
    if(!Publication||snapshot?.status!=='READY'||snapshot.available!==true||!Array.isArray(snapshot.observations)||snapshot.observations.length>4||!Array.isArray(snapshot.heads)||snapshot.heads.length!==snapshot.observations.length)fail('CATALOG_NATIVE_UNAVAILABLE');
    var found=new Map(),cap=snapshot.current?.capability,budget={maxBytes:256*1024,maxDepth:64,maxNodes:30000};
    snapshot.observations.forEach(function(value,i){var o=Publication.validateObservation(value,budget);if(snapshot.heads[i].status!=='SELECTED'||o.identity.status!=='CERTIFIED'||o.evidence.events!=='COMPLETE'||o.evidence.actors!=='EXACT'||o.witness.status!=='COMPLETE'||o.witness.identityStatus!=='EXACT'||o.sessionId!==cap?.sessionId||o.epoch!==cap.epoch||Publication.canonical(o.namespace,budget)!==Publication.canonical(cap.namespace,budget))fail('CATALOG_NATIVE_UNAVAILABLE');o.witness.participants.forEach(function(p){var id=M.rawId(p.playerId);found.set(M.rawKey(id),{playerId:id,source:'retained-native-canonical-witness'});if(found.size>40)fail('CATALOG_LIMIT');});});return Array.from(found.values());
  }
  // Exact typed identities come from complete finalized native observations.
  // Normalized legacy Career keys never enter this census as inferred players.
  function nativeSummaries(state,archive){
    // Existing history (1024 hands / 16 MiB) and identity (1024 rows / 1 MiB)
    // bounds apply; the legacy scan's player cap must not truncate this census.
    state=M.validate(state);History.validate(archive);const rows=new Map();
    for(const {observation:o} of archive.hands){const record=History.record(o);for(const p of record.players){const id=M.rawId(p.playerId),key=M.rawKey(id),old=rows.get(key),at=Number.isFinite(record.finalizedAt)?record.finalizedAt:null;
      if(!old)rows.set(key,{playerId:id,latestDisplayName:p.displayName||typeof id+' '+JSON.stringify(id),hands:1,handsAvailable:true,lastSeenAt:at});
      else{old.hands++;if(at!==null&&(old.lastSeenAt===null||at>=old.lastSeenAt)){old.lastSeenAt=at;old.latestDisplayName=p.displayName||old.latestDisplayName;}}
    }}
    for(const p of state.players){const key=M.rawKey(p.playerId);if(!rows.has(key))rows.set(key,{playerId:p.playerId,latestDisplayName:typeof p.playerId+' '+JSON.stringify(p.playerId),hands:0,handsAvailable:false,lastSeenAt:null});const row=rows.get(key);row.assignedName=p.assignedName||'';}
    return {players:Array.from(rows.values()),identityRevision:state.identityRevision,nativeHands:archive.hands.length,completeNativeHistory:true,limitation:'Counts and last seen cover retained certified native hands. Older Career records with normalized IDs cannot establish missing original identity types; they are not added as inferred players.'};
  }
  return Object.freeze({LIMITS:LIMITS,createScan:createScan,project:project,nativePlayers:nativePlayers,nativeSummaries:nativeSummaries,open:open});
});
