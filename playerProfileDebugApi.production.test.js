'use strict';

var assert = require('assert');
var harnessSupport = require('./testSupport/productionContentScriptHarness');

function events(playerId, playerName, count, prefix) {
  return Array.from({ length: count }, function (_unused, index) {
    return {
      eventKey: prefix + ':' + index,
      handId: prefix + '-HAND-' + index,
      playerId: playerId,
      player: playerName,
      street: 'preflop',
      action: index % 3 === 0 ? 'raise' : 'fold',
      timestamp: 10000 + index,
      threeBetMade: index % 12 === 0 ? 1 : 0,
      threeBetOpportunities: index % 4 === 0 ? 1 : 0,
      foldToThreeBet: 0,
      foldToThreeBetOpportunities: index % 10 === 0 ? 1 : 0,
      flopCBetMade: index % 8 === 0 ? 1 : 0,
      flopCBetOpportunities: index % 4 === 0 ? 1 : 0,
      foldToFlopCBet: 0,
      foldToFlopCBetOpportunities: index % 9 === 0 ? 1 : 0,
      sawFlopForWTSD: index % 2 === 0 ? 1 : 0,
      wentToShowdown: index % 10 === 0 ? 1 : 0,
      showdownsForWSD: index % 10 === 0 ? 1 : 0,
      wonMoneyAtShowdown: index % 20 === 0 ? 1 : 0
    };
  });
}

