/* Pure normalization and viewport clamping for the large leaderboard HUD. */
(function (root) {
  'use strict';

  var VERSION = 1;
  var DEFAULTS = Object.freeze({ version: VERSION, x: null, y: null, locked: true });
  var VIEWPORT_GAP = 8;
  var DEFAULT_TOP = 18;
  var DEFAULT_RIGHT = 18;

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function normalize(stored) {
    var validObject = Boolean(stored && typeof stored === 'object' && !Array.isArray(stored) && stored.version === VERSION);
    var coordinatesValid = validObject && finite(stored.x) && finite(stored.y);
    return {
      value: {
        version: VERSION,
        x: coordinatesValid ? stored.x : null,
        y: coordinatesValid ? stored.y : null,
        locked: validObject && typeof stored.locked === 'boolean' ? stored.locked : true
      },
      defaultUsed: !validObject,
      coordinatesValid: coordinatesValid
    };
  }

  function defaultPosition(size, viewport) {
    size = size || {};
    viewport = viewport || {};
    return {
      x: Math.max(VIEWPORT_GAP, Number(viewport.width || 0) - Number(size.width || 0) - DEFAULT_RIGHT),
      y: DEFAULT_TOP
    };
  }

  function clamp(position, size, viewport) {
    position = position || {};
    size = size || {};
    viewport = viewport || {};
    var maxX = Math.max(VIEWPORT_GAP, Number(viewport.width || 0) - Number(size.width || 0) - VIEWPORT_GAP);
    var maxY = Math.max(VIEWPORT_GAP, Number(viewport.height || 0) - Number(size.height || 0) - VIEWPORT_GAP);
    var fallback = defaultPosition(size, viewport);
    var x = finite(position.x) ? position.x : fallback.x;
    var y = finite(position.y) ? position.y : fallback.y;
    return {
      x: Math.max(VIEWPORT_GAP, Math.min(maxX, x)),
      y: Math.max(VIEWPORT_GAP, Math.min(maxY, y)),
      clamped: x < VIEWPORT_GAP || x > maxX || y < VIEWPORT_GAP || y > maxY
    };
  }

  function equal(left, right) {
    return Boolean(left && right && left.version === right.version && left.x === right.x && left.y === right.y && left.locked === right.locked);
  }

  var api = Object.freeze({
    VERSION: VERSION,
    DEFAULTS: DEFAULTS,
    VIEWPORT_GAP: VIEWPORT_GAP,
    DEFAULT_TOP: DEFAULT_TOP,
    DEFAULT_RIGHT: DEFAULT_RIGHT,
    normalize: normalize,
    defaultPosition: defaultPosition,
    clamp: clamp,
    equal: equal
  });
  root.PokerLeaderboardHudPosition = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
