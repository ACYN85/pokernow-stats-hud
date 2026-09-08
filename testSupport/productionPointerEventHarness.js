'use strict';

var base = require('./potOddsProductionVisibilityHarness.js');

function pointerEvent(type, target, values) {
  return Object.assign({
    type: type,
    target: target,
    currentTarget: null,
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    cancelable: true,
    defaultPrevented: false,
    cancelBubble: false,
    immediatePropagationStopped: false,
    preventDefault: function () { if (this.cancelable) this.defaultPrevented = true; },
    stopPropagation: function () { this.cancelBubble = true; },
    stopImmediatePropagation: function () { this.immediatePropagationStopped = true; this.cancelBubble = true; }
  }, values || {});
}

function installPointerCapture(element) {
  var captured = new Set();
  element.setPointerCapture = function (pointerId) { captured.add(Number(pointerId)); };
  element.releasePointerCapture = function (pointerId) { captured.delete(Number(pointerId)); };
  element.hasPointerCapture = function (pointerId) { return captured.has(Number(pointerId)); };
  return element;
}

function bubble(harness, target, event) {
  if (!target || target.disabled) return { delivered: false, disabled: Boolean(target && target.disabled), event: event };
  var path = []; var current = target;
  while (current) { path.push(current); current = current.parentElement; }
  path.push(harness.document);
  for (var index = 0; index < path.length; index += 1) {
    event.currentTarget = path[index];
    path[index].dispatchEvent(event);
    if (event.cancelBubble) break;
  }
  event.currentTarget = null;
  return { delivered: true, disabled: false, event: event, path: path };
}

function documentPointer(harness, type, target, values) {
  var event = pointerEvent(type, target, values);
  event.currentTarget = harness.document;
  harness.document.dispatchEvent(event);
  event.currentTarget = null;
  return event;
}

function manualPositionWrites(harness) {
  return harness.storageWrites.filter(function (update) {
    return Object.keys(update).some(function (key) { return key.indexOf('pokerNowHudManualOverlayPositions:') === 0; });
  });
}

module.exports = Object.freeze({
  createHarness: base.createHarness,
  dispatchRegisteredCall100: base.dispatchRegisteredCall100,
  dispatchFrame: base.dispatchFrame,
  socket: base.socket,
  pointerEvent: pointerEvent,
  installPointerCapture: installPointerCapture,
  bubble: bubble,
  documentPointer: documentPointer,
  manualPositionWrites: manualPositionWrites
});
