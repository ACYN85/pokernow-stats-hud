/* Pure, bounded shadow reducer for 3Bet and Fold-to-3Bet contributions. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && !isSupportedRuntimePage(root.PokerNowRuntimeScope, window.location)) return;

  var SCHEMA_VERSION = 2;
  var MODE = 'production_shadow';
  var DEFAULT_MAX_RECORDS = 50;
  var DEFAULT_MAX_ATTEMPTS = 100;
  var DEFAULT_MAX_PLAYERS = 200;
  var AMBIGUITY_CODES = Object.freeze({
    HISTORY_INCOMPLETE: 'HISTORY_INCOMPLETE',
    MALFORMED_PREFLOP_SEQUENCE: 'MALFORMED_PREFLOP_SEQUENCE',
    OPEN_RAISE_UNSUPPORTED: 'OPEN_RAISE_UNSUPPORTED',
    OPENING_ROLE_MISMATCH: 'OPENING_ROLE_MISMATCH',
    THREE_BET_CANDIDATE_UNSUPPORTED: 'THREE_BET_CANDIDATE_UNSUPPORTED',
    SHORT_ALL_IN_REOPENING_UNKNOWN: 'SHORT_ALL_IN_REOPENING_UNKNOWN',
    LEGAL_CAPACITY_UNKNOWN: 'LEGAL_CAPACITY_UNKNOWN',
    OPENER_RESPONSE_UNKNOWN: 'OPENER_RESPONSE_UNKNOWN',
    PLAYER_TOTAL_LIMIT_REACHED: 'PLAYER_TOTAL_LIMIT_REACHED',
    SOURCE_SCHEMA_UNSUPPORTED: 'SOURCE_SCHEMA_UNSUPPORTED'
  });
  var VALID_ACTION_TYPES = new Set(['post_blind', 'fold', 'check', 'call', 'partial_call', 'raise']);

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

  function pushBounded(array, value, limit) {
    array.push(value);
    while (array.length > limit) array.shift();
  }

  function uniqueStrings(values) {
    return Array.from(new Set((values || []).filter(function (value) {
      return value !== null && value !== undefined && String(value) !== '';
    }).map(String)));
  }

  function handAliases(record) {
    var identity = record && record.handIdentity || {};
    return uniqueStrings([identity.lifecycleHandId, identity.handId]);
  }

  function addAmbiguity(list, code, detail, evidence) {
    if (!list.some(function (entry) { return entry.code === code; })) {
      list.push({ code: code, detail: detail, evidence: clone(evidence || null) });
    }
  }

  function actionEvidence(action) {
    if (!action) return [];
    return [{
      sequence: action.sequence,
      sourceSequence: action.sourceSequence,
      playerId: action.playerId,
      type: action.type,
      amountTo: numeric(action.amountTo) ? action.amountTo : null,
      minimumRaiseToBefore: numeric(action.minimumRaiseToBefore) ? action.minimumRaiseToBefore : null,
      isAllIn: action.isAllIn === true ? true : action.isAllIn === false ? false : null,
      isFullRaise: action.isFullRaise === true ? true : action.isFullRaise === false ? false : null,
      isShortAllInRaise: action.isShortAllInRaise === true ? true : action.isShortAllInRaise === false ? false : null
    }];
  }

  function emptyPlayerContribution(playerId, unknown, reason) {
    return {
      playerId: String(playerId),
      threeBet: {
        opportunity: unknown ? null : false,
        made: unknown ? null : false,
        opportunityCount: 0,
        madeCount: 0,
        isSqueeze: null,
        reason: reason,
        evidence: []
      },
      foldToThreeBet: {
        opportunity: unknown ? null : false,
        folded: unknown ? null : false,
        opportunityCount: 0,
        foldCount: 0,
        response: unknown ? 'unknown' : null,
        responseSubtype: null,
        reason: reason,
        evidence: []
      }
    };
  }

  function setThreeBet(player, opportunity, made, isSqueeze, reason, evidence) {
    player.threeBet = {
      opportunity: opportunity,
      made: made,
      opportunityCount: opportunity === true ? 1 : 0,
      madeCount: opportunity === true && made === true ? 1 : 0,
      isSqueeze: made === true ? Boolean(isSqueeze) : null,
      reason: reason,
      evidence: clone(evidence || [])
    };
  }

  function setFoldToThreeBet(player, opportunity, folded, response, responseSubtype, reason, evidence) {
    player.foldToThreeBet = {
      opportunity: opportunity,
      folded: folded,
      opportunityCount: opportunity === true ? 1 : 0,
      foldCount: opportunity === true && folded === true ? 1 : 0,
      response: response,
      responseSubtype: responseSubtype || null,
      reason: reason,
      evidence: clone(evidence || [])
    };
  }

  function playerIdsForRecord(record) {
    var ids = [];
    (record.players || []).forEach(function (player) {
      if (player && player.playerId !== null && player.playerId !== undefined) ids.push(String(player.playerId));
    });
    (record.actions || []).forEach(function (action) {
      if (action && action.playerId !== null && action.playerId !== undefined) ids.push(String(action.playerId));
    });
    return uniqueStrings(ids);
  }

  function playersById(record) {
    var map = {};
    (record.players || []).forEach(function (player) {
      if (player && player.playerId !== null && player.playerId !== undefined) map[String(player.playerId)] = player;
    });
    return map;
  }

  function contributionShell(record, unknown, reason) {
    var identity = record && record.handIdentity || {};
    var players = {};
    playerIdsForRecord(record || {}).forEach(function (playerId) {
      players[playerId] = emptyPlayerContribution(playerId, unknown, reason);
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      reducerVersion: SCHEMA_VERSION,
      mode: MODE,
      handIdentity: {
        handId: identity.handId === null || identity.handId === undefined ? null : String(identity.handId),
        lifecycleHandId: identity.lifecycleHandId === null || identity.lifecycleHandId === undefined ? null : String(identity.lifecycleHandId)
      },
      sourceLedgerSchemaVersion: record && record.schemaVersion || null,
      hand: {
        openRaiser: null,
        threeBettor: null,
        validThreeBetSequence: unknown ? null : false,
        isSqueeze: null,
        interveningCallers: []
      },
      players: players,
      ambiguities: [],
      provenance: {
        source: 'finalized-semantic-hand-record',
        sourceFinalizationReason: record && record.provenance && record.provenance.finalizationReason || null,
        sourceHistoryComplete: record && record.provenance ? record.provenance.historyComplete : null,
        sourceRecovered: record && record.provenance ? record.provenance.recovered : null,
        sourceAmbiguityCodes: (record && record.ambiguities || []).map(function (entry) { return entry && entry.code; }).filter(Boolean),
        reducedAt: null
      }
    };
  }

  function setAllUnknown(contribution, code, detail, evidence) {
    Object.keys(contribution.players).forEach(function (playerId) {
      contribution.players[playerId] = emptyPlayerContribution(playerId, true, code);
    });
    contribution.hand.validThreeBetSequence = null;
    addAmbiguity(contribution.ambiguities, code, detail, evidence);
    return contribution;
  }

  function preflopSequence(record) {
    var actions = Array.isArray(record.actions) ? record.actions : [];
    var priorSequence = -Infinity;
    var malformed = false;
    actions.forEach(function (action) {
      if (!action || !numeric(action.sequence) || action.sequence <= priorSequence) malformed = true;
      else priorSequence = action.sequence;
    });
    var preflop = actions.filter(function (action) { return action && action.street === 'preflop'; });
    if (preflop.some(function (action) {
      return !action.playerId || !VALID_ACTION_TYPES.has(action.type) || action.confidence === 'recovered_generic_event';
    })) malformed = true;
    return { actions: preflop, malformed: malformed };
  }

  function legalCapacity(player, action) {
    if (action && action.isFullRaise === true) return true;
    if (action && (action.type === 'partial_call' || action.isAllIn === true)) return false;
    if (!player || !numeric(player.startingStack) || !action || !numeric(action.minimumRaiseToBefore)) return null;
    return player.startingStack >= action.minimumRaiseToBefore;
  }

  function actionBefore(actions, boundaryIndex, playerId) {
    for (var index = 0; index < boundaryIndex; index += 1) {
      if (String(actions[index].playerId) === String(playerId) && actions[index].type !== 'post_blind') return actions[index];
    }
    return null;
  }

  function firstActionFor(actions, startIndex, endIndex, playerId) {
    for (var index = startIndex; index < endIndex; index += 1) {
      if (String(actions[index].playerId) === String(playerId)) return actions[index];
    }
    return null;
  }

  function classifyThreeBetDecision(contribution, playerId, player, action, isBoundaryRaise, interveningCallers) {
    var target = contribution.players[playerId];
    if (!action) {
      setThreeBet(target, false, false, null, 'action_not_reached_before_three_bet_or_boundary', []);
      return;
    }
    if (action.type === 'raise') {
      if (isBoundaryRaise && action.isFullRaise === true) {
        setThreeBet(target, true, true, interveningCallers.length > 0, interveningCallers.length ? 'qualifying_squeeze' : 'qualifying_three_bet', actionEvidence(action));
      } else if (action.isShortAllInRaise === true || action.isFullRaise === false) {
        setThreeBet(target, null, null, null, 'short_non_full_raise_opportunity_void', actionEvidence(action));
      } else {
        setThreeBet(target, null, null, null, 'raise_fullness_unknown', actionEvidence(action));
      }
      return;
    }
    if (action.type !== 'call' && action.type !== 'partial_call' && action.type !== 'fold') {
      setThreeBet(target, null, null, null, 'unsupported_preflop_decision', actionEvidence(action));
      return;
    }
    var capacity = legalCapacity(player, action);
    if (capacity === true) {
      setThreeBet(target, true, false, null, action.type === 'fold' ? 'folded_facing_open' : 'continued_without_three_bet', actionEvidence(action));
    } else if (capacity === false) {
      setThreeBet(target, false, false, null, 'insufficient_capacity_for_full_reraise', actionEvidence(action));
    } else {
      setThreeBet(target, null, null, null, 'legal_full_reraise_capacity_unknown', actionEvidence(action));
      addAmbiguity(contribution.ambiguities, AMBIGUITY_CODES.LEGAL_CAPACITY_UNKNOWN, 'A response to the opening raise lacked enough stack/threshold evidence to prove a full re-raise was legal.', actionEvidence(action));
    }
  }

  function foldToThreeBetEligibility(actions, threeBetIndex, playerId, threeBettorId) {
    if (String(playerId) === String(threeBettorId)) return { eligible: false, reason: 'qualifying_three_bettor_not_eligible', evidence: [] };
    var priorActions = actions.slice(0, threeBetIndex).filter(function (action) {
      return String(action.playerId) === String(playerId) && action.type !== 'post_blind';
    });
    var voluntary = priorActions.some(function (action) {
      return action.type === 'call' || action.type === 'partial_call' || action.type === 'raise';
    });
    if (!voluntary) return { eligible: false, reason: 'not_voluntarily_entered_before_three_bet', evidence: [] };
    var folded = priorActions.find(function (action) { return action.type === 'fold'; });
    if (folded) return { eligible: false, reason: 'folded_before_qualifying_three_bet', evidence: actionEvidence(folded) };
    var allIn = priorActions.find(function (action) { return action.isAllIn === true || action.type === 'partial_call'; });
    if (allIn) return { eligible: false, reason: 'already_all_in_before_qualifying_three_bet', evidence: actionEvidence(allIn) };
    return { eligible: true, reason: 'entered_and_live_when_three_bet_occurred', evidence: [] };
  }

  function classifyFoldToThreeBetResponse(contribution, playerId, openerId, actions, threeBetIndex, responseAction) {
    var target = contribution.players[playerId];
    var isOpener = String(playerId) === String(openerId);
    if (!responseAction) {
      setFoldToThreeBet(target, null, null, 'unknown', null, isOpener ? 'opener_response_not_observed' : 'participant_response_not_observed', []);
      addAmbiguity(contribution.ambiguities, AMBIGUITY_CODES.OPENER_RESPONSE_UNKNOWN, 'A qualifying full 3Bet was observed, but a supported response was not present before finalization.', null);
      return;
    }
    var responseIndex = actions.indexOf(responseAction);
    var interveningRaise = actions.slice(threeBetIndex + 1, responseIndex).find(function (action) {
      return action.type === 'raise';
    });
    if (interveningRaise) {
      if (interveningRaise.isFullRaise === true) {
        setFoldToThreeBet(target, false, false, null, null, 'action_did_not_return_before_four_bet', actionEvidence(interveningRaise));
      } else {
        setFoldToThreeBet(target, null, null, 'unknown', null, 'intervening_raise_legality_unknown', actionEvidence(interveningRaise));
        addAmbiguity(contribution.ambiguities, AMBIGUITY_CODES.OPENER_RESPONSE_UNKNOWN, 'An unsupported intervening raise changed the price before this player responded to the 3Bet.', actionEvidence(interveningRaise));
      }
      return;
    }
    if (responseAction.type === 'fold') {
      setFoldToThreeBet(target, true, true, 'fold', null, isOpener ? 'opener_folded_facing_three_bet' : 'participant_folded_facing_three_bet', actionEvidence(responseAction));
      return;
    }
    if (responseAction.type === 'call' || responseAction.type === 'partial_call') {
      var callAllIn = responseAction.isAllIn === true || responseAction.type === 'partial_call';
      var callReason = callAllIn
        ? isOpener ? 'opener_all_in_call_facing_three_bet' : 'participant_all_in_call_facing_three_bet'
        : isOpener ? 'opener_called_three_bet' : 'participant_called_three_bet';
      setFoldToThreeBet(target, true, false, callAllIn ? 'all-in' : 'call', callAllIn ? 'short_call' : null, callReason, actionEvidence(responseAction));
      return;
    }
    if (responseAction.type === 'raise') {
      var raiseAllIn = responseAction.isAllIn === true;
      var subtype = raiseAllIn ? responseAction.isFullRaise === true ? 'full_raise' : responseAction.isFullRaise === false ? 'short_raise' : 'raise_status_unknown' : null;
      var raiseReason = raiseAllIn
        ? isOpener ? 'opener_all_in_raise_facing_three_bet' : 'participant_all_in_raise_facing_three_bet'
        : isOpener ? 'opener_four_bet' : 'participant_raised_facing_three_bet';
      setFoldToThreeBet(target, true, false, raiseAllIn ? 'all-in' : 'raise', subtype, raiseReason, actionEvidence(responseAction));
      return;
    }
    setFoldToThreeBet(target, null, null, 'unknown', null, isOpener ? 'unsupported_opener_response' : 'unsupported_participant_response', actionEvidence(responseAction));
    addAmbiguity(contribution.ambiguities, AMBIGUITY_CODES.OPENER_RESPONSE_UNKNOWN, 'The response type was not supported by the reducer contract.', actionEvidence(responseAction));
  }

  function deriveContribution(record) {
    var contribution = contributionShell(record || {}, false, 'no_qualifying_sequence');
    if (!isObject(record) || record.status !== 'finalized' || !handAliases(record).length || !Array.isArray(record.actions) || !Array.isArray(record.players)) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.MALFORMED_PREFLOP_SEQUENCE, 'A finalized semantic record with identity, players, and actions is required.', null);
    }

    if (record.schemaVersion !== 1) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.SOURCE_SCHEMA_UNSUPPORTED, 'The finalized semantic record schema version is not supported by this reducer version.', { sourceLedgerSchemaVersion: record.schemaVersion });
    }

    var incomplete = !record.provenance || record.provenance.historyComplete !== true || record.provenance.recovered === true ||
      (record.ambiguities || []).some(function (entry) {
        return entry && (entry.code === 'PARTIAL_HISTORY_AFTER_RECOVERY' || entry.code === 'OBSERVATION_LIMIT_REACHED');
      });
    if (incomplete) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.HISTORY_INCOMPLETE, 'The finalized semantic record does not prove a complete ordered preflop history.', {
        historyComplete: record.provenance && record.provenance.historyComplete,
        recovered: record.provenance && record.provenance.recovered
      });
    }

    var sequence = preflopSequence(record);
    if (sequence.malformed) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.MALFORMED_PREFLOP_SEQUENCE, 'The preflop action sequence is unordered, recovered, or contains an unsupported action.', null);
    }
    var actions = sequence.actions;
    var playerMap = playersById(record);
    var raiseIndexes = [];
    actions.forEach(function (action, index) {
      if (action.type === 'raise') raiseIndexes.push(index);
    });
    if (!raiseIndexes.length) return contribution;

    var openingMarkers = actions.filter(function (action) { return action.raiseContext === 'open_raise'; });
    if (openingMarkers.length > 1) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.MALFORMED_PREFLOP_SEQUENCE, 'Multiple semantic opening-raise markers were present.', actionEvidence(openingMarkers[1]));
    }

    var openIndex = raiseIndexes[0];
    var openAction = actions[openIndex];
    var openerId = String(openAction.playerId);
    contribution.hand.openRaiser = openerId;
    if (record.preflopRoles && record.preflopRoles.openingAggressor && String(record.preflopRoles.openingAggressor) !== openerId) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.OPENING_ROLE_MISMATCH, 'The strict first-raise identity disagreed with the ledger role summary.', actionEvidence(openAction));
    }
    if (openAction.isFullRaise !== true) {
      Object.keys(contribution.players).forEach(function (playerId) {
        var before = actionBefore(actions, openIndex, playerId);
        if (before && (before.type === 'fold' || before.isAllIn === true || before.type === 'partial_call')) {
          setThreeBet(contribution.players[playerId], false, false, null, 'inactive_before_opening_raise', actionEvidence(before));
        } else {
          setThreeBet(contribution.players[playerId], null, null, null, 'opening_raise_fullness_unsupported', actionEvidence(openAction));
        }
      });
      setFoldToThreeBet(contribution.players[openerId], null, null, 'unknown', null, 'opening_raise_fullness_unsupported', actionEvidence(openAction));
      contribution.hand.validThreeBetSequence = null;
      addAmbiguity(contribution.ambiguities, AMBIGUITY_CODES.OPEN_RAISE_UNSUPPORTED, 'The first preflop raise was not proven to be a full opening raise.', actionEvidence(openAction));
      return contribution;
    }

    setThreeBet(contribution.players[openerId], false, false, null, 'player_made_opening_raise', actionEvidence(openAction));
    var secondRaiseIndex = raiseIndexes.length > 1 ? raiseIndexes[1] : -1;
    var secondRaise = secondRaiseIndex >= 0 ? actions[secondRaiseIndex] : null;
    var boundaryIndex = secondRaiseIndex >= 0 ? secondRaiseIndex + 1 : actions.length;
    var between = actions.slice(openIndex + 1, secondRaiseIndex >= 0 ? secondRaiseIndex : actions.length);
    var openerIntervened = between.find(function (action) { return String(action.playerId) === openerId; });
    var repeatedDecision = secondRaise && between.find(function (action) {
      return String(action.playerId) === String(secondRaise.playerId);
    });
    if (openerIntervened || repeatedDecision) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.MALFORMED_PREFLOP_SEQUENCE, 'The action order cannot represent a single supported opening-to-3Bet sequence.', actionEvidence(openerIntervened || repeatedDecision));
    }

    var interveningCallers = uniqueStrings(between.filter(function (action) {
      return action.type === 'call';
    }).map(function (action) { return action.playerId; }));
    var validThreeBet = Boolean(secondRaise && secondRaise.isFullRaise === true);
    var shortOrNonFull = Boolean(secondRaise && secondRaise.isFullRaise === false);
    var unknownSecondRaise = Boolean(secondRaise && secondRaise.isFullRaise !== true && secondRaise.isFullRaise !== false);
    contribution.hand.validThreeBetSequence = validThreeBet ? true : unknownSecondRaise ? null : false;
    contribution.hand.threeBettor = validThreeBet ? String(secondRaise.playerId) : null;
    contribution.hand.interveningCallers = validThreeBet ? interveningCallers : [];
    contribution.hand.isSqueeze = validThreeBet ? interveningCallers.length > 0 : null;

    Object.keys(contribution.players).forEach(function (playerId) {
      if (playerId === openerId) return;
      var prior = actionBefore(actions, openIndex, playerId);
      if (prior && (prior.type === 'fold' || prior.isAllIn === true || prior.type === 'partial_call')) {
        setThreeBet(contribution.players[playerId], false, false, null, 'inactive_before_opening_raise', actionEvidence(prior));
        return;
      }
      var decision = firstActionFor(actions, openIndex + 1, boundaryIndex, playerId);
      if (!decision && (shortOrNonFull || unknownSecondRaise)) {
        setThreeBet(contribution.players[playerId], null, null, null, 'action_after_unsupported_reraise_boundary', actionEvidence(secondRaise));
        return;
      }
      classifyThreeBetDecision(contribution, playerId, playerMap[playerId], decision, Boolean(decision && decision === secondRaise), interveningCallers);
    });

    if (!secondRaise) {
      Object.keys(contribution.players).forEach(function (playerId) {
        setFoldToThreeBet(contribution.players[playerId], false, false, null, null, 'no_qualifying_three_bet', []);
      });
      return contribution;
    }
    if (shortOrNonFull) {
      Object.keys(contribution.players).forEach(function (playerId) {
        var eligibility = foldToThreeBetEligibility(actions, secondRaiseIndex, playerId, secondRaise.playerId);
        if (eligibility.eligible) {
          setFoldToThreeBet(contribution.players[playerId], null, null, 'unknown', null, 'short_non_full_reraise_does_not_prove_reopening', actionEvidence(secondRaise));
        } else {
          setFoldToThreeBet(contribution.players[playerId], false, false, null, null, eligibility.reason, eligibility.evidence);
        }
      });
      addAmbiguity(contribution.ambiguities, AMBIGUITY_CODES.SHORT_ALL_IN_REOPENING_UNKNOWN, 'A short/non-full re-raise is not a 3Bet and cannot establish a Fold-to-3Bet opportunity.', actionEvidence(secondRaise));
      return contribution;
    }
    if (unknownSecondRaise) {
      Object.keys(contribution.players).forEach(function (playerId) {
        var eligibility = foldToThreeBetEligibility(actions, secondRaiseIndex, playerId, secondRaise.playerId);
        if (eligibility.eligible) {
          setFoldToThreeBet(contribution.players[playerId], null, null, 'unknown', null, 'reraise_fullness_unknown', actionEvidence(secondRaise));
        } else {
          setFoldToThreeBet(contribution.players[playerId], false, false, null, null, eligibility.reason, eligibility.evidence);
        }
      });
      addAmbiguity(contribution.ambiguities, AMBIGUITY_CODES.THREE_BET_CANDIDATE_UNSUPPORTED, 'The first re-raise did not have a supported full-raise classification.', actionEvidence(secondRaise));
      return contribution;
    }
    Object.keys(contribution.players).forEach(function (playerId) {
      var eligibility = foldToThreeBetEligibility(actions, secondRaiseIndex, playerId, secondRaise.playerId);
      if (!eligibility.eligible) {
        setFoldToThreeBet(contribution.players[playerId], false, false, null, null, eligibility.reason, eligibility.evidence);
        return;
      }
      var response = firstActionFor(actions, secondRaiseIndex + 1, actions.length, playerId);
      classifyFoldToThreeBetResponse(contribution, playerId, openerId, actions, secondRaiseIndex, response);
    });
    return contribution;
  }

  function createState(options) {
    options = options || {};
    var seeded = uniqueStrings(options.reducedHandIds || options.finalizedHandIds || []);
    return {
      schemaVersion: SCHEMA_VERSION,
      mode: MODE,
      maxRecords: boundedInteger(options.maxRecords, DEFAULT_MAX_RECORDS, 1, 200),
      maxAttempts: boundedInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 10, 300),
      maxPlayers: boundedInteger(options.maxPlayers, DEFAULT_MAX_PLAYERS, 10, 1000),
      contributionRecords: [],
      reductionAttempts: [],
      reducedHandIds: new Set(seeded),
      seededHandIds: new Set(seeded),
      totalsByPlayer: {},
      playerOrder: [],
      playerEvictions: 0,
      reducedHandCount: 0,
      reductionSequence: 0
    };
  }

  function recordAttempt(state, attempt) {
    state.reductionSequence += 1;
    pushBounded(state.reductionAttempts, Object.assign({
      sequence: state.reductionSequence,
      timestamp: Date.now(),
      accepted: false,
      duplicate: false
    }, clone(attempt || {})), state.maxAttempts);
  }

  function ensurePlayerTotal(state, playerId, contribution) {
    if (state.totalsByPlayer[playerId]) {
      state.playerOrder = state.playerOrder.filter(function (id) { return id !== playerId; });
      state.playerOrder.push(playerId);
      return state.totalsByPlayer[playerId];
    }
    if (state.playerOrder.length >= state.maxPlayers) {
      var evictedId = state.playerOrder.shift();
      delete state.totalsByPlayer[evictedId];
      state.playerEvictions += 1;
      addAmbiguity(contribution.ambiguities, AMBIGUITY_CODES.PLAYER_TOTAL_LIMIT_REACHED, 'The bounded shadow player-total limit evicted the least recently observed player aggregate.', { evictedPlayerId: evictedId });
    }
    state.playerOrder.push(playerId);
    state.totalsByPlayer[playerId] = {
      threeBet: { opportunities: 0, made: 0 },
      foldToThreeBet: { opportunities: 0, folds: 0 },
      contributingHands: 0,
      lastHandId: null
    };
    return state.totalsByPlayer[playerId];
  }

  function applyContribution(state, contribution) {
    var handId = contribution.handIdentity.handId || contribution.handIdentity.lifecycleHandId;
    Object.keys(contribution.players).forEach(function (playerId) {
      var player = contribution.players[playerId];
      var total = ensurePlayerTotal(state, playerId, contribution);
      var contributed = false;
      if (player.threeBet.opportunityCount === 1) {
        total.threeBet.opportunities += 1;
        total.threeBet.made += player.threeBet.madeCount;
        contributed = true;
      }
      if (player.foldToThreeBet.opportunityCount === 1) {
        total.foldToThreeBet.opportunities += 1;
        total.foldToThreeBet.folds += player.foldToThreeBet.foldCount;
        contributed = true;
      }
      if (contributed) total.contributingHands += 1;
      total.lastHandId = handId;
    });
  }

  function reduce(state, finalizedRecord) {
    if (!state || !(state.reducedHandIds instanceof Set)) throw new TypeError('A reducer state created by createState is required.');
    var aliases = handAliases(finalizedRecord);
    var identity = finalizedRecord && finalizedRecord.handIdentity || {};
    var handId = identity.handId === null || identity.handId === undefined ? aliases[0] || null : String(identity.handId);
    if (!aliases.length) {
      recordAttempt(state, { accepted: false, duplicate: false, handId: null, reason: 'finalized hand identity is required' });
      return { reduced: false, duplicate: false, reason: 'finalized hand identity is required' };
    }
    var duplicateAlias = aliases.find(function (alias) { return state.reducedHandIds.has(alias); });
    if (duplicateAlias) {
      recordAttempt(state, { accepted: false, duplicate: true, handId: handId, aliases: aliases, matchedAlias: duplicateAlias, reason: 'finalized hand was already reduced or seeded as finalized' });
      return { reduced: false, duplicate: true, previouslyReduced: true, handId: handId };
    }
    var contribution = deriveContribution(finalizedRecord);
    contribution.provenance.reducedAt = Date.now();
    aliases.forEach(function (alias) { state.reducedHandIds.add(alias); });
    state.reducedHandCount += 1;
    applyContribution(state, contribution);
    pushBounded(state.contributionRecords, clone(contribution), state.maxRecords);
    recordAttempt(state, {
      accepted: true,
      duplicate: false,
      handId: handId,
      aliases: aliases,
      ambiguityCodes: contribution.ambiguities.map(function (entry) { return entry.code; }),
      validThreeBetSequence: contribution.hand.validThreeBetSequence
    });
    return { reduced: true, duplicate: false, handId: handId, contribution: clone(contribution) };
  }

  function inspect(state) {
    return {
      schemaVersion: SCHEMA_VERSION,
      mode: MODE,
      coverage: {
        scope: 'current-content-instance-until-session-reset',
        reducedHandCount: state.reducedHandCount,
        trackedIdentityAliasCount: state.reducedHandIds.size,
        seededFinalizedHandCount: state.seededHandIds.size,
        playerAggregateEvictions: state.playerEvictions
      },
      bounds: {
        maxContributionRecords: state.maxRecords,
        maxReductionAttempts: state.maxAttempts,
        maxPlayerTotals: state.maxPlayers,
        reducedIdentitySet: 'session-scoped; cleared by Reset Session'
      },
      totalsByPlayer: clone(state.totalsByPlayer),
      contributionRecords: clone(state.contributionRecords),
      reductionAttempts: clone(state.reductionAttempts)
    };
  }

  var api = Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    VERSION: SCHEMA_VERSION,
    AMBIGUITY_CODES: AMBIGUITY_CODES,
    createState: createState,
    deriveContribution: deriveContribution,
    reduce: reduce,
    inspect: inspect
  });
  root.PokerPreflopOpportunityReducer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
