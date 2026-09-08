'use strict';

var assert = require('assert');
var fs = require('fs');
var manifest = require('./manifest.json');
var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');
var isolated = manifest.content_scripts.find(function (entry) { return entry.js.includes('content.js'); });
function functionSource(name, nextName) { var start = content.indexOf('  function ' + name + '('); var end = nextName ? content.indexOf('  function ' + nextName + '(', start + 1) : content.length; assert.ok(start >= 0 && end > start, name + ' exists'); return content.slice(start, end); }

assert.ok(isolated.js.includes('careerDataSettings.js'));
assert.ok(isolated.js.indexOf('careerIndexedStore.js') < isolated.js.indexOf('careerDataSettings.js'));
assert.ok(isolated.js.indexOf('careerDataSettings.js') < isolated.js.indexOf('content.js'));
assert.ok(content.includes("['PokerCareerDataSettings', globalThis.PokerCareerDataSettings, 'careerDataSettings.js']"));
assert.ok(content.includes("'career-data': 'Career Data'"));
assert.ok(content.includes('data-settings-content="career-data"'));

var summary = functionSource('refreshCareerDataSummary', 'triggerCareerBackupDownload');
assert.ok(summary.includes('careerIndexedService.careerLedgerInfo()'));
assert.ok(!summary.includes('indexedDB'));
var exportPath = functionSource('exportCareerBackupFromSettings', 'readCareerBackupFile');
assert.ok(exportPath.includes('careerIndexedService.careerLedgerInfo()'));
assert.ok(exportPath.indexOf('careerIndexedService.careerLedgerInfo()') < exportPath.indexOf('careerIndexedService.exportCareerBackup()'), 'export preflight runs before whole-ledger backup creation');
assert.ok(exportPath.includes('careerIndexedService.exportCareerBackup()'));
assert.ok(!exportPath.includes('careerIndexedService.exportCareer()'));
var preview = functionSource('previewCareerBackupFile', 'cancelCareerRestorePreview');
assert.ok(preview.includes('PokerCareerBackupPolicy.restorePreflight(file.size)'));
assert.ok(preview.indexOf('restorePreflight(file.size)') < preview.indexOf('readCareerBackupFile(file)'), 'restore file size is checked before File.text and JSON.parse');
assert.ok(preview.includes('var backupCandidate = JSON.parse(backupText)'));
assert.ok(preview.includes('careerIndexedService.prepareCareerRestore(backupCandidate)'));
assert.ok(!preview.includes('replaceCareerBackup'));
var restore = functionSource('confirmCareerRestore', 'settingsSectionHtml');
assert.ok(restore.includes('careerIndexedService.replaceCareerBackup(candidate'));
assert.ok(restore.includes("mode: 'replace'"));
assert.ok(restore.includes('confirmed: true'));
assert.ok(restore.includes('expectedPayloadDigest: preview.candidate.payloadDigest'));
assert.ok(restore.includes('expectedCurrentPayloadDigest: preview.current.payloadDigest'));
assert.ok(restore.includes('Career backup restored successfully.'));
assert.ok(restore.includes('refreshCareerDataSummary(true)'));

assert.strictEqual(/\bindexedDB\b/.test(content), false);
assert.ok(content.includes("event.target.classList.contains('pnhud-career-file-input')"));
assert.ok(content.includes("event.target.value = ''"));
assert.ok(content.includes("event.key === 'Escape' && careerDataUiState.preview"));
assert.ok(css.includes('#pnhud-settings-panel .pnhud-career-data-card'));
assert.ok(css.includes('#pnhud-settings-panel .pnhud-career-data-actions button:focus-visible'));
assert.ok(css.includes('#pnhud-settings-panel main { box-sizing: border-box; min-width: 0; min-height: 0; height: 100%; overflow-x: hidden; overflow-y: auto;'));
console.log('Career Data Settings certified API and destructive-flow production tests passed.');
