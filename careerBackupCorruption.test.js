'use strict';

var assert = require('assert');
var aggregator = require('./careerStatsAggregator.js');
var indexed = require('./careerIndexedStore.js');
var backupApi = require('./careerBackup.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
async function digestPayload(backup) {
  var payload = clone(backup); delete payload.integrity;
  var bytes = new TextEncoder().encode(backupApi.canonicalStringify(payload));
  var digest = await crypto.subtle.digest('SHA-256', bytes);
  backup.integrity.payloadDigest = Array.from(new Uint8Array(digest)).map(function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
  backup.integrity.physicalRecordCount = backup.records ? backup.records.length : backup.integrity.physicalRecordCount;
  return backup;
}
function sortRecords(backup) { backup.records.sort(function (left, right) { return left.handKey.localeCompare(right.handKey) || left.fingerprint.localeCompare(right.fingerprint); }); return backup; }
function refingerprint(record) { record.fingerprint = aggregator.fingerprint(record); return record; }

(async function () {
  var records = fixtures.complexRecords();
  var live = indexed.createMemoryService({}, { initializedAt: 700, migratedAt: 701, buildId: 'live-before-rejected-imports' });
  for (var index = 0; index < records.length; index += 1) await live.append(records[index]);
  var backup = await backupApi.createBackup(await live.exportCareer());
  var baseline = JSON.stringify(await live.exportCareer());
  var correction = backup.records.filter(function (record) { return record.authoritativeHandId === 'CORRECTION-CHAIN'; });
  var root = correction.find(function (record) { return !record.supersedesFingerprint; });
  var middle = correction.find(function (record) { return record.supersedesFingerprint === root.fingerprint; });
  var tip = correction.find(function (record) { return record.supersedesFingerprint === middle.fingerprint; });

  var cases = [];
  cases.push({ name: 'malformed JSON', value: '{"backupFormat":' });
  var unsupportedFormat = clone(backup); unsupportedFormat.backupFormatVersion = 999; cases.push({ name: 'unsupported backup version', value: await digestPayload(unsupportedFormat) });
  var missingMetadata = clone(backup); delete missingMetadata.careerMetadata.firstAcceptedAt; cases.push({ name: 'missing required metadata', value: await digestPayload(missingMetadata) });
  var changedPayload = clone(backup); changedPayload.records[0].players[0].counters.hands += 1; cases.push({ name: 'changed fingerprint payload', value: await digestPayload(changedPayload) });
  var duplicateDisagreement = clone(backup); var disagreed = clone(duplicateDisagreement.records[0]); disagreed.finalizedAt += 1; duplicateDisagreement.records.push(disagreed); cases.push({ name: 'duplicate physical fingerprint with disagreement', value: await digestPayload(sortRecords(duplicateDisagreement)) });
  var malformedPlayer = clone(backup); malformedPlayer.records[0].players[0].playerId = ' bad\u0000id '; refingerprint(malformedPlayer.records[0]); cases.push({ name: 'malformed stable player ID', value: await digestPayload(sortRecords(malformedPlayer)) });
  var invalidNamespace = clone(backup); invalidNamespace.records[0].namespace.gameId = 'WRONG-GAME'; refingerprint(invalidNamespace.records[0]); cases.push({ name: 'invalid hand namespace', value: await digestPayload(sortRecords(invalidNamespace)) });
  var cycle = clone(backup); var cycleRoot = cycle.records.find(function (record) { return record.fingerprint === root.fingerprint; }); cycleRoot.supersedesFingerprint = tip.fingerprint; refingerprint(cycleRoot); cases.push({ name: 'supersession cycle/missing-linked fingerprint', value: await digestPayload(sortRecords(cycle)) });
  var fork = clone(backup); var forkRecord = clone(middle); forkRecord.players[0].counters.pfrMade = 0; refingerprint(forkRecord); fork.records.push(forkRecord); cases.push({ name: 'supersession fork', value: await digestPayload(sortRecords(fork)) });
  var missingPredecessor = clone(backup); var missingRecord = missingPredecessor.records.find(function (record) { return record.fingerprint === root.fingerprint; }); missingRecord.supersedesFingerprint = 'ffffffffffffffff'; refingerprint(missingRecord); cases.push({ name: 'missing predecessor', value: await digestPayload(sortRecords(missingPredecessor)) });
  var crossHand = clone(backup); var crossHandRecord = crossHand.records.find(function (record) { return record.authoritativeHandId === 'BB-WALK'; }); crossHandRecord.supersedesFingerprint = tip.fingerprint; refingerprint(crossHandRecord); cases.push({ name: 'cross-hand supersession', value: await digestPayload(sortRecords(crossHand)) });
  var crossPlayer = clone(backup); var crossPlayerRecord = crossPlayer.records.find(function (record) { return record.fingerprint === middle.fingerprint; }); crossPlayerRecord.players.pop(); refingerprint(crossPlayerRecord); cases.push({ name: 'cross-player supersession', value: await digestPayload(sortRecords(crossPlayer)) });
  var regression = clone(backup); var regressed = clone(tip); regressed.semanticVersions.preflop = 2; regressed.supersedesFingerprint = tip.fingerprint; regressed.players[0].counters.pfrMade = 0; refingerprint(regressed); regression.records.push(regressed); cases.push({ name: 'semantic version regression', value: await digestPayload(sortRecords(regression)) });
  var futureVersion = clone(backup); futureVersion.records[0].semanticVersions.core = 999; refingerprint(futureVersion.records[0]); cases.push({ name: 'unknown future reducer version', value: await digestPayload(sortRecords(futureVersion)) });
  var incomplete = clone(backup); delete incomplete.records[0].players[0].decisions; refingerprint(incomplete.records[0]); cases.push({ name: 'incomplete record payload', value: await digestPayload(sortRecords(incomplete)) });

  for (var caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
    await assert.rejects(function () { return backupApi.validateBackup(cases[caseIndex].value); }, /backup|record|metadata|version|fingerprint|namespace|supersession|player|fields|payload|predecessor|semantic/i, cases[caseIndex].name + ' is rejected');
    assert.strictEqual(JSON.stringify(await live.exportCareer()), baseline, cases[caseIndex].name + ' cannot mutate the existing live career');
  }
  var validPlan = await backupApi.validateBackup(backup);
  assert.strictEqual(validPlan.summary.physicalRecordCount, records.length, 'valid backup still passes after the corruption matrix');
  console.log('Career backup corruption matrix rejected ' + cases.length + ' malformed/version/fingerprint/identity/supersession payloads with zero live mutation.');
})().catch(function (error) { console.error(error); process.exit(1); });
