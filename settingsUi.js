/* Pure settings metadata and UI-preference normalization. */
(function (root) {
  'use strict';

  var VERSION = 11;
  var SECTIONS = Object.freeze(['general', 'overlay', 'hud', 'appearance', 'career-data', 'diagnostics', 'about']);
  var HUD_SIZES = Object.freeze(['small', 'default', 'large']);
  var OPPORTUNITY_STATS_LAYOUTS = Object.freeze(['combined', 'stacked']);
  var SEAT_HUD_STAT_SOURCES = Object.freeze(['session', 'career']);
  var SIZE_PRESETS = Object.freeze({
    small: Object.freeze({ baseWidth: 136, perStatWidth: 48, minWidth: 270, maxWidth: 380 }),
    default: Object.freeze({ baseWidth: 170, perStatWidth: 64, minWidth: 320, maxWidth: 520 }),
    large: Object.freeze({ baseWidth: 200, perStatWidth: 76, minWidth: 380, maxWidth: 640 })
  });
  var ACCENT_THEMES = Object.freeze({
    teal: Object.freeze({ id: 'teal', label: 'Teal', color: '#5eead4' }),
    blue: Object.freeze({ id: 'blue', label: 'Blue', color: '#60a5fa' }),
    purple: Object.freeze({ id: 'purple', label: 'Purple', color: '#c084fc' }),
    amber: Object.freeze({ id: 'amber', label: 'Amber', color: '#fbbf24' })
  });
  var DEFAULTS = Object.freeze({
    version: VERSION,
    settingsOpen: false,
    selectedSettingsSection: 'general',
    hudOpacity: 0.96,
    settingsBackgroundOpacity: 0.96,
    dashboardBackgroundOpacity: 0.96,
    accentTheme: 'teal',
    hudSize: 'default',
    opportunityStatsLayout: 'combined',
    seatHudStatSource: 'session',
    leaderboardStatSource: 'session',
    showPlayerProfiles: true,
    showPotOdds: true,
    potOddsOffsetX: 0,
    potOddsOffsetY: 0,
    seatOverlaysEnabled: true,
    leaderboardEnabled: false,
    developerToolsVisible: false,
    leaderboardCollapsedByDefault: false
  });

  function normalize(stored) {
    var storedVersion = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored.version : null;
    var validObject = storedVersion === 1 || storedVersion === 2 || storedVersion === 3 || storedVersion === 4 || storedVersion === 5 || storedVersion === 6 || storedVersion === 7 || storedVersion === 8 || storedVersion === 9 || storedVersion === 10 || storedVersion === VERSION;
    var source = validObject ? stored : {};
    var invalidFields = [];
    function booleanField(name) {
      if (typeof source[name] === 'boolean') return source[name];
      if (Object.prototype.hasOwnProperty.call(source, name)) invalidFields.push(name);
      return DEFAULTS[name];
    }
    function offsetField(name) {
      if (typeof source[name] === 'number' && Number.isFinite(source[name]) && Math.abs(source[name]) <= 100000) return Math.round(source[name]);
      if (Object.prototype.hasOwnProperty.call(source, name)) invalidFields.push(name);
      return DEFAULTS[name];
    }
    var section = SECTIONS.includes(source.selectedSettingsSection) ? source.selectedSettingsSection : DEFAULTS.selectedSettingsSection;
    if (Object.prototype.hasOwnProperty.call(source, 'selectedSettingsSection') && section !== source.selectedSettingsSection) invalidFields.push('selectedSettingsSection');
    var opacity = typeof source.hudOpacity === 'number' && Number.isFinite(source.hudOpacity) && source.hudOpacity >= 0.1 && source.hudOpacity <= 1
      ? Math.round(source.hudOpacity * 100) / 100
      : DEFAULTS.hudOpacity;
    if (Object.prototype.hasOwnProperty.call(source, 'hudOpacity') && opacity !== source.hudOpacity) invalidFields.push('hudOpacity');
    var settingsOpacity = typeof source.settingsBackgroundOpacity === 'number' && Number.isFinite(source.settingsBackgroundOpacity)
      ? Math.round(Math.max(0.1, Math.min(1, source.settingsBackgroundOpacity)) * 100) / 100
      : DEFAULTS.settingsBackgroundOpacity;
    if (Object.prototype.hasOwnProperty.call(source, 'settingsBackgroundOpacity') && settingsOpacity !== source.settingsBackgroundOpacity) invalidFields.push('settingsBackgroundOpacity');
    var dashboardOpacity = typeof source.dashboardBackgroundOpacity === 'number' && Number.isFinite(source.dashboardBackgroundOpacity)
      ? Math.round(Math.max(0.1, Math.min(1, source.dashboardBackgroundOpacity)) * 100) / 100
      : DEFAULTS.dashboardBackgroundOpacity;
    if (Object.prototype.hasOwnProperty.call(source, 'dashboardBackgroundOpacity') && dashboardOpacity !== source.dashboardBackgroundOpacity) invalidFields.push('dashboardBackgroundOpacity');
    var accent = ACCENT_THEMES[source.accentTheme] ? source.accentTheme : DEFAULTS.accentTheme;
    if (Object.prototype.hasOwnProperty.call(source, 'accentTheme') && accent !== source.accentTheme) invalidFields.push('accentTheme');
    var size = HUD_SIZES.includes(source.hudSize) ? source.hudSize : DEFAULTS.hudSize;
    if (Object.prototype.hasOwnProperty.call(source, 'hudSize') && size !== source.hudSize) invalidFields.push('hudSize');
    var opportunityStatsLayout = OPPORTUNITY_STATS_LAYOUTS.includes(source.opportunityStatsLayout) ? source.opportunityStatsLayout : DEFAULTS.opportunityStatsLayout;
    if (Object.prototype.hasOwnProperty.call(source, 'opportunityStatsLayout') && opportunityStatsLayout !== source.opportunityStatsLayout) invalidFields.push('opportunityStatsLayout');
    var seatHudStatSource = SEAT_HUD_STAT_SOURCES.includes(source.seatHudStatSource) ? source.seatHudStatSource : DEFAULTS.seatHudStatSource;
    if (Object.prototype.hasOwnProperty.call(source, 'seatHudStatSource') && seatHudStatSource !== source.seatHudStatSource) invalidFields.push('seatHudStatSource');
    var leaderboardStatSource = ['session', 'career'].includes(source.leaderboardStatSource) ? source.leaderboardStatSource : DEFAULTS.leaderboardStatSource;
    if (Object.prototype.hasOwnProperty.call(source, 'leaderboardStatSource') && leaderboardStatSource !== source.leaderboardStatSource) invalidFields.push('leaderboardStatSource');
    var value = {
      version: VERSION,
      settingsOpen: booleanField('settingsOpen'),
      selectedSettingsSection: section,
      hudOpacity: opacity,
      settingsBackgroundOpacity: settingsOpacity,
      dashboardBackgroundOpacity: dashboardOpacity,
      accentTheme: accent,
      hudSize: size,
      opportunityStatsLayout: opportunityStatsLayout,
      seatHudStatSource: seatHudStatSource,
      leaderboardStatSource: leaderboardStatSource,
      showPlayerProfiles: booleanField('showPlayerProfiles'),
      showPotOdds: booleanField('showPotOdds'),
      potOddsOffsetX: offsetField('potOddsOffsetX'),
      potOddsOffsetY: offsetField('potOddsOffsetY'),
      seatOverlaysEnabled: booleanField('seatOverlaysEnabled'),
      leaderboardEnabled: booleanField('leaderboardEnabled'),
      developerToolsVisible: booleanField('developerToolsVisible'),
      leaderboardCollapsedByDefault: booleanField('leaderboardCollapsedByDefault')
    };
    return { value: value, defaultUsed: !validObject, migratedFromVersion: validObject && storedVersion !== VERSION ? storedVersion : null, invalidFields: invalidFields };
  }

  function equal(left, right) {
    return Object.keys(DEFAULTS).every(function (key) { return left && right && left[key] === right[key]; });
  }

  function merge(current, patch) {
    return normalize(Object.assign({}, current || DEFAULTS, patch || {}, { version: VERSION })).value;
  }

  function visibilityForMode(mode) {
    mode = ['seat-overlays-only', 'seat-overlays-leaderboard', 'leaderboard-only', 'hidden'].includes(mode) ? mode : 'seat-overlays-only';
    return {
      seatOverlaysEnabled: mode === 'seat-overlays-only' || mode === 'seat-overlays-leaderboard',
      leaderboardEnabled: mode === 'leaderboard-only' || mode === 'seat-overlays-leaderboard'
    };
  }

  function modeForVisibility(seatOverlaysEnabled, leaderboardEnabled) {
    if (seatOverlaysEnabled && leaderboardEnabled) return 'seat-overlays-leaderboard';
    if (seatOverlaysEnabled) return 'seat-overlays-only';
    if (leaderboardEnabled) return 'leaderboard-only';
    return 'hidden';
  }

  function normalizeVisibility(stored, legacyDisplayMode) {
    var source = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    var normalized = normalize(stored);
    var legacy = visibilityForMode(legacyDisplayMode);
    var seatExplicit = typeof source.seatOverlaysEnabled === 'boolean';
    var leaderboardExplicit = typeof source.leaderboardEnabled === 'boolean';
    normalized.value.seatOverlaysEnabled = seatExplicit ? source.seatOverlaysEnabled : legacy.seatOverlaysEnabled;
    normalized.value.leaderboardEnabled = leaderboardExplicit ? source.leaderboardEnabled : legacy.leaderboardEnabled;
    normalized.displayMode = modeForVisibility(normalized.value.seatOverlaysEnabled, normalized.value.leaderboardEnabled);
    normalized.explicit = { seatOverlaysEnabled: seatExplicit, leaderboardEnabled: leaderboardExplicit };
    normalized.legacyFieldsUsed = [seatExplicit ? null : 'seatOverlaysEnabled', leaderboardExplicit ? null : 'leaderboardEnabled'].filter(Boolean);
    return normalized;
  }

  var api = Object.freeze({
    VERSION: VERSION,
    SECTIONS: SECTIONS,
    HUD_SIZES: HUD_SIZES,
    OPPORTUNITY_STATS_LAYOUTS: OPPORTUNITY_STATS_LAYOUTS,
    SEAT_HUD_STAT_SOURCES: SEAT_HUD_STAT_SOURCES,
    SIZE_PRESETS: SIZE_PRESETS,
    ACCENT_THEMES: ACCENT_THEMES,
    DEFAULTS: DEFAULTS,
    normalize: normalize,
    normalizeVisibility: normalizeVisibility,
    visibilityForMode: visibilityForMode,
    modeForVisibility: modeForVisibility,
    equal: equal,
    merge: merge
  });
  root.PokerHudSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
