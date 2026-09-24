'use strict';

var assert = require('assert');
var settings = require('./careerDataSettings.js');
var info = { ready: true, backend: 'extension-service-worker-indexeddb', storageSchemaVersion: 2, migration: { state: 'complete' }, careerTrackingStartedAt: Date.UTC(2026, 7, 1), latestAcceptedAt: Date.UTC(2026, 7, 12), playerCount: 12, physicalRecordCount: 48, activeRecordCount: 47, quarantinedHandCount: 0, backupSizePolicy: { estimatedBytes: 1245184, maximumSupportedBytes: 67108864, maximumPhysicalRecordCount: 4032 } };

assert.deepStrictEqual(settings.health(info), { key: 'healthy', label: 'Healthy', description: 'Career database is ready.' });
assert.strictEqual(settings.health(Object.assign({}, info, { quarantinedHandCount: 1 })).key, 'attention');
assert.strictEqual(settings.health(Object.assign({}, info, { migration: { state: 'blocked' } })).key, 'attention');
assert.strictEqual(settings.health(info, 'read failed').key, 'attention');

var html = settings.render(info, { sessionHandCount: 3 });
['Career tracking', 'Tracking since', 'Players tracked', 'Career hand records', 'Active logical hands', 'IndexedDB', 'Ready', 'v2', 'v1', 'Last accepted hand', 'Quarantined hands'].forEach(function (value) { assert.ok(html.includes(value), 'summary renders ' + value); });
assert.ok(html.includes('Estimated decoded JSON size') && html.includes('1.2 MiB'));
assert.ok(html.includes('Decoded JSON safety limit') && html.includes('64.0 MiB'));
assert.ok(html.includes('4,032 physical records'));
assert.ok(html.includes('Export Career Data'));
assert.ok(html.includes('Import Career Data'));
assert.ok(html.includes('Restore Career Backup (Replace)'));
assert.ok(html.includes('Reset Session'));
assert.ok(html.includes('manual seat positions'));
assert.ok(html.includes('HUD settings are kept'));
assert.ok(html.includes('Remove Current Session from Career &amp; Reset'));
assert.ok(html.includes('accept="application/gzip,application/json,.gz,.json,.json.gz"'));
assert.ok(html.includes('role="status" aria-live="polite"'));
assert.ok(!html.includes('Removal preview'), 'removal preview is absent initially');
assert.ok(html.indexOf('<h3>Session</h3>') < html.indexOf('<h3>Career</h3>'));
assert.ok(html.indexOf('<h3>Career</h3>') < html.indexOf('<h3>Transfer</h3>'));
assert.ok(html.indexOf('<h3>Transfer</h3>') < html.indexOf('<h3>Advanced Recovery</h3>'), 'Data groups use Session, Career, Transfer, Advanced Recovery order');

var digest = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
var previewHtml = settings.render(info, { activeFlow: 'recovery', preview: { fileBytes: 22076, decompressedBytes: 887846, portableFormat: 'gzip', candidate: { backupFormatVersion: 1, careerTrackingStartedAt: Date.UTC(2026, 6, 1), playerCount: 9, physicalRecordCount: 30, activeRecordCount: 29, payloadDigest: digest }, current: { payloadDigest: digest.replace(/^1/, 'f') } } });
assert.ok(previewHtml.includes('Restore preview'));
assert.ok(previewHtml.includes('replaces your entire current Career history'));
assert.ok(previewHtml.includes('After the restore succeeds, the current Session will also be reset'));
assert.ok(previewHtml.includes('Reset to 0 after successful restore'));
assert.ok(previewHtml.includes('21.6 KiB'));
assert.ok(previewHtml.includes('867.0 KiB'));
assert.ok(previewHtml.includes('Gzip-compressed Backup v1 JSON'));
assert.ok(previewHtml.includes('Restore Career Backup (Replace)'));
assert.ok(previewHtml.includes('pnhud-destructive'));
assert.ok(previewHtml.includes(settings.shortDigest(digest)));
assert.ok(!previewHtml.includes(digest));

