'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var replay = require('./testSupport/captureDerivedPreflopProductionReplay.js');
var stats = require('./stats.js');
var overlayStats = require('./overlayStats.js');

var fixtureDirectory = path.join(__dirname, 'fixtures', 'capture-derived-preflop');
var cases = [
  { id: 'A1', file: 'a1-open-3bet-fold.sanitized.json', expected: { P1: [1, 1, 0, 0], P2: [0, 0, 1, 1] } },
  { id: 'A2', file: 'a2-open-3bet-call-cbet-fold.sanitized.json', expected: { P1: [0, 0, 0, 1], P2: [1, 1, 0, 0] } },
  { id: 'A3', file: 'a3-open-coldcall-squeeze-showdown-chop.sanitized.json', expected: { P1: [0, 0, 0, 1], P2: [0, 1, 0, 1], P3: [1, 1, 0, 0] } },
  { id: 'A4', file: 'a4-short-nonfull-allin-runout-chop.sanitized.json', expected: { P1: [0, 0, 0, 0], P2: [0, 1, 0, 0], P3: [0, 0, 0, 0] } },
  { id: 'A5', file: 'a5-open-3bet-4bet-jam-fold.sanitized.json', expected: { P1: [1, 1, 0, 0], P2: [0, 0, 0, 1] } },
  { id: 'A6', file: 'a6-full-allin-3bet-call-runout.sanitized.json', expected: { P1: [1, 1, 0, 0], P2: [0, 0, 0, 1] } },
  { id: 'A7', file: 'a7-limp-raise-limper-3bet-fold.sanitized.json', expected: { P1: [1, 1, 0, 0], P2: [0, 0, 1, 1] } }
];

function load(entry) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDirectory, entry.file), 'utf8'));
}

function counterTuple(record) {
  return [
    record.threeBetMade,
    record.threeBetOpportunities,
    record.foldToThreeBet,
    record.foldToThreeBetOpportunities
  ];
}

function legacyTuple(record) {
  return {
    handsPlayed: record.handsPlayed,
    vpipOpportunities: record.vpipOpportunities,
    vpipHands: record.vpipHands,
    pfrOpportunities: record.pfrOpportunities,
    pfrHands: record.pfrHands,
    vpip: record.vpip,
    pfr: record.pfr,
    af: record.af,
    afDetails: record.afDetails
  };
}

function integrate(entry, options) {
  var result = replay.replayFixture(load(entry), options);
  assert.strictEqual(result.contributions.length, 1, entry.id + ' produces one reducer contribution');
  var events = result.finalizationInspection.finalizedEvents;
  var contribution = result.contributions[0];
  var identity = Object.keys(contribution.players).reduce(function (map, playerId) {
    map[playerId] = playerId;
    return map;
  }, {});
  var before = {};
  Object.keys(contribution.players).forEach(function (playerId) {
    before[playerId] = legacyTuple(stats.computePlayerStats(events, playerId));
  });
  var applied = stats.applyPreflopContribution(events, contribution, identity);
  assert.deepStrictEqual(applied.missingPlayerIds, [], entry.id + ' maps every contributing stable player identity');
  Object.keys(entry.expected).forEach(function (playerId) {
    var record = stats.computePlayerStats(applied.events, playerId);
    assert.deepStrictEqual(counterTuple(record), entry.expected[playerId], entry.id + ' ' + playerId + ' counters');
    assert.deepStrictEqual(legacyTuple(record), before[playerId], entry.id + ' leaves VPIP/PFR/AF inputs and outputs unchanged for ' + playerId);
  });
  return { replay: result, contribution: contribution, events: applied.events, identity: identity };
}

var integrated = {};
cases.forEach(function (entry) {
  integrated[entry.id] = integrate(entry);
});

assert.strictEqual(integrated.A3.contribution.hand.isSqueeze, true, 'A3 squeeze remains a qualifying 3Bet');
assert.strictEqual(integrated.A3.contribution.players.P2.foldToThreeBet.opportunityCount, 1, 'A3 cold caller receives its observed direct F3B response');
assert.strictEqual(integrated.A4.contribution.players.P3.threeBet.opportunity, null, 'A4 short all-in remains unsupported');
assert.strictEqual(integrated.A4.contribution.players.P1.foldToThreeBet.opportunity, null, 'A4 does not infer reopening');
assert.strictEqual(integrated.A5.contribution.players.P2.foldToThreeBet.response, 'all-in', 'A5 opener 4Bet response remains non-fold');
assert.strictEqual(integrated.A6.contribution.players.P1.threeBet.made, true, 'A6 full legal all-in 3Bet counts');
assert.strictEqual(integrated.A7.contribution.hand.openRaiser, 'P2', 'A7 limp is not the opener');
assert.strictEqual(integrated.A7.contribution.hand.threeBettor, 'P1', 'A7 limper may become the 3-bettor');

var duplicateApply = stats.applyPreflopContribution(integrated.A1.events, integrated.A1.contribution, integrated.A1.identity);
assert.strictEqual(duplicateApply.changed, false, 'duplicate finalization does not change finalized stats events');
assert.deepStrictEqual(counterTuple(stats.computePlayerStats(duplicateApply.events, 'P1')), [1, 1, 0, 0]);
var duplicateReplay = integrate(cases[0], { duplicateTerminal: true });
assert.strictEqual(duplicateReplay.replay.finalizationInspection.finalizedHandIds.length, 1, 'duplicate terminal frame finalizes once');

