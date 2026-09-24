'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');
var manifest = require('./manifest.json');
var content = fs.readFileSync('./content.js', 'utf8');
var presentation = fs.readFileSync('./careerDataSettings.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var isolated = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });
function functionSource(name, nextName) { var start = content.indexOf('  function ' + name + '('); var end = nextName ? content.indexOf('  function ' + nextName + '(', start + 1) : content.length; assert.ok(start >= 0 && end > start, name + ' exists'); return content.slice(start, end); }

assert.ok(isolated.js.includes('careerDataSettings.js'));
assert.ok(isolated.js.indexOf('careerIndexedStore.js') < isolated.js.indexOf('careerDataSettings.js'));
assert.ok(isolated.js.indexOf('careerDataSettings.js') < isolated.js.indexOf('content.js'));
assert.ok(content.includes("['PokerCareerDataSettings', globalThis.PokerCareerDataSettings, 'careerDataSettings.js']"));
assert.ok(content.includes("'career-data': 'Data'"));
assert.ok(content.includes('data-settings-content="career-data"'));

var summary = functionSource('refreshCareerDataSummary', 'triggerCareerBackupDownload');
assert.ok(summary.includes('careerIndexedService.careerLedgerInfo()'));
assert.ok(!summary.includes('indexedDB'));
var exportPath = functionSource('exportCareerBackupFromSettings', 'readCareerBackupFile');
assert.ok(exportPath.includes('careerIndexedAppendQueue.then'), 'export waits for the content-side durable append/outbox queue');
assert.ok(exportPath.indexOf('careerIndexedAppendQueue.then') < exportPath.indexOf('careerIndexedService.exportCareerBackup()'));
assert.ok(exportPath.includes('careerIndexedService.careerLedgerInfo()'));
assert.ok(exportPath.indexOf('careerIndexedService.careerLedgerInfo()') < exportPath.indexOf('careerIndexedService.exportCareerBackup()'), 'export preflight runs before whole-ledger backup creation');
assert.ok(exportPath.includes('careerIndexedService.exportCareerBackup()'));
assert.ok(!exportPath.includes('careerIndexedService.exportCareer()'));
var importPreview = functionSource('previewCareerImportFile', 'cancelCareerImportPreview');
assert.ok(importPreview.includes('PokerCareerBackupPolicy.restorePreflight(file.size)'));
assert.ok(importPreview.indexOf('restorePreflight(file.size)') < importPreview.indexOf('readCareerBackupFile(file)'), 'import file size is checked before File.text and JSON.parse');
assert.ok(importPreview.includes('careerIndexedService.prepareCareerImport(candidate)'));
assert.ok(importPreview.indexOf('careerIndexedAppendQueue.then') < importPreview.indexOf('careerIndexedService.prepareCareerImport(candidate)'), 'import preview drains pending Career append persistence before its digest snapshot');
assert.ok(importPreview.includes('requestToken !== careerDataUiState.importRequestToken'), 'stale import validation cannot publish into a later flow');
assert.ok(!importPreview.includes('mergeCareerBackup'));
var importMutation = functionSource('confirmCareerImport', 'previewCareerBackupFile');
assert.ok(importMutation.includes('careerIndexedService.mergeCareerBackup(candidate'));
assert.ok(importMutation.indexOf('careerIndexedAppendQueue.then') < importMutation.indexOf('careerIndexedService.mergeCareerBackup(candidate'), 'import confirmation drains pending Career appends before digest revalidation and mutation');
assert.ok(importMutation.includes("mode: 'merge'"));
assert.ok(importMutation.includes('expectedPayloadDigest: preview.candidatePayloadDigest'));
assert.ok(importMutation.includes('expectedCurrentPayloadDigest: preview.currentPayloadDigest'));
assert.ok(importMutation.includes('Session was unaffected'));
var preview = functionSource('previewCareerBackupFile', 'cancelCareerRestorePreview');
assert.ok(preview.includes('PokerCareerBackupPolicy.restorePreflight(file.size)'));
assert.ok(preview.indexOf('restorePreflight(file.size)') < preview.indexOf('readCareerBackupFile(file)'), 'restore file size is checked before File.text and JSON.parse');
assert.ok(preview.includes('var backupCandidate = portable.backup'));
assert.ok(preview.includes('preview.portableFormat = portable.format'));
assert.ok(preview.includes('careerIndexedService.prepareCareerRestore(backupCandidate)'));
assert.ok(preview.indexOf('careerIndexedAppendQueue.then') < preview.indexOf('careerIndexedService.prepareCareerRestore(backupCandidate)'));
assert.ok(preview.includes('requestToken !== careerDataUiState.restoreRequestToken'), 'stale restore validation cannot attach to another flow');
assert.ok(!preview.includes('replaceCareerBackup'));
var restore = functionSource('confirmCareerRestore', 'settingsSectionHtml');
assert.ok(restore.includes('careerIndexedService.replaceCareerBackup(candidate'));
assert.ok(restore.indexOf('careerIndexedAppendQueue.then') < restore.indexOf('careerIndexedService.replaceCareerBackup(candidate'));
assert.ok(restore.includes("mode: 'replace'"));
assert.ok(restore.includes('confirmed: true'));
assert.ok(restore.includes('expectedPayloadDigest: preview.candidate.payloadDigest'));
assert.ok(restore.includes('expectedCurrentPayloadDigest: preview.current.payloadDigest'));
assert.ok(restore.includes('Career backup restored successfully.'));
assert.ok(restore.indexOf('replaceCareerBackup(candidate') < restore.indexOf('resetCurrentSession({ preserveAuthoritativePause: true'), 'Session reset starts only after SAFE REPLACE resolves');
assert.ok(restore.includes("invalidateSeatHudCareerStats(null, 'Career backup restored', true)"), 'restore hard-invalidates settled Career presentation and pending responses');
assert.ok(restore.includes('careerCommitted = true'));
assert.ok(restore.includes("if (error) reject(error); else resolve(result);"));
assert.ok(restore.includes('refreshCareerDataSummary(true)'));
var prepareRemoval = functionSource('prepareCurrentSessionCareerRemoval', 'cancelCurrentSessionCareerRemoval');
assert.ok(prepareRemoval.includes('careerIndexedAppendQueue.then'), 'pending Career appends settle before exact matching');
assert.ok(prepareRemoval.includes('prepareCareerSessionRemoval(request)'));
assert.ok(prepareRemoval.includes('Current Session changed while Career removal was being prepared'));
assert.ok(prepareRemoval.includes('requestToken !== careerDataUiState.removalRequestToken'), 'stale removal previews are request-token guarded');
assert.ok(prepareRemoval.includes("hudUiPreferences.selectedSettingsSection !== 'career-data'"), 'a preview cannot publish into a different Settings section instance');
var removeSession = functionSource('confirmCurrentSessionCareerRemoval', 'settingsSectionHtml');
assert.ok(removeSession.includes('removeCareerSession(request'));
assert.ok(removeSession.includes("mode: 'remove-current-session'"));
assert.ok(removeSession.includes('expectedCurrentDigest: preview.currentDigest'));
assert.ok(removeSession.includes('expectedConfirmationToken: preview.confirmationToken'));
assert.ok(removeSession.indexOf('removeCareerSession(request') < removeSession.indexOf('resetCurrentSession(function'), 'Session reset starts only after the Career mutation resolves');
assert.ok(removeSession.includes('.catch(function (error)'), 'Career failure leaves the reset path unentered');
var lateRemoval = functionSource('removeLateFinalizedSessionHands', 'confirmCurrentSessionCareerRemoval');
assert.ok(lateRemoval.includes('careerIndexedAppendQueue.then'), 'late finalized hands drain their durable Career append before a fresh removal snapshot');
assert.ok(lateRemoval.includes('prepareCareerSessionRemoval(latestRequest)'));
assert.ok(lateRemoval.includes('removeCareerSession(latestRequest'));
assert.ok(removeSession.includes('removeLateFinalizedSessionHands'), 'Session reset waits until hands finalized during deletion are removed too');
assert.ok(content.includes('pnhud-data-reset-session'));
assert.ok(presentation.includes('Remove Current Session from Career &amp; Reset'));
assert.ok(presentation.includes('manual seat positions'));
assert.ok(presentation.includes('HUD settings are kept'));
assert.ok(!removeSession.includes('playerNotes'));
assert.ok(!removeSession.includes('hudUiPreferences'));

assert.strictEqual(/\bindexedDB\b/.test(content), false);
assert.ok(content.includes("event.target.classList.contains('pnhud-career-import-file-input')"));
assert.ok(content.includes("event.target.classList.contains('pnhud-career-restore-file-input')"));
assert.ok(content.includes("event.target.value = ''"));
assert.ok(content.includes("event.key === 'Escape' && careerDataUiState.preview"));
assert.ok(content.includes("event.key === 'Escape' && careerDataUiState.importPreview"));
assert.ok(content.includes("event.key === 'Escape' && careerDataUiState.removalPreview"));
assert.ok(content.includes('careerDataUiState.removalRequestToken += 1;'), 'Cancel and Settings navigation invalidate pending removal previews');
assert.ok(presentation.indexOf('removalPreviewHtml(state.removalPreview)') < presentation.indexOf('<h3>Transfer</h3>'), 'Career owns the removal preview before Transfer');
assert.ok(presentation.indexOf('<h3>Transfer</h3>') < presentation.indexOf('<h3>Advanced Recovery</h3>'));
assert.ok(css.includes('#pnhud-settings-panel .pnhud-career-data-card'));
assert.ok(css.includes('#pnhud-settings-panel .pnhud-career-data-actions button:focus-visible'));
assert.ok(css.includes('#pnhud-settings-panel main { box-sizing: border-box; min-width: 0; min-height: 0; height: 100%; overflow-x: hidden; overflow-y: auto;'));

(async function () {
  var removalStart = content.indexOf('  function currentSessionRemovalRequest(');
  var removalEnd = content.indexOf('  function mergeCareerSessionRemovalResults(', removalStart);
  assert.ok(removalStart >= 0 && removalEnd > removalStart, 'removal preview production functions can be isolated');
  var resolvePreview;
  var pendingPreview = new Promise(function (resolve) { resolvePreview = resolve; });
  var refreshes = 0;
  var context = {
    location: { hostname: 'pokernow.com' }, pokerNowGameId: 'preview-instance',
    handAccounting: { finalizedHandIds: new Set(['H1', 'H2', 'H3']) },
    careerIndexedService: { prepareCareerSessionRemoval: function () { return pendingPreview; } },
    careerIndexedAppendQueue: Promise.resolve(),
    careerDataUiState: { busy: false, preview: null, backupCandidate: null, removalPreview: null, removalRequest: null, removalFlowActive: false, removalRequestToken: 0, message: '', messageKind: 'none' },
    hudUiPreferences: { selectedSettingsSection: 'career-data' },
    refreshCareerDataView: function () { refreshes += 1; },
    PokerCareerDataSettings: { errorMessage: function (error) { return String(error && error.message || error); } },
    Promise: Promise, Set: Set, Array: Array, String: String, JSON: JSON, Math: Math, Number: Number, Object: Object, Error: Error
  };
  vm.runInNewContext(content.slice(removalStart, removalEnd), vm.createContext(context));
  context.prepareCurrentSessionCareerRemoval();
  assert.strictEqual(context.careerDataUiState.removalFlowActive, true);
  assert.deepStrictEqual(Array.from(context.careerDataUiState.removalRequest.sessionHandIds), ['H1', 'H2', 'H3']);
  context.hudUiPreferences.selectedSettingsSection = 'general';
  resolvePreview({ sessionHandCount: 3, matchedSessionHandCount: 3 });
  await pendingPreview;
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(context.careerDataUiState.removalPreview, null, 'a late preview cannot repopulate a different Settings section instance');
  assert.strictEqual(context.careerDataUiState.removalFlowActive, false);
  assert.strictEqual(context.careerDataUiState.removalRequest, null);
  assert.strictEqual(context.careerDataUiState.busy, false);
  assert.strictEqual(refreshes, 1, 'stale completion performs no second Data render');

  var importStart = content.indexOf('  function readCareerBackupFile(');
  var importEnd = content.indexOf('  function cancelCareerImportPreview(', importStart);
  var resolveImport;
  var pendingImport = new Promise(function (resolve) { resolveImport = resolve; });
  var resolveAppend;
  var pendingAppend = new Promise(function (resolve) { resolveAppend = resolve; });
  var prepareImportCalls = 0;
  var importRefreshes = 0;
  var importContext = {
    careerIndexedService: { prepareCareerImport: function () { prepareImportCalls += 1; return pendingImport; } },
    careerIndexedAppendQueue: pendingAppend,
    careerDataUiState: { busy: false, activeFlow: null, importPreview: null, importCandidate: null, importRequestToken: 0, removalFlowActive: false, message: '', messageKind: 'none' },
    PokerCareerBackupPolicy: { restorePreflight: function () { return { allowed: true }; }, limitError: function () { return new Error('size'); } },
    PokerCareerDataSettings: { errorMessage: function (error) { return String(error && error.message || error); } },
    refreshCareerDataView: function () { importRefreshes += 1; },
    careerPortableFileOptions: function () { return {}; },
    PokerCareerPortableFile: { readBackupFile: function (file) { return file.text().then(function (text) { return { backup: JSON.parse(text), format: 'json', decompressedBytes: text.length }; }); } },
    Promise: Promise, JSON: JSON, String: String, Error: Error
  };
  vm.runInNewContext(content.slice(importStart, importEnd), vm.createContext(importContext));
  importContext.previewCareerImportFile({ size: 10, text: function () { return Promise.resolve('{"candidate":true}'); } });
  await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(prepareImportCalls, 0, 'import preview cannot snapshot Career before the content append/outbox queue settles');
  resolveAppend();
  await pendingAppend; await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(prepareImportCalls, 1);
  importContext.careerDataUiState.importRequestToken += 1;
  importContext.careerDataUiState.activeFlow = null;
  importContext.careerDataUiState.busy = false;
  resolveImport({ canImport: true, summary: { newLogicalHandCount: 1 } });
  await pendingImport; await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(importContext.careerDataUiState.importPreview, null, 'late import validation cannot attach to a different Settings section or flow');
  assert.strictEqual(importContext.careerDataUiState.importCandidate, null);
  assert.strictEqual(importRefreshes, 1, 'stale import validation performs no later Data render');
  console.log('Career Data Settings certified API, destructive-flow, placement, and stale-preview production tests passed.');
})().catch(function (error) { console.error(error); process.exitCode = 1; });
