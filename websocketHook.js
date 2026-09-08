(function () {
  'use strict';
  var mainWorldRuntimeScope = window.PokerNowRuntimeScope;
  function mainWorldFallbackGuard(locationLike) {
    try { var protocol = String(locationLike && locationLike.protocol || '').toLowerCase(); var hostname = String(locationLike && locationLike.hostname || '').toLowerCase(); var pathname = String(locationLike && locationLike.pathname || '').split(/[?#]/)[0]; return protocol === 'https:' && (hostname === 'pokernow.com' || hostname === 'www.pokernow.com') && /^\/games\/[^/]+\/?$/.test(pathname); } catch (error) { return false; }
  }
  var mainWorldGameGuard = mainWorldRuntimeScope && typeof mainWorldRuntimeScope.isPokerNowGamePage === 'function' ? mainWorldRuntimeScope.isPokerNowGamePage : mainWorldFallbackGuard;
  if (!mainWorldRuntimeScope) console.warn('[HUD PACKAGING ERROR] MAIN-world runtimeScope.js missing; WebSocket hook using its self-contained page guard');
  if (!mainWorldGameGuard(window.location)) return;
  function canonicalGameId(locationLike) {
    try { var match = String(locationLike && locationLike.pathname || '').match(/^\/games\/([^/?#]+)\/?$/i); return match ? decodeURIComponent(match[1]) : null; } catch (error) { return null; }
  }
  var installedGameId = canonicalGameId(window.location);
  console.log('[HUD BUILD] websocketHook ' + (mainWorldRuntimeScope && mainWorldRuntimeScope.buildId || 'runtime-scope-build-unknown'));
  if (window.__POKERNOW_HUD_WEBSOCKET_HOOKED__) return;
  window.__POKERNOW_HUD_WEBSOCKET_HOOKED__ = true;
  window.__PNHUD_WEBSOCKET_HOOK_INSTALLATION_COUNT__ = Number(window.__PNHUD_WEBSOCKET_HOOK_INSTALLATION_COUNT__ || 0) + 1;
  var hookInstanceId = String(mainWorldRuntimeScope && mainWorldRuntimeScope.buildId || 'unknown-build') + ':hook:' + window.__PNHUD_WEBSOCKET_HOOK_INSTALLATION_COUNT__ + ':' + Date.now();
  var diagnosticApi = window.PokerPauseDiagnosticCapture;
  var diagnosticState = diagnosticApi ? diagnosticApi.createState({ enabled: false, buildId: mainWorldRuntimeScope && mainWorldRuntimeScope.buildId, websocketHookInstanceId: hookInstanceId }) : null;
  var NativeWebSocket = window.WebSocket;
  var nativePostMessage = window.postMessage;
  var nativeFetch = window.fetch;
  var nativeXhrOpen = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
  var nativeXhrSend = window.XMLHttpRequest && window.XMLHttpRequest.prototype.send;
  var nativeSendBeacon = window.navigator && window.navigator.sendBeacon;
  var nativeDispatchEvent = window.EventTarget && window.EventTarget.prototype.dispatchEvent;
  var nativePushState = history.pushState;
  var nativeReplaceState = history.replaceState;
  var relaySequence = 0;
  var relayQueue = Promise.resolve();
  var relayPendingCount = 0;
  var socketSequence = 0;
  var active = true;
  var deepDiagnostics = false;
  var diagnosticEnabled = false;
  var optionalHooksInstalled = false;
  var socketInventory = [];
  var xhrMetadata = new WeakMap();
  var patchedFetch = null;
  var patchedPostMessage = null;
  var patchedXhrOpen = null;
  var patchedXhrSend = null;
  var patchedSendBeacon = null;
  var patchedDispatchEvent = null;

  function bridge(message) { nativePostMessage.call(window, message, window.location.origin); }
  function announceHookInstalled() { bridge({ source: 'pokernow-stats-hud-main', type: 'websocket-hook-status', installed: true, framesCaptured: relaySequence, hookInstallationCount: window.__PNHUD_WEBSOCKET_HOOK_INSTALLATION_COUNT__, hookInstanceId: hookInstanceId }); }
  function emitSocket(record) { if (!diagnosticEnabled) return; bridge({ source: 'pokernow-stats-hud-main', type: 'pause-diagnostic-socket', socket: record }); }
  function recordSocket(input) {
    var existing = socketInventory.find(function (item) { return item.socketId === input.socketId; });
    if (!existing) { existing = { socketId: input.socketId, creationOrder: input.creationOrder, url: input.url, protocols: input.protocols || [], createdAt: input.createdAt, hookInstanceId: hookInstanceId, lifecycle: [], carriesKnownGcTraffic: false }; socketInventory.push(existing); if (socketInventory.length > 48) socketInventory.shift(); }
    if (input.carriesKnownGcTraffic) existing.carriesKnownGcTraffic = true;
    if (input.lifecycleType) { existing.lifecycle.push({ type: input.lifecycleType, timestamp: input.timestamp, code: input.code === undefined ? null : input.code, reason: input.reason || null, wasClean: input.wasClean === true }); if (existing.lifecycle.length > 20) existing.lifecycle.shift(); }
    if (diagnosticState) diagnosticApi.recordSocket(diagnosticState, Object.assign({}, existing, input));
    emitSocket(existing);
    return existing;
  }
  function recordDiagnostic(input) {
    if (!diagnosticEnabled || !diagnosticState || !active) return null;
    var entry = diagnosticApi.recordEntry(diagnosticState, input);
    if (entry) bridge({ source: 'pokernow-stats-hud-main', type: 'pause-diagnostic-event', entry: entry });
    return entry;
  }
  function diagnosticBody(value) {
    if (!diagnosticApi) return null;
    try { return diagnosticApi.payloadDetails(value, diagnosticState.redaction); } catch (error) { return { dataType: typeof value, parseError: String(error.message || error).slice(0, 180) }; }
  }
  function installOptionalHooks() {
    if (optionalHooksInstalled) return;
    optionalHooksInstalled = true;
    if (typeof nativeFetch === 'function') {
      patchedFetch = function (input, init) {
        var method = String(init && init.method || input && input.method || 'GET').toUpperCase();
        var url = String(input && input.url || input || '');
        recordDiagnostic({ timestamp: Date.now(), api: 'fetch', direction: 'outbound', url: url, method: method, payloadDetails: diagnosticBody(init && init.body) });
        var promise = nativeFetch.apply(this, arguments);
        Promise.resolve(promise).then(function (response) { recordDiagnostic({ timestamp: Date.now(), api: 'fetch', direction: 'inbound', url: response && response.url || url, method: method, status: response && response.status, payload: { responseType: response && response.type || null, redirected: Boolean(response && response.redirected) } }); }).catch(function (error) { recordDiagnostic({ timestamp: Date.now(), api: 'fetch', direction: 'inbound', url: url, method: method, parseError: error && (error.message || error) }); });
        return promise;
      };
      window.fetch = patchedFetch;
    }
    if (nativeXhrOpen && nativeXhrSend) {
      patchedXhrOpen = function (method, url) { xhrMetadata.set(this, { method: String(method || 'GET').toUpperCase(), url: String(url || '') }); return nativeXhrOpen.apply(this, arguments); };
      patchedXhrSend = function (body) {
        var xhr = this; var metadata = xhrMetadata.get(xhr) || { method: 'GET', url: '' };
        recordDiagnostic({ timestamp: Date.now(), api: 'xhr', direction: 'outbound', url: metadata.url, method: metadata.method, payloadDetails: diagnosticBody(body) });
        xhr.addEventListener('loadend', function () { var responsePayload = null; try { if (!xhr.responseType || xhr.responseType === 'text') responsePayload = xhr.responseText; else responsePayload = { responseType: xhr.responseType, byteLength: xhr.response && xhr.response.byteLength || null }; } catch (error) { responsePayload = { responseUnreadable: true }; } recordDiagnostic({ timestamp: Date.now(), api: 'xhr', direction: 'inbound', url: xhr.responseURL || metadata.url, method: metadata.method, status: xhr.status, payloadDetails: diagnosticBody(responsePayload) }); }, { once: true });
        return nativeXhrSend.apply(this, arguments);
      };
      window.XMLHttpRequest.prototype.open = patchedXhrOpen;
      window.XMLHttpRequest.prototype.send = patchedXhrSend;
    }
    if (typeof nativeSendBeacon === 'function') {
      patchedSendBeacon = function (url, data) { recordDiagnostic({ timestamp: Date.now(), api: 'sendBeacon', direction: 'outbound', url: String(url || ''), method: 'POST', payloadDetails: diagnosticBody(data) }); return nativeSendBeacon.apply(this, arguments); };
      window.navigator.sendBeacon = patchedSendBeacon;
    }
    patchedPostMessage = function (message, targetOrigin) {
      var internal = message && (message.source === 'pokernow-stats-hud-main' || message.source === 'pokernow-stats-hud-content');
      if (!internal) recordDiagnostic({ timestamp: Date.now(), api: 'postMessage', direction: 'outbound', target: String(targetOrigin || ''), method: 'postMessage', payloadDetails: diagnosticBody(message) });
      return nativePostMessage.apply(this, arguments);
    };
    window.postMessage = patchedPostMessage;
    if (nativeDispatchEvent) {
      patchedDispatchEvent = function (event) { if (event && event.type && /pause|resume|game|room|table|state|control/i.test(event.type) && String(event.type).indexOf('pokernow-hud-') !== 0) recordDiagnostic({ timestamp: Date.now(), api: 'custom-event', direction: 'dispatch', target: this === window ? 'window' : (this === document ? 'document' : this && this.nodeName || 'EventTarget'), eventType: event.type, payloadDetails: diagnosticBody(event.detail) }); return nativeDispatchEvent.apply(this, arguments); };
      window.EventTarget.prototype.dispatchEvent = patchedDispatchEvent;
    }
  }
  function removeOptionalHooks() {
    if (!optionalHooksInstalled) return;
    optionalHooksInstalled = false;
    if (window.fetch === patchedFetch) window.fetch = nativeFetch;
    if (window.postMessage === patchedPostMessage) window.postMessage = nativePostMessage;
    if (window.XMLHttpRequest && window.XMLHttpRequest.prototype.open === patchedXhrOpen) window.XMLHttpRequest.prototype.open = nativeXhrOpen;
    if (window.XMLHttpRequest && window.XMLHttpRequest.prototype.send === patchedXhrSend) window.XMLHttpRequest.prototype.send = nativeXhrSend;
    if (window.navigator && window.navigator.sendBeacon === patchedSendBeacon) window.navigator.sendBeacon = nativeSendBeacon;
    if (window.EventTarget && window.EventTarget.prototype.dispatchEvent === patchedDispatchEvent) window.EventTarget.prototype.dispatchEvent = nativeDispatchEvent;
  }
  function setDiagnosticEnabled(enabled) {
    diagnosticEnabled = enabled === true;
    if (diagnosticState) diagnosticApi.setEnabled(diagnosticState, diagnosticEnabled, Date.now());
    if (diagnosticEnabled) { installOptionalHooks(); socketInventory.forEach(function (socket) { if (diagnosticState) diagnosticApi.recordSocket(diagnosticState, socket); emitSocket(socket); }); }
    else removeOptionalHooks();
  }
  function handleProbe(event) {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (!event.data || event.data.source !== 'pokernow-stats-hud-content') return;
    if (event.data.type === 'websocket-hook-probe') announceHookInstalled();
    if (event.data.type === 'diagnostics-level') deepDiagnostics = event.data.level === 'deep';
    if (event.data.type === 'pause-lifecycle-capture-mode' || event.data.type === 'pause-diagnostic-capture-mode') setDiagnosticEnabled(event.data.enabled === true);
    if (event.data.type === 'pause-diagnostic-clear' && diagnosticState) { diagnosticApi.clearCapture(diagnosticState, Date.now()); socketInventory.forEach(function (socket) { diagnosticApi.recordSocket(diagnosticState, socket); emitSocket(socket); }); }
  }
  window.addEventListener('message', handleProbe);
  function relay(socketRecord, direction, data) {
    if (!active || !mainWorldGameGuard(window.location)) return;
    relaySequence += 1;
    var receiptSequence = relaySequence;
    var capturedAt = Date.now();
    function send(text, dataType, binaryBytes, byteLength) {
      if (!active) return null;
      var frameId = 'ws-' + receiptSequence;
      var message = { source: 'pokernow-stats-hud-main', type: 'websocket-frame', frameId: frameId, hookInstanceId: hookInstanceId, capturedAt: capturedAt, framesCaptured: receiptSequence, socketId: socketRecord.socketId, socketUrl: socketRecord.url, direction: direction, dataType: dataType, data: text, binaryBytes: binaryBytes || null };
      if (deepDiagnostics || diagnosticEnabled) console.log('[HUD PIPELINE 1] frame captured', { frameId: frameId, socketId: socketRecord.socketId, direction: direction, socketUrl: socketRecord.url, dataType: dataType, data: diagnosticEnabled ? String(text || '').slice(0, 1200) : text, binaryByteLength: byteLength || binaryBytes && binaryBytes.length || 0 });
      bridge(message);
      if (diagnosticEnabled) emitSocket(socketRecord);
      var details = diagnosticBody(typeof text === 'string' && text ? text : { dataType: dataType, byteLength: byteLength || binaryBytes && binaryBytes.length || 0 });
      var entry = recordDiagnostic({ timestamp: message.capturedAt, api: 'websocket', direction: direction, socketId: socketRecord.socketId, url: socketRecord.url, method: direction === 'outgoing' ? 'send' : 'message', payloadDetails: details });
      if (details && details.framing && details.framing.carriesKnownGcTraffic) recordSocket({ socketId: socketRecord.socketId, carriesKnownGcTraffic: true });
      return entry;
    }
    function processReceipt() {
      if (!active) return null;
      if (typeof data === 'string') return send(data, 'string');
      if (data instanceof Blob) {
        var size = data.size;
        return data.arrayBuffer().then(function (buffer) {
          var bytes = Array.from(new Uint8Array(buffer)); var text = '';
          try { text = new TextDecoder().decode(buffer); } catch (error) {}
          return send(text, 'blob', bytes, size);
        }).catch(function (error) {
          recordDiagnostic({ timestamp: capturedAt, api: 'websocket', direction: direction, socketId: socketRecord.socketId, url: socketRecord.url, parseError: error && (error.message || error), payload: { dataType: 'blob', byteLength: size, receiptSequence: receiptSequence } });
          return null;
        });
      }
      if (data instanceof ArrayBuffer) { var arrayBufferBytes = Array.from(new Uint8Array(data)); try { return send(new TextDecoder().decode(data), 'arraybuffer', arrayBufferBytes, data.byteLength); } catch (error) { return send('', 'arraybuffer-unreadable', arrayBufferBytes, data.byteLength); } }
      if (ArrayBuffer.isView(data)) { var viewBytes = Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)); try { return send(new TextDecoder().decode(data), 'typed-array', viewBytes, data.byteLength); } catch (error) { return send('', 'typed-array-unreadable', viewBytes, data.byteLength); } }
      return null;
    }
    function handleRelayError(error) {
      recordDiagnostic({ timestamp: capturedAt, api: 'websocket', direction: direction, socketId: socketRecord.socketId, url: socketRecord.url, parseError: error && (error.message || error), payload: { dataType: typeof data, receiptSequence: receiptSequence } });
      return null;
    }
    if (relayPendingCount === 0 && !(data instanceof Blob)) {
      try { return processReceipt(); } catch (error) { return handleRelayError(error); }
    }
    relayPendingCount += 1;
    var pending = relayQueue.then(processReceipt);
    relayQueue = pending.catch(handleRelayError).then(function (result) { relayPendingCount -= 1; return result; });
    return pending;
  }
  class HudWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      if (protocols === undefined) super(url); else super(url, protocols);
      socketSequence += 1;
      var socketRecord = recordSocket({ socketId: 'pnhud-ws-' + socketSequence, creationOrder: socketSequence, url: String(url), protocols: protocols === undefined ? [] : (Array.isArray(protocols) ? protocols.slice() : [String(protocols)]), createdAt: Date.now(), lifecycleType: 'created', timestamp: Date.now() });
      this.addEventListener('open', function () { recordSocket({ socketId: socketRecord.socketId, lifecycleType: 'open', timestamp: Date.now() }); });
      this.addEventListener('message', function (event) { relay(socketRecord, 'incoming', event.data); });
      this.addEventListener('close', function (event) { recordSocket({ socketId: socketRecord.socketId, lifecycleType: 'close', timestamp: Date.now(), code: event.code, reason: event.reason, wasClean: event.wasClean }); });
      this.addEventListener('error', function () { recordSocket({ socketId: socketRecord.socketId, lifecycleType: 'error', timestamp: Date.now() }); });
      var nativeSend = this.send;
      this.send = function (data) { relay(socketRecord, 'outgoing', data); return nativeSend.call(this, data); };
    }
  }
  Object.defineProperties(HudWebSocket, { CONNECTING: { value: NativeWebSocket.CONNECTING }, OPEN: { value: NativeWebSocket.OPEN }, CLOSING: { value: NativeWebSocket.CLOSING }, CLOSED: { value: NativeWebSocket.CLOSED } });
  window.WebSocket = HudWebSocket;
  function cleanupHook() { if (!active) return; active = false; removeOptionalHooks(); window.removeEventListener('message', handleProbe); window.removeEventListener('popstate', handleLocationChange); window.removeEventListener('hashchange', handleLocationChange); window.removeEventListener('pagehide', cleanupHook); if (window.WebSocket === HudWebSocket) window.WebSocket = NativeWebSocket; if (history.pushState !== nativePushState) history.pushState = nativePushState; if (history.replaceState !== nativeReplaceState) history.replaceState = nativeReplaceState; window.__POKERNOW_HUD_WEBSOCKET_HOOKED__ = false; }
  function handleLocationChange() { document.dispatchEvent(new CustomEvent('pokernow-hud-location-change')); if (!mainWorldGameGuard(window.location) || canonicalGameId(window.location) !== installedGameId) cleanupHook(); }
  history.pushState = function () { var result = nativePushState.apply(this, arguments); handleLocationChange(); return result; };
  history.replaceState = function () { var result = nativeReplaceState.apply(this, arguments); handleLocationChange(); return result; };
  window.addEventListener('popstate', handleLocationChange); window.addEventListener('hashchange', handleLocationChange); window.addEventListener('pagehide', cleanupHook, { once: true });
  console.log('[HUD] websocket hook installed'); announceHookInstalled(); setTimeout(announceHookInstalled, 0);
})();
