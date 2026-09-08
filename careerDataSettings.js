/* Pure presentation model for Settings → Career Data. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerCareerDataSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function escapeHtml(value) { return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, function (character) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]; }); }
  function dateText(value) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) return 'Not available';
    try { return new Date(Number(value)).toLocaleString(); } catch (_error) { return 'Not available'; }
  }
  function shortDigest(value) { value = String(value || ''); return value.length > 16 ? value.slice(0, 12) + '…' + value.slice(-4) : value || 'Not available'; }
  function health(info, error) {
    if (error) return { key: 'attention', label: 'Attention needed', description: 'Career database requires attention. Open diagnostics for details.' };
    var ready = Boolean(info && info.ready === true);
    var backend = info && (info.backend === 'extension-service-worker-indexeddb' || info.backend === 'indexeddb');
    var schema = info && info.storageSchemaVersion === 2;
    var migrated = info && info.migration && info.migration.state === 'complete';
    var clean = info && Number(info.quarantinedHandCount || 0) === 0;
    return ready && backend && schema && migrated && clean
      ? { key: 'healthy', label: 'Healthy', description: 'Career database is ready.' }
      : { key: 'attention', label: 'Attention needed', description: 'Career database requires attention. Open diagnostics for details.' };
  }
  function row(label, value) { return '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd></div>'; }
  function previewHtml(preview) {
    if (!preview) return '';
    var candidate = preview.candidate || {}; var current = preview.current || {};
    return '<section class="pnhud-career-restore-preview" aria-labelledby="pnhud-career-restore-preview-title">' +
      '<h3 id="pnhud-career-restore-preview-title">Restore preview</h3>' +
      '<p class="pnhud-career-warning">Restoring this backup will replace the current career history stored by this extension.</p>' +
      '<dl class="pnhud-career-data-grid">' +
      row('Backup format', 'v' + Number(candidate.backupFormatVersion || 0)) +
      row('Tracking since', dateText(candidate.careerTrackingStartedAt)) +
      row('Players', Number(candidate.playerCount || 0)) +
      row('Physical records', Number(candidate.physicalRecordCount || 0)) +
      row('Active records', Number(candidate.activeRecordCount || 0)) +
      row('Quarantined', 0) +
      row('Backup digest', shortDigest(candidate.payloadDigest)) +
      row('Current career digest', shortDigest(current.payloadDigest)) +
      row('Restore mode', 'Replace current career history') + '</dl>' +
      '<div class="pnhud-career-data-actions"><button type="button" class="pnhud-career-confirm-restore pnhud-destructive"' + (preview.restoring ? ' disabled' : '') + '>Restore Career History</button><button type="button" class="pnhud-career-cancel-restore"' + (preview.restoring ? ' disabled' : '') + '>Cancel</button></div></section>';
  }
  function render(info, state) {
    state = state || {}; var status = health(info, state.summaryError);
    var ready = Boolean(info && info.ready);
    return '<div class="pnhud-career-data-card"><div class="pnhud-career-data-health pnhud-career-data-health-' + status.key + '"><strong>' + escapeHtml(status.label) + '</strong><span>' + escapeHtml(status.description) + '</span></div>' +
      '<dl class="pnhud-career-data-grid">' +
      row('Career tracking', ready ? 'Active' : 'Unavailable') +
      row('Tracking since', dateText(info && info.careerTrackingStartedAt)) +
      row('Players tracked', Number(info && info.playerCount || 0)) +
      row('Career hand records', Number(info && info.physicalRecordCount || 0)) +
      row('Active logical hands', Number(info && info.activeRecordCount || 0)) +
      row('Estimated backup size', info && info.backupSizePolicy ? formatBytes(info.backupSizePolicy.estimatedBytes) : 'Not available') +
      row('V1 backup size limit', info && info.backupSizePolicy ? formatBytes(info.backupSizePolicy.maximumSupportedBytes) : '32.0 MiB') +
      row('Backend', info && (info.backend === 'extension-service-worker-indexeddb' || info.backend === 'indexeddb') ? 'IndexedDB' : 'Unavailable') +
      row('Database status', ready ? 'Ready' : 'Attention needed') +
      row('Storage schema', info && info.storageSchemaVersion ? 'v' + info.storageSchemaVersion : 'Unknown') +
      row('Backup format', 'v1') +
      row('Last accepted hand', dateText(info && info.latestAcceptedAt)) +
      row('Quarantined hands', Number(info && info.quarantinedHandCount || 0)) + '</dl></div>' +
      '<div class="pnhud-career-data-actions"><button type="button" class="pnhud-career-export"' + (!ready || state.busy ? ' disabled' : '') + '>Export Career Backup</button><button type="button" class="pnhud-career-restore-select"' + (!ready || state.busy ? ' disabled' : '') + '>Restore Career Backup</button><input class="pnhud-career-file-input pnhud-visually-hidden" type="file" accept="application/json,.json" aria-label="Select career backup JSON file"></div>' +
      '<p class="pnhud-career-data-message pnhud-career-data-message-' + escapeHtml(state.messageKind || 'none') + '" role="status" aria-live="polite">' + escapeHtml(state.message || '') + '</p>' + previewHtml(state.preview);
  }
  function exportFileName(date) {
    var value = date instanceof Date ? date : new Date(date || Date.now());
    var stamp = value.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
    return 'pokernow-hud-career-backup-' + stamp + '.json';
  }
  function errorMessage(error) {
    var text = String(error && error.message || error || '');
    if (error && error.code === 'CAREER_BACKUP_SIZE_LIMIT' || /exceeds the V1 supported size/i.test(text)) return text;
    if (/changed|current digest|candidate-and-current/i.test(text)) return 'Career history changed since this backup was previewed. Please preview the restore again.';
    if (/unsupported.*version/i.test(text)) return 'Unsupported backup version.';
    if (/digest|integrity/i.test(text)) return 'Backup integrity check failed.';
    if (/JSON|backup|record|schema|fingerprint|namespace|semantic|supersession|player/i.test(text)) return 'Invalid career backup.';
    return 'Career backup failed.';
  }

  function formatBytes(value) {
    value = Number(value);
    if (!Number.isFinite(value) || value < 0) return 'Not available';
    if (value < 1024) return Math.floor(value) + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KiB';
    return (value / (1024 * 1024)).toFixed(1) + ' MiB';
  }

  return Object.freeze({ dateText: dateText, shortDigest: shortDigest, formatBytes: formatBytes, health: health, render: render, exportFileName: exportFileName, errorMessage: errorMessage });
});
