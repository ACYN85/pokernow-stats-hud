'use strict';

var assert = require('assert');
var settings = require('./careerDataSettings.js');
var info = { ready: true, backend: 'extension-service-worker-indexeddb', storageSchemaVersion: 2, migration: { state: 'complete' }, careerTrackingStartedAt: Date.UTC(2026, 7, 1), latestAcceptedAt: Date.UTC(2026, 7, 12), playerCount: 12, physicalRecordCount: 48, activeRecordCount: 47, quarantinedHandCount: 0, backupSizePolicy: { estimatedBytes: 1245184, maximumSupportedBytes: 33554432 } };

assert.deepStrictEqual(settings.health(info), { key: 'healthy', label: 'Healthy', description: 'Career database is ready.' });
assert.strictEqual(settings.health(Object.assign({}, info, { quarantinedHandCount: 1 })).key, 'attention');
assert.strictEqual(settings.health(Object.assign({}, info, { migration: { state: 'blocked' } })).key, 'attention');
assert.strictEqual(settings.health(info, 'read failed').key, 'attention');

var html = settings.render(info, {});
['Career tracking', 'Tracking since', 'Players tracked', 'Career hand records', 'Active logical hands', 'IndexedDB', 'Ready', 'v2', 'v1', 'Last accepted hand', 'Quarantined hands'].forEach(function (value) { assert.ok(html.includes(value), 'summary renders ' + value); });
assert.ok(html.includes('Estimated backup size') && html.includes('1.2 MiB'));
assert.ok(html.includes('V1 backup size limit') && html.includes('32.0 MiB'));
assert.ok(html.includes('Export Career Backup'));
assert.ok(html.includes('Restore Career Backup'));
assert.ok(html.includes('accept="application/json,.json"'));
assert.ok(html.includes('role="status" aria-live="polite"'));

var digest = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
var previewHtml = settings.render(info, { preview: { candidate: { backupFormatVersion: 1, careerTrackingStartedAt: Date.UTC(2026, 6, 1), playerCount: 9, physicalRecordCount: 30, activeRecordCount: 29, payloadDigest: digest }, current: { payloadDigest: digest.replace(/^1/, 'f') } } });
assert.ok(previewHtml.includes('Restore preview'));
assert.ok(previewHtml.includes('replace the current career history'));
assert.ok(previewHtml.includes('Restore Career History'));
assert.ok(previewHtml.includes('pnhud-destructive'));
assert.ok(previewHtml.includes(settings.shortDigest(digest)));
assert.ok(!previewHtml.includes(digest));

assert.strictEqual(settings.exportFileName(new Date('2026-08-12T12:34:56.000Z')), 'pokernow-hud-career-backup-2026-08-12T12-34-56Z.json');
assert.strictEqual(settings.errorMessage(new Error('payload digest mismatch')), 'Backup integrity check failed.');
assert.strictEqual(settings.errorMessage(new Error('Career replacement requires explicit candidate-and-current digest-bound confirmation')), 'Career history changed since this backup was previewed. Please preview the restore again.');
assert.strictEqual(settings.errorMessage(new Error('unsupported backup version')), 'Unsupported backup version.');
assert.strictEqual(settings.errorMessage(new Error('invalid record schema')), 'Invalid career backup.');
assert.match(settings.errorMessage(Object.assign(new Error('Career backup restore exceeds the V1 supported size. The career database remains intact.'), { code: 'CAREER_BACKUP_SIZE_LIMIT' })), /database remains intact/i);
console.log('Career Data Settings presentation tests passed.');
