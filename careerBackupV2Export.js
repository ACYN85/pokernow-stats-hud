/* Bounded local DB5 -> codec -> optional gzip -> file pipeline. */
(function (root, factory) {
  'use strict';
  var api = factory(root.PokerCareerIndexedStore, root.PokerCareerBackupV2);
  if (typeof module !== 'undefined' && module.exports) api = factory(require('./careerIndexedStore.js'), require('./careerBackupV2.js'));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerCareerBackupV2Export = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Indexed, Codec) {
  'use strict';
  async function run(handle, options) {
    options = options || {};
    var signal = options.signal, source, file, writer, pipeDone, fileBytes = 0, writeMs = 0, compressionWriteMs = 0, maxOutputWriteBytes = 0;
    var start = performance.now(), token, maxBufferedRecords = 0, producerRecords = 0;
    function check() { if (signal && signal.aborted) { var e = new Error('Export canceled; delete the incomplete file.'); e.code = 'CAREER_BACKUP_V2_CANCELED'; throw e; } }
    function progress(state, m) { if (options.onProgress) return options.onProgress(Object.assign({ status: state, fileBytes: fileBytes }, m || {})); }
    try {
      await progress('preparing'); check();
      source = await Indexed.createBackupV2Source(indexedDB, Codec); token = await source.capture(); check();
      try { file = await handle.createWritable(); } catch (e) {
        // DOMException.code/message are readonly. Preserve the native cause instead
        // of decorating it; cancellation can also arrive as a DOMException.
        var writableError = new Error((e.name === 'NotAllowedError' ? 'File permission denied while opening output: ' : 'Could not open writable file: ') + e.message);
        writableError.code = 'CAREER_BACKUP_V2_WRITABLE_FAILED'; writableError.cause = e; throw writableError;
      }
      check();
      var sink = new WritableStream({
        write: async function (bytes) { var t = performance.now(); check(); await file.write(bytes); writeMs += performance.now() - t; fileBytes += bytes.length; maxOutputWriteBytes = Math.max(maxOutputWriteBytes, bytes.length); },
        close: async function () { check(); await file.close(); },
        abort: function (reason) { return file.abort(reason); }
      }, { highWaterMark: 1 });
      if (options.gzip !== false) {
        var compressor = new CompressionStream('gzip'); writer = compressor.writable.getWriter();
        pipeDone = compressor.readable.pipeTo(sink, { signal: signal }); pipeDone.catch(function () {});
      } else {
        var passthrough = new TransformStream(undefined, { highWaterMark: 1 }, { highWaterMark: 0 }); writer = passthrough.writable.getWriter();
        pipeDone = passthrough.readable.pipeTo(sink, { signal: signal }); pipeDone.catch(function () {});
      }
      async function* records() {
        var after = null;
        while (true) {
          check(); var page = await source.page(token, after); check();
          // At most one producer page plus one <=512-record serializer buffer.
          producerRecords = page.records.length;
          for (var r of page.records) { check(); yield r; }
          after = page.after;
          if (page.exhausted) return;
          // Release the prior producer page before admitting its successor.
          page.records = []; page = null; producerRecords = 0;
        }
      }
      var result = await Codec.encode(token.careerMetadata, records(), async function (bytes) { check(); var t = performance.now(); await writer.write(bytes); compressionWriteMs += performance.now() - t; },
        function (footer) { return source.finalize(token, async function () { await progress('finalizing'); check(); await footer(); check(); var t = performance.now(); await writer.close(); await pipeDone; compressionWriteMs += performance.now() - t; }); },
        signal, function (metrics) { return progress('exporting', metrics); }, function (buffered) {
          maxBufferedRecords = Math.max(maxBufferedRecords, producerRecords + buffered);
        });
      result = Object.assign(result, source.metrics, { fileBytes: fileBytes, maxOutputWriteBytes: maxOutputWriteBytes,
        maxBufferedRecordSlots: maxBufferedRecords, maxWorkerPageQueueDepth: 1, writeMs: writeMs, compressionWriteMs: compressionWriteMs, wallMs: performance.now() - start,
        sourceToken: token, sourceStableThroughClose: true });
      await progress('complete', result); return result;
    } catch (error) {
      // Source mismatch is never finalized. File System Access abort may discard all
      // buffered output; selected existing targets still cannot be promised preservation.
      if (writer) { try { await writer.abort(error); } catch (_) {} }
      if (pipeDone) { try { await pipeDone; } catch (_) {} }
      if (file) { try { await file.abort(error); } catch (_) {} }
      if (signal && signal.aborted) { error = new Error('Export canceled; delete the incomplete file.'); error.code = 'CAREER_BACKUP_V2_CANCELED'; }
      await progress(error.code === 'CAREER_BACKUP_V2_CANCELED' ? 'canceled' : 'failed', { error: error.message, code: error.code || error.name });
      throw error;
    } finally { if (writer) { try { writer.releaseLock(); } catch (_) {} } if (source) source.close(); }
  }
  return Object.freeze({ run: run });
});
