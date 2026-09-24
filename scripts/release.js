'use strict';
// Release tooling only. No runtime dependencies and no production behavior changes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const assert = require('assert');
const Module = require('module');
const root = path.resolve(__dirname, '..');
const config = require('../release/config.json');
const inventory = require('../release/production-files.json');
const baseline = require('../release/baseline.json');
const suites = require('../testSuites.js');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const read = (name, dir = root) => fs.readFileSync(path.join(dir, name));
const json = name => JSON.parse(read(name));
const outDefault = path.join(root, 'outputs', config.tag);
const resultDir = path.join(root, 'outputs', 'release-test-results');
const docs = ['README.md', 'ARCHITECTURE.md', 'STAT_SUPPORT.md', 'CAREER_DATA.md', 'PRIVACY.md',
  'CHANGELOG.md', 'TESTING.md', 'LIVE_VALIDATION_MATRIX.md', 'KNOWN_LIMITATIONS.md',
  'RELEASE_RUNBOOK.md', 'RELEASE_AUDIT.md'];
const buildFiles = ['content.js', 'runtimeScope.js', 'popup.js', 'careerServiceWorker.js'];
function validNames(names) {
  assert.strictEqual(names.length, new Set(names).size, 'duplicate production path');
  assert.strictEqual(names.length, new Set(names.map(name => name.toLowerCase())).size, 'case-insensitive path collision');
  names.forEach(name => assert(/^[A-Za-z][A-Za-z0-9]*\.(js|css|html|json)$/.test(name), 'unsafe/non-production path: ' + name));
  assert.deepStrictEqual(names, names.slice().sort(), 'inventory must be sorted');
}
function once(text, from, to) {
  assert.strictEqual(text.split(from).length - 1, 1, 'expected exactly one release-only occurrence: ' + from);
  return text.replace(from, to);
}
function baselineBytes(name, bytes) {
  const item = baseline.files.find(file => file.path === name);
  assert(item, 'missing public baseline entry: ' + name);
  assert.strictEqual(sha(bytes), item.sha256, 'frozen bytes drift: ' + name);
  return bytes;
}
function freeze(dir = root) {
  baseline.files.forEach(item => {
    const bytes = read(item.path, dir);
    baselineBytes(item.path, bytes);
  });
  return { unchanged: baseline.files.length, releaseOnlyChanged: [], exactHashParity: baseline.files.length };
}
function validate(dir = root, documentation = true) {
  validNames(inventory);
  assert.strictEqual(inventory.length, config.productionFileCount);
  assert.strictEqual(config.zip, 'pokernow-hud-' + config.tag + '.zip');
  assert(/^\d+\.\d+\.\d+$/.test(config.version));
  assert.strictEqual(config.tag, 'v' + config.version);
  assert(/^v\d+\.\d+\.\d+-rc\d+-\d{8}-\d{4}$/.test(config.buildId), 'promoted package Build ID format');
  assert.strictEqual(baseline.buildId, config.buildId);
  assert.strictEqual(baseline.zip, config.zip);
  assert.deepStrictEqual(inventory, baseline.files.map(f => f.path));
  const manifest = JSON.parse(read('manifest.json', dir));
  assert.strictEqual(manifest.version, config.version);
  assert.strictEqual(manifest.manifest_version, 3);
  assert.strictEqual(manifest.name, 'PokerNow Stats HUD');
  assert.deepStrictEqual(manifest.permissions, ['storage', 'unlimitedStorage', 'activeTab']);
  assert(!manifest.host_permissions && !manifest.web_accessible_resources);
  buildFiles.forEach(file => assert(read(file, dir).toString().includes("'" + config.buildId + "'")));
  assert(read('popup.html', dir).toString().includes('pnhud-popup-build-id'));
  assert(read('content.js', dir).toString().includes("getManifest().version : '" + config.version + "'"));
  assert(!/All-time/.test(read('popup.html', dir).toString()));
  const frozen = freeze(dir);
  if (documentation) {
    docs.forEach(file => {
      const text = read(file).toString();
      assert(text.length > 200, 'missing substantive release document: ' + file);
      for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1].split('#')[0];
        if (!target || /^(https?:|mailto:)/.test(target)) continue;
        assert(fs.existsSync(path.resolve(root, path.dirname(file), target)), 'broken local documentation link: ' + file + ' -> ' + target);
      }
    });
    assert(read('CHANGELOG.md').toString().startsWith('# 1.2.0'));
    assert(read('LIVE_VALIDATION_MATRIX.md').toString().includes('AUTOMATED CERTIFIED / LIVE NOT OBSERVED'));
    assert(read('PRIVACY.md').toString().includes('No extension-controlled external server'));
    assert(read('RELEASE_RUNBOOK.md').toString().includes(config.tag));
    assert(read('README.md').toString().includes(config.buildId));
  }
  const archive = zipBytes(inventory.map(name => ({ name, bytes: read(name, dir) })));
  assert.strictEqual(sha(archive).toUpperCase(), baseline.sha256, 'deterministic public archive hash drift');
  return frozen;
}
function packageValidation(dir) {
  const filename = path.join(root, 'packageValidation.test.js');
  let source = fs.readFileSync(filename, 'utf8');
  source = once(source, 'var extensionRoot = __dirname;', 'var extensionRoot = ' + JSON.stringify(dir) + ';');
  const test = new Module(filename, module);
  test.filename = filename;
  test.paths = Module._nodeModulePaths(root);
  test._compile(source, filename);
}
function fingerprint() {
  // Includes runtime, tests, tools, fixtures, and release docs. Excludes only generated/local capture material.
  const files = [];
  function visit(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const rel = prefix + entry.name;
      if (!prefix && ['.git', '.agents', '.codex', '.har files', 'outputs', 'work', 'node_modules'].includes(entry.name)) continue;
      assert(!entry.isSymbolicLink(), 'release inputs cannot be symlinks: ' + rel);
      if (entry.isDirectory()) visit(path.join(dir, entry.name), rel + '/');
      else if (!/\.(tmp|log)$/.test(rel)) files.push([rel, sha(read(rel))]);
    }
  }
  visit(root, '');
  return sha(JSON.stringify(files));
}
function generatedDir(value) {
  const dest = path.resolve(root, value || outDefault);
  const rel = path.relative(root, dest).replace(/\\/g, '/');
  assert(/^(outputs|work)\/[^.]/.test(rel) && !rel.split('/').includes('..'), 'output must be a child of this source outputs/ or work/');
  // Reject reparse/symlink ancestors so writes cannot escape through a generated-directory junction.
  let cursor = root;
  for (const part of rel.split('/')) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), 'symlink output ancestor');
  }
  return dest;
}
function writeJson(file, value, exclusive = false) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
}
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function zipBytes(entries) {
  validNames(entries.map(e => e.name));
  // ZIP STORE: exact bytes across Node/zlib versions. Fixed DOS 1980-01-01, UTF-8, no extras or comments.
  const local = [], central = [];
  let offset = 0, centralSize = 0;
  for (const { name, bytes } of entries) {
    const filename = Buffer.from(name);
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8); record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(bytes.length, 24); record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + bytes.length;
    centralSize += record.length + filename.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
function testSuite(name) {
  const files = name === 'focused' ? json('release/focused-tests.json') : suites[name];
  assert(Array.isArray(files), 'unknown suite');
  validate();
  const before = fingerprint();
  fs.mkdirSync(resultDir, { recursive: true });
  const log = [];
  for (const file of files) {
    console.log('[RELEASE TEST] ' + name + ': ' + file);
    const result = cp.spawnSync(process.execPath, [path.join(root, file)], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    log.push('[TEST] ' + file + '\n' + (result.stdout || '') + (result.stderr || ''));
    fs.writeFileSync(path.join(resultDir, name + '.log'), log.join('\n'));
    if (result.error || result.status !== 0) {
      writeJson(path.join(resultDir, name + '.json'), { status: 'FAIL', count: files.length, fingerprint: before, failed: file });
      throw result.error || new Error(file + ' failed:\n' + result.stdout + result.stderr);
    }
  }
  assert.strictEqual(fingerprint(), before, 'source changed during tests');
  const result = { status: 'PASS', count: files.length, fingerprint: before, files, node: process.version, completedAt: new Date().toISOString() };
  writeJson(path.join(resultDir, name + '.json'), result);
  console.log(name + ': ' + files.length + '/' + files.length + ' test files PASS');
}
function gates() {
  validate();
  const current = fingerprint();
  return Object.fromEntries(['release', 'focused', 'fast', 'full'].map(name => {
    const result = JSON.parse(fs.readFileSync(path.join(resultDir, name + '.json'), 'utf8'));
    assert.strictEqual(result.status, 'PASS', name + ' not passed');
    assert.strictEqual(result.fingerprint, current, name + ' results are stale');
    assert.deepStrictEqual(result.files, name === 'focused' ? json('release/focused-tests.json') : suites[name]);
    return [name, result];
  }));
}
function pack(out) {
  gates(); packageValidation(root);
  const dest = generatedDir(out);
  assert(!fs.existsSync(dest), 'immutable destination already exists');
  fs.mkdirSync(path.join(dest, 'stage'), { recursive: true });
  inventory.forEach(name => fs.copyFileSync(path.join(root, name), path.join(dest, 'stage', name), fs.constants.COPYFILE_EXCL));
  const entries = inventory.map(name => ({ name, bytes: read(name, path.join(dest, 'stage')) }));
  const bytes = zipBytes(entries);
  fs.writeFileSync(path.join(dest, config.zip), bytes, { flag: 'wx' });
  console.log('Created immutable ZIP; independent extraction/verification required: ' + path.join(dest, config.zip));
}
function verify(out) {
  const dest = generatedDir(out), tests = gates();
  const rows = inventory.map(name => ({ path: name, bytes: read(name).length, sha256: sha(read(name)) }));
  for (const dirName of ['stage', 'extracted']) {
    const dir = path.join(dest, dirName);
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), inventory, 'exact extracted/staged inventory');
    rows.forEach(row => assert.strictEqual(sha(read(row.path, dir)), row.sha256, dirName + ' hash parity: ' + row.path));
    validate(dir, false);
    packageValidation(dir);
  }
  const expected = zipBytes(inventory.map(name => ({ name, bytes: read(name) })));
  const bytes = fs.readFileSync(path.join(dest, config.zip));
  assert(bytes.equals(expected), 'ZIP bytes are not the deterministic release serialization');
  const report = { ...config, manifestVersion: 3, sourceFingerprint: fingerprint(), size: bytes.length,
    sha256: sha(bytes).toUpperCase(), frozen: freeze(), sourceStageExtractParity: rows.length,
    packageValidation: 'PASS: source, stage, independent extraction', files: rows,
    tests: Object.fromEntries(Object.entries(tests).map(([name, result]) => [name, { status: result.status, count: result.count }])),
    certification: { automated: 'PASS', liveManual: 'Manual PokerNow validation is separate; see LIVE_VALIDATION_MATRIX.md for per-case boundaries' }
  };
  const reportPath = path.join(dest, 'package-inventory.json');
  if (fs.existsSync(reportPath)) assert.deepStrictEqual(JSON.parse(fs.readFileSync(reportPath)), report);
  else writeJson(reportPath, report, true);
  console.log(JSON.stringify({ package: config.zip, size: report.size, sha256: report.sha256, parity: rows.length, tests: report.tests }));
  return report;
}
function git(...args) {
  const result = cp.spawnSync(process.env.PNHUD_GIT || 'git', args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr || 'git failed');
  return result.stdout.trim();
}
function attest(out) {
  const report = verify(out), dest = generatedDir(out);
  assert.strictEqual(git('status', '--porcelain', '--untracked-files=all'), '', 'dirty Git state');
  const commit = git('rev-parse', 'HEAD');
  assert.strictEqual(git('rev-parse', config.tag + '^{commit}'), commit);
  assert.strictEqual(git('cat-file', '-t', config.tag), 'tag', 'tag must be annotated');
  inventory.forEach(name => {
    const blob = cp.spawnSync(process.env.PNHUD_GIT || 'git', ['show', commit + ':' + name], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
    assert.strictEqual(blob.status, 0);
    assert.strictEqual(sha(blob.stdout), sha(read(name)), 'Git source byte parity: ' + name);
  });
  const tagText = git('for-each-ref', 'refs/tags/' + config.tag, '--format=%(contents)');
  assert(tagText.includes(report.sha256), 'annotated tag must bind ZIP SHA-256');
  const result = { ...report, commit, tagObject: git('rev-parse', config.tag), gitStatus: 'CLEAN',
    gitProductionParity: inventory.length, archiveTagHashBinding: 'PASS' };
  const jsonPath = path.join(dest, 'release-inventory.json');
  if (fs.existsSync(jsonPath)) assert.deepStrictEqual(JSON.parse(fs.readFileSync(jsonPath)), result);
  else writeJson(jsonPath, result, true);
  const lines = ['# PokerNow HUD ' + config.version + ' artifact inventory', '', '- Build ID: ' + config.buildId,
    '- Commit: ' + commit, '- Annotated tag: ' + config.tag, '- Tag object: ' + result.tagObject,
    '- ZIP: ' + config.zip, '- Size: ' + report.size + ' bytes', '- SHA-256: ' + report.sha256,
    '- Manifest: MV3 / version ' + config.version, '- Production files: ' + inventory.length,
    '- Source/stage/extraction/Git byte parity: ' + inventory.length + '/' + inventory.length,
    '- Freeze: ' + inventory.length + '/' + inventory.length + ' exact public-release baseline hashes.',
    '- Tests: ' + Object.entries(report.tests).map(([n, r]) => n + ' ' + r.count + '/' + r.count).join('; '),
    '- Package validation: PASS (source/stage/independent extraction).',
    '- Git clean state and annotated tag/hash binding: PASS.',
    '- Automated certification: PASS. Live manual certification: separate signed-in PokerNow validation is required.',
    '- Rare live cases are not inferred from that global signoff; consult LIVE_VALIDATION_MATRIX.md.',
    '- Production behavior matches the reviewed public-release baseline.',
    '- Frozen deterministic ZIP SHA-256: ' + baseline.sha256, '', 'Generated after commit/tag to avoid a self-referential commit hash. This attestation is an ignored immutable sidecar; release source, docs and tooling are committed.', ''];
  const markdown = lines.join('\n'), mdPath = path.join(dest, 'RELEASE_INVENTORY.md');
  if (fs.existsSync(mdPath)) assert.strictEqual(fs.readFileSync(mdPath, 'utf8'), markdown);
  else fs.writeFileSync(mdPath, markdown, { flag: 'wx' });
  console.log('Attested ' + commit + ' / ' + config.tag + ' / ' + report.sha256);
}
module.exports = { root, config, inventory, baseline, buildFiles, validNames, baselineBytes, freeze, validate, fingerprint, generatedDir, crc32, zipBytes, packageValidation };
if (require.main === module) {
  const command = process.argv[2], arg = process.argv[3];
  if (command === 'validate') { console.log(validate()); packageValidation(root); }
  else if (command === 'test') testSuite(arg);
  else if (command === 'gates') console.log(Object.fromEntries(Object.entries(gates()).map(([k, v]) => [k, v.count])));
  else if (command === 'pack') pack(arg);
  else if (command === 'verify') verify(arg);
  else if (command === 'attest') attest(arg);
  else throw new Error('Use validate | test release/focused/fast/full | gates | pack [out] | verify [out] | attest [out]');
}
