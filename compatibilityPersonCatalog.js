/* Local Career ledger accounts. Never asserts original PokerNow wire-ID type. */
(function(root,factory){
  const node=typeof module!=='undefined'&&module.exports;
  const api=factory(node?require('./playerIdentity'):root.PokerPlayerIdentity,node?require('./playerIdentityCatalog'):root.PokerPlayerIdentityCatalog,
    node?require('./careerIndexedStore'):root.PokerCareerIndexedStore,node?require('./playerIdentityStore'):root.PokerPlayerIdentityStore);
  if(node)module.exports=api;else root.PokerCompatibilityPersonCatalog=api;
})(globalThis,function(M,Catalog,I,Identity){
  'use strict';
  function eligible(id){
    return typeof id==='string'&&id===id.trim()&&id.length>0&&id.length<=M.LIMITS.idLength&&
      !Number.isFinite(Number(id))&&!/^(?:nan|[-+]?infinity|null|undefined|unknown|\[object object\])$/i.test(id)&&
      /^[A-Za-z0-9_-]+$/.test(id);
  }
  function project(state,history){
    state=M.validate(state);
    if(!history||history.identityRevision!==state.identityRevision||history.historyComplete!==true)throw Object.assign(Error('Account census changed or is incomplete.'),{code:'IDENTITY_REVISION_CONFLICT'});
    const rows=new Map();
    for(const e of history.entries){
      const id=e.storedId,key=M.rawKey(id),saved=state.players.find(p=>M.rawKey(p.playerId)===key);
      rows.set(key,{playerId:id,storedId:id,name:saved?.assignedName||e.name||'',historicalName:e.name||'',personId:saved?.personId||null,
        selectable:eligible(id),source:'local-ledger-key',reason:eligible(id)?'User-managed association of an opaque Career key; original wire type and ownership are not verified.':'Numeric-looking or unsupported ledger key; original identity collision cannot be excluded.'});
    }
    for(const p of state.players)if(!rows.has(M.rawKey(p.playerId)))rows.set(M.rawKey(p.playerId),{playerId:p.playerId,storedId:p.playerId,name:p.assignedName||'',historicalName:'',personId:p.personId,selectable:false,source:'local-ledger-key',reason:'No complete retained Career backing.'});
    const projected=structuredClone(state);
    for(const r of rows.values())if(r.selectable&&!projected.players.some(p=>M.rawKey(p.playerId)===M.rawKey(r.playerId)))projected.players.push({playerId:r.playerId,personId:null,assignedName:null});
    return {state:M.validate(projected),catalog:{mode:'local-ledger',identityRevision:state.identityRevision,historyComplete:true,rows:Array.from(rows.values()),warning:'Local grouping of saved Career keys only. This does not verify PokerNow ownership or original wire-ID types. Numeric-looking/ambiguous accounts are unavailable.'}};
  }
  async function open(indexedDB,identity){
    const R=I.routing,db=await R.openDatabase(indexedDB);
    const request=r=>new Promise((y,n)=>{r.onsuccess=()=>y(r.result);r.onerror=()=>n(r.error);});
    async function read(){
      const tx=await R.transaction(db,[R.controlStore,I.STORES.records],'readonly'),done=new Promise((y,n)=>{tx.oncomplete=y;tx.onabort=tx.onerror=()=>n(tx.error||Error('Account census unavailable'));});done.catch(()=>{});
      try{
        const store=tx.objectStore(R.controlStore),state=Identity.metadata.stateFor(await request(store.getAll(IDBKeyRange.bound([Identity.NAMESPACE],[Identity.NAMESPACE+'\u0000'],false,true),Identity.metadata.maxRows+1)));
        const scan=Catalog.createScan(state.identityRevision),backed=new Set(),unsupported=new Set();
        await new Promise((resolve,reject)=>{const r=tx.objectStore(I.STORES.records).openCursor();r.onerror=()=>reject(r.error);r.onsuccess=()=>{try{const c=r.result;if(!c){resolve();return;}scan.add(c.value);const record=c.value.record;
          for(const p of record.players){const key=M.rawKey(p.playerId);backed.add(key);if(typeof record.authoritativeHandId!=='string'||typeof record.namespace?.host!=='string'||typeof record.namespace?.gameId!=='string')unsupported.add(key);}
          c.continue();}catch(e){reject(e);}};});
        let protectedHistory=false;for(const ns of ['pnhudSessionV1','pnhudFinalizedHistoryV1'])if(await request(store.count(IDBKeyRange.bound([ns],[ns+'\u0000'],false,true))))protectedHistory=true;
        await done;const result=project(state,scan.finish());
        for(const row of result.catalog.rows)if(unsupported.has(M.rawKey(row.playerId))){row.selectable=false;row.reason='Missing stable hand/table provenance.';}
        result.catalog.backupReady=!protectedHistory&&state.players.every(p=>backed.has(M.rawKey(p.playerId))&&!unsupported.has(M.rawKey(p.playerId)));
        if(!result.catalog.backupReady)result.catalog.warning+=' Linking is unavailable until all saved metadata has portable Career backing and no protected native recovery is present. Nothing was deleted or inferred.';
        return result;
      }catch(e){try{tx.abort();}catch(_){}await done.catch(()=>{});throw e;}
    }
    return {read,qualify:async(ids,revision)=>{const p=await read();if(p.state.identityRevision!==revision)throw Object.assign(Error('Identity changed. Refresh and review again.'),{code:'IDENTITY_REVISION_CONFLICT'});
      if(!p.catalog.backupReady)throw Object.assign(Error('Portable recovery is unavailable for existing metadata or protected native history.'),{code:'PERSON_BACKUP_SOURCE_UNSUPPORTED'});
      for(const id of ids)if(!p.catalog.rows.some(r=>r.selectable&&M.rawKey(r.playerId)===M.rawKey(id)))throw Object.assign(Error('This ledger account is ambiguous, unsupported or has no retained backing.'),{code:'IDENTITY_AMBIGUOUS_ID'});
      return p;
    },close:()=>db.close()};
  }
  function presentation(catalog){
    const rows=catalog.rows||[],ready=catalog.backupReady!==false,count=rows.filter(r=>r.selectable&&ready).length;
    const result={total:rows.length,eligible:count,code:count>1?'READY':count===1?'ONE':rows.length?'INELIGIBLE':'EMPTY',
      title:count>1?'Choose an account to begin':count===1?'One account is available — linking needs two':rows.length?'These saved accounts cannot be linked safely':'No saved player accounts in this installation',
      message:count>1?'Select an account below, create or choose a Person, then add another account. Each link is reviewed before saving.':count===1?'You can create a Person now. To link profiles, you need a second eligible saved account. Restore existing Career data from Settings → Data if your other account is stored elsewhere.':rows.length?'The saved IDs are ambiguous, unsupported, or missing reliable hand history. They stay separate; no identity type will be guessed.':'Career data belongs to this Chrome profile and extension ID. Loading a different folder can create a separate, empty installation. Update the original TEST extension using the same folder and ID, or restore your existing backup from Settings → Data. Do not delete the original installation.',
      blocked:rows.filter(r=>!r.selectable).map(r=>({name:r.name||r.historicalName||'Saved account',id:String(r.storedId),reason:r.reason==='Missing stable hand/table provenance.'?'Reliable hand or table history is missing.':r.reason==='No complete retained Career backing.'?'Matching Career history is missing in this installation.':'The original account ID is ambiguous or unsupported. Linking it could combine the wrong records.'}))};
    if(!ready){result.title='Account linking is unavailable for this saved data';result.message='Some saved account history is missing or protected recovery data is present. Keep the original data. Restore the matching Career history before linking; no records have been removed.';}
    return result;
  }
  return Object.freeze({eligible,project,open,presentation});
});
