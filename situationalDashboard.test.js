'use strict';

var assert = require('assert');
var aggregator = require('./careerStatsAggregator.js');
var filtered = require('./filteredStats.js');
var dashboard = require('./playerDashboard.js');
var fixtures = require('./testSupport/careerBackupFixtures.js');

function pos(label, count) { return { schemaVersion: 1, status: 'supported', dealtPosition: label, dealtPlayerCount: count, unsupportedReason: null }; }
function exactDecision(value) { return fixtures.decision(Boolean(value), Boolean(value), null); }
function exactRecord(handId, subjectPosition, opponentPosition, subjectCounters, relation, sawFlop, options) {
  options = options || {}; sawFlop = sawFlop || [1, 1, 0];
  var subject = fixtures.player('subject', 'Subject', subjectCounters, { wtsd: exactDecision(sawFlop[0]), wsd: exactDecision(subjectCounters.wsdOpportunities ? subjectCounters.wsdMade : 0) });
  var opponent = fixtures.player(options.opponentId || 'me', 'Opponent', { wtsdOpportunities: sawFlop[1] }, { wtsd: exactDecision(sawFlop[1]), wsd: exactDecision(0) });
  var folded = fixtures.player('folded-' + handId, 'Folded', {}, { wtsd: exactDecision(sawFlop[2]), wsd: exactDecision(0) });
  subject.position = pos(subjectPosition, 3); opponent.position = pos(opponentPosition, 3); folded.position = pos('CO', 3);
  if (relation) {
    subject.counters.threeBetMade = relation.made;
    subject.counters.threeBetOpportunities = 1;
    subject.decisions.threeBet = fixtures.decision(1, relation.made, null);
    subject.relational.threeBetTargetPlayerId = relation.playerId;
  }
  var record = fixtures.record('SITUATION', handId, [subject, opponent, folded], { finalizedAt: options.finalizedAt || 1000 });
  record.fingerprint = aggregator.fingerprint(record);
  assert.strictEqual(aggregator.validateRecord(record), null);
  return record;
}

var ipCounters = { vpipMade: 1, pfrMade: 1, postflopAggressiveActions: 1, postflopCalls: 1, flopCBetMade: 1, flopCBetOpportunities: 1, wtsdMade: 1, wtsdOpportunities: 1, wsdMade: 1, wsdOpportunities: 1 };
var oopCounters = { vpipMade: 1, pfrMade: 0, postflopAggressiveActions: 0, postflopCalls: 1, wtsdMade: 0, wtsdOpportunities: 1 };
var ip = exactRecord('IP', 'BTN', 'BB', ipCounters, { made: 1, playerId: 'me' }, [1, 1, 0], { finalizedAt: 1001 });
var spectator = fixtures.player('spectator', 'Spectator'); ip.players.push(spectator); ip.fingerprint = aggregator.fingerprint(ip); assert.strictEqual(aggregator.validateRecord(ip), null);
var oop = exactRecord('OOP', 'SB', 'BTN', oopCounters, { made: 0, playerId: 'other' }, [1, 1, 0], { opponentId: 'other', finalizedAt: 1002 });
var multiway = exactRecord('MULTIWAY', 'BTN', 'BB', { vpipMade: 1, wtsdOpportunities: 1 }, null, [1, 1, 1], { finalizedAt: 1003 });
var incomplete = exactRecord('INCOMPLETE', 'BTN', 'BB', { vpipMade: 1, wtsdOpportunities: 1 }, null, [1, 1, 0], { finalizedAt: 1004 });
incomplete.players[2].decisions.wtsd = fixtures.decision(null, null);
incomplete.fingerprint = aggregator.fingerprint(incomplete);
assert.strictEqual(aggregator.validateRecord(incomplete), null);
var legacy = structuredClone(ip); legacy.authoritativeHandId = 'LEGACY'; legacy.handKey = 'pokernow|pokernow.com|SITUATION|LEGACY'; legacy.lifecycleHandIds = ['lifecycle:LEGACY']; legacy.schemaVersion = 2; legacy.players.forEach(function (entry) { delete entry.position; }); legacy.fingerprint = aggregator.fingerprint(legacy);
assert.strictEqual(aggregator.validateRecord(legacy), null);
var records = [ip, oop, multiway, incomplete, legacy];
var contradictory = structuredClone(ip); var contradictorySpectator = contradictory.players.find(function (entry) { return entry.playerId === 'spectator'; }); contradictorySpectator.decisions.wtsd = exactDecision(1); contradictorySpectator.counters.wtsdOpportunities = 1; contradictory.fingerprint = aggregator.fingerprint(contradictory); assert.strictEqual(aggregator.validateRecord(contradictory), null);
assert.strictEqual(filtered.careerStatsFiltered([contradictory], 'subject', { situation: 'ip' }).counters.hands, 0, 'a known unsupported-position flop entrant makes Career IP/OOP contradictory');

