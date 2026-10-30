/* Candidate-only local grouping; original native/source gates remain false. */
(function(root){
  'use strict';
  const policy='manual-opaque-ledger-v1';
  function enabled(){return root.PokerNowRuntimeScope?.compatibilityOnly===true&&root.PokerNowRuntimeScope.compatibilityPersonPolicy===policy;}
  if(!enabled())return;
  // Presentation route only. It grants no consent, identity or source authority.
  const views=new Map();
  chrome.tabs.onRemoved?.addListener(id=>views.delete(id));
  root.PokerPersonAuthorization.install({runtime:chrome.runtime,enabled,model:root.PokerPlayerIdentity,openOwners:async()=>{
    const native=await PokerPlayerIdentityStore.open(indexedDB),catalog=await PokerCompatibilityPersonCatalog.open(indexedDB,native),links=await PokerPlayerIdentityLinkStore.open(indexedDB),reader=await PokerPlayerIdentityCareerStore.open(indexedDB),observer=await PokerPersonAuthorityObservation.open(indexedDB);
    async function qualifyPerson(target){const state=await native.read(),p=state.persons.find(p=>p.personId===target.personId);if(!p)throw Error('Person unavailable');await catalog.qualify(p.members,state.identityRevision);}
    return {
      identity:{read:async()=>(await catalog.read()).state,setAssignedName:(...a)=>native.setAssignedName(...a),close:()=>native.close()},
      catalog:{read:async()=>(await catalog.read()).catalog,close:()=>catalog.close()},
      links:{previewPublishedLink:async(ids,rev,person)=>{const state=await native.read(),members=state.persons.find(p=>p.personId===person)?.members||[];await catalog.qualify([...new Set(members.concat(ids))],rev);return links.previewPublishedLink(ids,rev,person);},
        confirmPublishedLink:async(p,s)=>{await catalog.qualify(p.proposedMembers,p.identityRevision);return links.confirmPublishedLink(p,s);},unlink:(...a)=>links.unlink(...a),readEligibility:async id=>{try{await qualifyPerson({personId:id});return links.readEligibility(id);}catch(e){return {eligible:false,status:'UNRESOLVED',reason:e.code||'IDENTITY_AMBIGUOUS_ID'};}},close:()=>links.close()},
      reader:{query:async(...a)=>{await qualifyPerson(a[0]);return reader.query(...a);},querySession:async(...a)=>{await qualifyPerson(a[0]);return reader.querySession(...a);},listSessions:async(...a)=>{await qualifyPerson(a[0]);return reader.listSessions(...a);},queryRecent:async(...a)=>{await qualifyPerson(a[0]);return reader.queryRecent(...a);},queryTrends:async(...a)=>{await qualifyPerson(a[0]);return reader.queryTrends(...a);},validateFence:(...a)=>reader.validateFence(...a),close:()=>reader.close()},observer
    };
  }});
  chrome.runtime.onMessage.addListener((m,s,reply)=>{
    if(m?.type==='PNHUD_COMPATIBILITY_PERSON_VIEW'){
      if(!enabled()||s?.id!==chrome.runtime.id||s.frameId!==0||s.documentLifecycle!=='active'||!s.tab||s.url!==chrome.runtime.getURL('personManagement.html')){reply({ok:false});return false;}
      reply({ok:true,view:views.get(s.tab.id)||null});return false;
    }
    if(m?.type!=='PNHUD_OPEN_COMPATIBILITY_PERSONS')return;
    if(!enabled()||s?.id!==chrome.runtime.id||s.frameId!==0||s.documentLifecycle!=='active'||!s.tab||!PokerNowRuntimeScope.isPokerNowGamePage(s.url)){reply({ok:false});return false;}
    const view=m.view==='backup'?'backup':'manage';
    chrome.tabs.create({url:'about:blank',openerTabId:s.tab.id}).then(async tab=>{if(views.size>=64)views.delete(views.keys().next().value);views.set(tab.id,view);await chrome.tabs.update(tab.id,{url:chrome.runtime.getURL('personManagement.html')});reply({ok:true});}).catch(()=>reply({ok:false}));return true;
  });
})(globalThis);
