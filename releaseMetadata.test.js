'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const release = require('./scripts/release.js');
if (process.platform === 'win32') {
  const cp = require('child_process');
  const inventoryPath = path.join(release.root, 'release/production-files.json').replace(/'/g, "''");
  const script = fs.readFileSync(path.join(release.root, 'scripts/package-release.ps1'), 'utf8');
  assert(script.includes('$expected = Get-Content -LiteralPath'), 'PowerShell inventory assignment must not wrap the JSON array');
  const ps = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = cp.spawnSync(ps, ['-NoProfile', '-Command', "$expected = Get-Content -LiteralPath '" + inventoryPath + "' -Raw | ConvertFrom-Json; if ($expected.Count -ne 68 -or $expected -cnotcontains 'manifest.json' -or $expected -cnotcontains 'trackedPlayers.js') { exit 1 }"], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, 'Windows PowerShell 5.1 inventory shape: ' + result.stderr);
}
assert.deepStrictEqual(release.freeze(), release.validate());
for (const names of [['manifest.json', 'manifest.json'], ['../content.js'], ['/content.js'], ['C:evil.js'], ['fixtures/a.js'], ['x.test.js']]) {
  assert.throws(() => release.validNames(names));
}
assert.throws(() => release.validNames(['popup.js', 'manifest.json']));
assert.throws(() => release.validNames(['Foo.js', 'foo.js']));
assert.throws(() => release.generatedDir('../outside'));
assert.throws(() => release.generatedDir('.'));
assert.strictEqual(release.crc32(Buffer.from('123456789')), 0xcbf43926);
const entries = [{ name: 'manifest.json', bytes: Buffer.from('{}') }];
const archive = release.zipBytes(entries);
assert(archive.equals(release.zipBytes(entries)), 'ZIP bytes deterministic');
assert.strictEqual(archive.readUInt32LE(0), 0x04034b50);
assert.strictEqual(archive.readUInt16LE(8), 0, 'STORE has no compressor/version dependence');
assert.strictEqual(archive.readUInt16LE(12), 33, 'fixed 1980-01-01');
assert.strictEqual(archive.readUInt32LE(archive.length - 22), 0x06054b50);
assert.throws(() => release.baselineBytes('popup.js', Buffer.from('unexpected code')));
const actual = fs.readFileSync(path.join(release.root, 'seatOverlay.js'));
const baseline = release.baseline.files.find(f => f.path === 'seatOverlay.js');
const crypto = require('crypto');
assert.notStrictEqual(crypto.createHash('sha256').update(Buffer.concat([actual, Buffer.from('// drift')])).digest('hex'), baseline.sha256);
console.log('Public release metadata/docs, 68-file exact freeze, unsafe/duplicate paths, deterministic ZIP/CRC and drift guards passed.');