var overall = filtered.careerStatsFiltered(records, 'subject', {});
assert.deepStrictEqual(overall.counters, aggregator.rebuild(records).aggregate.players.subject.counters, 'Overall remains the authoritative all-hand Career aggregate');
assert.deepStrictEqual(filtered.careerStatsFiltered(records, 'subject', { situation: 'overall' }), overall, 'explicit Overall is identical to the existing unscoped query');
var careerIp = filtered.careerStatsFiltered(records, 'subject', { situation: 'ip' });
var careerOop = filtered.careerStatsFiltered(records, 'subject', { situation: 'oop' });
assert.deepStrictEqual(careerIp.counters, Object.assign(aggregator.emptyCounters(), { hands: 1, vpipMade: 1, vpipOpportunities: 1, pfrMade: 1, pfrOpportunities: 1, postflopAggressiveActions: 1, postflopCalls: 1, threeBetMade: 1, threeBetOpportunities: 1, flopCBetMade: 1, flopCBetOpportunities: 1, wtsdMade: 1, wtsdOpportunities: 1, wsdMade: 1, wsdOpportunities: 1 }));
assert.deepStrictEqual(careerOop.counters, Object.assign(aggregator.emptyCounters(), { hands: 1, vpipMade: 1, vpipOpportunities: 1, pfrOpportunities: 1, postflopCalls: 1, threeBetOpportunities: 1, wtsdOpportunities: 1 }));
assert.deepStrictEqual([careerIp.coverage.totalCareerHands, careerIp.coverage.situationTrackedHands, careerIp.coverage.matchedSituationHands, careerIp.coverage.excludedUnsupportedSituationHands], [5, 2, 1, 3]);
assert.deepStrictEqual([careerOop.coverage.situationTrackedHands, careerOop.coverage.matchedSituationHands], [2, 1]);
assert.deepStrictEqual([careerIp.derived.vpip, careerIp.derived.pfr, careerIp.derived.af, careerIp.derived.flopCBet, careerIp.derived.wtsd, careerIp.derived.wsd], [100, 100, 1, 100, 100, 100]);
assert.deepStrictEqual([careerOop.derived.vpip, careerOop.derived.pfr, careerOop.derived.af, careerOop.derived.wtsd], [100, 0, 0, 0]);

var original = structuredClone(ip); original.authoritativeHandId = 'CORRECTED'; original.handKey = 'pokernow|pokernow.com|SITUATION|CORRECTED'; original.lifecycleHandIds = ['lifecycle:CORRECTED']; original.semanticVersions.preflop = 1; original.fingerprint = aggregator.fingerprint(original);
var correction = structuredClone(original); correction.semanticVersions.preflop = 2; correction.supersedesFingerprint = original.fingerprint; correction.players[0].position.dealtPosition = 'SB'; correction.players[1].position.dealtPosition = 'BTN'; correction.fingerprint = aggregator.fingerprint(correction);
assert.strictEqual(filtered.careerStatsFiltered([original, correction], 'subject', { situation: 'ip' }).counters.hands, 0, 'superseded IP history is not counted');
assert.strictEqual(filtered.careerStatsFiltered([original, correction], 'subject', { situation: 'oop' }).counters.hands, 1, 'only the active corrected OOP record contributes');
var conflict = structuredClone(correction); conflict.supersedesFingerprint = original.fingerprint; conflict.players[0].counters.vpipMade = 0; conflict.fingerprint = aggregator.fingerprint(conflict);
assert.strictEqual(filtered.careerStatsFiltered([original, correction, conflict], 'subject', { situation: 'oop' }).counters.hands, 0, 'conflicting successors quarantine the logical hand before situation filtering');
var malformed = structuredClone(ip); malformed.players[0].counters.hands = -1;
assert.strictEqual(filtered.careerStatsFiltered([malformed], 'subject', { situation: 'ip' }).counters.hands, 0, 'malformed records are rejected before situation filtering');

var ipSelf = filtered.careerStatsFiltered(records, 'subject', { situation: 'ip', statId: 'threeBet', counterpartMode: 'self', selfPlayerId: 'me' });
var ipOthers = filtered.careerStatsFiltered(records, 'subject', { situation: 'ip', statId: 'threeBet', counterpartMode: 'others', selfPlayerId: 'me' });
var oopOthers = filtered.careerStatsFiltered(records, 'subject', { situation: 'oop', statId: 'threeBet', counterpartMode: 'others', selfPlayerId: 'me' });
assert.deepStrictEqual([ipSelf.counters.threeBetMade, ipSelf.counters.threeBetOpportunities], [1, 1]);
assert.deepStrictEqual([ipOthers.counters.threeBetMade, ipOthers.counters.threeBetOpportunities], [0, 0]);
assert.deepStrictEqual([oopOthers.counters.threeBetMade, oopOthers.counters.threeBetOpportunities], [0, 1]);

