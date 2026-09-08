'use strict';
var assert = require('assert');
var fs = require('fs');

var content = fs.readFileSync('./content.js', 'utf8');
var css = fs.readFileSync('./hud.css', 'utf8');

function sourceFunction(name) {
  var start = content.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name + ' must exist in production content');
  var brace = content.indexOf('{', start); var depth = 0;
  for (var index = brace; index < content.length; index += 1) {
    if (content[index] === '{') depth += 1;
    if (content[index] === '}') { depth -= 1; if (depth === 0) return content.slice(start, index + 1); }
  }
  throw new Error('unterminated production function ' + name);
}

var productionFunctions = [
  'applyOverlayDragState', 'persistManualOverlayPositions', 'recordOverlayDragTrace', 'persistFinishedOverlayDrag',
  'finishOverlayDrag', 'cancelOverlayDrag', 'moveOverlayDrag', 'beginOverlayDrag',
  'installDragBehavior', 'cleanupDragBehavior'
].map(sourceFunction).join('\n');

function classList() {
  var values = new Set();
  return { add: function (value) { values.add(value); }, remove: function (value) { values.delete(value); }, toggle: function (value, enabled) { if (enabled) values.add(value); else values.delete(value); }, contains: function (value) { return values.has(value); } };
}
function Target() { this.listeners = {}; }
Target.prototype.addEventListener = function (type, listener) { (this.listeners[type] || (this.listeners[type] = [])).push(listener); };
Target.prototype.removeEventListener = function (type, listener) { this.listeners[type] = (this.listeners[type] || []).filter(function (item) { return item !== listener; }); };
Target.prototype.emit = function (type, value) { (this.listeners[type] || []).slice().forEach(function (listener) { listener(value); }); };
function Grip() { Target.call(this); this.disabled = false; this.capture = null; }
Grip.prototype = Object.create(Target.prototype);
Grip.prototype.closest = function (selector) { return selector === '.pnhud-overlay-grip' ? this : null; };
Grip.prototype.setPointerCapture = function (pointerId) { this.capture = pointerId; };
function OtherTarget(kind) { this.kind = kind; }
OtherTarget.prototype.closest = function (selector) { return selector === '.pnhud-player-name' && this.kind === 'name' ? this : null; };
function event(target, values) { return Object.assign({ target: target, button: 0, clientX: 10, clientY: 10, prevented: false, stopped: false, preventDefault: function () { this.prevented = true; }, stopPropagation: function () { this.stopped = true; } }, values || {}); }

