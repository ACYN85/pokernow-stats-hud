'use strict';
var assert = require('assert');
var fs = require('fs');
var support = require('./testSupport/productionContentScriptHarness');
var frames = require('./testSupport/flopCBetProductionFrames');
var indexed = require('./careerIndexedStore');
var content = fs.readFileSync('content.js', 'utf8');
function instrument(source) {
  return source.replace(/\n\}\)\(\);\s*$/, `
  globalThis.asyncOwners = globalThis.asyncOwners || [];
  globalThis.asyncOwners.push({ setup: function (kind, service, queue) {
    careerIndexedService = service; careerIndexedAppendQueue = queue;
    if (kind === 'import') { careerDataUiState.importCandidate = {}; careerDataUiState.importPreview = {canImport:true}; }
    if (kind === 'restore') { careerDataUiState.backupCandidate = {}; careerDataUiState.preview = {candidate:{},current:{}}; }
    if (kind === 'removal') { careerDataUiState.removalRequest = currentSessionRemovalRequest(); careerDataUiState.removalPreview = {}; }
  }, import: confirmCareerImport, restore: confirmCareerRestore, removal: confirmCurrentSessionCareerRemoval,
    state: function () { return {cleaned: extensionCleanedUp, result: careerDataUiState.result || null, reset: sessionResetInProgress}; } });
})();`);
}
async function flush() { for (var i = 0; i < 30; i++) await Promise.resolve(); }
function deferred() { var resolve; var promise = new Promise(function (yes) { resolve = yes; }); return {promise:promise,resolve:resolve}; }
(async function () {
  for (var kind of ['import', 'restore', 'removal']) for (var stage of ['queued', 'response']) {
    var h = support.createHarness({ transformContentSource: instrument });
    assert.deepStrictEqual(h.evaluationErrors, []);
    var wait = deferred(); var requests = 0;
    var service = {};
    ['mergeCareerBackup','replaceCareerBackup','removeCareerSession'].forEach(function (name) { service[name] = function () { requests++; return stage === 'response' ? wait.promise : Promise.resolve({}); }; });
    var old = h.context.asyncOwners[0];
    old.setup(kind, service, stage === 'queued' ? wait.promise : Promise.resolve());
    old[kind](); await flush();
    assert.strictEqual(requests, stage === 'queued' ? 0 : 1);
    h.evaluateInIsolatedWorld(instrument(content));
    assert.strictEqual(old.state().cleaned, true);
    var storage = JSON.stringify(h.storage); var writes = h.storageWrites.length;
    wait.resolve({ ledgerInfo: {}, summary: {}, preview: {logicalHandCount:0,affectedPlayerIds:[]} }); await flush();
    assert.strictEqual(requests, stage === 'queued' ? 0 : 1, kind + ' retired callback cannot submit another mutation');
    assert.strictEqual(old.state().result, null, kind + ' retired response cannot publish success');
    assert.strictEqual(JSON.stringify(h.storage), storage, kind + ' retired response cannot reset/persist Session');
    assert.strictEqual(h.storageWrites.length, writes);
  }
  // Certified before transfer: durable outbox survives, while the retired
  // controller itself cannot initiate the later append. Existing replay dedupes.
  var gameId = 'owned-outbox-transfer'; var keys = support.storageKeys(gameId); var storage = {};
  storage[keys.schema] = 4; storage[keys.playerMap] = {P1:'PlayerA',P2:'PlayerB'};
  var appends = 0;
  var h = support.createHarness({ gameId: gameId, initialStorage: storage, transformContentSource: instrument,
    runtimeSendMessage: function (message, callback) { if (message.method === 'append') appends++; callback({ok:true,value:{}}); } });
  await flush();
  var scenario = frames.ordinaryScenario('deep-bet-fold', 'TRANSFER');
  support.dispatchFrames(h, scenario.frames.slice(0,-1).concat([scenario.terminalFrame]), 'owned');
  assert.strictEqual((h.storage[keys.finalizedHandIds] || []).length, 1);
  assert.strictEqual(indexed.outboxRecords(h.storage).length, 1, 'authorized finalization submits durable outbox before yielding');
  h.evaluateInIsolatedWorld(instrument(content)); await flush();
  assert.strictEqual(appends, 0, 'retired append chain is fenced');
  var service = indexed.createMemoryService({}, {initializedAt:1});
  var record = indexed.outboxRecords(h.storage)[0].record;
  assert.strictEqual((await service.append(record)).accepted, true);
  assert.strictEqual((await service.append(record)).duplicate, true);
  assert.strictEqual((await service.careerStats('P1')).counters.hands, 1);
  console.log('Deferred import/restore/removal supersession and already-certified outbox durability regressions passed.');
})().catch(function (error) { console.error(error); process.exitCode = 1; });
