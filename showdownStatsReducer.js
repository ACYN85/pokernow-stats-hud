/* Pure, bounded, isolated shadow reducer for WTSD and rich showdown outcomes. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && !isSupportedRuntimePage(root.PokerNowRuntimeScope, window.location)) return;

  var SCHEMA_VERSION = 1;
  var MODE = 'isolated_shadow';
  var DEFAULT_MAX_RECORDS = 50;
  var DEFAULT_MAX_ATTEMPTS = 100;
  var DEFAULT_MAX_PLAYERS = 200;
  var DEFAULT_MAX_IDENTITY_ALIASES = 400;
  var DEFAULT_MAX_ATTACHMENTS = 200;
  var AMBIGUITY_CODES = Object.freeze({
    SOURCE_SCHEMA_UNSUPPORTED: 'SOURCE_SCHEMA_UNSUPPORTED',
    HAND_RECORD_MALFORMED: 'HAND_RECORD_MALFORMED',
    HISTORY_INCOMPLETE: 'HISTORY_INCOMPLETE',
    PLAYER_IDENTITY_UNSUPPORTED: 'PLAYER_IDENTITY_UNSUPPORTED',
    ACTION_ORDER_UNSUPPORTED: 'ACTION_ORDER_UNSUPPORTED',
    FLOP_PARTICIPATION_UNSUPPORTED: 'FLOP_PARTICIPATION_UNSUPPORTED',
    SHOWDOWN_MEMBERSHIP_UNSUPPORTED: 'SHOWDOWN_MEMBERSHIP_UNSUPPORTED',
    SHOWDOWN_CONTEST_UNSUPPORTED: 'SHOWDOWN_CONTEST_UNSUPPORTED',
    SETTLEMENT_UNRESOLVED: 'SETTLEMENT_UNRESOLVED',
    SETTLEMENT_AWARD_UNSUPPORTED: 'SETTLEMENT_AWARD_UNSUPPORTED',
    POT_ELIGIBILITY_UNSUPPORTED: 'POT_ELIGIBILITY_UNSUPPORTED',
    DUPLICATE_AWARD_RECORD: 'DUPLICATE_AWARD_RECORD',
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

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function numeric(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function almostEqual(left, right) {
    return numeric(left) && numeric(right) && Math.abs(left - right) < 1e-9;
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

  function emptyPlayer(playerId, reason) {
    return {
      playerId: String(playerId),
      reducerVersion: SCHEMA_VERSION,
      sawFlopForWTSD: null,
      wentToShowdown: null,
      showdownReached: null,
      wtsdOpportunityCount: 0,
      wtsdCount: 0,
      showdownOpportunityCount: 0,
      showdownOutcome: null,
      showdownGrossAward: null,
      showdownNetResult: null,
      wonMoneyAtShowdownCandidate: null,
      wonMoneyAtShowdownCandidateSupported: false,
      wonMoneyAtShowdownCandidateReason: reason || 'not_evaluated',
      contestedGrossAward: null,
      excludedReturnAmount: null,
      potsEligible: null,
      potsWon: null,
      potsTied: null,
      potsLost: null,
      supported: false,
      wtsdSupported: false,
      outcomeSupported: null,
      unsupportedReason: reason || null,
      evidence: { flop: [], showdown: [], settlement: [] }
    };
  }

  function playerIds(record) {
    return (record && record.players || []).map(function (player) {
      return player && player.playerId !== null && player.playerId !== undefined ? String(player.playerId) : null;
    }).filter(Boolean);
  }

  function contributionShell(record) {
    var identity = record && record.handIdentity || {};
    var players = {};
    playerIds(record).forEach(function (playerId) { players[playerId] = emptyPlayer(playerId, 'not_evaluated'); });
    return {
      schemaVersion: SCHEMA_VERSION,
      reducerVersion: SCHEMA_VERSION,
      mode: MODE,
      handIdentity: {
        handId: identity.handId === null || identity.handId === undefined ? null : String(identity.handId),
        lifecycleHandId: identity.lifecycleHandId === null || identity.lifecycleHandId === undefined ? null : String(identity.lifecycleHandId),
        gameNumber: numeric(identity.gameNumber) ? identity.gameNumber : null
      },
      sourceLedgerSchemaVersion: record && record.schemaVersion || null,
      hand: {
        showdownDetected: record && record.showdown ? record.showdown.detected : null,
        settlementStatus: record && record.settlement && record.settlement.status || 'unresolved',
        uncontested: record && record.settlement ? record.settlement.uncontested : null,
        automaticRunout: record && record.automaticRunout ? record.automaticRunout.detected : null,
        duplicateAwardRecordsIgnored: 0,
        potModel: null
      },
      players: players,
      ambiguities: [],
      provenance: {
        source: 'finalized-semantic-hand-record',
        sourceFinalizationReason: record && record.provenance && record.provenance.finalizationReason || null,
        sourceHistoryComplete: record && record.provenance ? record.provenance.historyComplete : null,
        sourceRecovered: record && record.provenance ? record.provenance.recovered : null,
        sourceAmbiguityCodes: (record && record.ambiguities || []).map(function (entry) { return entry && entry.code; }).filter(Boolean)
      }
    };
  }

  function markPlayerUnsupported(player, reason, preserveWTSD) {
    if (!preserveWTSD) {
      player.sawFlopForWTSD = null;
      player.wentToShowdown = null;
      player.showdownReached = null;
      player.wtsdOpportunityCount = 0;
      player.wtsdCount = 0;
      player.showdownOpportunityCount = 0;
      player.wtsdSupported = false;
    }
    player.showdownOutcome = preserveWTSD && player.wentToShowdown === 1 ? 'unsupported' : null;
    player.outcomeSupported = preserveWTSD && player.wentToShowdown === 1 ? false : null;
    player.supported = false;
    player.unsupportedReason = reason;
    player.potsEligible = null;
    player.potsWon = null;
    player.potsTied = null;
    player.potsLost = null;
  }

  function setAllUnknown(contribution, code, detail, evidence) {
    Object.keys(contribution.players).forEach(function (playerId) {
      markPlayerUnsupported(contribution.players[playerId], code, false);
    });
    addAmbiguity(contribution, code, detail, evidence);
    return contribution;
  }

  function playersById(record) {
    var map = {};
    var duplicate = null;
    (record.players || []).forEach(function (player) {
      if (!player || player.playerId === null || player.playerId === undefined || String(player.playerId) === '') return;
      var playerId = String(player.playerId);
      if (map[playerId]) duplicate = playerId;
      map[playerId] = player;
    });
    return { map: map, duplicate: duplicate };
  }

  function actionOrderingSupported(record) {
    var prior = -Infinity;
    return (record.actions || []).every(function (action) {
      if (!action || !numeric(action.sequence) || action.sequence <= prior || !action.playerId || !action.street || !action.type) return false;
      prior = action.sequence;
      return action.confidence !== 'recovered_generic_event';
    });
  }

  function foldByPlayer(record) {
    var folds = {};
    (record.actions || []).forEach(function (action) {
      if (action && action.type === 'fold' && action.playerId !== null && action.playerId !== undefined) folds[String(action.playerId)] = action;
    });
    return folds;
  }

  function completeUncontestedPostflopTerminal(record, entrantsSupported, entrants, folds, playerMap) {
    var showdown = record.showdown || {};
    var settlement = record.settlement || {};
    if (!entrantsSupported || entrants.size < 2 || settlement.status !== 'known' || settlement.uncontested === false) return null;
    if (showdown.detected === true || uniqueStrings(showdown.participants || []).length || record.automaticRunout && record.automaticRunout.detected === true) return null;
    if (Object.keys(playerMap).some(function (playerId) { return playerMap[playerId].reachedShowdown === true; })) return null;
    if (!Array.isArray(settlement.awards) || !Array.isArray(settlement.refunds) || !isObject(settlement.totalsByPlayer) || !isObject(settlement.reconciliation)) return null;
    if (!numeric(settlement.totalAwardAmount) || settlement.totalAwardAmount <= 0 || settlement.chopped !== false) return null;

    var potAwards = settlement.awards.filter(function (award) { return !awardIsReturn(award); });
    if (!potAwards.length || potAwards.some(function (award) {
      return !award || award.playerId === null || award.playerId === undefined || !numeric(award.amount) || award.amount <= 0;
    })) return null;
    var awardRecipients = uniqueStrings(potAwards.map(function (award) { return award.playerId; }));
    var positiveTotals = Object.keys(settlement.totalsByPlayer).filter(function (playerId) {
      return numeric(settlement.totalsByPlayer[playerId]) && settlement.totalsByPlayer[playerId] > 0;
    });
    var awardTotal = potAwards.reduce(function (sum, award) { return sum + award.amount; }, 0);
    if (awardRecipients.length !== 1 || positiveTotals.length !== 1 || awardRecipients[0] !== positiveTotals[0] || !almostEqual(awardTotal, settlement.totalAwardAmount)) return null;

    var winnerId = awardRecipients[0];
    if (!entrants.has(winnerId) || folds[winnerId]) return null;
    var foldedOpponentIds = Array.from(entrants).filter(function (playerId) { return playerId !== winnerId; });
    if (!foldedOpponentIds.length || foldedOpponentIds.some(function (playerId) {
      var fold = folds[playerId];
      return !fold || (fold.street !== 'flop' && fold.street !== 'turn' && fold.street !== 'river');
    })) return null;
    var liveEntrants = Array.from(entrants).filter(function (playerId) { return !folds[playerId]; });
    if (liveEntrants.length !== 1 || liveEntrants[0] !== winnerId) return null;

    return {
      kind: 'complete-uncontested-postflop-terminal',
      winnerId: winnerId,
      foldedOpponentIds: foldedOpponentIds,
      totalAwardAmount: settlement.totalAwardAmount
    };
  }

  function setSawFlop(player, value, reason, evidence) {
    player.sawFlopForWTSD = value;
    player.wtsdOpportunityCount = value === 1 ? 1 : 0;
    player.wtsdSupported = value !== null;
    player.supported = value !== null;
    player.unsupportedReason = value === null ? reason : null;
    player.evidence.flop = clone(evidence || []);
    if (value === 0) {
      player.wentToShowdown = 0;
      player.showdownReached = 0;
      player.wtsdCount = 0;
    }
  }

  function setShowdownReached(player, value, reason, evidence) {
    player.wentToShowdown = value;
    player.showdownReached = value;
    player.wtsdCount = value === 1 ? 1 : 0;
    player.showdownOpportunityCount = value === 1 ? 1 : 0;
    player.wtsdSupported = player.sawFlopForWTSD !== null && value !== null;
    player.supported = player.wtsdSupported;
    player.unsupportedReason = value === null ? reason : null;
    player.evidence.showdown = clone(evidence || []);
  }

  function deriveWTSD(record, contribution, playerMap) {
    var flop = record.streets && record.streets.flop;
    var entrantsSupported = Boolean(flop && Array.isArray(flop.entrants));
    var entrants = entrantsSupported ? new Set(uniqueStrings(flop.entrants)) : new Set();
    var folds = foldByPlayer(record);
    var showdown = record.showdown || {};
    var settlement = record.settlement || {};
    var visibleParticipants = new Set(uniqueStrings(showdown.participants || []));
    var completeUncontestedTerminal = completeUncontestedPostflopTerminal(record, entrantsSupported, entrants, folds, playerMap);

    Object.keys(contribution.players).forEach(function (playerId) {
      var source = playerMap[playerId];
      if (source.sawFlop === true && entrantsSupported && entrants.has(playerId)) {
        setSawFlop(contribution.players[playerId], 1, null, [{ kind: 'flop-entrant', playerId: playerId, startedAtSequence: flop.startedAtSequence || null }]);
      } else if (source.sawFlop === false && (!entrantsSupported || !entrants.has(playerId))) {
        setSawFlop(contribution.players[playerId], 0, null, [{ kind: 'player-did-not-enter-flop', playerId: playerId }]);
      } else {
        setSawFlop(contribution.players[playerId], null, 'flop_participation_not_corroborated', []);
        addAmbiguity(contribution, AMBIGUITY_CODES.FLOP_PARTICIPATION_UNSUPPORTED, 'Player saw-flop state did not agree with a supported flop entrant list.', { playerId: playerId, playerSawFlop: source.sawFlop, flopEntrants: entrantsSupported ? Array.from(entrants) : null });
      }
    });

    var contestedConflict = showdown.detected === true && settlement.uncontested === true;
    if (contestedConflict) {
      Object.keys(contribution.players).forEach(function (playerId) {
        if (contribution.players[playerId].sawFlopForWTSD === 1) setShowdownReached(contribution.players[playerId], null, 'showdown_and_uncontested_evidence_conflict', []);
      });
      addAmbiguity(contribution, AMBIGUITY_CODES.SHOWDOWN_CONTEST_UNSUPPORTED, 'The record simultaneously marked a showdown and an uncontested settlement.', null);
      return;
    }

    if (showdown.detected === false || settlement.uncontested === true || completeUncontestedTerminal) {
      Object.keys(contribution.players).forEach(function (playerId) {
        var player = contribution.players[playerId];
        if (player.sawFlopForWTSD === 1) setShowdownReached(player, 0, 'hand_ended_uncontested', completeUncontestedTerminal
          ? [completeUncontestedTerminal]
          : [{ kind: 'uncontested-terminal', value: true }]);
      });
      return;
    }

    var explicitParticipants = Object.keys(playerMap).filter(function (playerId) {
      return playerMap[playerId].reachedShowdown === true || visibleParticipants.has(playerId);
    });
    var explicitSet = new Set(explicitParticipants);
    var supportedContest = showdown.detected === true && explicitParticipants.length >= 2;

    Object.keys(contribution.players).forEach(function (playerId) {
      var player = contribution.players[playerId];
      if (player.sawFlopForWTSD !== 1) return;
      var fold = folds[playerId];
      if (fold && (fold.street === 'flop' || fold.street === 'turn' || fold.street === 'river')) {
        setShowdownReached(player, 0, 'player_folded_after_seeing_flop', [{ kind: 'fold', street: fold.street, sequence: fold.sequence, sourceSequence: fold.sourceSequence || null }]);
        return;
      }
      if (supportedContest && explicitSet.has(playerId)) {
        setShowdownReached(player, 1, 'supported_contested_showdown_participant', [{ kind: visibleParticipants.has(playerId) ? 'visible-showdown-participant' : 'explicit-mucked-or-unshown-participant', playerId: playerId }]);
        return;
      }
      setShowdownReached(player, null, 'showdown_membership_not_authoritative', []);
      addAmbiguity(contribution, AMBIGUITY_CODES.SHOWDOWN_MEMBERSHIP_UNSUPPORTED, 'A player who saw the flop lacked supported membership in a contested showdown with another live opponent.', { playerId: playerId, showdownDetected: showdown.detected, explicitParticipants: explicitParticipants });
    });
  }

  function awardIsReturn(award) {
    var kind = String(award && (award.kind || award.type) || '').toLowerCase();
    return kind === 'refund' || kind === 'return' || kind === 'returned' || kind === 'uncalled_return' || kind === 'uncalled-bet-return';
  }

  function awardIdentity(award) {
    if (award.awardId !== null && award.awardId !== undefined && String(award.awardId) !== '') return 'id|' + String(award.awardId);
    return ['tuple', String(award.playerId), Number(award.amount), award.potId === null || award.potId === undefined ? '' : String(award.potId), award.boardIndex === null || award.boardIndex === undefined ? '' : String(award.boardIndex), String(award.kind || award.type || 'award')].join('|');
  }

  function normalizeAwards(settlement, contribution, validPlayerIds) {
    if (!Array.isArray(settlement.awards)) return { supported: false, awards: [], reason: 'settlement_awards_missing' };
    var seen = new Set();
    var awards = [];
    var invalid = null;
    settlement.awards.forEach(function (award) {
      if (awardIsReturn(award)) return;
      if (!award || !validPlayerIds.has(String(award.playerId || '')) || !numeric(award.amount) || award.amount <= 0) {
        invalid = clone(award || null);
        return;
      }
      var key = awardIdentity(award);
      if (seen.has(key)) {
        contribution.hand.duplicateAwardRecordsIgnored += 1;
        return;
      }
      seen.add(key);
      awards.push(clone(award));
    });
    if (contribution.hand.duplicateAwardRecordsIgnored) {
      addAmbiguity(contribution, AMBIGUITY_CODES.DUPLICATE_AWARD_RECORD, 'Exact duplicate settlement award records were ignored rather than summed twice.', { duplicateCount: contribution.hand.duplicateAwardRecordsIgnored });
    }
    if (invalid) return { supported: false, awards: awards, reason: 'settlement_award_record_malformed', evidence: invalid };
    var total = awards.reduce(function (sum, award) { return sum + award.amount; }, 0);
    if (numeric(settlement.totalAwardAmount) && !almostEqual(total, settlement.totalAwardAmount)) {
      return { supported: false, awards: awards, reason: 'deduplicated_awards_disagree_with_total_award_amount', evidence: { awardTotal: total, settlementTotal: settlement.totalAwardAmount } };
    }
    return { supported: true, awards: awards, total: total };
  }

  function returnTotals(settlement, validPlayerIds) {
    if (!Array.isArray(settlement.refunds) || !Array.isArray(settlement.awards)) {
      return { supported: false, reason: 'settlement_return_records_missing' };
    }
    var totals = {};
    Array.from(validPlayerIds).forEach(function (playerId) { totals[playerId] = 0; });
    var seen = new Set();
    var invalid = null;
    settlement.refunds.concat(settlement.awards.filter(awardIsReturn)).forEach(function (record) {
      var playerId = record && record.playerId !== null && record.playerId !== undefined ? String(record.playerId) : '';
      if (!validPlayerIds.has(playerId) || !numeric(record && record.amount) || record.amount < 0) {
        invalid = clone(record || null);
        return;
      }
      var key = awardIdentity(record);
      if (seen.has(key)) return;
      seen.add(key);
      totals[playerId] += record.amount;
    });
    return invalid ? { supported: false, reason: 'settlement_return_record_malformed', evidence: invalid } : { supported: true, totals: totals };
  }

  function perPlayerAwardTotals(awards, playerIds) {
    var totals = {};
    playerIds.forEach(function (playerId) { totals[playerId] = 0; });
    awards.forEach(function (award) {
      if (Object.prototype.hasOwnProperty.call(totals, String(award.playerId))) totals[String(award.playerId)] += award.amount;
    });
    return totals;
  }

  function completePotModel(settlement, reachedIds, globalAwards) {
    if (!Array.isArray(settlement.pots) || !settlement.pots.length) return null;
    var reached = new Set(reachedIds);
    var seenPots = new Set();
    var globalTotals = perPlayerAwardTotals(globalAwards, reachedIds);
    var potTotals = perPlayerAwardTotals([], reachedIds);
    var counters = {};
    reachedIds.forEach(function (playerId) { counters[playerId] = { eligible: 0, won: 0, tied: 0, lost: 0 }; });
    var reason = null;
    var evidence = null;
    settlement.pots.forEach(function (pot) {
      if (reason) return;
      var potId = pot && pot.potId !== null && pot.potId !== undefined ? String(pot.potId) : '';
      var eligible = uniqueStrings(pot && pot.eligiblePlayerIds || []);
      var awards = Array.isArray(pot && pot.awards) ? pot.awards.filter(function (award) { return !awardIsReturn(award); }) : [];
      if (!potId || seenPots.has(potId) || !numeric(pot.amount) || pot.amount <= 0 || eligible.length < 2 || eligible.some(function (id) { return !reached.has(id); })) {
        reason = 'pot_identity_amount_or_eligibility_is_incomplete';
        evidence = clone(pot || null);
        return;
      }
      seenPots.add(potId);
      var recipients = [];
      var allocated = 0;
      awards.forEach(function (award) {
        var playerId = award && award.playerId !== null && award.playerId !== undefined ? String(award.playerId) : '';
        if (!eligible.includes(playerId) || !numeric(award.amount) || award.amount <= 0) {
          reason = 'pot_award_recipient_or_amount_is_invalid';
          evidence = clone(award || null);
          return;
        }
        allocated += award.amount;
        potTotals[playerId] += award.amount;
        recipients.push(playerId);
      });
      if (reason) return;
      recipients = uniqueStrings(recipients);
      if (!recipients.length || !almostEqual(allocated, pot.amount)) {
        reason = 'pot_awards_do_not_exactly_allocate_the_pot';
        evidence = { potId: potId, potAmount: pot.amount, allocated: allocated };
        return;
      }
      eligible.forEach(function (playerId) {
        counters[playerId].eligible += 1;
        if (!recipients.includes(playerId)) counters[playerId].lost += 1;
        else if (recipients.length === 1) counters[playerId].won += 1;
        else counters[playerId].tied += 1;
      });
    });
    if (!reason && reachedIds.some(function (playerId) { return !almostEqual(globalTotals[playerId], potTotals[playerId]); })) {
      reason = 'pot_awards_disagree_with_aggregate_settlement_awards';
      evidence = { aggregateAwards: globalTotals, potAwards: potTotals };
    }
    return reason ? { supported: false, reason: reason, evidence: evidence } : { supported: true, counters: counters, model: 'explicit_pots' };
  }

  function singlePotModel(settlement, reachedIds, awards) {
    if (settlement.sidePotStatus !== false) return { supported: false, reason: 'single_or_side_pot_eligibility_not_explicit' };
    var totals = perPlayerAwardTotals(awards, reachedIds);
    var recipients = reachedIds.filter(function (playerId) { return totals[playerId] > 0; });
    if (!recipients.length) return { supported: false, reason: 'supported_contested_pot_has_no_positive_recipient' };
    if ((recipients.length > 1) !== (settlement.chopped === true)) return { supported: false, reason: 'chop_flag_disagrees_with_positive_recipient_count' };
    var counters = {};
    reachedIds.forEach(function (playerId) {
      counters[playerId] = {
        eligible: 1,
        won: recipients.length === 1 && recipients[0] === playerId ? 1 : 0,
        tied: recipients.length > 1 && recipients.includes(playerId) ? 1 : 0,
        lost: recipients.includes(playerId) ? 0 : 1
      };
    });
    return { supported: true, counters: counters, model: 'explicit_single_pot' };
  }

  function classifyOutcome(counter) {
    if (!counter || counter.eligible < 1) return 'unsupported';
    var categories = Number(counter.won > 0) + Number(counter.tied > 0) + Number(counter.lost > 0);
    if (categories > 1) return 'mixed';
    if (counter.won > 0) return 'win';
    if (counter.tied > 0) return 'tie';
    if (counter.lost > 0) return 'loss';
    return 'unsupported';
  }

  function exactNetResult(settlement, playerId, grossAward) {
    var row = settlement.reconciliation && settlement.reconciliation[playerId];
    if (!row || row.reconciled !== true || !numeric(row.startingStack) || !numeric(row.endingStack) || !numeric(row.committed) || !numeric(row.award) || !numeric(row.refund)) return null;
    if (!almostEqual(row.award, grossAward)) return null;
    var expectedEnding = row.startingStack - row.committed + row.award + row.refund;
    return almostEqual(expectedEnding, row.endingStack) ? row.endingStack - row.startingStack : null;
  }

  function deriveOutcomes(record, contribution) {
    var reachedIds = Object.keys(contribution.players).filter(function (playerId) { return contribution.players[playerId].wentToShowdown === 1; });
    Object.keys(contribution.players).forEach(function (playerId) {
      var player = contribution.players[playerId];
      if (player.wentToShowdown === 0) player.wonMoneyAtShowdownCandidateReason = 'player_did_not_reach_supported_showdown';
      else if (player.wentToShowdown === null) player.wonMoneyAtShowdownCandidateReason = 'showdown_membership_unsupported';
    });
    if (!reachedIds.length) return;
    var settlement = record.settlement || {};
    if (settlement.status !== 'known') {
      reachedIds.forEach(function (playerId) {
        markPlayerUnsupported(contribution.players[playerId], 'settlement_unresolved', true);
        contribution.players[playerId].wonMoneyAtShowdownCandidateReason = 'settlement_unresolved';
      });
      addAmbiguity(contribution, AMBIGUITY_CODES.SETTLEMENT_UNRESOLVED, 'Showdown membership was supported, but monetary settlement was unavailable.', null);
      return;
    }
    if (settlement.uncontested !== false) {
      reachedIds.forEach(function (playerId) {
        markPlayerUnsupported(contribution.players[playerId], 'contested_settlement_not_supported', true);
        contribution.players[playerId].wonMoneyAtShowdownCandidateReason = 'contested_settlement_not_supported';
      });
      addAmbiguity(contribution, AMBIGUITY_CODES.SHOWDOWN_CONTEST_UNSUPPORTED, 'A reached-showdown outcome requires an explicitly contested settlement.', { uncontested: settlement.uncontested });
      return;
    }
    var normalized = normalizeAwards(settlement, contribution, new Set(Object.keys(contribution.players)));
    if (!normalized.supported) {
      reachedIds.forEach(function (playerId) {
        markPlayerUnsupported(contribution.players[playerId], normalized.reason, true);
        contribution.players[playerId].wonMoneyAtShowdownCandidateReason = normalized.reason;
      });
      addAmbiguity(contribution, AMBIGUITY_CODES.SETTLEMENT_AWARD_UNSUPPORTED, 'Settlement awards were missing, malformed, duplicated inconsistently, or disagreed with their aggregate.', normalized.evidence || null);
      return;
    }
    var reachedSet = new Set(reachedIds);
    var outsideShowdownAward = normalized.awards.find(function (award) { return !reachedSet.has(String(award.playerId)); });
    if (outsideShowdownAward) {
      reachedIds.forEach(function (playerId) {
        markPlayerUnsupported(contribution.players[playerId], 'positive_award_recipient_not_in_supported_showdown', true);
        contribution.players[playerId].wonMoneyAtShowdownCandidateReason = 'positive_award_recipient_not_in_supported_showdown';
      });
      addAmbiguity(contribution, AMBIGUITY_CODES.SETTLEMENT_AWARD_UNSUPPORTED, 'A positive non-return award belonged to a player outside the supported showdown membership.', outsideShowdownAward);
      return;
    }
    var gross = perPlayerAwardTotals(normalized.awards, reachedIds);
    var returns = returnTotals(settlement, new Set(Object.keys(contribution.players)));
    reachedIds.forEach(function (playerId) {
      contribution.players[playerId].showdownGrossAward = gross[playerId];
      contribution.players[playerId].contestedGrossAward = gross[playerId];
      contribution.players[playerId].showdownNetResult = exactNetResult(settlement, playerId, gross[playerId]);
      contribution.players[playerId].evidence.settlement = normalized.awards.filter(function (award) { return String(award.playerId) === playerId; });
      if (!returns.supported) {
        contribution.players[playerId].wonMoneyAtShowdownCandidateReason = returns.reason;
        return;
      }
      contribution.players[playerId].excludedReturnAmount = returns.totals[playerId];
      contribution.players[playerId].wonMoneyAtShowdownCandidate = gross[playerId] > 0 ? 1 : 0;
      contribution.players[playerId].wonMoneyAtShowdownCandidateSupported = true;
      contribution.players[playerId].wonMoneyAtShowdownCandidateReason = gross[playerId] > 0
        ? 'positive_proven_contested_award'
        : 'complete_contested_settlement_proves_no_award';
    });
    if (!returns.supported) addAmbiguity(contribution, AMBIGUITY_CODES.SETTLEMENT_AWARD_UNSUPPORTED, 'Return/refund evidence was incomplete or malformed, so the provisional binary W$SD candidate remained unsupported.', returns.evidence || { reason: returns.reason });

    var potModel = completePotModel(settlement, reachedIds, normalized.awards) || singlePotModel(settlement, reachedIds, normalized.awards);
    if (!potModel.supported) {
      var explicitIncompletePotSettlement = settlement.sidePotStatus === true || Array.isArray(settlement.pots) && settlement.pots.length > 0;
      reachedIds.forEach(function (playerId) {
        var player = contribution.players[playerId];
        if (explicitIncompletePotSettlement) {
          player.wonMoneyAtShowdownCandidate = null;
          player.wonMoneyAtShowdownCandidateSupported = false;
          player.wonMoneyAtShowdownCandidateReason = potModel.reason;
        }
        markPlayerUnsupported(player, potModel.reason, true);
      });
      addAmbiguity(contribution, AMBIGUITY_CODES.POT_ELIGIBILITY_UNSUPPORTED, 'Gross awards were preserved, but complete eligible-pot ownership was unavailable.', potModel.evidence || { sidePotStatus: settlement.sidePotStatus });
      return;
    }
    contribution.hand.potModel = potModel.model;
    reachedIds.forEach(function (playerId) {
      var player = contribution.players[playerId];
      var counter = potModel.counters[playerId];
      player.potsEligible = counter.eligible;
      player.potsWon = counter.won;
      player.potsTied = counter.tied;
      player.potsLost = counter.lost;
      player.showdownOutcome = classifyOutcome(counter);
      player.outcomeSupported = player.showdownOutcome !== 'unsupported';
      player.supported = player.wtsdSupported && player.outcomeSupported;
      player.unsupportedReason = player.supported ? null : 'showdown_outcome_not_classifiable';
    });
  }

  function deriveContribution(record) {
    var contribution = contributionShell(record || {});
    if (!isObject(record) || record.status !== 'finalized' || !handAliases(record).length || !Array.isArray(record.players) || !Array.isArray(record.actions) || !isObject(record.streets)) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.HAND_RECORD_MALFORMED, 'A finalized semantic record with exact identity, players, ordered actions, and streets is required.', null);
    }
    if (record.schemaVersion !== 1) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.SOURCE_SCHEMA_UNSUPPORTED, 'The semantic ledger schema version is unsupported.', { sourceLedgerSchemaVersion: record.schemaVersion });
    }
    var indexed = playersById(record);
    if (indexed.duplicate || Object.keys(indexed.map).length !== record.players.length || !record.players.length) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.PLAYER_IDENTITY_UNSUPPORTED, 'Stable player identities must be present and unique.', { duplicatePlayerId: indexed.duplicate });
    }
    var incomplete = !record.provenance || record.provenance.historyComplete !== true || record.provenance.recovered === true ||
      (record.ambiguities || []).some(function (entry) { return entry && (entry.code === 'PARTIAL_HISTORY_AFTER_RECOVERY' || entry.code === 'OBSERVATION_LIMIT_REACHED'); });
    if (incomplete) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.HISTORY_INCOMPLETE, 'Complete, non-recovered semantic history is required for showdown decisions.', { historyComplete: record.provenance && record.provenance.historyComplete, recovered: record.provenance && record.provenance.recovered });
    }
    if (!actionOrderingSupported(record)) {
      return setAllUnknown(contribution, AMBIGUITY_CODES.ACTION_ORDER_UNSUPPORTED, 'Ordered, non-recovered action evidence is required.', null);
    }
    deriveWTSD(record, contribution, indexed.map);
    deriveOutcomes(record, contribution);
    return contribution;
  }

  function createState(options) {
    options = options || {};
    var seeded = uniqueStrings((options.reducedHandIds || []).concat(options.finalizedHandIds || []));
    var maxIdentityAliases = boundedInteger(options.maxIdentityAliases, DEFAULT_MAX_IDENTITY_ALIASES, 10, 2000);
    var retainedSeeded = seeded.slice(-maxIdentityAliases);
    return {
      schemaVersion: SCHEMA_VERSION,
      mode: MODE,
      maxRecords: boundedInteger(options.maxRecords, DEFAULT_MAX_RECORDS, 1, 200),
      maxAttempts: boundedInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 10, 300),
      maxPlayers: boundedInteger(options.maxPlayers, DEFAULT_MAX_PLAYERS, 10, 1000),
      maxIdentityAliases: maxIdentityAliases,
      maxAttachments: boundedInteger(options.maxAttachments, DEFAULT_MAX_ATTACHMENTS, 10, 500),
      contributionRecords: [],
      reductionAttempts: [],
      reducedHandIds: new Set(retainedSeeded),
      reducedHandOrder: retainedSeeded.slice(),
      identityAliasEvictions: Math.max(0, seeded.length - retainedSeeded.length),
      attachmentRecords: [],
      attachedContributionIds: new Set(),
      attachedContributionOrder: [],
      attachmentSequence: 0,
      attachmentIdentityEvictions: 0,
      seededFinalizedHandCount: seeded.length,
      reducedHandCount: 0,
      reductionSequence: 0,
      totalsByPlayer: {},
      playerOrder: [],
      playerEvictions: 0
    };
  }

  function rememberBounded(set, order, value, limit) {
    if (set.has(value)) {
      var existingIndex = order.indexOf(value);
      if (existingIndex >= 0) order.splice(existingIndex, 1);
    } else set.add(value);
    order.push(value);
    var evicted = 0;
    while (order.length > limit) {
      set.delete(order.shift());
      evicted += 1;
    }
    return evicted;
  }

  function recordAttempt(state, attempt) {
    state.reductionSequence += 1;
    pushBounded(state.reductionAttempts, Object.assign({ sequence: state.reductionSequence, accepted: false, duplicate: false }, clone(attempt || {})), state.maxAttempts);
  }

  function ensurePlayerTotal(state, playerId, contribution) {
    if (state.totalsByPlayer[playerId]) {
      state.playerOrder = state.playerOrder.filter(function (id) { return id !== playerId; });
      state.playerOrder.push(playerId);
      return state.totalsByPlayer[playerId];
    }
    if (state.playerOrder.length >= state.maxPlayers) {
      var evicted = state.playerOrder.shift();
      delete state.totalsByPlayer[evicted];
      state.playerEvictions += 1;
      addAmbiguity(contribution, AMBIGUITY_CODES.PLAYER_TOTAL_LIMIT_REACHED, 'The bounded player-total limit evicted the least recently observed aggregate.', { evictedPlayerId: evicted });
    }
    state.playerOrder.push(playerId);
    state.totalsByPlayer[playerId] = {
      wtsdOpportunities: 0,
      wentToShowdown: 0,
      showdownOpportunities: 0,
      wonMoneyAtShowdownCandidates: 0,
      wonMoneyAtShowdownCandidateOpportunities: 0,
      outcomes: { win: 0, loss: 0, tie: 0, mixed: 0, unsupported: 0 },
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
      if (player.wtsdOpportunityCount === 1) {
        total.wtsdOpportunities += 1;
        total.wentToShowdown += player.wtsdCount;
        contributed = true;
      }
      if (player.showdownOpportunityCount === 1) {
        total.showdownOpportunities += 1;
        var outcome = player.showdownOutcome || 'unsupported';
        if (Object.prototype.hasOwnProperty.call(total.outcomes, outcome)) total.outcomes[outcome] += 1;
        else total.outcomes.unsupported += 1;
      }
      if (player.wonMoneyAtShowdownCandidateSupported === true) {
        total.wonMoneyAtShowdownCandidateOpportunities += 1;
        total.wonMoneyAtShowdownCandidates += player.wonMoneyAtShowdownCandidate;
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
      recordAttempt(state, { reason: 'finalized hand identity is required' });
      return { reduced: false, duplicate: false, reason: 'finalized hand identity is required' };
    }
    var duplicateAlias = aliases.find(function (alias) { return state.reducedHandIds.has(alias); });
    if (duplicateAlias) {
      recordAttempt(state, { duplicate: true, handId: handId, aliases: aliases, matchedAlias: duplicateAlias, reason: 'finalized hand was already reduced' });
      return { reduced: false, duplicate: true, previouslyReduced: true, handId: handId };
    }
    var inputBefore = JSON.stringify(finalizedRecord);
    var contribution = deriveContribution(finalizedRecord);
    if (JSON.stringify(finalizedRecord) !== inputBefore) throw new Error('showdown reducer mutated its finalized semantic input');
    aliases.forEach(function (alias) {
      state.identityAliasEvictions += rememberBounded(state.reducedHandIds, state.reducedHandOrder, alias, state.maxIdentityAliases);
    });
    state.reducedHandCount += 1;
    applyContribution(state, contribution);
    pushBounded(state.contributionRecords, clone(contribution), state.maxRecords);
    recordAttempt(state, { accepted: true, handId: handId, aliases: aliases, ambiguityCodes: contribution.ambiguities.map(function (entry) { return entry.code; }) });
    return { reduced: true, duplicate: false, handId: handId, contribution: clone(contribution) };
  }

  function shadowFields(player) {
    return {
      sawFlopForWTSD: player.sawFlopForWTSD,
      wentToShowdown: player.wentToShowdown,
      showdownOutcome: player.showdownOutcome,
      outcomeSupported: player.outcomeSupported,
      wonMoneyAtShowdownCandidate: player.wonMoneyAtShowdownCandidate,
      wonMoneyAtShowdownCandidateSupported: player.wonMoneyAtShowdownCandidateSupported,
      wonMoneyAtShowdownCandidateReason: player.wonMoneyAtShowdownCandidateReason,
      contestedGrossAward: player.contestedGrossAward,
      excludedReturnAmount: player.excludedReturnAmount,
      unsupportedReason: player.unsupportedReason
    };
  }

  function recordAttachment(state, record) {
    state.attachmentSequence += 1;
    var stored = Object.assign({ sequence: state.attachmentSequence, attached: false, duplicate: false, skipped: false }, clone(record || {}));
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
    var inputBefore = JSON.stringify(events.slice(rangeStart, rangeStart + rangeLength));
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
      var contributionId = ['showdown-shadow', Number(contribution.reducerVersion || contribution.schemaVersion || SCHEMA_VERSION), aliases[0], playerId].join(':');
      if (state.attachedContributionIds.has(contributionId)) {
        duplicateCount += 1;
        results.push(recordAttachment(state, { contributionId: contributionId, playerId: playerId, duplicate: true, skipped: true, reason: 'shadow contribution was already associated', candidateHandIds: aliases, fields: shadowFields(contribution.players[playerId]) }));
        return;
      }
      var targetIndex = matchingIndexes.find(function (index) { return String(events[index] && events[index].playerId || '') === playerId; });
      if (targetIndex === undefined) {
        missingPlayerIds.push(playerId);
        results.push(recordAttachment(state, { contributionId: contributionId, playerId: playerId, skipped: true, reason: matchingIndexes.length ? 'stable player ID did not match a finalized event' : 'no finalized event matched lifecycle or authoritative hand identity', candidateHandIds: aliases, fields: shadowFields(contribution.players[playerId]) }));
        return;
      }
      var target = events[targetIndex];
      state.attachmentIdentityEvictions += rememberBounded(state.attachedContributionIds, state.attachedContributionOrder, contributionId, state.maxAttachments);
      attachedCount += 1;
      results.push(recordAttachment(state, {
        contributionId: contributionId,
        targetEventId: String(target.eventKey || target.eventId || String(target.handId) + ':' + playerId + ':' + targetIndex),
        targetEventIndex: targetIndex,
        targetHandId: String(target.handId),
        playerId: playerId,
        attached: true,
        candidateHandIds: aliases,
        fields: shadowFields(contribution.players[playerId])
      }));
    });
    if (JSON.stringify(events.slice(rangeStart, rangeStart + rangeLength)) !== inputBefore) throw new Error('showdown shadow association mutated finalized statistics events');
    return { attachedCount: attachedCount, duplicateCount: duplicateCount, missingPlayerIds: missingPlayerIds, attachmentResults: clone(results) };
  }

  function inspect(state) {
    return {
      schemaVersion: SCHEMA_VERSION,
      mode: MODE,
      bounds: { maxContributionRecords: state.maxRecords, maxReductionAttempts: state.maxAttempts, maxPlayers: state.maxPlayers, maxIdentityAliases: state.maxIdentityAliases, maxAttachmentRecords: state.maxAttachments },
      coverage: { seededFinalizedHandCount: state.seededFinalizedHandCount, reducedHandCount: state.reducedHandCount, trackedIdentityAliasCount: state.reducedHandIds.size, identityAliasEvictions: state.identityAliasEvictions, trackedPlayerCount: state.playerOrder.length, playerEvictions: state.playerEvictions, attachedContributionCount: state.attachedContributionIds.size, attachmentAttemptCount: state.attachmentSequence, attachmentIdentityEvictions: state.attachmentIdentityEvictions },
      reducedHandIds: Array.from(state.reducedHandIds),
      contributionRecords: clone(state.contributionRecords),
      attachmentRecords: clone(state.attachmentRecords),
      reductionAttempts: clone(state.reductionAttempts),
      totalsByPlayer: clone(state.totalsByPlayer)
    };
  }

  var api = Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    MODE: MODE,
    AMBIGUITY_CODES: AMBIGUITY_CODES,
    deriveContribution: deriveContribution,
    createState: createState,
    reduce: reduce,
    attach: attach,
    inspect: inspect
  });
  root.PokerShowdownStatsReducer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
