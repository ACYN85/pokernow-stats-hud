/* Unshipped development UI. Inject existing identity owners; never opens a database. */
(function(root,factory){
  var node=typeof module!=='undefined'&&module.exports;
  var api=factory(node?require('./playerIdentity'):root.PokerPlayerIdentity,node?require('./playerIdentityCatalog'):root.PokerPlayerIdentityCatalog,node?require('./personCareerUi'):root.PokerPersonCareerUi);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.PokerPersonLinkingUi=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Model,Catalog,CareerUi){
  'use strict';
  var POLICY='retained-published-career-v1';
  function copy(v){return JSON.parse(JSON.stringify(v));}
  function error(code,message){return Object.assign(new Error(message),{code:code});}
  function esc(v){return String(v===undefined||v===null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function label(id){return (typeof id==='number'?'Number ID ':'String ID ')+String(id);}
  function sameIds(a,b){return Array.isArray(a)&&Array.isArray(b)&&JSON.stringify(a.map(Model.rawKey).sort())===JSON.stringify(b.map(Model.rawKey).sort());}
  // UI refusal only. The original worker receipt, rescan and transaction remain
  // authoritative. Start this conservative deadline before requesting a review.
  var REVIEW_MS=2*60*1000;
  function confirmationIssues(s,at,authorization){
    var issues=[],r=s.review,p=r&&r.preview;
    function add(code,text){issues.push({code:code,message:text});}
    if(authorization&&(!authorization.active||!Number.isFinite(authorization.expiresAt)||at>=authorization.expiresAt||Number.isFinite(authorization.issuedAt)&&at<authorization.issuedAt))add('CONSENT_EXPIRED','Consent ended or expired. Accept consent again, then request a new link review.');
    if(s.busy)add('OPERATION_PENDING','A validation or save is still running. Wait for it to finish.');
    if(!s.open||!s.identity||s.needsRefresh)add('REFRESH_REQUIRED','Saved accounts or Career history changed. Refresh saved accounts and review this link again.');
    if(!r||r.kind!=='link'||!p){add('REVIEW_REQUIRED','Request a new link review before confirming.');return issues;}
    if(!s.busy&&Number.isFinite(r.expiresAt)&&(at>=r.expiresAt||at<r.startedAt))add('REVIEW_EXPIRED','This link review expired. Cancel it and click Link account again. If a save was already submitted, read its result before retrying.');
    try{
      if(r.selectionKey&&r.selectionKey!==Model.rawKey(s.rawId)||p.identityRevision!==s.identity.identityRevision||!r.create&&p.personId!==s.personId||r.create&&s.personId)throw error('PERSON_INVALID_PREVIEW');
      var expected=Model.linkInternal(s.identity,p.rawIds,p.personId,p.identityRevision).persons.find(function(v){return v.personId===p.personId;});
      if(!expected||!sameIds(expected.members,p.proposedMembers))throw error('PERSON_INVALID_PREVIEW');
    }catch(_){add('PREVIEW_MISMATCH','This review no longer matches the selected account, Person or saved membership. Refresh and review again.');}
    if(p.requiresExplicitNameResolution!==false)add('NAME_RESOLUTION_REQUIRED','Member labels conflict or the name check is incomplete. Save an explicit Person name above, then review the link again.');
    if(p.status==='CONFLICTING')add('OVERLAPPING_HANDS','These accounts both participated in the same retained hand. They cannot be linked under the current safety rules. Keep their individual histories or choose different accounts; do not delete hands to bypass this check.');
    else if(p.status!=='SAFE'){
      var codes=(Array.isArray(p.unresolved)?p.unresolved:[]).slice(0,32).map(function(v){return v&&typeof v.code==='string'?v.code:'UNKNOWN_HISTORY_ISSUE';});
      if(codes.includes('TYPED_ID_ALIAS')||codes.includes('INVALID_RAW_ID')||codes.includes('AMBIGUOUS_CANONICAL_IDENTITY'))add('AMBIGUOUS_IDENTITY','The retained history cannot distinguish the original account identities safely. Keep these accounts separate.');
      else if(codes.includes('CONTRADICTORY_SESSION_NAMESPACE')||codes.includes('CONTRADICTORY_CANONICAL_IDENTITY'))add('HISTORY_PROVENANCE_CONFLICT','The retained history contains conflicting table or Session references. Linking is unavailable until reliable history is restored.');
      else if(codes.some(function(c){return /BUDGET|DEADLINE|CANCELLED/.test(c);}))add('HISTORY_CHECK_INCOMPLETE','The bounded history check did not finish. Cancel and review again after activity settles; linking stays disabled.');
      else add('HISTORY_UNRESOLVED','Retained history could not be fully validated'+(codes.length?' ('+codes.join(', ')+')':'')+'. Restore reliable missing history or keep these accounts separate.');
    }
    if(p.status==='SAFE'&&p.validationComplete!==true)add('VALIDATION_INCOMPLETE','The history validation is incomplete. Refresh saved accounts and request a new review.');
    if(p.status==='SAFE'&&p.requiresExplicitNameResolution===false&&p.confirmationAvailable!==true)add('CONFIRMATION_UNAVAILABLE','The validation owner has not authorized confirmation'+(p.confirmationBlocker?' ('+p.confirmationBlocker+')':'')+'. Cancel and request a new review.');
    if(p.manualAssertionRequired!==true||p.pendingOutboxCovered!==false||p.policy!==POLICY)add('UNSUPPORTED_REVIEW_POLICY','This response does not match the supported retained-Career review. Refresh and review again.');
    if(s.assertion!==true)add('CHECKBOX_REQUIRED','Check the box to explicitly confirm this local account association.');
    return issues;
  }
  function createAdapter(owners){
    owners=owners||{};var identity=owners.identity||{},links=owners.links||{},career=CareerUi.createAdapter(owners.groupedCareer);
    var capabilities={localLedger:owners.localLedger===true,read:typeof identity.read==='function',name:typeof identity.setAssignedName==='function',
      link:typeof links.previewPublishedLink==='function'&&typeof links.confirmPublishedLink==='function',unlink:typeof links.unlink==='function'||typeof links.confirmUnlink==='function',unlinkReview:typeof links.previewUnlink==='function'&&typeof links.confirmUnlink==='function',career:career.enabled,history:career.historyEnabled,recent:career.recentEnabled};
    function call(owner,method,args){if(typeof owner[method]!=='function')return Promise.reject(error('PERSON_SERVICE_UNAVAILABLE','Person service unavailable.'));return Promise.resolve().then(function(){return owner[method].apply(owner,args);});}
    return Object.freeze({capabilities:Object.freeze(capabilities),career:career,close:function(){if(typeof owners.close==='function')owners.close();},
      read:function(){return call(identity,'read',[]).then(Model.validate);},
      catalog:async function(state){
        if(!owners.catalog||typeof owners.catalog.read!=='function')return Catalog.project(state);
        try{var census=await call(owners.catalog,'read',[]);if(owners.localLedger===true){if(census.mode!=='local-ledger'||census.identityRevision!==state.identityRevision||!Array.isArray(census.rows))throw error('IDENTITY_REVISION_CONFLICT');return census;}return Catalog.project(state,census);}
        catch(e){if(e.code==='IDENTITY_REVISION_CONFLICT')throw e;
          return Catalog.project(state,null,e.code==='CATALOG_LIMIT'?'Career discovery exceeded its bounded read budget; historical selections are unavailable.':'Career discovery failed or contains unsupported evidence; historical selections are unavailable.');}
      },
      name:function(id,value,revision){return call(identity,'setAssignedName',[Model.personTarget(id),value,revision]);},
      preview:function(ids,revision,id){return call(links,'previewPublishedLink',[ids.slice(),revision,id]);},
      confirm:function(preview,assertion){if(assertion!==true)return Promise.reject(error('IDENTITY_MANUAL_ASSERTION_REQUIRED','Explicit confirmation required.'));return call(links,'confirmPublishedLink',[copy(preview),{manualAssertion:assertion}]);},
      previewUnlink:function(id,raw,revision){return call(links,'previewUnlink',[id,raw,revision]);},
      unlink:function(id,raw,revision,receipt){return capabilities.unlinkReview?call(links,'confirmUnlink',[copy(receipt)]):call(links,'unlink',[id,raw,revision]);},
      eligibility:function(id){return typeof links.readEligibility==='function'?call(links,'readEligibility',[id]):Promise.resolve({eligible:false,status:'UNRESOLVED',reason:'SERVICE_UNAVAILABLE'});}
    });
  }
  function message(e){
    var messages={IDENTITY_MEMBERSHIP_CONFLICT:'This ID belongs to another Person. Unlink it there first.',
      IDENTITY_REVISION_CONFLICT:'Identity changed in another tab. Refresh and review the change again.',
      IDENTITY_STALE_PREVIEW:'The review expired or Career data changed. Refresh and review again.',
      IDENTITY_NAME_CONFLICT:'Member labels conflict. Give this Person an explicit name before linking.',
      IDENTITY_CONFLICTING:'Published Career evidence conflicts. Linking is unavailable.',
      IDENTITY_UNRESOLVED:'Published Career evidence is unresolved. Linking is unavailable.',
      IDENTITY_AMBIGUOUS_ID:'The original ID type is uncertain. Linking is unavailable.',
      IDENTITY_INVALID_ID:'Enter an exact PokerNow ID and select its original type.',
      IDENTITY_INVALID_NAME:'Use a display name of at most 200 characters, without control characters.',
      PERSON_TRANSPORT_UNKNOWN:'Result UNKNOWN. Refresh identity to read the native outcome before another change.',
      PERSON_CONSENT_REQUIRED:'Consent ended or expired. Accept consent again and request a new review.',
      PERSON_NATIVE_ERROR:'The save transaction could not be completed or verified. Refresh and read saved accounts before retrying.',
      IDENTITY_TRANSACTION_FAILED:'The save transaction failed. Refresh and read saved accounts before retrying.',
      20:'The save transaction was aborted. Refresh and read saved accounts before retrying.',
      PERSON_INVALID_PREVIEW:'The link review is incomplete or does not match these IDs.',
      PERSON_ALREADY_MEMBER:'This ID is already linked to this Person.',PERSON_SERVICE_UNAVAILABLE:'Person service unavailable.'};
    return (messages[e&&e.code]||'The result could not be verified. Refresh before another change.')+(e&&e.code==='PERSON_NATIVE_ERROR'&&typeof e.message==='string'?' Details: '+e.message.slice(0,400):'');
  }
  function eligibilityMessage(e){
    var messages={PUBLISHED_OVERLAP:'Linked IDs overlap in retained published Career history.',
      ASSIGNED_NAME_CONFLICT:'Member labels conflict; assign an explicit Person name.',
      EXPIRED_CERTIFICATE:'Published Career validation expired.',MEMBERSHIP_CHANGED:'Membership changed and needs new validation.',
      STALE_CAREER_AUTHORITY:'Career history changed since validation.',REVALIDATION_REQUIRED:'Published Career validation must be repeated.',
      MISSING_CERTIFICATE:'No current grouping validation is available.',UNVALIDATED_MEMBERSHIP:'No current validated members.',
      SERVICE_UNAVAILABLE:'Eligibility service unavailable.',STALE_OR_INVALID_RESPONSE:'Eligibility response is stale or unavailable.'};
    return messages[e&&e.reason]||'No current grouping validation is available.';
  }
  function createController(options){
    var adapter=options.adapter,changed=options.changed||function(){},now=options.now||Date.now,generation=0,careerGeneration=0,expiryTimer=null,reviewTimer=null;
    var schedule=options.setTimeout||setTimeout,unschedule=options.clearTimeout||clearTimeout;
    var s={open:false,expanded:false,busy:false,identity:null,rawId:null,personId:null,name:'',candidate:'',search:'',catalog:null,catalogLoading:false,idType:'string',idText:'',assertion:false,review:null,eligibility:null,status:'',needsRefresh:false,unavailableReason:null,careerRequested:false,statisticsScope:'career',sessionId:'',history:CareerUi.unavailable('Load retained Session history.'),career:CareerUi.unavailable('Load combined Career to validate current authority.')};
    function emit(){changed();}
    function person(){return s.identity&&s.identity.persons.find(function(p){return p.personId===s.personId;});}
    function raw(){return s.identity&&s.identity.players.find(function(p){return Model.rawKey(p.playerId)===Model.rawKey(s.rawId);});}
    function clearReview(){if(reviewTimer!==null)unschedule(reviewTimer);reviewTimer=null;s.review=null;s.assertion=false;}
    function armReview(r){var authorization=options.authorization&&options.authorization(),until=Math.min(r.expiresAt,authorization&&Number.isFinite(authorization.expiresAt)?authorization.expiresAt:Infinity);reviewTimer=schedule(function(){reviewTimer=null;if(s.review===r)emit();},Math.max(0,until-now()));if(reviewTimer&&typeof reviewTimer.unref==='function')reviewTimer.unref();}
    function invalidateCareer(reason){careerGeneration++;if(expiryTimer!==null)unschedule(expiryTimer);expiryTimer=null;s.history=CareerUi.unavailable(reason||'Load retained Session history.');s.career=CareerUi.unavailable(reason||'Identity changed. Load combined Career again.');}
    function expire(token,projection){expiryTimer=schedule(function(){if(token===careerGeneration){invalidateCareer('Validation expired. Refresh identity and load again.');emit();}},Math.min(2147483647,Math.max(0,projection.expiresAt-now())));if(expiryTimer&&typeof expiryTimer.unref==='function')expiryTimer.unref();}
    async function loadHistory(){
      if(s.busy||s.needsRefresh||!person()||!adapter.career.historyEnabled||s.history.status==='LOADING')return;
      invalidateCareer();var token=careerGeneration,selected=generation,id=s.personId;
      s.history={status:'LOADING',reason:'Checking retained Session history…',cards:[]};emit();
      var result=await adapter.career.list(Model.validate(s.identity),id,copy(s.eligibility),now);
      if(token!==careerGeneration||selected!==generation||!s.open||id!==s.personId)return;
      s.history=result;if(CareerUi.current(result,now()))expire(token,result);emit();
    }
    async function loadCareer(){
      if(s.busy||s.needsRefresh||!person()||s.career.status==='LOADING')return;
      s.careerRequested=true;invalidateCareer();var token=careerGeneration,selected=generation,state=Model.validate(s.identity),id=s.personId,gate=copy(s.eligibility);
      s.career={status:'LOADING',reason:'Checking combined Career authority…',cards:[]};emit();
      var projection=s.statisticsScope==='historical-session'?await adapter.career.readSession(state,id,gate,s.sessionId,now):s.statisticsScope==='recent'?await adapter.career.readRecent(state,id,gate,s.recentCount,now):s.statisticsScope==='trends'?await adapter.career.readTrends(state,id,gate,s.recentCount,now):await adapter.career.read(state,id,gate,now);
      if(token!==careerGeneration||selected!==generation||!s.open||s.personId!==id)return;
      s.career=projection;
      if(CareerUi.current(projection,now())){
        expire(token,projection);
      }
      emit();
    }
    async function load(token,preferred){
      invalidateCareer();
      var state=await adapter.read();if(token!==generation)return;
      s.identity=Model.validate(state);var row=raw();
      s.personId=row&&row.personId||preferred||null;
      if(s.personId&&!person())s.personId=null;
      s.name=person()&&person().assignedName||'';s.eligibility=null;
      s.catalogLoading=true;s.catalog=null;emit();
      try{var catalog=await adapter.catalog(state);if(token!==generation)return;s.catalog=catalog;}
      finally{if(token===generation)s.catalogLoading=false;}
      if(s.personId){
        var p=person(),eligibility=await adapter.eligibility(p.personId);if(token!==generation)return;
        if(eligibility&&eligibility.eligible===true&&!(eligibility.status==='SAFE'&&eligibility.policy===POLICY&&eligibility.personId===p.personId&&
          eligibility.identityRevision===state.identityRevision&&sameIds(eligibility.members,p.members)&&Number.isFinite(eligibility.expiresAt)&&eligibility.expiresAt>now()))
          eligibility={eligible:false,status:'UNRESOLVED',reason:'STALE_OR_INVALID_RESPONSE'};
        s.eligibility=eligibility||{eligible:false,status:'UNRESOLVED',reason:'SERVICE_UNAVAILABLE'};
      }
    }
    async function select(rawId,preferred,expanded){
      invalidateCareer();
      var token=++generation;s.open=true;s.expanded=expanded===true;s.rawId=rawId;s.identity=null;s.personId=null;s.eligibility=null;s.busy=true;s.needsRefresh=false;s.unavailableReason=null;s.careerRequested=false;
      s.statisticsScope='career';s.sessionId='';s.recentCount=5;s.trendReturn=null;
      s.name='';s.candidate='';s.search='';s.catalog=null;s.catalogLoading=false;s.idType='string';s.idText='';clearReview();s.status='Loading identity…';emit();
      try{Model.rawId(rawId);if(preferred)Model.personTarget(preferred);await load(token,preferred);if(token===generation)s.status='';}
      catch(e){if(token===generation){s.status=message(e);s.needsRefresh=true;}}
      finally{if(token===generation){s.busy=false;emit();}}
    }
    async function run(operation,success,preferred,expectedMembers){
      if(!s.open||s.busy||s.needsRefresh||!s.identity)return;
      invalidateCareer();var token=generation,acknowledged=false;s.busy=true;s.status='Working…';emit();
      try{await operation();acknowledged=true;if(token!==generation)return;clearReview();await load(token,preferred||s.personId);if(token===generation){if(expectedMembers&&(!person()||person().personId!==preferred||!sameIds(person().members,expectedMembers)))throw error('PERSON_READBACK_CHANGED');s.status=success;}}
      catch(e){if(token===generation){clearReview();s.eligibility=null;s.needsRefresh=true;s.status=acknowledged?(e.code==='PERSON_READBACK_CHANGED'?'Link commit acknowledged, but saved membership changed before readback. Refresh saved accounts before another change.':'Change acknowledged; refresh could not be verified. Refresh before another change.'):message(e);}}
      finally{if(token===generation){s.busy=false;emit();}}
    }
    function candidate(){
      if(typeof s.candidate!=='string')throw error('IDENTITY_INVALID_ID');
      if(s.candidate&&s.candidate!=='manual'){
        var id=Model.rawId(JSON.parse(s.candidate));
        if(!s.catalog||!s.catalog.rows.some(function(row){return row.selectable&&Model.rawKey(row.playerId)===Model.rawKey(id);}))throw error('IDENTITY_AMBIGUOUS_ID');
        return id;
      }
      if(s.candidate!=='manual')throw error('IDENTITY_INVALID_ID');
      if(typeof s.idText!=='string'||['string','number'].indexOf(s.idType)<0)throw error('IDENTITY_INVALID_ID');
      if(s.idType==='number'){
        if(!/^(0|[1-9][0-9]*)$/.test(s.idText))throw error('IDENTITY_INVALID_ID');
        return Model.rawId(Number(s.idText));
      }
      return Model.rawId(s.idText);
    }
    async function review(create,renew){
      if(s.busy||s.needsRefresh||!s.identity||!adapter.capabilities.link)return;
      var token=generation,id;
      try{if(renew&&(!person()||!person().members.length))return;
        id=create?s.rawId:renew?person().members[0]:candidate();if(!create&&!person())return;
        if(!create&&!renew&&person().members.some(function(m){return Model.rawKey(m)===Model.rawKey(id);}))throw error('PERSON_ALREADY_MEMBER');
      }catch(e){s.status=message(e);emit();return;}
      var revision=s.identity.identityRevision,personId=create?undefined:s.personId,started=now();s.busy=true;clearReview();s.status='Reviewing retained published Career evidence…';emit();
      try{
        var preview=await adapter.preview([id],revision,personId);if(token!==generation)return;
        Model.personTarget(preview.personId);Model.personTarget(preview.previewId);
        var expected=Model.linkInternal(s.identity,[id],preview.personId,revision).persons.find(function(p){return p.personId===preview.personId;});
        if(preview.identityRevision!==revision||personId&&preview.personId!==personId||create&&s.identity.persons.some(function(p){return p.personId===preview.personId;})||!sameIds(preview.rawIds,[id])||!sameIds(preview.proposedMembers,expected.members))throw error('PERSON_INVALID_PREVIEW');
        s.review={kind:'link',create:create,renew:!!renew,preview:copy(preview),selectionKey:Model.rawKey(s.rawId),startedAt:started,expiresAt:started+REVIEW_MS};armReview(s.review);
        s.status=preview.requiresExplicitNameResolution?message({code:'IDENTITY_NAME_CONFLICT'}):preview.status==='CONFLICTING'?message({code:'IDENTITY_CONFLICTING'}):preview.status!=='SAFE'&&Array.isArray(preview.unresolved)&&preview.unresolved.some(function(issue){return issue.code==='TYPED_ID_ALIAS';})?'Saved identity and retained Career use different ID types. Historical participation cannot be verified; linking is unavailable.':preview.status!=='SAFE'?message({code:'IDENTITY_UNRESOLVED'}):'Review the exact IDs before confirming.';
      }catch(e){if(token===generation){s.status=message(e);if(e.code==='IDENTITY_REVISION_CONFLICT'||e.code==='IDENTITY_STALE_PREVIEW')s.needsRefresh=true;}}
      finally{if(token===generation){s.busy=false;emit();}}
    }
    function issues(){return confirmationIssues(s,now(),options.authorization&&options.authorization());}
    function canConfirm(){return issues().length===0;}
    function input(field,value){
      if(field==='expanded'){s.expanded=value===true;return;}
      if(s.busy||!s.open)return;
      if(field==='person')return select(s.rawId,value||undefined);
      if(field==='statisticsScope'&&(['career','historical-session'].includes(value)||adapter.career.recentEnabled&&['recent','trends'].includes(value))){invalidateCareer();s.trendReturn=null;s.statisticsScope=value;emit();return;}
      if(field==='recentCount'&&['1','3','5','10'].includes(value)){invalidateCareer();s.recentCount=Number(value);emit();return;}
      if(['sessionId','historySelection'].includes(field)&&typeof value==='string'){var retained=s.history;invalidateCareer();s.trendReturn=null;s.history=retained;s.sessionId=value.length<=500?value:'';if(CareerUi.current(retained,now()))expire(careerGeneration,retained);emit();return;}
      if(field==='assertion'){s.assertion=value===true;emit();return;}
      if(field==='search'){if(typeof value!=='string')return;s.search=value.slice(0,500);s.candidate='';clearReview();s.status='';emit();return;}
      if(['name','candidate','idType','idText'].indexOf(field)<0)return;
      s[field]=value;clearReview();s.status='';if(field==='candidate'||field==='idType')emit();
    }
    function action(name,value){
      if(name==='refresh'){if(!s.busy&&!s.unavailableReason){var selection={personId:s.personId,scope:s.statisticsScope,sessionId:s.sessionId,expanded:s.expanded,count:s.recentCount,trendReturn:s.trendReturn};return select(s.rawId,s.personId,s.expanded).then(function(){if(s.personId===selection.personId){s.statisticsScope=selection.scope;s.sessionId=selection.sessionId;s.recentCount=selection.count;s.trendReturn=selection.trendReturn;emit();}});}return;}
      if(s.busy||s.needsRefresh||!s.identity)return;
      if(name==='career')return loadCareer();
      if(name==='history')return loadHistory();
      if(name==='trend-session'&&s.statisticsScope==='trends'&&CareerUi.current(s.career,now())&&s.career.trends&&s.career.trends.some(function(row){return row.sessionId===value;})){
        s.trendReturn={personId:s.personId,sessionId:value,count:s.recentCount};invalidateCareer();s.statisticsScope='historical-session';s.sessionId=value;emit();return loadCareer();
      }
      if(name==='trend-back'&&s.trendReturn&&s.trendReturn.personId===s.personId&&s.trendReturn.sessionId===s.sessionId){var back=s.trendReturn;invalidateCareer();s.statisticsScope='trends';s.recentCount=back.count;s.trendReturn=null;emit();return loadCareer();}
      if(name==='revalidate')return review(false,true);
      if(name==='cancel'){clearReview();s.status='';emit();return;}
      if(name==='create'){if(!s.personId&&(!raw()||!raw().personId))return review(true);return;}
      if(name==='review')return review(false);
      if(name==='name'&&person()&&adapter.capabilities.name){var id=s.personId,draft=s.name,rev=s.identity.identityRevision;clearReview();return run(function(){return adapter.name(id,draft,rev);},'Person name saved.');}
      if(name==='unlink'&&person()&&adapter.capabilities.unlink){
        if(adapter.capabilities.unlinkReview)return reviewUnlink(value);
        try{var member=Model.rawId(JSON.parse(value));if(!person().members.some(function(m){return Model.rawKey(m)===Model.rawKey(member);}))return;
          s.review={kind:'unlink',personId:s.personId,rawId:member,revision:s.identity.identityRevision};s.status='Confirm unlinking. Original Career data will remain.';emit();
        }catch(e){s.status=message(e);emit();}return;
      }
      if(name==='confirm-unlink'&&s.review&&s.review.kind==='unlink'&&adapter.capabilities.unlink){var u=copy(s.review);return run(function(){return adapter.unlink(u.personId,u.rawId,u.revision,u.receipt);},'ID unlinked. Original Career data retained.',u.personId);}
      if(name==='confirm'){if(!s.review)return;if(!canConfirm()){s.status=issues().map(function(i){return i.message;}).join(' ');emit();return;}var preview=copy(s.review.preview),asserted=s.assertion,created=s.review.create,renewed=s.review.renew;return run(function(){return adapter.confirm(preview,asserted);},created?'Person created successfully':renewed?'Membership validation refreshed':'Accounts linked successfully',preview.personId,preview.proposedMembers);}
    }
    async function reviewUnlink(value){
      var token=generation,member,id=s.personId,revision=s.identity.identityRevision;
      try{
        member=Model.rawId(JSON.parse(value));
        if(!person().members.some(function(m){return Model.rawKey(m)===Model.rawKey(member);}))return;
        s.busy=true;clearReview();s.status='Reviewing unlink…';emit();
        var receipt=await adapter.previewUnlink(id,member,revision);
        if(token!==generation)return;
        if(!receipt||receipt.personId!==id||Model.rawKey(receipt.rawId)!==Model.rawKey(member)||receipt.revision!==revision||typeof receipt.authorizationReviewId!=='string')throw error('PERSON_INVALID_PREVIEW');
        s.review={kind:'unlink',personId:id,rawId:member,revision:revision,receipt:receipt};s.status='Confirm unlinking. Original Career data will remain.';
      }catch(e){if(token===generation){clearReview();s.needsRefresh=true;s.status=message(e);}}
      finally{if(token===generation){s.busy=false;emit();}}
    }
    async function resume(selection){
      var token=generation+1;
      await select(selection.rawId,selection.personId,selection.expanded);
      if(token!==generation||!s.open||s.needsRefresh)return;
      if(selection.uncertain){
        s.needsRefresh=true;s.status='Previous change outcome UNKNOWN. Native identity re-read; refresh and review before another change.';emit();
      }else if(selection.careerRequested){await loadCareer();}
      else emit();
    }
    return Object.freeze({select:select,resume:resume,input:input,action:action,invalidateCareer:function(reason){invalidateCareer(reason);if(s.open)emit();},
      invalidateNative:function(reason){if(!s.open)return;var pending=s.busy;generation++;invalidateCareer(reason);clearReview();s.eligibility=null;s.needsRefresh=true;s.busy=false;s.catalogLoading=false;s.status=pending?'Result UNKNOWN or no longer current. Refresh identity before another change.':reason;emit();},
      close:function(){generation++;invalidateCareer();s.open=false;clearReview();if(typeof adapter.close==='function')adapter.close();},
      unavailable:function(rawId){generation++;invalidateCareer();s.open=true;s.rawId=rawId;s.identity=null;s.personId=null;s.eligibility=null;s.catalog=null;s.catalogLoading=false;s.busy=false;s.expanded=false;s.needsRefresh=true;clearReview();s.unavailableReason='Original ID type unavailable from this Dashboard entry. Person linking is disabled.';s.status=s.unavailableReason;emit();},
      state:function(){return copy(s);},render:function(){var at=now(),list=confirmationIssues(s,at,options.authorization&&options.authorization());return render(s,adapter.capabilities,list.length===0,at,list);}});
  }
  function render(s,caps,confirmable,at,issues){
    var label=caps.localLedger?function(id){var row=(s.catalog&&s.catalog.rows||[]).find(function(r){return r.playerId===id&&typeof r.playerId===typeof id;});return (row&&(row.name||row.historicalName)||'Saved account')+' · Saved ID '+String(id);}:function(id){return (typeof id==='number'?'Number ID ':'String ID ')+String(id);};
    if(!s.open)return '';
    var off=s.busy||s.needsRefresh||!s.identity,disabled=off?' disabled':'',p=s.identity&&s.identity.persons.find(function(v){return v.personId===s.personId;}),e=s.eligibility;
    function button(action,text,value,unavailable,accessibleName,description){return '<button type="button" data-person-action="'+action+'"'+(value===undefined?'':' data-person-value="'+esc(value)+'"')+(accessibleName?' aria-label="'+esc(accessibleName)+'"':'')+(description?' aria-describedby="'+esc(description)+'"':'')+(off||unavailable?' disabled':'')+'>'+text+'</button>';}
    var body=(s.status==='Accounts linked successfully'?'<p class="pnhud-person-success" role="status" tabindex="-1">Accounts linked successfully</p>':'')+'<p class="pnhud-dashboard-help">'+esc(s.unavailableReason?'PokerNow navigation ID '+s.rawId:label(s.rawId))+'</p>';
    if(s.identity&&!p){
      body+='<p>This ID is not linked to a Person.</p>'+button('create',caps.localLedger?'Create Person…':'Review creating a Person',undefined,!caps.link);
    }
    var current=s.identity&&s.identity.players.find(function(v){return Model.rawKey(v.playerId)===Model.rawKey(s.rawId);});
    if(s.identity&&(!current||!current.personId)&&s.identity.persons.length){
      body+='<label>Existing Person <select data-person-field="person"'+disabled+'><option value="">Choose a Person…</option>'+s.identity.persons.map(function(v){return '<option value="'+esc(v.personId)+'"'+(v.personId===s.personId?' selected':'')+'>'+esc((v.assignedName||'Unnamed Person')+' · '+v.personId)+'</option>';}).join('')+'</select></label>';
    }
    if(p){
      body+=(caps.localLedger?'<h3>Linked accounts</h3><p>Unlinking keeps every original account, note and hand.</p>':'<p>Person <code>'+esc(p.personId)+'</code></p>')+'<label>Person display name <input type="text" data-person-field="name" maxlength="200" value="'+esc(s.name)+'"'+(off||!caps.name?' disabled':'')+'></label>'+button('name','Save Person name',undefined,!caps.name);
      body+='<ul>'+p.members.map(function(id){return '<li>'+esc(label(id))+' '+button('unlink','Unlink',JSON.stringify(id),!caps.unlink,'Review unlink '+label(id))+'</li>';}).join('')+'</ul>'+(p.members.length?'':'<p>No IDs assigned. This Person and its name are retained.</p>');
      var matches=(s.catalog&&s.catalog.rows||[]).filter(function(row){return [row.name,row.historicalName,String(row.storedId),row.selectable?label(row.playerId):'type unverified',row.personId||''].join(' ').toLowerCase().indexOf(s.search.toLowerCase())>=0;});
      body+='<div class="pnhud-person-picker"><label>Search known players <input type="search" data-person-field="search" maxlength="500" value="'+esc(s.search)+'"'+disabled+'></label>';
      body+='<label>'+(caps.localLedger?'Account to add (ledger key)':'PokerNow ID to add')+' <select data-person-field="candidate"'+(off||!caps.link?' disabled':'')+'><option value="">Choose an exact ID…</option>'+matches.slice(0,50).map(function(row,index){
        var value=row.selectable?JSON.stringify(row.playerId):'unverified-'+index;
        var membership=row.personId===s.personId?' · Current Person member':row.personId?' · Linked to '+row.personId:' · Unlinked';
        var text=(row.name||(!row.historicalName?'Unnamed player':'Historical label: '+row.historicalName))+(row.name&&row.historicalName?' · Historical label: '+row.historicalName:'')+' · '+(row.selectable?label(row.playerId)+(caps.localLedger?' · Local ledger association':' · Saved typed metadata')+membership:'Stored '+typeof row.storedId+' key '+String(row.storedId)+' · '+row.reason);
        return '<option value="'+esc(value)+'"'+(value===s.candidate?' selected':'')+(!row.selectable||row.personId?' disabled':'')+'>'+esc(text)+'</option>';
      }).join('')+(caps.localLedger?'':'<option value="manual"'+(s.candidate==='manual'?' selected':'')+'>Enter another exact ID…</option>')+'</select></label>';
      body+='<p role="status">'+(s.catalogLoading?'Loading known players…':!matches.length?'No matching known players. Use exact typed entry if you know the original ID.':matches.length>50?'Showing 50 of '+matches.length+' matches. Refine your search.':matches.length+' matching known players.')+'</p><p class="pnhud-dashboard-help">'+esc(s.catalog&&s.catalog.warning||'Typed discovery pending.')+'</p></div>';
      if(s.candidate==='manual')body+='<label>Original ID type <select data-person-field="idType"'+disabled+'><option value="string"'+(s.idType==='string'?' selected':'')+'>String</option><option value="number"'+(s.idType==='number'?' selected':'')+'>Number</option></select></label><label>Exact PokerNow ID <input type="text" maxlength="500" data-person-field="idText" value="'+esc(s.idText)+'"'+disabled+'></label>';
      var hasUnlinked=(s.catalog&&s.catalog.rows||[]).some(function(row){return row.selectable&&!row.personId;});
      if(caps.localLedger&&!s.catalogLoading&&!hasUnlinked)body+='<p class="pnhud-dashboard-help">No unlinked eligible account is available. Accounts already in a Person are disabled in the picker; unlink there before moving an account.</p>';
      body+=button('review',caps.localLedger?'Link account…':'Review link',undefined,!caps.link||caps.localLedger&&!hasUnlinked)+button('revalidate','Review current membership validation',undefined,!caps.link||!p.members.length);
      var suspended=!e||e.eligible!==true||e.expiresAt<=at;
      body+='<p role="note">'+(suspended?'Grouped Career eligibility suspended or unavailable.':(caps.localLedger?(s.review?'Current saved membership is validated. The proposed link is checked separately below.':'Current saved membership is validated for retained Career; this does not verify ownership.'):'Retained published Career eligibility reported; this does not verify ownership.'))+(suspended?' '+esc(eligibilityMessage(e)):'')+'</p>';
      body+='<section class="pnhud-person-career" aria-label="Combined Person Career"><h4>'+({'historical-session':'Person historical Session contributions',recent:'Recent retained Sessions',trends:'Historical Session Trends'}[s.statisticsScope]||'Combined Person Career')+'</h4><p class="pnhud-dashboard-help">Retained published contributions for this Person. Individual raw-player statistics above remain separate.</p>';
      if(caps.history){
        body+='<label>Statistics scope <select data-person-field="statisticsScope"'+disabled+'><option value="career"'+(s.statisticsScope==='career'?' selected':'')+'>All retained Career</option><option value="historical-session"'+(s.statisticsScope==='historical-session'?' selected':'')+'>One historical Session</option>'+(caps.recent?'<option value="recent"'+(s.statisticsScope==='recent'?' selected':'')+'>Recent retained Sessions</option><option value="trends"'+(s.statisticsScope==='trends'?' selected':'')+'>Historical Session Trends</option>':'')+'<option disabled>Live Session · authority unavailable</option></select></label>';
        if(['recent','trends'].includes(s.statisticsScope))body+='<label>Retained Sessions <select data-person-field="recentCount"'+disabled+'>'+[1,3,5,10].map(function(n){return '<option value="'+n+'"'+(n===s.recentCount?' selected':'')+'>'+n+'</option>';}).join('')+'</select></label><p>Ordered by last retained contribution. Whole-table dates and completeness are not certified.</p>';
        if(s.statisticsScope==='historical-session'){
          body+=button('history',s.history.status==='LOADING'?'Checking history…':'Discover retained Sessions',undefined,suspended||s.history.status==='LOADING');
          var h=CareerUi.current(s.history,at)&&s.history.history;
          if(h){body+='<p role="status">'+h.totalSessions+' retained Sessions; '+h.unassignedHands+' hands lack explicit Session provenance.'+(h.limited?' Showing the 50 most recent retained contributions. Enter an exact UUID for other history.':'')+'</p>';
            if(h.sessions.length)body+='<label>Retained Session <select data-person-field="historySelection"'+disabled+'><option value="">Choose a Session…</option>'+h.sessions.map(function(row){return '<option value="'+esc(row.sessionId)+'"'+(s.sessionId===row.sessionId?' selected':'')+'>'+esc(row.sessionId)+' · '+row.hands+' retained hands</option>';}).join('')+'</select></label>';
            else body+='<p>No explicit historical Sessions for these retained members.</p>';
          }else body+='<p role="status">'+esc(s.history.reason||'History unavailable.')+'</p>';
          body+='<label>Exact historical Session UUID <input data-person-field="sessionId" maxlength="36" value="'+esc(s.sessionId)+'"'+disabled+'></label><p class="pnhud-dashboard-help">This scope covers retained member contributions, not whole-table Session totals. Live Session is unavailable. Dates and completeness of the whole Session are not certified.</p>';
        }
      }
      if(!off&&!suspended&&CareerUi.current(s.career,at)){
        body+='<p role="note">'+(s.career.status==='FIXTURE_VALIDATED'?'Fixture preview · synthetic authority; these are not saved statistics.':caps.localLedger?'Saved Career snapshot validated for this local association.':'Native Career fence validated for this read.')+'</p><dl class="pnhud-person-career-metrics">'+s.career.cards.map(function(card){return '<div><dt>'+esc(card.label)+'</dt><dd>'+esc(card.value)+'</dd></div>';}).join('')+'</dl>';
        if(s.career.recent)body+='<p role="status">'+s.career.recent.selectedSessionIds.length+' selected of '+s.career.recent.totalSessions+' retained Sessions. '+s.career.recent.unassignedHands+' unassigned hands excluded.</p>';
        if(s.career.trends)body+=s.career.trends.length?'<ol class="pnhud-person-trends">'+s.career.trends.map(function(row){return '<li><code>'+esc(row.sessionId)+'</code>'+button('trend-session','Open retained Session',row.sessionId,false,'Open retained Session '+row.sessionId)+'<dl class="pnhud-person-career-metrics">'+row.cards.map(function(card){return '<div><dt>'+esc(card.label)+'</dt><dd>'+esc(card.value)+'</dd></div>';}).join('')+'</dl></li>';}).join('')+'</ol>':'<p>No explicit retained Sessions for Trends.</p>';
        body+='<p class="pnhud-dashboard-help">FCBet is flop continuation bet (Dashboard CBet). --- means unavailable, not zero.</p>';
      }else body+='<p role="status">'+esc(s.career.status==='LOADING'?s.career.reason:suspended?'Combined Career suspended or unavailable. '+eligibilityMessage(e):s.career.expiresAt?'Combined Career is stale or expired. Load again.':s.career.reason)+'</p>';
      if(s.trendReturn&&s.trendReturn.personId===s.personId&&s.trendReturn.sessionId===s.sessionId)body+=button('trend-back','Back to retained Trends',undefined,suspended||s.career.status==='LOADING');
      body+=button('career',s.career.status==='LOADING'?'Checking statistics…':s.statisticsScope==='historical-session'?'Load selected Session contributions':'Load / refresh combined Career',undefined,!caps.career||suspended||s.career.status==='LOADING')+(caps.career?'':'<p>Native grouped Career adapter unavailable.</p>')+'<p class="pnhud-dashboard-help">Pending saves, live Sessions and missing history are outside the published policy.</p></section>';
    }
    if(!caps.link)body+='<p>Person linking service unavailable.</p>';
    if(s.review){
      body+='<div class="pnhud-person-confirmation" role="group" aria-label="Review Person membership">';
      if(s.review.kind==='unlink')body+='<p>Unlink '+esc(label(s.review.rawId))+' from this Person? Individual statistics and Career records stay intact.</p>'+button('confirm-unlink','Confirm unlink');
      else{
        var preview=s.review.preview;
        body+='<p>'+(caps.localLedger?'Person: <strong>'+esc(preview.assignedName||p&&p.assignedName||(s.review.create?'New Person':'Unnamed Person — save a name above'))+'</strong>':'Proposed Person '+esc(preview.personId))+'</p><ul>'+preview.proposedMembers.map(function(id){return '<li>'+esc(label(id))+'</li>';}).join('')+'</ul><p id="pnhud-person-review-help">Checks cover retained published Career history only. Pending saves, live Sessions and missing history are not covered. A review is valid for at most two minutes and until saved data changes.</p>';
        body+='<label><input type="checkbox" data-person-field="assertion" aria-describedby="pnhud-person-review-help"'+(s.assertion?' checked':'')+disabled+'> I explicitly confirm these IDs represent the same person.</label><div id="pnhud-person-confirm-reason" role="status" aria-live="polite">'+(confirmable?'<p>Ready to save this reviewed association.</p>':'<ul>'+issues.map(function(i){return '<li data-person-blocker="'+esc(i.code)+'">'+esc(i.message)+'</li>';}).join('')+'</ul>')+'</div>'+button('confirm',s.review.create?'Confirm create':s.review.renew?'Confirm validation':'Confirm link',undefined,!confirmable,undefined,'pnhud-person-confirm-reason');
      }
      body+=button('cancel','Cancel')+'</div>';
    }
    return (caps.localLedger?'<section class="pnhud-dashboard-section pnhud-person-linking"':'<details class="pnhud-dashboard-section pnhud-person-linking"')+' data-person-raw-key="'+esc(JSON.stringify([typeof s.rawId,s.rawId]))+'"'+(s.expanded?' open':'')+'>'+(caps.localLedger?'<h2>2. Create or choose a Person</h2>':'<summary>Manage Person · development only</summary>')+'<div>'+body+
      '<p class="pnhud-dashboard-help">Individual account statistics remain separate. '+(caps.recent?'Retained History, Recent and Trends require fresh validation. Live Session grouping is unavailable.':caps.history?'Historical scope requires a fresh native read. Live Session, Recent and Trends totals are unavailable.':caps.career?'Grouped Session, Recent, History and Trends totals are unavailable.':'Grouped Career totals are unavailable in this UI; grouped Session totals are unavailable.')+'</p>'+(caps.career?'':'<button type="button" data-person-action="grouped" disabled>Grouped statistics unavailable</button> ')+
      '<button type="button" data-person-action="refresh"'+(s.busy||s.unavailableReason?' disabled':'')+'>Refresh identity</button><p id="pnhud-person-operation-status" role="status" aria-live="polite" aria-atomic="true">'+esc(s.status==='Accounts linked successfully'?'':s.status)+'</p></div>'+(caps.localLedger?'</section>':'</details>');
  }
  return Object.freeze({createAdapter:createAdapter,createController:createController,confirmationIssues:confirmationIssues});
});
