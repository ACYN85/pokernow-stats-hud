'use strict';
const assert = require('assert');
const classifier = require('./playerProfileClassifier.js');
const presentation = require('./playerProfilePresentation.js');
const explanation = require('./playerProfileExplanation.js');
const dashboard = require('./playerDashboard.js');
const aggregator = require('./careerStatsAggregator.js');
const indexed = require('./careerIndexedStore.js');
const contribution = require('./careerContributionStore.js');
const queryHarness = require('./testSupport/careerDashboardQueryHarness.js');
const f = require('./testSupport/careerBackupFixtures.js');

function profile(stats) { return dashboard.careerProfile(stats, classifier, presentation, explanation); }
function counters(i, loose) {
  return {
    vpipMade: i % 100 < (loose ? 60 : 24) ? 1 : 0,
    pfrMade: i % 100 < (loose ? 12 : 20) ? 1 : 0,
    postflopAggressiveActions: i % 10 < (loose ? 1 : 6) ? 1 : 0,
    postflopCalls: i % 10 < (loose ? 7 : 3) ? 1 : 0,
    threeBetMade: i % 20 === 0 ? 1 : 0, threeBetOpportunities: 1,
    foldToThreeBet: i % 2, foldToThreeBetOpportunities: 1,
    flopCBetMade: i % 10 < 6 ? 1 : 0, flopCBetOpportunities: 1,
    foldToFlopCBet: i % 10 < (loose ? 1 : 5) ? 1 : 0, foldToFlopCBetOpportunities: 1,
    wtsdMade: i % 10 < (loose ? 5 : 3) ? 1 : 0, wtsdOpportunities: 1,
    wsdMade: i % 10 < 1 ? 1 : 0, wsdOpportunities: i % 10 < (loose ? 5 : 3) ? 1 : 0
  };
}
function record(i, options) {
  options = options || {};
  const id = options.id || 'a';
  const player = f.player(id, options.name || 'Same Name', counters(i, options.loose));
  const dealt = options.dealtPlayerCount === undefined ? 9 : options.dealtPlayerCount;
  player.position = { schemaVersion: 1, status: options.positionUnsupported ? 'unsupported' : 'supported', dealtPosition: options.positionUnsupported ? null : 'BTN', dealtPlayerCount: dealt, unsupportedReason: options.positionUnsupported ? 'button unavailable' : null };
  const value = f.record('PROFILES', options.handId || String(i) + id, [player], { finalizedAt: 1000 + i, semanticVersions: options.semanticVersions });
  if (options.schemaVersion) value.schemaVersion = options.schemaVersion;
  if (options.supersedesFingerprint) value.supersedesFingerprint = options.supersedesFingerprint;
  value.fingerprint = aggregator.fingerprint(value);
  assert.equal(aggregator.validateRecord(value), null);
  return value;
}
function player(records, id) { return aggregator.playerStats(aggregator.createState(records), id || 'a'); }
function projection(records, id) { const value = player(records, id); return value && value.profileProjection; }
function sumCounters(records, id) {
  const expected = aggregator.emptyCounters(); id = id || 'a';
  records.forEach(function (item) {
    const entry = item.players.find(function (candidate) { return candidate.playerId === id; });
    if (!entry || item.schemaVersion < 3 || !entry.position || !Number.isInteger(entry.position.dealtPlayerCount) || entry.position.dealtPlayerCount < 3) return;
    aggregator.COUNTER_FIELDS.forEach(function (field) { expected[field] += entry.counters[field]; });
  });
  return expected;
}