function exercise(mode, pointerSupported) {
  var documentTarget = new Target(); documentTarget.documentElement = { classList: classList() };
  var writes = []; var opened = [];
  var element = new Target(); element.classList = classList(); element.dataset = { pnhudPlayerId: 'stable-player' }; element.style = {}; element.grip = new Grip();
  element.querySelector = function (selector) { return selector === '.pnhud-overlay-grip' ? this.grip : null; };
  element.contains = function (node) { return node === this.grip; };
  element.getBoundingClientRect = function () { return { left: 100, top: 80, width: 180, height: 22 }; };
  element.mode = mode;
  var record = { entry: { playerId: 'stable-player', seatId: 'seat-1', rect: { left: 50, top: 40, width: 80, height: 20 } }, canonicalPlacement: { left: 50, top: 40, width: 180, height: 22 }, lastPlacement: { left: 100, top: 80, width: 180, height: 22 } };
  var factory = new Function('document', 'window', 'chrome', 'PokerSeatOverlay', 'seatOverlayController', 'scheduleNativePanelOcclusion', 'scheduleHeroPotOddsAnchorReconcile', 'openPlayerDashboard', 'closeStatTooltip', productionFunctions + '\n' +
    'var overlayDraggingUnlocked=true, activeOverlayDrag=null, overlayDragBehaviors=new WeakMap(), overlayDragTraceSequence=0, overlayDragTimeline=[], deferredSeatDiscoveryDuringOverlayDrag=null, deferredSeatReconcileDuringOverlayDrag=null, manualOverlayPositions={}, STORAGE_KEYS={manualOverlayPositions:"positions"}, pokerNowGameId="game", storageNamespace="table";' +
    'return {install:installDragBehavior, active:function(){return activeOverlayDrag;}, positions:function(){return manualOverlayPositions;}};');
  var api = factory(documentTarget, { innerWidth: 1000, innerHeight: 700, PointerEvent: pointerSupported ? function () {} : undefined }, { storage: { local: { set: function (value) { writes.push(JSON.parse(JSON.stringify(value))); } } } }, {
    clampPlacement: function (placement) { return placement; },
    accessibleSeatHudPlacement: function (placement) { return placement; },
    relativeOffset: function (anchor, placement) { return { offsetX: placement.left - anchor.left, offsetY: placement.top - anchor.top }; }
  }, { records: new Map([['stable-player', record]]) }, function () {}, function () {}, function (id) { opened.push(id); }, function () {});
  api.install(element, 'stable-player');
  assert.strictEqual(element.grip.disabled, false, mode + ' grip is enabled while dragging is unlocked');
  ['name', 'profile', 'stat'].forEach(function (kind) {
    element.emit(pointerSupported ? 'pointerdown' : 'mousedown', event(new OtherTarget(kind), pointerSupported ? { pointerId: 2 } : {}));
    assert.strictEqual(api.active(), null, kind + ' cannot start ' + mode + ' drag');
  });
  var down = event(element.grip, pointerSupported ? { pointerId: 7 } : {});
  element.emit(pointerSupported ? 'pointerdown' : 'mousedown', down);
  assert.ok(api.active(), mode + ' grip starts the production drag lifecycle');
  assert.strictEqual(down.prevented, true);
  assert.strictEqual(element.classList.contains('pnhud-dragging'), true);
  if (pointerSupported) assert.strictEqual(element.grip.capture, 7, 'pointer capture is established on the live grip');
  documentTarget.emit(pointerSupported ? 'pointermove' : 'mousemove', event(element.grip, Object.assign({ clientX: 40, clientY: 35 }, pointerSupported ? { pointerId: 7 } : {})));
  assert.strictEqual(element.style.transform, 'translate3d(130px,105px,0)', mode + ' pointer movement updates overlay transform');
  documentTarget.emit(pointerSupported ? 'pointerup' : 'mouseup', event(element.grip, pointerSupported ? { pointerId: 7 } : {}));
  assert.strictEqual(api.active(), null, mode + ' release finishes drag');
  assert.deepStrictEqual(api.positions()['stable-player'], { playerId: 'stable-player', seatId: 'seat-1', offsetX: 80, offsetY: 65 });
  assert.strictEqual(writes[writes.length - 1].positions['stable-player'].offsetX, 80, mode + ' completion uses the existing position store');
  element.grip = new Grip();
  api.install(element, 'stable-player');
  element.emit(pointerSupported ? 'pointerdown' : 'mousedown', event(element.grip, pointerSupported ? { pointerId: 8 } : {}));
  assert.ok(api.active(), mode + ' rerendered grip retains delegated drag behavior');
  documentTarget.emit(pointerSupported ? 'pointerup' : 'mouseup', event(element.grip, pointerSupported ? { pointerId: 8 } : {}));
}

exercise('Combined', true);
exercise('Stacked', false);

var gripRule = css.match(/#pnhud-overlay-root \.pnhud-overlay-grip \{([^}]+)\}/);
assert.ok(gripRule, 'production grip rule exists');
assert.match(gripRule[1], /flex:\s*0 0 16px/);
assert.match(gripRule[1], /width:\s*16px/);
assert.match(gripRule[1], /align-self:\s*stretch/);
assert.match(gripRule[1], /min-height:\s*18px/);
assert.match(css, /\.pnhud-drag-unlocked \.pnhud-overlay-grip[^}]+cursor:\s*grab/);
assert.match(css, /\.pnhud-dragging \.pnhud-overlay-grip[^}]+cursor:\s*grabbing/);
assert.match(css, /\.pnhud-overlay-grip span[^}]+pointer-events:\s*none/);
assert.doesNotMatch(gripRule[1], /position:\s*absolute/, 'larger grip remains in compact row flow without covering the name');
assert.ok(content.includes("openPlayerDashboard(String(button.dataset.pnhudPlayerId || playerId)"), 'dashboard name activation remains unchanged');

console.log('Live seat-overlay grip pointer/mouse lifecycle, isolation, rerender, modes, sizing, cursor, and persistence tests passed.');
