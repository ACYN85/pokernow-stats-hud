'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');

function button(mode, attribute) {
  var active = false;
  var listeners = {};
  var result = {
    dataset: {},
    classList: {
      toggle: function (name, enabled) { if (name === 'active') active = Boolean(enabled); },
      contains: function (name) { return name === 'active' && active; }
    },
    addEventListener: function (name, handler) { listeners[name] = handler; },
    click: function () { listeners.click(); },
    isActive: function () { return active; }
  };
  result.dataset[attribute] = mode;
  return result;
}

var session = button('session', 'mode');
var allTime = button('allTime', 'mode');
var overlaysOnly = button('seat-overlays-only', 'displayMode');
var overlaysAndDetails = button('seat-overlays-leaderboard', 'displayMode');
var detailsOnly = button('leaderboard-only', 'displayMode');
var hidden = button('hidden', 'displayMode');
var writes = [];
var logs = [];
var storedValues = {
  pokerNowHudMode: 'session',
  pokerNowHudDisplayMode: 'seat-overlays-only',
  hudUiPreferences: { version: 5, settingsOpen: false, seatOverlaysEnabled: true, leaderboardEnabled: false, accentTheme: 'teal' }
};
var context = {
  document: {
    querySelectorAll: function (selector) {
      return selector === '[data-mode]' ? [session, allTime] : [overlaysOnly, overlaysAndDetails, detailsOnly, hidden];
    }
  },
  chrome: {
    storage: {
      local: {
        get: function (key, callback) {
          var saved = {};
          (Array.isArray(key) ? key : [key]).forEach(function (item) { saved[item] = storedValues[item]; });
          callback(saved);
        },
        set: function (value) { Object.assign(storedValues, value); writes.push(value); }
      }
    }
  },
  console: { log: function () { logs.push(Array.prototype.slice.call(arguments)); } }
};

vm.runInNewContext(fs.readFileSync('./popup.js', 'utf8'), context, { filename: 'popup.js' });
assert.strictEqual(overlaysOnly.isActive(), true, 'popup restores the shared default display mode');
overlaysAndDetails.click();
assert.strictEqual(writes[writes.length - 1].pokerNowHudDisplayMode, 'seat-overlays-leaderboard', 'popup writes the exact shared key and enum');
assert.deepStrictEqual([writes[writes.length - 1].hudUiPreferences.seatOverlaysEnabled, writes[writes.length - 1].hudUiPreferences.leaderboardEnabled], [true, true], 'popup writes the canonical independent booleans with the derived legacy mode');
assert.strictEqual(writes[writes.length - 1].hudUiPreferences.accentTheme, 'teal', 'popup preserves unrelated HUD preferences');
assert.strictEqual(overlaysAndDetails.isActive(), true, 'popup changes its selected mode immediately');
assert.ok(logs.some(function (call) { return call[0] === '[HUD DISPLAY MODE] popup wrote canonical visibility'; }), 'popup emits the canonical visibility diagnostic');

var content = fs.readFileSync('./content.js', 'utf8');
assert.ok(content.includes("displayMode: 'pokerNowHudDisplayMode'"), 'content uses the same storage key as the popup');
assert.ok(content.includes('chrome.storage.onChanged.addListener(handleStorageChanged)'), 'content listens for popup changes');
assert.ok(content.includes('return Boolean(hudUiPreferences && hudUiPreferences.leaderboardEnabled)'), 'details visibility is owned by the canonical leaderboard boolean');
assert.ok(content.includes('return Boolean(hudUiPreferences && hudUiPreferences.seatOverlaysEnabled)'), 'seat visibility is owned by the canonical overlay boolean');
assert.ok(!content.includes('pokerNowHudLeaderboardOpen'), 'obsolete duplicate leaderboard-open storage is removed');
assert.ok(content.includes("else if (changes[STORAGE_KEYS.displayMode])"), 'content migrates legacy-only display-mode commands immediately');
assert.ok(content.includes("'[HUD DISPLAY MODE] canonical visibility received'"), 'content logs received canonical visibility changes');

console.log('Popup/content display-mode synchronization tests passed.');
