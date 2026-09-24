/* Pure presentation model for Settings → Data. */
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
  function fileName(value) { return String(value || '').split(/[\\/]/).pop() || 'Selected Career file'; }
  function portableFormat(value) { return value === 'gzip' ? 'Gzip-compressed Backup v1 JSON' : 'Backup v1 JSON'; }
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
  function restorePreviewHtml(preview) {
    if (!preview) return '';
    var candidate = preview.candidate || {}; var current = preview.current || {};
    return '<section class="pnhud-career-restore-preview" aria-labelledby="pnhud-career-restore-preview-title">' +
      '<h3 id="pnhud-career-restore-preview-title">Restore preview</h3>' +
      '<p class="pnhud-career-warning">This replaces your entire current Career history with the selected backup. Career hands recorded after that backup was created will be removed. After the restore succeeds, the current Session will also be reset.</p>' +
      '<dl class="pnhud-career-data-grid">' +
      row('Selected file', fileName(preview.fileName)) +
      row('File size', formatBytes(preview.fileBytes)) +
      row('File format', portableFormat(preview.portableFormat)) +
      row('Decoded JSON size', formatBytes(preview.decompressedBytes)) +
      row('Backup format', 'v' + Number(candidate.backupFormatVersion || 0)) +
      row('Tracking since', dateText(candidate.careerTrackingStartedAt)) +
      row('Players', Number(candidate.playerCount || 0)) +
      row('Physical records', Number(candidate.physicalRecordCount || 0)) +
      row('Logical hands', Number(candidate.activeRecordCount || 0)) +
      row('First accepted hand', dateText(candidate.firstAcceptedAt)) +
      row('Last accepted hand', dateText(candidate.latestAcceptedAt)) +
      row('Current Career logical hands', Number(current.activeRecordCount || 0)) +
      row('Quarantined', 0) +
      row('Backup digest', shortDigest(candidate.payloadDigest)) +
      row('Current career digest', shortDigest(current.payloadDigest)) +
      row('Restore mode', 'Replace current career history') + row('Session', 'Reset to 0 after successful restore') + '</dl>' +
      (candidate.players && candidate.players.length ? '<details><summary>Players in this backup (' + candidate.players.length + ')</summary><ul>' + candidate.players.map(function (player) { return '<li>' + escapeHtml(player.displayName || player.playerId) + ' — ' + escapeHtml(player.playerId) + ': ' + Number(player.hands) + ' hands</li>'; }).join('') + '</ul></details>' : '') +
      '<div class="pnhud-career-data-actions"><button type="button" class="pnhud-career-confirm-restore pnhud-destructive"' + (preview.restoring ? ' disabled' : '') + '>Restore Career Backup (Replace)</button><button type="button" class="pnhud-career-cancel-restore"' + (preview.restoring ? ' disabled' : '') + '>Cancel</button></div></section>';
  }
  function importPreviewHtml(preview) {
    if (!preview) return '';
    var summary = preview.summary || {};
    return '<section class="pnhud-career-restore-preview pnhud-career-import-preview" aria-labelledby="pnhud-career-import-preview-title">' +
      '<h3 id="pnhud-career-import-preview-title">Import preview</h3>' +
      '<p class="pnhud-career-warning">Import combines this file with current Career history. Existing local hands remain, exact duplicates count once, and Session data is unaffected.</p>' +
      '<dl class="pnhud-career-data-grid">' +
      row('Selected file', fileName(preview.fileName)) +
      row('File size', formatBytes(preview.fileBytes)) +
      row('File format', portableFormat(preview.portableFormat)) +
      row('Decoded JSON size', formatBytes(preview.decompressedBytes)) +
      row('Players in file', preview.candidate ? Number(preview.candidate.playerCount || 0) : 'Not available') +
      row('Imported logical hands', Number(summary.importedLogicalHandCount || 0)) +
      row('Already present', Number(summary.alreadyPresentLogicalHandCount || 0)) +
      row('New logical hands', Number(summary.newLogicalHandCount || 0)) +
      row('Exact duplicate records', Number(summary.exactDuplicatePhysicalRecordCount || 0)) +
      row('New physical records', Number(summary.newPhysicalRecordCount || 0)) +
      row('Conflicted / quarantined', Number(summary.conflictedLogicalHandCount || 0)) +
      row('Affected players', Number(summary.affectedPlayerCount || 0)) +
      row('Resulting logical hands', Number(summary.mergedLogicalHandCount || 0)) +
      row('Session', 'Unaffected') +
      row('Import mode', 'Merge with current Career history') + '</dl>' +
      (!preview.canImport ? '<p class="pnhud-career-warning">' + escapeHtml(preview.reason || 'This file cannot be merged safely.') + '</p>' : '') +
      '<div class="pnhud-career-data-actions"><button type="button" class="pnhud-career-confirm-import"' + (!preview.canImport || preview.importing ? ' disabled' : '') + '>Import Career Data (Merge)</button><button type="button" class="pnhud-career-cancel-import"' + (preview.importing ? ' disabled' : '') + '>Cancel</button></div></section>';
  }
  function removalPreviewHtml(preview) {
    if (!preview) return '';
    return '<section class="pnhud-career-restore-preview pnhud-career-removal-preview" aria-labelledby="pnhud-career-removal-preview-title">' +
      '<h3 id="pnhud-career-removal-preview-title">Removal preview</h3>' +
      '<p class="pnhud-career-warning">Exporting a Career Backup first is strongly recommended. This action changes Career statistics for every player in the matched hands and resets Session only after Career removal succeeds.</p>' +
      '<dl class="pnhud-career-data-grid">' +
      row('Session hands retained', Number(preview.sessionHandCount || 0)) +
      row('Session hands matched to Career', Number(preview.matchedSessionHandCount || 0)) +
      row('Session hands not in Career', Number(preview.unmatchedSessionHandCount || 0)) +
      row('Career logical hands to remove', Number(preview.logicalHandCount || 0)) +
      row('Career physical records to remove', Number(preview.physicalRecordCount || 0)) +
      row('Affected players', Number(preview.affectedPlayerCount || 0)) + '</dl>' +
      '<div class="pnhud-career-data-actions"><button type="button" class="pnhud-career-confirm-removal pnhud-destructive"' + (preview.removing ? ' disabled' : '') + '>Remove Career Hands &amp; Reset Session</button><button type="button" class="pnhud-career-cancel-removal"' + (preview.removing ? ' disabled' : '') + '>Cancel</button></div></section>';
  }
  function messageHtml(state) {
    return '<p class="pnhud-career-data-message pnhud-career-data-message-' + escapeHtml(state.messageKind || 'none') + '" role="status" aria-live="polite">' + escapeHtml(state.message || '') + '</p>';
  }
  function resultHtml(result) {
    if (!result) return '';
    var summary = result.summary;
    return '<section class="pnhud-career-result" tabindex="-1" role="status" aria-live="polite"><h3>' + (result.mode === 'merge' ? 'Import complete' : 'Restore complete') + '</h3><dl class="pnhud-career-data-grid">' +
      row('Selected file', fileName(result.fileName)) +
      (result.mode === 'merge' ? row('New logical hands added', summary.newLogicalHandCount) + row('Already present', summary.alreadyPresentLogicalHandCount) + row('Conflicted/rejected', summary.conflictedLogicalHandCount) + row('Affected players', summary.affectedPlayerCount) : row('Logical hands restored', summary.activeRecordCount) + row('Players restored', summary.playerCount)) +
      row('Session', result.mode === 'merge' ? 'Unaffected' : 'Reset to 0') + '</dl></section>';
  }
  function flowMessage(state, flow) { return state.activeFlow === flow ? messageHtml(state) + resultHtml(state.result) : ''; }
  function render(info, state) {
    state = state || {}; var status = health(info, state.summaryError);
    var ready = Boolean(info && info.ready); var sessionHandCount = Math.max(0, Number(state.sessionHandCount || 0));
    var removalFlowActive = Boolean(state.removalFlowActive || state.removalPreview);
    var transferFlowActive = state.activeFlow === 'transfer' || Boolean(state.importPreview);
    var recoveryFlowActive = state.activeFlow === 'recovery' || Boolean(state.preview);
    return '<div class="pnhud-career-data-card"><div class="pnhud-career-data-health pnhud-career-data-health-' + status.key + '"><strong>' + escapeHtml(status.label) + '</strong><span>' + escapeHtml(status.description) + '</span></div>' +
      '<dl class="pnhud-career-data-grid">' +
      row('Career tracking', ready ? 'Active' : 'Unavailable') +
      row('Tracking since', dateText(info && info.careerTrackingStartedAt)) +
      row('Players tracked', Number(info && info.playerCount || 0)) +
      row('Career hand records', Number(info && info.physicalRecordCount || 0)) +
      row('Active logical hands', Number(info && info.activeRecordCount || 0)) +
      row('Estimated decoded JSON size', info && info.backupSizePolicy ? formatBytes(info.backupSizePolicy.estimatedBytes) : 'Not available') +
      row('Decoded JSON safety limit', info && info.backupSizePolicy ? formatBytes(info.backupSizePolicy.maximumSupportedBytes) : '64.0 MiB') +
      row('Conservative record preflight', info && info.backupSizePolicy ? Number(info.backupSizePolicy.maximumPhysicalRecordCount || 0).toLocaleString() + ' physical records' : 'Not available') +
      row('Backend', info && (info.backend === 'extension-service-worker-indexeddb' || info.backend === 'indexeddb') ? 'IndexedDB' : 'Unavailable') +
      row('Database status', ready ? 'Ready' : 'Attention needed') +
      row('Storage schema', info && info.storageSchemaVersion ? 'v' + info.storageSchemaVersion : 'Unknown') +
      row('Backup format', 'v1') +
      row('Last accepted hand', dateText(info && info.latestAcceptedAt)) +
      row('Quarantined hands', Number(info && info.quarantinedHandCount || 0)) + '</dl></div>' +
      '<section class="pnhud-career-data-group"><h3>Session</h3><p>Clear this room\'s retained Session statistics, lifecycle state, and manual seat positions. Career history, notes, tracked-player metadata, and HUD settings are kept.</p><div class="pnhud-career-data-actions"><button type="button" class="pnhud-data-reset-session"' + (state.busy ? ' disabled' : '') + '>Reset Session</button></div></section>' +
      '<section class="pnhud-career-data-group"><h3>Career</h3><p>Remove exact Career logical hands proven to belong to the currently retained Session, for every participant, then reset Session.</p><div class="pnhud-career-data-actions"><button type="button" class="pnhud-career-remove-session pnhud-destructive"' + (!ready || state.busy || !sessionHandCount ? ' disabled' : '') + '>Remove Current Session from Career &amp; Reset</button></div>' + (removalFlowActive ? flowMessage(state, 'removal') + removalPreviewHtml(state.removalPreview) : '') + '</section>' +
      '<section class="pnhud-career-data-group"><h3>Transfer</h3><p>Move or combine Career history between installations. Exports use compact gzip; existing Backup v1 JSON remains supported. Session data is not included.</p><div class="pnhud-career-data-actions"><button type="button" class="pnhud-career-export"' + (!ready || state.busy ? ' disabled' : '') + '>Export Career Data</button><button type="button" class="pnhud-career-import-select"' + (!ready || state.busy ? ' disabled' : '') + '>Import Career Data</button><input class="pnhud-career-import-file-input pnhud-visually-hidden" type="file" accept="application/gzip,application/json,.gz,.json,.json.gz" aria-label="Select compressed or JSON Career data file to merge"></div>' + (transferFlowActive ? flowMessage(state, 'transfer') + importPreviewHtml(state.importPreview) : '') + '</section>' +
      '<section class="pnhud-career-data-group"><h3>Advanced Recovery</h3><p>Replace current Career history with a previously exported compressed or JSON snapshot. After a successful replacement, the current Session is reset.</p><div class="pnhud-career-data-actions"><button type="button" class="pnhud-career-restore-select"' + (!ready || state.busy ? ' disabled' : '') + '>Restore Career Backup (Replace)</button><input class="pnhud-career-restore-file-input pnhud-visually-hidden" type="file" accept="application/gzip,application/json,.gz,.json,.json.gz" aria-label="Select compressed or JSON Career backup file to replace current history"></div>' + (recoveryFlowActive ? flowMessage(state, 'recovery') + restorePreviewHtml(state.preview) : '') + '</section>' +
      (!removalFlowActive && !transferFlowActive && !recoveryFlowActive ? messageHtml(state) : '');
  }
  function exportFileName(date) {
    var value = date instanceof Date ? date : new Date(date || Date.now());
    var stamp = value.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
    return 'pokernow-hud-career-data-' + stamp + '.json.gz';
  }
  function errorMessage(error) {
    var text = String(error && error.message || error || '');
    if (error && /SIZE_LIMIT/.test(String(error.code || '')) || /exceeds the (?:V1 supported|supported decompressed|supported compressed) size/i.test(text)) return text + (/database remains intact/i.test(text) ? '' : ' The career database remains intact.');
    if (error && error.code === 'CAREER_PORTABLE_API_UNAVAILABLE') return text;
    if (error && error.code === 'CAREER_PORTABLE_GZIP_INVALID' || /gzip data is invalid|gzip data is invalid or truncated/i.test(text)) return 'Compressed Career data is invalid, damaged, or truncated. Nothing was changed.';
    if (/current-digest-bound|Current Session changed/i.test(text)) return 'Career or Session data changed since the removal preview. Nothing was removed; preview the action again.';
    if (/Session removal|hand provenance|ambiguous/i.test(text)) return text || 'Current Session cannot be matched to Career safely.';
    if (/changed|current digest|candidate-and-current/i.test(text)) return 'Career history changed since this file was previewed. Please preview the action again.';
    if (/cannot be merged safely|conflicts with the current authoritative/i.test(text)) return 'This Career data conflicts with current history and cannot be merged safely. Nothing was changed.';
    if (/unsupported.*version/i.test(text)) return 'Unsupported backup version.';
    if (/digest|integrity/i.test(text)) return 'Backup integrity check failed.';
    if (/JSON|backup|record|schema|fingerprint|namespace|semantic|supersession|player/i.test(text)) return 'Invalid career backup.';
    return 'Career data operation failed.';
  }

  function formatBytes(value) {
    value = Number(value);
    if (!Number.isFinite(value) || value < 0) return 'Not available';
    if (value < 1024) return Math.floor(value) + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KiB';
    return (value / (1024 * 1024)).toFixed(1) + ' MiB';
  }

  return Object.freeze({ dateText: dateText, shortDigest: shortDigest, fileName: fileName, formatBytes: formatBytes, health: health, render: render, exportFileName: exportFileName, errorMessage: errorMessage });
});
