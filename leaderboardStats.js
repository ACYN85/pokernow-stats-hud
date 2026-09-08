/* Leaderboard column preferences layered on the shared overlay statistic registry. */
(function (root) {
  'use strict';

  var overlayStats = root.PokerOverlayStats;
  if (!overlayStats && typeof module !== 'undefined' && module.exports) overlayStats = require('./overlayStats.js');
  var VERSION = 2;
  var DEFAULTS = Object.freeze({
    version: VERSION,
    syncWithOverlay: true,
    displayedStatIds: overlayStats.DEFAULT_DISPLAYED_STAT_IDS.slice()
  });

  function normalize(stored) {
    var storedVersion = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored.version : null;
    var validObject = Boolean(storedVersion === 1 || storedVersion === VERSION);
    var syncValid = validObject && typeof stored.syncWithOverlay === 'boolean';
    var normalizedIds = overlayStats.normalizePreference(validObject ? {
      version: storedVersion === VERSION ? overlayStats.PREFERENCE_VERSION : 2,
      displayedStatIds: stored.displayedStatIds
    } : null);
    return {
      preference: {
        version: VERSION,
        syncWithOverlay: syncValid ? stored.syncWithOverlay : DEFAULTS.syncWithOverlay,
        displayedStatIds: normalizedIds.normalizedDisplayedStatIds.slice()
      },
      storedSyncWithOverlay: validObject ? stored.syncWithOverlay : null,
      storedDisplayedStatIds: normalizedIds.storedDisplayedStatIds,
      normalizedDisplayedStatIds: normalizedIds.normalizedDisplayedStatIds.slice(),
      defaultUsed: !validObject || !syncValid || normalizedIds.defaultUsed,
      invalidIdsRemoved: normalizedIds.invalidIdsRemoved.slice(),
      duplicateIdsRemoved: normalizedIds.duplicateIdsRemoved.slice(),
      migratedFromVersion: validObject && storedVersion !== VERSION ? storedVersion : null
    };
  }

  function effectiveDisplayedStatIds(preference, overlayDisplayedStatIds) {
    var normalized = normalize(preference).preference;
    if (!normalized.syncWithOverlay) return normalized.displayedStatIds.slice();
    return overlayStats.normalizePreference({
      version: overlayStats.PREFERENCE_VERSION,
      displayedStatIds: Array.isArray(overlayDisplayedStatIds) ? overlayDisplayedStatIds : []
    }).normalizedDisplayedStatIds;
  }

  function definitions(ids) {
    return overlayStats.definitionsFor(ids);
  }

  function tableLabel(definition) {
    return definition && (definition.tableLabel || definition.label || definition.shortLabel) || '';
  }

  function formatValue(definition, playerStats) {
    if (!definition) return '';
    var value = definition.getValue(playerStats || {});
    return definition.leaderboardFormatValue
      ? definition.leaderboardFormatValue(value, playerStats || {})
      : definition.formatValue(value);
  }

  var api = Object.freeze({
    VERSION: VERSION,
    DEFAULTS: DEFAULTS,
    normalize: normalize,
    effectiveDisplayedStatIds: effectiveDisplayedStatIds,
    definitions: definitions,
    tableLabel: tableLabel,
    formatValue: formatValue
  });
  root.PokerLeaderboardStats = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
