'use strict';

var assert = require('assert');
var policy = require('./careerBackupPolicy.js');

var small = policy.exportPreflight({ physicalRecordCount: 7500, activeRecordCount: 7400 });
assert.strictEqual(small.allowed, true, 'a conservatively estimated ledger below the measured 10k point remains inside the V1 bound');
assert.strictEqual(small.physicalRecordCount, 7500);
assert.strictEqual(small.activeRecordCount, 7400);
assert.strictEqual(small.estimatedBytes, policy.FIXED_BACKUP_OVERHEAD_BYTES + 7500 * policy.REPRESENTATIVE_BYTES_PER_RECORD);
assert.strictEqual(policy.exportPreflight({ physicalRecordCount: 10000, activeRecordCount: 9900 }).allowed, false, 'the V1 supported bound stays below the 36.56 MiB tested representative point');
var large = policy.exportPreflight({ physicalRecordCount: 100000, activeRecordCount: 99000 });
assert.strictEqual(large.allowed, false, 'the untested hundreds-of-MiB 100k ledger is rejected before export allocation');
assert.ok(large.estimatedBytes > policy.MAX_BACKUP_BYTES);
assert.strictEqual(policy.restorePreflight(policy.MAX_BACKUP_BYTES).allowed, true, 'the exact supported restore bound is accepted');
assert.strictEqual(policy.restorePreflight(policy.MAX_BACKUP_BYTES + 1).allowed, false, 'an oversized file is rejected before read/JSON.parse');
var error = policy.limitError('restore', policy.restorePreflight(policy.MAX_BACKUP_BYTES + 1));
assert.strictEqual(error.code, 'CAREER_BACKUP_SIZE_LIMIT');
assert.match(error.message, /career database remains intact/i);
console.log('Career Backup v1 export estimate and restore file-size preflight regressions passed.');
