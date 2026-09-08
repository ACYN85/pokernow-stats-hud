'use strict';

var assert = require('assert');
var bounds = require('./runtimeBounds.js');
var cacheApi = require('./sessionStatsCache.js');
var runtime = require('./sessionRuntime.js');

var processedFrames = bounds.createFifoSet(1000);
var walkTraces = bounds.createFifoSet(100);
var mappingHistory = bounds.createFifoSet(100);
var overlayFailures = bounds.createFifoSet(200);
var cache = cacheApi.create({ maxEntries: 256 });
var planner = runtime.createPersistencePlanner({ initialFinalizedRevision: 0, persistedFinalizedRevision: 0 });
var binary = bounds.createPendingBinaryQueue({ maxPackets: 16, maxBytes: 8 * 1024 * 1024, ttlMs: 15000, maxAttachments: 16, maxQuarantines: 32 });
var retainedEvents = 0;
var finalizedHands = new Set();

for (var hand = 0; hand < 10000; hand += 1) {
  finalizedHands.add('soak-' + hand);
  retainedEvents += 6;
  for (var action = 0; action < 18; action += 1) processedFrames.add('frame-' + hand + '-' + action);
  walkTraces.add('soak-' + hand);
  mappingHistory.add('mapping-' + hand);
  overlayFailures.add('player-' + hand);
  if (hand % 100 === 0) cacheApi.advance(cache, 'soak finalized batch');
  for (var query = 0; query < 12; query += 1) {
    cacheApi.get(cache, { playerId: 'p' + (query % 6), position: 'position-' + (hand % 60) + '-' + query }, function () { return { hands: hand + 1, query: query }; });
  }
  var stagePlan = runtime.planPersistence(planner, { finalizedRevision: cache.revision, finalized: { live: 'retained externally' }, recovery: { activeHand: { handId: 'soak-' + hand } }, reason: 'soak staged checkpoint' });
  runtime.completePersistence(planner, stagePlan, null);
}

for (var packet = 0; packet < 1000; packet += 1) {
  var metadata = { direction: 'incoming', socketUrl: 'wss://table/' + (packet % 4), frameId: packet };
  var enqueue = binary.enqueue({ attachmentsExpected: 1, payload: { _placeholder: true, num: 0 } }, metadata, packet * 20);
  assert.strictEqual(enqueue.accepted, true);
  assert.strictEqual(binary.consume(new Uint8Array([packet % 255]), 1, metadata, packet * 20 + 1).status, 'complete');
}
for (var incomplete = 0; incomplete < 32; incomplete += 1) binary.enqueue({ attachmentsExpected: 2 }, { direction: 'incoming', socketUrl: 'wss://incomplete/' + incomplete }, 30000);
binary.prune(50001);

var report = {
  representedHands: finalizedHands.size,
  retainedEvents: retainedEvents,
  processedFrames: processedFrames.inspect(),
  walkTraces: walkTraces.inspect(),
  mappingHistory: mappingHistory.inspect(),
  overlayFailures: overlayFailures.inspect(),
  sessionCache: cacheApi.inspect(cache),
  persistence: runtime.inspectPersistence(planner),
  pendingBinary: binary.inspect()
};
assert.strictEqual(report.retainedEvents, 60000, 'the authoritative retained event count remains intentionally proportional to Session history');
assert.strictEqual(report.processedFrames.size, 1000);
assert.strictEqual(report.walkTraces.size, 100);
assert.strictEqual(report.mappingHistory.size, 100);
assert.strictEqual(report.overlayFailures.size, 200);
assert.ok(report.sessionCache.size <= 256);
assert.strictEqual(report.pendingBinary.pendingPacketCount, 0);
assert.strictEqual(report.pendingBinary.pendingBytes, 0);
assert.ok(report.pendingBinary.quarantineCount <= 32);
console.log('STABILIZATION_B_SOAK ' + JSON.stringify(report));