(async function () {
  var currentGameId = 'profile-debug-api-current';
  var currentKeys = harnessSupport.storageKeys(currentGameId);
  var oldGameId = 'profile-debug-api-old';
  var oldKeys = harnessSupport.storageKeys(oldGameId);
  var currentEvents = events('CURRENT-P1', 'Current Player', 25, 'CURRENT');
  var oldEvents = events('OLD-P1', 'Old Player', 80, 'OLD');
  var storage = {};
  storage[currentKeys.schema] = 4;
  storage[currentKeys.playerMap] = { 'CURRENT-P1': 'Current Player' };
  storage[currentKeys.liveEvents] = currentEvents;
  storage[currentKeys.finalizedHandIds] = currentEvents.map(function (event) { return event.handId; });
  storage[oldKeys.schema] = 4;
  storage[oldKeys.playerMap] = { 'OLD-P1': 'Old Player' };
  storage[oldKeys.liveEvents] = oldEvents;
  storage['pokerNowHudSessionMeta:game:' + encodeURIComponent('pokernow.com:' + oldGameId)] = { gameId: oldGameId, url: 'https://pokernow.com/games/' + oldGameId };

  var harness = harnessSupport.createHarness({ gameId: currentGameId, initialStorage: storage });
  assert.deepStrictEqual(harness.evaluationErrors, [], 'exact isolated manifest path starts without an earlier module exception');
  assert.strictEqual(harness.evaluateInIsolatedWorld('typeof globalThis.PokerNowHUDProfiles'), 'object', 'DevTools-style isolated evaluation sees the API');
  assert.strictEqual(harness.evaluateInIsolatedWorld('globalThis.PokerNowHUDProfiles === window.PokerNowHUDProfiles && window.PokerNowHUDProfiles === self.PokerNowHUDProfiles'), true, 'all isolated-world global aliases expose the same API');
  var methodNames = harness.evaluateInIsolatedWorld('Object.keys(globalThis.PokerNowHUDProfiles)');
  ['list', 'get', 'summary', 'clear', 'profileTimeline', 'profileSamples', 'profileStability', 'profileBandSnapshots', 'displayedProfile', 'allDisplayedProfiles', 'scoreDecomposition', 'explainPlayerProfile', 'allProfileStability', 'exportLiveProfileValidation', 'identityDiagnostics', 'statsDebug', 'statsContinuityDiagnostics', 'sessions', 'exportCalibration', 'calibrationSummary', 'rebuildFromExistingStats'].forEach(function (method) {
    assert.ok(methodNames.includes(method), method + ' is visible through a console-style Object.keys call');
  });
  var startupStages = harness.logs.filter(function (call) { return /^\[PNHUD PROFILE STARTUP\]/.test(String(call[0])); }).map(function (call) { return call[0]; });
  ['PROFILE MODULE LOADED', 'PROFILE STORE CREATED', 'PROFILE API EXPOSED', 'CONTENT INTEGRATION READY'].forEach(function (stage) {
    assert.strictEqual(startupStages.filter(function (entry) { return entry === '[PNHUD PROFILE STARTUP] ' + stage; }).length, 1, stage + ' is logged exactly once');
  });

  var before = JSON.stringify(harness.storage);
  var statsDebug = harness.context.PokerNowHUDProfiles.statsDebug('CURRENT-P1');
  assert.strictEqual(statsDebug.playerId, 'CURRENT-P1');
  assert.strictEqual(statsDebug.hands, 25);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(statsDebug.threeBet)), { made: 3, opportunities: 7, percentage: 42.9 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(statsDebug.foldToThreeBet)), { folds: 0, opportunities: 3, percentage: 0 });
  assert.ok(Array.isArray(statsDebug.lastHandContributions));
  assert.ok(Array.isArray(statsDebug.reducerResults));
  assert.doesNotThrow(function () { JSON.stringify(statsDebug); });
  assert.strictEqual(JSON.stringify(statsDebug).includes('Current Player'), false, 'core stats inspection exposes stable IDs without names');
  var continuity = harness.context.PokerNowHUDProfiles.statsContinuityDiagnostics();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(continuity.attemptedRegressions)), []);
  assert.ok(continuity.persistence && Array.isArray(continuity.persistence.history));
  var sessions = await harness.context.PokerNowHUDProfiles.sessions();
  assert.strictEqual(sessions.length, 2, 'current and historical per-game namespaces are discovered');
  assert.ok(sessions.some(function (session) { return session.sessionKey === 'pokernow.com:' + oldGameId && session.eventCount === 80; }));
  assert.strictEqual(JSON.stringify(sessions).includes('https://'), false, 'session discovery returns safe metadata only');

  var currentExport = harness.context.PokerNowHUDProfiles.exportCalibration();
  assert.strictEqual(currentExport.length, 1);
  assert.strictEqual(currentExport[0].playerId, 'CURRENT-P1');
  assert.strictEqual(currentExport[0].hands, 25);
  assert.doesNotThrow(function () { JSON.stringify(currentExport); });
  var currentSummary = harness.context.PokerNowHUDProfiles.calibrationSummary();
  assert.strictEqual(currentSummary.totalPlayers, 1);
  var liveValidation = harness.context.PokerNowHUDProfiles.exportLiveProfileValidation();
  assert.strictEqual(liveValidation.session.sessionKey, 'pokernow.com:' + currentGameId);
  assert.strictEqual(liveValidation.players.length, 1);
  assert.strictEqual(liveValidation.players[0].playerId, 'CURRENT-P1');
  assert.deepStrictEqual(liveValidation.players[0].displayedProfile, harness.context.PokerNowHUDProfiles.displayedProfile('CURRENT-P1'), 'export and direct inspection expose the same shadow presentation state');
  assert.strictEqual(harness.context.PokerNowHUDProfiles.allDisplayedProfiles().length, 1);
  var scoreDecomposition = harness.context.PokerNowHUDProfiles.scoreDecomposition('CURRENT-P1');
  assert.ok(scoreDecomposition && scoreDecomposition.archetypes.Nit && Array.isArray(scoreDecomposition.archetypes.Nit.evidence));
  assert.doesNotThrow(function () { JSON.stringify(scoreDecomposition); });
  var profileExplanation = harness.context.PokerNowHUDProfiles.explainPlayerProfile('CURRENT-P1');
  assert.ok(profileExplanation && Array.isArray(profileExplanation.fitScores) && Array.isArray(profileExplanation.gatingReasons));
  assert.strictEqual(profileExplanation.hands, 25);
  assert.ok(profileExplanation.fitExplanation.includes('not probabilities'));
  assert.doesNotThrow(function () { JSON.stringify(profileExplanation); });
  assert.ok(liveValidation.players[0].timeline.length >= 1);
  assert.ok(liveValidation.players[0].samples.length >= 1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(liveValidation.players[0].currentProfile, 'player'), false, 'live validation excludes display names');
  assert.doesNotThrow(function () { JSON.stringify(liveValidation); });

  var rebuiltCurrent = harness.context.PokerNowHUDProfiles.rebuildFromExistingStats();
  assert.deepStrictEqual(rebuiltCurrent, currentExport, 'current authoritative events deterministically rebuild the same calibration output');
  var historical = await harness.context.PokerNowHUDProfiles.exportSessionCalibration('pokernow.com:' + oldGameId);
  assert.strictEqual(historical.error, null);
  assert.strictEqual(historical.profiles.length, 1);
  assert.strictEqual(historical.profiles[0].sessionKey, 'pokernow.com:' + oldGameId);
  assert.strictEqual(historical.profiles[0].playerId, 'OLD-P1');
  assert.strictEqual(historical.profiles[0].hands, 80);
  assert.strictEqual(JSON.stringify(historical).includes('Old Player'), false, 'historical exports retain stable IDs but no names');
  var historicalAgain = await harness.context.PokerNowHUDProfiles.rebuildSession('pokernow.com:' + oldGameId);
  assert.deepStrictEqual(historicalAgain, historical, 'historical reconstruction is deterministic');
  var historicalSummary = await harness.context.PokerNowHUDProfiles.sessionCalibrationSummary('pokernow.com:' + oldGameId);
  assert.strictEqual(historicalSummary.summary.playersByHands['80-149'], 1);
  assert.strictEqual(JSON.stringify(harness.storage), before, 'discovery and all rebuild/export operations leave authoritative storage byte-for-byte unchanged');
  assert.strictEqual(harness.storageWrites.some(function (update) { return Object.keys(update).some(function (key) { return /^pokerNowHudProfile/i.test(key); }); }), false, 'no profile persistence key is written');

  console.log('Real isolated-world profile API aliases, bounded live validation, startup stages, historical discovery, read-only rebuild, and calibration exports passed.');
})().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