var importHtml = settings.render(info, { activeFlow: 'transfer', message: 'Career data validated.', messageKind: 'success', importPreview: { canImport: true, summary: { importedLogicalHandCount: 1024, alreadyPresentLogicalHandCount: 412, newLogicalHandCount: 608, exactDuplicatePhysicalRecordCount: 412, newPhysicalRecordCount: 612, conflictedLogicalHandCount: 0, affectedPlayerCount: 27, mergedLogicalHandCount: 1608 } } });
['Import preview', 'Imported logical hands', 'Already present', 'New logical hands', 'New physical records', 'Conflicted / quarantined', 'Affected players', 'Session', 'Unaffected', 'Import Career Data (Merge)'].forEach(function (value) { assert.ok(importHtml.includes(value), 'import preview renders ' + value); });
assert.strictEqual((importHtml.match(/<section class="pnhud-career-restore-preview pnhud-career-import-preview"/g) || []).length, 1, 'import preview renders once in Transfer');
assert.ok(importHtml.indexOf('<h3>Transfer</h3>') < importHtml.indexOf('Import preview'));
assert.ok(importHtml.indexOf('Import preview') < importHtml.indexOf('<h3>Advanced Recovery</h3>'));
var restoreResultHtml = settings.render(info, { activeFlow: 'recovery', result: { mode: 'replace', fileName: 'backup.json', summary: { activeRecordCount: 29, playerCount: 9 } } });
assert.ok(restoreResultHtml.includes('Restore complete'));
assert.ok(restoreResultHtml.includes('Reset to 0'));

var removalHtml = settings.render(info, { sessionHandCount: 3, activeFlow: 'removal', removalFlowActive: true, message: 'Exact Session-to-Career matching completed. Review the destructive action before confirming.', messageKind: 'success', removalPreview: { sessionHandCount: 3, matchedSessionHandCount: 2, unmatchedSessionHandCount: 1, logicalHandCount: 2, physicalRecordCount: 3, affectedPlayerCount: 4 } });
assert.ok(removalHtml.includes('Removal preview'));
assert.ok(removalHtml.includes('Exporting a Career Backup first is strongly recommended'));
assert.ok(removalHtml.includes('Session hands retained'));
assert.ok(removalHtml.includes('Remove Career Hands &amp; Reset Session'));
assert.ok(removalHtml.includes('pnhud-destructive'));
assert.ok(removalHtml.indexOf('Remove Current Session from Career') < removalHtml.indexOf('Exact Session-to-Career matching completed'));
assert.ok(removalHtml.indexOf('Exact Session-to-Career matching completed') < removalHtml.indexOf('Removal preview'));
assert.ok(removalHtml.indexOf('Removal preview') < removalHtml.indexOf('<h3>Transfer</h3>'), 'removal status and confirmation render inside Career before Transfer');
assert.strictEqual((removalHtml.match(/class="pnhud-career-restore-preview pnhud-career-removal-preview"/g) || []).length, 1, 'reopening state renders one removal preview');
var cancelledHtml = settings.render(info, { sessionHandCount: 3, activeFlow: 'removal', removalFlowActive: true, message: 'Career removal cancelled. Career and Session data were not changed.', messageKind: 'none' });
assert.ok(!cancelledHtml.includes('Removal preview'));
assert.ok(cancelledHtml.indexOf('Career removal cancelled') < cancelledHtml.indexOf('<h3>Transfer</h3>'), 'cancel clears the preview and keeps its status with Career');

assert.strictEqual(settings.exportFileName(new Date('2026-08-12T12:34:56.000Z')), 'pokernow-hud-career-data-2026-08-12T12-34-56Z.json.gz');
assert.match(settings.errorMessage(Object.assign(new Error('Career backup gzip data is invalid or truncated.'), { code: 'CAREER_PORTABLE_GZIP_INVALID' })), /invalid, damaged, or truncated/);
assert.strictEqual(settings.errorMessage(new Error('payload digest mismatch')), 'Backup integrity check failed.');
assert.strictEqual(settings.errorMessage(new Error('Career replacement requires explicit candidate-and-current digest-bound confirmation')), 'Career history changed since this file was previewed. Please preview the action again.');
assert.strictEqual(settings.errorMessage(new Error('unsupported backup version')), 'Unsupported backup version.');
assert.strictEqual(settings.errorMessage(new Error('invalid record schema')), 'Invalid career backup.');
assert.match(settings.errorMessage(new Error('Career Session removal requires explicit current-digest-bound confirmation')), /Nothing was removed/);
assert.match(settings.errorMessage(Object.assign(new Error('Career backup restore exceeds the V1 supported size. The career database remains intact.'), { code: 'CAREER_BACKUP_SIZE_LIMIT' })), /database remains intact/i);
console.log('Career Data Settings presentation tests passed.');
