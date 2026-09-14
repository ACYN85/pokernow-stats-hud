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

  function rect(left, top, width, height) {
    left = finite(left, 0); top = finite(top, 0); width = Math.max(0, finite(width, 0)); height = Math.max(0, finite(height, 0));
    return { left: left, top: top, width: width, height: height, right: left + width, bottom: top + height };
  }

  function offsetFromDrag(startOffset, startPointer, currentPointer) {
    var start = normalizeOffset(startOffset);
    return normalizeOffset({
      x: start.x + finite(currentPointer && currentPointer.x, 0) - finite(startPointer && startPointer.x, 0),
      y: start.y + finite(currentPointer && currentPointer.y, 0) - finite(startPointer && startPointer.y, 0)
    });
  }

  function place(canonicalLeftCompanionRect, persistedOffset, viewport, margin) {
    if (!canonicalLeftCompanionRect) return null;
    var canonical = rect(canonicalLeftCompanionRect.left, canonicalLeftCompanionRect.top, canonicalLeftCompanionRect.width, canonicalLeftCompanionRect.height);
    var offset = normalizeOffset(persistedOffset);
    var unclamped = rect(canonical.left + offset.x, canonical.top + offset.y, canonical.width, canonical.height);
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

  function createBoardResetState(snapshot) {
    snapshot = snapshot || {};
    return {
      handId: snapshot.handId === null || snapshot.handId === undefined ? null : String(snapshot.handId),
      applied: snapshot.applied === true,
      sequence: Math.max(0, Math.floor(finite(snapshot.sequence, 0)))
    };
  }

  function observeAuthoritativeBoard(state, observation) {
    observation = observation || {};
    var handId = observation.handId === null || observation.handId === undefined || observation.handId === '<D>'
      ? null
      : String(observation.handId);
    if (!state || !handId) return { reset: false, reason: !state ? 'reset state unavailable' : 'authoritative hand ID unavailable' };
    var newHand = state.handId !== handId;
    if (newHand) {
      state.handId = handId;
      state.applied = false;
    }
    var measuredBoardCardCount = Math.max(0, Math.floor(finite(observation.measuredBoardCardCount, 0)));
    var authoritativeStreet = String(observation.authoritativeStreet || '').toLowerCase();
    var postflopStreetVerified = /^(?:flop|turn|river)$/.test(authoritativeStreet);
    if (state.applied) return { reset: false, handId: handId, newHand: newHand, reason: 'canonical reset already applied for this hand' };
    if (!postflopStreetVerified || observation.canonicalBoardVerified !== true || measuredBoardCardCount < 3) {
      return { reset: false, handId: handId, newHand: newHand, reason: 'waiting for first authoritative measured postflop board', measuredBoardCardCount: measuredBoardCardCount, authoritativeStreet: authoritativeStreet || null };
    }
    state.applied = true;
    state.sequence += 1;
    return { reset: true, handId: handId, newHand: newHand, reason: 'first authoritative measured postflop board for hand', measuredBoardCardCount: measuredBoardCardCount, authoritativeStreet: authoritativeStreet, sequence: state.sequence };
  }

  var api = Object.freeze({
    VIEWPORT_MARGIN: VIEWPORT_MARGIN,
    normalizeOffset: normalizeOffset,
    offsetFromDrag: offsetFromDrag,
    place: place,
    deterministicFallback: deterministicFallback,
    createBoardResetState: createBoardResetState,
    observeAuthoritativeBoard: observeAuthoritativeBoard
  });
  root.PokerPotOddsPosition = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
