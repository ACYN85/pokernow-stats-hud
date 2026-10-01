'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var rootDir = path.join(__dirname, '..');
var manifest = require('../manifest.json');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function FakeElement(tag, document) {
  this.nodeType = 1;
  this.tagName = String(tag || 'div').toUpperCase();
  this.ownerDocument = document;
  this.children = [];
  this.parentElement = null;
  this.isConnected = false;
  this.style = {
    setProperty: function (name, value) { this[name] = String(value); },
    removeProperty: function (name) { delete this[name]; }
  };
  this.dataset = {};
  this.attributes = {};
  this.listeners = {};
  this.className = '';
  this.textContent = '';
  this.innerHTML = '';
  this.value = '';
  this.checked = false;
  this.disabled = false;
  this.hidden = false;
  this.open = false;
  this.scrollTop = 0;
  this.scrollHeight = 0;
  this.clientHeight = 0;
  this.clientWidth = 0;
  this.offsetWidth = 0;
  this.offsetHeight = 0;
  this.classList = { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } };
}

Object.defineProperty(FakeElement.prototype, 'id', {
  get: function () { return this._id || ''; },
  set: function (value) {
    this._id = String(value);
    if (this.isConnected) this.ownerDocument.elements.set(this._id, this);
  }
});

FakeElement.prototype.appendChild = function (child) {
  child.parentElement = this;
  child.isConnected = true;
  this.children.push(child);
  if (child.id) this.ownerDocument.elements.set(child.id, child);
  return child;
};
FakeElement.prototype.insertBefore = FakeElement.prototype.appendChild;
FakeElement.prototype.remove = function () { this.isConnected = false; if (this.id) this.ownerDocument.elements.delete(this.id); };
FakeElement.prototype.addEventListener = function (type, listener) { (this.listeners[type] || (this.listeners[type] = [])).push(listener); };
FakeElement.prototype.removeEventListener = function (type, listener) { this.listeners[type] = (this.listeners[type] || []).filter(function (item) { return item !== listener; }); };
FakeElement.prototype.dispatchEvent = function (event) {
  if (!event.target) event.target = this;
  (this.listeners[event.type] || []).slice().forEach(function (listener) { listener.call(this, event); }, this);
  return true;
};
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = value; };
FakeElement.prototype.getAttribute = function (name) { return this.attributes[name] || null; };
FakeElement.prototype.removeAttribute = function (name) { delete this.attributes[name]; };
FakeElement.prototype.querySelector = function () { var child = new FakeElement('button', this.ownerDocument); child.isConnected = true; return child; };
FakeElement.prototype.querySelectorAll = function () { return []; };
FakeElement.prototype.closest = function () { return null; };
FakeElement.prototype.contains = function () { return false; };
FakeElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
FakeElement.prototype.focus = function () {};
FakeElement.prototype.click = function () {};

function createDocument() {
  var listeners = {};
  var document = { elements: new Map(), hidden: false, visibilityState: 'visible', listeners: listeners };
  document.body = new FakeElement('body', document);
  document.body.isConnected = true;
  document.documentElement = document.body;
  document.createElement = function (tag) { return new FakeElement(tag, document); };
  document.getElementById = function (id) { return document.elements.get(String(id)) || null; };
  document.querySelector = function () { return null; };
  document.querySelectorAll = function () { return []; };
  document.addEventListener = function (type, listener) { (listeners[type] || (listeners[type] = [])).push(listener); };
  document.removeEventListener = function (type, listener) { listeners[type] = (listeners[type] || []).filter(function (item) { return item !== listener; }); };
  document.dispatchEvent = function (event) { (listeners[event.type] || []).slice().forEach(function (listener) { listener.call(document, event); }); return true; };
  document.elementFromPoint = function () { return null; };
  return document;
}

function createSessionStorage(backing) {
  backing = backing || {};
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(backing, String(key)) ? String(backing[String(key)]) : null; },
    setItem: function (key, value) { backing[String(key)] = String(value); },
    removeItem: function (key) { delete backing[String(key)]; },
    clear: function () { Object.keys(backing).forEach(function (key) { delete backing[key]; }); },
    key: function (index) { return Object.keys(backing)[index] || null; },
    get length() { return Object.keys(backing).length; }
  };
}

