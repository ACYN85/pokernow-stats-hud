/* Same trusted extension document as Person management. No window-message API. */
(function(){
 'use strict';
 if(window.top!==window||location.href!==chrome.runtime.getURL('personManagement.html')||PokerNowRuntimeScope.compatibilityPersonPolicy!=='manual-opaque-ledger-v1')return;
 const $=id=>document.getElementById(id),box=$('person-backup'),status=$('person-backup-status');
 let until=0,worker=null,pending=null,sequence=0,preview=null,busy=false,publishing=false,port=null,waiters={},tabs=[];
 function render(){box.hidden=!until||document.body.dataset.personView!=='backup';$('person-publish').disabled=!preview||!$('person-backup-reviewed').checked||busy;$('person-cancel').disabled=!worker||publishing;
  for(const id of ['person-export','person-preview','person-import','person-import-mode','person-import-session'])$(id).disabled=busy;}
 function disconnect(){if(port)port.disconnect();port=null;for(const w of Object.values(waiters))w.reject(Error('Session connection closed.'));waiters={};}
 function close(reason){if(worker)worker.terminate();worker=null;preview=null;disconnect();if(pending){clearTimeout(pending.timer);pending.reject(Error(reason||'Operation interrupted. Publication may be UNKNOWN; read saved state before retrying.'));pending=null;}render();}
 function rpc(method,args={}){
  if(Date.now()>=until)return Promise.reject(Error('Accept consent again.'));
  if(pending)return Promise.reject(Error('An operation is already running.'));
  if(!worker){worker=new Worker('compatibilityPersonBackupWorker.js');worker.onmessage=({data:m})=>{if(!pending||m.id!==pending.id)return;const p=pending;pending=null;clearTimeout(p.timer);m.ok?p.resolve(m.value):p.reject(Object.assign(Error(m.message),{code:m.code}));};worker.onerror=()=>close('Worker lost. The result may be UNKNOWN; refresh saved state.');}
  return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>close('Worker reply lost. Result UNKNOWN; refresh saved state. No operation was retried.'),30000);pending={id,resolve,reject,timer};worker.postMessage({id,method,expiresAt:until,...args});});
 }
 async function drain(){const r=await chrome.runtime.sendMessage({type:'PNHUD_CAREER_INDEXED_REQUEST',method:'prepareBackupV2Publication',args:[]});if(!r?.ok)throw Error(r?.error||'Career preparation failed.');}
 async function discover(){const current=await chrome.tabs.getCurrent();tabs=await chrome.tabs.query({url:['https://pokernow.com/games/*','https://www.pokernow.com/games/*']});if(current?.openerTabId!==undefined&&!tabs.some(t=>t.id===current.openerTabId))tabs.unshift({id:current.openerTabId,title:'PokerNow Session that opened management'});
  const select=$('person-import-session');select.replaceChildren(new Option('No current live Session',''));for(const t of tabs)select.append(new Option(t.title||'PokerNow Session '+t.id,String(t.id)));if(current?.openerTabId!==undefined)select.value=String(current.openerTabId);}
 function sessionMessage(type){return new Promise((resolve,reject)=>{waiters[type]={resolve,reject};port.postMessage({type});});}
 async function prepareSession(){if(!$('person-import-session').value)return;port=chrome.tabs.connect(Number($('person-import-session').value),{name:'PNHUD_BACKUP_V2_REPLACE'});port.onMessage.addListener(m=>{const p=waiters[m.type];if(!p)return;delete waiters[m.type];m.ok?p.resolve():p.reject(Error(m.error));});port.onDisconnect.addListener(()=>{for(const p of Object.values(waiters))p.reject(Error('Selected Session closed; publication outcome must be checked.'));waiters={};});await sessionMessage('prepare');}
 document.addEventListener('pnhud-person-consent',e=>{until=e.detail.expiresAt;status.textContent='Person + Career backup ready. Notes remain local.';discover().catch(e=>status.textContent=e.message);render();});
 document.addEventListener('pnhud-person-disabled',()=>{until=0;close();render();});
 document.addEventListener('click',async e=>{
  if(!e.isTrusted)return;const b=e.target.closest('button');if(!b||b.disabled||!['person-export','person-preview','person-publish','person-cancel'].includes(b.id))return;
  if(b.id==='person-cancel'){close('Preview discarded. No operation was retried.');status.textContent=publishing?'Result UNKNOWN. Read saved state.':'Preview discarded; Career and memberships unchanged.';return;}
  let handle;
  // Preserve the synchronous trusted gesture for the native file picker.
  if(b.id==='person-export'){try{handle=await showSaveFilePicker({suggestedName:'PokerNow-Person-Career-'+Date.now()+'.pnhud3'});}catch(e){status.textContent='Export canceled; no backup written.';return;}}
  busy=true;publishing=b.id==='person-publish';render();
  try{
   if(b.id==='person-export'){await drain();const result=await rpc('export',{handle});status.textContent='Complete. Person associations and Career exported ('+result.fileBytes+' bytes). Notes and Settings are not included.';}
   if(b.id==='person-preview'){if(!$('person-import').files[0])throw Error('Choose a Person + Career file first.');await drain();preview=await rpc('preview',{file:$('person-import').files[0],mode:$('person-import-mode').value});$('person-backup-reviewed').checked=false;
    $('person-backup-preview').textContent=JSON.stringify({mode:preview.mode,counts:preview.counts,persons:preview.identity.persons,accounts:preview.identity.players,notes:'Destination notes preserved; not imported',validation:'Fresh validation required after restore'},null,2);status.textContent='Validated preview. No Career or membership changes applied.';}
   if(b.id==='person-publish'){
    if(!preview||!$('person-backup-reviewed').checked)throw Error('Review this exact file preview first.');if(preview.mode==='replace')await prepareSession();await drain();
    const result=await rpc('publish',{confirmation:{mode:preview.mode,confirmed:true,expectedJobId:preview.jobId,expectedFinalChain:preview.finalChain,expectedInputProof:preview.inputProof}});
    if(preview.mode==='replace'&&port){try{await sessionMessage('committed');status.textContent='Complete. Person + Career replaced; selected Session reset to 0.';}catch(e){status.textContent='Restore committed. Session reset unconfirmed: '+e.message+' Use Reset Session before relying on it.';}}
    else {status.textContent='Complete. Person + Career '+(preview.mode==='merge'?'merged; live Session preserved.':'replaced. No selected live Session.');if(result.committed)for(const t of tabs)chrome.tabs.sendMessage(t.id,{type:'PNHUD_BACKUP_V2_MERGE_PUBLISHED'}).catch(()=>{});}
    chrome.runtime.sendMessage({type:'PNHUD_CAREER_INDEXED_REQUEST',method:'driveCareerSessionProjections',args:[]});preview=null;disconnect();document.dispatchEvent(new CustomEvent('pnhud-person-data-changed'));
   }
  }catch(error){status.textContent=(publishing?'Publication was not acknowledged. Read saved Career/associations before retrying. ':'Operation refused. ')+(error.code||'')+' '+error.message;preview=null;disconnect();}
  finally{busy=false;publishing=false;render();}
 });
 $('person-backup-reviewed').addEventListener('change',render);
 $('person-import').addEventListener('change',()=>{if(preview){close();status.textContent='File changed. Preview again.';}});
 $('person-import-mode').addEventListener('change',()=>{if(preview){close();status.textContent='Mode changed. Preview again.';}});
 window.addEventListener('pagehide',()=>{until=0;close();});
 render();
})();
