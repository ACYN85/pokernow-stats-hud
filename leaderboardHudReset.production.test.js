'use strict';

var assert = require('assert');
var api = require('./testSupport/potOddsProductionVisibilityHarness.js');
var pointer = require('./testSupport/productionPointerEventHarness.js');
var settings = require('./settingsUi.js');

function click(h, selector) {
  var target = h.document.querySelector(selector);
  assert.ok(target, selector + ' exists');
  pointer.bubble(h, target, pointer.pointerEvent('click', target));
  h.runFor(80, 16);
}

function visible(h, value) {
  if (!value) return click(h, '.pnhud-close');
  var input = h.document.querySelector('.pnhud-settings-leaderboard-visible');
  input.checked = true;
  pointer.bubble(h, input, pointer.pointerEvent('change', input));
  h.runFor(80, 16);
}

function create(width, open, storage) {
  var h = api.createHarness({ gameId: 'leaderboard-reset', layout: 'live-full', initialNow: 1000,
    viewport: { width: 1280, height: 665 }, initialStorage: storage || {
      hudUiPreferences: settings.merge(settings.DEFAULTS, { settingsOpen: true, selectedSettingsSection: 'hud', hudSize: 'small', leaderboardEnabled: open, potOddsOffsetX: 37, potOddsOffsetY: -14 }),
      leaderboardHudPosition: { version: 1, x: 190, y: 230, locked: false },
      'pokerNowHudManualOverlayPositions:game:leaderboard-reset': { playerA: { offsetX: 22, offsetY: 33 } },
      'pokerNowHudManualOverlayPositions:game:other-table': { playerB: { offsetX: 44, offsetY: 55 } }
    } });
  var element = h.document.getElementById('pokernow-stats-hud-root');
  assert.ok(element);
  // Supply only browser layout behavior missing from the shared harness:
  // display:none on an ancestor produces no client rects or offset dimensions.
  function displayed() {
    for (var current = element; current; current = current.parentElement) {
      if (current.hidden || current.style.display === 'none') return false;
    }
    return true;
  }
  element.getBoundingClientRect = function () {
    return displayed() ? api.rect(parseFloat(element.style.left) || 0, parseFloat(element.style.top) || 0, width, 150) : api.rect(0, 0, 0, 0);
  };
  Object.defineProperty(element, 'offsetWidth', { get: function () { return displayed() ? width : 0; } });
  Object.defineProperty(element, 'offsetHeight', { get: function () { return displayed() ? 150 : 0; } });
  h.panel = element;
  h.runFor(240, 16);
  return h;
}

function point(h) { var r = h.panel.getBoundingClientRect(); return [r.left, r.top]; }
function assertDefault(h, width, label) { assert.deepStrictEqual(point(h), [1280 - width - 18, 18], label); }
function reset(h) { click(h, '.pnhud-reset-leaderboard-position'); }
function drag(h, x, y, finish) {
  var header = h.panel.querySelector('.pnhud-header');
  pointer.bubble(h, header, pointer.pointerEvent('pointerdown', header, { pointerId: 41, clientX: 100, clientY: 100 }));
  pointer.documentPointer(h, 'pointermove', header, { pointerId: 41, clientX: 100 + x, clientY: 100 + y });
  if (finish !== false) pointer.documentPointer(h, 'pointerup', header, { pointerId: 41, clientX: 100 + x, clientY: 100 + y });
  h.runFor(48, 16);
  return header;
}

[270, 430].forEach(function (width) {
  var closed = create(width, false);
  reset(closed);
  visible(closed, true);
  assertDefault(closed, width, 'reset closed then open uses measured default at width ' + width);

  var open = create(width, true);
  reset(open);
  assertDefault(open, width, 'reset open uses default');
  visible(open, false);
  visible(open, true);
  assertDefault(open, width, 'close/reopen cannot persist a hidden fallback clamp');
  reset(open); reset(open);
  assertDefault(open, width, 'repeated reset is idempotent');
  assert.deepStrictEqual(open.storage.leaderboardHudPosition, { version: 1, x: null, y: null, locked: false }, 'reset persists default intent and preserves lock');

  drag(open, -90, 80);
  var custom = point(open);
  assert.deepStrictEqual(custom, [1280 - width - 108, 98], 'drag still moves by the pointer delta');
  visible(open, false); visible(open, true);
  assert.deepStrictEqual(point(open), custom, 'custom drag still persists across visibility changes');
  reset(open); visible(open, false); visible(open, true);
  assertDefault(open, width, 'old dragged coordinates cannot return');

  var activeHeader = drag(open, -60, 45, false);
  reset(open);
  pointer.documentPointer(open, 'pointerup', activeHeader, { pointerId: 41, clientX: 40, clientY: 145 });
  visible(open, false); visible(open, true);
  assertDefault(open, width, 'a late pointerup cannot resurrect pre-reset drag state');
  var reloaded = create(width, true, JSON.parse(JSON.stringify(open.storage)));
  assertDefault(reloaded, width, 'reset default survives storage hydration/reload');
  assert.deepStrictEqual(open.storage['pokerNowHudManualOverlayPositions:game:leaderboard-reset'], { playerA: { offsetX: 22, offsetY: 33 } });
  assert.deepStrictEqual(open.storage['pokerNowHudManualOverlayPositions:game:other-table'], { playerB: { offsetX: 44, offsetY: 55 } });
  assert.deepStrictEqual([open.storage.hudUiPreferences.potOddsOffsetX, open.storage.hudUiPreferences.potOddsOffsetY], [37, -14]);
  assert.deepStrictEqual(open.evaluationErrors.concat(closed.evaluationErrors, reloaded.evaluationErrors), []);

  // Trace the immediate reset action, excluding unrelated scheduled work.
  var storageCalls = []; var local = open.contextWindow.chrome.storage.local;
  ['get', 'set', 'remove'].forEach(function (method) {
    var original = local[method];
    local[method] = function (keys, callback) { storageCalls.push({ method: method, keys: keys }); return original(keys, callback); };
  });
  var panel = open.document.querySelector('#pnhud-settings-panel');
  var originalChildren = panel.children.slice();
  var button = panel.querySelector('.pnhud-reset-leaderboard-position');
  pointer.bubble(open, button, pointer.pointerEvent('click', button));
  assert.deepStrictEqual(storageCalls.map(function (call) { return [call.method, Object.keys(call.keys)]; }), [['set', ['leaderboardHudPosition']]], 'reset performs one scoped write and no storage scan');
  assert.deepStrictEqual(panel.children, originalChildren, 'position reset does not rebuild the unchanged Settings controls');
});

console.log('Leaderboard reset open/closed, small/default size, drag, reload, isolation, and scoped-work regressions passed.');
