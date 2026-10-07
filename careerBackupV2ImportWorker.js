'use strict';
importScripts('stats.js', 'careerStatsAggregator.js', 'filteredStats.js', 'statEvidence.js', 'careerContributionStore.js',
  'careerIndexedStore.js', 'careerBackup.js', 'careerBackupV2.js', 'careerBackupV2Import.js');
var controller = null, staged = null, publishing = false;
var progressId = 0, acknowledgeProgress = null;
function progress(value) {
  return new Promise(function (resolve) {
    var id = ++progressId, signal = controller.signal;
    function complete() { signal.removeEventListener('abort', complete); acknowledgeProgress = null; resolve(); }
    acknowledgeProgress = complete; signal.addEventListener('abort', complete, { once: true });
    postMessage({ type: 'progress', id: id, value: value });
  });
}
function errorResult(error) {
  postMessage({ type: 'error', value: { code: error.code || error.name, message: error.message } });
  if (staged) staged.close(); staged = null; controller = null; publishing = false;
}
onmessage = function (event) {
  var m = event.data;
  if (m.type === 'progress-ack' && m.id === progressId) { if (acknowledgeProgress) acknowledgeProgress(); return; }
  if (m.type === 'cancel' && controller && !publishing) {
    controller.abort();
    if (staged) { staged.close(); staged = null; controller = null; postMessage({ type: 'error', value: { code: 'CAREER_BACKUP_V2_CANCELED', message: 'Canceled. No Career changes were applied.' } }); }
    return;
  }
  if (m.type === 'start' && !controller) {
    controller = new AbortController();
    PokerCareerBackupV2Import.prepare(m.file, { mode: m.mode, signal: controller.signal, onProgress: progress })
      .then(function (result) { staged = result; postMessage({ type: 'ready', value: result.preview }); }, errorResult);
  }
  if (m.type === 'publish' && staged && !publishing) {
    publishing = true;
    staged.publish(m.confirmation).then(function (result) {
      postMessage({ type: 'result', value: result }); staged.close(); staged = null; controller = null; publishing = false;
    }, errorResult);
  }
};
