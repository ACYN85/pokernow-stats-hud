'use strict';
const assert = require('node:assert/strict');
const support = require('./testSupport/productionContentScriptHarness.js');

function harness(gameId, initialStorage) {
  const h = support.createHarness({
    gameId, initialStorage,
    runtimeSendMessage(_message, callback) { callback({ ok: true, value: {} }); },
    transformContentSource(source) {
      return source.replace(/\n\}\)\(\);\s*$/, `
        globalThis.dashboardReloadProbe = {
          open: openPlayerDashboard,
          close: closePlayerDashboard,
          map: rememberPlayerMapping,
          state: function () { return { open: playerDashboardState.open, playerId: playerDashboardState.playerId, displayName: playerDashboardState.displayName }; },
          panel: function () { var element = document.getElementById(playerDashboardId); return element && {
            hidden: element.hidden, clickListeners: (element.listeners.click || []).length,
            inputListeners: (element.listeners.input || []).length,
            instances: document.body.children.filter(function (child) { return child.isConnected && child.id === playerDashboardId; }).length
          }; },
          key: function () { return STORAGE_KEYS.playerDashboard; },
          stop: function () { cleanupExtension('dashboard reload test'); }
        };
      })();`);
    }
  });
  assert.deepEqual(h.evaluationErrors, []);
  const run = expression => h.evaluateInIsolatedWorld('dashboardReloadProbe.' + expression);
  return { h, run };
}

const game = 'dashboard-reload-a';
const keys = support.storageKeys(game);
const initial = { [keys.playerMap]: { P1: 'Alice', P2: 'Bob' } };
let current = harness(game, initial);
assert.equal(current.run('state().open'), false, 'unset state starts closed');
assert.equal(current.run('panel()'), null, 'closed startup has no Dashboard');
current.run('stop()');
current = harness(game, current.h.storage);
assert.equal(current.run('state().open'), false, 'closed Dashboard stays closed on reload');

current.run('open("P1", "Alice")');
const key = current.run('key()');
assert.deepEqual(current.h.storage[key], { open: true, playerId: 'P1' });
current.run('stop()');
current = harness(game, current.h.storage);
assert.equal(current.run('state().open'), true, 'open Dashboard reopens after hydrated startup');
assert.equal(current.run('state().playerId'), 'P1', 'stable selected player is restored');
assert.equal(current.run('state().displayName'), 'Alice', 'restored name comes from this game mapping');
assert.deepEqual(JSON.parse(JSON.stringify(current.run('panel()'))), { hidden: false, clickListeners: 1, inputListeners: 1, instances: 1 });
current.run('stop()');
current = harness(game, current.h.storage);
assert.equal(current.run('state().playerId'), 'P1', 'repeated reload keeps selected player');
assert.deepEqual(JSON.parse(JSON.stringify(current.run('panel()'))), { hidden: false, clickListeners: 1, inputListeners: 1, instances: 1 }, 'repeated reload has one Dashboard/listener set');

const absent = support.clone(current.h.storage);
absent[keys.playerMap] = { P2: 'Bob' };
const fallback = harness(game, absent);
assert.equal(fallback.run('state().playerId'), 'P2', 'unavailable prior player falls back to this game’s mapped player');
assert.equal(fallback.run('state().displayName'), 'Bob');
fallback.run('stop()');

const pending = support.clone(current.h.storage);
pending[keys.playerMap] = {};
const delayed = harness(game, pending);
assert.equal(delayed.run('state().open'), false, 'restoration waits for a valid player mapping');
delayed.run('map("P3", "Cara", "test mapping")');
assert.equal(delayed.run('state().playerId'), 'P3', 'late valid mapping provides safe fallback');
delayed.run('stop()');

const other = harness('dashboard-reload-b', current.h.storage);
assert.equal(other.run('state().open'), false, 'unrelated game does not reuse game A open state');
other.run('stop()');

current.run('close()');
assert.deepEqual(current.h.storage[key], { open: false, playerId: null }, 'explicit close persists closed');
current.run('stop()');
current = harness(game, current.h.storage);
assert.equal(current.run('state().open'), false, 'explicit close wins across reload');
current.run('stop()');
console.log('Per-game Dashboard open/close, selected player, fallback, delayed mapping, and single-instance reload regressions passed.');
