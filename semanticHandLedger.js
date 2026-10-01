/* Pure, bounded production shadow ledger for finalized live-hand semantics. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && !isSupportedRuntimePage(root.PokerNowRuntimeScope, window.location)) return;

  var SCHEMA_VERSION = 1;
  var CLEANUP_SENTINEL = '<D>';
  var DEFAULT_MAX_RECORDS = 50;
  var DEFAULT_MAX_OBSERVATIONS = 240;
  var DEFAULT_MAX_ATTEMPTS = 100;
  var STATE_FIELDS = [
    'hI', 'gN', 'gT', 'oTC', 'pot', 'tB', 'cHB', 'mR', 'cPI', 'pITT', 'cRPI',
    'sBPI', 'bBPI', 'dealerID', 'deadButton', 'smallBlind', 'bigBlind', 'iHPI', 'pGS', 'pC',
    'players', 'seats', 'gameResult', 'availableActions', 'legalActions',
    'allowedActions', 'actionsAvailable', 'canRaise', 'raiseAllowed', 'reopensAction'
  ];
  var LEGAL_ACTION_FIELDS = [
    'availableActions', 'legalActions', 'allowedActions', 'actionsAvailable',
    'canRaise', 'raiseAllowed', 'reopensAction'
  ];
  var AMBIGUITY_CODES = Object.freeze({
    ALL_IN_REOPENING_UNSUPPORTED: 'ALL_IN_REOPENING_UNSUPPORTED',
    PARTIAL_HISTORY_AFTER_RECOVERY: 'PARTIAL_HISTORY_AFTER_RECOVERY',
    SETTLEMENT_UNRESOLVED: 'SETTLEMENT_UNRESOLVED',
    SHOWDOWN_INFERRED_FROM_COMPLETE_RIVER: 'SHOWDOWN_INFERRED_FROM_COMPLETE_RIVER',
    SHOWDOWN_INFERRED_FROM_TERMINAL_LIVE_PLAYERS: 'SHOWDOWN_INFERRED_FROM_TERMINAL_LIVE_PLAYERS',
    SHOWDOWN_INFERRED_FROM_REVEAL: 'SHOWDOWN_INFERRED_FROM_REVEAL',
    SIDE_POT_UNSUPPORTED: 'SIDE_POT_UNSUPPORTED',
    SPARSE_TERMINAL_STACK_RETAINED: 'SPARSE_TERMINAL_STACK_RETAINED',
    REFUND_IMPLICIT: 'REFUND_IMPLICIT',
    OBSERVATION_LIMIT_REACHED: 'OBSERVATION_LIMIT_REACHED'
  });

  function isSupportedRuntimePage(scope, loc) {
    if (scope && typeof scope.isPokerNowGamePage === 'function') return scope.isPokerNowGamePage(loc);
    var host = String(loc && loc.hostname || '').toLowerCase();
    return String(loc && loc.protocol || '').toLowerCase() === 'https:' &&
      (host === 'pokernow.com' || host === 'www.pokernow.com') &&
      /^\/games\/[^/]+\/?$/.test(String(loc && loc.pathname || ''));
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function numeric(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function boundedInteger(value, fallback, minimum, maximum) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
  }

  function selectState(state) {
    if (!isObject(state)) return null;
    var selected = {};
    STATE_FIELDS.forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(state, field)) selected[field] = clone(state[field]);
    });
    return selected;
  }

  function phaseToStreet(gameType) {
    var phase = Array.isArray(gameType) ? Number(gameType[1]) : NaN;
    return phase === 0 ? 'preflop' : phase === 1 ? 'flop' : phase === 2 ? 'turn' : phase === 3 ? 'river' : phase === 5 ? 'terminal' : null;
  }

  function currentActor(state) {
    return state && (state.pITT || state.cPI) || null;
  }

  function pushBounded(array, value, limit) {
    array.push(value);
    while (array.length > limit) array.shift();
  }

  function recordAttempt(state, attempt) {
    pushBounded(state.finalizationAttempts, Object.assign({ timestamp: Date.now(), previouslyFinalized: false }, clone(attempt || {})), state.maxAttempts);
  }

  function createState(options) {
    options = options || {};
    var maxRecords = boundedInteger(options.maxRecords, DEFAULT_MAX_RECORDS, 1, 200);
    var records = clone(options.finalizedRecords || []).slice(-maxRecords);
    var ids = (options.finalizedHandIds || []).map(String);
    records.forEach(function (record) {
      if (record && record.handIdentity && record.handIdentity.handId) ids.push(String(record.handIdentity.handId));
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      maxRecords: maxRecords,
      maxObservationsPerHand: boundedInteger(options.maxObservationsPerHand, DEFAULT_MAX_OBSERVATIONS, 20, 500),
      maxAttempts: boundedInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 10, 300),
      activeHands: {},
      finalizedRecords: records,
      finalizedHandIds: new Set(ids),
      finalizationAttempts: [],
      ignoredFinalizedObservationIds: new Set(),
      observationSequence: 0
    };
  }

  function ensureHand(state, handId, timestamp) {
    handId = String(handId);
    if (!state.activeHands[handId]) {
      state.activeHands[handId] = {
        handId: handId,
        authoritativeHandId: null,
        gameNumber: null,
        previousHandId: null,
        nextHandId: null,
        createdAt: Number(timestamp || Date.now()),
        updatedAt: Number(timestamp || Date.now()),
        historyComplete: true,
        recovered: false,
        observationLimitReached: false,
        observations: [],
        fallbackEvents: [],
        fallbackParticipants: []
      };
    }
    return state.activeHands[handId];
  }

  function syncFinalizedHandIds(state, handIds) {
    (handIds || []).forEach(function (handId) {
      if (handId !== null && handId !== undefined) state.finalizedHandIds.add(String(handId));
    });
    return state.finalizedHandIds.size;
  }

  function seedRecoveredHand(state, recoveredHand) {
    if (!recoveredHand || !recoveredHand.handId) return { seeded: false, reason: 'recovered hand has no identity' };
    var handId = String(recoveredHand.handId);
    if (state.finalizedHandIds.has(handId)) {
      recordAttempt(state, { type: 'recovery-seed', handId: handId, accepted: false, duplicate: true, previouslyFinalized: true, reason: 'recovered hand identity was already finalized' });
      return { seeded: false, duplicate: true, reason: 'hand identity was already finalized' };
    }
    var hand = ensureHand(state, handId, recoveredHand.updatedAt || recoveredHand.createdAt);
    hand.historyComplete = false;
    hand.recovered = true;
    hand.fallbackEvents = clone(recoveredHand.events || []);
    hand.fallbackParticipants = Object.keys(recoveredHand.participants || {}).map(function (name) { return clone(recoveredHand.participants[name]); });
    hand.updatedAt = Number(recoveredHand.updatedAt || Date.now());
    return { seeded: true, handId: handId };
  }

  function activeHandSnapshot(state, handId) {
    handId = handId === null || handId === undefined ? null : String(handId);
    var hand = handId && state.activeHands[handId];
    if (!hand) return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'semantic-active-hand-shadow',
      hand: clone(hand)
    };
  }

  function restoreActiveHandSnapshot(state, snapshot) {
    if (!snapshot || snapshot.schemaVersion !== SCHEMA_VERSION || snapshot.kind !== 'semantic-active-hand-shadow' || !isObject(snapshot.hand) || !snapshot.hand.handId) {
      recordAttempt(state, { type: 'snapshot-restore', accepted: false, duplicate: false, reason: 'semantic active-hand snapshot is malformed or unsupported' });
      return { restored: false, reason: 'semantic active-hand snapshot is malformed or unsupported' };
    }
    var hand = clone(snapshot.hand);
    var handId = String(hand.handId);
    if (state.finalizedHandIds.has(handId)) {
      recordAttempt(state, { type: 'snapshot-restore', handId: handId, accepted: false, duplicate: true, previouslyFinalized: true, reason: 'semantic active-hand snapshot was already finalized' });
      return { restored: false, duplicate: true, previouslyFinalized: true, handId: handId };
    }
    hand.observations = Array.isArray(hand.observations) ? hand.observations : [];
    hand.fallbackEvents = Array.isArray(hand.fallbackEvents) ? hand.fallbackEvents : [];
    hand.fallbackParticipants = Array.isArray(hand.fallbackParticipants) ? hand.fallbackParticipants : [];
    hand.historyComplete = hand.historyComplete === true;
    hand.recovered = hand.recovered === true;
    hand.observationLimitReached = hand.observationLimitReached === true;
    hand.exactRecoverySnapshotRestored = true;
    if (hand.observations.length > state.maxObservationsPerHand) {
      hand.observations = hand.observations.slice(-state.maxObservationsPerHand);
      hand.historyComplete = false;
      hand.observationLimitReached = true;
    }
    hand.observations.forEach(function (observation) {
      if (numeric(observation && observation.sequence)) state.observationSequence = Math.max(state.observationSequence, Number(observation.sequence));
    });
    state.activeHands[handId] = hand;
    recordAttempt(state, { type: 'snapshot-restore', handId: handId, accepted: true, duplicate: false, observationCount: hand.observations.length, historyComplete: hand.historyComplete });
    return { restored: true, handId: handId, observationCount: hand.observations.length, historyComplete: hand.historyComplete };
  }

  function observe(state, input) {
    input = input || {};
    if (!input.handId || !isObject(input.currentState)) return { observed: false, reason: 'hand identity and merged state are required' };
    var handId = String(input.handId);
    if (state.finalizedHandIds.has(handId)) {
      if (!state.ignoredFinalizedObservationIds.has(handId)) {
        state.ignoredFinalizedObservationIds.add(handId);
        recordAttempt(state, { type: 'observation', handId: handId, accepted: false, duplicate: true, previouslyFinalized: true, reason: 'replayed observation belongs to a finalized hand' });
      }
      return { observed: false, duplicate: true, previouslyFinalized: true };
    }
    var timestamp = Number(input.timestamp || Date.now());
    var hand = ensureHand(state, handId, timestamp);
    if (input.authoritativeHandId !== null && input.authoritativeHandId !== undefined && String(input.authoritativeHandId) !== CLEANUP_SENTINEL) hand.authoritativeHandId = String(input.authoritativeHandId);
    if (input.previousAuthoritativeHandId !== null && input.previousAuthoritativeHandId !== undefined && String(input.previousAuthoritativeHandId) !== String(hand.authoritativeHandId || '')) hand.previousHandId = String(input.previousAuthoritativeHandId);
    var priorHandId = input.previousHandId === null || input.previousHandId === undefined ? null : String(input.previousHandId);
    if (priorHandId && priorHandId !== handId) {
      hand.previousHandId = priorHandId;
      if (state.activeHands[priorHandId]) state.activeHands[priorHandId].nextHandId = handId;
    }
    var currentState = selectState(input.currentState);
    var previousState = input.sameHand === true || priorHandId === handId ? selectState(input.previousState) : null;
    state.observationSequence += 1;
    var sourceSequence = input.frameId === null || input.frameId === undefined ? state.observationSequence : input.frameId;
    hand.observations.push({
      sequence: state.observationSequence,
      sourceSequence: sourceSequence,
      timestamp: timestamp,
      eventName: input.eventName || null,
      previousState: previousState,
      currentState: currentState,
      patch: selectState(input.patch || {})
    });
    if (hand.observations.length > state.maxObservationsPerHand) {
      hand.observations.shift();
      hand.historyComplete = false;
      hand.observationLimitReached = true;
    }
    if (numeric(currentState.gN)) hand.gameNumber = currentState.gN;
    hand.updatedAt = timestamp;
    return { observed: true, handId: handId, observationCount: hand.observations.length };
  }

  function nonEmptyGameResult(value) {
    return isObject(value) && Object.keys(value).length > 0;
  }

  function terminalReadinessForHand(hand) {
    var observations = hand && Array.isArray(hand.observations) ? hand.observations : [];
    var latest = observations.length ? observations[observations.length - 1] : null;
    var terminalState = latest && latest.currentState || {};
    var settlementObservation = null;
    for (var index = observations.length - 1; index >= 0; index -= 1) {
      if (nonEmptyGameResult(observations[index] && observations[index].patch && observations[index].patch.gameResult)) {
        settlementObservation = observations[index];
        break;
      }
    }
    var terminalPhaseKnown = phaseToStreet(terminalState.gT) === 'terminal';
    var settlementRetained = nonEmptyGameResult(terminalState.gameResult);
    var settlementObserved = Boolean(settlementObservation);
    var revealPlayerIds = isObject(terminalState.pC) ? Object.keys(terminalState.pC).filter(function (playerId) {
      var cards = terminalState.pC[playerId] && terminalState.pC[playerId].cards;
      return Array.isArray(cards) && cards.some(function (card) { return card && card.showing !== false; });
    }).map(String) : [];
    var settlementPlayerIds = settlementRetained ? Object.keys(terminalState.gameResult).map(String) : [];
    var ready = terminalPhaseKnown && settlementObserved && settlementRetained;
    return {
      ready: ready,
      reason: ready
        ? 'terminal phase and retained settlement evidence are both available'
        : !settlementObserved
          ? 'no settlement patch has been observed for this hand'
          : !settlementRetained
            ? 'settlement evidence is not retained in the merged hand state'
            : 'settlement arrived before the merged hand reached terminal phase',
      terminalPhaseKnown: terminalPhaseKnown,
      settlementObserved: settlementObserved,
      settlementRetained: settlementRetained,
      settlementSourceSequence: settlementObservation ? settlementObservation.sourceSequence : null,
      latestSourceSequence: latest ? latest.sourceSequence : null,
      revealPlayerIds: revealPlayerIds,
      settlementPlayerIds: settlementPlayerIds
    };
  }

  function finalizationReadiness(state, handId) {
    if (!handId) return { ready: false, reason: 'hand identity is required' };
    handId = String(handId);
    if (state.finalizedHandIds.has(handId)) {
      return { ready: false, duplicate: true, previouslyFinalized: true, handId: handId, reason: 'hand identity was already finalized' };
    }
    var hand = state.activeHands[handId];
    if (!hand) return { ready: false, handId: handId, reason: 'no live semantic observations exist for this hand' };
    return Object.assign({ handId: handId, authoritativeHandId: hand.authoritativeHandId || null }, terminalReadinessForHand(hand));
  }

  function classifyRaise(actions, street) {
    var earlier = actions.filter(function (action) { return action.street === street && (action.type === 'raise' || action.type === 'bet'); });
    if (street !== 'preflop') return earlier.length === 0 ? 'street_opening_bet' : 'raise';
    if (earlier.length === 0) return 'open_raise';
    if (earlier.length === 1) {
      var coldCall = actions.some(function (action) { return action.street === 'preflop' && action.sequence > earlier[0].sequence && action.type === 'call'; });
      return coldCall ? 'squeeze' : 'three_bet';
    }
    return 'raise_after_three_bet';
  }

  function actionRecord(sequence, observation, values) {
    return Object.assign({
      sequence: sequence,
      sourceSequence: observation.sourceSequence,
      street: null,
      playerId: null,
      type: null,
      subtype: null,
      raiseContext: null,
      amountTo: null,
      amountBy: null,
      previousCommitment: null,
      resultingCommitment: null,
      currentHighestBet: null,
      minimumRaiseToBefore: null,
      minimumRaiseToAfter: null,
      raiseIncrease: null,
      previousFullRaiseSize: null,
      isAllIn: null,
      isFullRaise: null,
      isShortAllInRaise: null,
      reopeningStatus: null,
      reopeningEvidence: null,
      legalActionEvidence: null,
      confidence: 'proven',
      evidence: { sourceSequence: observation.sourceSequence, fields: [] }
    }, values || {});
  }

  function extractActions(observations, startState, fallbackEvents) {
    var actions = [];
    var actionSequence = 0;
    var street = phaseToStreet(startState && startState.gT) || 'preflop';
    var commitments = {};
    var lastFullRaiseSize = null;
    var folded = new Set();
    var observedKeys = new Set();
    var startObservation = observations[0] || { sourceSequence: null };

    [startState && startState.sBPI, startState && startState.bBPI].filter(Boolean).forEach(function (playerId) {
      var amount = startState.tB && startState.tB[playerId];
      if (!numeric(amount) || observedKeys.has('blind|' + playerId)) return;
      commitments[playerId] = amount;
      observedKeys.add('blind|' + playerId);
      actionSequence += 1;
      actions.push(actionRecord(actionSequence, startObservation, {
        street: 'preflop', playerId: playerId, type: 'post_blind',
        subtype: playerId === startState.sBPI ? 'small_blind' : 'big_blind',
        amountTo: amount, amountBy: amount, previousCommitment: 0, resultingCommitment: amount,
        currentHighestBet: Math.max.apply(null, Object.keys(commitments).map(function (id) { return commitments[id]; })),
        minimumRaiseToBefore: numeric(startState.mR) ? startState.mR : null,
        minimumRaiseToAfter: numeric(startState.mR) ? startState.mR : null,
        evidence: { sourceSequence: startObservation.sourceSequence, fields: ['tB'] }
      }));
    });
    var startingCommitments = Object.keys(commitments).map(function (id) { return commitments[id]; }).filter(numeric);
    var startingHigh = startingCommitments.length ? Math.max.apply(null, startingCommitments) : 0;
    if (numeric(startState && startState.mR) && startState.mR > startingHigh) lastFullRaiseSize = startState.mR - startingHigh;
    else if (numeric(startState && startState.bigBlind) && startState.bigBlind > 0) lastFullRaiseSize = startState.bigBlind;

    observations.slice(1).forEach(function (observation) {
      var before = observation.previousState || {};
      var after = observation.currentState || before;
      var patch = observation.patch || {};
      var nextStreet = phaseToStreet(after.gT);
      if (nextStreet && nextStreet !== street && nextStreet !== 'terminal') {
        street = nextStreet;
        commitments = {};
        lastFullRaiseSize = numeric(after.mR) && after.mR > 0
          ? after.mR
          : numeric(after.bigBlind) && after.bigBlind > 0 ? after.bigBlind : null;
      }
      if (isObject(patch.tB)) Object.keys(patch.tB).forEach(function (playerId) {
        var value = patch.tB[playerId];
        if (value === CLEANUP_SENTINEL) return;
        if (value === 'check') {
          var checkKey = [street, playerId, 'check'].join('|');
          if (observedKeys.has(checkKey)) return;
          observedKeys.add(checkKey);
          actionSequence += 1;
          actions.push(actionRecord(actionSequence, observation, {
            street: street, playerId: playerId, type: 'check',
            currentHighestBet: Math.max.apply(null, [0].concat(Object.keys(commitments).map(function (id) { return commitments[id]; }).filter(numeric))),
            minimumRaiseToBefore: numeric(before.mR) ? before.mR : null,
            minimumRaiseToAfter: numeric(after.mR) ? after.mR : null,
            evidence: { sourceSequence: observation.sourceSequence, fields: ['tB'] }
          }));
          return;
        }
        if (!numeric(value)) return;
        var priorCommitment = numeric(commitments[playerId]) ? commitments[playerId] : 0;
        var priorValues = Object.keys(commitments).map(function (id) { return commitments[id]; }).filter(numeric);
        var priorHigh = priorValues.length ? Math.max.apply(null, priorValues) : 0;
        if (value <= priorCommitment) { commitments[playerId] = value; return; }
        var type = value > priorHigh ? (street === 'preflop' ? 'raise' : priorHigh === 0 ? 'bet' : 'raise') : value === priorHigh ? 'call' : 'partial_call';
        var context = type === 'raise' || type === 'bet' ? classifyRaise(actions, street) : null;
        var minBefore = numeric(before.mR) ? before.mR : null;
        var minAfter = numeric(after.mR) ? after.mR : null;
        var derivedMinimumRaiseTo = type === 'raise' && numeric(lastFullRaiseSize) ? priorHigh + lastFullRaiseSize : null;
        var qualifyingMinimumRaiseTo = type === 'raise' && numeric(minBefore) ? minBefore : derivedMinimumRaiseTo;
        var isAllIn = after.pGS && after.pGS[playerId] === 'allIn' ? true : null;
        var isShort = type === 'raise' && isAllIn === true && numeric(qualifyingMinimumRaiseTo) && value < qualifyingMinimumRaiseTo ? true : null;
        var isFull = type === 'raise' && numeric(qualifyingMinimumRaiseTo) ? value >= qualifyingMinimumRaiseTo : null;
        var fields = ['tB'];
        if (patch.pGS && Object.prototype.hasOwnProperty.call(patch.pGS, playerId)) fields.push('pGS');
        if (Object.prototype.hasOwnProperty.call(patch, 'cHB')) fields.push('cHB');
        if (Object.prototype.hasOwnProperty.call(patch, 'mR')) fields.push('mR');
        commitments[playerId] = value;
        actionSequence += 1;
        actions.push(actionRecord(actionSequence, observation, {
          street: street, playerId: playerId, type: type, subtype: isShort ? 'short_all_in_raise' : context, raiseContext: context,
          amountTo: value, amountBy: value - priorCommitment, previousCommitment: priorCommitment, resultingCommitment: value,
          currentHighestBet: Math.max.apply(null, Object.keys(commitments).map(function (id) { return commitments[id]; }).filter(numeric)),
          minimumRaiseToBefore: minBefore, minimumRaiseToAfter: minAfter,
          raiseIncrease: type === 'raise' ? value - priorHigh : null,
          previousFullRaiseSize: type === 'raise' && numeric(lastFullRaiseSize) ? lastFullRaiseSize : null,
          isAllIn: isAllIn, isFullRaise: isFull, isShortAllInRaise: isShort,
          evidence: { sourceSequence: observation.sourceSequence, fields: fields }
        }));
        if (type === 'raise' && isFull === true) lastFullRaiseSize = value - priorHigh;
      });
      if (isObject(patch.pGS)) Object.keys(patch.pGS).forEach(function (playerId) {
        if (patch.pGS[playerId] !== 'fold' || folded.has(playerId)) return;
        folded.add(playerId);
        actionSequence += 1;
        actions.push(actionRecord(actionSequence, observation, {
          street: street, playerId: playerId, type: 'fold',
          previousCommitment: numeric(commitments[playerId]) ? commitments[playerId] : null,
          resultingCommitment: numeric(commitments[playerId]) ? commitments[playerId] : null,
          currentHighestBet: Math.max.apply(null, [0].concat(Object.keys(commitments).map(function (id) { return commitments[id]; }).filter(numeric))),
          minimumRaiseToBefore: numeric(before.mR) ? before.mR : null,
          minimumRaiseToAfter: numeric(after.mR) ? after.mR : null,
          evidence: { sourceSequence: observation.sourceSequence, fields: ['pGS'] }
        }));
      });
    });

    (fallbackEvents || []).forEach(function (event) {
      if (!event || !event.playerId || !event.action || event.action === 'dealt' || event.action === 'blind') return;
      var duplicate = actions.some(function (action) {
        var eventAmount = Number(event.amount || 0);
        var amountMatches = Number(action.amountTo || 0) === eventAmount ||
          Number(action.amountBy || 0) === eventAmount;
        return String(action.playerId) === String(event.playerId) &&
          action.street === event.street &&
          action.type === event.action &&
          amountMatches;
      });
      if (duplicate) return;
      actionSequence += 1;
      actions.push(actionRecord(actionSequence, { sourceSequence: null }, {
        street: event.street || null, playerId: String(event.playerId), type: event.action,
        amountTo: numeric(event.amount) ? event.amount : null,
        resultingCommitment: numeric(event.amount) ? event.amount : null,
        confidence: 'recovered_generic_event', evidence: { sourceSequence: null, fields: ['existing-active-hand-event'] }
      }));
    });
    actions.sort(function (left, right) {
      if (left.sourceSequence === null) return 1;
      if (right.sourceSequence === null) return -1;
      return Number(left.sourceSequence) - Number(right.sourceSequence);
    });
    actions.forEach(function (action, index) { action.sequence = index + 1; });
    return actions;
  }

  function buildPreflopRoles(actions, startState) {
    var voluntary = actions.filter(function (action) { return action.street === 'preflop' && action.type !== 'post_blind'; });
    var raises = voluntary.filter(function (action) { return action.type === 'raise'; });
    var opener = raises[0] || null;
    var secondRaise = raises[1] || null;
    var coldCallers = opener ? voluntary.filter(function (action) { return action.sequence > opener.sequence && (!secondRaise || action.sequence < secondRaise.sequence) && action.type === 'call'; }).map(function (action) { return action.playerId; }) : [];
    var shortSecondRaise = Boolean(secondRaise && secondRaise.isShortAllInRaise === true);
    var qualifyingFullRaises = raises.filter(function (action) { return action.isFullRaise === true; });
    return {
      dealer: startState.dealerID || null,
      smallBlind: startState.sBPI || null,
      bigBlind: startState.bBPI || null,
      openingAggressor: opener ? opener.playerId : null,
      threeBettor: secondRaise && !shortSecondRaise ? secondRaise.playerId : null,
      squeezer: secondRaise && !shortSecondRaise && secondRaise.raiseContext === 'squeeze' ? secondRaise.playerId : null,
      callers: Array.from(new Set(voluntary.filter(function (action) { return action.type === 'call'; }).map(function (action) { return action.playerId; }))),
      coldCallers: coldCallers,
      shortAllInRaiser: shortSecondRaise ? secondRaise.playerId : null,
      finalAggressor: qualifyingFullRaises.length ? qualifyingFullRaises[qualifyingFullRaises.length - 1].playerId : null,
      lastAggressiveActionPlayer: raises.length ? raises[raises.length - 1].playerId : null
    };
  }

  function buildStreets(observations, actions, startState, terminalKnown) {
    var starts = [];
    observations.forEach(function (observation, index) {
      var street = phaseToStreet(observation.currentState && observation.currentState.gT);
      var beforeStreet = phaseToStreet(observation.previousState && observation.previousState.gT);
      if (street && street !== 'terminal' && (index === 0 || street !== beforeStreet)) starts.push({ street: street, observation: observation });
    });
    var streetOrder = { preflop: 0, flop: 1, turn: 2, river: 3, terminal: 4 };
    var foldedOnStreet = {};
    actions.filter(function (action) { return action.type === 'fold'; }).forEach(function (action) {
      foldedOnStreet[action.playerId] = action.street;
    });
    var result = {};
    starts.forEach(function (start, index) {
      var streetActions = actions.filter(function (action) { return action.street === start.street && action.type !== 'post_blind'; });
      var firstBet = streetActions.find(function (action) { return action.type === 'bet' || action.type === 'raise'; }) || null;
      var state = start.observation.currentState || {};
      var entrants = (state.iHPI || Object.keys(startState.players || {})).filter(function (playerId) {
        var foldStreet = foldedOnStreet[playerId];
        return !foldStreet ||
          !Object.prototype.hasOwnProperty.call(streetOrder, foldStreet) ||
          streetOrder[foldStreet] >= streetOrder[start.street];
      });
      result[start.street] = {
        startedAtSequence: start.observation.sourceSequence,
        completedBySequence: starts[index + 1] ? starts[index + 1].observation.sourceSequence : terminalKnown ? observations[observations.length - 1].sourceSequence : null,
        board: clone(state.oTC && state.oTC['1'] || []),
        potAtStart: numeric(state.pot) ? state.pot : null,
        entrants: entrants,
        firstActor: currentActor(state),
        actionOrder: streetActions.map(function (action) { return action.playerId; }),
        firstBettor: firstBet ? firstBet.playerId : null,
        checksBeforeFirstBet: (firstBet ? streetActions.filter(function (action) { return action.sequence < firstBet.sequence && action.type === 'check'; }) : streetActions.filter(function (action) { return action.type === 'check'; })).map(function (action) { return action.playerId; })
      };
    });
    return result;
  }

  function revealedParticipants(state) {
    var cards = state && state.pC || {};
    return Object.keys(cards).filter(function (playerId) {
      var values = cards[playerId] && cards[playerId].cards;
      return Array.isArray(values) && values.length > 0 && values.every(function (card) { return card && card.showing === true && typeof card.value === 'string'; });
    });
  }

  function completeRiverCheckThroughParticipants(streets, actions, terminalState, terminalKnown, historyComplete) {
    var river = streets && streets.river;
    if (!terminalKnown || !historyComplete || !river || !Array.isArray(river.entrants)) return [];
    var entrants = Array.from(new Set(river.entrants.map(String)));
    if (entrants.length < 2) return [];
    var results = isObject(terminalState.gameResult) ? terminalState.gameResult : {};
    var settlementKnown = Object.keys(results).some(function (playerId) {
      return numeric(results[playerId] && results[playerId].gained) && Number(results[playerId].gained) > 0;
    });
    if (!settlementKnown) return [];
    var entrantSet = new Set(entrants);
    var riverActions = actions.filter(function (action) {
      return action.street === 'river';
    });
    if (!riverActions.length || riverActions.some(function (action) {
      return action.type !== 'check' || !entrantSet.has(String(action.playerId));
    })) return [];
    var checkers = new Set(riverActions.map(function (action) { return String(action.playerId); }));
    return entrants.every(function (playerId) { return checkers.has(playerId); }) ? entrants : [];
  }

  function terminalLiveShowdownEvidence(streets, actions, terminalState, terminalKnown, historyComplete, visibleParticipants) {
    var river = streets && streets.river;
    if (!terminalKnown || !historyComplete || !river || !Array.isArray(river.entrants)) return null;
    var folded = new Set(actions.filter(function (action) { return action.type === 'fold'; }).map(function (action) { return String(action.playerId); }));
    var live = Array.from(new Set(river.entrants.map(String))).filter(function (playerId) { return !folded.has(playerId); });
    if (live.length < 2) return null;
    var results = isObject(terminalState.gameResult) ? terminalState.gameResult : {};
    var awarded = Object.keys(results).filter(function (playerId) {
      return numeric(results[playerId] && results[playerId].gained) && Number(results[playerId].gained) > 0;
    }).map(String);
    if (!awarded.length || awarded.some(function (playerId) { return !live.includes(playerId); })) return null;

    var riverActions = actions.filter(function (action) { return action.street === 'river'; });
    var lastRiverAction = riverActions.length ? riverActions[riverActions.length - 1] : null;
    var checkThrough = completeRiverCheckThroughParticipants(streets, actions, terminalState, terminalKnown, historyComplete);
    var allInAction = actions.find(function (action) { return action.isAllIn === true; }) || null;
    var postflopActions = actions.filter(function (action) {
      return action.street === 'flop' || action.street === 'turn' || action.street === 'river';
    });
    var laterStreetActions = postflopActions.filter(function (action) { return action.street === 'turn' || action.street === 'river'; });
    var evidenceKind = visibleParticipants.some(function (playerId) { return live.includes(String(playerId)); })
      ? 'terminal-live-players-with-visible-comparison'
      : checkThrough.length === live.length
        ? 'complete-river-check-through-terminal-settlement'
        : lastRiverAction && (lastRiverAction.type === 'call' || lastRiverAction.type === 'partial_call')
          ? 'terminal-river-call-contested-settlement'
          : allInAction && laterStreetActions.length === 0
            ? 'terminal-all-in-automatic-runout'
            : null;
    if (!evidenceKind) return null;
    return {
      kind: evidenceKind,
      playerIds: live,
      visiblePlayerIds: visibleParticipants.slice(),
      lastRiverActionSequence: lastRiverAction ? lastRiverAction.sourceSequence : null,
      allInSequence: allInAction ? allInAction.sourceSequence : null,
      riverStartedAtSequence: river.startedAtSequence,
      riverCompletedBySequence: river.completedBySequence
    };
  }

  function buildShowdown(observations, terminalState, terminalKnown, startState, actions, streets, historyComplete) {
    var visibleParticipants = revealedParticipants(terminalState);
    var terminalLiveEvidence = terminalLiveShowdownEvidence(streets, actions, terminalState, terminalKnown, historyComplete, visibleParticipants);
    var terminalLiveParticipants = terminalLiveEvidence ? terminalLiveEvidence.playerIds : [];
    var participants = Array.from(new Set(visibleParticipants.concat(terminalLiveParticipants)));
    var terminalLiveAddsMembership = terminalLiveParticipants.some(function (playerId) { return !visibleParticipants.includes(playerId); });
    var reveal = visibleParticipants.length ? observations.find(function (observation) {
      var visible = revealedParticipants(observation.currentState || {});
      return visibleParticipants.every(function (playerId) { return visible.includes(playerId); });
    }) : null;
    var results = isObject(terminalState.gameResult) ? terminalState.gameResult : {};
    var awarded = Object.keys(results).filter(function (playerId) { return numeric(results[playerId] && results[playerId].gained) && results[playerId].gained > 0; });
    var startingPlayerIds = Object.keys(startState && startState.players || {});
    var foldedPlayerIds = new Set(actions.filter(function (action) { return action.type === 'fold'; }).map(function (action) { return action.playerId; }));
    var terminalFoldout = Boolean(
      terminalKnown &&
      historyComplete &&
      foldedPlayerIds.size > 0 &&
      startingPlayerIds.filter(function (playerId) { return !foldedPlayerIds.has(playerId); }).length <= 1
    );
    return {
      detected: participants.length ? true : terminalFoldout ? false : null,
      revealSequence: reveal ? reveal.sourceSequence : visibleParticipants.length ? observations[observations.length - 1].sourceSequence : null,
      participants: participants,
      winners: participants.filter(function (playerId) { return awarded.includes(playerId); }),
      losers: participants.filter(function (playerId) { return !awarded.includes(playerId); }),
      evidence: terminalLiveAddsMembership
        ? terminalLiveEvidence
        : visibleParticipants.length ? { kind: 'visible-hole-card-reveal', playerIds: visibleParticipants.slice() } : null
    };
  }

  function buildSettlement(startState, terminalObservation, actions, showdown, terminalKnown) {
    var terminalState = terminalObservation && terminalObservation.currentState || {};
    var results = isObject(terminalState.gameResult) ? terminalState.gameResult : {};
    var resultIds = Object.keys(results).filter(function (playerId) { return numeric(results[playerId] && results[playerId].gained); });
    if (!terminalKnown || !resultIds.length) return { status: 'unresolved', awards: [], totalsByPlayer: {}, totalAwardAmount: null, chopped: null, uncontested: null, sidePotStatus: null, finalStacks: {}, refunds: [], reconciliation: {} };
    var totals = {};
    resultIds.forEach(function (playerId) { totals[playerId] = Number(results[playerId].gained); });
    var awards = resultIds.filter(function (playerId) { return totals[playerId] > 0; }).map(function (playerId) { return { playerId: playerId, amount: totals[playerId], potId: null, boardIndex: null }; });
    var playerIds = Object.keys(startState.players || {});
    var finalStacks = {};
    playerIds.forEach(function (playerId) {
      var value = terminalState.players && terminalState.players[playerId] && terminalState.players[playerId].stack;
      finalStacks[playerId] = numeric(value) ? value : null;
    });
    var committed = {};
    actions.forEach(function (action) { if (numeric(action.amountBy)) committed[action.playerId] = Number(committed[action.playerId] || 0) + action.amountBy; });
    var refunds = [];
    var reconciliation = {};
    playerIds.forEach(function (playerId) {
      var starting = startState.players && startState.players[playerId] && startState.players[playerId].stack;
      var ending = finalStacks[playerId];
      var contribution = Number(committed[playerId] || 0);
      var award = Object.prototype.hasOwnProperty.call(totals, playerId) ? totals[playerId] : 0;
      if (!numeric(starting) || !numeric(ending)) {
        reconciliation[playerId] = { startingStack: numeric(starting) ? starting : null, committed: contribution, award: award, refund: null, endingStack: numeric(ending) ? ending : null, reconciled: null };
        return;
      }
      var withoutRefund = starting - contribution + award;
      var refund = ending - withoutRefund;
      if (Math.abs(refund) < 1e-9) refund = 0;
      if (refund > 0) refunds.push({ playerId: playerId, amount: refund, explicit: false, confidence: 'inferred_stack_reconciliation' });
      reconciliation[playerId] = { startingStack: starting, committed: contribution, award: award, refund: refund, endingStack: ending, reconciled: withoutRefund + refund === ending };
    });
    var winners = resultIds.filter(function (playerId) { return totals[playerId] > 0; });
    return {
      status: 'known', awards: awards, totalsByPlayer: totals,
      totalAwardAmount: awards.reduce(function (sum, award) { return sum + award.amount; }, 0),
      chopped: winners.length > 1,
      uncontested: showdown.detected === false && winners.length === 1 ? true : showdown.detected === true ? false : null,
      sidePotStatus: null,
      finalStacks: finalStacks,
      refunds: refunds,
      reconciliation: reconciliation
    };
  }

  function buildPlayers(startState, actions, streets, showdown, settlement, terminalKnown, historyComplete, fallbackParticipants) {
    var ids = new Set(Object.keys(startState.players || {}));
    (startState.iHPI || []).forEach(function (id) { ids.add(String(id)); });
    actions.forEach(function (action) { if (action.playerId) ids.add(String(action.playerId)); });
    (fallbackParticipants || []).forEach(function (participant) { if (participant.playerId) ids.add(String(participant.playerId)); });
    var folds = {};
    actions.filter(function (action) { return action.type === 'fold'; }).forEach(function (action) { folds[action.playerId] = action; });
    var allIn = new Set(actions.filter(function (action) { return action.isAllIn === true; }).map(function (action) { return action.playerId; }));
    return Array.from(ids).map(function (playerId) {
      var seatPair = (startState.seats || []).find(function (pair) { return Array.isArray(pair) && String(pair[1]) === playerId; });
      var starting = startState.players && startState.players[playerId] && startState.players[playerId].stack;
      var fold = folds[playerId] || null;
      return {
        playerId: playerId,
        seat: seatPair ? seatPair[0] : null,
        blindRole: playerId === String(startState.sBPI) ? 'small_blind' : playerId === String(startState.bBPI) ? 'big_blind' : null,
        startingStack: numeric(starting) ? starting : null,
        endingStack: Object.prototype.hasOwnProperty.call(settlement.finalStacks, playerId) ? settlement.finalStacks[playerId] : null,
        folded: fold ? true : terminalKnown && historyComplete ? false : null,
        allIn: allIn.has(playerId) ? true : null,
        sawFlop: streets.flop
          ? streets.flop.entrants.includes(playerId) ? true : historyComplete ? false : null
          : terminalKnown && historyComplete ? false : null,
        reachedShowdown: showdown.participants.includes(playerId) ? true : fold ? false : showdown.detected === false ? false : null,
        awardTotal: Object.prototype.hasOwnProperty.call(settlement.totalsByPlayer, playerId) ? settlement.totalsByPlayer[playerId] : settlement.status === 'known' ? 0 : null
      };
    });
  }

  function findLegalEvidence(observations) {
    var evidence = [];
    observations.forEach(function (observation) {
      LEGAL_ACTION_FIELDS.forEach(function (field) {
        if (observation.patch && Object.prototype.hasOwnProperty.call(observation.patch, field)) evidence.push({ sourceSequence: observation.sourceSequence, field: field, value: clone(observation.patch[field]) });
      });
    });
    return evidence;
  }

  function applyShortAllInEvidence(observations, actions) {
    var legalEvidence = findLegalEvidence(observations);
    var shortRaises = actions.filter(function (action) { return action.isShortAllInRaise === true; });
    shortRaises.forEach(function (action) {
      var index = observations.findIndex(function (observation) { return String(observation.sourceSequence) === String(action.sourceSequence); });
      var returned = observations.slice(index + 1).find(function (observation) {
        var patch = observation.patch || {};
        return (Object.prototype.hasOwnProperty.call(patch, 'pITT') && patch.pITT) || (Object.prototype.hasOwnProperty.call(patch, 'cPI') && patch.cPI);
      });
      action.reopeningStatus = null;
      action.legalActionEvidence = legalEvidence.length ? clone(legalEvidence) : null;
      action.reopeningEvidence = { actionReturned: Boolean(returned), actionReturnedTo: returned ? currentActor(returned.currentState) : null, actionReturnSequence: returned ? returned.sourceSequence : null, explicitLegalActionFieldObserved: legalEvidence.length > 0 };
      action.confidence = 'strongly_supported_short_all_in_raise_reopening_unknown';
    });
    return { shortRaises: shortRaises, legalEvidence: legalEvidence };
  }

  function buildAutomaticRunout(actions, streets, showdown, terminalKnown, historyComplete) {
    var allInAction = actions.find(function (action) { return action.isAllIn === true; }) || null;
    var postflop = actions.filter(function (action) { return action.street === 'flop' || action.street === 'turn' || action.street === 'river'; });
    var complete = Boolean(streets.flop && streets.turn && streets.river);
    var laterStreetActions = postflop.filter(function (action) { return action.street === 'turn' || action.street === 'river'; });
    var detected = Boolean(allInAction && complete && showdown.detected === true && laterStreetActions.length === 0);
    var absenceSupported = Boolean(terminalKnown && historyComplete);
    return {
      detected: detected ? true : absenceSupported ? false : null,
      allInSequence: allInAction ? allInAction.sourceSequence : null,
      revealSequence: showdown.revealSequence,
      streetTransitionSequences: ['flop', 'turn', 'river'].filter(function (street) { return streets[street]; }).map(function (street) { return streets[street].startedAtSequence; }),
      postflopActionCount: postflop.length,
      evidence: detected ? 'live all-in participants completed an action-free board runout to terminal contested settlement' : null
    };
  }

  function addAmbiguity(list, code, detail, evidence) {
    if (!list.some(function (entry) { return entry.code === code; })) list.push({ code: code, detail: detail, evidence: clone(evidence || null) });
  }

  function buildAmbiguities(hand, showdown, settlement, terminalObservation, shortEvidence) {
    var list = [];
    if (!hand.historyComplete || hand.recovered) addAmbiguity(list, AMBIGUITY_CODES.PARTIAL_HISTORY_AFTER_RECOVERY, 'Earlier live-hand history may be incomplete after recovery or bounded retention.', { recovered: hand.recovered });
    if (hand.observationLimitReached) addAmbiguity(list, AMBIGUITY_CODES.OBSERVATION_LIMIT_REACHED, 'The bounded active-hand observation limit was reached.', { retained: hand.observations.length });
    if (settlement.status !== 'known') addAmbiguity(list, AMBIGUITY_CODES.SETTLEMENT_UNRESOLVED, 'The accepted hand boundary lacked a complete supported settlement payload.', null);
    if (shortEvidence.shortRaises.length) addAmbiguity(list, AMBIGUITY_CODES.ALL_IN_REOPENING_UNSUPPORTED, 'A short all-in is supported, but legal reopening remains unknown.', { sourceSequences: shortEvidence.shortRaises.map(function (action) { return action.sourceSequence; }), legalActionEvidenceObserved: shortEvidence.legalEvidence.length > 0 });
    if (showdown.detected === true) {
      if (showdown.evidence && showdown.evidence.kind === 'complete-river-check-through-terminal-settlement') {
        addAmbiguity(list, AMBIGUITY_CODES.SHOWDOWN_INFERRED_FROM_COMPLETE_RIVER, 'Showdown membership is bounded to a complete river check-through by every live entrant plus retained terminal settlement.', { playerIds: showdown.participants, riverCompletedBySequence: showdown.evidence.riverCompletedBySequence });
      } else if (showdown.evidence && /^terminal-/.test(showdown.evidence.kind)) {
        addAmbiguity(list, AMBIGUITY_CODES.SHOWDOWN_INFERRED_FROM_TERMINAL_LIVE_PLAYERS, 'Showdown membership is bounded to terminal live players corroborated by a river call, visible comparison, or automatic all-in runout plus contested settlement.', { playerIds: showdown.participants, evidenceKind: showdown.evidence.kind, riverCompletedBySequence: showdown.evidence.riverCompletedBySequence });
      } else {
        addAmbiguity(list, AMBIGUITY_CODES.SHOWDOWN_INFERRED_FROM_REVEAL, 'Showdown membership is bounded to the visible reveal sequence.', { sourceSequence: showdown.revealSequence });
      }
      addAmbiguity(list, AMBIGUITY_CODES.SIDE_POT_UNSUPPORTED, 'Awards are preserved without inventing unsupported side-pot ownership.', null);
    }
    var terminalPatch = terminalObservation && terminalObservation.patch || {};
    if (settlement.status === 'known') {
      var retained = Object.keys(settlement.finalStacks).filter(function (playerId) { return !terminalPatch.players || !terminalPatch.players[playerId] || !Object.prototype.hasOwnProperty.call(terminalPatch.players[playerId], 'stack'); });
      if (retained.length) addAmbiguity(list, AMBIGUITY_CODES.SPARSE_TERMINAL_STACK_RETAINED, 'Final stacks for some players came from merged sparse state.', { playerIds: retained });
    }
    if (settlement.refunds.length) addAmbiguity(list, AMBIGUITY_CODES.REFUND_IMPLICIT, 'Returned chips are inferred only from exact stack reconciliation.', { playerIds: settlement.refunds.map(function (refund) { return refund.playerId; }) });
    return list;
  }

  function buildRecord(hand, details) {
    var observations = hand.observations.slice();
    var startObservation = observations[0] || null;
    var terminalObservation = observations[observations.length - 1] || null;
    var startState = startObservation && startObservation.currentState || {};
    var terminalState = terminalObservation && terminalObservation.currentState || startState;
    // PokerNow may split gameResult, terminal phase, and card-reveal evidence
    // across sparse patches. The hand is terminal when settlement was observed
    // for this exact active hand and remains present after the sparse merge; it
    // does not need to be repeated in the final terminal-phase patch.
    var terminalKnown = terminalReadinessForHand(hand).ready;
    var actions = extractActions(observations, startState, hand.fallbackEvents);
    var shortEvidence = applyShortAllInEvidence(observations, actions);
    var roles = buildPreflopRoles(actions, startState);
    var streets = buildStreets(observations, actions, startState, terminalKnown);
    var showdown = buildShowdown(observations, terminalState, terminalKnown, startState, actions, streets, hand.historyComplete);
    var settlement = buildSettlement(startState, terminalObservation, actions, showdown, terminalKnown);
    var positionProvenance = root.PokerPositionResolver && root.PokerPositionResolver.resolve({
      dealtPlayerIds: startState.iHPI || [],
      seats: startState.seats || [],
      buttonPlayerId: startState.dealerID,
      smallBlindPlayerId: startState.sBPI,
      bigBlindPlayerId: startState.bBPI,
      deadButton: startState.deadButton === true
    });
    if (!hand.historyComplete || hand.recovered) positionProvenance = {
      schemaVersion: 1, status: 'unsupported', reason: 'complete hand-start dealt provenance is unavailable',
      dealtPlayerCount: null, assignments: {}, evidence: {}
    };
    var fields = new Set();
    observations.forEach(function (observation) { Object.keys(observation.patch || {}).forEach(function (field) { fields.add(field); }); });
    return {
      schemaVersion: SCHEMA_VERSION,
      mode: 'production_shadow',
      status: 'finalized',
      handIdentity: { handId: hand.authoritativeHandId || hand.handId, lifecycleHandId: hand.handId, gameNumber: numeric(hand.gameNumber) ? hand.gameNumber : numeric(startState.gN) ? startState.gN : null, previousHandId: hand.previousHandId, nextHandId: details.nextAuthoritativeHandId || hand.nextHandId },
      players: buildPlayers(startState, actions, streets, showdown, settlement, terminalKnown, hand.historyComplete, hand.fallbackParticipants),
      actions: actions,
      streets: streets,
      preflopRoles: roles,
      positionProvenance: positionProvenance || { schemaVersion: 1, status: 'unsupported', reason: 'position resolver unavailable', dealtPlayerCount: null, assignments: {}, evidence: {} },
      automaticRunout: buildAutomaticRunout(actions, streets, showdown, terminalKnown, hand.historyComplete),
      showdown: showdown,
      settlement: settlement,
      ambiguities: buildAmbiguities(hand, showdown, settlement, terminalObservation, shortEvidence),
      provenance: {
        source: 'live-websocket-merged-state',
        finalizationReason: details.reason || 'accepted production hand commit',
        finalizedAt: Number(details.timestamp || Date.now()),
        firstSourceSequence: startObservation ? startObservation.sourceSequence : null,
        lastSourceSequence: terminalObservation ? terminalObservation.sourceSequence : null,
        observationCount: observations.length,
        historyComplete: hand.historyComplete,
        recovered: hand.recovered,
        terminalEvidence: terminalKnown,
        eventNames: Array.from(new Set(observations.map(function (observation) { return observation.eventName; }).filter(Boolean))),
        evidenceFields: Array.from(fields).sort()
      }
    };
  }

  function finalize(state, handId, details) {
    details = details || {};
    if (!handId) return { finalized: false, reason: 'hand identity is required' };
    handId = String(handId);
    if (state.finalizedHandIds.has(handId)) {
      delete state.activeHands[handId];
      recordAttempt(state, { type: 'finalize', handId: handId, accepted: false, duplicate: true, previouslyFinalized: true, reason: details.reason || 'duplicate accepted production commit' });
      return { finalized: false, duplicate: true, previouslyFinalized: true, handId: handId };
    }
    var hand = state.activeHands[handId];
    if (!hand) {
      recordAttempt(state, { type: 'finalize', handId: handId, accepted: false, duplicate: false, reason: 'no live semantic observations exist for this hand' });
      return { finalized: false, duplicate: false, reason: 'no live semantic observations exist for this hand' };
    }
    if (details.fallbackHand) {
      hand.fallbackEvents = clone(details.fallbackHand.events || hand.fallbackEvents);
      hand.fallbackParticipants = Object.keys(details.fallbackHand.participants || {}).map(function (name) { return clone(details.fallbackHand.participants[name]); });
      if (details.fallbackHand.recovered && hand.exactRecoverySnapshotRestored !== true) {
        hand.recovered = true;
        hand.historyComplete = false;
      }
    }
    var record = buildRecord(hand, details);
    state.finalizedHandIds.add(handId);
    delete state.activeHands[handId];
    pushBounded(state.finalizedRecords, record, state.maxRecords);
    recordAttempt(state, { type: 'finalize', handId: handId, accepted: true, duplicate: false, reason: details.reason || 'accepted production commit', terminalEvidence: record.provenance.terminalEvidence, ambiguityCodes: record.ambiguities.map(function (ambiguity) { return ambiguity.code; }) });
    return { finalized: true, duplicate: false, handId: handId, record: clone(record) };
  }

  function discard(state, handId, details) {
    details = details || {};
    if (!handId) return { discarded: false, reason: 'hand identity is required' };
    handId = String(handId);
    var existed = Boolean(state.activeHands[handId]);
    delete state.activeHands[handId];
    recordAttempt(state, {
      type: 'discard',
      handId: handId,
      accepted: existed,
      duplicate: state.finalizedHandIds.has(handId),
      previouslyFinalized: state.finalizedHandIds.has(handId),
      reason: details.reason || 'production lifecycle discarded an unowned or incomplete hand'
    });
    return { discarded: existed, handId: handId, previouslyFinalized: state.finalizedHandIds.has(handId) };
  }

  function inspect(state) {
    return {
      schemaVersion: SCHEMA_VERSION,
      mode: 'production_shadow',
      bounds: { maxFinalizedRecords: state.maxRecords, maxObservationsPerHand: state.maxObservationsPerHand, maxFinalizationAttempts: state.maxAttempts },
      activeHands: Object.keys(state.activeHands).map(function (handId) {
        var hand = state.activeHands[handId];
        return { handId: hand.authoritativeHandId || hand.handId, lifecycleHandId: hand.handId, gameNumber: hand.gameNumber, observationCount: hand.observations.length, historyComplete: hand.historyComplete, recovered: hand.recovered, previouslyFinalized: state.finalizedHandIds.has(handId) };
      }),
      finalizedHandIds: Array.from(state.finalizedHandIds),
      finalizedRecords: clone(state.finalizedRecords),
      finalizationAttempts: clone(state.finalizationAttempts)
    };
  }

  function liveBettingState(state, handId) {
    handId = handId === null || handId === undefined ? null : String(handId);
    var hand = handId && state.activeHands[handId];
    if (!hand || !hand.observations.length) return null;
    var observations = hand.observations.slice();
    var first = observations[0];
    var latest = observations[observations.length - 1];
    var startState = first.currentState || {};
    var currentState = latest.currentState || {};
    var actions = extractActions(observations, startState, hand.fallbackEvents);
    var totalContributions = {};
    actions.forEach(function (action) {
      if (action.playerId && numeric(action.amountBy) && action.amountBy >= 0) totalContributions[action.playerId] = Number(totalContributions[action.playerId] || 0) + action.amountBy;
    });
    var street = phaseToStreet(currentState.gT) || actions.length && actions[actions.length - 1].street || 'preflop';
    var tB = isObject(currentState.tB) ? currentState.tB : {};
    var streetCommitments = {};
    actions.filter(function (action) { return action.street === street && action.playerId && numeric(action.resultingCommitment); }).forEach(function (action) { streetCommitments[action.playerId] = action.resultingCommitment; });
    Object.keys(tB).forEach(function (playerId) { if (!Object.prototype.hasOwnProperty.call(streetCommitments, playerId) && numeric(tB[playerId])) streetCommitments[playerId] = tB[playerId]; });
    var playerIds = Array.from(new Set(Object.keys(currentState.players || {}).concat(Object.keys(tB), Object.keys(streetCommitments), Object.keys(totalContributions), currentState.iHPI || [])));
    return clone({
      handId: hand.authoritativeHandId || hand.handId,
      lifecycleHandId: hand.handId,
      street: street,
      actingPlayerId: currentActor(currentState),
      currentPot: numeric(currentState.pot) ? currentState.pot : null,
      players: playerIds.map(function (playerId) {
        var player = currentState.players && currentState.players[playerId] || {};
        var status = currentState.pGS && currentState.pGS[playerId];
        return {
          playerId: String(playerId),
          streetContribution: numeric(streetCommitments[playerId]) ? streetCommitments[playerId] : 0,
          totalContribution: hand.historyComplete && numeric(totalContributions[playerId]) ? totalContributions[playerId] : null,
          stack: numeric(player.stack) ? player.stack : null,
          folded: status === 'fold',
          allIn: status === 'allIn',
          active: status !== 'fold' && status !== 'out',
          inHand: !Array.isArray(currentState.iHPI) || currentState.iHPI.map(String).includes(String(playerId))
        };
      }),
      evidence: { source: 'semantic-hand-ledger live merged observations', observationCount: observations.length, latestSourceSequence: latest.sourceSequence, actionCount: actions.length, fields: ['tB', 'pITT/cPI', 'pGS', 'players.stack'] }
    });
  }

  var api = Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    AMBIGUITY_CODES: AMBIGUITY_CODES,
    createState: createState,
    syncFinalizedHandIds: syncFinalizedHandIds,
    seedRecoveredHand: seedRecoveredHand,
    activeHandSnapshot: activeHandSnapshot,
    restoreActiveHandSnapshot: restoreActiveHandSnapshot,
    observe: observe,
    finalizationReadiness: finalizationReadiness,
    finalize: finalize,
    discard: discard,
    liveBettingState: liveBettingState,
    inspect: inspect
  });
  root.PokerSemanticHandLedger = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
