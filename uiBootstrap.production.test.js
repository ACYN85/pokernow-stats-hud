'use strict';

var assert = require('assert');
var fs = require('fs');
var bootstrap = require('./uiBootstrap.js');

function FakeElement(tagName, ownerDocument) {
  this.tagName = String(tagName || 'div').toUpperCase();
  this.ownerDocument = ownerDocument;
  this.parentElement = null;
  this.children = [];
  this.style = {};
  this.dataset = {};
  this._id = '';
}
Object.defineProperty(FakeElement.prototype, 'id', {
  get: function () { return this._id; },
  set: function (value) {
    if (this._id) this.ownerDocument.ids.delete(this._id);
    this._id = String(value || '');
    if (this._id) this.ownerDocument.ids.set(this._id, this);
  }
});
Object.defineProperty(FakeElement.prototype, 'isConnected', {
  get: function () {
    var current = this;
    while (current) {
      if (current === this.ownerDocument.documentElement) return true;
      current = current.parentElement;
    }
    return false;
  }
});
FakeElement.prototype.appendChild = function (child) {
  if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(function (item) { return item !== child; });
  child.parentElement = this;
  this.children.push(child);
  return child;
};
FakeElement.prototype.remove = function () {
  if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(function (item) { return item !== this; }.bind(this));
  this.parentElement = null;
  if (this.id) this.ownerDocument.ids.delete(this.id);
};

function fakeDocument() {
  var documentLike = { ids: new Map() };
  documentLike.createElement = function (tagName) { return new FakeElement(tagName, documentLike); };
  documentLike.getElementById = function (id) { return documentLike.ids.get(id) || null; };
  documentLike.documentElement = documentLike.createElement('html');
  documentLike.body = documentLike.createElement('body');
  documentLike.documentElement.appendChild(documentLike.body);
  return documentLike;
}

var documentLike = fakeDocument();
var overlaysOnly = bootstrap.ensureRoots(documentLike, 'seat-overlays-only');
assert.strictEqual(overlaysOnly.overlayRoot.style.display, 'block', 'Seat overlays only creates and shows the overlay root without mappings');
assert.strictEqual(overlaysOnly.detailsRoot.style.display, 'none', 'Seat overlays only retains but hides the details root');
assert.strictEqual(overlaysOnly.toggleRoot.isConnected, true);

var both = bootstrap.ensureRoots(documentLike, 'seat-overlays-leaderboard');
assert.strictEqual(both.overlayRoot.style.display, 'block', 'Overlays + details shows the overlay root');
assert.strictEqual(both.detailsRoot.style.display, 'block', 'Overlays + details shows the details root');
assert.deepStrictEqual(both.created, { details: false, overlay: false, toggle: false }, 'mode changes reuse stable roots');

var detailsOnly = bootstrap.ensureRoots(documentLike, 'leaderboard-only');
assert.strictEqual(detailsOnly.overlayRoot.style.display, 'none', 'Details only hides overlays');
assert.strictEqual(detailsOnly.detailsRoot.style.display, 'block', 'Details only renders a visible details shell with no stats input');

var hidden = bootstrap.ensureRoots(documentLike, 'hidden');
assert.strictEqual(hidden.overlayRoot.style.display, 'none', 'Hidden mode retains but hides the overlay root');
assert.strictEqual(hidden.detailsRoot.style.display, 'none', 'Hidden mode retains but hides the leaderboard root');
assert.strictEqual(hidden.toggleRoot.style.display, 'block', 'Hidden mode keeps the HUD recovery control available');

var removedDetails = detailsOnly.detailsRoot;
removedDetails.remove();
var recovered = bootstrap.ensureRoots(documentLike, 'leaderboard-only');
assert.notStrictEqual(recovered.detailsRoot, removedDetails, 'a root removed by a page rerender is recreated');
assert.strictEqual(recovered.created.details, true);
assert.strictEqual(recovered.detailsRoot.isConnected, true);

var content = fs.readFileSync('./content.js', 'utf8');
assert.ok(content.includes('PokerNow HUD UI bootstrap reached'), 'production content path creates the diagnostic bootstrap badge');
assert.ok(content.includes("'<tr><td colspan=\"' + (leaderboardDefinitions.length + 1) + '\" class=\"pnhud-empty\">Waiting for live data"), 'zero finalized stats retain the visible details shell with a dynamic column span');
assert.ok(content.includes("if (extensionCleanedUp || !runtimeScope.isPokerNowGamePage(window.location)) return;"), 'root recovery remains active on the same valid game URL');
assert.ok(content.includes("cleanupExtension('navigated away from a supported PokerNow game page')"), 'cleanup occurs after leaving a supported game URL');
assert.ok(content.includes("cleanupExtension('same-document PokerNow game changed from ' + previousGameId + ' to ' + nextGameId + '; failing closed')"), 'same-document game-ID changes fail closed instead of reusing the prior table namespace');

console.log('Production UI bootstrap root, mode, empty-state, and recovery tests passed.');
