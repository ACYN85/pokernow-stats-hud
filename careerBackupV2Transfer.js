'use strict';
(function () {
  var ack = document.getElementById('ack'), save = document.getElementById('save'), cancel = document.getElementById('cancel');
  var status = document.getElementById('status'), progress = document.getElementById('progress'), worker = null, active = false, phase = 'ready';
  function controls() { ack.disabled = active; save.disabled = active || !ack.checked; cancel.disabled = !active || phase === 'picker'; }
  function finish() { active = false; controls(); if (worker) worker.terminate(); worker = null; }
  function render(m) {
    phase = m.status;
    status.textContent = m.status === 'complete' ? 'Complete. Backup v2 file closed successfully. It can be used for Replace or Merge.' :
      m.status === 'canceled' ? 'Canceled. Delete the incomplete file and restart with a fresh filename.' :
      m.status === 'failed' ? 'Failed: ' + m.error + ' Delete the incomplete file.' : m.status;
    progress.replaceChildren();
    [['Physical records', m.physicalRecords], ['Chunks streamed', m.chunks], ['Uncompressed bytes', m.uncompressedBytes], ['File bytes', m.fileBytes]].forEach(function (pair) {
      var dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = pair[0]; dd.textContent = (pair[1] || 0).toLocaleString(); progress.append(dt, dd);
    }); controls();
  }
  ack.onchange = controls;
  save.onclick = async function () {
    if (active || !ack.checked) return;
    active = true; phase = 'picker'; controls(); progress.replaceChildren();
    status.textContent = 'Choose a fresh filename. Existing files may be destroyed immediately.';
    var handle;
    try {
      if (typeof showSaveFilePicker !== 'function') throw new Error('File System Access is unavailable in this browser.');
      // Invoke synchronously in this click's user activation: no preparatory await.
      handle = await showSaveFilePicker({ id: 'pnhud-career-v2', startIn: 'documents',
        suggestedName: 'PokerNow-HUD-Career-v2-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8) + '.jsonl.gz',
        types: [{ description: 'Career Backup v2 gzip', accept: { 'application/gzip': ['.gz'] } }] });
    } catch (error) {
      status.textContent = error.name === 'AbortError' ? 'File picker canceled. Export did not start.' :
        error.name === 'SecurityError' ? 'File picker blocked: valid user activation and a supported extension page are required.' :
        error.name === 'NotAllowedError' ? 'File permission denied. Export did not start.' : 'File picker failed: ' + error.message;
      finish(); return;
    }
    phase = 'preparing'; controls();
    try {
      worker = new Worker('careerBackupV2Worker.js');
      worker.onmessage = function (event) { var m = event.data; if (m.type === 'progress') render(m.value); if (m.type === 'result' || m.type === 'error') finish(); };
      worker.onerror = function (event) { status.textContent = 'Export worker failed: ' + event.message + '. Delete the incomplete file.'; finish(); };
      worker.postMessage({ type: 'start', handle: handle });
    } catch (error) { status.textContent = 'Could not start export: ' + error.message + '. Delete the incomplete file.'; finish(); }
  };
  cancel.onclick = function () { if (worker && active) { cancel.disabled = true; status.textContent = 'Canceling…'; worker.postMessage({ type: 'cancel' }); } };
  window.addEventListener('beforeunload', function (event) { if (active && phase !== 'picker') { event.preventDefault(); event.returnValue = ''; } });
  controls();
})();
