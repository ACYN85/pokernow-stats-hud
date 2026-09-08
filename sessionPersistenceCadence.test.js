'use strict';

var assert = require('assert');
var runtime = require('./sessionRuntime.js');
var stats = require('./stats.js');

var finalized = new Array(60000).fill(null).map(function (_, index) {
  return { handId: 'h' + Math.floor(index / 6), playerId: 'p' + (index % 6), player: 'P' + (index % 6), action: 'fold', street: 'preflop', amount: 0 };
});
var planner = runtime.createPersistencePlanner({ initialFinalizedRevision: 7, persistedFinalizedRevision: 7 });
var serializedBytes = 0;
var fullHistoryPayloads = 0;
for (var staged = 0; staged < 100; staged += 1) {
  var stagePlan = runtime.planPersistence(planner, {
    finalizedRevision: 7,
    finalized: { live: finalized, finalizedHandIds: ['h9999'] },
    recovery: { activeHand: { handId: 'active', events: [{ eventKey: 'a' + staged }] }, fingerprints: ['a' + staged] },
    reason: 'staged action'
  });
  serializedBytes += Buffer.byteLength(JSON.stringify(stagePlan.payload));
  if (stagePlan.includesFinalized) fullHistoryPayloads += 1;
  runtime.completePersistence(planner, stagePlan, null);
}
assert.strictEqual(fullHistoryPayloads, 0, 'unchanged finalized history is omitted from staged recovery writes');

var finalPlan = runtime.planPersistence(planner, {
  finalizedRevision: 8,
  finalized: { live: finalized.concat([{ handId: 'h10000', playerId: 'p0', player: 'P0', action: 'fold', street: 'preflop' }]), finalizedHandIds: ['h9999', 'h10000'] },
  recovery: { activeHand: null, fingerprints: [] },
  reason: 'finalization'
});
assert.strictEqual(finalPlan.includesFinalized, true, 'new finalized revision persists the authoritative collection once');
runtime.completePersistence(planner, finalPlan, null);
assert.strictEqual(runtime.planPersistence(planner, { finalizedRevision: 8, finalized: { live: finalized }, recovery: { activeHand: null }, reason: 'duplicate request' }).includesFinalized, false);

var failed = runtime.planPersistence(planner, { finalizedRevision: 9, finalized: { live: finalized }, recovery: { activeHand: null }, reason: 'failed final write' });
runtime.completePersistence(planner, failed, new Error('storage unavailable'));
assert.strictEqual(runtime.planPersistence(planner, { finalizedRevision: 9, finalized: { live: finalized }, recovery: { activeHand: null }, reason: 'retry' }).includesFinalized, true, 'failed finalized writes remain dirty for retry');

var writes = [];
var callbacks = [];
var queue = stats.createSerializedPersistenceQueue(function (payload, revision, callback) { writes.push({ payload: payload, revision: revision }); callbacks.push(callback); });
queue.enqueue({ live: ['final'], activeHand: { handId: 'h' } });
queue.enqueue({ activeHand: { handId: 'h', events: [1] } });
queue.enqueue({ activeHand: { handId: 'h', events: [1, 2] } });
callbacks.shift()(null);
assert.deepStrictEqual(writes[1].payload.live, ['final'], 'coalescing partial snapshots retains dirty finalized fields from the superseded pending request');
assert.deepStrictEqual(writes[1].payload.activeHand.events, [1, 2], 'latest recovery state wins inside the merged pending snapshot');

var inspection = runtime.inspectPersistence(planner);
assert.ok(inspection.recoveryOnlyPlans >= 101);
assert.strictEqual(inspection.finalizedPlans, 3);
assert.ok(serializedBytes < Buffer.byteLength(JSON.stringify({ live: finalized })) * 2, '100 staged writes serialize less than two copies of the 10k-hand history');

console.log('Revision-aware persistence cadence, failure retry, and safe partial-write coalescing passed.');
