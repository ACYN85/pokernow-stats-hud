/* Pure, fail-closed live pot-odds decision resolver and presentation helpers. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && typeof root.PokerNowRuntimeScope.isPokerNowGamePage === 'function' && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;

  var REASONS = Object.freeze({
    SUPPORTED: 'SUPPORTED', DISABLED: 'DISABLED', MISSING_SELF_ID: 'MISSING_SELF_ID', NOT_USERS_TURN: 'NOT_USERS_TURN',
    NO_CALL_REQUIRED: 'NO_CALL_REQUIRED', USER_NOT_IN_HAND: 'USER_NOT_IN_HAND', USER_FOLDED: 'USER_FOLDED', USER_ALL_IN: 'USER_ALL_IN',
    MISSING_ACTION_STATE: 'MISSING_ACTION_STATE', MISSING_POT_STATE: 'MISSING_POT_STATE', AMBIGUOUS_CALL_AMOUNT: 'AMBIGUOUS_CALL_AMOUNT',
    AMBIGUOUS_POT_ELIGIBILITY: 'AMBIGUOUS_POT_ELIGIBILITY', SIDE_POT_UNRESOLVED: 'SIDE_POT_UNRESOLVED', HAND_TRANSITION: 'HAND_TRANSITION'
  });

  function numeric(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function diagnosticEvidence(input) {
    input = input || {};
    var players = Array.isArray(input.players) ? input.players : [];
    var self = playerById(players, input.localPlayerId);
    var pricePlayers = players.filter(function (player) { return player.folded !== true && player.active !== false && numeric(player.streetContribution); });
    var highest = pricePlayers.length ? Math.max.apply(null, pricePlayers.map(function (player) { return player.streetContribution; })) : null;
    var streetCommitmentPlayers = players.filter(function (player) { return numeric(player.streetContribution) && player.streetContribution > 0; });
    return {
      actor: input.actingPlayerId || null,
      actorSource: input.actorSource || null,
      actionSource: input.actionSource || null,
      currentPot: numeric(input.currentPot) ? input.currentPot : null,
      streetCommitmentTotal: streetCommitmentPlayers.reduce(function (sum, player) { return sum + player.streetContribution; }, 0),
      streetCommitmentPlayerIds: streetCommitmentPlayers.slice(0, 10).map(function (player) { return String(player.playerId); }),
      selfContribution: self && numeric(self.streetContribution) ? self.streetContribution : null,
      highestLiveContestableContribution: highest,
      selfStack: self && numeric(self.stack) ? self.stack : null,
      players: players.slice(0, 10).map(function (player) {
        return {
          playerId: player.playerId === undefined || player.playerId === null ? null : String(player.playerId),
          streetContribution: numeric(player.streetContribution) ? player.streetContribution : null,
          totalContribution: numeric(player.totalContribution) ? player.totalContribution : null,
          stack: numeric(player.stack) ? player.stack : null,
          folded: player.folded === true,
          allIn: player.allIn === true,
          active: player.active !== false,
          inHand: player.inHand !== false
        };
      })
    };
  }
  function idle(reason, input, extra) {
    var result = { status: 'idle', playerId: input && input.localPlayerId || null, handId: input && input.handId || null, street: input && input.street || null, amountToCall: null, currentEligiblePot: null, potAfterCall: null, requiredEquity: null, reasonCode: reason, evidence: Object.assign(diagnosticEvidence(input), { rejectionGate: reason }) };
    extra = extra || {};
    if (extra.evidence) result.evidence = Object.assign(result.evidence, clone(extra.evidence));
    Object.keys(extra).filter(function (key) { return key !== 'evidence'; }).forEach(function (key) { result[key] = extra[key]; });
    return result;
  }
  function unsupported(reason, input, evidence) {
    var result = idle(reason, input, { evidence: Object.assign({ rejectionGate: reason }, evidence || {}) });
    result.status = 'unsupported';
    return result;
  }
  function playerById(players, playerId) { return (players || []).find(function (player) { return String(player.playerId) === String(playerId); }) || null; }

  function resolveEligiblePot(input, self, amountToCall) {
    if (numeric(input.explicitEligiblePot)) return { supported: true, value: input.explicitEligiblePot, source: 'explicit eligible pot' };
    if (Array.isArray(input.sidePots)) {
      if (input.sidePots.some(function (pot) { return !pot || pot.resolved !== true || !numeric(pot.amount) || !Array.isArray(pot.eligiblePlayerIds); })) return { supported: false, reason: REASONS.SIDE_POT_UNRESOLVED };
      return { supported: true, value: input.sidePots.filter(function (pot) { return pot.eligiblePlayerIds.map(String).includes(String(self.playerId)); }).reduce(function (sum, pot) { return sum + pot.amount; }, 0), source: 'resolved side-pot eligibility' };
    }
    var players = input.players || [];
    var allInPresent = players.some(function (player) { return player.allIn === true; });
    var completePreflopCommitments = input.street === 'preflop' && players.length > 1 && players.every(function (player) { return numeric(player.streetContribution); });
    if (!allInPresent && input.sidePotAmbiguous !== true && input.unresolvedExcess !== true && completePreflopCommitments) {
      var namedPreflopPot = numeric(input.currentPot) ? input.currentPot : 0;
      var preflopCommitmentPot = players.reduce(function (sum, player) { return sum + player.streetContribution; }, 0);
      return {
        supported: true,
        value: Math.max(namedPreflopPot, preflopCommitmentPot),
        source: preflopCommitmentPot > namedPreflopPot ? 'complete preflop street commitments; authoritative named pot used as floor' : 'authoritative named current pot; complete preflop commitments verified',
        namedPot: numeric(input.currentPot) ? input.currentPot : null,
        commitmentPot: preflopCommitmentPot,
        commitmentFloorApplied: preflopCommitmentPot > namedPreflopPot
      };
    }
    if (!allInPresent && input.sidePotAmbiguous !== true && input.unresolvedExcess !== true && numeric(input.currentPot)) return { supported: true, value: input.currentPot, source: 'authoritative named current pot; no all-in eligibility ambiguity' };
    var liveContenders = players.filter(function (player) { return player.folded !== true && player.active !== false && player.inHand !== false; });
    var allInOpponents = liveContenders.filter(function (player) { return String(player.playerId) !== String(self.playerId) && player.allIn === true && numeric(player.streetContribution); });
    var highestLiveContribution = liveContenders.filter(function (player) { return numeric(player.streetContribution); }).reduce(function (highest, player) { return Math.max(highest, player.streetContribution); }, 0);
    var fullyMatchableHeadsUpAllIn = liveContenders.length === 2 && allInOpponents.length === 1 && allInOpponents[0].streetContribution === highestLiveContribution && self.streetContribution + self.stack >= highestLiveContribution;
    if (fullyMatchableHeadsUpAllIn && input.sidePotAmbiguous !== true && input.unresolvedExcess !== true && numeric(input.currentPot) && input.currentPot >= highestLiveContribution) {
      return { supported: true, value: input.currentPot, source: 'authoritative named current pot; fully matchable heads-up all-in', headsUpAllInProof: true };
    }
    var totalsKnown = players.length > 1 && players.every(function (player) { return numeric(player.totalContribution); });
    if (totalsKnown) {
      var contestableCap = self.totalContribution + amountToCall;
      return {
        supported: true,
        value: players.reduce(function (sum, player) { return sum + Math.min(player.totalContribution, contestableCap); }, 0),
        source: 'certified total contributions capped to self contestable level',
        contestableCap: contestableCap,
        excludedExcess: players.reduce(function (sum, player) { return sum + Math.max(0, player.totalContribution - contestableCap); }, 0)
      };
    }
    if (input.sidePotAmbiguous === true || input.unresolvedExcess === true || allInPresent) return { supported: false, reason: input.sidePotAmbiguous === true ? REASONS.SIDE_POT_UNRESOLVED : REASONS.AMBIGUOUS_POT_ELIGIBILITY };
    return { supported: false, reason: REASONS.MISSING_POT_STATE };
  }

  function resolve(input) {
    input = input || {};
    if (input.enabled === false) return idle(REASONS.DISABLED, input);
    if (!input.localPlayerId) return unsupported(REASONS.MISSING_SELF_ID, input);
    if (input.transitioning === true || input.street === 'terminal') return idle(REASONS.HAND_TRANSITION, input);
    if (!input.actingPlayerId) return unsupported(REASONS.MISSING_ACTION_STATE, input);
    if (String(input.actingPlayerId) !== String(input.localPlayerId)) return idle(REASONS.NOT_USERS_TURN, input);
    var self = playerById(input.players, input.localPlayerId);
    if (!self || self.active === false || self.inHand === false) return idle(REASONS.USER_NOT_IN_HAND, input);
    if (self.folded === true) return idle(REASONS.USER_FOLDED, input);
    if (self.allIn === true || self.stack === 0) return idle(REASONS.USER_ALL_IN, input);
    if (!numeric(self.streetContribution) || !numeric(self.stack)) return unsupported(REASONS.AMBIGUOUS_CALL_AMOUNT, input, { self: self });
    var activePlayers = (input.players || []).filter(function (player) { return player.folded !== true && player.active !== false && numeric(player.streetContribution); });
    if (!activePlayers.length) return unsupported(REASONS.MISSING_ACTION_STATE, input);
    var highest = Math.max.apply(null, activePlayers.map(function (player) { return player.streetContribution; }));
    var nominal = highest - self.streetContribution;
    if (!(nominal > 0)) return {
      status: 'supported', playerId: String(input.localPlayerId), handId: input.handId === undefined ? null : input.handId, street: input.street || null,
      currentEligiblePot: numeric(input.currentPot) ? input.currentPot : null, amountToCall: 0,
      potAfterCall: numeric(input.currentPot) ? input.currentPot : null, requiredEquity: null,
      reasonCode: REASONS.NO_CALL_REQUIRED,
      evidence: Object.assign(diagnosticEvidence(input), { rejectionGate: null, nominalAmountToCall: 0, selfStreetContribution: self.streetContribution, highestStreetContribution: highest, selfStack: self.stack, freeCheck: true, beforeRake: true })
    };
    var amountToCall = Math.min(nominal, self.stack);
    if (!(amountToCall > 0)) return idle(REASONS.USER_ALL_IN, input);
    var pot = resolveEligiblePot(input, self, amountToCall);
    if (!pot.supported) return unsupported(pot.reason, input, { nominalAmountToCall: nominal, cappedAmountToCall: amountToCall, rejectionGate: pot.reason });
    var potAfterCall = pot.value + amountToCall;
    if (!(potAfterCall > 0)) return unsupported(REASONS.MISSING_POT_STATE, input);
    return {
      status: 'supported', playerId: String(input.localPlayerId), handId: input.handId === undefined ? null : input.handId, street: input.street || null,
      currentEligiblePot: pot.value, amountToCall: amountToCall, potAfterCall: potAfterCall, requiredEquity: amountToCall / potAfterCall,
      reasonCode: REASONS.SUPPORTED,
      evidence: Object.assign(diagnosticEvidence(input), { rejectionGate: null, potSource: pot.source, eligibilitySource: pot.source, namedPot: pot.namedPot === undefined ? (numeric(input.currentPot) ? input.currentPot : null) : pot.namedPot, commitmentPot: pot.commitmentPot === undefined ? null : pot.commitmentPot, commitmentFloorApplied: pot.commitmentFloorApplied === true, nominalAmountToCall: nominal, selfStreetContribution: self.streetContribution, highestStreetContribution: highest, selfStack: self.stack, contestableCap: pot.contestableCap, excludedExcess: pot.excludedExcess || 0, headsUpAllInProof: pot.headsUpAllInProof === true, beforeRake: true })
    };
  }

  function formatAmount(value) {
    var amount = Number(value || 0);
    if (!Number.isFinite(amount)) amount = 0;
    amount = Math.round(amount * 100000000) / 100000000;
    if (Object.is(amount, -0)) amount = 0;
    return String(amount);
  }
  function formatPercent(value) { return (Number(value || 0) * 100).toFixed(1) + '%'; }
  function semanticLedgerApi() {
    if (root.PokerSemanticHandLedger) return root.PokerSemanticHandLedger;
    if (typeof require === 'function') return require('./semanticHandLedger.js');
    throw new Error('PokerSemanticHandLedger is required for live pot-odds continuity');
  }
  function boundedText(value, fallback) { return String(value || fallback || 'unknown').slice(0, 160); }
  function createLiveStateContinuity(options) {
    options = options || {};
    return {
      ledger: semanticLedgerApi().createState({ maxRecords: 4, maxObservationsPerHand: Number(options.maxObservationsPerHand || 240), maxAttempts: 8 }),
      currentHandId: null,
      revision: 0,
      diagnostics: {
        generation: 0, revision: 0, currentHandId: null, lastAuthoritativeUpdate: null, lastReset: null,
        lastReconcile: null, preservedVisualReconcileCount: 0, lastPreservedAcrossVisualReconcile: null
      }
    };
  }
  function resetLiveStateContinuity(state, reason, source, timestamp) {
    if (!state || !state.ledger) return { reset: false, reason: 'live continuity state unavailable' };
    var priorHandId = state.currentHandId;
    if (priorHandId) semanticLedgerApi().discard(state.ledger, priorHandId);
    state.currentHandId = null;
    state.revision += 1;
    state.diagnostics.generation += 1;
    state.diagnostics.revision = state.revision;
    state.diagnostics.currentHandId = null;
    state.diagnostics.lastReset = { timestamp: Number(timestamp || Date.now()), reason: boundedText(reason, 'authoritative reset'), source: boundedText(source, 'authoritative lifecycle'), priorHandId: priorHandId };
    return { reset: true, priorHandId: priorHandId, reason: state.diagnostics.lastReset.reason };
  }
  function observeLiveStateContinuity(state, observation) {
    observation = observation || {};
    if (!state || !state.ledger) return { observed: false, reason: 'live continuity state unavailable' };
    var handId = observation.handId === null || observation.handId === undefined || observation.handId === '<D>' ? null : String(observation.handId);
    if (!handId) return { observed: false, reason: 'authoritative hand ID unavailable' };
    var previousHandId = state.currentHandId;
    if (previousHandId && previousHandId !== handId) resetLiveStateContinuity(state, 'authoritative new hand superseded prior live hand', observation.source, observation.timestamp);
    var result = semanticLedgerApi().observe(state.ledger, {
      handId: handId,
      authoritativeHandId: observation.authoritativeHandId || handId,
      previousHandId: previousHandId === handId ? handId : null,
      previousAuthoritativeHandId: previousHandId === handId ? handId : null,
      sameHand: previousHandId === handId,
      frameId: observation.frameId || 'pot-odds-live-' + (state.revision + 1),
      timestamp: Number(observation.timestamp || Date.now()),
      eventName: observation.eventName || 'authoritative-game-state',
      previousState: observation.previousState || null,
      currentState: observation.currentState || {},
      patch: observation.patch || {}
    });
    state.currentHandId = handId;
    state.revision += 1;
    state.diagnostics.revision = state.revision;
    state.diagnostics.currentHandId = handId;
    state.diagnostics.lastAuthoritativeUpdate = { timestamp: Number(observation.timestamp || Date.now()), source: boundedText(observation.source, 'authoritative merged game state'), handId: handId, frameId: observation.frameId || null, eventName: observation.eventName || null };
    return { observed: true, handId: handId, revision: state.revision, ledgerResult: result };
  }
  function preserveLiveStateOnVisualReconcile(state, source, timestamp) {
    if (!state || !state.diagnostics) return null;
    state.diagnostics.preservedVisualReconcileCount += 1;
    state.diagnostics.lastReconcile = { timestamp: Number(timestamp || Date.now()), source: boundedText(source, 'visual reconcile'), semanticMutation: false };
    state.diagnostics.lastPreservedAcrossVisualReconcile = { timestamp: state.diagnostics.lastReconcile.timestamp, source: state.diagnostics.lastReconcile.source, handId: state.currentHandId, revision: state.revision };
    return clone(state.diagnostics.lastPreservedAcrossVisualReconcile);
  }
  function liveStateFromContinuity(state) {
    return state && state.currentHandId ? semanticLedgerApi().liveBettingState(state.ledger, state.currentHandId) : null;
  }
  function liveStateContinuityInfo(state) {
    return state && state.diagnostics ? clone(state.diagnostics) : null;
  }
  function decisionRenderFingerprint(decision, enabled) {
    decision = decision || {};
    var evidence = decision.evidence || {};
    return JSON.stringify({
      status: decision.status || null,
      playerId: decision.playerId === undefined ? null : decision.playerId,
      handId: decision.handId === undefined ? null : decision.handId,
      street: decision.street || null,
      actor: evidence.actor === undefined ? null : evidence.actor,
      amountToCall: decision.amountToCall === undefined ? null : decision.amountToCall,
      currentEligiblePot: decision.currentEligiblePot === undefined ? null : decision.currentEligiblePot,
      potAfterCall: decision.potAfterCall === undefined ? null : decision.potAfterCall,
      requiredEquity: decision.requiredEquity === undefined ? null : decision.requiredEquity,
      presentationState: decision.presentationState || null,
      reasonCode: decision.reasonCode || null,
      enabled: enabled !== false
    });
  }
  function heroPlacement(input) {
    input = input || {};
    var viewport = input.viewport || {};
    var width = Math.max(0, Number(viewport.width || 0));
    var height = Math.max(0, Number(viewport.height || 0));
    var size = input.size || {};
    var widgetWidth = Math.max(1, Number(size.width || 240));
    var widgetHeight = Math.max(1, Number(size.height || 34));
    var margin = 6;
    var gap = Math.max(8, Math.min(12, Number(input.gap || 10)));
    function usableRect(rect) { return rect && Number.isFinite(rect.left) && Number.isFinite(rect.top) && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0; }
    function normalizedRect(rect) { return { left: Number(rect.left), top: Number(rect.top), width: Number(rect.width), height: Number(rect.height), right: Number(rect.left) + Number(rect.width), bottom: Number(rect.top) + Number(rect.height) }; }
    function overlaps(left, top, rect) { return left < rect.left + rect.width && left + widgetWidth > rect.left && top < rect.top + rect.height && top + widgetHeight > rect.top; }
    var legacyHeroAnchor = !usableRect(input.anchorRect) && usableRect(input.cardRect);
    var anchorRect = usableRect(input.anchorRect) ? input.anchorRect : legacyHeroAnchor ? input.cardRect : null;
    var anchorType = input.anchorType || 'actual-hero-card-region';
    var anchorLabel = String(input.anchorLabel || 'hero cards');
    var missingAnchorReason = input.missingAnchorReason || (legacyHeroAnchor || !input.anchorType ? 'actual hero card region unavailable' : anchorLabel + ' unavailable');
    if (!anchorRect) return { left: margin, top: Math.max(margin, height - widgetHeight - margin), width: widgetWidth, height: widgetHeight, anchored: false, safe: false, strategy: null, selectedSide: null, chosenAnchor: anchorType, proposedRect: null, collision: { card: false, obstacleIndexes: [] }, candidates: [], suppressionReason: missingAnchorReason, candidateCount: 0, horizontalGap: null, verticalCenterDelta: null };
    var normalizedCard = normalizedRect(anchorRect);
    var obstacles = (input.obstacleRects || []).filter(usableRect).map(normalizedRect);
    var viewportRight = width - margin;
    var clampLeft = function (left) { return Math.max(margin, Math.min(viewportRight - widgetWidth, left)); };
    var clampTop = function (top) { return Math.max(margin, Math.min(height - widgetHeight - margin, top)); };
    var centerTop = clampTop(normalizedCard.top + (normalizedCard.height - widgetHeight) / 2);
    function candidate(side, left, top, strategy) {
      var boundedLeft = clampLeft(left);
      var boundedTop = clampTop(top);
      var cardCollision = overlaps(boundedLeft, boundedTop, normalizedCard);
      var obstacleIndexes = obstacles.map(function (rect, index) { return overlaps(boundedLeft, boundedTop, rect) ? index : -1; }).filter(function (index) { return index >= 0; });
      var inViewport = boundedLeft >= margin && boundedTop >= margin && boundedLeft + widgetWidth <= viewportRight && boundedTop + widgetHeight <= height - margin;
      return { side: side, left: boundedLeft, top: boundedTop, strategy: strategy, cardCollision: cardCollision, obstacleIndexes: obstacleIndexes, safe: inViewport && !cardCollision && !obstacleIndexes.length };
    }
    var leftExact = normalizedCard.left - gap - widgetWidth;
    var rightExact = normalizedCard.right + gap;
    var candidates = [
      candidate('left', leftExact, centerTop, input.anchorType ? 'left-of-' + anchorType : 'left-of-cards'),
      candidate('right', rightExact, centerTop, input.anchorType ? 'right-of-' + anchorType : 'right-of-cards')
    ];
    var chosen = candidates.find(function (item) { return item.safe; }) || null;
    var proposed = chosen || candidates[0];
    function layoutNumber(value) { return Math.round(Number(value) * 100) / 100; }
    var proposedRect = { left: layoutNumber(proposed.left), top: layoutNumber(proposed.top), width: widgetWidth, height: widgetHeight, right: layoutNumber(proposed.left + widgetWidth), bottom: layoutNumber(proposed.top + widgetHeight) };
    var horizontalGap = proposed.left + widgetWidth <= normalizedCard.left ? normalizedCard.left - (proposed.left + widgetWidth) : proposed.left >= normalizedCard.right ? proposed.left - normalizedCard.right : null;
    var pillCenterY = proposed.top + widgetHeight / 2;
    var cardCenterY = normalizedCard.top + normalizedCard.height / 2;
    return {
      left: proposedRect.left, top: proposedRect.top, width: widgetWidth, height: widgetHeight, anchored: true, safe: Boolean(chosen), strategy: chosen ? chosen.strategy : null,
      selectedSide: chosen ? chosen.side : null, chosenAnchor: anchorType, proposedRect: proposedRect,
      collision: { card: proposed.cardCollision, obstacleIndexes: proposed.obstacleIndexes.slice() },
      candidates: candidates.map(function (item) { return { side: item.side, strategy: item.strategy, safe: item.safe, proposedRect: { left: layoutNumber(item.left), top: layoutNumber(item.top), width: widgetWidth, height: widgetHeight, right: layoutNumber(item.left + widgetWidth), bottom: layoutNumber(item.top + widgetHeight) }, collision: { anchor: item.cardCollision, card: item.cardCollision, obstacleIndexes: item.obstacleIndexes.slice() } }; }),
      suppressionReason: chosen ? null : 'no bounded horizontal position beside ' + anchorLabel, candidateCount: candidates.length,
      horizontalGap: horizontalGap === null ? null : Math.round(horizontalGap), verticalCenterDelta: Math.round(pillCenterY - cardCenterY)
    };
  }
  function widgetHtml(decision) {
    if (!decision || decision.status !== 'supported') return '';
    var unknown = decision.presentationState === 'UNKNOWN';
    var freeCheck = !unknown && Number(decision.amountToCall) === 0 && decision.requiredEquity === null;
    var callText = unknown ? '—' : freeCheck ? '0' : formatAmount(decision.amountToCall);
    var needText = unknown ? '—' : freeCheck ? '—' : formatPercent(decision.requiredEquity);
    var title = unknown
      ? ['Call: unavailable', 'The table widget is applicable, but current decision semantics are temporarily insufficient.', 'No call amount or break-even equity is claimed.'].join('\n')
      : freeCheck
      ? ['Call amount: 0 chips', 'No call is required; checking is free.', 'No break-even equity threshold is shown.'].join('\n')
      : ['Current eligible pot: ' + formatAmount(decision.currentEligiblePot) + ' chips', 'Call amount: ' + callText + ' chips', 'Eligible pot after call: ' + formatAmount(decision.potAfterCall) + ' chips', 'Break-even equity: ' + needText, 'Before rake; future betting not included.'].join('\n');
    var compactSummary = 'Call ' + callText + ' · Need ' + needText;
    return '<button type="button" class="pnhud-pot-odds" data-pnhud-interactive="true" aria-label="Pot odds. ' + compactSummary + '" title="' + title + '"><span class="pnhud-pot-odds-title" data-pnhud-pot-odds-drag-handle="true" title="Drag pot odds panel">POT ODDS</span><span class="pnhud-pot-odds-label">Call</span><strong>' + callText + '</strong><span class="pnhud-pot-odds-label">Need</span><strong>' + needText + '</strong></button>';
  }

  var api = Object.freeze({ REASONS: REASONS, resolve: resolve, formatAmount: formatAmount, formatPercent: formatPercent, createLiveStateContinuity: createLiveStateContinuity, observeLiveStateContinuity: observeLiveStateContinuity, resetLiveStateContinuity: resetLiveStateContinuity, preserveLiveStateOnVisualReconcile: preserveLiveStateOnVisualReconcile, liveStateFromContinuity: liveStateFromContinuity, liveStateContinuityInfo: liveStateContinuityInfo, decisionRenderFingerprint: decisionRenderFingerprint, heroPlacement: heroPlacement, widgetHtml: widgetHtml, currentDecision: function (decision) { return clone(decision); } });
  root.PokerPotOdds = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
