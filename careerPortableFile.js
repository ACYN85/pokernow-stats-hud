/* Browser-native gzip transport for canonical Career Backup v1 JSON. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerCareerPortableFile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var GZIP_FIRST_BYTE = 0x1f;
  var GZIP_SECOND_BYTE = 0x8b;

  function failure(message, code, cause) {
    var error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }
  function requireApi(name) {
    if (typeof root[name] !== 'function') throw failure('This Chrome version does not support native Career backup compression.', 'CAREER_PORTABLE_API_UNAVAILABLE');
    return root[name];
  }
  function compactBackupText(backup) {
    try { return JSON.stringify(backup) + '\n'; }
    catch (error) { throw failure('Career backup could not be serialized as JSON.', 'CAREER_PORTABLE_JSON_INVALID', error); }
  }
  function encodeText(text) { return new (requireApi('TextEncoder'))().encode(text); }
  function decodeText(bytes) {
    try { return new (requireApi('TextDecoder'))('utf-8', { fatal: true }).decode(bytes); }
    catch (error) { throw failure('Career backup is not valid UTF-8 JSON.', 'CAREER_PORTABLE_JSON_INVALID', error); }
  }
  function isGzip(bytes) { return bytes && bytes.byteLength >= 2 && bytes[0] === GZIP_FIRST_BYTE && bytes[1] === GZIP_SECOND_BYTE; }
  function normalizedLimit(value, fallback) {
    value = Number(value);
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  }
  async function collectStream(readable, maximumBytes, operation, limitKind) {
    var reader = readable.getReader();
    var chunks = []; var total = 0;
    try {
      while (true) {
        var part = await reader.read();
        if (part.done) break;
        var chunk = part.value instanceof Uint8Array ? part.value : new Uint8Array(part.value);
        total += chunk.byteLength;
        if (total > maximumBytes) {
          try { await reader.cancel(); } catch (_cancelError) {}
          throw limitKind === 'compressed-file'
            ? failure('Career backup ' + operation + ' exceeds the supported compressed file size.', 'CAREER_BACKUP_FILE_SIZE_LIMIT')
            : failure('Career backup ' + operation + ' exceeds the supported decoded JSON size.', 'CAREER_BACKUP_DECOMPRESSED_SIZE_LIMIT');
        }
        chunks.push(chunk);
      }
    } finally {
      try { reader.releaseLock(); } catch (_releaseError) {}
    }
    var combined = new Uint8Array(total); var offset = 0;
    chunks.forEach(function (chunk) { combined.set(chunk, offset); offset += chunk.byteLength; });
    return combined;
  }
  function blobStream(parts) {
    if (typeof root.Blob !== 'function') throw failure('This Chrome version cannot stream Career backup files.', 'CAREER_PORTABLE_API_UNAVAILABLE');
    return new root.Blob(parts).stream();
  }
  async function compressBackup(backup, options) {
    options = options || {};
    var maximumJsonBytes = normalizedLimit(options.maximumJsonBytes, Number.MAX_SAFE_INTEGER);
    var maximumFileBytes = normalizedLimit(options.maximumFileBytes, Number.MAX_SAFE_INTEGER);
    var text = compactBackupText(backup);
    var jsonBytes = encodeText(text);
    if (jsonBytes.byteLength > maximumJsonBytes) throw failure('Career backup export exceeds the supported decompressed JSON size.', 'CAREER_BACKUP_DECOMPRESSED_SIZE_LIMIT');
    var compressed;
    try {
      compressed = await collectStream(blobStream([jsonBytes]).pipeThrough(new (requireApi('CompressionStream'))('gzip')), maximumFileBytes, 'compressed output', 'compressed-file');
    } catch (error) {
      if (error && /^CAREER_/.test(String(error.code || ''))) throw error;
      throw failure('Career backup gzip compression failed.', 'CAREER_PORTABLE_GZIP_INVALID', error);
    }
    return Object.freeze({ bytes: compressed, format: 'gzip', mediaType: 'application/gzip', compressedBytes: compressed.byteLength, decompressedBytes: jsonBytes.byteLength });
  }
  async function firstBytes(file) {
    if (!file || typeof file.slice !== 'function') throw failure('Career backup file is unavailable.', 'CAREER_PORTABLE_FILE_INVALID');
    return new Uint8Array(await file.slice(0, 2).arrayBuffer());
  }
  async function readBackupFile(file, options) {
    options = options || {};
    var maximumFileBytes = normalizedLimit(options.maximumFileBytes, Number.MAX_SAFE_INTEGER);
    var maximumJsonBytes = normalizedLimit(options.maximumJsonBytes, Number.MAX_SAFE_INTEGER);
    var fileBytes = Number(file && file.size);
    if (!Number.isSafeInteger(fileBytes) || fileBytes < 0) throw failure('Career backup file size is unavailable.', 'CAREER_PORTABLE_FILE_INVALID');
    if (fileBytes > maximumFileBytes) throw failure('Career backup file exceeds the supported compressed file size.', 'CAREER_BACKUP_FILE_SIZE_LIMIT');
    var gzip = isGzip(await firstBytes(file));
    var stream = file.stream();
    if (gzip) {
      try { stream = stream.pipeThrough(new (requireApi('DecompressionStream'))('gzip')); }
      catch (error) { throw failure('Career backup gzip data is invalid or unsupported.', 'CAREER_PORTABLE_GZIP_INVALID', error); }
    }
    var bytes;
    try { bytes = await collectStream(stream, maximumJsonBytes, gzip ? 'decompression' : 'JSON file'); }
    catch (error) {
      if (error && /^CAREER_/.test(String(error.code || ''))) throw error;
      throw failure(gzip ? 'Career backup gzip data is invalid or truncated.' : 'Career backup file could not be read.', gzip ? 'CAREER_PORTABLE_GZIP_INVALID' : 'CAREER_PORTABLE_FILE_INVALID', error);
    }
    var text = decodeText(bytes); var backup;
    try { backup = JSON.parse(text); }
    catch (error) { throw failure('Career backup JSON is malformed.', 'CAREER_PORTABLE_JSON_INVALID', error); }
    return Object.freeze({ backup: backup, format: gzip ? 'gzip' : 'json', fileBytes: fileBytes, decompressedBytes: bytes.byteLength });
  }

  return Object.freeze({
    GZIP_MAGIC: Object.freeze([GZIP_FIRST_BYTE, GZIP_SECOND_BYTE]),
    compactBackupText: compactBackupText,
    isGzip: isGzip,
    compressBackup: compressBackup,
    readBackupFile: readBackupFile
  });
});
