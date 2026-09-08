const assert = require('node:assert/strict');
const { addEvent, applyPreflopContribution, applyFlopCBetContribution, applyShowdownContribution, computePlayerStats, combinePlayerStats } = require('./stats.js');

const events = [
  // Ada plays all four hands; voluntary preflop action on hands 1, 2, and 4.
  { handId: '1', player: 'Ada', action: 'call', street: 'preflop', amount: 2, timestamp: 1 },
  { handId: '1', player: 'Ada', action: 'bet', street: 'flop', amount: 5, timestamp: 2 },
  { handId: '1', player: 'Ada', action: 'call', street: 'turn', amount: 8, timestamp: 3 },
  { handId: '2', player: 'Ada', action: 'raise', street: 'preflop', amount: 7, timestamp: 4 },
  { handId: '2', player: 'Ada', action: 'raise', street: 'flop', amount: 12, timestamp: 5 },
  { handId: '3', player: 'Ada', action: 'fold', street: 'preflop', amount: 0, timestamp: 6 },
  { handId: '4', player: 'Ada', action: 'call', street: 'preflop', amount: 3, timestamp: 7 },
  { handId: '4', player: 'Ada', action: 'check', street: 'flop', amount: 0, timestamp: 8 },
  { handId: '1', player: 'Ben', action: 'fold', street: 'preflop', amount: 0, timestamp: 1 }
];

const ada = computePlayerStats(events, 'Ada');
assert.deepEqual(ada, {
  player: 'Ada', handsPlayed: 4, vpipOpportunities: 4, vpipHands: 3, pfrOpportunities: 4, pfrHands: 1, vpip: 75, pfr: 25,
  preflopTableSizeSum: 0, preflopTableSizeOpportunities: 0, effectiveTableSize: null,
  preflopTableContextDetails: { supported: false, source: null, supportedOpportunities: 0, requiredOpportunities: 4, unsupportedOpportunities: 4, unsupportedReason: 'one_or_more_preflop_opportunities_lack_exact_finalized_participant_count' },
  threeBetMade: 0, threeBetOpportunities: 0, threeBetPercent: null, foldToThreeBet: 0, foldToThreeBetOpportunities: 0, foldToThreeBetPercent: null,
  threeBetDetails: { made: 0, opportunities: 0 }, foldToThreeBetDetails: { folds: 0, opportunities: 0 },
  flopCBetMade: 0, flopCBetOpportunities: 0, foldToFlopCBet: 0, foldToFlopCBetOpportunities: 0,
  sawFlopForWTSD: 0, wentToShowdown: 0, showdownsForWSD: 0, wonMoneyAtShowdown: 0,
  handsDetails: { finalizedHands: 4 },
  vpipDetails: { qualifiedHands: 3, opportunities: 4, callHands: 2, raiseHands: 1, walksExcluded: 0, finalizedHands: 4 },
  pfrDetails: { raisedHands: 1, opportunities: 4, walksExcluded: 0, finalizedHands: 4 },
  af: 2, afDetails: { bets: 1, raises: 1, calls: 1, formula: '(1 + 1) / 1', display: '2.0' }
});

const nobody = computePlayerStats(events, 'Nobody');
assert.deepEqual(nobody, {
  player: 'Nobody', handsPlayed: 0, vpipOpportunities: 0, vpipHands: 0, pfrOpportunities: 0, pfrHands: 0, vpip: 0, pfr: 0,
  preflopTableSizeSum: 0, preflopTableSizeOpportunities: 0, effectiveTableSize: null,
  preflopTableContextDetails: { supported: false, source: null, supportedOpportunities: 0, requiredOpportunities: 0, unsupportedOpportunities: 0, unsupportedReason: 'zero_preflop_opportunities' },
  threeBetMade: 0, threeBetOpportunities: 0, threeBetPercent: null, foldToThreeBet: 0, foldToThreeBetOpportunities: 0, foldToThreeBetPercent: null,
  threeBetDetails: { made: 0, opportunities: 0 }, foldToThreeBetDetails: { folds: 0, opportunities: 0 },
  flopCBetMade: 0, flopCBetOpportunities: 0, foldToFlopCBet: 0, foldToFlopCBetOpportunities: 0,
  sawFlopForWTSD: 0, wentToShowdown: 0, showdownsForWSD: 0, wonMoneyAtShowdown: 0,
  handsDetails: { finalizedHands: 0 },
  vpipDetails: { qualifiedHands: 0, opportunities: 0, callHands: 0, raiseHands: 0, walksExcluded: 0, finalizedHands: 0 },
  pfrDetails: { raisedHands: 0, opportunities: 0, walksExcluded: 0, finalizedHands: 0 },
  af: 0, afDetails: { bets: 0, raises: 0, calls: 0, formula: '(0 + 0) / 0', display: '0.0' }
});

