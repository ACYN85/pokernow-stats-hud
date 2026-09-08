/* Bounded runtime collections for diagnostic identity and incomplete binary transport state. */
(function (root, factory) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerRuntimeBounds = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createFifoSet(maximum) {
    var max = Math.max(1, Number(maximum || 1)); var values = new Map(); var evictions = 0;
    var api = {
      add: function (value) { if (values.has(value)) values.delete(value); values.set(value, true); while (values.size > max) { values.delete(values.keys().next().value); evictions += 1; } return api; },
      has: function (value) { return values.has(value); },
      delete: function (value) { return values.delete(value); },
      clear: function () { values.clear(); },
      values: function () { return values.keys(); },
      keys: function () { return values.keys(); },
      forEach: function (callback, thisArg) { values.forEach(function (_, key) { callback.call(thisArg, key, key, api); }); },
      inspect: function () { return { size: values.size, maxEntries: max, evictions: evictions }; }
    };
    Object.defineProperty(api, 'size', { enumerable: true, get: function () { return values.size; } });
    if (typeof Symbol !== 'undefined' && Symbol.iterator) api[Symbol.iterator] = function () { return values.keys(); };
    return api;
  }

  function packetKey(metadata) { return String(metadata && metadata.direction || '') + '|' + String(metadata && metadata.socketUrl || ''); }
  function createPendingBinaryQueue(options) {
    options = options || {};
    var maxPackets = Math.max(1, Number(options.maxPackets || 16));
    var maxBytes = Math.max(1, Number(options.maxBytes || 8 * 1024 * 1024));
    var ttlMs = Math.max(1, Number(options.ttlMs || 15000));
    var maxAttachments = Math.max(1, Number(options.maxAttachments || 16));
    var maxQuarantines = Math.max(1, Number(options.maxQuarantines || 32));
    var pending = []; var pendingBytes = 0; var quarantines = new Map();
    var diagnostics = { enqueued: 0, completed: 0, rejected: 0, expired: 0, cleared: 0, peakPackets: 0, peakBytes: 0 };

    function quarantine(key, now, reason) {
      var retained = [];
      pending.forEach(function (entry) { if (entry.key === key) pendingBytes -= entry.bytes; else retained.push(entry); });
      pending = retained;
      if (quarantines.has(key)) quarantines.delete(key);
      quarantines.set(key, { expiresAt: Number(now) + ttlMs, reason: String(reason || 'binary stream failed closed') });
      while (quarantines.size > maxQuarantines) quarantines.delete(quarantines.keys().next().value);
    }
    function prune(now) {
      now = Number(now === undefined ? Date.now() : now);
      var expiredKeys = [];
      pending.forEach(function (entry) { if (now - entry.createdAt > ttlMs && !expiredKeys.includes(entry.key)) expiredKeys.push(entry.key); });
      expiredKeys.forEach(function (key) { quarantine(key, now, 'incomplete binary packet expired'); });
      diagnostics.expired += expiredKeys.length;
      Array.from(quarantines.entries()).forEach(function (entry) { if (entry[1].expiresAt < now) quarantines.delete(entry[0]); });
      return { expiredPackets: expiredKeys.length, quarantinedSocketStreams: expiredKeys.slice() };
    }
    function enqueue(packet, metadata, now) {
      now = Number(now === undefined ? Date.now() : now); prune(now);
      var key = packetKey(metadata); quarantines.delete(key);
      var expected = Number(packet && packet.attachmentsExpected || 0);
      if (!Number.isInteger(expected) || expected < 1 || expected > maxAttachments) { diagnostics.rejected += 1; quarantine(key, now, 'invalid or excessive binary attachment count'); return { accepted: false, reason: 'binary attachment count exceeds the supported bound' }; }
      if (pending.length >= maxPackets) { diagnostics.rejected += 1; quarantine(key, now, 'pending binary packet count exceeded'); return { accepted: false, reason: 'pending binary packet count exceeds the supported bound' }; }
      pending.push({ key: key, packet: packet, attachments: [], bytes: 0, createdAt: now, frameId: metadata && metadata.frameId || null });
      diagnostics.enqueued += 1; diagnostics.peakPackets = Math.max(diagnostics.peakPackets, pending.length);
      return { accepted: true, pendingPacketCount: pending.length };
    }
    function peek(metadata, now) { prune(now); var key = packetKey(metadata); return pending.find(function (entry) { return entry.key === key; }) || null; }
    function consume(decoded, byteLength, metadata, now) {
      now = Number(now === undefined ? Date.now() : now); prune(now);
      var key = packetKey(metadata); var quarantineEntry = quarantines.get(key);
      if (quarantineEntry && quarantineEntry.expiresAt >= now) { diagnostics.rejected += 1; return { status: 'rejected', reason: quarantineEntry.reason, quarantined: true }; }
      var index = pending.findIndex(function (entry) { return entry.key === key; });
      if (index < 0) { diagnostics.rejected += 1; return { status: 'rejected', reason: 'binary attachment has no pending packet header', orphan: true }; }
      var entry = pending[index]; var bytes = Math.max(0, Number(byteLength || 0));
      if (pendingBytes + bytes > maxBytes) { diagnostics.rejected += 1; quarantine(key, now, 'pending binary byte budget exceeded'); return { status: 'rejected', reason: 'pending binary byte budget exceeded', quarantined: true }; }
      entry.attachments.push(decoded); entry.bytes += bytes; pendingBytes += bytes; diagnostics.peakBytes = Math.max(diagnostics.peakBytes, pendingBytes);
      if (entry.attachments.length < entry.packet.attachmentsExpected) return { status: 'pending', received: entry.attachments.length, expected: entry.packet.attachmentsExpected };
      pending.splice(index, 1); pendingBytes -= entry.bytes; entry.packet.attachments = entry.attachments;
      diagnostics.completed += 1;
      return { status: 'complete', packet: entry.packet };
    }
    function clear() { pending = []; pendingBytes = 0; quarantines.clear(); diagnostics.cleared += 1; }
    function inspect() {
      return {
        pendingPacketCount: pending.length, pendingBytes: pendingBytes, quarantineCount: quarantines.size,
        bounds: { maxPackets: maxPackets, maxBytes: maxBytes, ttlMs: ttlMs, maxAttachments: maxAttachments, maxQuarantines: maxQuarantines },
        diagnostics: Object.assign({}, diagnostics)
      };
    }
    return Object.freeze({ enqueue: enqueue, peek: peek, consume: consume, prune: prune, clear: clear, inspect: inspect });
  }

  return Object.freeze({ createFifoSet: createFifoSet, createPendingBinaryQueue: createPendingBinaryQueue });
});
