/* Pure ordered commitment/turn transition classification for the live HUD. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;

  function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function classifyCommitmentTransition(input) {
    var previousCommitment = input.previousCommitment;
    var currentCommitment = input.currentCommitment;
    var previousHighestBet = input.previousHighestBet;
    if (input.forcedBlind) return { accepted: false, action: 'blind', reason: 'forced blind is excluded from voluntary action inference' };
    if (![previousCommitment, currentCommitment, previousHighestBet].every(finiteNumber)) return { accepted: false, action: null, reason: 'missing numeric commitment or highest-bet state' };
    var addedAmount = currentCommitment - previousCommitment;
    if (addedAmount <= 0) return { accepted: false, action: null, reason: 'street commitment did not increase' };
    if (currentCommitment < previousHighestBet) return { accepted: false, action: null, reason: 'commitment remains below the outstanding highest bet' };
    if (previousHighestBet === 0) return { accepted: true, action: 'bet', amount: currentCommitment, addedAmount: addedAmount, amountIsTotalTo: true, reason: 'street commitment rose above zero while the previous highest bet was zero' };
    if (currentCommitment === previousHighestBet) return { accepted: true, action: 'call', amount: addedAmount, addedAmount: addedAmount, amountIsTotalTo: false, reason: 'street commitment increased to exactly match the previous highest bet' };
    return { accepted: true, action: 'raise', amount: currentCommitment, addedAmount: addedAmount, amountIsTotalTo: true, reason: 'street commitment rose above the previous highest bet; amount is raise-to total' };
  }

  function classifyActorTurnEnd(input) {
    if (!input.actorChanged) return { accepted: false, action: null, reason: 'actor did not change' };
    if (input.foldedChanged || input.becameInactive) return { accepted: true, action: 'fold', amount: 0, reason: input.foldedChanged ? 'folded flag changed false to true' : 'active/in-hand flag changed while player was actor' };
    if (input.commitmentsVerified !== true) return { accepted: false, action: null, reason: 'turn changed, but commitments and the outstanding wager are not verified' };
    if (!finiteNumber(input.addedAmount) || !finiteNumber(input.outstandingAmount)) return { accepted: false, action: null, reason: 'missing turn-end commitment state' };
    if (input.addedAmount === 0 && input.outstandingAmount <= 0) return { accepted: true, action: 'check', amount: 0, reason: 'actor turn ended with no chips added and no outstanding bet' };
    if (input.addedAmount === 0 && input.outstandingAmount > 0) return { accepted: false, action: null, reason: 'actor left action order without matching an outstanding bet and no fold flag was available' };
    return { accepted: false, action: null, reason: 'turn transition is already represented by a commitment action' };
  }

  function nextStreet(street) {
    return { preflop: 'flop', flop: 'turn', turn: 'river', river: 'river' }[street] || 'preflop';
  }

  function isCleanupValue(value) {
    return value === undefined || value === null || value === '<D>';
  }

  function isCheckValue(value) {
    return typeof value === 'string' && value.toLowerCase() === 'check';
  }

  function isFoldValue(value) {
    return typeof value === 'string' && /^(?:fold|folded)$/i.test(value);
  }

  function isPlausibleBlindPair(tB, smallBlindPlayerId, bigBlindPlayerId) {
    if (!smallBlindPlayerId || !bigBlindPlayerId) return false;
    var smallBlind = tB[smallBlindPlayerId];
    var bigBlind = tB[bigBlindPlayerId];
    return finiteNumber(smallBlind) && finiteNumber(bigBlind) && smallBlind > 0 && bigBlind > smallBlind && bigBlind / smallBlind >= 1.5 && bigBlind / smallBlind <= 3;
  }

  function createTbTracker(options) {
    options = options || {};
    return {
      street: options.street || 'preflop',
      patchIndex: 0,
      values: {},
      commitments: {},
      highestWager: 0,
      stacks: {},
      pending: [],
      blindsInitialized: false,
      schemaConfirmed: options.schemaConfirmed === true,
      maxPatchDistance: options.maxPatchDistance || 8,
      maxWindowMs: options.maxWindowMs || 5000
    };
  }

  function processTbPatch(tracker, patch) {
    tracker.patchIndex += 1;
    var events = [];
    var candidates = [];
    var diagnostics = [];
    var gates = [];
    var tB = patch.tB || {};
    var players = patch.players || {};
    var playerIds = Array.from(new Set(Object.keys(tB).concat(Object.keys(players))));
    var roundPlayers = Array.isArray(patch.cRPI) ? patch.cRPI.map(String) : [];
    var actor = patch.cPI || patch.pITT || null;
    var settlement = Boolean(patch.settlement);

    function candidate(base) {
      var value = Object.assign({ recordId: patch.recordId, timestamp: patch.timestamp, street: tracker.street }, base);
      candidates.push(value);
      return value;
    }

    function emitPending(pending, evidence) {
      if (pending.emitted) return;
      pending.emitted = true;
      events.push({
        playerId: pending.playerId,
        action: pending.action,
        street: pending.street,
        amount: pending.amount,
        addedAmount: pending.addedAmount,
        amountIsTotalTo: pending.amountIsTotalTo,
        timestamp: pending.timestamp,
        evidence: evidence
      });
      candidate({ playerId: pending.playerId, action: pending.action, amount: pending.amount, accepted: true, pending: false, reason: evidence, sourceRecordId: pending.recordId, pendingSnapshot: Object.assign({}, pending) });
    }

    var blindIdsAvailable = isPlausibleBlindPair(tB, patch.sBPI, patch.bBPI);
    if (!tracker.blindsInitialized && blindIdsAvailable) {
      tracker.blindsInitialized = true;
      tracker.commitments[String(patch.sBPI)] = tB[patch.sBPI];
      tracker.commitments[String(patch.bBPI)] = tB[patch.bBPI];
      tracker.highestWager = Math.max(tB[patch.sBPI], tB[patch.bBPI]);
      candidate({ playerId: String(patch.sBPI), action: 'blind', amount: tB[patch.sBPI], accepted: false, forcedBlind: true, reason: 'initial tB value belongs to sBPI and is a forced small blind' });
      candidate({ playerId: String(patch.bBPI), action: 'blind', amount: tB[patch.bBPI], accepted: false, forcedBlind: true, reason: 'initial tB value belongs to bBPI and is a forced big blind' });
      gates.push({ playerId: String(patch.sBPI), previousTb: tracker.values[patch.sBPI], currentTb: tB[patch.sBPI], branch: 'initial-small-blind-seed', candidateCreated: false, voluntaryTransition: false, reason: 'sBPI initial numeric value is a forced blind' });
      gates.push({ playerId: String(patch.bBPI), previousTb: tracker.values[patch.bBPI], currentTb: tB[patch.bBPI], branch: 'initial-big-blind-seed', candidateCreated: false, voluntaryTransition: false, reason: 'bBPI initial numeric value is a forced blind' });
    }

    playerIds.forEach(function (playerId) {
      var currentValue = tB[playerId];
      var previousValue = tracker.values[playerId];
      var playerCommitment = Number(tracker.commitments[playerId] || 0);
      var previousHighest = tracker.highestWager;
      var stackBefore = tracker.stacks[playerId];
      var stackAfter = players[playerId] && players[playerId].stack;
      if (Object.is(currentValue, previousValue)) return;

      diagnostics.push({
        playerId: String(playerId),
        fieldPath: '$.tB.' + playerId,
        previousValue: previousValue,
        currentValue: currentValue,
        previousCommitment: playerCommitment,
        previousHighestWager: previousHighest,
        previousStack: stackBefore,
        currentStack: stackAfter,
        actor: actor,
        roundPlayers: roundPlayers.slice(),
        settlement: settlement
      });

      var isInitialBlind = tracker.blindsInitialized && tracker.patchIndex === 1 && (String(playerId) === String(patch.sBPI) || String(playerId) === String(patch.bBPI));
      if (isInitialBlind) return;
      if (isCheckValue(currentValue)) {
        var outstanding = previousHighest - playerCommitment;
        if (outstanding <= 0 && !settlement) {
          events.push({ playerId: String(playerId), action: 'check', street: tracker.street, amount: 0, addedAmount: 0, amountIsTotalTo: false, timestamp: patch.timestamp, evidence: 'literal tB value "check" with no unmatched tB wager' });
          candidate({ playerId: String(playerId), action: 'check', amount: 0, accepted: true, reason: 'literal tB value "check" with no unmatched tB wager' });
          gates.push({ playerId: String(playerId), previousTb: previousValue, currentTb: currentValue, branch: 'explicit-check-confirmed', candidateCreated: true, voluntaryTransition: true, reason: 'literal check and no unmatched wager' });
        } else {
          candidate({ playerId: String(playerId), action: null, amount: 0, accepted: false, reason: settlement ? 'check token appeared during settlement' : 'literal check conflicts with an unmatched tB wager of ' + outstanding });
          gates.push({ playerId: String(playerId), previousTb: previousValue, currentTb: currentValue, branch: 'explicit-check-rejected', candidateCreated: true, voluntaryTransition: true, reason: settlement ? 'settlement patch' : 'unmatched wager ' + outstanding });
        }
        return;
      }
      if (isFoldValue(currentValue)) {
        if (!settlement) {
          events.push({ playerId: String(playerId), action: 'fold', street: tracker.street, amount: 0, addedAmount: 0, amountIsTotalTo: false, timestamp: patch.timestamp, evidence: 'literal tB fold action token' });
          candidate({ playerId: String(playerId), action: 'fold', amount: 0, accepted: true, reason: 'literal tB fold action token' });
          gates.push({ playerId: String(playerId), previousTb: previousValue, currentTb: currentValue, branch: 'explicit-fold-confirmed', candidateCreated: true, voluntaryTransition: true, reason: 'literal fold token' });
        } else {
          candidate({ playerId: String(playerId), action: null, amount: 0, accepted: false, reason: 'fold token appeared during settlement' });
          gates.push({ playerId: String(playerId), previousTb: previousValue, currentTb: currentValue, branch: 'explicit-fold-rejected', candidateCreated: true, voluntaryTransition: true, reason: 'settlement patch' });
        }
        return;
      }
      if (!finiteNumber(currentValue) || settlement) {
        gates.push({ playerId: String(playerId), previousTb: previousValue, currentTb: currentValue, branch: settlement ? 'settlement-ignored' : (isCleanupValue(currentValue) ? 'cleanup-ignored' : 'unsupported-tB-type'), candidateCreated: false, voluntaryTransition: false, reason: settlement ? 'settlement cannot create actions' : (isCleanupValue(currentValue) ? 'tB cleanup/deletion is not an action' : 'tB value is not a supported numeric or explicit action token') });
        return;
      }

      var classification = classifyCommitmentTransition({ previousCommitment: playerCommitment, currentCommitment: currentValue, previousHighestBet: previousHighest });
      if (!classification.accepted) {
        candidate({ playerId: String(playerId), action: classification.action, amount: classification.amount || 0, accepted: false, reason: classification.reason });
        gates.push({ playerId: String(playerId), previousTb: previousValue, currentTb: currentValue, branch: 'numeric-transition-rejected', candidateCreated: true, voluntaryTransition: true, reason: classification.reason });
        return;
      }
      tracker.commitments[playerId] = currentValue;
      tracker.highestWager = Math.max(tracker.highestWager, currentValue);
      var pending = {
        playerId: String(playerId),
        action: classification.action,
        amount: classification.amount,
        addedAmount: classification.addedAmount,
        amountIsTotalTo: classification.amountIsTotalTo,
        targetAmount: currentValue,
        previousTbValue: previousValue,
        currentTbValue: currentValue,
        street: tracker.street,
        timestamp: patch.timestamp,
        recordId: patch.recordId,
        patchIndex: tracker.patchIndex,
        actorAtCreation: actor,
        stackAtCreation: stackBefore,
        emitted: false
      };
      tracker.pending.push(pending);
      candidate({ playerId: String(playerId), action: classification.action, amount: classification.amount, accepted: false, pending: true, previousTbValue: previousValue, currentTbValue: currentValue, targetAmount: currentValue, addedAmount: classification.addedAmount, reason: 'numeric tB absolute street total preserved pending adjacent-patch corroboration' });
      gates.push({ playerId: String(playerId), previousTb: previousValue, currentTb: currentValue, branch: 'numeric-voluntary-candidate-created', candidateCreated: true, voluntaryTransition: true, action: classification.action, amount: classification.amount, reason: classification.reason });
    });

    if (!settlement) {
      tracker.pending.forEach(function (pending) {
        if (pending.emitted) return;
        var beforeStack = tracker.stacks[pending.playerId];
        var afterStack = players[pending.playerId] && players[pending.playerId].stack;
        var stackSpent = finiteNumber(beforeStack) && finiteNumber(afterStack) ? beforeStack - afterStack : null;
        var stackMatches = finiteNumber(stackSpent) && stackSpent > 0 && (Math.abs(stackSpent - pending.targetAmount) < 0.0001 || Math.abs(stackSpent - pending.addedAmount) < 0.0001);
        if (stackMatches) {
          tracker.schemaConfirmed = true;
          emitPending(pending, 'tB absolute street total corroborated by same-player stack decrease of ' + stackSpent + ' within the action window');
          return;
        }
        var acknowledgedByRound = roundPlayers.includes(pending.playerId);
        var actorAdvanced = actor && String(actor) !== pending.playerId;
        if (tracker.schemaConfirmed && acknowledgedByRound && (actorAdvanced || String(patch.cPI || '') === pending.playerId)) {
          emitPending(pending, 'confirmed tB schema plus cRPI action acknowledgement' + (actorAdvanced ? ' and cPI advancing to the next actor' : ''));
        }
      });

      var unresolved = tracker.pending.filter(function (pending) { return !pending.emitted; });
      if (finiteNumber(patch.potDelta) && patch.potDelta > 0 && unresolved.length) {
        var targetSum = unresolved.reduce(function (sum, pending) { return sum + pending.targetAmount; }, 0);
        var addedSum = unresolved.reduce(function (sum, pending) { return sum + pending.addedAmount; }, 0);
        if (Math.abs(patch.potDelta - targetSum) < 0.0001 || Math.abs(patch.potDelta - addedSum) < 0.0001) {
          tracker.schemaConfirmed = true;
          unresolved.forEach(function (pending) { emitPending(pending, 'tB action window corroborated by aggregate pot increase of ' + patch.potDelta); });
        }
      }
    }

    tracker.pending.forEach(function (pending) {
      if (pending.emitted || pending.rejected) return;
      var tooManyPatches = tracker.patchIndex - pending.patchIndex > tracker.maxPatchDistance;
      var tooOld = patch.timestamp - pending.timestamp > tracker.maxWindowMs;
      if (tooManyPatches || tooOld) {
        pending.rejected = true;
        candidate({ playerId: pending.playerId, action: pending.action, amount: pending.amount, accepted: false, reason: 'tB action candidate expired without stack, pot, or learned-schema acknowledgement' });
      }
    });

    events.sort(function (left, right) { return left.timestamp - right.timestamp; });
    var previousHadRoundValue = Object.keys(tracker.values).some(function (playerId) { return finiteNumber(tracker.values[playerId]) || isCheckValue(tracker.values[playerId]); });
    var allCleanup = playerIds.length > 0 && playerIds.every(function (playerId) { return isCleanupValue(tB[playerId]); });
    if (!settlement && previousHadRoundValue && allCleanup) {
      tracker.street = nextStreet(tracker.street);
      tracker.commitments = {};
      tracker.highestWager = 0;
    }

    tracker.values = Object.assign({}, tB);
    playerIds.forEach(function (playerId) {
      var stack = players[playerId] && players[playerId].stack;
      if (finiteNumber(stack)) tracker.stacks[playerId] = stack;
    });
    tracker.pending = tracker.pending.filter(function (pending) { return !pending.emitted && !pending.rejected; });
    return { events: events, candidates: candidates, diagnostics: diagnostics, gates: gates, state: tracker };
  }

  var api = {
    classifyCommitmentTransition: classifyCommitmentTransition,
    classifyActorTurnEnd: classifyActorTurnEnd,
    createTbTracker: createTbTracker,
    processTbPatch: processTbPatch
  };
  root.PokerActionInference = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
