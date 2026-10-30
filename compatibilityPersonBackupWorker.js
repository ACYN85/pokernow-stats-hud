/* Dedicated worker owned only by the trusted management document. No public route. */
'use strict';
importScripts('runtimeScope.js','stats.js','careerStatsAggregator.js','filteredStats.js','statEvidence.js','careerContributionStore.js',
 'playerIdentity.js','playerIdentityValidation.js','playerIdentityEligibility.js','careerIndexedStore.js','careerBackupPolicy.js','careerBackup.js',
 'playerIdentityStore.js','playerNotesNative.js','careerBackupV2.js','careerBackupV2Import.js','careerBackupV3.js','compatibilityPersonBackup.js');
if(!PokerNowRuntimeScope.compatibilityOnly||PokerNowRuntimeScope.compatibilityPersonPolicy!=='manual-opaque-ledger-v1')throw Error('COMPATIBILITY_POLICY_REQUIRED');
let staged=null,abort=null,busy=false,until=0,last=0;
const scope={kind:'compatibility-person-maintenance-v1',assert:async()=>{if(!until||Date.now()>=until)throw Error('Consent expired. Reopen management and accept again.');}};
self.onmessage=async({data:m})=>{
 if(m?.method==='cancel'){abort?.abort();return;}
 if(busy||!m||!Number.isSafeInteger(m.id)||m.id<=last||!['export','preview','publish','close'].includes(m.method)){self.close();return;}
 last=m.id;busy=true;
 if(!until)until=Math.min(Number(m.expiresAt)||0,Date.now()+30*60*1000);
 try{
  await scope.assert();let value;
  if(m.method==='export') {abort=new AbortController();value=await PokerCompatibilityPersonBackup.exportFile(m.handle,scope,{signal:abort.signal});}
  if(m.method==='preview'){staged?.close();staged=null;abort=new AbortController();staged=await PokerCompatibilityPersonBackup.prepare(m.file,scope,{mode:m.mode,signal:abort.signal});value=staged.preview;}
  if(m.method==='publish'){if(!staged)throw Error('A new file preview is required.');value=await staged.publish(m.confirmation);staged.close();staged=null;}
  if(m.method==='close'){staged?.close();staged=null;}
  self.postMessage({id:m.id,method:m.method,ok:true,value});
 }catch(e){self.postMessage({id:m.id,method:m.method,ok:false,code:e.code||e.name,message:e.message});}
 finally{busy=false;}
};