const noCalls = computePlayerStats([{ handId: '5', player: 'Cara', action: 'bet', street: 'flop', amount: 5, timestamp: 1 }], 'Cara');
assert.equal(noCalls.af, Infinity);
assert.deepEqual(noCalls.afDetails, { bets: 1, raises: 0, calls: 0, formula: '(1 + 0) / 0', display: '∞' });

const threeAggressiveNoCalls = computePlayerStats([
  { handId: '6', player: 'Dana', action: 'bet', street: 'flop', amount: 5, timestamp: 1 },
  { handId: '6', player: 'Dana', action: 'bet', street: 'turn', amount: 8, timestamp: 2 },
  { handId: '6', player: 'Dana', action: 'raise', street: 'river', amount: 20, timestamp: 3 }
], 'Dana');
assert.equal(threeAggressiveNoCalls.af, Infinity);
assert.deepEqual(threeAggressiveNoCalls.afDetails, { bets: 2, raises: 1, calls: 0, formula: '(2 + 1) / 0', display: '∞' });

const contributionEvents = [
  { handId: 'preflop-1', playerId: 'P1', player: 'Ada', action: 'raise', street: 'preflop', amount: 20, timestamp: 10 },
  { handId: 'preflop-1', playerId: 'P2', player: 'Ben', action: 'raise', street: 'preflop', amount: 60, timestamp: 11 }
];
const contribution = {
  reducerVersion: 1,
  handIdentity: { handId: 'preflop-1' },
  players: {
    P1: { threeBet: { opportunityCount: 0, madeCount: 0 }, foldToThreeBet: { opportunityCount: 1, foldCount: 1 } },
    P2: { threeBet: { opportunityCount: 1, madeCount: 1 }, foldToThreeBet: { opportunityCount: 0, foldCount: 0 } }
  }
};
const applied = applyPreflopContribution(contributionEvents, contribution, { P1: 'Ada', P2: 'Ben' });
assert.equal(applied.changed, true);
assert.deepEqual([computePlayerStats(applied.events, 'Ada').foldToThreeBet, computePlayerStats(applied.events, 'Ada').foldToThreeBetOpportunities], [1, 1]);
assert.deepEqual([computePlayerStats(applied.events, 'Ben').threeBetMade, computePlayerStats(applied.events, 'Ben').threeBetOpportunities], [1, 1]);
const reapplied = applyPreflopContribution(applied.events, contribution, { P1: 'Ada', P2: 'Ben' });
assert.equal(reapplied.changed, false, 'the same finalized hand contribution is idempotent');
assert.deepEqual([computePlayerStats(reapplied.events, 'Ben').threeBetMade, computePlayerStats(reapplied.events, 'Ben').threeBetOpportunities], [1, 1]);

const lifecycleAliasContribution = {
  reducerVersion: 1,
  handIdentity: { handId: 'fixture-preflop-2', lifecycleHandId: 'synthetic-lifecycle-2' },
  players: {
    P3: { threeBet: { opportunityCount: 1, madeCount: 1 }, foldToThreeBet: { opportunityCount: 0, foldCount: 0 } }
  }
};
const lifecycleAliasEvents = [
  { handId: 'synthetic-lifecycle-2', playerId: 'P3', player: 'Cara', action: 'raise', street: 'preflop', amount: 60, timestamp: 12 }
];
const lifecycleAliasApplied = applyPreflopContribution(lifecycleAliasEvents, lifecycleAliasContribution, { P3: 'Cara' });
assert.equal(lifecycleAliasApplied.changed, true, 'semantic lifecycle identity aliases match finalized live events');
assert.deepEqual([computePlayerStats(lifecycleAliasApplied.events, 'Cara').threeBetMade, computePlayerStats(lifecycleAliasApplied.events, 'Cara').threeBetOpportunities], [1, 1]);
assert.equal(lifecycleAliasApplied.events[0].preflopOpportunityHandId, 'synthetic-lifecycle-2', 'the consumed finalized event retains its lifecycle identity');

