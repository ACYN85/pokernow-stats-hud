'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var replay = require('./testSupport/captureDerivedPreflopProductionReplay.js');

var fixtureDirectory = path.join(__dirname, 'fixtures', 'capture-derived-preflop');
var allowedStateFields = new Set([
  'hI', 'gN', 'gT', 'oTC', 'pot', 'tB', 'cHB', 'mR', 'cPI', 'pITT', 'cRPI',
  'sBPI', 'bBPI', 'dealerID', 'smallBlind', 'bigBlind', 'iHPI', 'pGS', 'pC',
  'players', 'seats', 'gameResult', 'availableActions', 'legalActions',
  'allowedActions', 'actionsAvailable', 'canRaise', 'raiseAllowed', 'reopensAction'
]);
var cases = [
  { id: 'A1', file: 'a1-open-3bet-fold.sanitized.json' },
  { id: 'A2', file: 'a2-open-3bet-call-cbet-fold.sanitized.json' },
  { id: 'A3', file: 'a3-open-coldcall-squeeze-showdown-chop.sanitized.json' },
  { id: 'A4', file: 'a4-short-nonfull-allin-runout-chop.sanitized.json' },
  { id: 'A5', file: 'a5-open-3bet-4bet-jam-fold.sanitized.json' },
  { id: 'A6', file: 'a6-full-allin-3bet-call-runout.sanitized.json' },
  { id: 'A7', file: 'a7-limp-raise-limper-3bet-fold.sanitized.json' }
];

function load(entry) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDirectory, entry.file), 'utf8'));
}

function statePayload(frame) {
  var decoded = replay.decodeIngress(frame.rawPayload);
  assert.ok(decoded, 'every stored fixture frame must use valid Socket.IO framing');
  assert.ok(decoded.eventName === 'registered' || decoded.eventName === 'gC');
  return decoded.eventName === 'registered'
    ? decoded.payload.gameState
    : decoded.payload;
}

