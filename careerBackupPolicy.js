/* Conservative V1 size policy for whole-ledger career backup operations. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerCareerBackupPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Backup v1 remains a whole-ledger JSON operation. Gzip makes transport small,
  // but the decompressed JSON and parsed graph still need bounded memory.
  var MAX_BACKUP_BYTES = 64 * 1024 * 1024;
  var MAX_COMPRESSED_FILE_BYTES = 64 * 1024 * 1024;
  var REPRESENTATIVE_BYTES_PER_RECORD = 16 * 1024;
  var FIXED_BACKUP_OVERHEAD_BYTES = 1024 * 1024;

  function count(value) { value = Number(value); return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0; }
  function formatBytes(value) {
    value = count(value);
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KiB';
    return (value / (1024 * 1024)).toFixed(1) + ' MiB';
  }
  function exportPreflight(info) {
    info = info || {};
    var physicalRecordCount = count(info.physicalRecordCount);
    var activeRecordCount = count(info.activeRecordCount);
    var estimatedBytes = FIXED_BACKUP_OVERHEAD_BYTES + physicalRecordCount * REPRESENTATIVE_BYTES_PER_RECORD;
    return {
      allowed: estimatedBytes <= MAX_BACKUP_BYTES,
      physicalRecordCount: physicalRecordCount,
      activeRecordCount: activeRecordCount,
      estimatedBytes: estimatedBytes,
      representativeBytesPerRecord: REPRESENTATIVE_BYTES_PER_RECORD,
      fixedOverheadBytes: FIXED_BACKUP_OVERHEAD_BYTES,
      maximumSupportedBytes: MAX_BACKUP_BYTES,
      maximumCompressedFileBytes: MAX_COMPRESSED_FILE_BYTES,
      maximumPhysicalRecordCount: Math.floor((MAX_BACKUP_BYTES - FIXED_BACKUP_OVERHEAD_BYTES) / REPRESENTATIVE_BYTES_PER_RECORD),
      limitKind: 'in-memory-ledger',
      policyVersion: 1
    };
  }
  function restorePreflight(fileSize) {
    var bytes = count(fileSize);
    return { allowed: Number.isFinite(Number(fileSize)) && Number(fileSize) >= 0 && bytes <= MAX_COMPRESSED_FILE_BYTES, fileBytes: bytes, maximumSupportedBytes: MAX_COMPRESSED_FILE_BYTES, maximumDecompressedBytes: MAX_BACKUP_BYTES, limitKind: 'compressed-file', policyVersion: 1 };
  }
  function serializedBackupBytes(backup) {
    var text = JSON.stringify(backup) + '\n';
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
    return encodeURIComponent(text).replace(/%[0-9A-F]{2}|./g, 'x').length;
  }
  function serializedPreflight(backup) {
    var bytes = serializedBackupBytes(backup);
    return { allowed: bytes <= MAX_BACKUP_BYTES, fileBytes: bytes, estimatedBytes: bytes, actualSerializedBytes: bytes, maximumSupportedBytes: MAX_BACKUP_BYTES, maximumDecompressedBytes: MAX_BACKUP_BYTES, limitKind: 'decoded-json', policyVersion: 1 };
  }
  function limitError(operation, preflight) {
    preflight = preflight || {};
    var actualBytes = preflight.actualSerializedBytes === undefined ? (preflight.fileBytes === undefined ? preflight.estimatedBytes : preflight.fileBytes) : preflight.actualSerializedBytes;
    var compressedFile = preflight.limitKind === 'compressed-file';
    var error = new RangeError(compressedFile
      ? 'Career backup ' + operation + ' exceeds the supported compressed file size (' + formatBytes(actualBytes) + '; limit ' + formatBytes(preflight.maximumSupportedBytes || MAX_COMPRESSED_FILE_BYTES) + '). The career database remains intact.'
      : 'Career data is too large for this version to safely process in memory during ' + operation + ' (' + formatBytes(actualBytes) + '; supported size for in-memory processing ' + formatBytes(preflight.maximumSupportedBytes || MAX_BACKUP_BYTES) + '). The career database remains intact. Open diagnostics for record counts and size estimates.'
    );
    error.code = 'CAREER_BACKUP_SIZE_LIMIT';
    error.operation = operation;
    error.preflight = preflight;
    return error;
  }
  function withDiagnostics(info) {
    return Object.assign({}, info || {}, { backupSizePolicy: exportPreflight(info) });
  }

  return Object.freeze({
    MAX_BACKUP_BYTES: MAX_BACKUP_BYTES,
    MAX_COMPRESSED_FILE_BYTES: MAX_COMPRESSED_FILE_BYTES,
    REPRESENTATIVE_BYTES_PER_RECORD: REPRESENTATIVE_BYTES_PER_RECORD,
    FIXED_BACKUP_OVERHEAD_BYTES: FIXED_BACKUP_OVERHEAD_BYTES,
    formatBytes: formatBytes,
    exportPreflight: exportPreflight,
    restorePreflight: restorePreflight,
    serializedBackupBytes: serializedBackupBytes,
    serializedPreflight: serializedPreflight,
    limitError: limitError,
    withDiagnostics: withDiagnostics
  });
});
