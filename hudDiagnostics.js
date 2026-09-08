/* Shared diagnostics-level gate for isolated-world extension modules. */
(function (root) {
  'use strict';

  var LEVELS = Object.freeze({ off: 0, basic: 1, deep: 2 });
  var currentLevel = 'basic';

  function normalizeLevel(value) {
    return Object.prototype.hasOwnProperty.call(LEVELS, value) ? value : 'basic';
  }

  function setLevel(value) {
    currentLevel = normalizeLevel(value);
    return currentLevel;
  }

  function getLevel() {
    return currentLevel;
  }

  function requiredLevel(label) {
    label = String(label || '');
    if (/^\[HUD (?:BUILD|RUNTIME SCOPE|UI BOOT(?: [^\]]+)?)\]/.test(label)) return 'basic';
    if (/^\[HUD\] (?:content script loaded|init started|initialization error|current game\/session key|storage namespace|websocket hook health confirmed)/.test(label)) return 'basic';
    return 'deep';
  }

  function enabled(required) {
    return LEVELS[currentLevel] >= LEVELS[normalizeLevel(required)];
  }

  function createConsole(nativeConsole) {
    nativeConsole = nativeConsole || root.console;
    function call(method, required, args) {
      if (!nativeConsole || !enabled(required)) return;
      var fn = nativeConsole[method] || nativeConsole.log;
      if (typeof fn === 'function') fn.apply(nativeConsole, args);
    }
    return Object.freeze({
      log: function () { call('log', requiredLevel(arguments[0]), arguments); },
      debug: function () { call('debug', 'deep', arguments); },
      warn: function () { call('warn', 'basic', arguments); },
      error: function () {
        if (!nativeConsole) return;
        var fn = nativeConsole.error || nativeConsole.log;
        if (typeof fn === 'function') fn.apply(nativeConsole, arguments);
      }
    });
  }

  var api = Object.freeze({
    LEVELS: LEVELS,
    normalizeLevel: normalizeLevel,
    setLevel: setLevel,
    getLevel: getLevel,
    requiredLevel: requiredLevel,
    enabled: enabled,
    createConsole: createConsole
  });
  root.PokerHudDiagnostics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