function assertPseudonymousIds(value, location) {
  if (Array.isArray(value)) {
    value.forEach(function (entry, index) {
      assertPseudonymousIds(entry, location + '[' + index + ']');
    });
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.keys(value).forEach(function (key) {
    if (['players', 'tB', 'pGS', 'pC', 'gameResult'].includes(location.split('.').pop())) {
      assert.match(key, /^P[1-9]\d*$/, location + ' uses only fixture-local player aliases');
    }
    assertPseudonymousIds(value[key], location + '.' + key);
  });
}

function assertSanitized(entry, fixture) {
  var serialized = JSON.stringify(fixture);
  assert.strictEqual(fixture.schemaVersion, 1);
  assert.strictEqual(fixture.fixtureKind, 'privacy-sanitized-capture-derived-protocol');
  assert.strictEqual(fixture.scenario.id, entry.id);
  assert.strictEqual(fixture.scenario.targetHandId, entry.id + '-HAND');
  assert.strictEqual(fixture.provenance.origin, 'capture-derived behavior shape with source linkage removed');
  assert.strictEqual(fixture.provenance.privacy, 'fixture-local aliases and synthetic card labels only');
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(serialized, /"name"\s*:/i);
  var storedPayloads = fixture.frames.map(function (frame) { return frame.rawPayload; }).join('\n');
  assert.doesNotMatch(storedPayloads, /cookie|authorization|bearer|socket.?id|access.?token|refresh.?token/i);
  fixture.frames.forEach(function (frame, index) {
    assert.strictEqual(frame.sequence, index + 1);
    assert.strictEqual(frame.direction, 'incoming');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(frame, 'timestamp'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(frame, 'url'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(frame, 'headers'), false);
    var payload = statePayload(frame);
    Object.keys(payload).forEach(function (field) {
      assert.ok(allowedStateFields.has(field), entry.id + ' contains only whitelisted state fields: ' + field);
    });
    assertPseudonymousIds(payload, 'payload');
    if (typeof payload.hI === 'string' && payload.hI !== '<D>') {
      assert.match(payload.hI, new RegExp('^' + entry.id + '-(?:HAND|NEXT)$'));
    }
    ['cPI', 'pITT', 'sBPI', 'bBPI', 'dealerID'].forEach(function (field) {
      if (typeof payload[field] === 'string' && payload[field] !== '<D>') {
        assert.match(payload[field], /^P[1-9]\d*$/);
      }
    });
  });
}

function compactPlayer(contribution, playerId) {
  var player = contribution.players[playerId];
  return {
    threeBet: {
      opportunity: player.threeBet.opportunity,
      made: player.threeBet.made,
      opportunities: player.threeBet.opportunityCount,
      madeCount: player.threeBet.madeCount,
      isSqueeze: player.threeBet.isSqueeze
    },
    foldToThreeBet: {
      opportunity: player.foldToThreeBet.opportunity,
      folded: player.foldToThreeBet.folded,
      opportunities: player.foldToThreeBet.opportunityCount,
      folds: player.foldToThreeBet.foldCount,
      response: player.foldToThreeBet.response,
      responseSubtype: player.foldToThreeBet.responseSubtype
    }
  };
}

var results = {};
cases.forEach(function (entry) {
  var fixture = load(entry);
  assertSanitized(entry, fixture);
  var result = replay.replayFixture(fixture);
  assert.strictEqual(result.finalizedRecords.length, 1, entry.id + ' finalizes exactly one target hand');
  assert.strictEqual(result.contributions.length, 1, entry.id + ' reduces exactly one target hand');
  assert.deepStrictEqual(result.finalizationInspection.finalizedHandIds, [entry.id + '-HAND']);
  assert.strictEqual(result.ledgerInspection.finalizedRecords.length, 1);
  assert.strictEqual(result.reducerInspection.coverage.reducedHandCount, 1);
  assert.ok(result.pipelineResults.every(function (pipelineResult) {
    return !pipelineResult.invariant || pipelineResult.invariant.valid;
  }), entry.id + ' preserves the live-action candidate invariant');
  assert.strictEqual(
    result.finalizedRecords[0].actions.some(function (action) {
      return action.confidence === 'recovered_generic_event';
    }),
    false,
    entry.id + ' does not append amount-encoding duplicates from the lifecycle fallback'
  );
  results[entry.id] = result;
});

var a1 = results.A1.contributions[0];
assert.deepStrictEqual(a1.hand, {
  openRaiser: 'P2',
  threeBettor: 'P1',
  validThreeBetSequence: true,
  isSqueeze: false,
  interveningCallers: []
});
assert.deepStrictEqual(compactPlayer(a1, 'P1').threeBet, {
  opportunity: true, made: true, opportunities: 1, madeCount: 1, isSqueeze: false
});
assert.deepStrictEqual(compactPlayer(a1, 'P2').foldToThreeBet, {
  opportunity: true, folded: true, opportunities: 1, folds: 1,
  response: 'fold', responseSubtype: null
});

var a2 = results.A2.contributions[0];
assert.deepStrictEqual(a2.hand, {
  openRaiser: 'P1',
  threeBettor: 'P2',
  validThreeBetSequence: true,
  isSqueeze: false,
  interveningCallers: []
});
assert.deepStrictEqual(compactPlayer(a2, 'P2').threeBet, {
  opportunity: true, made: true, opportunities: 1, madeCount: 1, isSqueeze: false
});
assert.deepStrictEqual(compactPlayer(a2, 'P1').foldToThreeBet, {
  opportunity: true, folded: false, opportunities: 1, folds: 0,
  response: 'call', responseSubtype: null
});

var a3Record = results.A3.finalizedRecords[0];
var a3 = results.A3.contributions[0];
assert.strictEqual(a3Record.preflopRoles.openingAggressor, 'P1');
assert.strictEqual(a3Record.preflopRoles.threeBettor, 'P3');
assert.strictEqual(a3Record.preflopRoles.squeezer, 'P3');
assert.deepStrictEqual(a3Record.preflopRoles.coldCallers, ['P2']);
assert.strictEqual(a3Record.settlement.chopped, true);
assert.deepStrictEqual(a3.hand, {
  openRaiser: 'P1',
  threeBettor: 'P3',
  validThreeBetSequence: true,
  isSqueeze: true,
  interveningCallers: ['P2']
});
assert.deepStrictEqual(compactPlayer(a3, 'P3').threeBet, {
  opportunity: true, made: true, opportunities: 1, madeCount: 1, isSqueeze: true
});
assert.strictEqual(compactPlayer(a3, 'P1').foldToThreeBet.response, 'call');
assert.strictEqual(compactPlayer(a3, 'P2').foldToThreeBet.opportunities, 1);
assert.strictEqual(compactPlayer(a3, 'P2').foldToThreeBet.folds, 0);
assert.strictEqual(compactPlayer(a3, 'P2').foldToThreeBet.response, 'call');

var a4Record = results.A4.finalizedRecords[0];
var a4 = results.A4.contributions[0];
var a4ShortRaise = a4Record.actions.find(function (action) {
  return action.playerId === 'P3' && action.type === 'raise';
});
assert.ok(a4ShortRaise);
assert.strictEqual(a4ShortRaise.isFullRaise, false);
assert.strictEqual(a4ShortRaise.isShortAllInRaise, true);
assert.strictEqual(a4Record.preflopRoles.threeBettor, null);
assert.strictEqual(a4Record.settlement.chopped, true);
assert.strictEqual(a4Record.automaticRunout.detected, true);
assert.strictEqual(a4.hand.validThreeBetSequence, false);
assert.strictEqual(compactPlayer(a4, 'P3').threeBet.opportunity, null);
assert.strictEqual(compactPlayer(a4, 'P3').threeBet.opportunities, 0);
assert.strictEqual(compactPlayer(a4, 'P1').foldToThreeBet.opportunity, null);
assert.strictEqual(compactPlayer(a4, 'P1').foldToThreeBet.opportunities, 0);
assert.strictEqual(compactPlayer(a4, 'P2').foldToThreeBet.opportunities, 0);

var a5Record = results.A5.finalizedRecords[0];
var a5 = results.A5.contributions[0];
assert.strictEqual(a5Record.preflopRoles.openingAggressor, 'P2');
assert.strictEqual(a5Record.preflopRoles.threeBettor, 'P1');
assert.strictEqual(a5Record.preflopRoles.finalAggressor, 'P2');
assert.deepStrictEqual(compactPlayer(a5, 'P1').threeBet, {
  opportunity: true, made: true, opportunities: 1, madeCount: 1, isSqueeze: false
});
assert.deepStrictEqual(compactPlayer(a5, 'P2').foldToThreeBet, {
  opportunity: true, folded: false, opportunities: 1, folds: 0,
  response: 'all-in', responseSubtype: 'full_raise'
});
assert.strictEqual(
  a5Record.actions.some(function (action) {
    return action.playerId === 'P1' && action.type === 'fold';
  }),
  true,
  'A5 retains the later 3-bettor fold without assigning it to the opener'
);

var a6Record = results.A6.finalizedRecords[0];
var a6 = results.A6.contributions[0];
var a6ThreeBet = a6Record.actions.find(function (action) {
  return action.playerId === 'P1' && action.type === 'raise' && action.amountTo === 220;
});
assert.ok(a6ThreeBet);
assert.strictEqual(a6ThreeBet.isAllIn, true);
assert.strictEqual(a6ThreeBet.isFullRaise, true);
assert.strictEqual(a6Record.automaticRunout.detected, true);
assert.deepStrictEqual(compactPlayer(a6, 'P1').threeBet, {
  opportunity: true, made: true, opportunities: 1, madeCount: 1, isSqueeze: false
});
assert.deepStrictEqual(compactPlayer(a6, 'P2').foldToThreeBet, {
  opportunity: true, folded: false, opportunities: 1, folds: 0,
  response: 'call', responseSubtype: null
});

var a7Record = results.A7.finalizedRecords[0];
var a7 = results.A7.contributions[0];
var a7Voluntary = a7Record.actions.filter(function (action) {
  return action.street === 'preflop' && action.type !== 'post_blind';
});
assert.deepStrictEqual(
  a7Voluntary.map(function (action) {
    return [action.playerId, action.type, action.amountTo];
  }),
  [
    ['P1', 'call', 20],
    ['P2', 'raise', 80],
    ['P1', 'raise', 240],
    ['P2', 'fold', null]
  ],
  'A7 preserves limp -> open raise -> limper 3Bet -> original raiser fold'
);
assert.strictEqual(a7Record.preflopRoles.openingAggressor, 'P2');
assert.strictEqual(a7Record.preflopRoles.threeBettor, 'P1');
assert.deepStrictEqual(compactPlayer(a7, 'P1').threeBet, {
  opportunity: true, made: true, opportunities: 1, madeCount: 1, isSqueeze: false
});
assert.deepStrictEqual(compactPlayer(a7, 'P2').foldToThreeBet, {
  opportunity: true, folded: true, opportunities: 1, folds: 1,
  response: 'fold', responseSubtype: null
});

var noisyDuplicate = replay.replayFixture(load(cases[2]), {
  prefixNoise: true,
  duplicateTerminal: true
});
assert.strictEqual(noisyDuplicate.ingress.malformedOrControl, 2);
assert.strictEqual(noisyDuplicate.ingress.unrelated, 1);
assert.strictEqual(noisyDuplicate.finalizedRecords.length, 1);
assert.strictEqual(noisyDuplicate.contributions.length, 1);
assert.strictEqual(noisyDuplicate.reducerInspection.coverage.reducedHandCount, 1);
assert.strictEqual(noisyDuplicate.ledgerInspection.finalizedRecords.length, 1);
assert.ok(noisyDuplicate.commitResults.some(function (result) {
  return result.duplicate === true;
}), 'a replayed terminal frame reaches lifecycle deduplication');
assert.ok(noisyDuplicate.ledgerResults.some(function (result) {
  return result.duplicate === true;
}), 'a replayed terminal frame reaches semantic-ledger deduplication');

console.log('Seven privacy-sanitized capture-derived protocol fixtures passed production decode, lifecycle, ledger, reducer, privacy, and deduplication validation.');
