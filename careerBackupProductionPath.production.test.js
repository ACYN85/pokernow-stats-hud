'use strict';

var assert = require('assert');
var stats = require('./stats.js');
var contributionStore = require('./careerContributionStore.js');
var indexed = require('./careerIndexedStore.js');
var backupApi = require('./careerBackup.js');

function event(handId, playerId, player, action, street, extra) { return Object.assign({ handId: handId, playerId: playerId, player: player, action: action, street: street, amount: 0, timestamp: 1 }, extra || {}); }
function decision(opportunity, made, reason) { return { opportunity: opportunity, made: made, folded: made, reason: reason || 'fixture' }; }

(async function () {
  var events = [
    event('PROD-H1', 'A', 'Alice', 'dealt', 'preflop'), event('PROD-H1', 'B', 'Bob', 'dealt', 'preflop'),
    event('PROD-H1', 'A', 'Alice', 'raise', 'preflop', { threeBetMade: 1, threeBetOpportunities: 1, preflopOpportunityContributionId: 'preflop:2:PROD-H1:A' }),
    event('PROD-H1', 'B', 'Bob', 'call', 'preflop', { foldToThreeBetOpportunities: 1, preflopOpportunityContributionId: 'preflop:2:PROD-H1:B' }),
    event('PROD-H1', 'A', 'Alice', 'bet', 'flop', { flopCBetMade: 1, flopCBetOpportunities: 1, flopCBetContributionId: 'flop:1:PROD-H1:A' }),
    event('PROD-H1', 'B', 'Bob', 'fold', 'flop', { foldToFlopCBet: 1, foldToFlopCBetOpportunities: 1, flopCBetContributionId: 'flop:1:PROD-H1:B' })
  ];
  var semantic = { schemaVersion: 1, status: 'finalized', handIdentity: { handId: 'PROD-H1', lifecycleHandId: 'life-PROD-H1' }, players: [{ playerId: 'A' }, { playerId: 'B' }], provenance: { finalizedAt: 5000 } };
  var record = contributionStore.buildCertifiedHandRecord({
    namespace: { host: 'pokernow.com', gameId: 'PRODUCTION-PATH' }, authoritativeHandId: 'PROD-H1', semanticRecord: semantic, finalizedEvents: events,
    preflopContribution: { reducerVersion: 2, players: { A: { threeBet: decision(true, true), foldToThreeBet: decision(false, false) }, B: { threeBet: decision(false, false), foldToThreeBet: decision(true, false) } } },
    flopCBetContribution: { reducerVersion: 1, players: { A: { flopCBet: decision(true, true), foldToFlopCBetDecision: decision(false, false) }, B: { flopCBet: decision(false, false), foldToFlopCBetDecision: decision(true, true) } } }
  });
  var career = indexed.createMemoryService({}, { initializedAt: 4000, migratedAt: 4001, buildId: 'production-backup-test' });
  assert.strictEqual((await career.append(record)).accepted, true);
  var sessionBefore = stats.computePlayerStats(events, 'Alice');
  var backup = await backupApi.createBackup(await career.exportCareer());
  var plan = await backupApi.validateBackup(backup);
  var target = indexed.createMemoryService({}, { initializedAt: 9999, migratedAt: 10000 });
  await target.replaceCareerRecords(plan.records, plan.careerMetadata, { backupFormatVersion: 1, payloadDigest: plan.summary.payloadDigest });
  assert.deepStrictEqual(await target.rebuildCareerStats(), await career.rebuildCareerStats(), 'real certified contribution survives formal export and replacement');
  assert.strictEqual((await target.careerStats('A')).counters.flopCBetMade, 1);
  assert.strictEqual((await target.careerStats('B')).counters.foldToFlopCBet, 1);
  assert.deepStrictEqual(stats.computePlayerStats(events, 'Alice'), sessionBefore, 'career export/restore cannot mutate the independent session event engine');
  assert.strictEqual(stats.computePlayerStats([], 'Alice').handsPlayed, 0, 'session reset semantics remain independent');
  assert.strictEqual((await target.careerStats('A')).counters.hands, 1, 'session reset does not reset restored career history');
  console.log('Production certified contribution backup/restore and session/career independence passed.');
})().catch(function (error) { console.error(error); process.exit(1); });