function createHarness(options) {
  options = options || {};
  var gameId = options.gameId || 'flop-cbet-shadow-production';
  var listeners = {};
  var logs = [];
  var storage = clone(options.initialStorage || {});
  var storageWrites = [];
  var sessionStorageBacking = options.sessionStorageBacking || {};
  var location = {
    href: 'https://pokernow.com/games/' + gameId,
    protocol: 'https:',
    hostname: 'pokernow.com',
    pathname: '/games/' + gameId,
    origin: 'https://pokernow.com',
    search: '', hash: ''
  };
  var document = options.document || createDocument();
  var testClock = { now: Number(options.initialNow || 1) };
  var animationFrameSequence = 0;
  var animationFrames = new Map();
  var timerSequence = 0;
  var timers = new Map();
  var contextObject = {
    location: location,
    document: document,
    console: {
      log: function () { logs.push(Array.from(arguments)); },
      warn: function () { logs.push(Array.from(arguments)); },
      error: function () { logs.push(Array.from(arguments)); }
    },
    chrome: {
      runtime: {
        id: 'flop-cbet-content-path-test', getManifest: function () { return manifest; }, lastError: null,
        sendMessage: options.runtimeSendMessage,
        onMessage: { addListener: function () {}, removeListener: function () {} }
      },
      storage: {
        local: {
          get: function (_keys, callback) { callback(clone(storage)); },
          set: function (update, callback) {
            var copied = clone(update);
            storageWrites.push(copied);
            if (typeof options.failStorageSet === 'function' && options.failStorageSet(copied, storageWrites.length)) {
              contextObject.chrome.runtime.lastError = { message: 'fixture storage write failed' };
              if (callback) callback();
              contextObject.chrome.runtime.lastError = null;
              return;
            }
            Object.assign(storage, copied); if (callback) callback();
          },
          remove: function (keys, callback) { (Array.isArray(keys) ? keys : [keys]).forEach(function (key) { delete storage[key]; }); if (callback) callback(); }
        },
        onChanged: { addListener: function () {}, removeListener: function () {} }
      }
    },
    setTimeout: options.controlledTimers ? function (callback) { timerSequence += 1; timers.set(timerSequence, callback); return timerSequence; } : function () { return 1; },
    clearTimeout: options.controlledTimers ? function (timerId) { timers.delete(timerId); } : function () {},
    setInterval: function () { return 1; }, clearInterval: function () {},
    requestAnimationFrame: function (callback) {
      if (!options.controlledAnimationFrames) return 1;
      animationFrameSequence += 1;
      animationFrames.set(animationFrameSequence, callback);
      return animationFrameSequence;
    },
    cancelAnimationFrame: function (frameId) { if (options.controlledAnimationFrames) animationFrames.delete(frameId); },
    MutationObserver: options.MutationObserver || function () { this.observe = function () {}; this.disconnect = function () {}; },
    ResizeObserver: options.ResizeObserver || function () { this.observe = function () {}; this.unobserve = function () {}; this.disconnect = function () {}; },
    Blob: Blob, URL: URL, Response: Response, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    CompressionStream: CompressionStream, DecompressionStream: DecompressionStream,
    ReadableStream: ReadableStream, Uint8Array: Uint8Array, ArrayBuffer: ArrayBuffer,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_POSITION_FOLLOWING: 4 },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    Event: function (type) { this.type = type; },
    getComputedStyle: function () { return { position: 'static', overflowY: 'visible', opacity: '1', display: 'block', visibility: 'visible' }; },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    navigator: { userAgent: 'flop-cbet-content-path-production-test' }
  };
  contextObject.sessionStorage = createSessionStorage(sessionStorageBacking);
  if (options.crypto) contextObject.crypto = options.crypto;
  if (options.controlledClock) {
    function HarnessDate() {
      var args = Array.from(arguments);
      if (!(this instanceof HarnessDate)) return Date.apply(null, args);
      if (!args.length) return new Date(testClock.now);
      return new (Function.prototype.bind.apply(Date, [null].concat(args)))();
    }
    HarnessDate.now = function () { return testClock.now; };
    HarnessDate.parse = Date.parse;
    HarnessDate.UTC = Date.UTC;
    HarnessDate.prototype = Date.prototype;
    contextObject.Date = HarnessDate;
  }
  if (options.debugEnabled) contextObject.__PNHUD_PREFLOP_DEBUG__ = true;
  if (options.showdownDebugEnabled) contextObject.__PNHUD_SHOWDOWN_DEBUG__ = true;
  if (options.profileDebugEnabled) contextObject.__PNHUD_PROFILE_DEBUG__ = true;
  contextObject.window = contextObject;
  contextObject.self = contextObject;
  contextObject.globalThis = contextObject;
  contextObject.addEventListener = function (type, listener) { (listeners[type] || (listeners[type] = [])).push(listener); };
  contextObject.removeEventListener = function (type, listener) { listeners[type] = (listeners[type] || []).filter(function (item) { return item !== listener; }); };

  var context = vm.createContext(contextObject);
  var contextWindow = vm.runInContext('window', context);
  contextObject.postMessage = function (data) {
    (listeners.message || []).slice().forEach(function (listener) { listener({ source: contextWindow, origin: location.origin, data: data }); });
  };

  var isolatedScripts = manifest.content_scripts.find(function (entry) { return entry.world !== 'MAIN' && entry.js.includes('content.js'); }).js;
  var evaluationErrors = [];
  isolatedScripts.forEach(function (file) {
    try {
      var source = fs.readFileSync(path.join(rootDir, file), 'utf8');
      if (file === 'content.js' && typeof options.transformContentSource === 'function') source = options.transformContentSource(source);
      vm.runInContext(source, context, { filename: file });
    }
    catch (error) { evaluationErrors.push({ file: file, message: error.message, stack: error.stack }); }
  });
  return {
    gameId: gameId, context: context, contextWindow: contextWindow, listeners: listeners, logs: logs,
    storage: storage, storageWrites: storageWrites, isolatedScripts: isolatedScripts, evaluationErrors: evaluationErrors,
    sessionStorageBacking: sessionStorageBacking,
    listenerCount: function (type) { return (listeners[type] || []).length; },
    documentListenerCount: function (type) { return document.listeners ? (document.listeners[type] || []).length : 0; },
    navigateToGame: function (nextGameId) {
      location.pathname = '/games/' + String(nextGameId);
      location.href = location.origin + location.pathname;
    },
    evaluateInIsolatedWorld: function (expression) { return vm.runInContext(String(expression), context); },
    setNow: options.controlledClock ? function (timestamp) { testClock.now = Number(timestamp); } : null,
    flushAnimationFrames: options.controlledAnimationFrames ? function (limit) {
      var executed = 0;
      var maxCallbacks = Math.max(1, Number(limit || 100));
      while (animationFrames.size && executed < maxCallbacks) {
        var pending = Array.from(animationFrames.entries());
        animationFrames.clear();
        pending.forEach(function (entry) {
          if (executed >= maxCallbacks) { animationFrames.set(entry[0], entry[1]); return; }
          entry[1](testClock.now);
          executed += 1;
        });
      }
      return { executed: executed, pending: animationFrames.size };
    } : null,
    flushTimers: options.controlledTimers ? function (limit) {
      var executed = 0;
      var maxCallbacks = Math.max(1, Number(limit || 100));
      while (timers.size && executed < maxCallbacks) {
        var pending = Array.from(timers.entries());
        timers.clear();
        pending.forEach(function (entry) {
          if (executed >= maxCallbacks) { timers.set(entry[0], entry[1]); return; }
          if (typeof entry[1] === 'function') entry[1]();
          executed += 1;
        });
      }
      return { executed: executed, pending: timers.size };
    } : null,
    pendingTimerCount: function () { return timers.size; }
  };
}

