'use strict';

var assert = require('assert');
var policy = require('./careerBackupPolicy.js');
var harnessSupport = require('./testSupport/productionContentScriptHarness.js');

var marker = '  function releaseStartupFramesAfterStorage() {';
var harness = harnessSupport.createHarness({
  gameId: 'career-size-preflight',
  transformContentSource: function (source) {
    var injection = [
      '  globalThis.__PNHUD_CAREER_PREFLIGHT_TEST__ = {',
      '    installService: function (service) { careerIndexedService = service; },',
      '    preview: previewCareerBackupFile,',
      '    exportBackup: exportCareerBackupFromSettings,',
      '    state: function () { return { busy: careerDataUiState.busy, message: careerDataUiState.message, messageKind: careerDataUiState.messageKind, preview: careerDataUiState.preview }; }',
      '  };',
      ''
    ].join('\n');
    return source.replace(marker, injection + marker);
  }
});
assert.deepStrictEqual(harness.evaluationErrors, []);

(async function () {
  var reads = 0; var prepares = 0; var exports = 0;
  var service = {
    careerLedgerInfo: function () { return Promise.resolve({ ready: true, physicalRecordCount: 100000, activeRecordCount: 99000 }); },
    prepareCareerRestore: function () { prepares += 1; return Promise.resolve({}); },
    exportCareerBackup: function () { exports += 1; return Promise.resolve({}); }
  };
  harness.context.__PNHUD_CAREER_PREFLIGHT_TEST__.installService(service);
  harness.context.__PNHUD_CAREER_PREFLIGHT_TEST__.preview({ size: policy.MAX_BACKUP_BYTES + 1, text: function () { reads += 1; return Promise.resolve('{}'); } });
  assert.strictEqual(reads, 0, 'oversized restore is rejected before File.text allocates the payload');
  assert.strictEqual(prepares, 0, 'oversized restore never reaches validation or IndexedDB replacement planning');
  assert.match(harness.context.__PNHUD_CAREER_PREFLIGHT_TEST__.state().message, /career database remains intact/i);

  harness.context.__PNHUD_CAREER_PREFLIGHT_TEST__.exportBackup();
  await new Promise(function (resolve) { setImmediate(resolve); });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.strictEqual(exports, 0, 'oversized export is rejected from ledger metadata before whole-ledger export');
  var state = harness.context.__PNHUD_CAREER_PREFLIGHT_TEST__.state();
  assert.strictEqual(state.busy, false);
  assert.match(state.message, /career database remains intact/i);
  console.log('Career Backup production export/restore preflight and zero-allocation rejection regressions passed.');
})().catch(function (error) { console.error(error); process.exit(1); });
