'use strict';

var assert = require('assert');
var trace = require('./tbTrace.js');
var production = require('./liveActionPipeline.js');

var SMALL = 'P1';
var BIG = 'P3';
var handId = 'decode-merge-normalize-live-hand';
var frames = [
  '42["gC",{"players":{"P1":{"stack":99},"P3":{"stack":98}},"external":{"$":{"tB":{"P1":1,"P3":2},"cPI":"P1","pITT":"P1","cRPI":[],"sBPI":"P1","bBPI":"P3"}}}]',
  '42["gC",{"external":{"$":{"tB":{"P1":"6"},"cPI":"P1","cRPI":["P1"]}}}]',
  '42["gC",{"now":1150,"pre":1100}]',
  '42["gC",{"external":{"$":{"tB":{"P3":"6"},"cPI":"P3","cRPI":["P1","P3"]}}}]'
];

var traceState = trace.createState();
var liveState = production.createState({ handId: handId, street: 'preflop', schemaConfirmed: true });
var merged = null;
var emitted = [];

frames.forEach(function (frame, index) {
  var decoded = trace.decodeSocketIoEventFrame(frame);
  assert.ok(decoded, 'Socket.IO frame ' + index + ' should decode');
  assert.strictEqual(decoded.eventName, 'gC');
  trace.traceRaw(traceState, decoded.eventName, decoded.payload, { frameId: index + 1 });

  var previous = merged;
  merged = trace.mergeSnapshot(merged, decoded.payload);
  var mergeRecord = trace.traceMerge(traceState, previous, decoded.payload, merged, { frameId: index + 1 });
  if (index === 2) assert.strictEqual(mergeRecord.patchMissingTbPreserved, true, 'a partial patch without tB must preserve accumulated player-keyed tB');
  var result = production.handleMergedPatch(liveState, previous, merged, {
    recordId: index + 1,
    timestamp: 1000 + index * 100,
    incomingPatch: decoded.payload,
    handId: handId,
    street: 'preflop',
    newHand: index === 0
  });
  assert.strictEqual(result.handled, true, 'production live handler should consume merged tB snapshot ' + index);
  trace.traceNormalized(traceState, result.normalized, { recordId: index + 1 });
  trace.recordGates(traceState, result.inference.gates, { recordId: index + 1 });
  emitted = emitted.concat(result.inference.events);
});

assert.strictEqual(traceState.rawTransitions, 2, 'raw trace should see raise and call tB changes');
assert.strictEqual(traceState.normalizedTransitions, 2, 'normalized trace should preserve both tB changes');
assert.strictEqual(traceState.voluntaryGates, 2, 'both voluntary transitions should reach the candidate gate');
assert.deepStrictEqual(liveState.invariant, { created: 2, pending: 0, confirmed: 2, rejected: 0, expired: 0, valid: true });
assert.deepStrictEqual(emitted.map(function (event) {
  return { playerId: event.playerId, action: event.action, amount: event.amount };
}), [
  { playerId: SMALL, action: 'raise', amount: 6 },
  { playerId: BIG, action: 'call', amount: 4 }
]);

console.log('Raw decode -> merge -> normalize -> production action pipeline tB trace passed.');
