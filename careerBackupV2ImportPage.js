'use strict';
(function () {
  var el = {}; ['mode', 'session', 'file', 'cancel', 'status', 'progress', 'confirmation', 'ack', 'publish', 'replace-confirmation', 'merge-confirmation'].forEach(function (id) { el[id] = document.getElementById(id); });
  function mode() { return el.mode.value || 'replace'; }
  function showMode() {
    el.session.disabled = mode() === 'merge';
    el['replace-confirmation'].hidden = mode() === 'merge'; el['merge-confirmation'].hidden = mode() !== 'merge';
    el.publish.textContent = mode() === 'merge' ? 'Merge Career and preserve Session' : 'Replace Career and reset Session';
  }
  el.mode.onchange = showMode; showMode();
  var worker = null, active = false, preview = null, port = null, waiters = {}, publishing = false;
  function finish() {
    active = false; publishing = false; el.file.value = ''; el.file.disabled = false; el.mode.disabled = false; el.cancel.disabled = true; showMode();
    el.confirmation.hidden = true; preview = null; if (worker) worker.terminate(); worker = null;
    if (port) port.disconnect(); port = null;
  }
  function sessionMessage(type) {
    return new Promise(function (resolve, reject) {
      waiters[type] = { resolve: resolve, reject: reject }; port.postMessage({ type: type });
    });
  }
  function drainCareerOutbox() {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage({ type: 'PNHUD_CAREER_INDEXED_REQUEST', method: 'prepareBackupV2Publication' }, function (result) {
        var error = chrome.runtime.lastError;
        if (error || !result?.ok) reject(new Error(error?.message || result?.error || 'Career preparation failed'));
        else resolve();
      });
    });
  }
  async function connectSession() {
    await sessionDiscovery;
    if (!el.session.value) return;
    port = chrome.tabs.connect(Number(el.session.value), { name: 'PNHUD_BACKUP_V2_REPLACE' });
    port.onMessage.addListener(function (m) { var w = waiters[m.type]; if (!w) return; delete waiters[m.type]; if (m.ok) w.resolve(m); else w.reject(new Error(m.error)); });
    port.onDisconnect.addListener(function () {
      var error = new Error('The selected PokerNow page closed or its controller changed.');
      Object.values(waiters).forEach(function (w) { w.reject(error); }); waiters = {};
    });
    await sessionMessage('prepare');
  }
  // Content-script matches do not grant tab URL access. Settings supplies its
  // originating game through openerTabId, readable without tabs/host permission.
  // The export page's same-tab import link preserves that opener as well.
  var sessionTabs = [];
  var sessionDiscovery = new Promise(function (resolve) {
    chrome.tabs.getCurrent(function (current) {
      void chrome.runtime.lastError;
      chrome.tabs.query({ url: ['https://pokernow.com/games/*', 'https://www.pokernow.com/games/*'] }, function (tabs) {
        void chrome.runtime.lastError;
        sessionTabs = tabs || [];
        var opener = current && current.openerTabId;
        if (opener !== undefined && !sessionTabs.some(function (tab) { return tab.id === opener; }))
          sessionTabs.unshift({ id: opener, title: 'PokerNow Session that opened Settings' });
        sessionTabs.forEach(function (tab) { var option = document.createElement('option'); option.value = String(tab.id); option.textContent = tab.title || tab.url; el.session.append(option); });
        if (sessionTabs.length) { el.session.firstElementChild.remove(); el.session.value = String(opener !== undefined ? opener : (sessionTabs.find(function (t) { return t.active; })?.id || sessionTabs[0].id)); }
        resolve();
      });
    });
  });
  el.ack.onchange = function () { el.publish.disabled = !el.ack.checked || publishing; };
  el.file.onchange = async function () {
    if (active || !el.file.files[0]) return;
    active = true; el.file.disabled = true; el.mode.disabled = true; el.session.disabled = true; el.cancel.disabled = true; el.ack.checked = false; el.publish.disabled = true;
    el.status.textContent = 'Preparing current Career…';
    try {
      await drainCareerOutbox();
      worker = new Worker('careerBackupV2ImportWorker.js');
      el.cancel.disabled = false;
      worker.onmessage = async function (event) {
        var m = event.data;
        if (m.type === 'progress') {
          el.status.textContent = m.value.status.replace(/-/g, ' '); el.progress.replaceChildren();
          [['Local physical records', m.value.localPhysicalRecords], ['Imported physical records', m.value.importedPhysicalRecords],
            ['Identical duplicates', m.value.identicalDuplicates], ['Unique additions', m.value.uniqueImportedAdditions],
            ['Physical records staged', m.value.physicalRecords], ['Logical hands validated', m.value.activeRecords]].forEach(function (p) {
            var dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = p[0]; dd.textContent = (p[1] || 0).toLocaleString(); el.progress.append(dt, dd);
          });
          worker.postMessage({ type: 'progress-ack', id: m.id });
        }
        if (m.type === 'ready') { preview = m.value; el.confirmation.hidden = false; el.status.textContent = 'Validated and ready to publish. Current Career is unchanged.'; }
        if (m.type === 'error') { el.status.textContent = m.value.code + ': ' + m.value.message + ' No Career changes were applied.'; finish(); }
        if (m.type === 'result') {
          if (mode() === 'merge') {
            el.status.textContent = m.value.noChange ? 'NO_CHANGE. Compatible history and boundary metadata are already present. Career and live Session are unchanged.' : 'Complete. Career merged. Live Session preserved.';
            if (m.value.committed) {
              sessionDiscovery.then(function () {
                sessionTabs.forEach(function (tab) { chrome.tabs.sendMessage(tab.id, { type: 'PNHUD_BACKUP_V2_MERGE_PUBLISHED' }, function () { void chrome.runtime.lastError; }); });
              });
              chrome.runtime.sendMessage({ type: 'PNHUD_CAREER_INDEXED_REQUEST', method: 'driveCareerSessionProjections' }, function () { void chrome.runtime.lastError; });
            }
            finish(); return;
          }
          el.status.textContent = 'Career replaced. Resetting current Session…';
          try { if (port) await sessionMessage('committed'); el.status.textContent = 'Complete. Career replaced.' + (port ? ' Current Session reset to 0.' : ' No current live Session was open.'); }
          catch (e) { el.status.textContent = 'Career was replaced and remains committed, but Session reset persistence failed: ' + e.message + ' Use Reset Session before relying on Session after reload.'; }
          chrome.runtime.sendMessage({ type: 'PNHUD_CAREER_INDEXED_REQUEST', method: 'driveCareerSessionProjections' }, function () { void chrome.runtime.lastError; });
          finish();
        }
      };
      worker.onerror = function (event) { el.status.textContent = publishing ? 'Import worker ended during publication. Reopen Career to check the committed bank before retrying.' : 'Import worker failed. No Career changes were applied: ' + event.message; finish(); };
      worker.postMessage({ type: 'start', file: el.file.files[0], mode: mode() });
    } catch (e) { el.status.textContent = 'Could not start import: ' + e.message + ' No Career changes were applied.'; finish(); }
  };
  el.publish.onclick = async function () {
    if (!preview || !el.ack.checked || publishing) return;
    publishing = true; el.publish.disabled = true; el.cancel.disabled = true;
    try {
      if (mode() === 'replace') await connectSession();
      await drainCareerOutbox();
      worker.postMessage({ type: 'publish', confirmation: { mode: mode(), confirmed: true, expectedJobId: preview.jobId, expectedFinalChain: preview.finalChain } });
    } catch (e) { el.status.textContent = 'Could not prepare the live Session: ' + e.message + ' No Career changes were applied.'; finish(); }
  };
  el.cancel.onclick = function () { if (worker && !publishing) { el.cancel.disabled = true; worker.postMessage({ type: 'cancel' }); } };
  window.addEventListener('beforeunload', function (event) { if (active) { event.preventDefault(); event.returnValue = ''; } });
})();
