/* Internal, bounded DB5 Replace/Merge staging. No v1 routing changes. */
(function (root, factory) {
  'use strict';
  var indexed = root.PokerCareerIndexedStore, aggregator = root.PokerCareerStatsAggregator, codec = root.PokerCareerBackupV2, backup = root.PokerCareerBackup;
  if (typeof module !== 'undefined' && module.exports) { indexed = require('./careerIndexedStore.js'); aggregator = require('./careerStatsAggregator.js'); codec = require('./careerBackupV2.js'); backup = require('./careerBackup.js'); }
  var api = factory(indexed, aggregator, codec, backup);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerCareerBackupV2Import = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (I, A, C, V1) {
  'use strict';
  var JOB = 'backupV2Replace', BATCH = 64, SORT_ROWS = 1024, SORT_BYTES = 4 * 1024 * 1024, FAN_IN = 32;
  var MAX_CHAIN = 1 + A.SEMANTIC_VERSION_FIELDS.reduce(function (n, field) {
    var v = A.SUPPORTED_SEMANTIC_VERSIONS[field]; return n + Math.max.apply(null, v) - Math.min.apply(null, v);
  }, 0);
  function fail(code, message) { var e = new Error(message); e.code = 'CAREER_BACKUP_V2_' + code; throw e; }
  function request(r) { return new Promise(function (resolve, reject) { r.onsuccess = function () { resolve(r.result); }; r.onerror = function () { reject(r.error); }; }); }
  function done(tx) { return new Promise(function (resolve, reject) { tx.oncomplete = resolve; tx.onabort = tx.onerror = function () { reject(tx.error || new Error('IndexedDB transaction aborted')); }; }); }
  function equal(a, b) { return V1.canonicalStringify(a) === V1.canonicalStringify(b); }
  function compare(a, b) { return a.handKey.localeCompare(b.handKey) || (a.firstFingerprint < b.firstFingerprint ? -1 : a.firstFingerprint > b.firstFingerprint ? 1 : 0); }
  async function open() {
    return new Promise(function (resolve, reject) {
      var r = indexedDB.open(I.DATABASE_NAME, I.DATABASE_VERSION), rejected = false;
      r.onupgradeneeded = function () { r.transaction.abort(); };
      r.onblocked = function () { rejected = true; reject(new Error('Career database is blocked')); };
      r.onerror = function () { reject(r.error || new Error('Initialized DB5 Career is required')); };
      r.onsuccess = function () { if (rejected) r.result.close(); else resolve(r.result); };
    });
  }
  async function prepare(file, options) {
    options = options || {};
    var mode = options.mode === undefined ? 'replace' : options.mode;
    if (!['replace', 'merge'].includes(mode)) fail('MODE', 'Unsupported import mode.');
    var merge = mode === 'merge', localProofs = 0, localHeader, localChain, mergedBoundary, noChange = false;
    var participant = options.nativeParticipant;
    var signal = options.signal, db = await open(), S = I.STORES, R = I.routing, job, header, transport, sequence = 0;
    var started = performance.now(), metrics = { batchSize: BATCH, sortRows: SORT_ROWS, sortBytes: SORT_BYTES, sortFanIn: FAN_IN,
      maxChainRecords: MAX_CHAIN, maxBufferedRecords: 0, maxPendingWriteBatches: 1, maxWorkerPageQueueDepth: 1,
      inputBytes: file.size, stagingTransactions: 0, stagingWriteMs: 0, maxStagingBatchRecords: 0, maxDecodedFrameBytes: 0, maxSortReferences: 0,
      physicalRecords: 0, activeRecords: 0, localPhysicalRecords: 0, importedPhysicalRecords: 0,
      uniqueImportedAdditions: 0, identicalDuplicates: 0, conflicts: 0,
      localCopyTransactions: 0, localCopyWriteMs: 0, phases: {}, transactionCounts: {} };
    var currentPhase = 'begin';
    function check() { if (signal && signal.aborted) fail('CANCELED', 'Canceled. No Career changes were applied.'); }
    async function progress(status) { check(); if (options.onProgress) await options.onProgress(Object.assign({ status: status }, metrics)); check(); }
    function stores(tx) { return { get records() { return tx.objectStore(R.bankStore(S.records, job.bank)); }, get metadata() { return tx.objectStore(R.bankStore(S.metadata, job.bank)); },
      get aggregates() { return tx.objectStore(R.bankStore(S.aggregates, job.bank)); }, get heads() { return tx.objectStore(R.bankStore(S.playerHeads, job.bank)); } }; }
    async function destination(tx, control) {
      if (!control || !['A', 'B'].includes(control.bank) || !control.careerGeneration) fail('DESTINATION_CHANGED', 'Career routing changed; retry Replace.');
      var m = tx.objectStore(R.bankStore(S.metadata, control.bank));
      var rows = await Promise.all([request(m.get('career')), request(m.get(I.SESSION_PROJECTION_STATE_KEY))]);
      if (!rows[0] || rows[0].migration?.state !== 'complete' || !rows[1]?.ledgerRevision) fail('DESTINATION_CHANGED', 'Initialized Career with a ledger revision is required.');
      return { bank: control.bank, careerGeneration: control.careerGeneration, ledgerRevision: rows[1].ledgerRevision, careerMetadata: C.boundary(rows[0]) };
    }
    async function transaction(families, mode, operation, publication) {
      check();
      var names = [R.controlStore, S.metadata, R.bankStore(S.metadata, 'B')];
      families.forEach(function (name) { names.push(R.bankStore(name, job.bank)); });
      var tx = db.transaction(Array.from(new Set(names)), mode), completion = done(tx); completion.catch(function () {});
      metrics.transactionCounts[currentPhase] = (metrics.transactionCounts[currentPhase] || 0) + 1;
      try {
        var control = await request(tx.objectStore(R.controlStore).get('active'));
        var owner = await request(tx.objectStore(R.controlStore).get(JOB));
        if (owner?.id !== job.id || control?.bank !== job.destination.bank || control?.careerGeneration !== job.destination.careerGeneration || control.bank === job.bank)
          fail('DESTINATION_CHANGED', 'Career or import staging ownership changed; retry import.');
        if (publication && !equal(job.destination, await destination(tx, control))) fail('DESTINATION_CHANGED', 'Career changed during import. No Career changes were applied; retry import.');
        var value = await operation(tx, owner); await completion; return value;
      } catch (e) { try { tx.abort(); } catch (_) {} await completion.catch(function () {}); throw e; }
    }
    async function phase(name, operation) { currentPhase = name; await progress(name); var t = performance.now(); var value = await operation(); metrics.phases[name] = performance.now() - t; return value; }
    async function clearFamily(name) {
      var exhausted = false;
      while (!exhausted) {
        await transaction([name], 'readwrite', function (tx) {
          return new Promise(function (resolve, reject) {
            var store = tx.objectStore(R.bankStore(name, job.bank)), n = 0, r = store.openKeyCursor();
            r.onerror = function () { reject(r.error); };
            r.onsuccess = function () { try {
              var cursor = r.result; if (!cursor) { exhausted = true; resolve(); return; }
              if (n === BATCH) { resolve(); return; } check(); store.delete(cursor.primaryKey); n++; cursor.continue();
            } catch (e) { reject(e); } };
          });
        });
      }
    }
    async function group(tx, key) {
      var rows = await request(stores(tx).records.index('handKey').getAll(IDBKeyRange.only(key), MAX_CHAIN + 1));
      if (!rows.length || rows.length > MAX_CHAIN) fail(merge ? 'MERGE_CONFLICT' : 'SEMANTIC_INVALID', 'Logical hand exceeds the supported supersession chain bound.');
      var resolved = A.resolveActiveRecords(rows.map(function (r) { return r.record; }));
      if (resolved.rejectedRecords.length || resolved.quarantinedHandKeys.length || resolved.activeRecords.length !== 1)
        fail(merge ? 'MERGE_CONFLICT' : 'SEMANTIC_INVALID', 'Invalid Career graph: ' + (resolved.rejectedRecords[0]?.reason || 'invalid active-tip structure'));
      return { rows: rows, record: resolved.activeRecords[0] };
    }
    function sourceGraph(rows) {
      if (!rows.length) return;
      var resolved = A.resolveActiveRecords(rows.map(function (r) { return r.record; }));
      if (resolved.rejectedRecords.length || resolved.quarantinedHandKeys.length || resolved.activeRecords.length !== 1)
        fail('SEMANTIC_INVALID', 'A source Career graph is incomplete or invalid.');
    }
    async function copyLocal() {
      var source = await I.createBackupV2Source(indexedDB, C), after = null;
      localHeader = C.header(job.destination.careerMetadata); localChain = await C.initial(localHeader);
      try {
        var token = await source.capture();
        if (!equal(token, job.destination)) fail('DESTINATION_CHANGED', 'Career changed before local copy.');
        while (true) {
          check(); var page = await source.page(token, after), rows = page.records;
          metrics.maxBufferedLocalRecords = Math.max(metrics.maxBufferedLocalRecords || 0, rows.length);
          metrics.maxBufferedLocalBytes = Math.max(metrics.maxBufferedLocalBytes || 0, source.metrics.maxPageBytes);
          var proof = rows.length ? await C.chunk(localProofs, rows.map(C.recordText), localChain) : null;
          for (var offset = 0; offset < rows.length; offset += BATCH) {
            var t = performance.now();
            await transaction([S.records], 'readwrite', function (tx) {
              var end = Math.min(rows.length, offset + BATCH), s = stores(tx);
              for (var i = offset; i < end; i++) { if (participant && participant.recordLocal) participant.recordLocal(rows[i]); s.records.add(I.recordWrapper(rows[i], ++sequence)); }
              if (end === rows.length) s.metadata.put({ key: ['v2LocalChunk', localProofs], recordCount: rows.length,
                firstFingerprint: rows[0].fingerprint, lastFingerprint: rows[rows.length - 1].fingerprint, chain: proof.chain });
              metrics.localCopyTransactions++; metrics.maxStagingBatchRecords = Math.max(metrics.maxStagingBatchRecords, end - offset);
            });
            metrics.localCopyWriteMs += performance.now() - t; metrics.localPhysicalRecords = sequence;
            metrics.physicalRecords = sequence; await progress('copying-local-records');
          }
          if (proof) { localChain = proof.chain; localProofs++; }
          after = page.after; if (page.exhausted) break;
        }
        // Includes the final page and detects mutations during copy cheaply.
        if (!equal(await source.capture(), token)) fail('DESTINATION_CHANGED', 'Career changed during local copy.');
        metrics.localSource = source.metrics;
      } catch (e) {
        if (e.code === 'CAREER_BACKUP_V2_SOURCE_CHANGED') fail('DESTINATION_CHANGED', 'Career changed during local copy.');
        throw e;
      } finally { source.close(); }
    }
    var runCount = 0, buffer = [], bufferBytes = 0;
    async function flushRun() {
      if (!buffer.length) return;
      buffer.sort(compare); var run = runCount++, count = buffer.length;
      for (var offset = 0; offset < count; offset += BATCH) {
        await transaction([], 'readwrite', function (tx) {
          var m = stores(tx).metadata;
          for (var i = offset; i < Math.min(count, offset + BATCH); i++) m.put({ key: ['v2Run', 0, run, i], value: buffer[i] });
          if (offset + BATCH >= count) m.put({ key: ['v2RunInfo', 0, run], count: count });
        });
      }
      buffer = []; bufferBytes = 0;
    }
    async function validateGraph() {
      var after = null, exhausted = false;
      while (!exhausted) {
        var refs = await transaction([S.records], 'readwrite', async function (tx) {
          var out = [], bytes = 0, index = stores(tx).records.index('handKey'), m = stores(tx).metadata;
          for (var i = 0; i < BATCH; i++) {
            check(); var cursor = await request(index.openKeyCursor(after === null ? undefined : IDBKeyRange.lowerBound(after, true)));
            if (!cursor) { exhausted = true; break; }
            var key = cursor.key, g = await group(tx, key), r = g.record;
            if (merge) {
              sourceGraph(g.rows.filter(function (w) { return w.sequence <= metrics.localPhysicalRecords; }));
              var imported = [];
              for (var w of g.rows) if (await request(m.get(['v2Import', w.record.fingerprint]))) imported.push(w);
              sourceGraph(imported);
            }
            var id = r.schemaVersion >= 4 && r.session.sessionId;
            if (id) {
              var witness = await request(m.get(['v2Session', id]));
              // Match the accepted catalog's strict field identity, including
              // legacy object-valued game namespaces after native cloning.
              if (witness && (witness.namespace.provider !== r.namespace.provider || witness.namespace.host !== r.namespace.host || witness.namespace.gameId !== r.namespace.gameId))
                fail(merge ? 'MERGE_CONFLICT' : 'SEMANTIC_INVALID', 'Historical Session ID collides across game namespaces.');
              if (!witness) m.put({ key: ['v2Session', id], namespace: r.namespace });
            }
            var ref = { handKey: key, fingerprint: r.fingerprint, firstFingerprint: g.rows[0].record.fingerprint, physicalCount: g.rows.length,
              revision: g.rows.find(function (w) { return w.record.fingerprint === r.fingerprint; }).sequence };
            out.push(ref); bytes += new TextEncoder().encode(JSON.stringify(ref)).length;
            after = key; metrics.activeRecords++;
            if (bytes >= SORT_BYTES) break;
          }
          return out;
        });
        for (var ref of refs) {
          var n = new TextEncoder().encode(JSON.stringify(ref)).length;
          if (buffer.length && (buffer.length === SORT_ROWS || bufferBytes + n > SORT_BYTES)) await flushRun();
          buffer.push(ref); bufferBytes += n; metrics.maxSortReferences = Math.max(metrics.maxSortReferences, buffer.length + refs.length);
        }
        await progress('validating-career');
      }
      await flushRun();
    }
    async function sortRuns() {
      var pass = 0;
      while (runCount > 1) {
        var nextCount = 0;
        for (var first = 0; first < runCount; first += FAN_IN) {
          var heads = [], counts = [], positions = [], outputIndex = 0, outputRun = nextCount++;
          await transaction([], 'readonly', async function (tx) {
            var m = stores(tx).metadata;
            for (var j = first; j < Math.min(runCount, first + FAN_IN); j++) {
              var info = await request(m.get(['v2RunInfo', pass, j])); counts.push(info.count); positions.push(0);
              heads.push((await request(m.get(['v2Run', pass, j, 0]))).value);
            }
          });
          while (heads.some(Boolean)) {
            await transaction([], 'readwrite', async function (tx) {
              var m = stores(tx).metadata;
              for (var written = 0; written < BATCH; written++) {
                check(); var best = -1;
                for (var k = 0; k < heads.length; k++) if (heads[k] && (best < 0 || compare(heads[k], heads[best]) < 0)) best = k;
                if (best < 0) break;
                m.put({ key: ['v2Run', pass + 1, outputRun, outputIndex++], value: heads[best] });
                m.delete(['v2Run', pass, first + best, positions[best]]);
                positions[best]++;
                heads[best] = positions[best] < counts[best] ? (await request(m.get(['v2Run', pass, first + best, positions[best]]))).value : null;
              }
            });
          }
          await transaction([], 'readwrite', function (tx) { stores(tx).metadata.put({ key: ['v2RunInfo', pass + 1, outputRun], count: outputIndex }); });
          await progress('sorting-authority');
        }
        pass++; runCount = nextCount;
      }
      return pass;
    }
    async function rebuild(pass, verify) {
      var position = 0, Sname = verify ? S.playerHeads : S.aggregates;
      while (position < metrics.activeRecords) {
        await transaction([S.records, Sname], 'readwrite', async function (tx) {
          var s = stores(tx), target = tx.objectStore(R.bankStore(Sname, job.bank));
          for (var i = 0; i < BATCH && position < metrics.activeRecords; i++, position++) {
            check(); var ref = (await request(s.metadata.get(['v2Run', pass, 0, position]))).value;
            var g = await group(tx, ref.handKey), record = g.record;
            if (record.fingerprint !== ref.fingerprint || g.rows.length !== ref.physicalCount) fail('STAGED_INVALID', 'Staged authority changed during reconstruction.');
            var situations = A.careerSituationMap(record);
            for (var entry of record.players) {
              var id = String(entry.playerId), previous = await request(target.get(id));
              var player = A.appendPlayer(previous && previous.player, record, entry, situations[id]);
              // Reject aggregate overflow rather than rounding valid physical counters.
              (function numeric(v) { if (typeof v === 'number' && !Number.isSafeInteger(v)) fail('SEMANTIC_INVALID', 'Aggregate exceeds safe numeric range.'); if (v && typeof v === 'object') Object.values(v).forEach(numeric); })(player);
              target.put(I.portability.cacheForPlayer(player, Math.max(previous?.revision || 0, ref.revision), (previous?.physicalRecordCount || 0) + ref.physicalCount));
            }
          }
        });
        await progress(verify ? 'rebuilding-heads' : 'rebuilding-aggregates');
      }
    }
    async function verifyHeads() {
      var after = null, exhausted = false, players = 0;
      while (!exhausted) {
        await transaction([S.aggregates, S.playerHeads], 'readwrite', async function (tx) {
          var s = stores(tx);
          for (var i = 0; i < BATCH; i++) {
            var cursor = await request(s.heads.openCursor(after === null ? undefined : IDBKeyRange.lowerBound(after, true)));
            if (!cursor) { exhausted = true; break; }
            var rebuilt = cursor.value, cache = await request(s.aggregates.get(cursor.key));
            var head = I.portability.summaryHead(cursor.key, rebuilt.revision, rebuilt.player);
            if (!equal(cache, rebuilt) || !I.portability.validCache(cache, head)) fail('STAGED_INVALID', 'Staged aggregate/head verification failed.');
            cursor.update(head); after = cursor.key; players++;
          }
        });
      }
      metrics.players = players;
    }
    async function verifyPhysical(local) {
      var h = local ? localHeader : header, chunks = local ? localProofs : transport.totalChunks;
      var chain = await C.initial(h), total = 0, previousLast = null, firstFound = false;
      // Preserve the file's validated partition. The grammar also accepts valid
      // short chunks; re-encoding with the exporter's flush policy would give a
      // different chain for the SAME physical population.
      for (var index = 0; index < chunks; index++) {
        var proof = await transaction([], 'readonly', async function (tx) { return request(stores(tx).metadata.get([local ? 'v2LocalChunk' : 'v2Chunk', index])); });
        if (!proof || (previousLast !== null && !(previousLast < proof.firstFingerprint))) fail('STAGED_INVALID', 'Staged chunk boundaries changed.');
        var texts = [], bytes = 0, after = null, exhausted = false;
        while (!exhausted) {
          await transaction([S.records], 'readonly', function (tx) {
            return new Promise(function (resolve, reject) {
              var n = 0, range = IDBKeyRange.bound(after === null ? proof.firstFingerprint : after, proof.lastFingerprint, after !== null, false);
              var s = stores(tx), r = merge && !local
                ? s.metadata.openCursor(IDBKeyRange.bound(['v2Import', after === null ? proof.firstFingerprint : after], ['v2Import', proof.lastFingerprint], after !== null, false))
                : s.records.openCursor(range);
              r.onerror = function () { reject(r.error); };
              r.onsuccess = function () { try {
                var cursor = r.result; if (!cursor) { exhausted = true; resolve(); return; }
                if (n === BATCH) { resolve(); return; }
                function consume(wrapper, key) { try {
                  if (!wrapper) fail('STAGED_INVALID', 'Staged source record is absent.');
                  if (!local || wrapper.sequence <= metrics.localPhysicalRecords) {
                    var record = wrapper.record, text = C.recordText(record);
                    if (key !== record.fingerprint) fail('STAGED_INVALID', 'Staged key/fingerprint mismatch.');
                    if (record.handKey === h.careerMetadata.firstAcceptedHandKey) firstFound = true;
                    bytes += new TextEncoder().encode(text).length;
                    if (texts.length === C.MAX_RECORDS || bytes > C.MAX_PAYLOAD_BYTES) fail('STAGED_INVALID', 'Staged chunk exceeds its bound.');
                    texts.push(text);
                  }
                  after = key; n++; cursor.continue();
                } catch (e) { reject(e); } }
                if (merge && !local) {
                  var key = cursor.key[1], lookup = s.records.get(key);
                  lookup.onerror = function () { reject(lookup.error); };
                  lookup.onsuccess = function () { consume(lookup.result, key); };
                } else consume(cursor.value, cursor.key);
              } catch (e) { reject(e); } };
            });
          });
        }
        var verified = await C.chunk(index, texts, chain);
        if (texts.length !== proof.recordCount || verified.chain !== proof.chain) fail('STAGED_INVALID', 'Staged physical chunk digest differs from input.');
        chain = verified.chain; total += texts.length; previousLast = proof.lastFingerprint;
        texts = null; await progress('verifying-physical');
      }
      if (total !== (local ? metrics.localPhysicalRecords : transport.totalPhysicalRecords) || chain !== (local ? localChain : transport.finalChain) ||
          (!local && await C.initial(header) !== transport.headerDigest) ||
          (total === 0 ? h.careerMetadata.firstAcceptedHandKey !== null : !firstFound))
        fail('STAGED_INVALID', 'Staged physical population digest differs from validated input.');
    }
    async function unionDigest() {
      var after = null, exhausted = false, total = 0;
      async function* records() {
        while (!exhausted) {
          var rows = await transaction([S.records], 'readonly', function (tx) {
            return new Promise(function (resolve, reject) {
              var out = [], size = 0, r = stores(tx).records.openCursor(after === null ? undefined : IDBKeyRange.lowerBound(after, true));
              r.onerror = function () { reject(r.error); };
              r.onsuccess = function () { try {
                var c = r.result; if (!c) { exhausted = true; resolve(out); return; }
                var text = C.recordText(c.value.record), n = new TextEncoder().encode(text).length;
                if (out.length && (out.length === BATCH || size + n + out.length + 128 > C.MAX_PAYLOAD_BYTES)) { resolve(out); return; }
                if (c.key !== c.value.record.fingerprint) fail('STAGED_INVALID', 'Union key/fingerprint mismatch.');
                out.push(c.value.record); size += n; after = c.key; c.continue();
              } catch (e) { reject(e); } };
            });
          });
          for (var r of rows) { total++; yield r; }
          await progress('verifying-union');
        }
      }
      var footerFrame = false, finalChain;
      metrics.unionEncoding = await C.encode(mergedBoundary, records(), function (bytes) {
        if (footerFrame) finalChain = JSON.parse(new TextDecoder().decode(bytes)).finalChain;
      }, function (f) { footerFrame = true; return f(); }, signal);
      if (total !== sequence) fail('STAGED_INVALID', 'Union physical count differs.');
      return { finalChain: finalChain };
    }
    async function removeScratch() {
      var exhausted = false;
      while (!exhausted) await transaction([], 'readwrite', function (tx) {
        return new Promise(function (resolve, reject) {
          var r = stores(tx).metadata.openKeyCursor(IDBKeyRange.lowerBound(['v2'])), n = 0;
          r.onerror = function () { reject(r.error); };
          r.onsuccess = function () { try {
            var cursor = r.result;
            if (!cursor || !Array.isArray(cursor.key) || !String(cursor.key[0]).startsWith('v2')) { exhausted = true; resolve(); return; }
            if (n === BATCH) { resolve(); return; } stores(tx).metadata.delete(cursor.key); n++; cursor.continue();
          } catch (e) { reject(e); } };
        });
      });
    }
    try {
      check(); var tx = db.transaction([R.controlStore, S.metadata, R.bankStore(S.metadata, 'B')], 'readwrite'), completion = done(tx); completion.catch(function () {});
      try {
        var control = await request(tx.objectStore(R.controlStore).get('active')), captured = await destination(tx, control);
        if (participant) await participant.capture(tx.objectStore(R.controlStore));
        job = { key: JOB, mode: mode, id: crypto.randomUUID(), bank: captured.bank === 'A' ? 'B' : 'A', destination: captured,
          careerGeneration: crypto.randomUUID(), ledgerRevision: crypto.randomUUID(), status: 'staging' };
        tx.objectStore(R.controlStore).put(job); await completion;
      } catch (e) { try { tx.abort(); } catch (_) {} await completion.catch(function () {}); throw e; }
      await phase('clearing-inactive', async function () { for (var family of [S.records, S.metadata, S.aggregates, S.playerHeads]) await clearFamily(family); });
      if (merge) await phase('copying-local', copyLocal);
      await phase('reading-staging', async function () {
        var magic = new Uint8Array(await file.slice(0, 2).arrayBuffer()), gzip = magic[0] === 31 && magic[1] === 139;
        // Abort propagates into the native file/decompression reader too.
        var input = file.stream().pipeThrough(new TransformStream(), { signal: signal });
        transport = await C.validate(input, { gzip: gzip, metrics: metrics,
          onHeader: async function (h) { check(); header = h; },
          onRecords: async function (records, chunkIndex, proof) {
            check(); metrics.maxBufferedRecords = Math.max(metrics.maxBufferedRecords, records.length);
            for (var offset = 0; offset < records.length; offset += BATCH) {
              var writeStarted = performance.now();
              await transaction([S.records], 'readwrite', async function (tx) {
                var end = Math.min(records.length, offset + BATCH), store = stores(tx).records;
                for (var i = offset; i < end; i++) {
                  var r = records[i], existing = merge ? await request(store.get(r.fingerprint)) : null;
                  if (participant) participant.record(r);
                  if (existing) {
                    if (C.recordText(existing.record) !== C.recordText(r)) { metrics.conflicts++; fail('MERGE_CONFLICT', 'Same physical identity has different immutable content.'); }
                    metrics.identicalDuplicates++;
                  } else { store.add(I.recordWrapper(r, ++sequence)); metrics.uniqueImportedAdditions++; }
                  if (merge) stores(tx).metadata.add({ key: ['v2Import', r.fingerprint] });
                  metrics.importedPhysicalRecords++;
                }
                if (end === records.length) stores(tx).metadata.put(Object.assign({ key: ['v2Chunk', chunkIndex] }, proof));
                metrics.stagingTransactions++; metrics.maxStagingBatchRecords = Math.max(metrics.maxStagingBatchRecords, end - offset);
              });
              metrics.stagingWriteMs += performance.now() - writeStarted;
              metrics.physicalRecords = sequence; await progress('staging-records');
            }
          } });
      });
      if (participant) await participant.verifyInput(header, transport);
      await phase('validating-career', validateGraph);
      var pass = await phase('sorting-authority', sortRuns);
      await phase('rebuilding-aggregates', function () { return rebuild(pass, false); });
      await phase('rebuilding-heads', function () { return rebuild(pass, true); });
      await phase('verifying-heads', verifyHeads);
      await phase('verifying-physical', function () { return verifyPhysical(false); });
      if (merge) await phase('verifying-local', function () { return verifyPhysical(true); });
      mergedBoundary = merge ? V1.mergedCareerMetadata(job.destination.careerMetadata, header.careerMetadata, metrics.localPhysicalRecords > 0, transport.totalPhysicalRecords > 0) : header.careerMetadata;
      C.boundary(mergedBoundary);
      if (merge && (sequence !== metrics.localPhysicalRecords + metrics.uniqueImportedAdditions || transport.totalPhysicalRecords !== metrics.identicalDuplicates + metrics.uniqueImportedAdditions))
        fail('STAGED_INVALID', 'Merge duplicate accounting differs.');
      var finalChain = merge ? (await phase('verifying-union', unionDigest)).finalChain : transport.finalChain;
      noChange = !participant && merge && metrics.uniqueImportedAdditions === 0 && equal(mergedBoundary, job.destination.careerMetadata);
      await phase('removing-scratch', removeScratch);
      var metadata = I.replacementPlan([], mergedBoundary, { backupFormatVersion: 2, payloadDigest: finalChain }).metadata;
      Object.assign(metadata, { physicalRecordCount: sequence, activeRecordCount: metrics.activeRecords, nextSequence: sequence });
      metadata.migration.copiedRecordCount = sequence;
      await transaction([S.records, S.aggregates, S.playerHeads], 'readwrite', async function (tx, owner) {
        var s = stores(tx), counts = await Promise.all([request(s.records.count()), request(s.aggregates.count()), request(s.heads.count())]);
        if (counts[0] !== sequence || counts[1] !== metrics.players || counts[2] !== metrics.players) fail('STAGED_INVALID', 'Staged family counts differ.');
        s.metadata.put(metadata); owner.status = 'ready'; owner.finalChain = finalChain; owner.headerDigest = transport.headerDigest;
        owner.physicalRecords = sequence; owner.activeRecords = metrics.activeRecords; owner.players = metrics.players;
        tx.objectStore(R.controlStore).put(owner);
      });
      metrics.prepareWallMs = performance.now() - started; await progress('ready-to-publish');
      return { preview: { mode: mode, noChange: noChange, counts: { local: metrics.localPhysicalRecords, imported: metrics.importedPhysicalRecords, additions: metrics.uniqueImportedAdditions, duplicates: metrics.identicalDuplicates, conflicts: metrics.conflicts, union: sequence },
          careerMetadata: mergedBoundary, jobId: job.id, finalChain: finalChain, destination: job.destination, bank: job.bank, careerGeneration: job.careerGeneration,
          physicalRecords: sequence, activeRecords: metrics.activeRecords, players: metrics.players }, metrics: metrics,
        close: function () { db.close(); },
        publish: async function (confirmation) {
          check(); if (!confirmation || confirmation.mode !== mode || confirmation.confirmed !== true || confirmation.expectedJobId !== job.id || confirmation.expectedFinalChain !== finalChain)
            fail('CONFIRMATION_REQUIRED', 'Explicit confirmation of this staged import is required.');
          currentPhase = 'publishing'; await progress('publishing'); var t = performance.now();
          await transaction([], 'readwrite', async function (tx, owner) {
            if (owner.status !== 'ready' || owner.mode !== mode || owner.finalChain !== finalChain) fail('STAGED_INVALID', 'Import staging is not verified.');
            var m = stores(tx).metadata, saved = await request(m.get('career'));
            if (!equal(saved, metadata)) fail('STAGED_INVALID', 'Staged Career metadata changed.');
            // Internal v3 participant writes only shared native metadata. Its
            // CAS and writes commit with this exact bank flip, never afterward.
            if (participant) await participant.publish(tx.objectStore(R.controlStore), {
              bank: job.bank, careerGeneration: job.careerGeneration, ledgerRevision: job.ledgerRevision });
            if (noChange) { owner.status = 'no-change'; tx.objectStore(R.controlStore).put(owner); return; }
            tx.objectStore(R.controlStore).put({ key: 'active', version: 1, bank: job.bank, careerGeneration: job.careerGeneration });
            m.put({ key: I.SESSION_PROJECTION_STATE_KEY, version: 1, status: 'absent', careerGeneration: job.careerGeneration, ledgerRevision: job.ledgerRevision });
            m.put({ key: I.HAND_MEMBERSHIP_STATE_KEY, version: 1, status: 'absent', careerGeneration: job.careerGeneration });
            owner.status = 'published'; tx.objectStore(R.controlStore).put(owner);
          }, true);
          metrics.publicationMs = performance.now() - t; metrics.totalWallMs = performance.now() - started;
          // No post-commit cancellation check: committed authority must never be reported as canceled.
          return { committed: !noChange, noChange: noChange, mode: mode, status: noChange ? 'NO_CHANGE' : 'PUBLISHED',
            bank: noChange ? job.destination.bank : job.bank, careerGeneration: noChange ? job.destination.careerGeneration : job.careerGeneration,
            ledgerRevision: noChange ? job.destination.ledgerRevision : job.ledgerRevision, metrics: metrics };
        } };
    } catch (e) { db.close(); if (signal?.aborted) fail('CANCELED', 'Canceled. No Career changes were applied.'); throw e; }
  }
  return Object.freeze({ prepare: prepare, MAX_CHAIN: MAX_CHAIN, BATCH: BATCH, SORT_ROWS: SORT_ROWS, SORT_BYTES: SORT_BYTES, FAN_IN: FAN_IN });
});
