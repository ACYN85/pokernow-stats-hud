'use strict';
// Same extension origin as MV3 Career; no runtime messages or worker-liveness dependency.
importScripts('stats.js', 'careerStatsAggregator.js', 'filteredStats.js', 'statEvidence.js', 'careerContributionStore.js',
  'careerIndexedStore.js', 'careerBackup.js', 'careerBackupV2.js', 'careerBackupV2Export.js');
var transfer = null;
onmessage = function (event) {
  var m = event.data;
  if (m.type === 'cancel') { if (transfer) transfer.abort(); return; }
  if (m.type !== 'start' || transfer) return;
  transfer = new AbortController();
  PokerCareerBackupV2Export.run(m.handle, { signal: transfer.signal,
    onProgress: function (progress) { postMessage({ type: 'progress', value: progress }); }
  }).then(function (result) { postMessage({ type: 'result', value: result }); }, function (error) {
    postMessage({ type: 'error', value: { code: error.code || error.name, message: error.message } });
  }).finally(function () { transfer = null; });
};
