/* Pure reconciliation controller for confirmed PokerNow seat overlays. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;

  var DISPLAY_MODES = ['seat-overlays-only', 'seat-overlays-leaderboard', 'leaderboard-only', 'hidden'];
  var OPPORTUNITY_STATS_LAYOUTS = ['combined', 'stacked'];
  var STAT_SOURCES = ['session', 'career'];
  var profileExplanation = root.PokerPlayerProfileExplanation;
  if (!profileExplanation && typeof module !== 'undefined' && module.exports) profileExplanation = require('./playerProfileExplanation.js');
  var PROFILE_ARCHETYPE_ORDER = profileExplanation.ARCHETYPES;
  var PROFILE_TONES = Object.freeze({ Nit: 'nit', TAG: 'tag', LAG: 'lag', 'Tight Passive': 'tight-passive', 'Loose Passive': 'loose-passive', 'Calling Station': 'calling-station', Maniac: 'maniac' });
  var PROFILE_PRESENTATIONS = Object.freeze(PROFILE_ARCHETYPE_ORDER.reduce(function (result, archetype) {
    result[archetype] = Object.freeze({ label: archetype, tone: PROFILE_TONES[archetype], description: profileExplanation.DEFINITIONS[archetype].description });
    return result;
  }, {}));
  var overlayStats = root.PokerOverlayStats;
  if (!overlayStats && typeof module !== 'undefined' && module.exports) overlayStats = require('./overlayStats.js');

  function normalizeDisplayMode(value) {
    return DISPLAY_MODES.includes(value) ? value : 'seat-overlays-only';
  }

  function overlaysEnabled(mode) {
    var normalized = normalizeDisplayMode(mode);
    return normalized !== 'leaderboard-only' && normalized !== 'hidden';
  }

  function detailsEnabled(mode) {
    var normalized = normalizeDisplayMode(mode);
    return normalized !== 'seat-overlays-only' && normalized !== 'hidden';
  }

  function visibilityForMode(mode) {
    var normalized = normalizeDisplayMode(mode);
    return { mode: normalized, overlaysVisible: overlaysEnabled(normalized), detailsVisible: detailsEnabled(normalized) };
  }

  function modeForVisibility(overlaysVisible, detailsVisible) {
    if (overlaysVisible && detailsVisible) return 'seat-overlays-leaderboard';
    if (overlaysVisible) return 'seat-overlays-only';
    if (detailsVisible) return 'leaderboard-only';
    return 'hidden';
  }

  function normalizedText(value) {
    return String(value === null || value === undefined ? '' : value).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function exactNameMatch(left, right) {
    var normalizedLeft = normalizedText(left);
    var normalizedRight = normalizedText(right);
    return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
  }

  function identityLabel(name, playerId) {
    return String(name || '').trim().replace(/\s+/g, ' ') + ' [' + String(playerId || '').slice(0, 4) + ']';
  }

  function compactStatLabel(definition, stats) {
    if (!definition) return '';
    var value = definition.getValue(stats || {});
    var formatted = definition.seatFormatValue
      ? definition.seatFormatValue(value, stats || {})
      : definition.formatValue(value);
    return definition.shortLabel + ' ' + formatted;
  }

  function normalizeOpportunityStatsLayout(value) {
    return OPPORTUNITY_STATS_LAYOUTS.includes(value) ? value : 'combined';
  }

  function compactStatLabels(stats, displayedStatIds) {
    var ids = Array.isArray(displayedStatIds) ? displayedStatIds : overlayStats.DEFAULT_DISPLAYED_STAT_IDS;
    return overlayStats.definitionsFor(ids).map(function (definition) {
      return compactStatLabel(definition, stats);
    });
  }

  function compactStatsLabel(stats, displayedStatIds) {
    return compactStatLabels(stats, displayedStatIds).join(' | ');
  }

  function visibleProfilePresentation(displayedProfile, enabled) {
    if (enabled !== true || !displayedProfile || displayedProfile.visible !== true) return null;
    var presentation = PROFILE_PRESENTATIONS[String(displayedProfile.archetype || '')];
    return presentation ? Object.assign({}, presentation) : null;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function normalizeStatSource(value) {
    return STAT_SOURCES.includes(value) ? value : 'session';
  }

  function profileChipHtml(displayedProfile, enabled, profileStatSource, seatStatSource) {
    var profile = visibleProfilePresentation(displayedProfile, enabled);
    if (!profile) return '';
    profileStatSource = normalizeStatSource(profileStatSource);
    seatStatSource = normalizeStatSource(seatStatSource);
    var rawScores = displayedProfile.rawScores && typeof displayedProfile.rawScores === 'object' ? displayedProfile.rawScores : {};
    var scores = PROFILE_ARCHETYPE_ORDER.reduce(function (result, name) {
      var score = Number(rawScores[name]);
      result[name] = Number.isFinite(score) && score >= 0 ? score : 0;
      return result;
    }, {});
    var sourceLabel = seatStatSource === 'career' && profileStatSource === 'session' ? ' (Session profile)' : '';
    return '<span class="pnhud-profile-chip pnhud-profile-chip--' + profile.tone + ' pnhud-profile-tooltip-target" tabindex="0" data-pnhud-interactive="true" data-pnhud-profile-archetype="' + escapeHtml(profile.label) + '" data-pnhud-profile-raw-archetype="' + escapeHtml(displayedProfile.rawArchetype || profile.label) + '" data-pnhud-profile-scores="' + escapeHtml(JSON.stringify(scores)) + '" data-pnhud-profile-source="' + profileStatSource + '" data-pnhud-seat-stat-source="' + seatStatSource + '" aria-label="' + escapeHtml(profile.label + ' player profile' + sourceLabel) + '">' + escapeHtml(profile.label) + '</span>';
  }

  function profileTooltipHtml(displayedProfile, enabled, profileStatSource, seatStatSource) {
    var profile = visibleProfilePresentation(displayedProfile, enabled);
    if (!profile) return '';
    profileStatSource = normalizeStatSource(profileStatSource);
    seatStatSource = normalizeStatSource(seatStatSource);
    var scores = displayedProfile.rawScores && typeof displayedProfile.rawScores === 'object' ? displayedProfile.rawScores : {};
    var fitRows = PROFILE_ARCHETYPE_ORDER.map(function (name) {
      var score = Number(scores[name]);
      var percentage = Math.round((Number.isFinite(score) && score >= 0 ? score : 0) * 100);
      return '<div' + (name === profile.label ? ' class="pnhud-profile-fit-current"' : '') + '><span>' + escapeHtml(name) + '</span><strong>' + percentage + '%</strong></div>';
    }).join('');
    var rawArchetype = String(displayedProfile.rawArchetype || profile.label);
    var disagreement = rawArchetype !== profile.label
      ? '<p class="pnhud-profile-classification-disagreement"><span>Displayed profile: <strong>' + escapeHtml(profile.label) + '</strong></span><span>Current raw classification: <strong>' + escapeHtml(rawArchetype) + '</strong></span></p>'
      : '';
    var sourceNote = seatStatSource === 'career' && profileStatSource === 'session'
      ? '<p class="pnhud-profile-source-note">Seat statistics are Career. This profile remains Session-based because Career profile classification is not an authoritative supported path.</p>'
      : '';
    return '<div class="pnhud-tooltip-heading"><strong>' + escapeHtml(profile.label) + '</strong></div><p>' + escapeHtml(profile.description) + '</p>' + sourceNote + disagreement + '<div class="pnhud-profile-fit-heading">Profile fit</div><div class="pnhud-profile-fit-grid">' + fitRows + '</div><p class="pnhud-profile-fit-note">Scores measure statistical compatibility, not probability.</p>';
  }

  function profilePresentationKey(displayedProfile, enabled, profileStatSource, seatStatSource) {
    var profile = visibleProfilePresentation(displayedProfile, enabled);
    return profile ? JSON.stringify([profile.label, displayedProfile.rawArchetype || null, displayedProfile.rawScores || null, normalizeStatSource(profileStatSource), normalizeStatSource(seatStatSource)]) : 'hidden';
  }

  function careerStatsToOverlayStats(value) {
    var counters = value && value.counters && typeof value.counters === 'object' ? value.counters : {};
    function count(name) { return Math.max(0, Number(counters[name] || 0)); }
    function percentage(numerator, denominator) { return denominator > 0 ? numerator / denominator * 100 : 0; }
    var aggressive = count('postflopAggressiveActions');
    var calls = count('postflopCalls');
    return {
      handsPlayed: count('hands'),
      vpipHands: count('vpipMade'), vpipOpportunities: count('vpipOpportunities'), vpip: percentage(count('vpipMade'), count('vpipOpportunities')),
      pfrHands: count('pfrMade'), pfrOpportunities: count('pfrOpportunities'), pfr: percentage(count('pfrMade'), count('pfrOpportunities')),
      af: calls > 0 ? aggressive / calls : aggressive > 0 ? Infinity : 0,
      afDetails: { bets: aggressive, raises: 0, calls: calls },
      threeBetMade: count('threeBetMade'), threeBetOpportunities: count('threeBetOpportunities'),
      foldToThreeBet: count('foldToThreeBet'), foldToThreeBetOpportunities: count('foldToThreeBetOpportunities'),
      flopCBetMade: count('flopCBetMade'), flopCBetOpportunities: count('flopCBetOpportunities'),
      foldToFlopCBet: count('foldToFlopCBet'), foldToFlopCBetOpportunities: count('foldToFlopCBetOpportunities'),
      wentToShowdown: count('wtsdMade'), sawFlopForWTSD: count('wtsdOpportunities'),
      wonMoneyAtShowdown: count('wsdMade'), showdownsForWSD: count('wsdOpportunities')
    };
  }

  function rowItems(definitions, stats) {
    return definitions.map(function (definition) {
      return { definition: definition, label: compactStatLabel(definition, stats) };
    });
  }

  function compactStatRows(stats, displayedStatIds, opportunityStatsLayout) {
    var ids = Array.isArray(displayedStatIds) ? displayedStatIds : overlayStats.DEFAULT_DISPLAYED_STAT_IDS;
    var definitions = overlayStats.definitionsFor(ids);
    var ordinary = definitions.filter(function (definition) { return !Number.isFinite(definition.seatOpportunityOrder); });
    var opportunity = definitions.filter(function (definition) { return Number.isFinite(definition.seatOpportunityOrder); }).sort(function (left, right) { return left.seatOpportunityOrder - right.seatOpportunityOrder; });
    var rows = [];
    for (var index = 0; index < ordinary.length; index += 4) rows.push(rowItems(ordinary.slice(index, index + 4), stats));
    if (!opportunity.length) return rows;
    var preflop = opportunity.filter(function (definition) { return definition.seatOpportunityGroup === 'preflop'; });
    var flop = opportunity.filter(function (definition) { return definition.seatOpportunityGroup === 'flop'; });
    var showdown = opportunity.filter(function (definition) { return definition.seatOpportunityGroup === 'showdown'; });
    var standardOpportunity = opportunity.filter(function (definition) { return definition.seatOpportunityGroup !== 'showdown'; });
    if (normalizeOpportunityStatsLayout(opportunityStatsLayout) === 'combined') {
      if (standardOpportunity.length) rows.push(rowItems(standardOpportunity, stats));
      if (showdown.length) rows.push(rowItems(showdown, stats));
      return rows;
    }
    if (preflop.length) rows.push(rowItems(preflop, stats));
    if (flop.length) rows.push(rowItems(flop, stats));
    if (showdown.length) rows.push(rowItems(showdown, stats));
    return rows;
  }

  function pairKey(playerId, seatId) {
    return String(playerId) + '|' + String(seatId);
  }

  function scorePlayerSeat(player, seat, options) {
    options = options || {};
    var methods = [];
    var score = 0;
    var playerId = String(player.playerId || '');
    var directIds = (seat.directPlayerIds || []).map(String);
    if (playerId && directIds.includes(playerId)) { score += 1000000; methods.push('direct internal player ID'); }
    if (exactNameMatch(player.name, seat.displayedName)) { score += 100000; methods.push('exact displayed name match'); }
    if (player.seatIndex !== null && player.seatIndex !== undefined && seat.seatIndex !== null && seat.seatIndex !== undefined && String(player.seatIndex) === String(seat.seatIndex)) { score += 10000; methods.push('verified seat index/order'); }
    if ((options.orderPairs || []).includes(pairKey(playerId, seat.elementId))) { score += 10000; methods.push('verified socket/clockwise order'); }
    if ((options.transitionPairs || []).includes(pairKey(playerId, seat.elementId))) { score += 1000; methods.push('synchronized stack transition'); }
    var socketStackCount = (options.players || []).filter(function (candidate) { return candidate.stack === player.stack; }).length;
    var domStackCount = (options.seats || []).filter(function (candidate) { return candidate.displayedStack === seat.displayedStack; }).length;
    if (typeof player.stack === 'number' && player.stack === seat.displayedStack && socketStackCount === 1 && domStackCount === 1) { score += 100; methods.push('unique stack match'); }
    if (score > 0 && options.previousAssignments && options.previousAssignments[playerId] === seat.elementId) { score += 10; methods.push('stable previous assignment'); }
    var directOrExact = methods.includes('direct internal player ID') || methods.includes('exact displayed name match');
    var verifiedOrder = methods.includes('verified seat index/order') || methods.includes('verified socket/clockwise order');
    var synchronizedTransition = methods.includes('synchronized stack transition');
    var uniqueStackWithOrder = methods.includes('unique stack match') && verifiedOrder;
    var qualified = directOrExact || verifiedOrder || synchronizedTransition || uniqueStackWithOrder;
    return { playerId: playerId, seatElementId: String(seat.elementId || ''), score: score, methods: methods, qualified: qualified, rejectionReason: qualified ? null : (methods.includes('unique stack match') ? 'unique stack alone is insufficient without agreeing seat order' : 'no direct ID, exact name, verified order, or synchronized stack transition') };
  }

  function assignPlayersToSeats(players, seats, options) {
    players = (players || []).filter(function (player) { return player && player.playerId; });
    seats = (seats || []).filter(function (seat) { return seat && seat.elementId && seat.displayedName && seat.occupied !== false; });
    options = Object.assign({}, options || {}, { players: players, seats: seats });
    var comparisons = [];
    var byPlayer = new Map();
    players.forEach(function (player) {
      var scored = seats.map(function (seat) {
        var comparison = scorePlayerSeat(player, seat, options);
        comparisons.push(comparison);
        return { seat: seat, comparison: comparison };
      }).filter(function (candidate) { return candidate.comparison.score > 0 && candidate.comparison.qualified; });
      scored.sort(function (left, right) { return right.comparison.score - left.comparison.score; });
      byPlayer.set(String(player.playerId), scored);
    });

    var bestScore = -1;
    var bestAssignments = [];
    function visit(index, usedSeats, assignment, score) {
      if (index >= players.length) {
        if (score > bestScore) { bestScore = score; bestAssignments = [Object.assign({}, assignment)]; }
        else if (score === bestScore && bestAssignments.length < 100) bestAssignments.push(Object.assign({}, assignment));
        return;
      }
      var playerId = String(players[index].playerId);
      visit(index + 1, usedSeats, assignment, score);
      (byPlayer.get(playerId) || []).forEach(function (candidate) {
        var seatId = String(candidate.seat.elementId);
        if (usedSeats.has(seatId)) return;
        usedSeats.add(seatId);
        assignment[playerId] = seatId;
        visit(index + 1, usedSeats, assignment, score + candidate.comparison.score);
        delete assignment[playerId];
        usedSeats.delete(seatId);
      });
    }
    visit(0, new Set(), {}, 0);

    var assignments = [];
    var rejected = [];
    players.forEach(function (player) {
      var playerId = String(player.playerId);
      var choices = new Set(bestAssignments.map(function (assignment) { return assignment[playerId] || ''; }));
      if (choices.size !== 1 || choices.has('')) {
        rejected.push({ playerId: playerId, reason: choices.size > 1 ? 'multiple equally optimal one-to-one assignments remain' : 'no supported player-seat evidence', conflictingCandidates: Array.from(choices).filter(Boolean) });
        return;
      }
      var seatId = Array.from(choices)[0];
      var seat = seats.find(function (candidate) { return String(candidate.elementId) === seatId; });
      var comparison = comparisons.find(function (candidate) { return candidate.playerId === playerId && candidate.seatElementId === seatId; });
      assignments.push({ player: player, seat: seat, score: comparison.score, methods: comparison.methods });
    });
    return { assignments: assignments, rejected: rejected, comparisons: comparisons, totalScore: bestScore, optimalAssignmentCount: bestAssignments.length };
  }

  function chooseAnchorCandidate(candidates) {
    var ranked = (candidates || []).filter(function (candidate) { return candidate && candidate.rect && candidate.rect.width > 0 && candidate.rect.height > 0; }).map(function (candidate) {
      var score = 0;
      var rejectionReason = null;
      if (candidate.isBlindOrBetMarker || candidate.isSeatNumber || candidate.kind === 'cards') {
        score = -1000;
        rejectionReason = 'blind, dealer, bet, pot, card-only, or seat-number elements cannot anchor a HUD';
      } else if (candidate.kind === 'name-stack-block' && candidate.containsExactName && candidate.containsCurrentStack) score = 500;
      else if (candidate.kind === 'name' && candidate.containsExactName && candidate.hasNearbyStack) score = 400;
      else if (candidate.kind === 'occupied-seat-wrapper' && candidate.containsExactName) score = 300;
      else if (candidate.kind === 'name' && candidate.containsExactName) score = 250;
      else {
        score = -100;
        rejectionReason = 'candidate does not contain the exact full player name with acceptable seat context';
      }
      return Object.assign({}, candidate, { score: score, rejectionReason: rejectionReason });
    }).sort(function (left, right) { return right.score - left.score; });
    return { selected: ranked[0] && ranked[0].score > 0 ? ranked[0] : null, ranked: ranked };
  }

  function placeOverlay(anchorRect, overlaySize, viewport, offset) {
    offset = Number.isFinite(offset) ? offset : 6;
    var width = Number(overlaySize && overlaySize.width || 150);
    var height = Number(overlaySize && overlaySize.height || 20);
    var viewportWidth = Number(viewport && viewport.width || 0);
    var viewportHeight = Number(viewport && viewport.height || 0);
    var centerX = anchorRect.left + anchorRect.width / 2;
    var left = Math.max(4, Math.min(viewportWidth - width - 4, centerX - width / 2));
    var top = anchorRect.top + anchorRect.height + offset;
    if (top + height > viewportHeight - 4) top = Math.max(4, anchorRect.top - height - offset);
    return { left: Math.round(left), top: Math.round(top), width: width, height: height };
  }

  function normalizedRect(rect) {
    if (!rect) return null;
    var left = Number(rect.left || 0);
    var top = Number(rect.top || 0);
    var width = Number(rect.width || 0);
    var height = Number(rect.height || 0);
    return { left: left, top: top, width: width, height: height, right: left + width, bottom: top + height };
  }

  function rectsOverlap(leftRect, rightRect, padding) {
    var left = normalizedRect(leftRect);
    var right = normalizedRect(rightRect);
    padding = Number(padding || 0);
    if (!left || !right || left.width <= 0 || left.height <= 0 || right.width <= 0 || right.height <= 0) return false;
    return left.left < right.right + padding && left.right > right.left - padding && left.top < right.bottom + padding && left.bottom > right.top - padding;
  }

  function stackingContextReasons(style, element) {
    style = style || {};
    var reasons = [];
    var position = String(style.position || 'static');
    var zIndex = String(style.zIndex === undefined ? 'auto' : style.zIndex);
    var contain = String(style.contain || 'none');
    var willChange = String(style.willChange || 'auto');
    if (element && String(element.tagName || '').toUpperCase() === 'HTML') reasons.push('root');
    if (position === 'fixed' || position === 'sticky') reasons.push('position:' + position);
    if (position !== 'static' && zIndex !== 'auto') reasons.push('positioned-z-index:' + zIndex);
    if (Number(style.opacity === undefined ? 1 : style.opacity) < 1) reasons.push('opacity:' + style.opacity);
    if (String(style.transform || 'none') !== 'none') reasons.push('transform');
    if (String(style.filter || 'none') !== 'none') reasons.push('filter');
    if (String(style.backdropFilter || style.webkitBackdropFilter || 'none') !== 'none') reasons.push('backdrop-filter');
    if (String(style.perspective || 'none') !== 'none') reasons.push('perspective');
    if (String(style.mixBlendMode || 'normal') !== 'normal') reasons.push('mix-blend-mode');
    if (String(style.isolation || 'auto') === 'isolate') reasons.push('isolation');
    if (/(?:layout|paint|strict|content)/.test(contain)) reasons.push('contain:' + contain);
    if (/(?:transform|opacity|filter|perspective|contain)/.test(willChange)) reasons.push('will-change:' + willChange);
    return reasons;
  }

  function stackingContextChain(element, getStyle, stopAt) {
    var chain = [];
    var current = element;
    while (current) {
      var style = typeof getStyle === 'function' ? getStyle(current) || {} : {};
      var reasons = stackingContextReasons(style, current);
      if (reasons.length) {
        chain.push({
          tag: String(current.tagName || current.nodeName || ''),
          id: String(current.id || ''),
          className: String(current.className || '').slice(0, 180),
          position: String(style.position || 'static'),
          zIndex: String(style.zIndex === undefined ? 'auto' : style.zIndex),
          transform: String(style.transform || 'none'),
          filter: String(style.filter || 'none'),
          opacity: String(style.opacity === undefined ? '1' : style.opacity),
          isolation: String(style.isolation || 'auto'),
          contain: String(style.contain || 'none'),
          reasons: reasons
        });
      }
      if (current === stopAt) break;
      current = current.parentElement || null;
    }
    return chain;
  }

  function intersectRects(leftRect, rightRect) {
    var left = normalizedRect(leftRect);
    var right = normalizedRect(rightRect);
    if (!left || !right) return null;
    var intersectionLeft = Math.max(left.left, right.left);
    var intersectionTop = Math.max(left.top, right.top);
    var intersectionRight = Math.min(left.right, right.right);
    var intersectionBottom = Math.min(left.bottom, right.bottom);
    if (intersectionRight <= intersectionLeft || intersectionBottom <= intersectionTop) return null;
    return {
      left: intersectionLeft,
      top: intersectionTop,
      width: intersectionRight - intersectionLeft,
      height: intersectionBottom - intersectionTop,
      right: intersectionRight,
      bottom: intersectionBottom
    };
  }

  function subtractRect(fragmentRect, occlusionRect) {
    var fragment = normalizedRect(fragmentRect);
    var intersection = intersectRects(fragment, occlusionRect);
    if (!intersection) return [fragment];
    var visible = [];
    if (intersection.top > fragment.top) visible.push({ left: fragment.left, top: fragment.top, width: fragment.width, height: intersection.top - fragment.top });
    if (intersection.bottom < fragment.bottom) visible.push({ left: fragment.left, top: intersection.bottom, width: fragment.width, height: fragment.bottom - intersection.bottom });
    if (intersection.left > fragment.left) visible.push({ left: fragment.left, top: intersection.top, width: intersection.left - fragment.left, height: intersection.height });
    if (intersection.right < fragment.right) visible.push({ left: intersection.right, top: intersection.top, width: fragment.right - intersection.right, height: intersection.height });
    return visible.map(normalizedRect).filter(function (rect) { return rect.width > 0 && rect.height > 0; });
  }

  function nativePanelVisibleFragments(overlayRect, panelRects, maxFragments) {
    var overlay = normalizedRect(overlayRect);
    maxFragments = Math.max(4, Math.min(128, Number(maxFragments || 64)));
    if (!overlay || overlay.width <= 0 || overlay.height <= 0) return { occluded: false, fullyOccluded: false, fragments: [], occlusions: [], bounded: true };
    var localBounds = normalizedRect({ left: 0, top: 0, width: overlay.width, height: overlay.height });
    var occlusions = (panelRects || []).map(function (panelRect) {
      var intersection = intersectRects(overlay, panelRect);
      if (!intersection) return null;
      return normalizedRect({
        left: intersection.left - overlay.left,
        top: intersection.top - overlay.top,
        width: intersection.width,
        height: intersection.height
      });
    }).filter(Boolean);
    var fragments = [localBounds];
    var bounded = true;
    occlusions.forEach(function (occlusion) {
      var next = [];
      fragments.forEach(function (fragment) {
        next = next.concat(subtractRect(fragment, occlusion));
      });
      if (next.length > maxFragments) {
        bounded = false;
        next = next.slice(0, maxFragments);
      }
      fragments = next;
    });
    return {
      occluded: occlusions.length > 0,
      fullyOccluded: occlusions.length > 0 && fragments.length === 0,
      fragments: fragments,
      occlusions: occlusions,
      bounded: bounded,
      width: overlay.width,
      height: overlay.height
    };
  }

  function clampPlacement(rect, viewport) {
    var width = Number(rect.width || 0);
    var height = Number(rect.height || 0);
    var maxLeft = Math.max(4, Number(viewport.width || 0) - width - 4);
    var maxTop = Math.max(4, Number(viewport.height || 0) - height - 4);
    var left = Math.max(4, Math.min(maxLeft, Number(rect.left || 0)));
    var top = Math.max(4, Math.min(maxTop, Number(rect.top || 0)));
    return { left: Math.round(left), top: Math.round(top), width: width, height: height, right: Math.round(left) + width, bottom: Math.round(top) + height };
  }

  function tableRectForSeats(seats) {
    var rects = (seats || []).map(function (seat) { return normalizedRect(seat && (seat.rect || seat.boundingBox || seat.anchorBox || seat)); }).filter(function (rect) { return rect && rect.width > 0 && rect.height > 0; });
    if (!rects.length) return null;
    var left = Math.min.apply(Math, rects.map(function (rect) { return rect.left; }));
    var top = Math.min.apply(Math, rects.map(function (rect) { return rect.top; }));
    var right = Math.max.apply(Math, rects.map(function (rect) { return rect.right; }));
    var bottom = Math.max.apply(Math, rects.map(function (rect) { return rect.bottom; }));
    return normalizedRect({ left: left, top: top, width: right - left, height: bottom - top });
  }

  function canonicalSeatHudSide(anchorRect, tableRect) {
    return 'below';
  }

  function accessibleSeatHudPlacement(rect, viewport, gripSize) {
    var requested = normalizedRect(rect);
    var viewportWidth = Math.max(0, Number(viewport && viewport.width || 0));
    var viewportHeight = Math.max(0, Number(viewport && viewport.height || 0));
    var margin = 4;
    gripSize = Math.max(8, Number(gripSize || 16));
    var left;
    if (requested.width <= Math.max(0, viewportWidth - margin * 2)) left = Math.max(margin, Math.min(viewportWidth - requested.width - margin, requested.left));
    else left = Math.max(margin - Math.max(0, requested.width - gripSize), Math.min(viewportWidth - gripSize - margin, requested.left));
    var top;
    if (requested.height <= Math.max(0, viewportHeight - margin * 2)) top = Math.max(margin, Math.min(viewportHeight - requested.height - margin, requested.top));
    else top = Math.max(margin - Math.max(0, requested.height - gripSize), Math.min(viewportHeight - gripSize - margin, requested.top));
    var rendered = normalizedRect({ left: Math.round(left), top: Math.round(top), width: requested.width, height: requested.height });
    rendered.viewportClampApplied = Math.round(requested.left) !== rendered.left || Math.round(requested.top) !== rendered.top;
    rendered.gripAccessible = rendered.left + gripSize > 0 && rendered.left < viewportWidth && rendered.top < viewportHeight && rendered.bottom > 0;
    return rendered;
  }

  function canonicalSeatHudPlacement(anchorRect, overlaySize, viewport, tableRect, gap) {
    gap = Number.isFinite(Number(gap)) ? Number(gap) : 8;
    var side = canonicalSeatHudSide(anchorRect, tableRect);
    var requested = Object.assign({ kind: side }, normalizedRect(placementForKind(side, anchorRect, overlaySize || {}, gap)));
    var rendered = accessibleSeatHudPlacement(requested, viewport);
    return Object.assign({}, requested, { kind: side, canonicalRequestedRect: requested, canonicalRenderedRect: normalizedRect(rendered), viewportClampApplied: rendered.viewportClampApplied, gripAccessible: rendered.gripAccessible, canonical: true });
  }

  function layoutCanonicalSeatHudOverlays(entries, sizes, viewport, manualOffsets, tableRect) {
    var placements = new Map();
    var diagnostics = new Map();
    (entries || []).forEach(function (entry) {
      var playerId = String(entry.playerId);
      var size = sizes && sizes[playerId] || { width: 150, height: 20 };
      var visualRect = entry.visualRect || entry.rect;
      var canonical = canonicalSeatHudPlacement(visualRect, size, viewport, tableRect || entry.tableRect, 8);
      var canonicalRect = normalizedRect(canonical.canonicalRequestedRect || canonical);
      var offset = manualOffsets && manualOffsets[playerId];
      var validOffset = offset && Number.isFinite(Number(offset.offsetX)) && Number.isFinite(Number(offset.offsetY));
      var requested = normalizedRect({
        left: canonicalRect.left + (validOffset ? Number(offset.offsetX) : 0),
        top: canonicalRect.top + (validOffset ? Number(offset.offsetY) : 0),
        width: size.width,
        height: size.height
      });
      var rendered = accessibleSeatHudPlacement(requested, viewport);
      var placement = Object.assign({}, rendered, {
        kind: canonical.kind,
        manual: Boolean(validOffset),
        canonicalRect: canonicalRect,
        requestedRect: requested,
        manualOffsetX: validOffset ? Number(offset.offsetX) : 0,
        manualOffsetY: validOffset ? Number(offset.offsetY) : 0
      });
      placements.set(playerId, placement);
      diagnostics.set(playerId, {
        stablePlayerId: playerId,
        physicalSeat: entry.physicalSeat === undefined ? entry.clockwiseIndex : entry.physicalSeat,
        seatIndex: entry.seatIndex === undefined ? null : entry.seatIndex,
        seatAnchorRect: normalizedRect(visualRect),
        identityAnchorRect: normalizedRect(entry.identityAnchorRect || entry.rect),
        visualAnchorSource: entry.visualAnchorSource || 'authoritative-seat-fallback',
        visualAnchorRect: normalizedRect(visualRect),
        canonicalHudRect: canonicalRect,
        manualOffsetX: placement.manualOffsetX,
        manualOffsetY: placement.manualOffsetY,
        requestedHudRect: normalizedRect(requested),
        renderedHudRect: normalizedRect(rendered),
        viewportClampApplied: rendered.viewportClampApplied,
        gripAccessible: rendered.gripAccessible
      });
    });
    return { placements: placements, diagnostics: diagnostics };
  }

  function relativeOffset(anchorRect, placement) {
    if (!anchorRect || !placement) return null;
    var offsetX = Number(placement.left) - Number(anchorRect.left);
    var offsetY = Number(placement.top) - Number(anchorRect.top);
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return null;
    return { offsetX: Math.round(offsetX), offsetY: Math.round(offsetY) };
  }

  function manualPlacement(anchorRect, offset, overlaySize, viewport) {
    if (!anchorRect || !offset || !Number.isFinite(Number(offset.offsetX)) || !Number.isFinite(Number(offset.offsetY))) return null;
    var width = Number(overlaySize && overlaySize.width || 150);
    var height = Number(overlaySize && overlaySize.height || 20);
    var raw = {
      left: Number(anchorRect.left) + Number(offset.offsetX),
      top: Number(anchorRect.top) + Number(offset.offsetY),
      width: width,
      height: height
    };
    var viewportWidth = Number(viewport && viewport.width || 0);
    var viewportHeight = Number(viewport && viewport.height || 0);
    if (raw.left + width < 0 || raw.top + height < 0 || raw.left > viewportWidth || raw.top > viewportHeight) return null;
    return Object.assign({ kind: 'manual', manual: true, shifted: false }, clampPlacement(raw, viewport));
  }

  function layoutHybridOverlays(entries, sizes, viewport, manualOffsets) {
    var placements = new Map();
    var occupied = [];
    var invalidManualPlayerIds = [];
    var automaticEntries = [];
    (entries || []).forEach(function (entry) {
      var playerId = String(entry.playerId);
      var size = sizes && sizes[playerId] || { width: 150, height: 20 };
      var offset = manualOffsets && manualOffsets[playerId];
      if (!offset) {
        automaticEntries.push(entry);
        return;
      }
      var placement = manualPlacement(entry.rect, offset, size, viewport);
      if (!placement) {
        invalidManualPlayerIds.push(playerId);
        automaticEntries.push(entry);
        return;
      }
      placements.set(playerId, placement);
      occupied.push(placement);
    });
    automaticEntries.forEach(function (entry) {
      var playerId = String(entry.playerId);
      var size = sizes && sizes[playerId] || { width: 150, height: 20 };
      var placement = chooseOverlayPlacement(entry.rect, size, viewport, entry.obstacles || [], occupied, entry.outward, 12);
      placements.set(playerId, placement);
      if (placement) occupied.push(placement);
    });
    return { placements: placements, invalidManualPlayerIds: invalidManualPlayerIds };
  }

  function layoutWithheldPlaceholders(items, sizes, viewport, blockers, spacing) {
    spacing = Number.isFinite(spacing) ? spacing : 4;
    var occupied = (blockers || []).slice();
    var placements = new Map();
    var groups = new Map();
    (items || []).forEach(function (item) {
      var groupKey = String(item.seatId || item.playerId || 'unknown');
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(item);
    });
    groups.forEach(function (group) {
      var widths = group.map(function (item) { return Number(sizes && sizes[String(item.playerId)] && sizes[String(item.playerId)].width || 170); });
      var heights = group.map(function (item) { return Number(sizes && sizes[String(item.playerId)] && sizes[String(item.playerId)].height || 18); });
      var groupWidth = Math.max.apply(Math, widths);
      var groupHeight = heights.reduce(function (total, height) { return total + height; }, 0) + Math.max(0, group.length - 1) * spacing;
      var first = group[0];
      var groupPlacement = chooseOverlayPlacement(first.rect, { width: groupWidth, height: groupHeight }, viewport, first.obstacles || [], occupied, first.outward, 8);
      if (!groupPlacement) {
        group.forEach(function (item) { placements.set(String(item.playerId), null); });
        return;
      }
      var top = groupPlacement.top;
      group.forEach(function (item, index) {
        var width = widths[index];
        var height = heights[index];
        placements.set(String(item.playerId), {
          left: Math.round(groupPlacement.left + (groupWidth - width) / 2),
          top: Math.round(top),
          width: width,
          height: height,
          kind: groupPlacement.kind,
          withheldStackIndex: index
        });
        top += height + spacing;
      });
      occupied.push({ left: groupPlacement.left, top: groupPlacement.top, width: groupWidth, height: groupHeight });
    });
    return placements;
  }

  function placementForKind(kind, anchorRect, overlaySize, gap) {
    var anchor = normalizedRect(anchorRect);
    var width = Number(overlaySize.width || 150);
    var height = Number(overlaySize.height || 20);
    var centerX = anchor.left + anchor.width / 2;
    var centerY = anchor.top + anchor.height / 2;
    if (kind === 'above') return { left: centerX - width / 2, top: anchor.top - height - gap, width: width, height: height };
    if (kind === 'left') return { left: anchor.left - width - gap, top: centerY - height / 2, width: width, height: height };
    if (kind === 'right') return { left: anchor.right + gap, top: centerY - height / 2, width: width, height: height };
    return { left: centerX - width / 2, top: anchor.bottom + gap, width: width, height: height };
  }

  function chooseOverlayPlacement(anchorRect, overlaySize, viewport, obstacles, occupied, outward, gap) {
    gap = Number.isFinite(gap) ? gap : 12;
    obstacles = (obstacles || []).map(function (item) { return normalizedRect(item && item.rect || item); }).filter(Boolean);
    occupied = (occupied || []).map(function (item) { return normalizedRect(item && item.rect || item); }).filter(Boolean);
    var blockers = obstacles.concat(occupied);
    var kinds = ['below', 'above', 'left', 'right'];
    var candidates = kinds.map(function (kind) { return Object.assign({ kind: kind, shifted: false }, clampPlacement(placementForKind(kind, anchorRect, overlaySize, gap), viewport)); });
    var vector = outward || { x: 0, y: -1 };
    var magnitude = Math.sqrt(Number(vector.x || 0) * Number(vector.x || 0) + Number(vector.y || 0) * Number(vector.y || 0)) || 1;
    var unitX = Number(vector.x || 0) / magnitude;
    var unitY = Number(vector.y || -1) / magnitude;
    for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      var candidate = candidates[candidateIndex];
      if (obstacles.some(function (blocker) { return rectsOverlap(candidate, blocker, 3); })) continue;
      if (!occupied.some(function (blocker) { return rectsOverlap(candidate, blocker, 3); })) return candidate;
      for (var collisionStep = 1; collisionStep <= 12; collisionStep += 1) {
        var collisionShifted = clampPlacement({ left: candidate.left + unitX * collisionStep * 14, top: candidate.top + unitY * collisionStep * 14, width: candidate.width, height: candidate.height }, viewport);
        collisionShifted.kind = candidate.kind;
        collisionShifted.shifted = true;
        collisionShifted.outwardStep = collisionStep;
        if (!blockers.some(function (blocker) { return rectsOverlap(collisionShifted, blocker, 3); })) return collisionShifted;
      }
    }
    for (var step = 1; step <= 12; step += 1) {
      for (var index = 0; index < candidates.length; index += 1) {
        var base = candidates[index];
        var shifted = clampPlacement({ left: base.left + unitX * step * 14, top: base.top + unitY * step * 14, width: base.width, height: base.height }, viewport);
        shifted.kind = base.kind;
        shifted.shifted = true;
        shifted.outwardStep = step;
        if (!blockers.some(function (blocker) { return rectsOverlap(shifted, blocker, 3); })) return shifted;
      }
    }
    return null;
  }

  function layoutOverlays(entries, sizes, viewport) {
    var occupied = [];
    var placements = new Map();
    (entries || []).forEach(function (entry) {
      var size = sizes && sizes[String(entry.playerId)] || { width: 150, height: 20 };
      var placement = chooseOverlayPlacement(entry.rect, size, viewport, entry.obstacles || [], occupied, entry.outward, 12);
      placements.set(String(entry.playerId), placement);
      if (placement) occupied.push(placement);
    });
    return placements;
  }

  function normalizeLeaderboardOpen(value) {
    return value === true;
  }

  function statsKey(stats, displayedStatIds, opportunityStatsLayout, statSource) {
    return normalizeStatSource(statSource) + '|' + overlayStats.formatOverlay(stats || {}, displayedStatIds || overlayStats.DEFAULT_DISPLAYED_STAT_IDS) + '|' + JSON.stringify(displayedStatIds || overlayStats.DEFAULT_DISPLAYED_STAT_IDS) + '|' + normalizeOpportunityStatsLayout(opportunityStatsLayout);
  }

  function rectKey(rect) {
    if (!rect) return 'none';
    return [rect.left, rect.top, rect.width, rect.height].map(function (value) { return Math.round(Number(value || 0) * 10) / 10; }).join('|');
  }

  function createController(adapter) {
    var records = new Map();

    function remove(playerId, reason) {
      var record = records.get(String(playerId));
      if (!record) return false;
      adapter.remove(record, reason);
      records.delete(String(playerId));
      return true;
    }

    function clear(reason) {
      Array.from(records.keys()).forEach(function (playerId) { remove(playerId, reason || 'overlay display disabled'); });
    }

    function reconcile(entries, options) {
      options = options || {};
      if (!overlaysEnabled(options.displayMode)) {
        clear('leaderboard-only display mode');
        return { created: 0, updated: 0, moved: 0, removed: 0, skipped: entries.length };
      }
      var accepted = new Map();
      var usedSeats = new Set();
      var skipped = 0;
      (entries || []).forEach(function (entry) {
        var playerId = String(entry.playerId || '');
        var seatId = String(entry.seatId || '');
        if (!entry.confirmed || !playerId || !entry.name || !seatId || !entry.rect) {
          skipped += 1;
          adapter.skip(entry, 'unconfirmed mapping or incomplete seat anchor');
          return;
        }
        if (accepted.has(playerId) || usedSeats.has(seatId)) {
          skipped += 1;
          adapter.skip(entry, 'duplicate transient player or seat element');
          return;
        }
        accepted.set(playerId, entry);
        usedSeats.add(seatId);
      });

      var counts = { created: 0, updated: 0, moved: 0, removed: 0, skipped: skipped };
      Array.from(records.keys()).forEach(function (playerId) {
        if (!accepted.has(playerId)) {
          if (remove(playerId, 'confirmed player seat is no longer present')) counts.removed += 1;
        }
      });

      accepted.forEach(function (entry, playerId) {
        var current = records.get(playerId);
        var nextStatsKey = statsKey(entry.stats, entry.displayedStatIds, entry.opportunityStatsLayout, entry.statSource);
        var nextProfileKey = profilePresentationKey(entry.displayedProfile, entry.showPlayerProfiles, entry.profileStatSource, entry.statSource);
        var nextRectKey = rectKey(entry.rect);
        if (!current) {
          var created = adapter.create(entry);
          records.set(playerId, { playerId: playerId, name: entry.name, seatId: entry.seatId, statsKey: nextStatsKey, profileKey: nextProfileKey, rectKey: nextRectKey, element: created, entry: entry });
          counts.created += 1;
          return;
        }
        if (current.seatId !== entry.seatId) {
          adapter.move(current, entry, 'confirmed player moved or PokerNow recreated the seat DOM');
          current.seatId = entry.seatId;
          counts.moved += 1;
        }
        if (current.statsKey !== nextStatsKey || current.profileKey !== nextProfileKey || current.name !== entry.name) {
          adapter.update(current, entry, 'finalized statistics, displayed profile, visibility preference, or confirmed display name changed');
          current.statsKey = nextStatsKey;
          current.profileKey = nextProfileKey;
          current.name = entry.name;
          counts.updated += 1;
        }
        if (current.rectKey !== nextRectKey) {
          adapter.position(current, entry);
          current.rectKey = nextRectKey;
        }
        current.entry = entry;
      });
      return counts;
    }

    return { reconcile: reconcile, clear: clear, records: records };
  }

  var api = { DISPLAY_MODES: DISPLAY_MODES, OPPORTUNITY_STATS_LAYOUTS: OPPORTUNITY_STATS_LAYOUTS, STAT_SOURCES: STAT_SOURCES, PROFILE_PRESENTATIONS: PROFILE_PRESENTATIONS, PROFILE_ARCHETYPE_ORDER: PROFILE_ARCHETYPE_ORDER, normalizeDisplayMode: normalizeDisplayMode, normalizeStatSource: normalizeStatSource, normalizeOpportunityStatsLayout: normalizeOpportunityStatsLayout, normalizeLeaderboardOpen: normalizeLeaderboardOpen, overlaysEnabled: overlaysEnabled, detailsEnabled: detailsEnabled, visibilityForMode: visibilityForMode, modeForVisibility: modeForVisibility, normalizePlayerName: normalizedText, exactNameMatch: exactNameMatch, identityLabel: identityLabel, compactStatLabel: compactStatLabel, compactStatLabels: compactStatLabels, compactStatsLabel: compactStatsLabel, compactStatRows: compactStatRows, careerStatsToOverlayStats: careerStatsToOverlayStats, visibleProfilePresentation: visibleProfilePresentation, profileChipHtml: profileChipHtml, profileTooltipHtml: profileTooltipHtml, profilePresentationKey: profilePresentationKey, scorePlayerSeat: scorePlayerSeat, assignPlayersToSeats: assignPlayersToSeats, chooseAnchorCandidate: chooseAnchorCandidate, placeOverlay: placeOverlay, clampPlacement: clampPlacement, accessibleSeatHudPlacement: accessibleSeatHudPlacement, tableRectForSeats: tableRectForSeats, canonicalSeatHudSide: canonicalSeatHudSide, canonicalSeatHudPlacement: canonicalSeatHudPlacement, layoutCanonicalSeatHudOverlays: layoutCanonicalSeatHudOverlays, relativeOffset: relativeOffset, manualPlacement: manualPlacement, rectsOverlap: rectsOverlap, stackingContextReasons: stackingContextReasons, stackingContextChain: stackingContextChain, intersectRects: intersectRects, subtractRect: subtractRect, nativePanelVisibleFragments: nativePanelVisibleFragments, chooseOverlayPlacement: chooseOverlayPlacement, layoutOverlays: layoutOverlays, layoutHybridOverlays: layoutHybridOverlays, layoutWithheldPlaceholders: layoutWithheldPlaceholders, createController: createController };
  root.PokerSeatOverlay = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