const flopEvents = [
  { handId: 'lifecycle-C1', playerId: 'A', player: 'Same Name', action: 'bet', street: 'flop', amount: 80, timestamp: 20 },
  { handId: 'lifecycle-C1', playerId: 'B', player: 'Same Name', action: 'fold', street: 'flop', amount: 0, timestamp: 21 }
];
const flopContribution = {
  reducerVersion: 1,
  handIdentity: { lifecycleHandId: 'lifecycle-C1', handId: 'C1' },
  players: {
    A: { supported: true, flopCBet: { opportunity: true, made: true }, foldToFlopCBetDecision: { opportunity: false, folded: false } },
    B: { supported: true, flopCBet: { opportunity: false, made: false }, foldToFlopCBetDecision: { opportunity: true, folded: true } }
  }
};
const flopApplied = applyFlopCBetContribution(flopEvents, flopContribution);
assert.equal(flopApplied.changed, true);
assert.deepEqual([flopApplied.events[0].flopCBetMade, flopApplied.events[0].flopCBetOpportunities], [1, 1]);
assert.deepEqual([flopApplied.events[1].foldToFlopCBet, flopApplied.events[1].foldToFlopCBetOpportunities], [1, 1]);
const flopReapplied = applyFlopCBetContribution(flopApplied.events, flopContribution);
assert.equal(flopReapplied.changed, false, 'a reducer-version contribution ID makes authoritative CBet integration idempotent');
assert.deepEqual([
  computePlayerStats(flopReapplied.events, 'Same Name').flopCBetMade,
  computePlayerStats(flopReapplied.events, 'Same Name').flopCBetOpportunities,
  computePlayerStats(flopReapplied.events, 'Same Name').foldToFlopCBet,
  computePlayerStats(flopReapplied.events, 'Same Name').foldToFlopCBetOpportunities
], [1, 1, 1, 1], 'per-hand aggregation preserves each exact stable-player contribution once');

const wrongId = applyFlopCBetContribution([
  { handId: 'lifecycle-C1', playerId: 'NOT-A', player: 'Same Name', action: 'dealt', street: 'preflop' }
], { reducerVersion: 1, handIdentity: { lifecycleHandId: 'lifecycle-C1', handId: 'C1' }, players: { A: flopContribution.players.A } });
assert.equal(wrongId.changed, false, 'display names never substitute for an exact stable player ID');
assert.deepEqual(wrongId.missingPlayerIds, ['A']);

const showdownEvents = [
  { handId: 'lifecycle-SD1', playerId: 'A', player: 'Ada', action: 'check', street: 'river', amount: 0, timestamp: 30 },
  { handId: 'lifecycle-SD1', playerId: 'B', player: 'Ben', action: 'check', street: 'river', amount: 0, timestamp: 31 }
];
const showdownContribution = {
  reducerVersion: 1,
  handIdentity: { lifecycleHandId: 'lifecycle-SD1', handId: 'authoritative-SD1' },
  players: {
    A: { sawFlopForWTSD: 1, wentToShowdown: 1, wonMoneyAtShowdownCandidate: 1, wonMoneyAtShowdownCandidateSupported: true },
    B: { sawFlopForWTSD: 1, wentToShowdown: 1, wonMoneyAtShowdownCandidate: 0, wonMoneyAtShowdownCandidateSupported: true }
  }
};
const showdownApplied = applyShowdownContribution(showdownEvents, showdownContribution);
assert.equal(showdownApplied.changed, true);
assert.deepEqual([
  computePlayerStats(showdownApplied.events, 'Ada').sawFlopForWTSD,
  computePlayerStats(showdownApplied.events, 'Ada').wentToShowdown,
  computePlayerStats(showdownApplied.events, 'Ada').showdownsForWSD,
  computePlayerStats(showdownApplied.events, 'Ada').wonMoneyAtShowdown
], [1, 1, 1, 1]);
assert.deepEqual([
  computePlayerStats(showdownApplied.events, 'Ben').sawFlopForWTSD,
  computePlayerStats(showdownApplied.events, 'Ben').wentToShowdown,
  computePlayerStats(showdownApplied.events, 'Ben').showdownsForWSD,
  computePlayerStats(showdownApplied.events, 'Ben').wonMoneyAtShowdown
], [1, 1, 1, 0]);
assert.equal(showdownApplied.events[0].showdownStatsMatchedHandId, 'lifecycle-SD1');
assert.equal(showdownApplied.events[0].showdownStatsContributionId, 'showdown-stats:1:lifecycle-SD1:A');
assert.equal(applyShowdownContribution(showdownApplied.events, showdownContribution).changed, false, 'exact showdown contribution IDs are idempotent');
const showdownWrongId = applyShowdownContribution([
  { handId: 'lifecycle-SD1', playerId: 'OTHER', player: 'Ada', action: 'check', street: 'river' }
], { reducerVersion: 1, handIdentity: showdownContribution.handIdentity, players: { A: showdownContribution.players.A } });
assert.equal(showdownWrongId.changed, false, 'showdown ingestion never falls back to a matching display name');
assert.deepEqual(showdownWrongId.missingPlayerIds, ['A']);

