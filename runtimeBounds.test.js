'use strict';

var assert = require('assert');
var bounds = require('./runtimeBounds.js');

var fifo = bounds.createFifoSet(100);
for (var index = 0; index < 1000; index += 1) fifo.add('frame-' + index);
assert.strictEqual(fifo.size, 100, 'diagnostic frame fingerprints retain only the configured recent horizon');
assert.strictEqual(fifo.has('frame-0'), false);
assert.strictEqual(fifo.has('frame-999'), true);

var queue = bounds.createPendingBinaryQueue({ maxPackets: 3, maxBytes: 32, ttlMs: 100 });
assert.strictEqual(queue.enqueue({ attachmentsExpected: 2 }, { direction: 'incoming', socketUrl: 'wss://one', frameId: 'h1' }, 0).accepted, true);
assert.strictEqual(queue.consume(new Uint8Array([1, 2]), 2, { direction: 'incoming', socketUrl: 'wss://one', frameId: 'b1' }, 10).status, 'pending');
var complete = queue.consume(new Uint8Array([3, 4]), 2, { direction: 'incoming', socketUrl: 'wss://one', frameId: 'b2' }, 20);
assert.strictEqual(complete.status, 'complete');
assert.strictEqual(complete.packet.attachments.length, 2);

queue.enqueue({ attachmentsExpected: 1 }, { direction: 'incoming', socketUrl: 'wss://expire', frameId: 'e1' }, 30);
var expired = queue.prune(131);
assert.strictEqual(expired.expiredPackets, 1, 'incomplete binary packets expire deterministically');
assert.strictEqual(queue.consume(new Uint8Array([9]), 1, { direction: 'incoming', socketUrl: 'wss://expire', frameId: 'late' }, 132).status, 'rejected', 'late attachment is quarantined rather than reinterpreted');

queue.enqueue({ attachmentsExpected: 1 }, { direction: 'incoming', socketUrl: 'wss://large', frameId: 'l1' }, 200);
assert.strictEqual(queue.consume(new Uint8Array(40), 40, { direction: 'incoming', socketUrl: 'wss://large', frameId: 'l2' }, 201).status, 'rejected', 'byte-budget overflow fails closed');

for (var packet = 0; packet < 20; packet += 1) queue.enqueue({ attachmentsExpected: 1 }, { direction: 'incoming', socketUrl: 'wss://count-' + packet, frameId: 'c' + packet }, 300 + packet);
var info = queue.inspect();
assert.ok(info.pendingPacketCount <= 3);
assert.ok(info.pendingBytes <= 32);
assert.ok(info.quarantineCount <= info.bounds.maxQuarantines);
queue.clear('session reset');
assert.deepStrictEqual([queue.inspect().pendingPacketCount, queue.inspect().pendingBytes], [0, 0]);

console.log('Bounded FIFO diagnostics and pending binary count/byte/expiry fail-closed policy passed.');
