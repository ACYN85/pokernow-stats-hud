'use strict';

var assert = require('assert');
var PokerStats = require('./stats.js');
var harnessSupport = require('./testSupport/productionContentScriptHarness');
var showdownFrames = require('./testSupport/showdownStatsProductionFrames');

function makeAuthoritativeEvents(playerId, playerName, handCount) {
  var events = [];
  for (var index = 0; index < handCount; index += 1) {
    var event = {
      handId: 'PROFILE-HAND-' + index,
      playerId: playerId,
      player: playerName,
      action: index < 8 ? 'raise' : index < 12 ? 'call' : 'fold',
      street: 'preflop',
      amount: index < 12 ? 20 : 0,
      timestamp: 1000 + index
    };
    if (index < 10) {
      event.threeBetOpportunities = 1;
      event.threeBetMade = index < 3 ? 1 : 0;
    }
    if (index < 5) {
      event.foldToThreeBetOpportunities = 1;
      event.foldToThreeBet = index < 2 ? 1 : 0;
    }
    if (index < 8) {
      event.flopCBetOpportunities = 1;
      event.flopCBetMade = index < 5 ? 1 : 0;
    }
    if (index < 6) {
      event.foldToFlopCBetOpportunities = 1;
      event.foldToFlopCBet = index < 2 ? 1 : 0;
    }
    if (index < 12) {
      event.sawFlopForWTSD = 1;
      event.wentToShowdown = index < 4 ? 1 : 0;
      event.showdownsForWSD = index < 4 ? 1 : 0;
      event.wonMoneyAtShowdown = index < 2 ? 1 : 0;
    }
    events.push(event);
  }
  for (var bet = 0; bet < 6; bet += 1) events.push({ handId: 'PROFILE-HAND-' + bet, playerId: playerId, player: playerName, action: 'bet', street: 'flop', amount: 10, timestamp: 2000 + bet });
  for (var raise = 0; raise < 4; raise += 1) events.push({ handId: 'PROFILE-HAND-' + raise, playerId: playerId, player: playerName, action: 'raise', street: 'turn', amount: 20, timestamp: 2100 + raise });
  for (var call = 0; call < 5; call += 1) events.push({ handId: 'PROFILE-HAND-' + call, playerId: playerId, player: playerName, action: 'call', street: 'river', amount: 20, timestamp: 2200 + call });
  return events;
}

