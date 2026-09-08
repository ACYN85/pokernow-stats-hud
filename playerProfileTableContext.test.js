'use strict';

const assert = require('node:assert/strict');
const classifier = require('./playerProfileClassifier.js');
const finalization = require('./handFinalization.js');
const statsApi = require('./stats.js');

function profile(vpip, pfr, tableSize, overrides) {
  const hands = 200;
  return Object.assign({
    playerId: 'P1', player: 'Player', handsPlayed: hands,
    vpipHands: Math.round(vpip * hands), vpipOpportunities: hands,
    pfrHands: Math.round(pfr * hands), pfrOpportunities: hands,
    preflopTableSizeSum: tableSize === null ? null : tableSize * hands,
    preflopTableSizeOpportunities: tableSize === null ? null : hands,
    effectiveTableSize: tableSize,
    afDetails: { bets: 45, raises: 35, calls: 30 },
    threeBetMade: 12, threeBetOpportunities: 100,
    foldToThreeBet: 10, foldToThreeBetOpportunities: 20,
    flopCBetMade: 20, flopCBetOpportunities: 40,
    foldToFlopCBet: 20, foldToFlopCBetOpportunities: 40,
    wentToShowdown: 28, sawFlopForWTSD: 100,
    wonMoneyAtShowdown: 14, showdownsForWSD: 28
  }, overrides || {});
}

function classify(vpip, pfr, tableSize, overrides) {
  return classifier.classify(profile(vpip, pfr, tableSize, overrides));
}

const results = {};
results.F1 = classify(0.20, 0.16, 9);
assert.equal(results.F1.primary.archetype, 'TAG', 'F1: 20/16 is TAG territory at nine-handed tables');
results.F2 = classify(0.20, 0.16, 3);
assert.equal(results.F2.primary.archetype, 'Nit', 'F2: the same 20/16 shape is Nit-like three-handed');
results.F3 = classify(0.35, 0.25, 9);
assert.equal(results.F3.primary.archetype, 'LAG', 'F3: 35/25 is LAG-ish nine-handed');
results.F4 = classify(0.35, 0.25, 3);
assert.equal(results.F4.primary.archetype, 'TAG', 'F4: 35/25 is ordinary aggressive/TAG-ish three-handed');
assert.deepEqual(results.F4.tags, results.F3.tags, 'secondary tags remain absolute across table sizes');
results.F5 = classify(0.50, 0.35, 9);
assert.equal(results.F5.primary.archetype, 'LAG', 'F5: 50/35 remains strong LAG territory nine-handed');
results.F6 = classify(0.50, 0.35, 3);
assert.equal(results.F6.primary.archetype, 'LAG', 'F6: 50/35 is loose but is not forced to Maniac three-handed');
assert.notEqual(results.F6.primary.archetype, 'Maniac');
results.F7 = classify(0.62, 0.09, 3, {
  afDetails: { bets: 12, raises: 8, calls: 80 },
  threeBetMade: 2, threeBetOpportunities: 100,
  foldToFlopCBet: 8, foldToFlopCBetOpportunities: 40,
  wentToShowdown: 45, sawFlopForWTSD: 100
});
assert.notEqual(results.F7.primary.bestCandidate, 'Nit', 'F7: ultra-loose passive shape cannot become Nit at a normal supported size');
assert.equal(results.F7.primary.scores.Nit, 0);

const gradualSizes = [9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5];
const gradual = gradualSizes.map(size => classify(0.35, 0.25, size));
results.F8 = gradual[gradual.length - 1];
gradual.forEach((entry, index) => {
  assert.equal(entry.tableContext.effectiveTableSize, gradualSizes[index]);
  if (!index) return;
  const previous = gradual[index - 1].tableContext.shortHandedness;
  assert.ok(entry.tableContext.shortHandedness > previous, 'F8: context moves monotonically as the table gradually shrinks');
  assert.ok(entry.tableContext.shortHandedness - previous <= 0.084, 'F8: interpolation contains no discrete format jump');
});

const stableSix = classify(0.35, 0.25, 6);
const oneDeparture = classifier.classify(profile(0.35, 0.25, null, {
  handsPlayed: 201, vpipHands: 70, vpipOpportunities: 201, pfrHands: 50, pfrOpportunities: 201,
  preflopTableSizeSum: 6 * 200 + 5, preflopTableSizeOpportunities: 201,
  effectiveTableSize: (6 * 200 + 5) / 201
}));
results.F9 = oneDeparture;
assert.equal(oneDeparture.primary.archetype, stableSix.primary.archetype, 'F9: one temporary departure does not change the raw archetype');
assert.ok(Math.abs(oneDeparture.tableContext.effectiveTableSize - 6) < 0.01);
assert.ok(Math.abs(oneDeparture.primary.scores.TAG - stableSix.primary.scores.TAG) < 0.01, 'F9: score movement remains negligible');

results.F10 = classify(0.35, 0.25, 2);
assert.equal(results.F10.primary.archetype, 'Unknown / Unsupported', 'F10: heads-up is not forced into a multiway archetype');
assert.equal(results.F10.primary.classificationStatus, 'unsupported');
assert.equal(results.F10.tableContext.unsupportedReason, 'heads_up_archetype_vocabulary_not_calibrated');

