'use strict';
const assert = require('node:assert/strict');
const support = require('./testSupport/productionContentScriptHarness.js');
const settings = require('./settingsUi.js');

function start(label, preference) {
  const initialStorage = preference ? { hudUiPreferences: preference } : {};
  const h = support.createHarness({
    gameId: 'leaderboard-size-' + label,
    initialStorage,
    transformContentSource(source) {
      return source.replace(/\n\}\)\(\);\s*$/, `
        globalThis.leaderboardSizeProbe = {
          size: function () { return hudUiPreferences.hudSize; },
          width: function () { var root = document.getElementById(detailsRootId); return root && root.style['--pnhud-hud-width']; },
          stop: function () { cleanupExtension('leaderboard size default test'); }
        };
      })();`);
    }
  });
  assert.deepEqual(h.evaluationErrors, []);
  const run = expression => h.evaluateInIsolatedWorld('leaderboardSizeProbe.' + expression);
  const result = { size: run('size()'), width: Number.parseInt(run('width()'), 10),
    persisted: h.storage.hudUiPreferences.hudSize,
    writes: h.storageWrites.filter(write => Object.hasOwn(write, 'hudUiPreferences')).map(write => write.hudUiPreferences.hudSize) };
  run('stop()');
  return result;
}

const unset = start('unset');
assert.equal(unset.size, 'small');
assert.equal(unset.persisted, 'small');
const small = start('saved-small', settings.merge(settings.DEFAULTS, { hudSize: 'small' }));
const formerDefault = start('saved-default', settings.merge(settings.DEFAULTS, { hudSize: 'default' }));
const large = start('saved-large', settings.merge(settings.DEFAULTS, { hudSize: 'large' }));
assert.equal(small.size, 'small');
assert.equal(formerDefault.size, 'default', 'saved former default is preserved');
assert.equal(large.size, 'large', 'saved large is preserved');
assert.deepEqual(formerDefault.writes, [], 'upgrade does not overwrite valid saved size');
assert.deepEqual(large.writes, [], 'large saved size is not overwritten');
assert.ok(unset.width < formerDefault.width && formerDefault.width < large.width, 'existing presets retain their relative leaderboard widths');
const migrated = start('v10-default', Object.assign({}, settings.merge(settings.DEFAULTS, { hudSize: 'default' }), { version: 10 }));
assert.equal(migrated.size, 'default');
assert.equal(migrated.persisted, 'default', 'migration keeps the saved former default');
const invalid = start('invalid', Object.assign({}, settings.DEFAULTS, { hudSize: 'invalid' }));
assert.equal(invalid.size, 'small', 'unsupported size safely uses the new default');
assert.equal(invalid.persisted, 'small');
console.log('Leaderboard unset/saved/migrated/invalid size production restoration passed.');