var stableAliases = {
  A1: { P1: 'Alpha', P2: 'Beta' },
  A2: { P1: 'Alpha', P2: 'Beta' },
  A3: { P1: 'Alpha', P2: 'Gamma', P3: 'Beta' },
  A4: { P1: 'Alpha', P2: 'Gamma', P3: 'Beta' },
  A5: { P1: 'Alpha', P2: 'Gamma' },
  A6: { P1: 'Alpha', P2: 'Gamma' },
  A7: { P1: 'Alpha', P2: 'Gamma' }
};
var accumulatedEvents = [];
cases.forEach(function (entry) {
  var source = replay.replayFixture(load(entry));
  var alias = stableAliases[entry.id];
  var contribution = JSON.parse(JSON.stringify(source.contributions[0]));
  var remappedPlayers = {};
  var identity = {};
  Object.keys(contribution.players).forEach(function (playerId) {
    var stableId = entry.id + ':' + playerId;
    var player = contribution.players[playerId];
    player.playerId = stableId;
    remappedPlayers[stableId] = player;
    identity[stableId] = alias[playerId];
  });
  contribution.players = remappedPlayers;
  var events = source.finalizationInspection.finalizedEvents.map(function (event) {
    var stableId = entry.id + ':' + event.playerId;
    return Object.assign({}, event, { playerId: stableId, player: alias[event.playerId] });
  });
  accumulatedEvents = accumulatedEvents.concat(events);
  accumulatedEvents = stats.applyPreflopContribution(accumulatedEvents, contribution, identity).events;
});
assert.deepStrictEqual(counterTuple(stats.computePlayerStats(accumulatedEvents, 'Alpha')), [4, 4, 0, 2], 'A1-A7 accumulated Alpha counters');
assert.deepStrictEqual(counterTuple(stats.computePlayerStats(accumulatedEvents, 'Beta')), [2, 2, 1, 1], 'A1-A7 accumulated Beta counters');
assert.deepStrictEqual(counterTuple(stats.computePlayerStats(accumulatedEvents, 'Gamma')), [0, 2, 1, 4], 'A1-A7 accumulated Gamma counters');

var restoredAfterFinalization = JSON.parse(JSON.stringify(accumulatedEvents));
assert.deepStrictEqual(counterTuple(stats.computePlayerStats(restoredAfterFinalization, 'Alpha')), [4, 4, 0, 2], 'storage restoration preserves counters');
var reloadBeforeFinalization = JSON.parse(JSON.stringify(integrated.A2.replay.finalizationInspection.finalizedEvents));
assert.deepStrictEqual(counterTuple(stats.computePlayerStats(reloadBeforeFinalization, 'P2')), [0, 0, 0, 0], 'reload before reduction has no premature contribution');
reloadBeforeFinalization = stats.applyPreflopContribution(reloadBeforeFinalization, integrated.A2.contribution, integrated.A2.identity).events;
assert.deepStrictEqual(counterTuple(stats.computePlayerStats(reloadBeforeFinalization, 'P2')), [1, 1, 0, 0], 'recovered hand contributes at finalization');

var lifecycleRoundTrip = JSON.parse(JSON.stringify({
  liveEvents: accumulatedEvents,
  runtimeStatus: 'paused',
  gameBreak: true,
  reconnectSnapshot: true
})).liveEvents;
assert.deepStrictEqual(counterTuple(stats.computePlayerStats(lifecycleRoundTrip, 'Gamma')), [0, 2, 1, 4], 'pause/resume, game-break, and reconnect metadata do not mutate counters');

var movedSeatEvents = integrated.A1.events.map(function (event) {
  return event.playerId === 'P1' ? Object.assign({}, event, { player: 'Alpha moved seat' }) : event;
});
assert.deepStrictEqual(counterTuple(stats.computePlayerStats(movedSeatEvents, 'Alpha moved seat')), [1, 1, 0, 0], 'seat/name remapping keeps stable player contribution');
var rejoinedEvents = JSON.parse(JSON.stringify(movedSeatEvents));
assert.deepStrictEqual(counterTuple(stats.computePlayerStats(rejoinedEvents, 'Alpha moved seat')), [1, 1, 0, 0], 'leaving and rejoining restores the same live-event counters');

assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.threeBet, {}), '3B --- (0/0)');
assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.foldToThreeBet, {}), 'F3B --- (0/0)');
assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.threeBet, { threeBetMade: 1, threeBetOpportunities: 3 }), '3B 33% (1/3)');
assert.strictEqual(overlayStats.formatStat(overlayStats.STAT_CATALOG.foldToThreeBet, { foldToThreeBet: 1, foldToThreeBetOpportunities: 2 }), 'F3B 50% (1/2)');

var content = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
var css = fs.readFileSync(path.join(__dirname, 'hud.css'), 'utf8');
assert.strictEqual((content.match(/\n        var preflopIntegration = applyFinalizedPreflopContribution\(result, reductionResult, finalizedRange\);/g) || []).length, 1, 'production has one hand-range reducer-to-stats finalization seam and retains its attachment result for explanation');
assert.ok(content.includes('handAccounting.finalizedEvents = integration.events'), 'counters join the existing finalized runtime event lifecycle');
assert.ok(content.includes('liveEvents = handAccounting.finalizedEvents'), 'the existing persisted live stats array remains authoritative');
assert.ok(!content.includes("preflopStats: '"), 'no separate preflop storage key is introduced');
assert.ok(content.includes('PokerSeatOverlay.compactStatRows(entry.stats, entry.displayedStatIds, entry.opportunityStatsLayout)'), 'seat HUD renders compact registry-owned rows using the selected opportunity layout');
assert.ok(css.includes('.pnhud-seat-stat-row'), 'compact second-row layout is styled');
assert.ok(content.includes('runtimeStatusStoreInstanceId'), 'existing runtime-status ownership remains present and separate');

console.log('Production A1-A7 live 3Bet/Fold-to-3Bet HUD integration tests passed.');
