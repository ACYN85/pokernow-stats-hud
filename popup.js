(function () {
  'use strict';
  var Settings = globalThis.PokerHudSettings;
  var DISPLAY_MODE_KEY = 'pokerNowHudDisplayMode';
  var HUD_UI_PREFERENCES_KEY = 'hudUiPreferences';
  // Presentation-only resume hint; canonical visibility remains in the original keys.
  var RESUME_KEY = 'pokerNowHudResumeDisplayMode';
  var toggle = document.getElementById('pnhud-toggle-hud');
  var status = document.getElementById('pnhud-popup-status');
  var feedback = document.getElementById('pnhud-popup-feedback');
  var build = globalThis.PokerNowRuntimeScope;
  var PNHUD_BUILD_ID = globalThis.PokerNowRuntimeScope && globalThis.PokerNowRuntimeScope.buildId || 'unavailable';
  document.getElementById('pnhud-popup-build-id').textContent = 'Build ' + PNHUD_BUILD_ID;
  document.getElementById('pnhud-compatibility-scope').hidden = !(build && build.compatibilityOnly);
  function visibleMode(saved) {
    var fallback = Settings.visibilityForMode(saved[DISPLAY_MODE_KEY] || 'seat-overlays-only');
    var p = saved[HUD_UI_PREFERENCES_KEY] || {};
    return Settings.modeForVisibility(typeof p.seatOverlaysEnabled === 'boolean' ? p.seatOverlaysEnabled : fallback.seatOverlaysEnabled,
      typeof p.leaderboardEnabled === 'boolean' ? p.leaderboardEnabled : fallback.leaderboardEnabled);
  }
  function render() {
    chrome.storage.local.get([DISPLAY_MODE_KEY, HUD_UI_PREFERENCES_KEY], function (saved) {
      var on = visibleMode(saved) !== 'hidden';
      status.textContent = on ? 'HUD active' : 'HUD inactive · tracking continues';
      toggle.textContent = on ? 'Turn HUD off' : 'Turn HUD on';
      toggle.setAttribute('aria-pressed', String(on)); toggle.disabled = false;
    });
  }
  toggle.addEventListener('click', function () {
    toggle.disabled = true;
    chrome.storage.local.get([DISPLAY_MODE_KEY, HUD_UI_PREFERENCES_KEY, RESUME_KEY], function (saved) {
      var mode = visibleMode(saved), on = mode !== 'hidden', resume = saved[RESUME_KEY];
      var next = on ? 'hidden' : ['seat-overlays-only', 'seat-overlays-leaderboard', 'leaderboard-only'].includes(resume) ? resume : 'seat-overlays-only';
      var update = {};
      update[DISPLAY_MODE_KEY] = next;
      update[HUD_UI_PREFERENCES_KEY] = Object.assign({}, saved[HUD_UI_PREFERENCES_KEY] || {}, Settings.visibilityForMode(next), { version: Settings.VERSION });
      if (on) update[RESUME_KEY] = mode;
      chrome.storage.local.set(update, function () {
        feedback.textContent = chrome.runtime.lastError ? 'HUD preference could not be saved.' : on ? 'HUD hidden. Tracking continues.' : 'HUD restored.';
        render();
      });
    });
  });
  document.getElementById('pnhud-open-settings').addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (chrome.runtime.lastError || !tab) { feedback.textContent = 'Open a PokerNow table, then choose Open Settings.'; return; }
      chrome.tabs.sendMessage(tab.id, { type: 'PNHUD_OPEN_SETTINGS' }, function (response) {
        feedback.textContent = chrome.runtime.lastError || !response || !response.ok ? 'Open a PokerNow table, then choose Open Settings. Reload an already-open table after updating.' : 'Settings opened on your PokerNow table.';
      });
    });
  });
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && (changes[DISPLAY_MODE_KEY] || changes[HUD_UI_PREFERENCES_KEY])) render();
  });
  render();
})();
