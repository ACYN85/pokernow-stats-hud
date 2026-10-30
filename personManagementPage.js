/* Trusted extension document; no page-message listener, URL action or public controller capability. */
(function () {
  'use strict';
  if (window.top !== window || location.href !== chrome.runtime.getURL('personManagement.html')) return;
  var localLedger=globalThis.PokerNowRuntimeScope?.compatibilityPersonPolicy==='manual-opaque-ledger-v1';
  var view='manage';
  var authorizationExpiresAt=0,authorizationIssuedAt=0;
  var consent = document.getElementById('consent'), management = document.getElementById('management'), status = document.getElementById('authorization-status');
  var assertion = document.getElementById('consent-assertion'), accept = document.getElementById('accept-consent'), selector = document.getElementById('raw-player');
  var host = document.getElementById('pnhud-player-dashboard'), controller, base = '', generation = 0, censusGeneration=0, active = false, operating = false, uncertain = false, rememberedFocus = null;
  var transport = PokerPersonManagementTransport.connect(chrome.runtime, function (kind) {
    if (kind === 'connection' || kind === 'revoked') { if (operating) uncertain = true; disable(kind === 'revoked' ? 'Consent ended or expired. Saved Persons and Career remain. Accept again and review saved data before another change.' : 'Connection lost. A pending change may be UNKNOWN. Accept again and read saved accounts.'); }
    else if (controller) { if (controller.state().busy) controller.invalidateCareer(localLedger?'Saved Career changed. Load combined Career again.':'Native authority changed. Load combined Career again.'); else controller.invalidateNative(localLedger?'Saved accounts or Career changed. Refresh identity and review again.':'Native authority changed. Refresh identity.'); }
  });
  if(localLedger){
    transport.owners.localLedger=true;
    document.querySelector('label[for=raw-player]').textContent='Saved player account';
    document.getElementById('consent-policy').innerHTML='<li>You choose which saved accounts to group. This is a local association, not verification of PokerNow ownership.</li><li>Ambiguous IDs, missing history and accounts that played in the same hand cannot be combined safely. Matching names are never enough.</li><li>Original account statistics, notes and histories stay separate. Combined Career uses the original hand counters.</li><li>Person + Career Backup is in Settings → Data. It preserves associations and Career, but excludes notes and Settings. Older backups omit associations.</li>';
    document.getElementById('person-view').addEventListener('change',function(){host.classList.toggle('person-combined-view',this.value==='combined');if(this.value==='combined'&&controller)controller.action('career');});
    document.addEventListener('pnhud-person-data-changed',function(){if(active&&controller){censusGeneration++;controller.invalidateNative('Restore completed. Reading saved accounts…');populate(controller.state().rawId,true).catch(e=>disable(e.message));}});
  }
  function disable(reason) {
    document.dispatchEvent(new CustomEvent('pnhud-person-disabled'));
    generation++;censusGeneration++; active = false;authorizationExpiresAt=0; operating = false;
    var old = controller; controller = null; if (old) old.close();
    rememberedFocus = null; host.replaceChildren(); management.hidden = true;document.getElementById('access-controls').hidden=true; consent.hidden = false; assertion.checked = false; accept.disabled = true; status.textContent = reason;
  }
  function render() {
    if (!controller || !active) return;
    if(localLedger)document.getElementById('statistics-view-label').hidden=!controller.state().personId;
    var panel = host.querySelector('.pnhud-person-linking');
    if (!localLedger&&panel && panel.dataset.personRawKey === JSON.stringify([typeof controller.state().rawId, controller.state().rawId])) controller.input('expanded', panel.open);
    var focus = document.activeElement, field = focus && focus.dataset.personField, action = focus && focus.dataset.personAction;
    if (field || action) rememberedFocus = field ? '[data-person-field="' + field + '"]' : '[data-person-action="' + action + '"]';
    else if (focus && focus !== document.body && !host.contains(focus)) rememberedFocus = null;
    var start = focus && focus.selectionStart, end = focus && focus.selectionEnd;
    var entering = controller.state().review && !controller.state().busy && !host.querySelector('.pnhud-person-confirmation');
    host.innerHTML = localLedger?controller.render()+'<section class="pnhud-account-individual">'+base+'</section>':base.replace('</div><button type="button" class="pnhud-dashboard-resize"', controller.render() + '</div><button type="button" class="pnhud-dashboard-resize"');
    var target = entering ? host.querySelector(controller.state().review.kind === 'unlink' ? '[data-person-action="confirm-unlink"]' : '[data-person-field="assertion"]') :
      rememberedFocus ? host.querySelector(rememberedFocus) : null;
    if(!target&&['trend-session','trend-back'].includes(action))target=host.querySelector('[data-person-field="statisticsScope"]');
    if (target && !target.disabled) { target.focus(); if (typeof start === 'number' && target.setSelectionRange && !entering) target.setSelectionRange(start, end); }
  }
  async function select(id) {
    var token = ++generation;
    rememberedFocus = null; base = ''; host.replaceChildren();
    var service=PokerCareerIndexedStore.createMessageService(chrome.runtime);
    var dashboard=localLedger?await service.careerDashboardStats(id,{position:null,situation:'overall',tableSize:'all',opponentMode:'overall',selfPlayerId:null}):null;
    var stats = dashboard?null:await service.careerStats(id);
    if (token !== generation || !active) return;
    base = PokerPlayerDashboard.render({ playerId: String(id), displayName: (localLedger?'Individual Career account ':'PokerNow ID ') + String(id), mode: 'career', careerStats: stats,coreStats:dashboard?.core,relationalStats:dashboard?.relational,careerTrackingStartedAt:dashboard?.careerTrackingStartedAt });
    await controller.select(id, undefined, true);
    if (token !== generation || !active) return;
    render();if(localLedger&&document.getElementById('person-view').value==='combined')await controller.action('career');
  }
  async function populate(preferred,automatic){
    var token=++censusGeneration;
    var state=await transport.owners.identity.read();if(!active||token!==censusGeneration)return;
    var census=localLedger?await transport.owners.catalog.read():null;
    // A late observer/census reply must never replace a user's new selection or
    // discard a review started after that read. It carries no fresh UI authority.
    if(!active||token!==censusGeneration||automatic&&(operating||controller.state().busy||controller.state().review))return;
    var choices=localLedger?census.rows.filter(r=>r.selectable||r.personId).map(r=>({playerId:r.playerId,assignedName:r.name,personId:r.personId})):state.players;
    if(localLedger){
      const info=PokerCompatibilityPersonCatalog.presentation(census);
      choices=census.rows.filter(r=>r.selectable&&census.backupReady!==false||r.personId).map(r=>({playerId:r.playerId,assignedName:r.name,personId:r.personId}));
      const card=document.getElementById('account-state');card.dataset.state=info.code;
      document.getElementById('account-state-title').textContent=info.title;document.getElementById('account-state-message').textContent=info.message;
      const list=document.getElementById('ineligible-accounts');list.replaceChildren();for(const row of info.blocked){const li=document.createElement('li');li.textContent=row.name+' · Saved ID '+row.id+': '+row.reason;list.append(li);}
      document.getElementById('open-data-settings').hidden=info.code==='READY';
    }
    selector.replaceChildren();for(const p of choices){var o=document.createElement('option');o.value=JSON.stringify(p.playerId);o.textContent=(p.assignedName||'Saved account')+' · '+(localLedger?'Saved ID ':typeof p.playerId==='number'?'Number ID ':'String ID ')+String(p.playerId);selector.append(o);}
    document.getElementById('catalog-status').textContent=localLedger?'Local grouping does not verify account ownership or reconstruct original ID types.':state.players.length?'Only saved typed metadata is selectable.':'No saved typed players.';selector.disabled=!choices.length;document.getElementById('statistics-view-label').hidden=!choices.length;
    if(!choices.length){selector.append(new Option('No eligible saved accounts',''));base='';host.innerHTML=localLedger?'<section class="pnhud-person-linking"><h2>2. Create or choose a Person</h2><p>These controls become available when eligible saved accounts exist.</p><button disabled>Create Person</button> <button disabled>Link account</button></section>':'';return;}
    var selected=choices.some(p=>p.playerId===preferred)?preferred:choices[0].playerId;
    if(localLedger&&preferred===undefined){var current=await chrome.tabs.getCurrent();if(current?.openerTabId!==undefined){try{var hint=await chrome.tabs.sendMessage(current.openerTabId,{type:'PNHUD_COMPATIBILITY_PERSON_CONTEXT'});if(choices.some(p=>p.playerId===hint?.playerId))selected=hint.playerId;}catch(_){}}}
    selector.value=JSON.stringify(selected);await select(selected);
  }
  async function begin() {
    if (operating) return; operating = true; accept.disabled = true;
    try {
      authorizationIssuedAt=Date.now();var authorization=await transport.accept(); active = true;authorizationExpiresAt=authorization&&authorization.expiresAt||0;
      consent.hidden = true; management.hidden = view==='backup';document.getElementById('access-controls').hidden=false;
      if(view==='backup'){document.dispatchEvent(new CustomEvent('pnhud-person-consent',{detail:{expiresAt:authorization.expiresAt}}));status.textContent='Settings → Data · Person + Career Backup is ready.';uncertain=false;return;}
      controller = PokerPersonLinkingUi.createController({ adapter: PokerPersonLinkingUi.createAdapter(transport.owners), changed: render,authorization:function(){return {active:active,issuedAt:authorizationIssuedAt,expiresAt:authorizationExpiresAt};} });
      await populate();
      status.textContent = uncertain ? 'Native identity re-read. Previous outcome was UNKNOWN; review the saved state before another change.' : localLedger?'Local account association enabled for this document. Review each change.':'Authorized for this document. Review every proposed link or unlink.';
      uncertain = false; selector.focus();
    } catch (e) { disable('Unavailable: ' + (e.code || 'PERSON_TRANSPORT_UNKNOWN') + '. No change was retried.'); }
    finally { operating = false; }
  }
  document.addEventListener('input', function (e) {
    if (!e.isTrusted) return;
    if (e.target === assertion) { accept.disabled = !assertion.checked; return; }
    if (active && controller && e.target.matches('[data-person-field]')) controller.input(e.target.dataset.personField, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
  });
  document.addEventListener('change', function (e) {
    if (!e.isTrusted) return;
    if (e.target === selector && active) {censusGeneration++;select(JSON.parse(selector.value)).catch(function (error) { disable('Native read failed: ' + error.message); });}
    else if (active && controller && e.target.matches('select[data-person-field]')) controller.input(e.target.dataset.personField, e.target.value);
  });
  document.addEventListener('click', async function (e) {
    if (!e.isTrusted) return;
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    if(b.id==='open-data-settings'){
      try{const current=await chrome.tabs.getCurrent();if(current?.openerTabId===undefined)throw Error('No game tab');const result=await chrome.tabs.sendMessage(current.openerTabId,{type:'PNHUD_COMPATIBILITY_OPEN_DATA_SETTINGS'});if(!result?.ok)throw Error('Game tab closed');await chrome.tabs.update(current.openerTabId,{active:true});}
      catch(_){status.textContent='Open a PokerNow table, then HUD Settings → Data to restore your existing backup.';}return;
    }
    if (b.id === 'accept-consent' && assertion.checked) { await begin(); return; }
    if (b.id === 'decline-consent') { assertion.checked = false; accept.disabled = true; status.textContent = 'Person management remains disabled. Saved data is retained.'; return; }
    if (b.id === 'revoke-consent') {
      uncertain = uncertain || operating || !!(controller && controller.state().busy);
      active = false; management.hidden = true; status.textContent = 'Withdrawing authorization…';
      try { await transport.revoke(); } catch (_) { uncertain = true; }
      disable('Authorization withdrawn. Saved Persons and Career remain.'); return;
    }
    if (active && controller && b.dataset.personAction) { censusGeneration++;operating = true; try { if(localLedger&&b.dataset.personAction==='refresh')await populate(controller.state().rawId);else await controller.action(b.dataset.personAction, b.dataset.personValue);
      if(localLedger&&b.dataset.personAction==='confirm'&&controller.state().status==='Accounts linked successfully'){document.getElementById('person-view').value='combined';host.classList.add('person-combined-view');await controller.action('career');const success=host.querySelector('.pnhud-person-success');if(success){success.scrollIntoView({block:'center'});success.focus({preventScroll:true});}}
    } finally { operating = false; } }
  });
  host.addEventListener('toggle', function (e) { if (controller && e.target.matches('.pnhud-person-linking')) controller.input('expanded', e.target.open); }, true);
  document.addEventListener('keydown', function (e) { if (e.isTrusted && e.key === 'Escape' && active && controller && controller.state().review) { controller.action('cancel'); e.preventDefault(); } });
  document.addEventListener('visibilitychange', function () { if (controller) controller.invalidateCareer('Visibility changed. Load combined Career to validate it.'); });
  window.addEventListener('focus', function () { if (controller) controller.invalidateCareer('Focus changed. Load combined Career to validate it.'); });
  window.addEventListener('pagehide', function () { if (operating) uncertain = true; disable('Document suspended. Consent and native readback are required.'); transport.owners.close(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) disable('Cached document resumed. Consent and fresh native identity are required.'); });
  async function configure(){
    if(localLedger){const result=await chrome.runtime.sendMessage({type:'PNHUD_COMPATIBILITY_PERSON_VIEW'});const saved=sessionStorage.getItem('pnhud-person-presentation-v1');view=result?.ok&&result.view||saved||'manage';if(!['manage','backup'].includes(view))view='manage';sessionStorage.setItem('pnhud-person-presentation-v1',view);document.body.dataset.personView=view;
      if(view==='backup'){document.title='Person + Career Backup — Settings → Data';document.getElementById('page-context').textContent='Settings / Data';document.getElementById('page-title').textContent='Person + Career Backup';document.getElementById('page-intro').textContent='Export or restore saved associations and Career. Notes and Settings stay local.';document.getElementById('consent-heading').textContent='Allow Person + Career Backup for this page';document.getElementById('consent-policy').innerHTML='<li>The bundle includes saved Person associations, Person names and Career records. Notes and Settings are not included.</li><li>Import changes nothing until you review its exact preview and confirm Replace or Merge.</li><li>Replace replaces this installation’s Career records and Person associations, then resets the selected live Session. Merge preserves compatible saved data and the live Session. Restored associations need a fresh review before combined statistics are shown.</li><li>If a result is uncertain, reopen and read saved data before retrying. No operation is automatically repeated.</li>';assertion.parentElement.lastChild.textContent=' I understand and allow Person + Career Backup for this page.';}
    }
    return transport.status();
  }
  configure().then(function (s) { if (s.enabled) disable(localLedger?(view==='backup'?'Choose whether to use Person + Career Backup.':'Choose whether to manage local account associations.'):'Person linking requires your explicit choice. Production activation is still blocked on backup and qualification.'); }, function () { consent.hidden = true; status.textContent = 'Person management is disabled in this build.'; });
})();
