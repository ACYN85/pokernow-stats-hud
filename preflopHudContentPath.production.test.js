'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var manifest = require('./manifest.json');
var fixture = require('./fixtures/capture-derived-preflop/a1-open-3bet-fold.sanitized.json');
var gameId = 'live-preflop-regression';
var gameSessionKey = 'game:pokernow.com%3A' + gameId;
var schemaKey = 'pokerNowHudLiveSchemaVersion:' + gameSessionKey;
var playerMapKey = 'pokerNowHudPlayerMap:' + gameSessionKey;
var liveEventsKey = 'pokerNowHudLiveEvents:' + gameSessionKey;

function FakeElement(tag, document) {
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
  this.className = '';
  this.textContent = '';
  this.innerHTML = '';
  this.value = '';
  this.checked = false;
  this.disabled = false;
  this.open = false;
  this.scrollTop = 0;
  this.scrollHeight = 0;
  this.clientHeight = 0;
  this.clientWidth = 0;
  this.offsetWidth = 0;
  this.offsetHeight = 0;
  this.classList = {
    add: function () {},
    remove: function () {},
    toggle: function () {},
    contains: function () { return false; }
  };
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
FakeElement.prototype.remove = function () {
  this.isConnected = false;
  if (this.id) this.ownerDocument.elements.delete(this.id);
};
FakeElement.prototype.addEventListener = function () {};
FakeElement.prototype.removeEventListener = function () {};
FakeElement.prototype.setAttribute = function (name, value) {
  this.attributes[name] = String(value);
  if (name === 'id') this.id = value;
};
FakeElement.prototype.getAttribute = function (name) { return this.attributes[name] || null; };
FakeElement.prototype.removeAttribute = function (name) { delete this.attributes[name]; };
FakeElement.prototype.querySelector = function () {
  var child = new FakeElement('button', this.ownerDocument);
  child.isConnected = true;
  return child;
};
FakeElement.prototype.querySelectorAll = function () { return []; };
FakeElement.prototype.closest = function () { return null; };
FakeElement.prototype.contains = function () { return false; };
FakeElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
};
FakeElement.prototype.focus = function () {};
FakeElement.prototype.click = function () {};

function createDocument() {
  var document = { elements: new Map(), hidden: false, visibilityState: 'visible' };
  document.body = new FakeElement('body', document);
  document.body.isConnected = true;
  document.documentElement = document.body;
  document.createElement = function (tag) { return new FakeElement(tag, document); };
  document.getElementById = function (id) { return document.elements.get(String(id)) || null; };
  document.querySelector = function () { return null; };
  document.querySelectorAll = function () { return []; };
  document.addEventListener = function () {};
  document.removeEventListener = function () {};
  document.dispatchEvent = function () { return true; };
  document.elementFromPoint = function () { return null; };
  return document;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createHarness(initialStorage, debugEnabled) {
  var listeners = {};
  var logs = [];
  var storage = clone(initialStorage || {});
  var storageWrites = [];
  var location = {
    href: 'https://pokernow.com/games/' + gameId,
    protocol: 'https:',
    hostname: 'pokernow.com',
    pathname: '/games/' + gameId,
    origin: 'https://pokernow.com',
    search: '',
    hash: ''
  };
  var document = createDocument();
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
        id: 'preflop-content-path-test',
        getManifest: function () { return manifest; },
        lastError: null,
        onMessage: { addListener: function () {}, removeListener: function () {} }
      },
      storage: {
        local: {
          get: function (_keys, callback) { callback(clone(storage)); },
          set: function (update, callback) {
            var copied = clone(update);
            Object.assign(storage, copied);
            storageWrites.push(copied);
            if (callback) callback();
          },
          remove: function (keys, callback) {
            (Array.isArray(keys) ? keys : [keys]).forEach(function (key) { delete storage[key]; });
            if (callback) callback();
          }
        },
        onChanged: { addListener: function () {}, removeListener: function () {} }
      }
    },
    setTimeout: function () { return 1; },
    clearTimeout: function () {},
    setInterval: function () { return 1; },
    clearInterval: function () {},
    requestAnimationFrame: function () { return 1; },
    cancelAnimationFrame: function () {},
    MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    ResizeObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    Blob: Blob,
    URL: URL,
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    Event: function (type) { this.type = type; },
    getComputedStyle: function () {
      return { position: 'static', overflowY: 'visible', opacity: '1', display: 'block', visibility: 'visible' };
    },
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    navigator: { userAgent: 'content-path-production-test' }
  };
  if (debugEnabled) contextObject.__PNHUD_PREFLOP_DEBUG__ = true;
  contextObject.window = contextObject;
  contextObject.globalThis = contextObject;
  contextObject.addEventListener = function (type, listener) {
    (listeners[type] || (listeners[type] = [])).push(listener);
  };
  contextObject.removeEventListener = function () {};

  var context = vm.createContext(contextObject);
  var contextWindow = vm.runInContext('window', context);
  contextObject.postMessage = function (data) {
    (listeners.message || []).slice().forEach(function (listener) {
      listener({ source: contextWindow, origin: location.origin, data: data });
    });
  };

  var isolatedScripts = manifest.content_scripts.find(function (entry) {
    return entry.world !== 'MAIN' && entry.js.includes('content.js');
  }).js;
  var evaluationErrors = [];
  isolatedScripts.forEach(function (file) {
    try {
      vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context, { filename: file });
    } catch (error) {
      evaluationErrors.push({ file: file, message: error.message, stack: error.stack });
    }
  });

  return {
    context: context,
    contextWindow: contextWindow,
    listeners: listeners,
    logs: logs,
    storage: storage,
    storageWrites: storageWrites,
    isolatedScripts: isolatedScripts,
    evaluationErrors: evaluationErrors
  };
}

