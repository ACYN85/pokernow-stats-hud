/* Pure feature-owned relative positioning for the draggable pot-odds companion. */
(function (root) {
  'use strict';

  var VIEWPORT_MARGIN = 8;

  function finite(value, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? value : Number(fallback || 0);
  }

  function rounded(value) {
    return Math.round(finite(value, 0));
  }

  function normalizeOffset(offset) {
    offset = offset || {};
    return { x: rounded(offset.x), y: rounded(offset.y) };
  }

  function normalizeCoordinateScale(scale) {
    scale = scale || {};
    var x = finite(scale.x === undefined ? scale.scaleX : scale.x, 1);
    var y = finite(scale.y === undefined ? scale.scaleY : scale.y, 1);
    return { x: x > 0 ? x : 1, y: y > 0 ? y : 1 };
  }

  function rect(left, top, width, height) {
    left = finite(left, 0); top = finite(top, 0); width = Math.max(0, finite(width, 0)); height = Math.max(0, finite(height, 0));
    return { left: left, top: top, width: width, height: height, right: left + width, bottom: top + height };
  }

  function offsetFromDrag(startOffset, startPointer, currentPointer, coordinateScale) {
    var start = normalizeOffset(startOffset);
    var scale = normalizeCoordinateScale(coordinateScale);
    return normalizeOffset({
      x: start.x + (finite(currentPointer && currentPointer.x, 0) - finite(startPointer && startPointer.x, 0)) / scale.x,
      y: start.y + (finite(currentPointer && currentPointer.y, 0) - finite(startPointer && startPointer.y, 0)) / scale.y
    });
  }

  function place(canonicalLeftCompanionRect, persistedOffset, viewport, margin, coordinateScale) {
    if (!canonicalLeftCompanionRect) return null;
    var canonical = rect(canonicalLeftCompanionRect.left, canonicalLeftCompanionRect.top, canonicalLeftCompanionRect.width, canonicalLeftCompanionRect.height);
    var offset = normalizeOffset(persistedOffset);
    var scale = normalizeCoordinateScale(coordinateScale);
    var viewportOffset = { x: offset.x * scale.x, y: offset.y * scale.y };
    var unclamped = rect(canonical.left + viewportOffset.x, canonical.top + viewportOffset.y, canonical.width, canonical.height);
    viewport = viewport || {};
    var viewportWidth = Math.max(0, finite(viewport.width, 0));
    var viewportHeight = Math.max(0, finite(viewport.height, 0));
    var safetyMargin = Math.max(0, finite(margin, VIEWPORT_MARGIN));
    var minimumLeft = viewportWidth >= canonical.width + safetyMargin * 2 ? safetyMargin : 0;
    var minimumTop = viewportHeight >= canonical.height + safetyMargin * 2 ? safetyMargin : 0;
    var maximumLeft = Math.max(minimumLeft, viewportWidth - canonical.width - minimumLeft);
    var maximumTop = Math.max(minimumTop, viewportHeight - canonical.height - minimumTop);
    var clampedLeft = Math.max(minimumLeft, Math.min(maximumLeft, unclamped.left));
    var clampedTop = Math.max(minimumTop, Math.min(maximumTop, unclamped.top));
    var actual = rect(clampedLeft, clampedTop, canonical.width, canonical.height);
    return {
      canonicalLeftCompanionRect: canonical,
      persistedOffsetX: offset.x,
      persistedOffsetY: offset.y,
      coordinateScaleX: scale.x,
      coordinateScaleY: scale.y,
      viewportOffsetX: viewportOffset.x,
      viewportOffsetY: viewportOffset.y,
      unclampedActualRect: unclamped,
      actualPanelRect: actual,
      viewportClampApplied: actual.left !== unclamped.left || actual.top !== unclamped.top
    };
  }

  function deterministicFallback(panelSize, persistedOffset, viewport, margin) {
    panelSize = panelSize || {};
    viewport = viewport || {};
    var width = Math.max(1, finite(panelSize.width, 100));
    var height = Math.max(1, finite(panelSize.height, 60));
    var viewportWidth = Math.max(width, finite(viewport.width, width));
    var viewportHeight = Math.max(height, finite(viewport.height, height));
    var estimatedBoardLeft = viewportWidth * 0.41;
    var estimatedBoardTop = viewportHeight * 0.391;
    var estimatedBoardHeight = Math.max(64, Math.min(90, viewportHeight * 0.12));
    var fallbackCanonicalLeft = rect(estimatedBoardLeft - 10 - width, estimatedBoardTop + (estimatedBoardHeight - height) / 2, width, height);
    var placement = place(fallbackCanonicalLeft, persistedOffset, viewport, margin);
    placement.fallback = 'deterministic viewport-relative companion pending canonical board geometry';
    return placement;
  }

  function createPositionPreferenceState(snapshot) {
    snapshot = snapshot || {};
    // The legacy hand ID and first-flop latch are not part of user placement.
    return { manualOverride: snapshot.manualOverride === true };
  }

  function setManualPlacementCustomized(state, enabled) {
    if (!state) return state;
    state.manualOverride = enabled === true;
    return state;
  }

  var api = Object.freeze({
    VIEWPORT_MARGIN: VIEWPORT_MARGIN,
    normalizeOffset: normalizeOffset,
    normalizeCoordinateScale: normalizeCoordinateScale,
    offsetFromDrag: offsetFromDrag,
    place: place,
    deterministicFallback: deterministicFallback,
    createPositionPreferenceState: createPositionPreferenceState,
    setManualPlacementCustomized: setManualPlacementCustomized
  });
  root.PokerPotOddsPosition = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