const showdownUnsupportedWsd = applyShowdownContribution([
  { handId: 'lifecycle-SD2', playerId: 'A', player: 'Ada', action: 'fold', street: 'river' }
], {
  reducerVersion: 1,
  handIdentity: { lifecycleHandId: 'lifecycle-SD2', handId: 'authoritative-SD2' },
  players: { A: { sawFlopForWTSD: 1, wentToShowdown: 0, wonMoneyAtShowdownCandidate: null, wonMoneyAtShowdownCandidateSupported: false } }
});
assert.deepEqual([
  computePlayerStats(showdownUnsupportedWsd.events, 'Ada').sawFlopForWTSD,
  computePlayerStats(showdownUnsupportedWsd.events, 'Ada').wentToShowdown,
  computePlayerStats(showdownUnsupportedWsd.events, 'Ada').showdownsForWSD,
  computePlayerStats(showdownUnsupportedWsd.events, 'Ada').wonMoneyAtShowdown
], [1, 0, 0, 0], 'WTSD denominator is independent from W$SD support');

const unsupported = applyFlopCBetContribution([
  { handId: 'lifecycle-C9', playerId: 'A', player: 'A', action: 'dealt', street: 'preflop' }
], {
  reducerVersion: 1,
  handIdentity: { lifecycleHandId: 'lifecycle-C9', handId: 'C9' },
  players: { A: { supported: false, unsupportedReason: 'side pot eligibility unsupported', flopCBet: { opportunity: null, made: null }, foldToFlopCBetDecision: { opportunity: null, folded: null } } }
});
assert.equal(unsupported.changed, false);
assert.deepEqual([
  computePlayerStats(unsupported.events, 'A').flopCBetMade,
  computePlayerStats(unsupported.events, 'A').flopCBetOpportunities,
  computePlayerStats(unsupported.events, 'A').foldToFlopCBet,
  computePlayerStats(unsupported.events, 'A').foldToFlopCBetOpportunities
], [0, 0, 0, 0], 'unsupported/null results contribute no numerator or denominator');

const legacyCombined = combinePlayerStats('Legacy', [{
  handsPlayed: 3,
  vpipOpportunities: 3,
  vpipHands: 1,
  pfrOpportunities: 3,
  pfrHands: 1,
  threeBetMade: 1,
  threeBetOpportunities: 2,
  foldToThreeBet: 0,
  foldToThreeBetOpportunities: 1
}]);
assert.deepEqual([
  legacyCombined.flopCBetMade,
  legacyCombined.flopCBetOpportunities,
  legacyCombined.foldToFlopCBet,
  legacyCombined.foldToFlopCBetOpportunities
], [0, 0, 0, 0], 'legacy records missing the new counters restore as numeric zero');
assert.deepEqual([legacyCombined.threeBetMade, legacyCombined.threeBetOpportunities], [1, 2], 'legacy preflop counters remain unchanged');
assert.deepEqual([
  legacyCombined.sawFlopForWTSD,
  legacyCombined.wentToShowdown,
  legacyCombined.showdownsForWSD,
  legacyCombined.wonMoneyAtShowdown
], [0, 0, 0, 0], 'legacy records missing showdown counters normalize to numeric zero');

const injected = { handId: 'self-test', player: 'HUD_TEST_PLAYER', action: 'raise', street: 'preflop', amount: 20, timestamp: 9 };
const afterAdd = addEvent(events, injected);
assert.equal(events.length, 9, 'addEvent must not mutate its input');
assert.equal(afterAdd.length, 10);
assert.equal(afterAdd[9], injected);

console.log('All stats-engine tests passed.');
