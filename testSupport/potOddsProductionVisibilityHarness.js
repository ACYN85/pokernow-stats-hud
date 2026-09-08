'use strict';

// A deliberately small browser-layout harness for pot-odds production tests.
// It loads the exact isolated-world manifest path, but unlike the older content
// harness it models geometry, connectivity, selectors, timers, and observers.

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var rootDir = path.join(__dirname, '..');
var manifest = require('../manifest.json');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function rect(left, top, width, height) {
  left = Number(left || 0); top = Number(top || 0); width = Number(width || 0); height = Number(height || 0);
  return { left: left, top: top, width: width, height: height, right: left + width, bottom: top + height, x: left, y: top };
}

function splitSelector(value, delimiter) {
  var parts = []; var current = ''; var bracket = 0; var paren = 0; var quote = null;
  for (var index = 0; index < value.length; index += 1) {
    var character = value[index];
    if (quote) {
      current += character;
      if (character === quote && value[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; current += character; continue; }
    if (character === '[') bracket += 1;
    if (character === ']') bracket -= 1;
    if (character === '(') paren += 1;
    if (character === ')') paren -= 1;
    if (!bracket && !paren && character === delimiter) { if (current.trim()) parts.push(current.trim()); current = ''; }
    else current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function selectorTokens(selector) {
  var tokens = []; var current = ''; var bracket = 0; var quote = null;
  for (var index = 0; index < selector.length; index += 1) {
    var character = selector[index];
    if (quote) {
      current += character;
      if (character === quote && selector[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; current += character; continue; }
    if (character === '[') bracket += 1;
    if (character === ']') bracket -= 1;
    if (!bracket && (character === '>' || /\s/.test(character))) {
      if (current.trim()) { tokens.push(current.trim()); current = ''; }
      if (character === '>') tokens.push('>');
      continue;
    }
    current += character;
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function simpleSelectorMatches(element, selector) {
  selector = String(selector || '').trim().replace(/^:scope/, '');
  if (!selector) return true;
  selector = selector.replace(/:not\([^)]*\)/g, '').replace(/:[\w-]+(?:\([^)]*\))?/g, '');
  var tagMatch = selector.match(/^([a-zA-Z][\w-]*|\*)/);
  if (tagMatch && tagMatch[1] !== '*' && element.tagName !== tagMatch[1].toUpperCase()) return false;
  var idMatches = Array.from(selector.matchAll(/#([\w-]+)/g));
  if (idMatches.some(function (match) { return element.id !== match[1]; })) return false;
  var classMatches = Array.from(selector.matchAll(/\.([\w-]+)/g));
  if (classMatches.some(function (match) { return !element.classList.contains(match[1]); })) return false;
  var attributes = Array.from(selector.matchAll(/\[\s*([^\]\s~|^$*=]+)\s*(?:(\^=|\$=|\*=|~=|=)\s*["']?([^"'\]\s]+)["']?\s*(i)?\s*)?\]/g));
  return attributes.every(function (match) {
    var actual = element.getAttribute(match[1]);
    if (!match[2]) return actual !== null;
    if (actual === null) return false;
    var expected = match[3] || '';
    if (match[4]) { actual = actual.toLowerCase(); expected = expected.toLowerCase(); }
    if (match[2] === '=') return actual === expected;
    if (match[2] === '^=') return actual.indexOf(expected) === 0;
    if (match[2] === '$=') return actual.slice(-expected.length) === expected;
    if (match[2] === '*=') return actual.indexOf(expected) >= 0;
    if (match[2] === '~=') return actual.split(/\s+/).includes(expected);
    return false;
  });
}

function complexSelectorMatches(element, selector) {
  var tokens = selectorTokens(selector);
  if (!tokens.length) return false;
  function matchAt(candidate, index) {
    if (!candidate || index < 0 || !simpleSelectorMatches(candidate, tokens[index])) return false;
    if (index === 0) return true;
    if (tokens[index - 1] === '>') return matchAt(candidate.parentElement, index - 2);
    var ancestor = candidate.parentElement;
    while (ancestor) {
      if (matchAt(ancestor, index - 1)) return true;
      ancestor = ancestor.parentElement;
    }
    return false;
  }
  return matchAt(element, tokens.length - 1);
}

function selectorMatches(element, selector) {
  return splitSelector(String(selector || ''), ',').some(function (part) { return complexSelectorMatches(element, part); });
}

function ClassList(element) { this.element = element; }
ClassList.prototype.values = function () { return String(this.element.className || '').trim().split(/\s+/).filter(Boolean); };
ClassList.prototype.contains = function (value) { return this.values().includes(String(value)); };
ClassList.prototype.add = function () {
  var values = new Set(this.values()); Array.from(arguments).forEach(function (value) { values.add(String(value)); });
  this.element.className = Array.from(values).join(' ');
};
ClassList.prototype.remove = function () {
  var removed = new Set(Array.from(arguments).map(String));
  this.element.className = this.values().filter(function (value) { return !removed.has(value); }).join(' ');
};
ClassList.prototype.toggle = function (value, force) {
  var present = this.contains(value); var enabled = force === undefined ? !present : Boolean(force);
  if (enabled) this.add(value); else this.remove(value); return enabled;
};
ClassList.prototype.forEach = function (callback) { this.values().forEach(callback); };
ClassList.prototype[Symbol.iterator] = function () { return this.values()[Symbol.iterator](); };

function Style() {}
Style.prototype.setProperty = function (name, value) { this[name] = String(value); };
Style.prototype.removeProperty = function (name) { delete this[name]; };

function FakeElement(tagName, document) {
  this.nodeType = 1;
  this.nodeName = String(tagName || 'div').toUpperCase();
  this.tagName = this.nodeName;
  this.ownerDocument = document;
  this.parentElement = null;
  this.children = [];
  this._attributes = {};
  this._id = '';
  this.className = '';
  this.classList = new ClassList(this);
  this.style = new Style();
  this.dataset = {};
  this.hidden = false;
  this.disabled = false;
  this.checked = false;
  this.open = false;
  this.value = '';
  this._textContent = '';
  this._innerHTML = '';
  this._rect = null;
  this._offsetWidth = null;
  this._offsetHeight = null;
  this._listeners = {};
}

Object.defineProperty(FakeElement.prototype, 'id', {
  get: function () { return this._id; },
  set: function (value) {
    if (this._id && this.ownerDocument.ids.get(this._id) === this) this.ownerDocument.ids.delete(this._id);
    this._id = String(value || ''); this._attributes.id = this._id;
    if (this._id && this.isConnected) this.ownerDocument.ids.set(this._id, this);
  }
});
Object.defineProperty(FakeElement.prototype, 'attributes', {
  get: function () { var self = this; return Object.keys(this._attributes).map(function (name) { return { name: name, value: self._attributes[name] }; }); }
});
Object.defineProperty(FakeElement.prototype, 'childNodes', { get: function () { return this.children.slice(); } });
Object.defineProperty(FakeElement.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
Object.defineProperty(FakeElement.prototype, 'isConnected', {
  get: function () {
    var current = this;
    while (current) { if (current === this.ownerDocument.documentElement) return true; current = current.parentElement; }
    return false;
  }
});
Object.defineProperty(FakeElement.prototype, 'textContent', {
  get: function () { return this._textContent || this.children.map(function (child) { return child.textContent; }).join(''); },
  set: function (value) { this._textContent = String(value === undefined || value === null ? '' : value); }
});
Object.defineProperty(FakeElement.prototype, 'innerText', {
  get: function () { return this.textContent; }, set: function (value) { this.textContent = value; }
});

function parseHtmlAttributes(element, source) {
  Array.from(String(source || '').matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)).forEach(function (match) {
    var name = match[1]; if (!name || name === element.tagName.toLowerCase()) return;
    element.setAttribute(name, match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : '');
  });
}

Object.defineProperty(FakeElement.prototype, 'innerHTML', {
  get: function () { return this._innerHTML; },
  set: function (value) {
    var html = String(value || '');
    this.children.slice().forEach(function (child) { child.remove(); });
    this._innerHTML = html; this._textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    var self = this;
    Array.from(html.matchAll(/<([a-zA-Z][\w-]*)([^>]*)>/g)).slice(0, 300).forEach(function (match) {
      var child = self.ownerDocument.createElement(match[1]); child._htmlMaterialized = true;
      parseHtmlAttributes(child, match[2]);
      if (child.classList.contains('pnhud-pot-odds')) { child._offsetWidth = 100; child._offsetHeight = 60; }
      self.appendChild(child);
    });
  }
});

Object.defineProperty(FakeElement.prototype, 'offsetWidth', {
  get: function () {
    if (this._offsetWidth !== null) return this._offsetWidth;
    if (this.classList.contains('pnhud-hero-pot-odds') || this.classList.contains('pnhud-pot-odds')) return 100;
    if (this.classList.contains('pnhud-seat-overlay')) return 132;
    return this._rect ? this._rect.width : 0;
  }, set: function (value) { this._offsetWidth = Number(value); }
});
Object.defineProperty(FakeElement.prototype, 'offsetHeight', {
  get: function () {
    if (this._offsetHeight !== null) return this._offsetHeight;
    if (this.classList.contains('pnhud-hero-pot-odds') || this.classList.contains('pnhud-pot-odds')) return 60;
    if (this.classList.contains('pnhud-seat-overlay')) return 18;
    return this._rect ? this._rect.height : 0;
  }, set: function (value) { this._offsetHeight = Number(value); }
});
Object.defineProperty(FakeElement.prototype, 'clientWidth', { get: function () { return this.offsetWidth; }, set: function (value) { this._offsetWidth = Number(value); } });
Object.defineProperty(FakeElement.prototype, 'clientHeight', { get: function () { return this.offsetHeight; }, set: function (value) { this._offsetHeight = Number(value); } });

FakeElement.prototype.setRect = function (value) { this._rect = value ? rect(value.left, value.top, value.width, value.height) : null; return this; };
FakeElement.prototype.getBoundingClientRect = function () {
  if (this._rect) return rect(this._rect.left, this._rect.top, this._rect.width, this._rect.height);
  var view = this.ownerDocument.defaultView;
  if (this === this.ownerDocument.documentElement || this === this.ownerDocument.body || this.id === 'pnhud-overlay-root' || this.id === 'pnhud-pot-odds-root') return rect(0, 0, view.innerWidth, view.innerHeight);
  if (this.classList.contains('pnhud-hero-pot-odds') && (this.style.left || this.style.top)) {
    return rect(Number.parseFloat(this.style.left || '0'), Number.parseFloat(this.style.top || '0'), this.offsetWidth, this.offsetHeight);
  }
  var transform = String(this.style.transform || ''); var translation = transform.match(/translate3d\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/i);
  if (translation) return rect(Number(translation[1]), Number(translation[2]), this.offsetWidth, this.offsetHeight);
  if (this.classList.contains('pnhud-pot-odds') && this.parentElement) {
    var parentRect = this.parentElement.getBoundingClientRect(); return rect(parentRect.left, parentRect.top, this.offsetWidth, this.offsetHeight);
  }
  return rect(0, 0, this.offsetWidth, this.offsetHeight);
};
FakeElement.prototype.getClientRects = function () { var value = this.getBoundingClientRect(); return this.isConnected && value.width > 0 && value.height > 0 && this.ownerDocument.defaultView.getComputedStyle(this).display !== 'none' ? [value] : []; };

FakeElement.prototype._connectTree = function () {
  if (this.id) this.ownerDocument.ids.set(this.id, this);
  this.children.forEach(function (child) { child._connectTree(); });
};
FakeElement.prototype._disconnectTree = function () {
  if (this.id && this.ownerDocument.ids.get(this.id) === this) this.ownerDocument.ids.delete(this.id);
  this.children.forEach(function (child) { child._disconnectTree(); });
};
FakeElement.prototype.appendChild = function (child) {
  if (child.parentElement) child.parentElement._detachChild(child, false);
  child.parentElement = this; this.children.push(child);
  if (this.isConnected) child._connectTree();
  this.ownerDocument._queueMutation({ type: 'childList', target: this, addedNodes: [child], removedNodes: [] });
  return child;
};
FakeElement.prototype.append = function () { var self = this; Array.from(arguments).forEach(function (child) { if (child && child.nodeType === 1) self.appendChild(child); }); };
FakeElement.prototype.insertBefore = function (child) { return this.appendChild(child); };
FakeElement.prototype._detachChild = function (child, notify) {
  var index = this.children.indexOf(child); if (index < 0) return child;
  this.children.splice(index, 1); child._disconnectTree(); child.parentElement = null;
  if (notify !== false) this.ownerDocument._queueMutation({ type: 'childList', target: this, addedNodes: [], removedNodes: [child] });
  return child;
};
FakeElement.prototype.removeChild = function (child) { return this._detachChild(child, true); };
FakeElement.prototype.remove = function () { if (this.parentElement) this.parentElement.removeChild(this); };
FakeElement.prototype.contains = function (candidate) { var current = candidate; while (current) { if (current === this) return true; current = current.parentElement; } return false; };
FakeElement.prototype.matches = function (selector) { return selectorMatches(this, selector); };
FakeElement.prototype.closest = function (selector) { var current = this; while (current) { if (current.matches(selector)) return current; current = current.parentElement; } return null; };
FakeElement.prototype.querySelectorAll = function (selector) {
  var matches = [];
  function visit(element) { element.children.forEach(function (child) { if (child.matches(selector)) matches.push(child); visit(child); }); }
  visit(this); return matches;
};
FakeElement.prototype.querySelector = function (selector) { return this.querySelectorAll(selector)[0] || null; };
FakeElement.prototype.setAttribute = function (name, value) {
  name = String(name); value = String(value); this._attributes[name] = value;
  if (name === 'id') this.id = value;
  else if (name === 'class') this.className = value;
  else if (name.indexOf('data-') === 0) this.dataset[name.slice(5).replace(/-([a-z])/g, function (_all, letter) { return letter.toUpperCase(); })] = value;
  this.ownerDocument._queueMutation({ type: 'attributes', target: this, attributeName: name, addedNodes: [], removedNodes: [] });
};
FakeElement.prototype.getAttribute = function (name) { return Object.prototype.hasOwnProperty.call(this._attributes, String(name)) ? this._attributes[String(name)] : null; };
FakeElement.prototype.hasAttribute = function (name) { return Object.prototype.hasOwnProperty.call(this._attributes, String(name)); };
FakeElement.prototype.removeAttribute = function (name) { delete this._attributes[String(name)]; };
FakeElement.prototype.addEventListener = function (type, listener) { (this._listeners[type] || (this._listeners[type] = [])).push(listener); };
FakeElement.prototype.removeEventListener = function (type, listener) { this._listeners[type] = (this._listeners[type] || []).filter(function (item) { return item !== listener; }); };
FakeElement.prototype.dispatchEvent = function (event) { (this._listeners[event.type] || []).slice().forEach(function (listener) { listener.call(this, event); }, this); return true; };
FakeElement.prototype.focus = function () { this.ownerDocument.activeElement = this; };
FakeElement.prototype.click = function () { this.dispatchEvent({ type: 'click', target: this, preventDefault: function () {}, stopPropagation: function () {} }); };
FakeElement.prototype.select = function () {};
FakeElement.prototype.compareDocumentPosition = function () { return 4; };

function FakeDocument() {
  this.ids = new Map(); this.hidden = false; this.visibilityState = 'visible'; this.activeElement = null; this._listeners = {};
  this._seatDiscoveryQueries = 0;
  this._mutationObservers = []; this._resizeObservers = []; this._mutationQueue = [];
  this.documentElement = new FakeElement('html', this); this.body = new FakeElement('body', this); this.documentElement.appendChild(this.body);
}
FakeDocument.prototype.createElement = function (tagName) { return new FakeElement(tagName, this); };
FakeDocument.prototype.createElementNS = function (_namespace, tagName) { return this.createElement(tagName); };
FakeDocument.prototype.getElementById = function (id) { var value = this.ids.get(String(id)); return value && value.isConnected ? value : null; };
FakeDocument.prototype.querySelectorAll = function (selector) { selector = String(selector); if (selector.indexOf('[data-seat], [data-seat-index]') === 0) this._seatDiscoveryQueries += 1; var values = []; if (this.documentElement.matches(selector)) values.push(this.documentElement); return values.concat(this.documentElement.querySelectorAll(selector)); };
FakeDocument.prototype.querySelector = function (selector) { return this.querySelectorAll(selector)[0] || null; };
FakeDocument.prototype.addEventListener = FakeElement.prototype.addEventListener;
FakeDocument.prototype.removeEventListener = FakeElement.prototype.removeEventListener;
FakeDocument.prototype.dispatchEvent = FakeElement.prototype.dispatchEvent;
FakeDocument.prototype.execCommand = function () { return true; };
FakeDocument.prototype._queueMutation = function (record) {
  if (!this.defaultView) return;
  this._mutationObservers.forEach(function (observer) {
    observer._observations.forEach(function (observation) {
      var relevantTarget = record.target === observation.target || (observation.options.subtree && observation.target.contains(record.target));
      var relevantType = record.type === 'childList' ? observation.options.childList : record.type === 'attributes' ? observation.options.attributes : observation.options.characterData;
      if (relevantTarget && relevantType) observer._records.push(record);
    });
  });
};
FakeDocument.prototype.flushMutationObservers = function (limit) {
  var delivered = 0; var max = Number(limit || 100);
  while (delivered < max) {
    var pending = this._mutationObservers.filter(function (observer) { return observer._records.length; });
    if (!pending.length) break;
    pending.forEach(function (observer) { var records = observer._records.splice(0); observer.callback(records, observer); delivered += 1; });
  }
  if (delivered >= max) throw new Error('mutation observer delivery did not quiesce');
  return delivered;
};
FakeDocument.prototype.elementsFromPoint = function (x, y) {
  return this.querySelectorAll('*').filter(function (element) {
    var style = element.ownerDocument.defaultView.getComputedStyle(element); var box = element.getBoundingClientRect();
    return element.isConnected && style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0 && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  }).reverse();
};
FakeDocument.prototype.elementFromPoint = function (x, y) { return this.elementsFromPoint(x, y)[0] || null; };

function eventTarget() {
  var listeners = {};
  return {
    listeners: listeners,
    addEventListener: function (type, listener) { (listeners[type] || (listeners[type] = [])).push(listener); },
    removeEventListener: function (type, listener) { listeners[type] = (listeners[type] || []).filter(function (item) { return item !== listener; }); },
    dispatch: function (type, event) { (listeners[type] || []).slice().forEach(function (listener) { listener(event || { type: type }); }); }
  };
}

function createSessionStorage(backing) {
  backing = backing || {};
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(backing, String(key)) ? String(backing[String(key)]) : null; },
    setItem: function (key, value) { backing[String(key)] = String(value); }, removeItem: function (key) { delete backing[String(key)]; },
    clear: function () { Object.keys(backing).forEach(function (key) { delete backing[key]; }); }, key: function (index) { return Object.keys(backing)[index] || null; },
    get length() { return Object.keys(backing).length; }
  };
}

function makeSeat(document, values) {
  var seat = document.createElement('div'); seat.className = 'table-player table-player-' + values.seatIndex + (values.extraClasses ? ' ' + values.extraClasses : '');
  seat.setAttribute('data-seat', values.seatIndex); seat.setAttribute('data-player-id', values.playerId); seat.setAttribute('data-player-name', values.name); seat.setRect(values.seatRect);
  var info = document.createElement('div'); info.className = 'table-player-infos-ctn'; info.setRect(values.infoRect);
  var name = document.createElement('div'); name.className = 'table-player-name'; name.textContent = values.name; name.setRect(values.nameRect);
  var link = document.createElement('a'); link.setAttribute('href', '/players/' + values.playerId); link.textContent = values.name; link.setRect(values.nameRect); name.appendChild(link);
  var stack = document.createElement('div'); stack.className = 'table-player-stack'; stack.setAttribute('data-stack', values.stack); stack.textContent = String(values.stack); stack.setRect(values.stackRect);
  info.appendChild(name); info.appendChild(stack); seat.appendChild(info); seat.textContent = values.name + '\n' + values.stack;
  return { seat: seat, info: info, name: name, link: link, stack: stack };
}

function cardRectsForLayout(layout) {
  if (layout === 'live-narrow') return [rect(600.2, 452.5, 74, 86.1), rect(650.2, 452.5, 74, 86.1)];
  if (layout === 'live-full') return [rect(658.2, 452.5, 74, 86.1), rect(708.2, 452.5, 74, 86.1)];
  if (layout === 'narrow') return [rect(730, 700, 44, 62), rect(778, 700, 44, 62)];
  return [rect(1180, 700, 44, 62), rect(1228, 700, 44, 62)];
}

function boardRectsForLayout(layout) {
  if (layout === 'live-narrow') return [rect(370, 250, 58, 80), rect(432, 250, 58, 80), rect(494, 250, 58, 80)];
  if (layout === 'live-full') return [rect(520, 260, 58, 80), rect(582, 260, 58, 80), rect(644, 260, 58, 80)];
  if (layout === 'narrow') return [rect(430, 360, 44, 62), rect(478, 360, 44, 62), rect(526, 360, 44, 62)];
  return [rect(760, 360, 44, 62), rect(808, 360, 44, 62), rect(856, 360, 44, 62)];
}

function fixtureGeometry(layout) {
  if (layout === 'live-narrow') return {
    heroSeat: rect(520, 395, 300, 235), heroInfo: rect(620, 555, 105, 42), heroName: rect(620, 555, 105, 20), heroStack: rect(620, 577, 105, 20),
    opponentSeat: rect(130, 90, 280, 200), opponentInfo: rect(220, 115, 100, 42), opponentName: rect(220, 115, 100, 20), opponentStack: rect(220, 137, 100, 20),
    cards: cardRectsForLayout('live-narrow'), action: rect(710, 585, 150, 44)
  };
  if (layout === 'live-full') return {
    heroSeat: rect(575, 395, 300, 235), heroInfo: rect(675, 555, 105, 42), heroName: rect(675, 555, 105, 20), heroStack: rect(675, 577, 105, 20),
    opponentSeat: rect(260, 90, 280, 200), opponentInfo: rect(350, 115, 100, 42), opponentName: rect(350, 115, 100, 20), opponentStack: rect(350, 137, 100, 20),
    cards: cardRectsForLayout('live-full'), action: rect(1030, 585, 170, 44)
  };
  if (layout === 'narrow') return {
    heroSeat: rect(610, 630, 330, 230), heroInfo: rect(715, 784, 105, 42), heroName: rect(715, 784, 105, 20), heroStack: rect(715, 806, 105, 20),
    opponentSeat: rect(250, 125, 300, 210), opponentInfo: rect(350, 150, 100, 42), opponentName: rect(350, 150, 100, 20), opponentStack: rect(350, 172, 100, 20),
    cards: cardRectsForLayout('narrow'), action: rect(875, 810, 160, 44)
  };
  return {
    heroSeat: rect(1060, 630, 340, 230), heroInfo: rect(1170, 784, 105, 42), heroName: rect(1170, 784, 105, 20), heroStack: rect(1170, 806, 105, 20),
    opponentSeat: rect(430, 125, 300, 210), opponentInfo: rect(530, 150, 100, 42), opponentName: rect(530, 150, 100, 20), opponentStack: rect(530, 172, 100, 20),
    cards: cardRectsForLayout('full'), action: rect(1325, 810, 160, 44)
  };
}

function createPokerNowFixture(document, options) {
  var fixture = { layout: options.layout || 'full', delayedCards: Boolean(options.delayedCards), liveCardDom: Boolean(options.liveCardDom), boardDom: Boolean(options.boardDom), persistentBoardSlot: Boolean(options.persistentBoardSlot) };
  fixture.table = document.createElement('main'); fixture.table.id = 'pokernow-table-fixture'; fixture.table.className = 'game-table';
  fixture.table.setRect(rect(0, 0, document.defaultView.innerWidth, document.defaultView.innerHeight));
  if (options.tableGeometryUnavailable) fixture.table.setRect(rect(0, 0, 0, 0));
  document.body.appendChild(fixture.table);
  var geometry = fixtureGeometry(fixture.layout);
  fixture.hero = makeSeat(document, { seatIndex: fixture.liveCardDom ? 1 : 6, playerId: 'playerA', name: 'playerA', stack: 420, seatRect: geometry.heroSeat, infoRect: geometry.heroInfo, nameRect: geometry.heroName, stackRect: geometry.heroStack, extraClasses: fixture.liveCardDom ? 'decision-current you-player' : '' });
  fixture.opponent = makeSeat(document, { seatIndex: 2, playerId: 'playerB', name: 'playerB', stack: 420, seatRect: geometry.opponentSeat, infoRect: geometry.opponentInfo, nameRect: geometry.opponentName, stackRect: geometry.opponentStack });
  fixture.table.appendChild(fixture.hero.seat); fixture.table.appendChild(fixture.opponent.seat);
  fixture.action = document.createElement('button'); fixture.action.className = 'table-action-call'; fixture.action.textContent = 'CALL 100'; fixture.action.setRect(geometry.action); fixture.table.appendChild(fixture.action);
  fixture.pot = document.createElement('div'); fixture.pot.className = 'table-pot-size'; fixture.pot.textContent = 'Pot 120'; fixture.pot.setRect(rect(610, 205, 80, 30)); fixture.table.appendChild(fixture.pot);

  function boardSlotRect(layout) {
    var values = boardRectsForLayout(layout);
    var first = values[0];
    var cardGap = values.length > 1 ? values[1].left - values[0].left : first.width + 4;
    return rect(first.left, first.top, first.width + cardGap * 4, first.height);
  }

  function boardWrapperRect(layout) {
    var slot = boardSlotRect(layout);
    return rect(slot.left - 90, slot.top - 20, slot.width + 194, slot.height + 40);
  }

  function mountBoardSlotOwner() {
    fixture.boardSlot = document.createElement('div');
    fixture.boardSlot.className = 'table-cards centered-community-wrapper';
    fixture.boardSlot.style.display = 'flex';
    fixture.boardSlot.style.justifyContent = 'center';
    fixture.boardSlot.setRect(boardWrapperRect(fixture.layout));
    var slotRect = boardSlotRect(fixture.layout);
    var pitch = (slotRect.width - boardRectsForLayout(fixture.layout)[0].width) / 4;
    fixture.boardSlots = Array.from({ length: 5 }, function (_unused, index) {
      var slot = document.createElement('div');
      slot.className = 'table-card-slot board-slot board-slot-' + (index + 1);
      slot.setAttribute('data-card-slot', String(index + 1));
      slot.setRect(rect(slotRect.left + pitch * index, slotRect.top, boardRectsForLayout(fixture.layout)[0].width, slotRect.height));
      fixture.boardSlot.appendChild(slot);
      return slot;
    });
    fixture.table.appendChild(fixture.boardSlot);
    return fixture.boardSlot;
  }

  if (fixture.persistentBoardSlot) {
    mountBoardSlotOwner();
  }

  fixture.mountCommunityBoard = function (cardRects, notify) {
    if (fixture.board && fixture.board.elements) fixture.board.elements.slice().forEach(function (card) { card.remove(); });
    if (!fixture.persistentBoardSlot && fixture.board && fixture.board.container.parentElement) fixture.board.container.remove();
    var values = cardRects || boardRectsForLayout(fixture.layout);
    var container = fixture.boardSlot || document.createElement('div');
    if (!fixture.boardSlot) container.className = 'table-community-cards';
    var union = values.length ? rect(values[0].left, values[0].top, values[values.length - 1].right - values[0].left, Math.max.apply(null, values.map(function (value) { return value.height; }))) : rect(0, 0, 0, 0);
    container.setRect(fixture.persistentBoardSlot ? boardWrapperRect(fixture.layout) : union);
    var cards = values.map(function (value, index) {
      var card = document.createElement('div'); card.className = 'card-container playing-card board-card board-card-' + (index + 1); card.setRect(value);
      var nested = document.createElement('div'); nested.className = 'card rank-suit-face'; card.appendChild(nested);
      if (fixture.persistentBoardSlot && fixture.boardSlots[index]) fixture.boardSlots[index].appendChild(card); else container.appendChild(card);
      return card;
    });
    if (!container.parentElement) fixture.table.appendChild(container); fixture.board = { container: container, elements: cards };
    if (notify !== false) document.flushMutationObservers();
    return fixture.board;
  };
  fixture.removeCommunityBoard = function (notify) {
    if (fixture.board && fixture.board.elements) fixture.board.elements.slice().forEach(function (card) { card.remove(); });
    if (!fixture.persistentBoardSlot && fixture.board && fixture.board.container.parentElement) fixture.board.container.remove();
    fixture.board = null;
    if (notify !== false) document.flushMutationObservers();
  };
  fixture.removeBoardSlotOwner = function (notify) {
    fixture.removeCommunityBoard(false);
    if (fixture.boardSlot && fixture.boardSlot.parentElement) fixture.boardSlot.remove();
    fixture.boardSlot = null; fixture.boardSlots = [];
    if (notify !== false) document.flushMutationObservers();
  };
  fixture.replaceBoardSlotOwner = function (notify) {
    var previous = fixture.boardSlot;
    var priorCards = fixture.board && fixture.board.elements ? fixture.board.elements.map(function (card) { return card.getBoundingClientRect(); }) : null;
    fixture.removeBoardSlotOwner(false);
    mountBoardSlotOwner();
    if (priorCards && priorCards.length) fixture.mountCommunityBoard(priorCards, false);
    if (notify !== false) document.flushMutationObservers();
    return { previous: previous, current: fixture.boardSlot };
  };
  fixture.restoreBoardSlotOwner = function (notify) {
    if (!fixture.boardSlot) mountBoardSlotOwner();
    if (notify !== false) document.flushMutationObservers();
    return fixture.boardSlot;
  };
  fixture.setPotGeometry = function (value) { fixture.pot.setRect(value || rect(0, 0, 0, 0)); };

  fixture.mountHeroCards = function (cardRects, notify) {
    if (fixture.cards && fixture.cards.container.parentElement) fixture.cards.container.remove();
    var values = cardRects || cardRectsForLayout(fixture.layout);
    var container = document.createElement('div'); container.className = fixture.liveCardDom ? 'hero-hole-area' : 'table-player-cards';
    var union = values.length ? rect(values[0].left, values[0].top, values[values.length - 1].right - values[0].left, Math.max.apply(null, values.map(function (value) { return value.height; }))) : rect(0, 0, 0, 0);
    container.setRect(union);
    var cards = values.map(function (value, index) {
      var card = document.createElement('div');
      card.className = fixture.liveCardDom ? 'card-container playing-card card-p' + (index + 1) + ' current-hole-card' : 'table-player-card hole-card card card-' + index;
      card.setRect(value);
      if (fixture.liveCardDom) { var nested = document.createElement('div'); nested.className = 'card rank-suit-face'; card.appendChild(nested); }
      container.appendChild(card);
      return card;
    });
    fixture.hero.seat.appendChild(container); fixture.cards = { container: container, elements: cards };
    if (notify !== false) document.flushMutationObservers();
    return fixture.cards;
  };
  fixture.replaceHeroSeat = function (cardRects, notify) {
    var previous = fixture.hero.seat;
    if (previous && previous.parentElement) previous.remove();
    fixture.hero = makeSeat(document, { seatIndex: fixture.liveCardDom ? 1 : 6, playerId: 'playerA', name: 'playerA', stack: 420, seatRect: geometry.heroSeat, infoRect: geometry.heroInfo, nameRect: geometry.heroName, stackRect: geometry.heroStack, extraClasses: fixture.liveCardDom ? 'decision-current you-player' : '' });
    fixture.table.appendChild(fixture.hero.seat);
    fixture.mountHeroCards(cardRects || cardRectsForLayout(fixture.layout), false);
    if (notify !== false) document.flushMutationObservers();
    return { previous: previous, current: fixture.hero.seat, cards: fixture.cards };
  };
  fixture.detachHeroSeat = function (notify) {
    if (fixture.hero.seat.parentElement) fixture.hero.seat.remove();
    if (notify !== false) document.flushMutationObservers();
    return fixture.hero.seat;
  };
  fixture.restoreHeroSeat = function (notify) {
    if (!fixture.hero.seat.parentElement) fixture.table.appendChild(fixture.hero.seat);
    if (notify !== false) document.flushMutationObservers();
    return fixture.hero.seat;
  };
  fixture.setTableGeometry = function (value, notify) {
    fixture.table.setRect(value || rect(0, 0, 0, 0));
    if (notify !== false) document.flushMutationObservers();
    return fixture.table.getBoundingClientRect();
  };
  fixture.setCardGeometry = function (values) {
    values = values || cardRectsForLayout(fixture.layout);
    fixture.cards.elements.forEach(function (card, index) { card.setRect(values[index] || rect(0, 0, 0, 0)); });
    fixture.cards.container.setRect(values.length ? rect(values[0].left, values[0].top, values[values.length - 1].right - values[0].left, Math.max.apply(null, values.map(function (value) { return value.height; }))) : rect(0, 0, 0, 0));
  };
  fixture.setLayout = function (layout) {
    fixture.layout = layout; var next = fixtureGeometry(layout);
    fixture.hero.seat.setRect(next.heroSeat); fixture.hero.info.setRect(next.heroInfo); fixture.hero.name.setRect(next.heroName); fixture.hero.link.setRect(next.heroName); fixture.hero.stack.setRect(next.heroStack);
    fixture.opponent.seat.setRect(next.opponentSeat); fixture.opponent.info.setRect(next.opponentInfo); fixture.opponent.name.setRect(next.opponentName); fixture.opponent.link.setRect(next.opponentName); fixture.opponent.stack.setRect(next.opponentStack);
    fixture.action.setRect(next.action); fixture.setCardGeometry(next.cards);
    if (fixture.boardSlot) {
      fixture.boardSlot.setRect(boardWrapperRect(layout));
      var nextSlot = boardSlotRect(layout); var pitch = (nextSlot.width - boardRectsForLayout(layout)[0].width) / 4;
      (fixture.boardSlots || []).forEach(function (slot, index) { slot.setRect(rect(nextSlot.left + pitch * index, nextSlot.top, boardRectsForLayout(layout)[0].width, nextSlot.height)); });
    }
    if (fixture.board) fixture.mountCommunityBoard(boardRectsForLayout(layout), false);
  };
  fixture.mountHeroCards(fixture.delayedCards ? [rect(0, 0, 0, 0), rect(0, 0, 0, 0)] : geometry.cards, false);
  if (fixture.boardDom) fixture.mountCommunityBoard(boardRectsForLayout(fixture.layout), false);
  return fixture;
}

function createHarness(options) {
  options = options || {};
  var gameId = options.gameId || 'pot-odds-production-visibility'; var clock = { now: Number(options.initialNow || 1000) };
  var windowEvents = eventTarget(); var visualViewportEvents = eventTarget(); var logs = []; var storage = clone(options.initialStorage || {}); var storageWrites = [];
  var timers = new Map(); var timerSequence = 0; var animationFrames = new Map(); var frameSequence = 0;
  var storageChangedListeners = []; var runtimeMessageListeners = [];
  var document = new FakeDocument();
  var viewport = options.viewport || (options.layout === 'narrow' ? { width: 1160, height: 900 } : { width: 1720, height: 900 });
  var location = { href: 'https://pokernow.com/games/' + gameId, protocol: 'https:', hostname: 'pokernow.com', pathname: '/games/' + gameId, origin: 'https://pokernow.com', search: '', hash: '' };
  var contextObject = {
    location: location, document: document, innerWidth: viewport.width, innerHeight: viewport.height, devicePixelRatio: 1,
    console: { log: function () { logs.push(Array.from(arguments)); }, warn: function () { logs.push(Array.from(arguments)); }, error: function () { logs.push(Array.from(arguments)); } },
    chrome: {
      runtime: { id: 'pot-odds-production-visibility-test', getManifest: function () { return manifest; }, lastError: null, onMessage: { addListener: function (listener) { runtimeMessageListeners.push(listener); }, removeListener: function (listener) { runtimeMessageListeners = runtimeMessageListeners.filter(function (item) { return item !== listener; }); } } },
      storage: {
        local: {
          get: function (_keys, callback) {
            if (Number(options.storageGetDelay || 0) > 0) contextObject.setTimeout(function () { callback(clone(storage)); }, Number(options.storageGetDelay));
            else callback(clone(storage));
          },
          set: function (update, callback) { var copied = clone(update); Object.assign(storage, copied); storageWrites.push(copied); if (callback) callback(); },
          remove: function (keys, callback) { (Array.isArray(keys) ? keys : [keys]).forEach(function (key) { delete storage[key]; }); if (callback) callback(); }
        },
        onChanged: { addListener: function (listener) { storageChangedListeners.push(listener); }, removeListener: function (listener) { storageChangedListeners = storageChangedListeners.filter(function (item) { return item !== listener; }); } }
      }
    },
    setTimeout: function (callback, delay) { timerSequence += 1; timers.set(timerSequence, { id: timerSequence, callback: callback, due: clock.now + Math.max(0, Number(delay || 0)), interval: null }); return timerSequence; },
    clearTimeout: function (id) { timers.delete(id); },
    setInterval: function (callback, delay) { timerSequence += 1; timers.set(timerSequence, { id: timerSequence, callback: callback, due: clock.now + Math.max(1, Number(delay || 1)), interval: Math.max(1, Number(delay || 1)) }); return timerSequence; },
    clearInterval: function (id) { timers.delete(id); },
    requestAnimationFrame: function (callback) { frameSequence += 1; animationFrames.set(frameSequence, callback); return frameSequence; },
    cancelAnimationFrame: function (id) { animationFrames.delete(id); },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; }, Event: function (type) { this.type = type; },
    Blob: Blob, URL: URL, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_POSITION_FOLLOWING: 4 },
    navigator: { userAgent: 'pot-odds-production-visibility-harness', clipboard: { writeText: function () { return Promise.resolve(); } } },
    performance: { now: function () { return clock.now; } }, alert: function () {}, confirm: function () { return true; }, prompt: function () { return ''; }
  };
  function HarnessDate() { var args = Array.from(arguments); if (!(this instanceof HarnessDate)) return Date.apply(null, args); if (!args.length) return new Date(clock.now); return new (Function.prototype.bind.apply(Date, [null].concat(args)))(); }
  HarnessDate.now = function () { return clock.now; }; HarnessDate.parse = Date.parse; HarnessDate.UTC = Date.UTC; HarnessDate.prototype = Date.prototype; contextObject.Date = HarnessDate;
  contextObject.getComputedStyle = function (element) {
    var style = element && element.style || {}; var id = element && element.id; var classes = element && element.classList;
    var display = element && element.hidden ? 'none' : style.display || (classes && classes.contains('pnhud-pot-odds') ? 'inline-grid' : classes && classes.contains('pnhud-seat-overlay') ? 'flex' : 'block');
    if (classes && classes.contains('pnhud-no-visible-stats')) display = 'none';
    return {
      display: display, visibility: style.visibility || 'visible', opacity: style.opacity === undefined ? '1' : String(style.opacity),
      pointerEvents: style.pointerEvents || ((id === 'pnhud-pot-odds-root' || id === 'pnhud-overlay-root') ? 'none' : 'auto'),
      position: style.position || ((id === 'pnhud-pot-odds-root' || id === 'pnhud-overlay-root' || classes && classes.contains('pnhud-hero-pot-odds')) ? 'fixed' : 'static'),
      zIndex: style.zIndex || (id === 'pnhud-pot-odds-root' ? '2147483644' : 'auto'), transform: style.transform || 'none',
      overflow: style.overflow || 'visible', overflowX: style.overflowX || style.overflow || 'visible', overflowY: style.overflowY || style.overflow || 'visible',
      contain: style.contain || ((id === 'pnhud-pot-odds-root' || id === 'pnhud-overlay-root') ? 'layout style' : 'none'), zoom: style.zoom || '1', filter: style.filter || 'none', clip: style.clip || 'auto', clipPath: style.clipPath || 'none'
    };
  };
  contextObject.MutationObserver = function (callback) { this.callback = callback; this._records = []; this._observations = []; document._mutationObservers.push(this); };
  contextObject.MutationObserver.prototype.observe = function (target, observerOptions) { this._observations.push({ target: target, options: observerOptions || {} }); };
  contextObject.MutationObserver.prototype.disconnect = function () { this._records = []; this._observations = []; };
  contextObject.ResizeObserver = function (callback) { this.callback = callback; this.targets = new Set(); document._resizeObservers.push(this); };
  contextObject.ResizeObserver.prototype.observe = function (target) { this.targets.add(target); };
  contextObject.ResizeObserver.prototype.unobserve = function (target) { this.targets.delete(target); };
  contextObject.ResizeObserver.prototype.disconnect = function () { this.targets.clear(); };
  contextObject.visualViewport = { width: viewport.width, height: viewport.height, addEventListener: visualViewportEvents.addEventListener, removeEventListener: visualViewportEvents.removeEventListener };
  contextObject.sessionStorage = createSessionStorage(options.sessionStorageBacking || {});
  contextObject.window = contextObject; contextObject.self = contextObject; contextObject.globalThis = contextObject;
  contextObject.addEventListener = windowEvents.addEventListener; contextObject.removeEventListener = windowEvents.removeEventListener;
  document.defaultView = contextObject;
  var fixture = createPokerNowFixture(document, options);
  var context = vm.createContext(contextObject); var contextWindow = vm.runInContext('window', context);
  contextObject.postMessage = function (data) { windowEvents.dispatch('message', { source: contextWindow, origin: location.origin, data: data }); };

  var isolatedScripts = manifest.content_scripts.find(function (entry) { return entry.world !== 'MAIN' && entry.js.includes('content.js'); }).js;
  var evaluationErrors = [];
  isolatedScripts.forEach(function (file) {
    try { vm.runInContext(fs.readFileSync(path.join(rootDir, file), 'utf8'), context, { filename: file }); }
    catch (error) { evaluationErrors.push({ file: file, message: error.message, stack: error.stack }); }
  });

  function runDueTimers(target, max) {
    var executed = 0; var maximum = Number(max || 10000);
    while (executed < maximum) {
      var next = Array.from(timers.values()).filter(function (timer) { return timer.due <= target; }).sort(function (left, right) { return left.due - right.due || left.id - right.id; })[0];
      if (!next) break;
      clock.now = Math.max(clock.now, next.due);
      if (next.interval === null) timers.delete(next.id); else next.due += next.interval;
      next.callback(); executed += 1; document.flushMutationObservers();
    }
    if (executed >= maximum) throw new Error('controlled timer queue did not quiesce');
    clock.now = target; return executed;
  }
  function flushAnimationFrameBatch() {
    if (!animationFrames.size) return 0;
    var pending = Array.from(animationFrames.entries()); animationFrames.clear();
    pending.forEach(function (entry) { entry[1](clock.now); }); document.flushMutationObservers(); return pending.length;
  }
  function runFor(milliseconds, step) {
    var end = clock.now + Number(milliseconds || 0); var tick = Math.max(1, Number(step || 16)); var executed = { timers: 0, frames: 0, mutations: 0 };
    while (clock.now < end) {
      var next = Math.min(end, clock.now + tick); executed.timers += runDueTimers(next); executed.mutations += document.flushMutationObservers(); executed.frames += flushAnimationFrameBatch(); executed.mutations += document.flushMutationObservers();
    }
    return executed;
  }
  return {
    gameId: gameId, context: context, contextWindow: contextWindow, document: document, fixture: fixture, logs: logs, storage: storage, storageWrites: storageWrites,
    isolatedScripts: isolatedScripts, evaluationErrors: evaluationErrors,
    evaluate: function (expression) { return vm.runInContext(String(expression), context); }, now: function () { return clock.now; },
    runFor: runFor, advanceTime: function (milliseconds) { return runDueTimers(clock.now + Number(milliseconds || 0)); },
    flushAnimationFrameBatch: flushAnimationFrameBatch,
    flushAnimationFrames: function (limit) { var count = 0; var max = Number(limit || 100); while (animationFrames.size && count < max) { clock.now += 16; count += flushAnimationFrameBatch(); } return { executed: count, pending: animationFrames.size }; },
    flushMutationObservers: function () { return document.flushMutationObservers(); },
    pendingWork: function () { return { timers: timers.size, animationFrames: animationFrames.size, mutationRecords: document._mutationObservers.reduce(function (sum, observer) { return sum + observer._records.length; }, 0) }; },
    triggerResizeObserver: function (element) { document._resizeObservers.filter(function (observer) { return observer.targets.has(element); }).forEach(function (observer) { observer.callback([{ target: element, contentRect: element.getBoundingClientRect() }], observer); }); },
    setViewport: function (width, height, dispatchResize) { contextObject.innerWidth = Number(width); contextObject.innerHeight = Number(height); contextObject.visualViewport.width = Number(width); contextObject.visualViewport.height = Number(height); fixture.table.setRect(rect(0, 0, Number(width), Number(height))); if (dispatchResize !== false) windowEvents.dispatch('resize', { type: 'resize' }); },
    dispatchWindowEvent: function (type) { windowEvents.dispatch(type, { type: type }); },
    emitStorageChange: function (changes) { storageChangedListeners.slice().forEach(function (listener) { listener(changes, 'local'); }); },
    count: function (selector) { return document.querySelectorAll(selector).length; },
    seatDiscoveryQueryCount: function () { return document._seatDiscoveryQueries; }
  };
}

function socket(eventName, payload) { return '42[' + JSON.stringify(eventName) + ',' + JSON.stringify(payload) + ']'; }
function dispatchFrame(harness, rawPayload, frameId, capturedAt) {
  var at = Number(capturedAt || harness.now());
  harness.dispatchWindowEvent;
  harness.contextWindow.postMessage({
    source: 'pokernow-stats-hud-main', type: 'websocket-frame', frameId: String(frameId || 'fixture-frame'), hookInstanceId: 'pot-odds-production-visibility-hook', capturedAt: at, framesCaptured: 1,
    socketId: 'socket-pot-odds-fixture', socketUrl: 'wss://example.invalid/socket', direction: 'incoming', dataType: 'string', data: rawPayload, binaryBytes: null
  }, 'https://pokernow.com');
}

function call100State() {
  return {
    hI: 'LIVE-CALL-100', gT: ['holdem', 1], pot: 460, tB: { playerA: 'check', playerB: 100 }, cPI: 'playerA', pITT: 'playerA', iHPI: ['playerA', 'playerB'],
    pGS: { playerA: 'inGame', playerB: 'inGame' }, players: { playerA: { id: 'playerA', name: 'playerA', stack: 420 }, playerB: { id: 'playerB', name: 'playerB', stack: 420 } }
  };
}
function dispatchRegisteredCall100(harness, capturedAt) {
  dispatchFrame(harness, socket('registered', { currentPlayer: { id: 'playerA', name: 'playerA', stack: 420 }, gameState: call100State() }), 'registered-call100', capturedAt || harness.now());
}
function dispatchIdle(harness, capturedAt) { dispatchFrame(harness, socket('gC', { cPI: 'playerB', pITT: 'playerB' }), 'actor-advanced', capturedAt || harness.now()); }
function debugValue(harness, expression) { return JSON.parse(harness.evaluate('JSON.stringify(' + expression + ')')); }
function decision(harness) { return debugValue(harness, 'PokerNowHUDPotOdds.currentDecision()'); }
function placement(harness) { return debugValue(harness, 'PokerNowHUDPotOdds.placementInfo()'); }
function timeline(harness) { return debugValue(harness, 'PokerNowHUDPotOdds.debugTimeline()'); }
function actualDomVisibility(harness) {
  var host = harness.document.getElementById('pnhud-hero-pot-odds'); var pill = host && host.querySelector('.pnhud-pot-odds');
  if (!host || !pill) return { visible: false, host: host, pill: pill, hostRect: null, pillRect: null };
  var hostRect = host.getBoundingClientRect(); var pillRect = pill.getBoundingClientRect(); var hostStyle = harness.contextWindow.getComputedStyle(host); var pillStyle = harness.contextWindow.getComputedStyle(pill);
  return {
    visible: Boolean(host.isConnected && pill.isConnected && !host.hidden && hostRect.width > 0 && hostRect.height > 0 && pillRect.width > 0 && pillRect.height > 0 && pillRect.right > 0 && pillRect.bottom > 0 && pillRect.left < harness.contextWindow.innerWidth && pillRect.top < harness.contextWindow.innerHeight && hostStyle.display !== 'none' && hostStyle.visibility !== 'hidden' && Number(hostStyle.opacity) > 0.01 && pillStyle.display !== 'none' && pillStyle.visibility !== 'hidden' && Number(pillStyle.opacity) > 0.01),
    host: host, pill: pill, hostRect: hostRect, pillRect: pillRect, hostStyle: hostStyle, pillStyle: pillStyle
  };
}

module.exports = Object.freeze({
  clone: clone, rect: rect, createHarness: createHarness, socket: socket, dispatchFrame: dispatchFrame, dispatchRegisteredCall100: dispatchRegisteredCall100,
  dispatchIdle: dispatchIdle, call100State: call100State, decision: decision, placement: placement, timeline: timeline, actualDomVisibility: actualDomVisibility,
  cardRectsForLayout: cardRectsForLayout, boardRectsForLayout: boardRectsForLayout, fixtureGeometry: fixtureGeometry
});
