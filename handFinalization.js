/* Pure finalized-hand accounting and participant selection. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && !isSupportedRuntimePage(root.PokerNowRuntimeScope, window.location)) return;

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

  function semanticKey(event) {
    return [event.player, event.action, event.street, Number(event.amount || 0)].join('|');
  }

  function createState(options) {
    options = options || {};
    var finalizedEvents = clone(options.finalizedEvents || []);
    var finalizedHandIds = new Set((options.finalizedHandIds || finalizedEvents.map(function (event) { return event.handId; })).map(String));
    var stagedHands = {};
    var recovered = options.activeHand ? clone(options.activeHand) : null;
    if (recovered && recovered.handId) {
      recovered.recovered = true;
      recovered.observedAfterRecovery = false;
      recovered.events = recovered.events || [];
      recovered.participants = recovered.participants || {};
      stagedHands[String(recovered.handId)] = recovered;
    }
    return {
      activeHandId: recovered && String(recovered.handId) || null,
      stagedHands: stagedHands,
      finalizedEvents: finalizedEvents,
      finalizedHandIds: finalizedHandIds
    };
  }

  function ensureHand(state, handId, timestamp) {
    handId = String(handId);
    if (!state.stagedHands[handId]) {
      state.stagedHands[handId] = {
        handId: handId,
        createdAt: Number(timestamp || Date.now()),
        updatedAt: Number(timestamp || Date.now()),
        events: [],
        participants: {},
        recovered: false,
        observedAfterRecovery: true
      };
    }
    return state.stagedHands[handId];
  }

  function addParticipant(state, handId, participant) {
    var hand = ensureHand(state, handId, participant && participant.timestamp);
    var name = participant && participant.name;
    if (!name) return { included: false, reason: 'participant has no mapped name', hand: hand };
    var key = String(name);
    var existing = hand.participants[key];
    if (!existing) {
      hand.participants[key] = {
        playerId: participant.playerId === undefined ? null : String(participant.playerId),
        name: key,
        evidence: [participant.evidence],
        status: participant.status || null,
        includedAt: Number(participant.timestamp || Date.now())
      };
    } else if (participant.evidence && !existing.evidence.includes(participant.evidence)) {
      existing.evidence.push(participant.evidence);
    }
    hand.updatedAt = Number(participant.timestamp || Date.now());
    hand.observedAfterRecovery = true;
    return { included: true, participant: clone(hand.participants[key]), hand: hand };
  }

  function stageEvent(state, event, evidence) {
    if (!event || !event.handId || !event.player) return { staged: false, reason: 'event lacks hand ID or player' };
    var hand = ensureHand(state, event.handId, event.timestamp);
    var participantResult = addParticipant(state, event.handId, {
      playerId: evidence && evidence.playerId,
      name: event.player,
      evidence: evidence && evidence.reason || ('verified ' + event.action + ' action'),
      status: evidence && evidence.status,
      timestamp: event.timestamp
    });
    if (!participantResult.included) return { staged: false, reason: participantResult.reason };
    var duplicate = hand.events.some(function (stored) {
      return stored.eventKey && event.eventKey && stored.eventKey === event.eventKey;
    });
    if (!duplicate) hand.events.push(clone(event));
    hand.updatedAt = Number(event.timestamp || Date.now());
    hand.observedAfterRecovery = true;
    return { staged: !duplicate, duplicate: duplicate, hand: hand, participant: participantResult.participant };
  }

  function mergeHandEvents(existing, incoming) {
    var result = existing.slice();
    var existingCounts = new Map();
    existing.forEach(function (event) {
      var key = semanticKey(event);
      existingCounts.set(key, (existingCounts.get(key) || 0) + 1);
    });
    var incomingCounts = new Map();
    incoming.forEach(function (event) {
      var key = semanticKey(event);
      var occurrence = (incomingCounts.get(key) || 0) + 1;
      incomingCounts.set(key, occurrence);
      if (occurrence > (existingCounts.get(key) || 0)) result.push(clone(event));
    });
    return result;
  }

  // Staged events never contribute to statistics. Only verified settlement or the
  // boundary of a distinct next hand may move a staged hand into finalizedEvents.
  function commitHand(state, handId, reason, timestamp) {
    handId = String(handId);
    var hand = state.stagedHands[handId];
    if (!hand) return { committed: false, duplicate: state.finalizedHandIds.has(handId), discarded: false, reason: 'no staged hand exists', addedEvents: [] };
    var participants = Object.keys(hand.participants);
    if (!participants.length) {
      delete state.stagedHands[handId];
      if (state.activeHandId === handId) state.activeHandId = null;
      return { committed: false, duplicate: false, discarded: true, reason: 'hand has no corroborated participants', addedEvents: [] };
    }
    var staged = hand.events.filter(function (event) { return participants.includes(String(event.player)); });
    var wasFinalized = state.finalizedHandIds.has(handId);
    var existingForHand = [];
    var retainedEvents = null;
    var fullHistoryScans = 0;
    if (wasFinalized) {
      retainedEvents = [];
      fullHistoryScans = 1;
      state.finalizedEvents.forEach(function (event) {
        if (String(event.handId) === handId) existingForHand.push(event);
        else retainedEvents.push(event);
      });
    }
    participants.forEach(function (player) {
      if (!staged.some(function (event) { return event.player === player; }) && !existingForHand.some(function (event) { return event.player === player; })) {
        staged.push({ handId: handId, playerId: hand.participants[player].playerId, player: player, action: 'dealt', street: 'preflop', amount: 0, timestamp: Number(timestamp || hand.updatedAt || Date.now()) });
      }
    });
    var tableContextFact = {
      playersDealtCount: participants.length,
      playersDealtCountVersion: 1,
      playersDealtCountSource: 'finalized-hand-participants'
    };
    var mergedForHand = mergeHandEvents(existingForHand, staged).map(function (event) {
      return Object.assign({}, event, tableContextFact);
    });
    var addedEvents = mergedForHand.slice(existingForHand.length);
    var finalizedRangeStart;
    if (wasFinalized) {
      finalizedRangeStart = retainedEvents.length;
      state.finalizedEvents.splice.apply(state.finalizedEvents, [0, state.finalizedEvents.length].concat(retainedEvents, mergedForHand));
    } else {
      finalizedRangeStart = state.finalizedEvents.length;
      Array.prototype.push.apply(state.finalizedEvents, mergedForHand);
    }
    state.finalizedHandIds.add(handId);
    delete state.stagedHands[handId];
    if (state.activeHandId === handId) state.activeHandId = null;
    return {
      committed: !wasFinalized || addedEvents.length > 0,
      duplicate: wasFinalized && addedEvents.length === 0,
      reconciled: wasFinalized && addedEvents.length > 0,
      discarded: false,
      reason: reason,
      addedEvents: addedEvents,
      hand: clone(hand),
      finalizedRangeStart: finalizedRangeStart,
      finalizedRangeLength: mergedForHand.length,
      work: { fullHistoryScans: fullHistoryScans, handEventsRead: existingForHand.length + staged.length }
    };
  }

  function discardHand(state, handId, reason) {
    handId = String(handId);
    var hand = state.stagedHands[handId];
    delete state.stagedHands[handId];
    if (state.activeHandId === handId) state.activeHandId = null;
    return { discarded: Boolean(hand), reason: reason, hand: clone(hand) };
  }

  function beginHand(state, handId, options) {
    options = options || {};
    handId = String(handId);
    var priorResult = null;
    if (options.activate !== false && state.activeHandId && state.activeHandId !== handId) {
      var prior = state.stagedHands[state.activeHandId];
      if (prior && prior.recovered && !prior.observedAfterRecovery) priorResult = discardHand(state, state.activeHandId, 'recovered incomplete hand was not observed again before the next boundary');
      else priorResult = commitHand(state, state.activeHandId, options.priorReason || 'next distinct hand began', options.timestamp);
    }
    var hand = ensureHand(state, handId, options.timestamp);
    if (options.activate !== false) state.activeHandId = handId;
    return { hand: hand, created: hand.events.length === 0 && Object.keys(hand.participants).length === 0, priorResult: priorResult };
  }

  function activeHand(state) {
    return state.activeHandId ? state.stagedHands[state.activeHandId] || null : null;
  }

  function serializeActiveHand(state) {
    return clone(activeHand(state));
  }

  function setRecoveryMetadata(state, handId, metadata) {
    handId = String(handId);
    var hand = state.stagedHands[handId];
    if (!hand) return { updated: false, reason: 'no staged hand exists' };
    hand.recoveryMetadata = Object.assign({}, hand.recoveryMetadata || {}, clone(metadata || {}));
    hand.updatedAt = Math.max(Number(hand.updatedAt || 0), Number(metadata && metadata.timestamp || Date.now()));
    return { updated: true, hand: clone(hand) };
  }

  function reclaimRecoveredHand(state, handId, evidence) {
    handId = String(handId);
    var hand = state.stagedHands[handId];
    if (!hand || !hand.recovered) return { reclaimed: false, reason: hand ? 'hand was not restored from persistence' : 'no staged hand exists' };
    hand.observedAfterRecovery = true;
    hand.recoveryMetadata = Object.assign({}, hand.recoveryMetadata || {}, clone(evidence || {}), {
      reclaimedAt: Number(evidence && evidence.timestamp || Date.now())
    });
    state.activeHandId = handId;
    return { reclaimed: true, hand: clone(hand) };
  }

  function deriveParticipants(input) {
    input = input || {};
    var all = (input.allPlayerIds || []).map(String);
    var evidence = new Map();
    function include(ids, reason) {
      (ids || []).forEach(function (id) {
        id = String(id);
        var reasons = evidence.get(id) || [];
        if (!reasons.includes(reason)) reasons.push(reason);
        evidence.set(id, reasons);
      });
    }
    include(input.inHandPlayerIds, 'verified iHPI/in-hand player list');
    include(input.blindPlayerIds, 'forced-blind participation');
    include(input.holeCardPlayerIds, 'hole-card entry');
    include(input.actionPlayerIds, 'verified action/actor participation');
    Object.keys(input.statusByPlayer || {}).forEach(function (id) {
      var status = input.statusByPlayer[id];
      if (status && status.inHand === true && status.sittingOut !== true && status.away !== true && status.disconnected !== true) include([id], 'explicit active in-hand status');
    });
    return all.map(function (id) {
      var status = (input.statusByPlayer || {})[id] || null;
      var reasons = evidence.get(id) || [];
      return { playerId: id, included: reasons.length > 0, evidence: reasons, status: clone(status), exclusionReason: reasons.length ? null : 'mapped/seated roster membership is not in-hand evidence' };
    });
  }

  function renameHand(state, fromHandId, toHandId) {
    fromHandId = String(fromHandId);
    toHandId = String(toHandId);
    if (fromHandId === toHandId) return;
    state.finalizedEvents = state.finalizedEvents.map(function (event) { return String(event.handId) === fromHandId ? Object.assign({}, event, { handId: toHandId }) : event; });
    if (state.finalizedHandIds.delete(fromHandId)) state.finalizedHandIds.add(toHandId);
    if (state.stagedHands[fromHandId]) {
      var hand = state.stagedHands[fromHandId];
      var targetHand = state.stagedHands[toHandId];
      delete state.stagedHands[fromHandId];
      hand.handId = toHandId;
      hand.events = hand.events.map(function (event) { return Object.assign({}, event, { handId: toHandId }); });
      if (targetHand) {
        Object.keys(targetHand.participants || {}).forEach(function (name) {
          if (!hand.participants[name]) hand.participants[name] = targetHand.participants[name];
          else (targetHand.participants[name].evidence || []).forEach(function (reason) { if (!hand.participants[name].evidence.includes(reason)) hand.participants[name].evidence.push(reason); });
        });
        hand.events = mergeHandEvents(hand.events, targetHand.events || []);
        hand.updatedAt = Math.max(Number(hand.updatedAt || 0), Number(targetHand.updatedAt || 0));
      }
      state.stagedHands[toHandId] = hand;
    }
    if (state.activeHandId === fromHandId) state.activeHandId = toHandId;
  }

  var api = { createState: createState, beginHand: beginHand, addParticipant: addParticipant, stageEvent: stageEvent, commitHand: commitHand, discardHand: discardHand, activeHand: activeHand, serializeActiveHand: serializeActiveHand, setRecoveryMetadata: setRecoveryMetadata, reclaimRecoveredHand: reclaimRecoveredHand, deriveParticipants: deriveParticipants, renameHand: renameHand };
  root.PokerHandFinalization = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
