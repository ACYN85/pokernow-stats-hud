/* Safe MAIN-world, read-only BoardCompanion diagnostics for ordinary DevTools. */
(function (root) {
  'use strict';

  var REQUEST_SOURCE = 'pokernow-stats-hud-board-companion-page';
  var RESPONSE_SOURCE = 'pokernow-stats-hud-board-companion-content';
  var pending = new Map();
  var sequence = 0;

  function request(method) {
    return new Promise(function (resolve, reject) {
      sequence += 1;
      var requestId = 'board-companion-' + Date.now() + '-' + sequence;
      var timeout = root.setTimeout(function () {
        pending.delete(requestId);
        reject(new Error('BoardCompanion diagnostic bridge timed out; verify the extension content script is active.'));
      }, 3000);
      pending.set(requestId, { resolve: resolve, reject: reject, timeout: timeout, method: method });
      root.postMessage({ source: REQUEST_SOURCE, type: 'board-companion-diagnostic-request', requestId: requestId, method: method }, root.location.origin);
    });
  }

  function receive(event) {
    if (event.source !== root || event.origin !== root.location.origin) return;
    var message = event.data;
    if (!message || message.source !== RESPONSE_SOURCE || message.type !== 'board-companion-diagnostic-response') return;
    var item = pending.get(String(message.requestId || ''));
    if (!item || item.method !== message.method) return;
    pending.delete(String(message.requestId));
    root.clearTimeout(item.timeout);
    if (message.ok) item.resolve(message.value === undefined ? null : message.value);
    else item.reject(new Error(String(message.error || 'BoardCompanion diagnostic request failed')));
  }

  root.addEventListener('message', receive);
  var api = Object.freeze({
    layoutInfo: function () { return request('layoutInfo'); },
    captureLayoutSnapshot: function () { return request('captureLayoutSnapshot'); },
    eventHistory: function () { return request('eventHistory'); }
  });
  try { Object.defineProperty(root, 'PokerNowHUDBoardCompanion', { value: api, configurable: true, enumerable: false, writable: false }); }
  catch (_error) { root.PokerNowHUDBoardCompanion = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