function debugEntries(harness, stage) {
  return harness.logs.filter(function (call) {
    return call[0] === '[PNHUD PREFLOP DEBUG]' && call[1] && (!stage || call[1].stage === stage);
  }).map(function (call) { return call[1]; });
}

function dispatchFrame(harness, rawPayload, index) {
  (harness.listeners.message || []).slice().forEach(function (listener) {
    listener({
      source: harness.contextWindow,
      origin: 'https://pokernow.com',
      data: {
        source: 'pokernow-stats-hud-main',
        type: 'websocket-frame',
        frameId: 'authoritative-a1-' + index,
        hookInstanceId: 'content-path-hook',
        capturedAt: 1000 + index,
        framesCaptured: index,
        socketId: 'socket-1',
        socketUrl: 'wss://example.invalid/socket',
        direction: 'incoming',
        dataType: 'string',
        data: rawPayload,
        binaryBytes: null
      }
    });
  });
}

function realisticA1Frames() {
  var firstPayload = JSON.parse(fixture.frames[0].rawPayload.slice(fixture.frames[0].rawPayload.indexOf('[')));
  var targetInitialState = firstPayload[1].gameState;
  var predealState = clone(targetInitialState);
  Object.assign(predealState, {
    hI: '<D>',
    gT: [0, 0],
    pot: 0,
    tB: {},
    iHPI: [],
    pC: {},
    cPI: '<D>',
    pITT: '<D>',
    sBPI: '<D>',
    bBPI: '<D>'
  });
  return [
    '42["registered",' + JSON.stringify({ gameState: predealState }) + ']',
    '42["gC",' + JSON.stringify(targetInitialState) + ']'
  ].concat(fixture.frames.slice(1).map(function (frame) { return frame.rawPayload; }));
}

var initialStorage = {};
initialStorage[schemaKey] = 4;
initialStorage[playerMapKey] = { P1: 'P1', P2: 'P2' };

var harness = createHarness(initialStorage, true);
assert.deepStrictEqual(harness.evaluationErrors, [], 'the exact isolated-world manifest order initializes content.js without an exception');
assert.strictEqual(harness.isolatedScripts[harness.isolatedScripts.length - 1], 'content.js', 'content.js remains last in its dependency order');
assert.ok((harness.listeners.message || []).length > 0, 'the real content-script WebSocket bridge listener is installed');

realisticA1Frames().forEach(function (rawPayload, index) {
  dispatchFrame(harness, rawPayload, index + 1);
});

var pipelineErrors = harness.logs.filter(function (call) {
  return call[0] === '[HUD] websocket frame processing error' ||
    call[0] === '[HUD PIPELINE FAILURE]' ||
    call[0] === '[HUD] initialization error';
});
assert.deepStrictEqual(pipelineErrors, [], 'the browser content-script pipeline completes without startup or frame-processing errors');

var semanticFinalization = debugEntries(harness, 'semantic-finalization').find(function (entry) {
  return entry.finalized && entry.handIdentity && entry.handIdentity.handId === fixture.scenario.targetHandId;
});
assert.ok(semanticFinalization, 'the live pipeline finalizes the authoritative A1 semantic hand');
assert.ok(semanticFinalization.lifecycleHandId.includes(gameId + ':socket:'), 'the live lifecycle owns a synthetic hand ID');
assert.strictEqual(semanticFinalization.handIdentity.lifecycleHandId, semanticFinalization.lifecycleHandId);
assert.notStrictEqual(semanticFinalization.handIdentity.handId, semanticFinalization.lifecycleHandId, 'the regression preserves the live authoritative/lifecycle ID mismatch');
assert.strictEqual(semanticFinalization.playerIds.length, 2, 'semantic diagnostics identify both players');
assert.ok(semanticFinalization.preflopActions.length >= 3, 'semantic diagnostics expose recognized preflop actions');