const shiftEvidence = results.F2.primary.evidence.reduce((map, item) => (map[item.feature] = item, map), {});
assert.equal(shiftEvidence.vpipRate.tableSizeShift, 0.10);
assert.equal(shiftEvidence.pfrRate.tableSizeShift, 0.10);
assert.equal(shiftEvidence.vpipPfrGap.tableSizeShift, 0.01);
assert.equal(shiftEvidence.pfrVpipRatio.tableSizeShift, 0);
assert.equal(shiftEvidence.aggressionFrequency.tableSizeShift, 0);

const legacy = profile(0.35, 0.25, null, {
  preflopTableSizeSum: undefined,
  preflopTableSizeOpportunities: undefined,
  effectiveTableSize: undefined
});
const legacyResult = classifier.classify(legacy);
const baselineResult = classifier.classify(Object.assign({}, legacy));
assert.equal(legacyResult.tableContext.status, 'unsupported');
assert.deepEqual(legacyResult.primary, baselineResult.primary, 'legacy context fallback is deterministic and preserves absolute classification');

function finalizeHand(handId, players) {
  const state = finalization.createState();
  finalization.beginHand(state, handId, { timestamp: 1 });
  players.forEach((player, index) => {
    finalization.addParticipant(state, handId, { playerId: player.id, name: player.name, evidence: 'verified iHPI/in-hand player list', timestamp: index + 1 });
    finalization.stageEvent(state, { handId, playerId: player.id, player: player.name, action: index ? 'dealt' : 'blind', blindType: index ? null : 'small', street: 'preflop', amount: index ? 0 : 1, timestamp: index + 1 }, { playerId: player.id, reason: 'verified participant' });
  });
  const committed = finalization.commitHand(state, handId, 'verified terminal settlement', 10);
  assert.equal(committed.committed, true);
  return state.finalizedEvents;
}

const threeHandedEvents = finalizeHand('three-handed', [
  { id: 'P1', name: 'Player' }, { id: 'P2', name: 'Two' }, { id: 'P3', name: 'Three' }
]);
assert.ok(threeHandedEvents.every(event => event.playersDealtCount === 3));
assert.ok(threeHandedEvents.every(event => event.playersDealtCountVersion === 1));
const exactStats = statsApi.computePlayerStats(threeHandedEvents, 'Player');
assert.equal(exactStats.preflopTableSizeSum, 3);
assert.equal(exactStats.preflopTableSizeOpportunities, 1);
assert.equal(exactStats.effectiveTableSize, 3);
assert.equal(exactStats.preflopTableContextDetails.supported, true);

const restoredStats = statsApi.computePlayerStats(JSON.parse(JSON.stringify(threeHandedEvents)), 'Player');
assert.deepEqual(restoredStats.preflopTableContextDetails, exactStats.preflopTableContextDetails, 'reload restoration reconstructs the same exact context');
const resetStats = statsApi.computePlayerStats([], 'Player');
assert.equal(resetStats.preflopTableSizeSum, 0, 'session reset clears derived context counters with the existing event reset');
assert.equal(resetStats.effectiveTableSize, null);

const ninePlayers = Array.from({ length: 9 }, (_, index) => ({ id: 'N' + index, name: 'Nine' + index }));
const nineEvents = finalizeHand('nine-handed', ninePlayers);
const mixed = nineEvents.concat(threeHandedEvents);
const earlyPlayer = statsApi.computePlayerStats(mixed, 'Nine0');
const laterPlayer = statsApi.computePlayerStats(mixed, 'Player');
assert.equal(earlyPlayer.effectiveTableSize, 9, 'mixed sessions use only each player\'s own opportunities');
assert.equal(laterPlayer.effectiveTableSize, 3);
const combinedContext = statsApi.combinePlayerStats('Combined', [earlyPlayer, laterPlayer]);
assert.equal(combinedContext.preflopTableSizeSum, 12, 'additive context sums combine without raw history duplication');
assert.equal(combinedContext.preflopTableSizeOpportunities, 2);
assert.equal(combinedContext.effectiveTableSize, 6);

const legacyEventStats = statsApi.computePlayerStats([{ handId: 'legacy', playerId: 'P1', player: 'Player', action: 'dealt', street: 'preflop', amount: 0, timestamp: 1 }], 'Player');
assert.equal(legacyEventStats.effectiveTableSize, null, 'historical rows without the explicit fact are not guessed');
assert.equal(legacyEventStats.preflopTableContextDetails.supported, false);

const bombPotTaggedEvents = threeHandedEvents.map(event => Object.assign({}, event, { bombPot: true }));
assert.equal(statsApi.computePlayerStats(bombPotTaggedEvents, 'Player').effectiveTableSize, 3, 'bomb-pot markers neither invalidate nor alter reliable dealt-player evidence');

console.log('Player-profile table-context F1-F10, exact counters, mixed-size, reload/reset, legacy fallback, and bomb-pot separation passed:', JSON.stringify(
  Object.fromEntries(Object.entries(results).map(([key, value]) => [key, {
    primary: value.primary.archetype,
    bestCandidate: value.primary.bestCandidate,
    effectiveTableSize: value.tableContext.effectiveTableSize,
    contextStatus: value.tableContext.status
  }]))
));
