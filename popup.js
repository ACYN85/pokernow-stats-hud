(function () {
  'use strict';
  var PNHUD_BUILD_ID = 'v1.1.0-rc3-20260913-1702';
  var PNHUD_EXTENSION_ID = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id || 'unavailable';
  console.log('[HUD BUILD] popup ' + PNHUD_BUILD_ID, { extensionId: PNHUD_EXTENSION_ID });
  var buildElement = document.getElementById ? document.getElementById('pnhud-popup-build-id') : null;
  if (buildElement) buildElement.textContent = 'Build ' + PNHUD_BUILD_ID;
  var MODE_KEY = 'pokerNowHudMode';
  var DISPLAY_MODE_KEY = 'pokerNowHudDisplayMode';
  var HUD_UI_PREFERENCES_KEY = 'hudUiPreferences';
  var DEBUG_SEAT_IDENTITY_KEY = 'pokerNowHudDebugSeatIdentity';
  var SHOW_WITHHELD_PLACEHOLDERS_KEY = 'pokerNowHudShowWithheldPlaceholders';
  var PRESENTATION_PREFERENCES_SCHEMA_KEY = 'pokerNowHudPresentationPreferencesSchema';
  var OVERLAY_DRAGGING_UNLOCKED_KEY = 'pokerNowHudOverlayDraggingUnlocked';
  var debugSeatIdentity = document.getElementById ? document.getElementById('pnhud-debug-seat-identity') : null;
  var withheldPlaceholders = document.getElementById ? document.getElementById('pnhud-show-withheld-placeholders') : null;
  if (debugSeatIdentity) {
    chrome.storage.local.get([DEBUG_SEAT_IDENTITY_KEY, SHOW_WITHHELD_PLACEHOLDERS_KEY, PRESENTATION_PREFERENCES_SCHEMA_KEY], function (saved) {
      if (saved[PRESENTATION_PREFERENCES_SCHEMA_KEY] !== 1) {
        var defaults = {};
        defaults[DEBUG_SEAT_IDENTITY_KEY] = false;
        defaults[SHOW_WITHHELD_PLACEHOLDERS_KEY] = false;
        defaults[PRESENTATION_PREFERENCES_SCHEMA_KEY] = 1;
        chrome.storage.local.set(defaults);
        debugSeatIdentity.checked = false;
        if (withheldPlaceholders) withheldPlaceholders.checked = false;
        return;
      }
      debugSeatIdentity.checked = Boolean(saved[DEBUG_SEAT_IDENTITY_KEY]);
    });
    debugSeatIdentity.addEventListener('change', function () { var update = {}; update[DEBUG_SEAT_IDENTITY_KEY] = Boolean(debugSeatIdentity.checked); chrome.storage.local.set(update); });
  }
  if (withheldPlaceholders) {
    chrome.storage.local.get(SHOW_WITHHELD_PLACEHOLDERS_KEY, function (saved) { withheldPlaceholders.checked = Boolean(saved[SHOW_WITHHELD_PLACEHOLDERS_KEY]); });
    withheldPlaceholders.addEventListener('change', function () { var update = {}; update[SHOW_WITHHELD_PLACEHOLDERS_KEY] = Boolean(withheldPlaceholders.checked); chrome.storage.local.set(update); });
  }
  var unlockOverlays = document.getElementById ? document.getElementById('pnhud-unlock-overlays') : null;
  var lockOverlays = document.getElementById ? document.getElementById('pnhud-lock-overlays') : null;
  var resetOverlays = document.getElementById ? document.getElementById('pnhud-reset-overlays') : null;
  var layoutStatus = document.getElementById ? document.getElementById('pnhud-layout-status') : null;
  function applyDragLockUi(unlocked) {
    if (unlockOverlays) unlockOverlays.disabled = Boolean(unlocked);
    if (lockOverlays) lockOverlays.disabled = !unlocked;
    if (layoutStatus) layoutStatus.textContent = unlocked ? 'Dragging unlocked' : 'Positions locked';
  }
  chrome.storage.local.get(OVERLAY_DRAGGING_UNLOCKED_KEY, function (saved) { applyDragLockUi(Boolean(saved[OVERLAY_DRAGGING_UNLOCKED_KEY])); });
  if (unlockOverlays) unlockOverlays.addEventListener('click', function () { var update = {}; update[OVERLAY_DRAGGING_UNLOCKED_KEY] = true; chrome.storage.local.set(update); applyDragLockUi(true); });
  if (lockOverlays) lockOverlays.addEventListener('click', function () { var update = {}; update[OVERLAY_DRAGGING_UNLOCKED_KEY] = false; chrome.storage.local.set(update); applyDragLockUi(false); });
  if (resetOverlays) resetOverlays.addEventListener('click', function () {
    if (!chrome.tabs || !chrome.tabs.query) {
      if (layoutStatus) layoutStatus.textContent = 'Open a PokerNow game to reset';
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab) { if (layoutStatus) layoutStatus.textContent = 'No active PokerNow game'; return; }
      chrome.tabs.sendMessage(tab.id, { type: 'PNHUD_RESET_OVERLAY_POSITIONS' }, function (response) {
        if (chrome.runtime.lastError || !response || !response.ok) {
          if (layoutStatus) layoutStatus.textContent = 'Open a PokerNow game to reset';
          return;
        }
        if (layoutStatus) layoutStatus.textContent = 'Overlay positions reset';
      });
    });
  });
  var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-mode]'));
  var displayButtons = Array.prototype.slice.call(document.querySelectorAll('[data-display-mode]'));
  function visibilityForMode(mode) {
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
  function setActive(mode) { buttons.forEach(function (button) { button.classList.toggle('active', button.dataset.mode === mode); }); }
  chrome.storage.local.get(MODE_KEY, function (saved) { setActive(saved[MODE_KEY] || 'session'); });
  function setDisplayActive(mode) { displayButtons.forEach(function (button) { button.classList.toggle('active', button.dataset.displayMode === mode); }); }
  chrome.storage.local.get([DISPLAY_MODE_KEY, HUD_UI_PREFERENCES_KEY], function (saved) {
    var preferences = saved[HUD_UI_PREFERENCES_KEY];
    var legacyVisibility = visibilityForMode(saved[DISPLAY_MODE_KEY] || 'seat-overlays-only');
    var seatOverlaysEnabled = preferences && typeof preferences.seatOverlaysEnabled === 'boolean'
      ? preferences.seatOverlaysEnabled
      : legacyVisibility.seatOverlaysEnabled;
    var leaderboardEnabled = preferences && typeof preferences.leaderboardEnabled === 'boolean'
      ? preferences.leaderboardEnabled
      : legacyVisibility.leaderboardEnabled;
    setDisplayActive(modeForVisibility(seatOverlaysEnabled, leaderboardEnabled));
  });
  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      chrome.storage.local.set({ pokerNowHudMode: button.dataset.mode });
      setActive(button.dataset.mode);
    });
  });
  displayButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      var previous = displayButtons.find(function (candidate) { return candidate.classList.contains('active'); });
      var selectedMode = button.dataset.displayMode;
      var visibility = visibilityForMode(selectedMode);
      chrome.storage.local.get(HUD_UI_PREFERENCES_KEY, function (saved) {
        var currentPreferences = saved[HUD_UI_PREFERENCES_KEY] && typeof saved[HUD_UI_PREFERENCES_KEY] === 'object' ? saved[HUD_UI_PREFERENCES_KEY] : {};
        var update = {};
        update[DISPLAY_MODE_KEY] = selectedMode;
        update[HUD_UI_PREFERENCES_KEY] = Object.assign({}, currentPreferences, visibility, { version: 5 });
        chrome.storage.local.set(update);
      });
      setDisplayActive(selectedMode);
      console.log('[HUD DISPLAY MODE] popup wrote canonical visibility', {
        selectedMode: selectedMode,
        storedValue: selectedMode,
        previousMode: previous ? previous.dataset.displayMode : null,
        overlaysExpectedVisible: visibility.seatOverlaysEnabled,
        detailsExpectedVisible: visibility.leaderboardEnabled
      });
    });
  });
})();