var reducer = debugEntries(harness, 'reducer-invocation').find(function (entry) {
  return entry.phase === 'after' && entry.reduced;
});
assert.ok(reducer, 'content.js invokes the reducer after live semantic finalization');
assert.strictEqual(reducer.contributions.P1.threeBet.opportunityCount, 1);
assert.strictEqual(reducer.contributions.P1.threeBet.madeCount, 1);
assert.strictEqual(reducer.contributions.P2.foldToThreeBet.opportunityCount, 1);
assert.strictEqual(reducer.contributions.P2.foldToThreeBet.foldCount, 1);

var attachment = debugEntries(harness, 'contribution-attachment').find(function (entry) {
  return entry.playerId === 'P1' && entry.attached;
});
assert.ok(attachment, 'the reducer contribution attaches to the finalized live event');
assert.strictEqual(attachment.targetHandId, semanticFinalization.lifecycleHandId, 'attachment targets the consumed lifecycle event');
assert.deepStrictEqual(JSON.parse(JSON.stringify(attachment.candidateHandIds)), [
  semanticFinalization.lifecycleHandId,
  fixture.scenario.targetHandId
], 'both stable hand-identity aliases participate in matching');
assert.deepStrictEqual(JSON.parse(JSON.stringify(attachment.after)), {
  threeBetMade: 1,
  threeBetOpportunities: 1,
  foldToThreeBet: 0,
  foldToThreeBetOpportunities: 0
});

var ingestion = debugEntries(harness, 'stats-ingestion').find(function (entry) {
  return entry.playerId === 'P1' && entry.attached;
});
assert.ok(ingestion, 'stats.js receives the content-script attachment');
assert.strictEqual(ingestion.contributionFieldsPresent, true);
assert.strictEqual(ingestion.rejectedAsDuplicate, false);
assert.deepStrictEqual(JSON.parse(JSON.stringify(ingestion.before)), {
  threeBetMade: 0,
  threeBetOpportunities: 0,
  foldToThreeBet: 0,
  foldToThreeBetOpportunities: 0
});
assert.strictEqual(ingestion.after.threeBetMade, 1);
assert.strictEqual(ingestion.after.threeBetOpportunities, 1);

var persistedEvents = harness.storage[liveEventsKey];
assert.ok(Array.isArray(persistedEvents) && persistedEvents.length > 0, 'the authoritative live event array is persisted');
var persistedP1 = persistedEvents.find(function (event) {
  return event.playerId === 'P1' && event.handId === semanticFinalization.lifecycleHandId;
});
assert.ok(persistedP1, 'the persisted player event uses the finalized lifecycle identity');
assert.deepStrictEqual([
  persistedP1.threeBetMade,
  persistedP1.threeBetOpportunities,
  persistedP1.foldToThreeBet,
  persistedP1.foldToThreeBetOpportunities
], [1, 1, 0, 0], 'a real 3Bet changes stored HUD state from 0/0');

var persistenceSave = debugEntries(harness, 'persistence-save').find(function (entry) {
  return entry.savedCounters && entry.savedCounters.some(function (player) {
    return player.playerId === 'P1' && player.counters.threeBetMade === 1 && player.counters.threeBetOpportunities === 1;
  });
});
assert.ok(persistenceSave, 'persistence diagnostics expose the saved four counters by stable player ID');

var hudRender = debugEntries(harness, 'hud-render').find(function (entry) {
  return entry.playerId === 'P1' &&
    entry.rawCounters.threeBetMade === 1 &&
    entry.rawCounters.threeBetOpportunities === 1;
});
assert.ok(hudRender, 'the production HUD lookup reads the integrated player record');
assert.strictEqual(hudRender.formattedThreeBet, '100% (1/1)');
assert.strictEqual(hudRender.formattedFoldToThreeBet, '--- (0/0)');

var restored = createHarness(harness.storage, true);
assert.deepStrictEqual(restored.evaluationErrors, [], 'reload initializes from the persisted production state');
var persistenceRestore = debugEntries(restored, 'persistence-restore').find(function (entry) {
  return entry.restoredCounters && entry.restoredCounters.some(function (player) {
    return player.playerId === 'P1' && player.counters.threeBetMade === 1 && player.counters.threeBetOpportunities === 1;
  });
});
assert.ok(persistenceRestore, 'reload diagnostics expose the restored four counters');

var defaultQuiet = createHarness(harness.storage, false);
assert.deepStrictEqual(defaultQuiet.evaluationErrors, []);
assert.strictEqual(debugEntries(defaultQuiet).length, 0, 'verbose preflop diagnostics are disabled by default');

console.log('Production content-script preflop handoff regression passed.');
