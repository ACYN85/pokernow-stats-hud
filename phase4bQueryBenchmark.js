'use strict';
var aggregator = require('./careerStatsAggregator.js'); var filtered = require('./filteredStats.js');
var count = Math.max(1, Number(process.argv[2] || 100000)); var playerCount = 100;
function elapsed(start) { return Math.round(Number(process.hrtime.bigint() - start) / 100000) / 10; }
function emptyPlayer(id, label, index) {
  var counters = aggregator.emptyCounters(); counters.hands = 1; counters.vpipOpportunities = 1; counters.pfrOpportunities = 1;
  return { playerId: id, displayName: 'Player', sourceContributionIds: { preflop: null, flopCBet: null, showdown: null }, counters: counters, decisions: {}, relational: { schemaVersion: 1, threeBetTargetPlayerId: null, foldToThreeBetAggressorPlayerId: null, flopCBetOpponentPlayerIds: [], foldToFlopCBetAggressorPlayerId: null }, position: { schemaVersion: 1, status: 'supported', dealtPosition: label, dealtPlayerCount: 6, unsupportedReason: null } };
}
var labels = ['BTN','SB','BB','UTG','HJ','CO']; var byPlayer = new Map(); var generationStarted = process.hrtime.bigint();
for (var index = 0; index < count; index += 1) {
  var id = 'P' + (index % playerCount); var counterpart = index % 3 === 0 ? 'OTHER' : 'SELF'; var subject = emptyPlayer(id, labels[index % labels.length], index); var other = emptyPlayer(counterpart, 'BTN', index);
  subject.counters.threeBetOpportunities = 1; subject.counters.threeBetMade = Math.floor(index / playerCount) % 2; subject.relational.threeBetTargetPlayerId = counterpart;
  var hand = 'q-' + String(index).padStart(8, '0'); var record = { schemaVersion: 3, recordType: 'certified-career-hand', handKey: 'pokernow|pokernow.com|query|' + hand, namespace: { provider: 'pokernow', host: 'pokernow.com', gameId: 'query' }, authoritativeHandId: hand, lifecycleHandIds: [], finalizedAt: 1900000000000 + index, semanticVersions: { core: 1, preflop: 2, flopCBet: 1, showdown: 1, sourceLedger: 1 }, players: [subject, other], supersedesFingerprint: null }; record.fingerprint = aggregator.fingerprint(record);
  if (!byPlayer.has(id)) byPlayer.set(id, []); byPlayer.get(id).push(record);
}
var generationMs = elapsed(generationStarted); var selected = byPlayer.get('P42') || []; var queryStarted = process.hrtime.bigint();
var result = filtered.careerStatsFiltered(selected, 'P42', { position: 'BB', statId: 'threeBet', counterpartMode: 'self', selfPlayerId: 'SELF' }); var queryMs = elapsed(queryStarted);
console.log(JSON.stringify({ environment: 'Node query-plan benchmark; browser IndexedDB latency not claimed', globalPhysicalRecords: count, stableTrackedPlayers: playerCount, playerIndexCandidateRecords: selected.length, queryPlan: 'careerRecords.playerIds multiEntry index -> active supersession resolution -> typed position/relation predicate -> exact delta sum', databaseVersionChanged: false, newIndexesAdded: 0, generationAndPlayerIndexMs: generationMs, filteredPlayerQueryMs: queryMs, matchedPositionHands: result.coverage.matchedPositionHands, matchedRelationalOpportunities: result.coverage.matchedRelationalOpportunities, result: { made: result.counters.threeBetMade, opportunities: result.counters.threeBetOpportunities } }));
