/* Pure, bounded, isolated shadow reducer for Flop CBet and Fold-to-Flop-CBet contributions. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && !isSupportedRuntimePage(root.PokerNowRuntimeScope, window.location)) return;

  var SCHEMA_VERSION = 1;
  var MODE = 'isolated_shadow';
  var DEFAULT_MAX_RECORDS = 50;
  var DEFAULT_MAX_ATTEMPTS = 100;
  var DEFAULT_MAX_ATTACHMENTS = 200;
  var DEFAULT_MAX_PLAYERS = 200;
  var VALID_FLOP_ACTIONS = new Set(['check', 'fold', 'call', 'partial_call', 'bet', 'raise']);
  var AMBIGUITY_CODES = Object.freeze({
    SOURCE_SCHEMA_UNSUPPORTED: 'SOURCE_SCHEMA_UNSUPPORTED',
    HISTORY_INCOMPLETE: 'HISTORY_INCOMPLETE',
    HAND_RECORD_MALFORMED: 'HAND_RECORD_MALFORMED',
    FINAL_AGGRESSOR_UNSUPPORTED: 'FINAL_AGGRESSOR_UNSUPPORTED',
    FLOP_PARTICIPANTS_UNSUPPORTED: 'FLOP_PARTICIPANTS_UNSUPPORTED',
    FLOP_ORDERING_UNSUPPORTED: 'FLOP_ORDERING_UNSUPPORTED',
    AGGRESSOR_DECISION_UNOBSERVED: 'AGGRESSOR_DECISION_UNOBSERVED',
    RESPONSE_UNOBSERVED: 'RESPONSE_UNOBSERVED',
    SIDE_POT_ELIGIBILITY_UNSUPPORTED: 'SIDE_POT_ELIGIBILITY_UNSUPPORTED',
    PLAYER_TOTAL_LIMIT_REACHED: 'PLAYER_TOTAL_LIMIT_REACHED'
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

  function addAmbiguity(contribution, code, detail, evidence) {
    if (!contribution.ambiguities.some(function (entry) { return entry.code === code; })) {
      contribution.ambiguities.push({ code: code, detail: detail, evidence: clone(evidence || null) });
    }
  }

  function actionEvidence(action) {
    return action ? [{
      sequence: action.sequence,
      sourceSequence: action.sourceSequence,
      street: action.street,
      playerId: action.playerId,
      type: action.type,
      isAllIn: action.isAllIn === true ? true : action.isAllIn === false ? false : null,
      isFullRaise: action.isFullRaise === true ? true : action.isFullRaise === false ? false : null,
      isShortAllInRaise: action.isShortAllInRaise === true ? true : action.isShortAllInRaise === false ? false : null
    }] : [];
  }

  function emptyPlayer(playerId, unknown, reason) {
    return {
      playerId: String(playerId),
      flopCBetMade: 0,
      flopCBetOpportunities: 0,
      foldToFlopCBet: 0,
      foldToFlopCBetOpportunities: 0,
      supported: !unknown,
      unsupportedReason: unknown ? reason : null,
      flopCBet: {
        opportunity: unknown ? null : false,
        made: unknown ? null : false,
        reason: reason,
        evidence: []
      },
      foldToFlopCBetDecision: {
        opportunity: unknown ? null : false,
        folded: unknown ? null : false,
        response: unknown ? 'unknown' : null,
        reason: reason,
        evidence: []
      }
    };
  }

  function playerIds(record) {
    var ids = [];
    (record && record.players || []).forEach(function (player) {
      if (player && player.playerId !== null && player.playerId !== undefined) ids.push(player.playerId);
    });
    (record && record.actions || []).forEach(function (action) {
      if (action && action.playerId !== null && action.playerId !== undefined) ids.push(action.playerId);
    });
    return uniqueStrings(ids);
  }

  function contributionShell(record, unknown, reason) {
    var identity = record && record.handIdentity || {};
    var players = {};
    playerIds(record).forEach(function (playerId) {
      players[playerId] = emptyPlayer(playerId, unknown, reason);
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
        finalPreflopAggressor: null,
        cBettor: null,
        qualifyingCBet: unknown ? null : false,
        cBetActionSequence: null,
        priorDonkBettor: null
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

  function setFlopCBet(player, opportunity, made, reason, evidence) {
    player.flopCBet = {
      opportunity: opportunity,
      made: made,
      reason: reason,
      evidence: clone(evidence || [])
    };
    player.flopCBetOpportunities = opportunity === true ? 1 : 0;
    player.flopCBetMade = opportunity === true && made === true ? 1 : 0;
    if (opportunity === null || made === null) {
      player.supported = false;
      player.unsupportedReason = reason;
    }
  }

  function setFoldToFlopCBet(player, opportunity, folded, response, reason, evidence) {
    player.foldToFlopCBetDecision = {
      opportunity: opportunity,
      folded: folded,
      response: response,
      reason: reason,
      evidence: clone(evidence || [])
    };
    player.foldToFlopCBetOpportunities = opportunity === true ? 1 : 0;
    player.foldToFlopCBet = opportunity === true && folded === true ? 1 : 0;
    if (opportunity === null || folded === null) {
      player.supported = false;
      player.unsupportedReason = reason;
    }
  }

  function setAllUnknown(contribution, code, detail, evidence) {
    Object.keys(contribution.players).forEach(function (playerId) {
      contribution.players[playerId] = emptyPlayer(playerId, true, code);
    });
    contribution.hand.qualifyingCBet = null;
    addAmbiguity(contribution, code, detail, evidence);
    return contribution;
  }

  function playersById(record) {
    var map = {};
    (record.players || []).forEach(function (player) {
      if (player && player.playerId !== null && player.playerId !== undefined) map[String(player.playerId)] = player;
    });
    return map;
  }

  function actionsForStreet(record, street) {
    return (record.actions || []).filter(function (action) {
      return action && action.street === street;
    });
  }

  function sequenceIsSupported(record) {
    var prior = -Infinity;
    var malformed = false;
    (record.actions || []).forEach(function (action) {
      if (!action || !numeric(action.sequence) || action.sequence <= prior || !action.playerId || !action.street) malformed = true;
      else prior = action.sequence;
      if (action && action.confidence === 'recovered_generic_event') malformed = true;
      if (action && action.street === 'flop' && !VALID_FLOP_ACTIONS.has(action.type)) malformed = true;
    });
    return !malformed;
  }

  function finalAggressor(record, contribution) {
    var raises = actionsForStreet(record, 'preflop').filter(function (action) { return action.type === 'raise'; });
    if (!raises.length) return { supported: true, playerId: null, action: null };
    var unknownRaise = raises.find(function (action) { return action.isFullRaise !== true && action.isFullRaise !== false; });
    if (unknownRaise) {
      addAmbiguity(contribution, AMBIGUITY_CODES.FINAL_AGGRESSOR_UNSUPPORTED, 'A preflop raise lacked a supported full/non-full classification.', actionEvidence(unknownRaise));
      return { supported: false, playerId: null, action: unknownRaise };
    }
    var fullRaises = raises.filter(function (action) { return action.isFullRaise === true; });
    if (!fullRaises.length) {
      addAmbiguity(contribution, AMBIGUITY_CODES.FINAL_AGGRESSOR_UNSUPPORTED, 'No qualifying full preflop raise established initiative.', actionEvidence(raises[raises.length - 1]));
      return { supported: false, playerId: null, action: raises[raises.length - 1] };
    }
    var last = fullRaises[fullRaises.length - 1];
    var role = record.preflopRoles && record.preflopRoles.finalAggressor;
    if (role !== null && role !== undefined && String(role) !== String(last.playerId)) {
      addAmbiguity(contribution, AMBIGUITY_CODES.FINAL_AGGRESSOR_UNSUPPORTED, 'The ordered final full raise disagreed with the ledger final-aggressor summary.', actionEvidence(last));
      return { supported: false, playerId: null, action: last };
    }
    return { supported: true, playerId: String(last.playerId), action: last };
  }

  function knownAllInBeforeFlop(record, playerId) {
    var player = playersById(record)[String(playerId)];
    if (player && player.allIn === true) return true;
    return actionsForStreet(record, 'preflop').some(function (action) {
      return String(action.playerId) === String(playerId) && action.isAllIn === true;
    });
  }

  function flopOrderingSupported(flop, flopActions) {
    if (!flop || !Array.isArray(flop.actionOrder)) return false;
    if (flopActions.length && !flop.firstActor) return false;
    var actualOrder = flopActions.map(function (action) { return String(action.playerId); });
    var ledgerOrder = flop.actionOrder.map(String);
    return actualOrder.length === ledgerOrder.length && actualOrder.every(function (playerId, index) {
      return playerId === ledgerOrder[index];
    });
  }

  function markNoOpportunities(contribution, reason) {
    Object.keys(contribution.players).forEach(function (playerId) {
      setFlopCBet(contribution.players[playerId], false, false, reason, []);
      setFoldToFlopCBet(contribution.players[playerId], false, false, null, reason, []);
    });
    contribution.hand.qualifyingCBet = false;
    return contribution;
  }

  function directResponse(flopActions, cBetIndex, playerId) {
    for (var index = cBetIndex + 1; index < flopActions.length; index += 1) {
      var action = flopActions[index];
      if (String(action.playerId) === String(playerId)) return { action: action, priceChanged: false };
      if (action.type === 'bet' || action.type === 'raise') return { action: action, priceChanged: true };
    }
    return null;
  }

  function classifyFoldResponses(record, contribution, aggressorId, entrants, flopActions, cBetIndex) {
    var entrantSet = new Set(entrants);
    Object.keys(contribution.players).forEach(function (playerId) {
      var target = contribution.players[playerId];
      if (playerId === aggressorId) {
        setFoldToFlopCBet(target, false, false, null, 'c_bettor_is_not_a_fold_to_cbet_candidate', []);
        return;
      }
      if (!entrantSet.has(playerId)) {
        setFoldToFlopCBet(target, false, false, null, 'player_did_not_see_flop', []);
        return;
      }
      if (knownAllInBeforeFlop(record, playerId)) {
        setFoldToFlopCBet(target, false, false, null, 'player_already_all_in_before_cbet', []);
        return;
      }
      var response = directResponse(flopActions, cBetIndex, playerId);
      if (!response) {
        setFoldToFlopCBet(target, null, null, 'unknown', 'direct_response_not_observed', []);
        addAmbiguity(contribution, AMBIGUITY_CODES.RESPONSE_UNOBSERVED, 'A live flop entrant had no observed direct response to the qualifying CBet.', { playerId: playerId });
        return;
      }
      if (response.priceChanged) {
        setFoldToFlopCBet(target, false, false, null, 'intervening_raise_changed_price_before_response', actionEvidence(response.action));
        return;
      }
      var action = response.action;
      if (action.type === 'fold') {
        setFoldToFlopCBet(target, true, true, 'fold', 'folded_directly_to_qualifying_cbet', actionEvidence(action));
      } else if (action.type === 'call' || action.type === 'partial_call') {
        setFoldToFlopCBet(target, true, false, action.type === 'partial_call' || action.isAllIn === true ? 'all-in-call' : 'call', 'continued_by_calling_qualifying_cbet', actionEvidence(action));
      } else if (action.type === 'raise') {
        setFoldToFlopCBet(target, true, false, action.isAllIn === true ? 'all-in-raise' : 'raise', 'continued_by_raising_qualifying_cbet', actionEvidence(action));
      } else {
        setFoldToFlopCBet(target, null, null, 'unknown', 'unsupported_direct_response', actionEvidence(action));
        addAmbiguity(contribution, AMBIGUITY_CODES.RESPONSE_UNOBSERVED, 'The observed direct response type was not supported.', actionEvidence(action));
      }
    });
  }

  function deriveContribution(record) {
    var contribution = contributionShell(record || {}, false, 'no_qualifying_flop_sequence');
    if (!record || record.status !== 'finalized' || !handAliases(record).length || !Array.isArray(record.players) || !Array.isArray(record.actions)) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.HAND_RECORD_MALFORMED, 'A finalized semantic record with identity, players, and ordered actions is required.', null);
    }
    if (record.schemaVersion !== 1) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.SOURCE_SCHEMA_UNSUPPORTED, 'The semantic ledger schema version is unsupported.', { sourceLedgerSchemaVersion: record.schemaVersion });
    }
    var incomplete = !record.provenance || record.provenance.historyComplete !== true || record.provenance.recovered === true ||
      (record.ambiguities || []).some(function (entry) {
        return entry && (entry.code === 'PARTIAL_HISTORY_AFTER_RECOVERY' || entry.code === 'OBSERVATION_LIMIT_REACHED');
      });
    if (incomplete) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.HISTORY_INCOMPLETE, 'Complete, non-recovered ordered history is required.', {
        historyComplete: record.provenance && record.provenance.historyComplete,
        recovered: record.provenance && record.provenance.recovered
      });
    }
    if (!sequenceIsSupported(record)) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.FLOP_ORDERING_UNSUPPORTED, 'The action sequence is unordered, recovered, or contains an unsupported flop action.', null);
    }

    var aggressor = finalAggressor(record, contribution);
    if (!aggressor.supported) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.FINAL_AGGRESSOR_UNSUPPORTED, 'Final preflop initiative could not be resolved safely.', actionEvidence(aggressor.action));
    }
    if (!aggressor.playerId) return markNoOpportunities(contribution, 'no_qualifying_preflop_aggressor');
    contribution.hand.finalPreflopAggressor = aggressor.playerId;

    var flop = record.streets && record.streets.flop;
    if (!flop) return markNoOpportunities(contribution, 'hand_did_not_reach_flop');
    if (!Array.isArray(flop.entrants)) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.FLOP_PARTICIPANTS_UNSUPPORTED, 'The flop entrant list is unavailable.', null);
    }
    var entrants = uniqueStrings(flop.entrants);
    if (!entrants.includes(aggressor.playerId)) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.FLOP_PARTICIPANTS_UNSUPPORTED, 'The final preflop aggressor is absent from the supported flop entrant list.', { finalPreflopAggressor: aggressor.playerId, entrants: entrants });
    }
    var opponents = entrants.filter(function (playerId) { return playerId !== aggressor.playerId; });
    if (!opponents.length) return markNoOpportunities(contribution, 'no_opponent_continued_to_flop');
    if (knownAllInBeforeFlop(record, aggressor.playerId)) {
      return markNoOpportunities(contribution, 'final_preflop_aggressor_already_all_in');
    }
    if (record.automaticRunout && record.automaticRunout.detected === true) {
      return markNoOpportunities(contribution, 'automatic_runout_has_no_flop_betting_opportunity');
    }

    var shortAllIn = actionsForStreet(record, 'preflop').find(function (action) {
      return action.isShortAllInRaise === true;
    });
    if (shortAllIn && (!record.settlement || record.settlement.sidePotStatus !== false)) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.SIDE_POT_ELIGIBILITY_UNSUPPORTED, 'A short preflop all-in reached a flop with unresolved side-pot action eligibility.', actionEvidence(shortAllIn));
    }
    var flopActions = actionsForStreet(record, 'flop');
    if (!flopOrderingSupported(flop, flopActions)) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.FLOP_ORDERING_UNSUPPORTED, 'The flop action order or first actor is missing or disagrees with ordered actions.', {
        firstActor: flop.firstActor || null,
        actionOrder: clone(flop.actionOrder || []),
        actionPlayers: flopActions.map(function (action) { return action.playerId; })
      });
    }

    Object.keys(contribution.players).forEach(function (playerId) {
      if (playerId !== aggressor.playerId) setFlopCBet(contribution.players[playerId], false, false, 'only_final_preflop_aggressor_is_eligible', []);
      setFoldToFlopCBet(contribution.players[playerId], false, false, null, 'no_qualifying_cbet', []);
    });

    var aggressorIndex = flopActions.findIndex(function (action) {
      return String(action.playerId) === aggressor.playerId;
    });
    var priorActions = aggressorIndex >= 0 ? flopActions.slice(0, aggressorIndex) : flopActions;
    var priorBet = priorActions.find(function (action) { return action.type === 'bet' || action.type === 'raise'; });
    if (priorBet) {
      contribution.hand.priorDonkBettor = String(priorBet.playerId);
      setFlopCBet(contribution.players[aggressor.playerId], false, false, 'opponent_bet_before_aggressor_action', actionEvidence(priorBet));
      contribution.hand.qualifyingCBet = false;
      return contribution;
    }
    if (aggressorIndex < 0) {
      setFlopCBet(contribution.players[aggressor.playerId], null, null, 'aggressor_flop_decision_not_observed', []);
      contribution.hand.qualifyingCBet = null;
      addAmbiguity(contribution, AMBIGUITY_CODES.AGGRESSOR_DECISION_UNOBSERVED, 'Action reached or may have reached the final preflop aggressor, but no supported decision was observed.', { firstActor: flop.firstActor || null, actionOrder: clone(flop.actionOrder) });
      return contribution;
    }

    var aggressorAction = flopActions[aggressorIndex];
    if (aggressorAction.type === 'check') {
      setFlopCBet(contribution.players[aggressor.playerId], true, false, 'aggressor_checked_when_cbet_was_available', actionEvidence(aggressorAction));
      contribution.hand.qualifyingCBet = false;
      return contribution;
    }
    if (aggressorAction.type !== 'bet') {
      return setAllUnknown(contribution, AMBIGUITY_CODES.FLOP_ORDERING_UNSUPPORTED, 'The aggressor action type is incompatible with an unopened supported flop decision.', actionEvidence(aggressorAction));
    }
    if (flop.firstBettor && String(flop.firstBettor) !== aggressor.playerId) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.FLOP_ORDERING_UNSUPPORTED, 'The ordered CBet action disagrees with the ledger first-bettor summary.', actionEvidence(aggressorAction));
    }

    setFlopCBet(contribution.players[aggressor.playerId], true, true, 'qualifying_flop_cbet', actionEvidence(aggressorAction));
    contribution.hand.qualifyingCBet = true;
    contribution.hand.cBettor = aggressor.playerId;
    contribution.hand.cBetActionSequence = aggressorAction.sequence;
    classifyFoldResponses(record, contribution, aggressor.playerId, entrants, flopActions, aggressorIndex);
    return contribution;
  }

  function createState(options) {
    options = options || {};
    var seeded = uniqueStrings((options.reducedHandIds || []).concat(options.finalizedHandIds || []));
    return {
      schemaVersion: SCHEMA_VERSION,
      mode: MODE,
      maxRecords: boundedInteger(options.maxRecords, DEFAULT_MAX_RECORDS, 1, 200),
      maxAttempts: boundedInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 10, 300),
      maxPlayers: boundedInteger(options.maxPlayers, DEFAULT_MAX_PLAYERS, 10, 1000),
      maxAttachments: boundedInteger(options.maxAttachments, DEFAULT_MAX_ATTACHMENTS, 10, 500),
      contributionRecords: [],
      reductionAttempts: [],
      reducedHandIds: new Set(seeded),
      attachmentRecords: [],
      attachedContributionIds: new Set(),
      attachmentSequence: 0,
      seededFinalizedHandCount: seeded.length,
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
      addAmbiguity(contribution, AMBIGUITY_CODES.PLAYER_TOTAL_LIMIT_REACHED, 'The bounded player-total limit evicted the least recently observed aggregate.', { evictedPlayerId: evictedId });
    }
    state.playerOrder.push(playerId);
    state.totalsByPlayer[playerId] = {
      flopCBetMade: 0,
      flopCBetOpportunities: 0,
      foldToFlopCBet: 0,
      foldToFlopCBetOpportunities: 0,
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
      if (player.flopCBetOpportunities === 1) {
        total.flopCBetOpportunities += 1;
        total.flopCBetMade += player.flopCBetMade;
        contributed = true;
      }
      if (player.foldToFlopCBetOpportunities === 1) {
        total.foldToFlopCBetOpportunities += 1;
        total.foldToFlopCBet += player.foldToFlopCBet;
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
      recordAttempt(state, { handId: null, reason: 'finalized hand identity is required' });
      return { reduced: false, duplicate: false, reason: 'finalized hand identity is required' };
    }
    var duplicateAlias = aliases.find(function (alias) { return state.reducedHandIds.has(alias); });
    if (duplicateAlias) {
      recordAttempt(state, { duplicate: true, handId: handId, aliases: aliases, matchedAlias: duplicateAlias, reason: 'finalized hand was already reduced' });
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
      handId: handId,
      aliases: aliases,
      qualifyingCBet: contribution.hand.qualifyingCBet,
      ambiguityCodes: contribution.ambiguities.map(function (entry) { return entry.code; })
    });
    return { reduced: true, duplicate: false, handId: handId, contribution: clone(contribution) };
  }

  function shadowFields(player) {
    return {
      flopCBetMade: Number(player && player.flopCBetMade || 0),
      flopCBetOpportunities: Number(player && player.flopCBetOpportunities || 0),
      foldToFlopCBet: Number(player && player.foldToFlopCBet || 0),
      foldToFlopCBetOpportunities: Number(player && player.foldToFlopCBetOpportunities || 0),
      supported: player ? player.supported !== false : false,
      unsupportedReason: player && player.unsupportedReason || null
    };
  }

  function recordAttachment(state, record) {
    state.attachmentSequence += 1;
    var stored = Object.assign({
      sequence: state.attachmentSequence,
      timestamp: Date.now(),
      attached: false,
      duplicate: false,
      skipped: false
    }, clone(record || {}));
    pushBounded(state.attachmentRecords, stored, state.maxAttachments);
    return stored;
  }

  function attach(state, finalizedEvents, contribution, options) {
    if (!state || !(state.attachedContributionIds instanceof Set)) throw new TypeError('A reducer state created by createState is required.');
    var aliases = handAliases(contribution);
    if (!aliases.length || !contribution || !contribution.players) {
      return { attachedCount: 0, duplicateCount: 0, missingPlayerIds: [], attachmentResults: [recordAttachment(state, { skipped: true, reason: 'contribution hand identity or players are missing', candidateHandIds: aliases })] };
    }
    var events = Array.isArray(finalizedEvents) ? finalizedEvents : [];
    var rangeStart = Math.max(0, Math.min(events.length, Number(options && options.start || 0)));
    var rangeLength = options && Number.isFinite(Number(options.length)) ? Math.max(0, Math.min(events.length - rangeStart, Number(options.length))) : events.length - rangeStart;
    var matchingIndexes = [];
    for (var rangeIndex = rangeStart; rangeIndex < rangeStart + rangeLength; rangeIndex += 1) {
      if (aliases.includes(String(events[rangeIndex] && events[rangeIndex].handId))) matchingIndexes.push(rangeIndex);
    }
    var results = [];
    var missingPlayerIds = [];
    var attachedCount = 0;
    var duplicateCount = 0;
    Object.keys(contribution.players).forEach(function (playerId) {
      playerId = String(playerId);
      var contributionId = ['flop-cbet', Number(contribution.reducerVersion || contribution.version || contribution.schemaVersion || SCHEMA_VERSION), aliases[0], playerId].join(':');
      if (state.attachedContributionIds.has(contributionId)) {
        duplicateCount += 1;
        results.push(recordAttachment(state, {
          contributionId: contributionId,
          playerId: playerId,
          duplicate: true,
          skipped: true,
          reason: 'shadow contribution was already attached',
          candidateHandIds: aliases,
          fields: shadowFields(contribution.players[playerId])
        }));
        return;
      }
      var targetIndex = matchingIndexes.find(function (index) {
        return String(events[index] && events[index].playerId || '') === playerId;
      });
      if (targetIndex === undefined) {
        missingPlayerIds.push(playerId);
        results.push(recordAttachment(state, {
          contributionId: contributionId,
          playerId: playerId,
          skipped: true,
          reason: matchingIndexes.length ? 'stable player ID did not match a finalized event' : 'no finalized event matched lifecycle or authoritative hand identity',
          candidateHandIds: aliases,
          fields: shadowFields(contribution.players[playerId])
        }));
        return;
      }
      var target = events[targetIndex];
      state.attachedContributionIds.add(contributionId);
      attachedCount += 1;
      results.push(recordAttachment(state, {
        contributionId: contributionId,
        targetEventId: String(target.eventKey || target.eventId || String(target.handId) + ':' + playerId + ':' + targetIndex),
        targetEventIndex: targetIndex,
        targetHandId: String(target.handId),
        playerId: playerId,
        attached: true,
        candidateHandIds: aliases,
        fields: shadowFields(contribution.players[playerId]),
        opportunityEvidence: clone({ flopCBet: contribution.players[playerId].flopCBet, foldToFlopCBet: contribution.players[playerId].foldToFlopCBetDecision })
      }));
    });
    return { attachedCount: attachedCount, duplicateCount: duplicateCount, missingPlayerIds: missingPlayerIds, attachmentResults: clone(results) };
  }

  function inspect(state) {
    return {
      schemaVersion: SCHEMA_VERSION,
      mode: MODE,
      coverage: {
        scope: 'isolated-design-checkpoint',
        reducedHandCount: state.reducedHandCount,
        seededFinalizedHandCount: state.seededFinalizedHandCount,
        attachedContributionCount: state.attachedContributionIds.size,
        attachmentAttemptCount: state.attachmentSequence,
        trackedIdentityAliasCount: state.reducedHandIds.size,
        playerAggregateEvictions: state.playerEvictions
      },
      bounds: {
        maxContributionRecords: state.maxRecords,
        maxAttachmentRecords: state.maxAttachments,
        maxReductionAttempts: state.maxAttempts,
        maxPlayerTotals: state.maxPlayers
      },
      totalsByPlayer: clone(state.totalsByPlayer),
      attachmentRecords: clone(state.attachmentRecords),
      contributionRecords: clone(state.contributionRecords),
      reductionAttempts: clone(state.reductionAttempts)
    };
  }

  var api = Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    VERSION: SCHEMA_VERSION,
    MODE: MODE,
    AMBIGUITY_CODES: AMBIGUITY_CODES,
    createState: createState,
    attach: attach,
    deriveContribution: deriveContribution,
    reduce: reduce,
    inspect: inspect
  });
  root.PokerFlopCBetOpportunityReducer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
