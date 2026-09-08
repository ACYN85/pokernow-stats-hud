/* Minimal, dependency-free PokerNow HUD root bootstrap. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;

  var ROOT_IDS = {
    details: 'pnhud-details-root',
    overlay: 'pnhud-overlay-root',
    toggle: 'pnhud-toggle-root',
    badge: 'pnhud-bootstrap-badge'
  };

  function normalizeDisplayMode(mode) {
    return ['seat-overlays-only', 'seat-overlays-leaderboard', 'leaderboard-only', 'hidden'].includes(mode) ? mode : 'seat-overlays-only';
  }

  function visibilityForMode(mode) {
    var normalized = normalizeDisplayMode(mode);
    return {
      mode: normalized,
      overlaysVisible: normalized !== 'leaderboard-only' && normalized !== 'hidden',
      detailsVisible: normalized !== 'seat-overlays-only' && normalized !== 'hidden'
    };
  }

  function createRoot(documentLike, parent, id, tagName) {
    var existing = documentLike.getElementById(id);
    if (existing) {
      if (parent && existing.parentElement !== parent && parent.appendChild) parent.appendChild(existing);
      return { element: existing, created: false };
    }
    var element = documentLike.createElement(tagName || 'div');
    element.id = id;
    parent.appendChild(element);
    return { element: element, created: true };
  }

  function ensureRoots(documentLike, mode) {
    if (!documentLike || !documentLike.documentElement) throw new Error('HUD root bootstrap requires document.documentElement');
    var parent = documentLike.body || documentLike.documentElement;
    var visibility = visibilityForMode(mode);
    var details = createRoot(documentLike, parent, ROOT_IDS.details, 'div');
    var overlay = createRoot(documentLike, parent, ROOT_IDS.overlay, 'div');
    var toggle = createRoot(documentLike, parent, ROOT_IDS.toggle, 'button');
    details.element.style.display = visibility.detailsVisible ? 'block' : 'none';
    overlay.element.style.display = visibility.overlaysVisible ? 'block' : 'none';
    toggle.element.style.display = 'block';
    return {
      mode: visibility.mode,
      visibility: visibility,
      detailsRoot: details.element,
      overlayRoot: overlay.element,
      toggleRoot: toggle.element,
      created: { details: details.created, overlay: overlay.created, toggle: toggle.created }
    };
  }

  var api = { ROOT_IDS: ROOT_IDS, normalizeDisplayMode: normalizeDisplayMode, visibilityForMode: visibilityForMode, ensureRoots: ensureRoots };
  root.PokerHudUiBootstrap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
