/* Backup v2 transport only. No restore, graph union, or database writes. */
(function (root, factory) {
  'use strict';
  var backup = root.PokerCareerBackup, aggregator = root.PokerCareerStatsAggregator;
  if (typeof module !== 'undefined' && module.exports) { backup = require('./careerBackup.js'); aggregator = require('./careerStatsAggregator.js'); }
  var api = factory(backup, aggregator, root.crypto);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerCareerBackupV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (V1, A, crypto) {
  'use strict';
  var MAX_FRAME_BYTES = 4 * 1024 * 1024, MAX_RECORD_BYTES = 1024 * 1024, MAX_RECORDS = 512;
  // Leaves room for index/count, two hashes, frame grammar and newline even at MAX_SAFE_INTEGER.
  var MAX_PAYLOAD_BYTES = MAX_FRAME_BYTES - 512;
  var encoder = new TextEncoder();
  var BOUNDARY = ['careerSchemaInitializedAt', 'careerTrackingStartedAt', 'firstAcceptedAt', 'firstAcceptedHandKey', 'initializedByBuildId', 'latestAcceptedAt'];
  function fail(message, code) { var e = new TypeError(message); e.code = code || 'CAREER_BACKUP_V2_INVALID'; throw e; }
  function count(n) { if (!Number.isSafeInteger(n) || n < 0) fail('Invalid safe integer count'); return n; }
  function exact(o, keys) { if (!o || Array.isArray(o) || typeof o !== 'object' || Object.keys(o).sort().join('|') !== keys.slice().sort().join('|')) fail('Incomplete or unsupported frame fields'); }
  function bytes(text) { return encoder.encode(text).byteLength; }
  // Bound traversal BEFORE canonical copying/stringification. A malicious huge string/object
  // cannot create another history-sized string. Strings are measured in bounded slices.
  function preflight(value, limit) {
    var budget = 0, nodes = 0, ancestors = new Set();
    function add(n) { budget += n; if (budget > limit) fail('Unsupported/pathological record or frame size', 'CAREER_BACKUP_V2_RECORD_SIZE'); }
    function string(s) {
      if (s.length > limit) fail('Unsupported/pathological string size', 'CAREER_BACKUP_V2_RECORD_SIZE');
      for (var i = 0; i < s.length;) {
        var end = Math.min(s.length, i + 4096), last = s.charCodeAt(end - 1), next = s.charCodeAt(end);
        if (end < s.length && last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
        add(bytes(s.slice(i, end))); i = end;
      }
    }
    function visit(v, depth) {
      if (++nodes > limit || depth > 32) fail('Unsupported record nesting/complexity');
      add(1);
      if (typeof v === 'string') { string(v); return; }
      if (v === null || typeof v === 'boolean') return;
      if (typeof v === 'number') { if (!Number.isFinite(v)) fail('Nonfinite JSON number'); return; }
      if (!v || typeof v !== 'object' || ancestors.has(v)) fail('Unsupported JSON value');
      ancestors.add(v);
      if (Array.isArray(v)) v.forEach(function (x) { visit(x, depth + 1); });
      else Object.keys(v).forEach(function (k) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') fail('Unsupported JSON member'); string(k); visit(v[k], depth + 1); });
      ancestors.delete(v);
    }
    visit(value, 0);
  }
  function boundedCanonical(value, limit) { preflight(value, limit); var text = V1.canonicalStringify(value); if (bytes(text) > limit) fail('Unsupported/pathological record or frame size', 'CAREER_BACKUP_V2_RECORD_SIZE'); return text; }
  function recordText(record) {
    var text = boundedCanonical(record, MAX_RECORD_BYTES);
    V1.validatePortableRecord(record, 0);
    // V1 validates counters as integers; v2 additionally rejects unsafe numeric values.
    function numbers(v) { if (typeof v === 'number' && !Number.isSafeInteger(v)) fail('Unsafe record number'); if (v && typeof v === 'object') Object.values(v).forEach(numbers); }
    numbers(record);
    return text;
  }
  function boundary(metadata) {
    var out = {}; BOUNDARY.forEach(function (k) { out[k] = metadata[k] === undefined ? (k === 'initializedByBuildId' ? '' : null) : metadata[k]; });
    validateBoundary(out); return out;
  }
  function validateBoundary(m) {
    exact(m, BOUNDARY); boundedCanonical(m, 16 * 1024);
    count(m.careerTrackingStartedAt); count(m.careerSchemaInitializedAt);
    ['firstAcceptedAt', 'latestAcceptedAt'].forEach(function (k) { if (m[k] !== null) count(m[k]); });
    if (typeof m.initializedByBuildId !== 'string' || (m.firstAcceptedHandKey !== null && typeof m.firstAcceptedHandKey !== 'string')) fail('Invalid portable boundary');
    if ((m.firstAcceptedHandKey === null) !== (m.firstAcceptedAt === null) || (m.firstAcceptedAt === null) !== (m.latestAcceptedAt === null) || (m.firstAcceptedAt !== null && (m.firstAcceptedAt < m.careerTrackingStartedAt || m.latestAcceptedAt < m.firstAcceptedAt))) fail('Inconsistent portable boundary');
  }
  async function hash(text) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))).map(function (n) { return n.toString(16).padStart(2, '0'); }).join(''); }
  function header(metadata) { return { type: 'header', backupFormat: V1.FORMAT, backupFormatVersion: 2, recordSchemaVersion: A.RECORD_SCHEMA_VERSION,
    codec: 'canonical-jsonl-sha256-chain-1', order: 'fingerprint-idb-ascending', portabilityPolicyVersion: 1,
    semanticVersionPolicy: { current: A.CURRENT_SEMANTIC_VERSIONS, supported: A.SUPPORTED_SEMANTIC_VERSIONS }, careerMetadata: boundary(metadata) }; }
  function validateHeader(h) {
    exact(h, ['type', 'backupFormat', 'backupFormatVersion', 'recordSchemaVersion', 'codec', 'order', 'portabilityPolicyVersion', 'semanticVersionPolicy', 'careerMetadata']);
    if (h.type !== 'header' || V1.canonicalStringify(h) !== V1.canonicalStringify(header(h.careerMetadata))) fail('Unsupported or modified header');
  }
  async function initial(h) { return hash('PNHUD-Backup-v2/header\n' + V1.canonicalStringify(h) + '\n'); }
  async function advance(previous, index, n, digest) { return hash('PNHUD-Backup-v2/chunk\n' + previous + '\n' + index + '\n' + n + '\n' + digest + '\n'); }
  function payload(index, texts) { return '{"index":' + index + ',"recordCount":' + texts.length + ',"records":[' + texts.join(',') + ']}'; }
  async function chunk(index, texts, previous) {
    if (!texts.length || texts.length > MAX_RECORDS) fail('Invalid chunk population');
    var p = payload(count(index), texts); if (bytes(p) > MAX_PAYLOAD_BYTES) fail('Chunk payload too large');
    var digest = await hash(p), chain = await advance(previous, index, texts.length, digest);
    var text = '{"chain":"' + chain + '","digest":"' + digest + '","index":' + index + ',"recordCount":' + texts.length + ',"records":[' + texts.join(',') + '],"type":"chunk"}\n';
    if (bytes(text) > MAX_FRAME_BYTES) fail('Chunk frame too large');
    return { text: text, chain: chain };
  }
  function footer(chunks, records, chain, headerDigest) { return { type: 'footer', totalChunks: count(chunks), totalPhysicalRecords: count(records), finalChain: chain, headerDigest: headerDigest }; }
  // Page boundaries never define chunk boundaries. Producer admits only bounded pages.
  async function encode(metadata, records, write, finalize, signal, progress, observeBuffer) {
    var h = header(metadata), start = await initial(h), chain = start, texts = [], size = 0, last = null, inFlight = 0, foundFirst = false;
    var metrics = { physicalRecords: 0, chunks: 0, uncompressedBytes: 0, maxFrameBytes: 0, maxRecordsPerFrame: 0, maxFramesInFlight: 0, serializationHashMs: 0 };
    function check() { if (signal && signal.aborted) fail('Export canceled; delete the incomplete file.', 'CAREER_BACKUP_V2_CANCELED'); }
    async function output(text) {
      check(); var n = bytes(text); metrics.maxFrameBytes = Math.max(metrics.maxFrameBytes, n);
      metrics.maxFramesInFlight = Math.max(metrics.maxFramesInFlight, ++inFlight);
      try { await write(encoder.encode(text)); } finally { inFlight--; }
      metrics.uncompressedBytes += n; check();
    }
    async function flush() {
      if (!texts.length) return; check(); var t = performance.now(), c = await chunk(metrics.chunks, texts, chain); metrics.serializationHashMs += performance.now() - t;
      await output(c.text); chain = c.chain; metrics.physicalRecords = count(metrics.physicalRecords + texts.length); metrics.chunks++;
      metrics.maxRecordsPerFrame = Math.max(metrics.maxRecordsPerFrame, texts.length); texts = []; size = 0;
      if (progress) await progress(Object.assign({}, metrics));
    }
    await output(V1.canonicalStringify(h) + '\n');
    for await (var record of records) {
      check(); var t = performance.now(), text = recordText(record); metrics.serializationHashMs += performance.now() - t;
      if (last !== null && !(last < record.fingerprint)) fail('Physical fingerprint order is not strictly increasing'); last = record.fingerprint;
      if (record.handKey === h.careerMetadata.firstAcceptedHandKey) foundFirst = true;
      var n = bytes(text);
      // Conservative 128-byte payload grammar reserve. Split rule is independent of pages.
      if (texts.length && (texts.length === MAX_RECORDS || size + n + texts.length + 128 > MAX_PAYLOAD_BYTES)) await flush();
      texts.push(text); size += n; if (observeBuffer) observeBuffer(texts.length);
    }
    if (((metrics.physicalRecords + texts.length) === 0) !== (h.careerMetadata.firstAcceptedHandKey === null)) fail('Boundary population mismatch');
    if ((metrics.physicalRecords + texts.length) && !foundFirst) fail('First accepted hand is absent');
    await flush(); check();
    // Source owner locks routing/authority only during this final footer + sink close.
    await finalize(async function () { check(); await output(V1.canonicalStringify(footer(metrics.chunks, metrics.physicalRecords, chain, start)) + '\n'); });
    return metrics;
  }
  async function* lines(source, metrics) {
    // Byte-level LF framing. Never concatenate a history-sized input chunk/string.
    var buffer = new Uint8Array(MAX_FRAME_BYTES), used = 0;
    for await (var input of source) {
      if (!(input instanceof Uint8Array)) fail('Validator requires byte chunks');
      for (var offset = 0; offset < input.length;) {
        var end = input.indexOf(10, offset), stop = end < 0 ? input.length : end;
        var n = stop - offset;
        if (used + n + 1 > MAX_FRAME_BYTES) fail('Frame byte limit exceeded');
        buffer.set(input.subarray(offset, stop), used); used += n;
        if (end >= 0) {
          if (metrics) { metrics.maxDecodedFrameBytes = Math.max(metrics.maxDecodedFrameBytes || 0, used + 1); metrics.decodedLogicalBytes = (metrics.decodedLogicalBytes || 0) + used + 1; }
          if (!used) fail('Empty JSON line');
          var text; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, used)); } catch (_) { fail('Invalid UTF-8'); }
          yield text; used = 0; offset = end + 1;
        } else offset = stop;
      }
    }
    if (used) fail('Partial final JSON line / missing LF');
  }
  async function validate(source, options) {
    options = options || {};
    if (options.gzip) { if (!source.pipeThrough) fail('Gzip validator requires ReadableStream'); source = source.pipeThrough(new DecompressionStream('gzip')); }
    var h = null, chain, headerDigest, chunks = 0, records = 0, last = null, complete = false, foundFirst = false;
    for await (var text of lines(source, options.metrics)) {
      if (complete) fail('Data follows footer');
      var f; try { f = JSON.parse(text); } catch (_) { fail('Malformed JSON frame'); }
      // Mandatory exact canonical spelling makes duplicate members detectable, including
      // escaped-equivalent names and nested duplicates: parse+reserialize cannot equal input.
      if (boundedCanonical(f, MAX_FRAME_BYTES) !== text) fail('Noncanonical JSON or duplicate member');
      if (!h) { validateHeader(f); h = f; chain = headerDigest = await initial(h); if (options.onHeader) await options.onHeader(h); continue; }
      if (f.type === 'chunk') {
        exact(f, ['type', 'index', 'recordCount', 'records', 'digest', 'chain']);
        if (count(f.index) !== chunks || !Array.isArray(f.records) || count(f.recordCount) !== f.records.length || !f.recordCount || f.recordCount > MAX_RECORDS) fail('Invalid chunk order/count');
        var texts = f.records.map(function (r) { var t = recordText(r); if (r.handKey === h.careerMetadata.firstAcceptedHandKey) foundFirst = true; if (last !== null && !(last < r.fingerprint)) fail('Physical fingerprint order is not strictly increasing'); last = r.fingerprint; return t; });
        var c = await chunk(chunks, texts, chain);
        if (c.text !== text + '\n') fail('Chunk digest or chain mismatch');
        chain = c.chain; chunks++; records = count(records + f.recordCount);
        if (options.onRecords) await options.onRecords(f.records, f.index, { digest: f.digest, chain: f.chain,
          recordCount: f.recordCount, firstFingerprint: f.records[0].fingerprint, lastFingerprint: f.records[f.records.length - 1].fingerprint });
      } else if (f.type === 'footer') {
        exact(f, ['type', 'totalChunks', 'totalPhysicalRecords', 'finalChain', 'headerDigest']);
        if (V1.canonicalStringify(f) !== V1.canonicalStringify(footer(chunks, records, chain, headerDigest))) fail('Footer counts or digest mismatch');
        if ((records === 0) !== (h.careerMetadata.firstAcceptedHandKey === null)) fail('Boundary population mismatch');
        if (records && !foundFirst) fail('First accepted hand is absent');
        complete = true;
      } else fail('Unexpected frame type');
    }
    if (!complete) fail('Missing required footer');
    return { valid: true, totalChunks: chunks, totalPhysicalRecords: records, finalChain: chain, headerDigest: headerDigest };
  }
  return Object.freeze({ MAX_FRAME_BYTES: MAX_FRAME_BYTES, MAX_RECORD_BYTES: MAX_RECORD_BYTES, MAX_RECORDS: MAX_RECORDS,
    MAX_PAYLOAD_BYTES: MAX_PAYLOAD_BYTES, boundary: boundary, recordText: recordText, encode: encode, validate: validate,
    header: header, initial: initial, advance: advance, chunk: chunk, footer: footer, hash: hash });
});