function dispatchFrame(harness, rawPayload, frameId, capturedAt) {
  if (typeof harness.setNow === 'function') harness.setNow(Number(capturedAt || Date.now()));
  (harness.listeners.message || []).slice().forEach(function (listener) {
    listener({
      source: harness.contextWindow,
      origin: 'https://pokernow.com',
      data: {
        source: 'pokernow-stats-hud-main', type: 'websocket-frame',
        frameId: String(frameId), hookInstanceId: 'flop-cbet-content-path-hook', capturedAt: Number(capturedAt || Date.now()), framesCaptured: 1,
        socketId: 'socket-shadow-test', socketUrl: 'wss://example.invalid/socket', direction: 'incoming', dataType: 'string', data: rawPayload, binaryBytes: null
      }
    });
  });
}

function dispatchFrames(harness, frames, prefix, capturedAtBase) {
  (frames || []).forEach(function (frame, index) {
    dispatchFrame(harness, typeof frame === 'string' ? frame : frame.rawPayload, (prefix || 'frame') + '-' + (index + 1), Number(capturedAtBase || 1000) + index);
  });
}

function debugEntries(harness, stage) {
  return harness.logs.filter(function (call) {
    return call[0] === '[PNHUD PREFLOP DEBUG]' && call[1] && (!stage || call[1].stage === stage);
  }).map(function (call) { return call[1]; });
}

function showdownDebugEntries(harness, stage) {
  return harness.logs.filter(function (call) {
    return call[0] === '[PNHUD SHOWDOWN DEBUG]' && call[1] && (!stage || call[1].stage === stage);
  }).map(function (call) { return call[1]; });
}

function storageKeys(gameId) {
  var namespace = 'game:pokernow.com%3A' + gameId;
  return {
    schema: 'pokerNowHudLiveSchemaVersion:' + namespace,
    playerMap: 'pokerNowHudPlayerMap:' + namespace,
    liveEvents: 'pokerNowHudLiveEvents:' + namespace,
    activeHand: 'pokerNowHudActiveHand:' + namespace,
    finalizedHandIds: 'pokerNowHudFinalizedHandIds:' + namespace
  };
}

module.exports = Object.freeze({ clone: clone, createSessionStorage: createSessionStorage, createHarness: createHarness, dispatchFrame: dispatchFrame, dispatchFrames: dispatchFrames, debugEntries: debugEntries, showdownDebugEntries: showdownDebugEntries, storageKeys: storageKeys });