function expectedInput(stats) {
  return {
    handsPlayed: stats.handsPlayed,
    vpipHands: stats.vpipHands,
    vpipOpportunities: stats.vpipOpportunities,
    pfrHands: stats.pfrHands,
    pfrOpportunities: stats.pfrOpportunities,
    preflopTableSizeSum: stats.preflopTableSizeSum,
    preflopTableSizeOpportunities: stats.preflopTableSizeOpportunities,
    effectiveTableSize: stats.effectiveTableSize,
    afBets: stats.afDetails.bets,
    afRaises: stats.afDetails.raises,
    afCalls: stats.afDetails.calls,
    threeBetMade: stats.threeBetMade,
    threeBetOpportunities: stats.threeBetOpportunities,
    foldToThreeBet: stats.foldToThreeBet,
    foldToThreeBetOpportunities: stats.foldToThreeBetOpportunities,
    flopCBetMade: stats.flopCBetMade,
    flopCBetOpportunities: stats.flopCBetOpportunities,
    foldToFlopCBet: stats.foldToFlopCBet,
    foldToFlopCBetOpportunities: stats.foldToFlopCBetOpportunities,
    wentToShowdown: stats.wentToShowdown,
    sawFlopForWTSD: stats.sawFlopForWTSD,
    wonMoneyAtShowdown: stats.wonMoneyAtShowdown,
    showdownsForWSD: stats.showdownsForWSD
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

var gameId = 'profile-shadow-production';
var keys = harnessSupport.storageKeys(gameId);
var events = makeAuthoritativeEvents('P1', 'P1', 40);
var initialStorage = {};
initialStorage[keys.schema] = 4;
initialStorage[keys.playerMap] = { P1: 'P1', P2: 'P2', P3: 'P3' };
initialStorage[keys.liveEvents] = events;
initialStorage[keys.finalizedHandIds] = Array.from(new Set(events.map(function (event) { return event.handId; })));
var harness = harnessSupport.createHarness({ gameId: gameId, initialStorage: initialStorage, controlledClock: true, initialNow: 5000 });

assert.deepStrictEqual(harness.evaluationErrors, [], 'exact production isolated-world manifest path initializes');
assert.ok(harness.context.PokerNowHUDProfiles, 'isolated content-script world exposes PokerNowHUDProfiles');
['list', 'get', 'summary', 'clear', 'profileTimeline', 'profileSamples', 'profileStability', 'profileBandSnapshots', 'displayedProfile', 'allDisplayedProfiles', 'scoreDecomposition', 'allProfileStability', 'exportLiveProfileValidation', 'identityDiagnostics'].forEach(function (method) {
  assert.strictEqual(typeof harness.context.PokerNowHUDProfiles[method], 'function', method + ' is available in the extension execution context');
});
assert.strictEqual(harness.context.__PNHUD_PROFILE_DEBUG__, false, 'profile logging is disabled by default');

var expected = PokerStats.computePlayerStats(events, 'P1');
var restored = harness.context.PokerNowHUDProfiles.get('P1');
assert.ok(restored, 'restore creates a shadow profile for the stable player ID');
assert.deepStrictEqual(plain(restored.inputSummary), expectedInput(expected), 'real PokerStats output maps value-for-value into the production signature');
assert.strictEqual(restored.hands, expected.handsPlayed);
assert.strictEqual(restored.featureSummary.vpipRate.numerator, expected.vpipHands);
assert.strictEqual(restored.featureSummary.vpipRate.denominator, expected.vpipOpportunities);
assert.strictEqual(restored.featureSummary.pfrRate.numerator, expected.pfrHands);
assert.strictEqual(restored.featureSummary.aggressionFactor.numerator, expected.afDetails.bets + expected.afDetails.raises);
assert.strictEqual(restored.featureSummary.aggressionFactor.denominator, expected.afDetails.calls);
assert.strictEqual(restored.featureSummary.threeBetRate.numerator, expected.threeBetMade);
assert.strictEqual(restored.featureSummary.foldToThreeBetRate.numerator, expected.foldToThreeBet);
assert.strictEqual(restored.featureSummary.flopCBetRate.numerator, expected.flopCBetMade);
assert.strictEqual(restored.featureSummary.foldToFlopCBetRate.numerator, expected.foldToFlopCBet);
assert.strictEqual(restored.featureSummary.wtsdRate.numerator, expected.wentToShowdown);
assert.strictEqual(restored.featureSummary.wsdRate.numerator, expected.wonMoneyAtShowdown);
assert.strictEqual(harness.context.PokerNowHUDProfiles.get('P2').primary.archetype, 'Unknown / Insufficient Sample', 'mapped new player receives an H=0 profile');
assert.strictEqual(harness.context.PokerNowHUDProfiles.get('P3').primary.archetype, 'Unknown / Insufficient Sample', 'uninvolved mapped player receives an H=0 profile');
assert.ok(harness.context.PokerNowHUDProfiles.profileTimeline('P1').length >= 1, 'restored profile has bounded transition telemetry');
assert.ok(harness.context.PokerNowHUDProfiles.profileSamples('P1').length >= 1, 'restored profile has a compact validation sample');
assert.strictEqual(harness.context.PokerNowHUDProfiles.profileStability('P1').playerId, 'P1');
var displayed = harness.context.PokerNowHUDProfiles.displayedProfile('P1');
assert.ok(displayed, 'production shadow refresh also resolves an independently stored presentation state');
assert.strictEqual(displayed.rawHands, restored.hands);
assert.strictEqual(displayed.rawArchetype, restored.primary.archetype, 'presentation observes raw output without overwriting it');
assert.strictEqual(harness.context.PokerNowHUDProfiles.allDisplayedProfiles().length, 3, 'bounded presentation inspection follows stable profile ownership');
assert.deepStrictEqual(plain(harness.context.PokerNowHUDProfiles.exportLiveProfileValidation().players[0].displayedProfile), plain(displayed), 'live validation export includes the shadow-only displayed state');
var productionDecomposition = harness.context.PokerNowHUDProfiles.scoreDecomposition('P1');
assert.ok(productionDecomposition && productionDecomposition.archetypes.TAG, 'production debug path exposes detached semantic score contributions');
assert.strictEqual(JSON.stringify(productionDecomposition).includes('playerId'), false);
assert.deepStrictEqual(plain({ asOfHand: productionDecomposition.asOfHand, lastFinalizedHandId: productionDecomposition.lastFinalizedHandId, snapshotVersion: productionDecomposition.snapshotVersion }), { asOfHand: 'PROFILE-HAND-39', lastFinalizedHandId: 'PROFILE-HAND-39', snapshotVersion: 40 }, 'restored decomposition identifies its canonical finalized snapshot');

var authoritativeBefore = JSON.stringify(harness.storage[keys.liveEvents]);
var writesBeforeClear = harness.storageWrites.length;
var listed = harness.context.PokerNowHUDProfiles.list();
listed[0].inputSummary.handsPlayed = 999999;
assert.strictEqual(harness.context.PokerNowHUDProfiles.get('P1').hands, expected.handsPlayed, 'debug reads are detached from the store');
assert.ok(harness.context.PokerNowHUDProfiles.summary().every(function (entry) {
  return Object.keys(entry).sort().join(',') === 'archetype,confidence,hands,margin,playerId,runnerUp,tags';
}), 'summary exposes only bounded non-sensitive calibration fields');
assert.strictEqual(JSON.stringify(harness.storage[keys.liveEvents]), authoritativeBefore, 'profile reads never mutate authoritative events');
assert.strictEqual(harness.storageWrites.length, writesBeforeClear, 'profile reads do not write persistence');

// Exact live finalization path refreshes the stable profile once counters change.
harness.context.__PNHUD_PROFILE_DEBUG__ = true;
var scenario = showdownFrames.ordinary('showdown', 'PROFILE-LIVE-HAND');
harnessSupport.dispatchFrames(harness, scenario.frames, 'profile-live', 6000);
var eventsAfter = harness.storage[keys.liveEvents];
var expectedAfter = PokerStats.computePlayerStats(eventsAfter, 'P1');
var updated = harness.context.PokerNowHUDProfiles.get('P1');
assert.strictEqual(updated.hands, expectedAfter.handsPlayed, 'finalized live hand refreshes the production profile downstream');
assert.deepStrictEqual(plain(updated.inputSummary), expectedInput(expectedAfter));
assert.ok(updated.history.length <= 10);
var profileLogs = harness.logs.filter(function (call) { return call[0] === '[PNHUD PROFILE] player profile updated' && call[1] && call[1].playerId === 'P1'; });
assert.strictEqual(profileLogs.length, 1, 'debug mode logs the genuine classifier-output change after the finalized hand');
assert.strictEqual(profileLogs[0][1].archetype, updated.primary.archetype);
var committedDecompositions = ['P1', 'P2', 'P3'].map(function (playerId) { return plain(harness.context.PokerNowHUDProfiles.scoreDecomposition(playerId)); });
var committedFinalizedIds = harness.storage[keys.finalizedHandIds];
var committedAsOfHand = String(committedFinalizedIds[committedFinalizedIds.length - 1]);
committedDecompositions.forEach(function (decomposition) {
  assert.deepStrictEqual({ asOfHand: decomposition.asOfHand, lastFinalizedHandId: decomposition.lastFinalizedHandId, snapshotVersion: decomposition.snapshotVersion }, { asOfHand: committedAsOfHand, lastFinalizedHandId: committedAsOfHand, snapshotVersion: committedFinalizedIds.length }, 'every profile observes one post-commit finalized snapshot, including unchanged uninvolved players');
});
['vpipRate', 'pfrRate', 'threeBetRate', 'foldToThreeBetRate', 'flopCBetRate', 'foldToFlopCBetRate', 'wtsdRate', 'wsdRate', 'aggressionFrequency'].forEach(function (featureName) {
  var diagnostic = committedDecompositions[0].featureDiagnostics[featureName];
  if (diagnostic.denominator > 0) assert.strictEqual(diagnostic.rawRate, Number((diagnostic.numerator / diagnostic.denominator).toFixed(4)), featureName + ' raw rate is auditable from exact counts');
});
var afDiagnostic = committedDecompositions[0].featureDiagnostics.aggressionFactor;
assert.strictEqual(afDiagnostic.numerator, expectedAfter.afDetails.bets + expectedAfter.afDetails.raises, 'AF exposes exact aggressive-action count');
assert.strictEqual(afDiagnostic.denominator, expectedAfter.afDetails.calls, 'AF exposes exact call count');

var debugHarness = harnessSupport.createHarness({ gameId: gameId, initialStorage: harness.storage, profileDebugEnabled: true });
var initialProfileLogs = debugHarness.logs.filter(function (call) { return call[0] === '[PNHUD PROFILE] player profile updated'; });
assert.ok(initialProfileLogs.length >= 1, 'enabled-before-start debug flag emits concise initial profile changes');
assert.ok(initialProfileLogs.every(function (call) {
  return call[1] && call[1].playerId && Array.isArray(call[1].tags) && !Object.prototype.hasOwnProperty.call(call[1], 'inputSummary');
}), 'debug logs contain stable IDs and summaries but no raw authoritative state');

// Reload restores authoritative events, not profile state, and regenerates the same result.
var reloaded = harnessSupport.createHarness({ gameId: gameId, initialStorage: harness.storage, controlledClock: true, initialNow: 9000 });
assert.deepStrictEqual(reloaded.evaluationErrors, []);
var regenerated = reloaded.context.PokerNowHUDProfiles.get('P1');
['hands', 'primary', 'tags', 'featureSummary', 'supportSummary', 'inputSignature', 'inputSummary', 'classifierSchemaVersion'].forEach(function (field) {
  assert.deepStrictEqual(plain(regenerated[field]), plain(updated[field]), 'reload deterministically regenerates ' + field);
});
assert.strictEqual(regenerated.history.length, 1, 'profile history itself is not persisted');

// Stable ID owns the profile across a display-name change/rejoin representation.
var renamedEvents = eventsAfter.map(function (event) {
  return String(event.playerId || '') === 'P1' ? Object.assign({}, event, { player: 'RenamedP1' }) : event;
});
var renamedStorage = Object.assign({}, harness.storage);
renamedStorage[keys.playerMap] = { P1: 'RenamedP1', P2: 'P2' };
renamedStorage[keys.liveEvents] = renamedEvents;
var renamed = harnessSupport.createHarness({ gameId: gameId, initialStorage: renamedStorage });
assert.deepStrictEqual(renamed.evaluationErrors, []);
assert.deepStrictEqual(plain(renamed.context.PokerNowHUDProfiles.get('P1').inputSummary), plain(updated.inputSummary), 'seat/name/rejoin representation cannot change stable profile ownership');
assert.strictEqual(Object.prototype.hasOwnProperty.call(renamed.context.PokerNowHUDProfiles.get('P1'), 'player'), false, 'record retains no display name');

// clear removes shadow data only and never creates a profile storage key.
var statsStorageBeforeClear = JSON.stringify(renamed.storage);
assert.ok(renamed.context.PokerNowHUDProfiles.clear() > 0);
assert.deepStrictEqual(plain(renamed.context.PokerNowHUDProfiles.list()), []);
assert.deepStrictEqual(plain(renamed.context.PokerNowHUDProfiles.allDisplayedProfiles()), []);
assert.deepStrictEqual(plain(renamed.context.PokerNowHUDProfiles.allProfileStability()), []);
assert.strictEqual(JSON.stringify(renamed.storage), statsStorageBeforeClear);
assert.strictEqual(Object.keys(renamed.storage).some(function (key) { return /^pokerNowHudProfile/i.test(key); }), false, 'no profile persistence key exists');

var allHtml = Array.from(renamed.context.document.elements.values()).map(function (element) { return String(element.innerHTML || '') + String(element.textContent || ''); }).join('\n');
['Nit', 'TAG', 'LAG', 'Calling Station', '3B Heavy'].forEach(function (visibleProfileText) {
  assert.strictEqual(allHtml.includes(visibleProfileText), false, visibleProfileText + ' is absent from rendered production UI');
});

console.log('Production profile restore, live refresh, field mapping, identity, debug API, reload, persistence, and UI neutrality passed.');