function sessionHand(record, subjectActions, showdownPlayers) {
  var events = subjectActions.map(function (action, index) { return Object.assign({ handId: record.authoritativeHandId, playerId: 'subject', player: 'Subject', countsAsHand: index === 0 }, action); });
  var assignments = {}; record.players.forEach(function (entry) { assignments[entry.playerId] = entry.position.dealtPosition; });
  var semantic = { handIdentity: { handId: record.authoritativeHandId }, players: record.players.map(function (entry) { return { playerId: entry.playerId }; }), positionProvenance: { status: 'supported', dealtPlayerCount: 3, assignments: assignments } };
  return filtered.annotateSessionEvents(events, semantic, null, null, { players: showdownPlayers });
}
var sessionEvents = sessionHand(ip, [
  { street: 'preflop', action: 'raise', threeBetMade: 1, threeBetOpportunities: 1, flopCBetMade: 1, flopCBetOpportunities: 1, sawFlopForWTSD: 1, wentToShowdown: 1, showdownsForWSD: 1, wonMoneyAtShowdown: 1 },
  { street: 'flop', action: 'bet' }, { street: 'turn', action: 'call' }
], { subject: { sawFlopForWTSD: 1 }, me: { sawFlopForWTSD: 1 }, 'folded-IP': { sawFlopForWTSD: 0 } }).concat(sessionHand(oop, [
  { street: 'preflop', action: 'call', threeBetMade: 0, threeBetOpportunities: 1, sawFlopForWTSD: 1 }, { street: 'flop', action: 'call' }
], { subject: { sawFlopForWTSD: 1 }, other: { sawFlopForWTSD: 1 }, 'folded-OOP': { sawFlopForWTSD: 0 } }));
assert.strictEqual(sessionEvents[0].postflopSituation, 'ip');
assert.strictEqual(sessionEvents[3].postflopSituation, 'oop');
var contradictorySession = sessionHand(ip, [{ street: 'preflop', action: 'raise' }], { subject: { sawFlopForWTSD: 1 }, me: { sawFlopForWTSD: 1 }, 'folded-IP': { sawFlopForWTSD: 0 }, spectator: { sawFlopForWTSD: 1 } });
assert.strictEqual(contradictorySession[0].postflopSituation, null, 'a known unsupported-position flop entrant makes Session IP/OOP contradictory');
var sessionIp = filtered.sessionStatsFiltered(sessionEvents, 'subject', { situation: 'ip' });
var sessionOop = filtered.sessionStatsFiltered(sessionEvents, 'subject', { situation: 'oop' });
assert.deepStrictEqual(filtered.sessionStatsFiltered(sessionEvents, 'subject', { situation: 'overall' }), filtered.sessionStatsFiltered(sessionEvents, 'subject', {}), 'Session Overall remains unchanged');
assert.deepStrictEqual(sessionIp.counters, careerIp.counters, 'Session and Career IP counters use the same exact subset rule');
assert.deepStrictEqual(sessionOop.counters, careerOop.counters, 'Session and Career OOP counters use the same exact subset rule');

assert.deepStrictEqual(filtered.SITUATIONS, ['ip', 'oop']);
assert.deepStrictEqual(dashboard.SITUATION_OPTIONS.map(function (option) { return option.value; }), ['overall', 'ip', 'oop']);
assert.throws(function () { filtered.normalizeFilters({ situation: 'btn_vs_blinds' }); }, /unsupported situation/);
assert.throws(function () { filtered.normalizeFilters({ situation: 'blinds_vs_steal' }); }, /unsupported situation/);
assert.throws(function () { filtered.normalizeFilters({ position: 'BTN', situation: 'ip' }); }, /mutually exclusive/);
var rendered = dashboard.render({ open: true, playerId: 'subject', displayName: 'Subject', mode: 'career', situation: 'ip', position: 'BTN', coreStats: careerIp, profile: { displayedArchetype: 'TAG' } });
assert.match(rendered, /data-dashboard-situation/); assert.match(rendered, /In position/); assert.match(rendered, /data-dashboard-position[^>]* disabled/); assert.match(rendered, /TAG/);
assert.strictEqual(dashboard.requestMatches({ open: true, playerId: 'subject', mode: 'career', situation: 'oop', position: null, opponentMode: 'overall', requestToken: 2 }, { playerId: 'subject', mode: 'career', situation: 'ip', position: null, opponentMode: 'overall', requestToken: 2 }), false);

console.log('Situational Dashboard exact IP/OOP provenance, core stats, exclusions, composition, Session/Career parity, UI and request isolation passed.');
