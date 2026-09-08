/* Conservative V1 size policy for whole-ledger career backup operations. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerCareerBackupPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // The audited 10k representative ledger serialized to 36.56 MiB. V1 stays below that tested point.
  var MAX_BACKUP_BYTES = 32 * 1024 * 1024;
  var REPRESENTATIVE_BYTES_PER_RECORD = 4096;
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
      policyVersion: 1
    };
  }
  function restorePreflight(fileSize) {
    var bytes = count(fileSize);
    return { allowed: Number.isFinite(Number(fileSize)) && Number(fileSize) >= 0 && bytes <= MAX_BACKUP_BYTES, fileBytes: bytes, maximumSupportedBytes: MAX_BACKUP_BYTES, policyVersion: 1 };
  }
  function limitError(operation, preflight) {
    preflight = preflight || {};
    var isRestore = operation === 'restore';
    var actualBytes = isRestore ? preflight.fileBytes : preflight.estimatedBytes;
    var error = new RangeError(
      'Career backup ' + operation + ' exceeds the V1 supported size (' + formatBytes(actualBytes) + '; limit ' + formatBytes(MAX_BACKUP_BYTES) + '). ' +
      'The career database remains intact. Open diagnostics for record counts and size estimates.'
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
    REPRESENTATIVE_BYTES_PER_RECORD: REPRESENTATIVE_BYTES_PER_RECORD,
    FIXED_BACKUP_OVERHEAD_BYTES: FIXED_BACKUP_OVERHEAD_BYTES,
    formatBytes: formatBytes,
    exportPreflight: exportPreflight,
    restorePreflight: restorePreflight,
    limitError: limitError,
    withDiagnostics: withDiagnostics
  });
});
