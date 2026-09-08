/* Authoritative Big Blind identity and finalized-walk classification. */
(function (root) {
  'use strict';

  function validPlayerId(value) {
    return value !== null && value !== undefined && String(value) !== '' && String(value) !== '<D>';
  }

  function blindTypeForPlayer(playerId, smallBlindPlayerId, bigBlindPlayerId) {
    if (validPlayerId(bigBlindPlayerId) && String(playerId) === String(bigBlindPlayerId)) return 'big';
    if (validPlayerId(smallBlindPlayerId) && String(playerId) === String(smallBlindPlayerId)) return 'small';
    return null;
  }

  function createInitialHandEvent(options) {
    options = options || {};
    var deduction = options.blindDeduction || null;
    var blindType = blindTypeForPlayer(options.playerId, options.smallBlindPlayerId, options.bigBlindPlayerId);
    return {
      handId: String(options.handId),
      playerId: String(options.playerId),
      player: options.player,
      action: blindType ? 'blind' : 'dealt',
      street: 'preflop',
      amount: deduction ? Number(deduction.amount || 0) : 0,
      blindType: blindType,
      timestamp: Number(options.timestamp || Date.now())
    };
  }

  function orderedHandActions(handEvents) {
    return handEvents.slice().sort(function (left, right) { return Number(left.timestamp || 0) - Number(right.timestamp || 0); }).map(function (event) {
      return { playerId: event.playerId || null, player: event.player, action: event.action, street: event.street, blindType: event.blindType || null, timestamp: event.timestamp };
    });
  }

  function detectBigBlindWalk(handEvents, playerName) {
    var bigBlind = handEvents.find(function (event) { return event.player === playerName && event.action === 'blind' && event.blindType === 'big'; });
    if (!bigBlind) return { applicable: false, isWalk: false, reason: 'player is not the verified big blind' };
    var participants = Array.from(new Set(handEvents.map(function (event) { return event.player; }).filter(Boolean)));
    var otherPlayers = participants.filter(function (player) { return player !== playerName; });
    var bigBlindDecisions = handEvents.filter(function (event) {
      return event.player === playerName && event.street === 'preflop' && event.action !== 'blind' && event.action !== 'dealt';
    });
    var folds = otherPlayers.filter(function (player) {
      return handEvents.some(function (event) { return event.player === player && event.street === 'preflop' && event.action === 'fold'; });
    });
    var otherVoluntaryActions = handEvents.filter(function (event) {
      return event.player !== playerName && event.street === 'preflop' && (event.action === 'call' || event.action === 'bet' || event.action === 'raise' || event.action === 'check');
    });
    var postflopActions = handEvents.filter(function (event) { return event.street !== 'preflop' && event.action !== 'dealt'; });
    var reason = null;
    if (!otherPlayers.length) reason = 'no other eligible participant was recorded';
    else if (bigBlindDecisions.length) reason = 'big blind received a decision and acted: ' + bigBlindDecisions.map(function (event) { return event.action; }).join(', ');
    else if (folds.length !== otherPlayers.length) reason = 'not every other eligible player folded';
    else if (otherVoluntaryActions.length) reason = 'another player made a voluntary preflop action before folding';
    else if (postflopActions.length) reason = 'the hand continued beyond preflop';
    return {
      applicable: true,
      isWalk: !reason,
      reason: reason || 'all other eligible players folded before the big blind received a voluntary decision',
      handId: bigBlind.handId,
      bigBlindPlayerId: bigBlind.playerId || null,
      bigBlindPlayer: playerName,
      participants: participants,
      dealtInPlayerIds: Array.from(new Set(handEvents.map(function (event) { return event.playerId; }).filter(validPlayerId).map(String))),
      eligiblePreflopPlayerIds: Array.from(new Set(handEvents.filter(function (event) { return event.street === 'preflop'; }).map(function (event) { return event.playerId; }).filter(validPlayerId).map(String))),
      folds: folds,
      foldSequence: orderedHandActions(handEvents).filter(function (event) { return event.street === 'preflop' && event.action === 'fold'; }),
      voluntaryPreflopActions: orderedHandActions(handEvents).filter(function (event) {
        return event.street === 'preflop' && (event.action === 'call' || event.action === 'bet' || event.action === 'raise' || event.action === 'check');
      }),
      bigBlindReceivedDecision: bigBlindDecisions.length > 0,
      actionOrder: orderedHandActions(handEvents)
    };
  }

  function settlementWinnerIds(settlement, participantIds) {
    var participants = new Set((participantIds || []).map(String));
    var winners = new Set();
    function visit(value, depth) {
      if (!value || typeof value !== 'object' || depth > 7) return;
      Object.keys(value).forEach(function (key) {
        var result = value[key];
        if (participants.has(String(key)) && result && typeof result === 'object') {
          if (Number(result.position) === 1 || Number(result.rank) === 1 || Number(result.gained) > 0 || result.winner === true || result.won === true) winners.add(String(key));
        }
        visit(result, depth + 1);
      });
    }
    visit(settlement, 0);
    return Array.from(winners);
  }

  function rejectedSettlementEvaluation(details, reason) {
    details.isWalk = false;
    details.reason = reason;
    details.inferredFolds = [];
    return details;
  }

  function evaluateSettlementWalk(input) {
    input = input || {};
    var participants = Array.from(new Set((input.participants || []).map(String)));
    var smallBlindId = validPlayerId(input.smallBlindPlayerId) ? String(input.smallBlindPlayerId) : null;
    var bigBlindId = validPlayerId(input.bigBlindPlayerId) ? String(input.bigBlindPlayerId) : null;
    var stagedEvents = input.stagedEvents || [];
    var previousTb = input.previousTb || {};
    var currentTb = input.currentTb || {};
    var boardCount = Array.isArray(input.boardCards) ? input.boardCards.length : Number(input.boardCardCount || 0);
    var preflopEvents = stagedEvents.filter(function (event) { return event.street === 'preflop'; });
    var explicitFolds = preflopEvents.filter(function (event) { return event.action === 'fold'; });
    var voluntaryActions = preflopEvents.filter(function (event) {
      return event.action === 'call' || event.action === 'bet' || event.action === 'raise' || event.action === 'check';
    });
    var details = {
      handId: input.handId === undefined || input.handId === null ? null : String(input.handId),
      dealtInPlayerIds: participants.slice(),
      eligiblePreflopPlayerIds: participants.slice(),
      foldSequence: explicitFolds.map(function (event) {
        return { playerId: validPlayerId(event.playerId) ? String(event.playerId) : null, player: event.player || null, timestamp: event.timestamp || null };
      }),
      voluntaryPreflopActions: voluntaryActions.map(function (event) {
        return { playerId: validPlayerId(event.playerId) ? String(event.playerId) : null, player: event.player || null, action: event.action, amount: Number(event.amount || 0), timestamp: event.timestamp || null };
      }),
      bigBlindPlayerId: bigBlindId,
      smallBlindPlayerId: smallBlindId,
      settlementWinnerPlayerIds: [],
      missingFoldPlayerIds: [],
      isWalk: false,
      reason: null,
      inferredFolds: []
    };
    if (input.street !== 'preflop') return rejectedSettlementEvaluation(details, 'settlement occurred after preflop');
    if (boardCount !== 0) return rejectedSettlementEvaluation(details, 'community cards were present');
    if (input.showdown === true) return rejectedSettlementEvaluation(details, 'showdown evidence was present');
    if (participants.length < 2) return rejectedSettlementEvaluation(details, 'fewer than two eligible preflop participants were recorded');
    if (!smallBlindId || !bigBlindId || smallBlindId === bigBlindId) return rejectedSettlementEvaluation(details, 'verified distinct blind identities were unavailable');
    if (!participants.includes(smallBlindId) || !participants.includes(bigBlindId)) return rejectedSettlementEvaluation(details, 'verified blind identities were absent from the eligible participant set');
    var smallBlindEvent = stagedEvents.find(function (event) { return String(event.playerId) === smallBlindId && event.action === 'blind' && event.blindType === 'small'; });
    var bigBlindEvent = stagedEvents.find(function (event) { return String(event.playerId) === bigBlindId && event.action === 'blind' && event.blindType === 'big'; });
    if (!smallBlindEvent || !bigBlindEvent) return rejectedSettlementEvaluation(details, 'verified forced-blind events were unavailable');
    var missingInitialEvidence = participants.filter(function (playerId) {
      return !preflopEvents.some(function (event) {
        return String(event.playerId) === playerId && (event.action === 'dealt' || event.action === 'blind' || event.action === 'fold');
      });
    });
    if (missingInitialEvidence.length) return rejectedSettlementEvaluation(details, 'eligible participant lacks dealt, blind, or explicit-fold evidence: ' + missingInitialEvidence.join(', '));
    if (stagedEvents.some(function (event) { return event.street !== 'preflop'; })) return rejectedSettlementEvaluation(details, 'the hand continued beyond preflop');
    if (voluntaryActions.length) return rejectedSettlementEvaluation(details, 'voluntary preflop action was recorded: ' + voluntaryActions.map(function (event) { return event.action; }).join(', '));
    if (input.bigBlindCheck === true) return rejectedSettlementEvaluation(details, 'the big blind received and checked an option');
    var bigBlindDecisions = preflopEvents.filter(function (event) {
      return String(event.playerId) === bigBlindId && event.action !== 'blind' && event.action !== 'dealt';
    });
    if (bigBlindDecisions.length) return rejectedSettlementEvaluation(details, 'the big blind took a voluntary preflop action');
    if (!(typeof previousTb[smallBlindId] === 'number' && previousTb[smallBlindId] > 0 && typeof previousTb[bigBlindId] === 'number' && previousTb[bigBlindId] > previousTb[smallBlindId])) {
      return rejectedSettlementEvaluation(details, 'the prior forced-blind commitment signature was not verified');
    }
    if (currentTb[smallBlindId] !== '<D>' || currentTb[bigBlindId] !== '<D>') {
      return rejectedSettlementEvaluation(details, 'the settlement commitment cleanup signature was not verified');
    }
    var winners = settlementWinnerIds(input.settlement, participants);
    details.settlementWinnerPlayerIds = winners;
    if (winners.length !== 1 || winners[0] !== bigBlindId) return rejectedSettlementEvaluation(details, 'the big blind was not the sole settlement winner');
    var foldedIds = new Set(explicitFolds.map(function (event) { return validPlayerId(event.playerId) ? String(event.playerId) : null; }).filter(Boolean));
    var nonBigBlindIds = participants.filter(function (playerId) { return playerId !== bigBlindId; });
    var missingFoldIds = nonBigBlindIds.filter(function (playerId) { return !foldedIds.has(playerId); });
    details.missingFoldPlayerIds = missingFoldIds.slice();
    var missingNames = [];
    var inferredFolds = missingFoldIds.map(function (playerId) {
      var playerRecord = input.players && input.players[playerId] || {};
      var stagedPlayerEvent = stagedEvents.find(function (event) { return String(event.playerId) === playerId && event.player; });
      var playerName = playerRecord.name || playerRecord.playerName || stagedPlayerEvent && stagedPlayerEvent.player;
      if (!playerName) {
        missingNames.push(playerId);
        return null;
      }
      return {
        handId: String(input.handId),
        playerId: playerId,
        player: String(playerName),
        action: 'fold',
        street: 'preflop',
        amount: 0,
        timestamp: Number(input.timestamp || Date.now()),
        eventKey: 'settlement-fold-evidence|' + String(input.handId) + '|' + playerId,
        evidence: {
          source: 'walkDetection.inferSettlementFolds',
          kind: 'verified preflop walk settlement fold',
          eligiblePlayerCount: participants.length,
          previousTb: { smallBlind: previousTb[smallBlindId], bigBlind: previousTb[bigBlindId] },
          currentTb: { smallBlind: currentTb[smallBlindId], bigBlind: currentTb[bigBlindId] },
          soleWinnerPlayerId: bigBlindId
        }
      };
    }).filter(Boolean);
    if (missingNames.length) return rejectedSettlementEvaluation(details, 'mapped names were unavailable for eligible players: ' + missingNames.join(', '));
    details.isWalk = true;
    details.reason = 'verified preflop settlement awarded the pot solely to the big blind with no voluntary action';
    details.inferredFolds = inferredFolds;
    return details;
  }

  function inferSettlementFolds(input) {
    return evaluateSettlementWalk(input).inferredFolds;
  }

  function inferHeadsUpSettlementFold(input) {
    var participants = Array.from(new Set(((input || {}).participants || []).map(String)));
    if (participants.length !== 2) return null;
    return inferSettlementFolds(input)[0] || null;
  }

  var api = Object.freeze({
    blindTypeForPlayer: blindTypeForPlayer,
    createInitialHandEvent: createInitialHandEvent,
    detectBigBlindWalk: detectBigBlindWalk,
    evaluateSettlementWalk: evaluateSettlementWalk,
    inferSettlementFolds: inferSettlementFolds,
    inferHeadsUpSettlementFold: inferHeadsUpSettlementFold
  });
  root.PokerWalkDetection = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