(async function () {
  const headsUp = Array.from({ length: 600 }, function (_, i) { return record(i, { dealtPlayerCount: 2, loose: true, handId: 'HU-' + i }); });
  const multiway = Array.from({ length: 150 }, function (_, i) { return record(1000 + i, { dealtPlayerCount: 3 + i % 3, handId: 'MW-' + i }); });
  const mostlyHeadsUp = headsUp.concat(multiway);
  const aggregatePlayer = player(mostlyHeadsUp);
  const profileStats = aggregatePlayer.profileProjection;
  const classified = profile(profileStats);

  assert.equal(aggregatePlayer.counters.hands, 750, 'normal Career counters retain all heads-up and multiway hands');
  assert.equal(profileStats.counters.hands, 150, 'profile Hands use only exact 3+ handed contributions');
  assert.deepStrictEqual(profileStats.counters, sumCounters(multiway), 'VPIP/PFR/AF and every optional support counter come only from the multiway subset');
  assert.equal(profileStats.profileContext.preflopTableSizeOpportunities, 150);
  assert.equal(profileStats.profileContext.preflopTableSizeSum, multiway.reduce(function (sum, item) { return sum + item.players[0].position.dealtPlayerCount; }, 0), 'effective table size uses only supported multiway hands');
  assert.equal(classified.displayedArchetype, 'TAG', 'mostly-HU history can classify from its mature multiway subset');
  assert.equal(classified.hands, 150);
  assert.equal(classified.explanation.hands, 150, 'Why this profile reports the actual profile sample');
  assert.equal(classified.availability.diagnostics.careerHands, 150);
  assert.equal(classified.availability.diagnostics.effectiveTableSize, 4, 'displayed table context is computed from the 3/4/5-handed subset');
  const rendered = dashboard.render({ mode: 'career', playerId: 'a', careerStats: { counters: aggregatePlayer.counters }, profile: classified });
  assert.ok(rendered.includes('Career · All table sizes · 750 hands'));
  assert.ok(rendered.includes('Select a table-size segment for calibrated player analysis.'));
  assert.ok(!rendered.includes('Career profile</h3>'), 'mixed All suppresses a single-bucket profile');

  const pureHeadsUp = profile(projection(headsUp));
  assert.equal(pureHeadsUp.displayedArchetype, null);
  assert.equal(pureHeadsUp.availability.reason, 'no_supported_table_size_sample');
  assert.match(pureHeadsUp.availability.message, /No supported table-size sample/);

  const immature = profile(projection(headsUp.slice(0, 490).concat(multiway.slice(0, 10))));
  assert.equal(immature.displayedArchetype, null);
  assert.equal(immature.hands, 10);
  assert.equal(immature.availability.reason, 'insufficient_table_size_hands');
  const lagMaturity = structuredClone(projection(multiway.slice(0, 40)));
  Object.assign(lagMaturity.counters, { hands: 40, vpipMade: 11, vpipOpportunities: 40, pfrMade: 10, pfrOpportunities: 40, postflopAggressiveActions: 30, postflopCalls: 10, threeBetMade: 0, threeBetOpportunities: 0, foldToThreeBet: 0, foldToThreeBetOpportunities: 0, flopCBetMade: 0, flopCBetOpportunities: 0, foldToFlopCBet: 0, foldToFlopCBetOpportunities: 0, wtsdMade: 0, wtsdOpportunities: 0, wsdMade: 0, wsdOpportunities: 0 });
  Object.assign(lagMaturity.profileContext, { preflopTableSizeSum: 160, preflopTableSizeOpportunities: 40 });
  assert.equal(profile(lagMaturity).availability.reason, 'profile_maturity_or_strength_gate', 'existing aggressive-archetype maturity gates remain intact');

  const exactCountWithoutPosition = record(9000, { dealtPlayerCount: 6, positionUnsupported: true, handId: 'EXACT-NO-POSITION' });
  assert.equal(projection([exactCountWithoutPosition]).profileContext.preflopTableSizeSum, 6, 'schema-v3 exact dealt count survives unrelated position naming failure');
  const legacy = Array.from({ length: 100 }, function (_, i) { return record(20000 + i, { schemaVersion: 2, dealtPlayerCount: 5, handId: 'LEGACY-' + i }); });
  assert.equal(projection(legacy).counters.hands, 0, 'legacy records with unvalidated extra fields do not fabricate table size');
  assert.equal(profile(projection(legacy)).availability.reason, 'no_supported_table_size_sample');
  const modernAndLegacy = projection(multiway.concat(legacy));
  assert.equal(modernAndLegacy.counters.hands, 150, 'unknown-context legacy history is excluded beside modern multiway history');
  assert.deepStrictEqual(modernAndLegacy.counters, profileStats.counters);

  const predecessor = record(12000, { dealtPlayerCount: 2, handId: 'SUPERSEDED', semanticVersions: { preflop: 1 } });
  const successor = record(12001, { dealtPlayerCount: 4, handId: 'SUPERSEDED', supersedesFingerprint: predecessor.fingerprint });
  const superseded = projection([predecessor, successor]);
  assert.equal(superseded.counters.hands, 1, 'only the active supersession tip can enter the profile subset');
  assert.equal(superseded.profileContext.preflopTableSizeSum, 4);
  const conflictA = record(13000, { dealtPlayerCount: 5, handId: 'QUARANTINED' });
  const conflictB = structuredClone(conflictA); conflictB.players[0].counters.vpipMade = 0; conflictB.fingerprint = aggregator.fingerprint(conflictB);
  const quarantined = projection(multiway.slice(0, 1).concat([conflictA, conflictB]));
  assert.equal(quarantined.counters.hands, 1, 'quarantined logical hands are excluded before profile eligibility');

  const duplicateNameRecords = multiway.slice(0, 60).concat(Array.from({ length: 60 }, function (_, i) { return record(14000 + i, { id: 'b', name: 'Same Name', dealtPlayerCount: 5, loose: true, handId: 'B-' + i }); }));
  assert.equal(projection(duplicateNameRecords, 'a').counters.hands, 60);
  assert.equal(projection(duplicateNameRecords, 'b').counters.hands, 60);
  assert.notDeepStrictEqual(projection(duplicateNameRecords, 'a').counters, projection(duplicateNameRecords, 'b').counters, 'duplicate display names stay stable-ID isolated');

  const saved = {};
  mostlyHeadsUp.forEach(function (item) { saved[contribution.storageRecordKey(item.handKey, item.fingerprint)] = item; });
  const store = indexed.createMemoryService(saved);
  const all = await store.careerDashboardStats('a', {});
  assert.equal(all.core.counters.hands, 750);
  assert.equal(all.profileStats, null, 'mixed All has no single calibrated profile');
  const first = await store.careerDashboardStats('a', { tableSize: '3_TO_5' });
  assert.equal(first.core.counters.hands, 150);
  assert.equal(first.profileStats.counters.hands, 150);
  assert.equal(profile(first.profileStats).displayedArchetype, 'TAG');
  assert.equal(first.query.playerRecordRetrievals, 0, 'warm aggregate-backed Dashboard read performs no history retrieval');
  const filtered = await store.careerDashboardStats('a', { position: 'SB', tableSize: '3_TO_5' });
  assert.equal(filtered.core.counters.hands, 0);
  assert.equal(filtered.profileStats.counters.hands, 0, 'position profiles use the selected exact slice');
  const huAppend = record(16000, { dealtPlayerCount: 2, loose: true, handId: 'HU-APPEND' });
  await store.append(huAppend);
  const afterHu = await store.careerDashboardStats('a', { tableSize: '3_TO_5' });
  assert.ok(afterHu.query.playerRevision > first.query.playerRevision);
  assert.equal(afterHu.core.counters.hands, 150);
  assert.equal(afterHu.profileStats.counters.hands, 150, 'Career revision rebuild keeps a heads-up append out of the profile projection');
  const mwAppend = record(16001, { dealtPlayerCount: 4, handId: 'MW-APPEND' });
  await store.append(mwAppend);
  const afterMultiway = await store.careerDashboardStats('a', { tableSize: '3_TO_5' });
  assert.equal(afterMultiway.core.counters.hands, 151);
  assert.equal(afterMultiway.profileStats.counters.hands, 151, 'Career revision rebuild includes a new authoritative multiway contribution');
  store.testHooks.caches.get('a').player.profileProjection.version = 0; store.testHooks.dashboardCache.clear();
  const rebuilt = await store.careerDashboardStats('a', { tableSize: '3_TO_5' });
  assert.equal(rebuilt.query.playerRecordRetrievals, 1, 'legacy aggregate cache without the current profile projection rebuilds from authoritative history');
  assert.equal(rebuilt.profileStats.counters.hands, 151);
  const warm = await store.careerDashboardStats('a', { tableSize: '3_TO_5' });
  assert.equal(warm.query.playerRecordRetrievals, 0);
  assert.equal(warm.query.dashboardCacheHit, true);
  const detached = structuredClone(warm); detached.profileStats.counters.hands = 9999;
  assert.equal((await store.careerDashboardStats('a', { tableSize: '3_TO_5' })).profileStats.counters.hands, 151, 'returned profile snapshots are detached from the aggregate cache');

  const driver = await queryHarness.openHarness(false);
  try {
    await driver.reset(mostlyHeadsUp, true);
    const cold = await driver.sample('a', { tableSize: '3_TO_5' });
    assert.equal(cold.result.core.counters.hands, 150);
    assert.equal(cold.result.profileStats.counters.hands, 150);
    assert.equal(cold.result.query.playerRecordRetrievals, 1);
    assert.equal(cold.passes, 1, 'cold profile/aggregate read shares one resolver rebuild');
    const warmRender = await driver.sample('a', { tableSize: '3_TO_5' });
    assert.equal(warmRender.result.query.playerRecordRetrievals, 0);
    assert.equal(warmRender.passes, 0, 'warm profile render does not rebuild or rescan history');
  } finally { await driver.close(); }

  console.log('Career profile projection, all-hand stat invariance, resolver authority, cache behavior, UI disclosure, and stable identity passed.');
})();
