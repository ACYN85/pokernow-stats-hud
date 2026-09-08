/*
 * Pure poker-stat calculation module.
 *
 * @typedef {'fold'|'check'|'call'|'bet'|'raise'|'blind'|'dealt'} Action
 * @typedef {'preflop'|'flop'|'turn'|'river'} Street
 * @typedef {Object} HandEvent
 * @property {string} handId
 * @property {string} player
 * @property {Action} action
 * @property {Street} street
 * @property {number} amount
 * @property {number} timestamp
 * @property {'small'|'big'} [blindType]
 *
 * @typedef {Object} PlayerStats
 * @property {string} player
 * @property {number} handsPlayed
 * @property {number} vpipOpportunities
 * @property {number} vpipHands
 * @property {number} pfrOpportunities
 * @property {number} pfrHands
 * @property {number} vpip
 * @property {number} pfr
 * @property {number} af
 * @property {number} threeBetMade
 * @property {number} threeBetOpportunities
 * @property {number} foldToThreeBet
 * @property {number} foldToThreeBetOpportunities
 * @property {number} flopCBetMade
 * @property {number} flopCBetOpportunities
 * @property {number} foldToFlopCBet
 * @property {number} foldToFlopCBetOpportunities
 * @property {number} sawFlopForWTSD
 * @property {number} wentToShowdown
 * @property {number} showdownsForWSD
   * @property {number} wonMoneyAtShowdown
   * @property {number} preflopTableSizeSum
   * @property {number} preflopTableSizeOpportunities
   * @property {number|null} effectiveTableSize
 */

(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;
  var diagnosticConsole = root.PokerHudDiagnostics && typeof root.PokerHudDiagnostics.createConsole === 'function'
    ? root.PokerHudDiagnostics.createConsole(root.console)
    : root.console;
  var walkDetection = root.PokerWalkDetection;
  if (!walkDetection && typeof module !== 'undefined' && module.exports) walkDetection = require('./walkDetection.js');

  /** @param {number} value @returns {number} */
  function rounded(value) {
    return Math.round(value * 10) / 10;
  }

  function preflopDebug(stage, details) {
    if (root && root.__PNHUD_PREFLOP_DEBUG__ === true && root.console && typeof root.console.log === 'function') {
      root.console.log('[PNHUD PREFLOP DEBUG]', Object.assign({ stage: stage }, details || {}));
    }
  }

  function showdownDebug(stage, details) {
    var exporter = root && root.PokerShowdownDiagnosticExporter;
    var enabled = root && (root.__PNHUD_SHOWDOWN_DEBUG__ === true || Boolean(exporter && typeof exporter.enabled === 'function' && exporter.enabled()));
    if (enabled && exporter && typeof exporter.record === 'function') exporter.record(stage, details || {});
    if (enabled && root.console && typeof root.console.log === 'function') {
      root.console.log('[PNHUD SHOWDOWN DEBUG]', Object.assign({ stage: stage }, details || {}));
    }
  }

  function binaryCount(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? 1 : 0;
  }

  function contributionCounts(player) {
    player = player || {};
    return {
      threeBetMade: binaryCount(player.threeBet && player.threeBet.madeCount),
      threeBetOpportunities: binaryCount(player.threeBet && player.threeBet.opportunityCount),
      foldToThreeBet: binaryCount(player.foldToThreeBet && player.foldToThreeBet.foldCount),
      foldToThreeBetOpportunities: binaryCount(player.foldToThreeBet && player.foldToThreeBet.opportunityCount)
    };
  }

  function flopContributionCounts(player) {
    player = player || {};
    if (player.supported === false) {
      return {
        flopCBetMade: 0,
        flopCBetOpportunities: 0,
        foldToFlopCBet: 0,
        foldToFlopCBetOpportunities: 0
      };
    }
    var cBetOpportunity = player.flopCBet && player.flopCBet.opportunity === true;
    var foldOpportunity = player.foldToFlopCBetDecision && player.foldToFlopCBetDecision.opportunity === true;
    return {
      flopCBetMade: cBetOpportunity && player.flopCBet.made === true ? 1 : 0,
      flopCBetOpportunities: cBetOpportunity ? 1 : 0,
      foldToFlopCBet: foldOpportunity && player.foldToFlopCBetDecision.folded === true ? 1 : 0,
      foldToFlopCBetOpportunities: foldOpportunity ? 1 : 0
    };
  }

  function showdownContributionCounts(player) {
    player = player || {};
    var sawFlop = player.sawFlopForWTSD === 1;
    var reachedShowdown = sawFlop && player.wentToShowdown === 1;
    var wsdSupported = reachedShowdown && player.wonMoneyAtShowdownCandidateSupported === true &&
      (player.wonMoneyAtShowdownCandidate === 0 || player.wonMoneyAtShowdownCandidate === 1);
    return {
      sawFlopForWTSD: sawFlop ? 1 : 0,
      wentToShowdown: reachedShowdown ? 1 : 0,
      showdownsForWSD: wsdSupported ? 1 : 0,
      wonMoneyAtShowdown: wsdSupported && player.wonMoneyAtShowdownCandidate === 1 ? 1 : 0
    };
  }

  function handIdentityAliases(contribution) {
    var identity = contribution && contribution.handIdentity || {};
    var aliases = [];
    [identity.lifecycleHandId, identity.handId].forEach(function (value) {
      if (value === null || value === undefined || String(value) === '') return;
      value = String(value);
      if (!aliases.includes(value)) aliases.push(value);
    });
    return aliases;
  }

  function identityName(identityByPlayerId, playerId) {
    if (identityByPlayerId instanceof Map) return identityByPlayerId.get(String(playerId)) || null;
    return identityByPlayerId && identityByPlayerId[String(playerId)] || null;
  }

  function applyPreflopContribution(events, contribution, identityByPlayerId) {
    var next = (events || []).slice();
    var identity = contribution && contribution.handIdentity || {};
    var candidateHandIds = [];
    [identity.lifecycleHandId, identity.handId].forEach(function (value) {
      if (value === null || value === undefined) return;
      value = String(value);
      if (!candidateHandIds.includes(value)) candidateHandIds.push(value);
    });
    if (!candidateHandIds.length || !contribution || !contribution.players) {
      preflopDebug('stats-ingestion', { accepted: false, reason: 'contribution hand identity or players are missing', candidateHandIds: candidateHandIds });
      return { events: next, changed: false, appliedPlayerIds: [], missingPlayerIds: [], attachmentResults: [] };
    }
    var changed = false;
    var appliedPlayerIds = [];
    var missingPlayerIds = [];
    var attachmentResults = [];
    Object.keys(contribution.players).forEach(function (playerId) {
      var counts = contributionCounts(contribution.players[playerId]);
      var reducerVersion = Number(contribution.reducerVersion || contribution.version || contribution.schemaVersion || 1);
      var contributionId = ['preflop', reducerVersion, candidateHandIds[0], String(playerId)].join(':');
      var contributes = counts.threeBetMade || counts.threeBetOpportunities ||
        counts.foldToThreeBet || counts.foldToThreeBetOpportunities;
      if (!contributes) {
        var unsupported = {
          playerId: String(playerId),
          attached: false,
          skipped: true,
          reason: 'zero contribution; false or unsupported/null opportunity contributes no counter',
          counts: counts,
          candidateHandIds: candidateHandIds.slice()
        };
        attachmentResults.push(unsupported);
        preflopDebug('stats-ingestion', unsupported);
        return;
      }
      var playerName = identityName(identityByPlayerId, playerId);
      var matchingHandIndexes = [];
      next.forEach(function (event, index) {
        if (candidateHandIds.includes(String(event && event.handId))) matchingHandIndexes.push(index);
      });
      var targetIndex = matchingHandIndexes.find(function (index) {
        return String(next[index].playerId || '') === String(playerId);
      });
      if (targetIndex === undefined && playerName) {
        targetIndex = matchingHandIndexes.find(function (index) {
          var eventPlayerId = next[index].playerId;
          return (eventPlayerId === null || eventPlayerId === undefined || String(eventPlayerId) === '') && next[index].player === playerName;
        });
      }
      if (targetIndex === undefined) {
        missingPlayerIds.push(String(playerId));
        var missing = {
          playerId: String(playerId),
          attached: false,
          skipped: true,
          reason: matchingHandIndexes.length ? 'player identity did not match any finalized event for the candidate hand identities' : 'no finalized event matched lifecycle or authoritative hand identity',
          counts: counts,
          candidateHandIds: candidateHandIds.slice(),
          playerName: playerName
        };
        attachmentResults.push(missing);
        preflopDebug('stats-ingestion', missing);
        return;
      }
      var previous = next[targetIndex];
      var matchedHandId = String(previous.handId);
      var before = {
        threeBetMade: binaryCount(previous.threeBetMade),
        threeBetOpportunities: binaryCount(previous.threeBetOpportunities),
        foldToThreeBet: binaryCount(previous.foldToThreeBet),
        foldToThreeBetOpportunities: binaryCount(previous.foldToThreeBetOpportunities)
      };
      var annotated = Object.assign({}, previous, counts, {
        playerId: String(playerId),
        preflopOpportunityVersion: reducerVersion,
        preflopOpportunityHandId: matchedHandId,
        preflopOpportunityContributionId: contributionId
      });
      if (playerName) annotated.player = playerName;
      var duplicate = String(previous.preflopOpportunityContributionId || '') === contributionId || JSON.stringify(previous) === JSON.stringify(annotated);
      if (!duplicate) changed = true;
      next[targetIndex] = annotated;
      appliedPlayerIds.push(String(playerId));
      var attached = {
        contributionId: contributionId,
        eventId: String(previous.eventKey || previous.eventId || matchedHandId + ':' + playerId + ':' + targetIndex),
        targetEventIndex: targetIndex,
        targetHandId: matchedHandId,
        playerId: String(playerId),
        playerName: playerName || previous.player || null,
        contributionFieldsPresent: true,
        duplicate: duplicate,
        rejectedAsDuplicate: duplicate,
        attached: true,
        skipped: false,
        before: before,
        after: counts,
        candidateHandIds: candidateHandIds.slice()
      };
      attachmentResults.push(attached);
      preflopDebug('stats-ingestion', attached);
    });
    return {
      events: next,
      changed: changed,
      appliedPlayerIds: appliedPlayerIds,
      missingPlayerIds: missingPlayerIds,
      attachmentResults: attachmentResults
    };
  }

  function applyFlopCBetContribution(events, contribution) {
    var next = (events || []).slice();
    var candidateHandIds = handIdentityAliases(contribution);
    if (!candidateHandIds.length || !contribution || !contribution.players) {
      preflopDebug('flop-cbet-stats-ingestion', {
        accepted: false,
        reason: 'contribution hand identity or players are missing',
        candidateHandIds: candidateHandIds
      });
      return { events: next, changed: false, appliedPlayerIds: [], missingPlayerIds: [], attachmentResults: [] };
    }
    var changed = false;
    var appliedPlayerIds = [];
    var missingPlayerIds = [];
    var attachmentResults = [];
    var reducerVersion = Number(contribution.reducerVersion || contribution.version || contribution.schemaVersion || 1);
    Object.keys(contribution.players).forEach(function (playerId) {
      playerId = String(playerId);
      var player = contribution.players[playerId];
      var counts = flopContributionCounts(player);
      var contributes = counts.flopCBetOpportunities || counts.foldToFlopCBetOpportunities;
      var contributionId = ['flop-cbet', reducerVersion, candidateHandIds[0], playerId].join(':');
      if (!contributes) {
        var unsupported = {
          contributionId: contributionId,
          playerId: playerId,
          attached: false,
          skipped: true,
          reason: player && player.supported === false
            ? player.unsupportedReason || 'unsupported/null opportunity contributes no counter'
            : 'zero contribution; supported false opportunity contributes no counter',
          supported: player ? player.supported !== false : false,
          counts: counts,
          candidateHandIds: candidateHandIds.slice()
        };
        attachmentResults.push(unsupported);
        preflopDebug('flop-cbet-stats-ingestion', unsupported);
        return;
      }
      var matchingHandIndexes = [];
      next.forEach(function (event, index) {
        if (candidateHandIds.includes(String(event && event.handId))) matchingHandIndexes.push(index);
      });
      var targetIndex = matchingHandIndexes.find(function (index) {
        return String(next[index] && next[index].playerId || '') === playerId;
      });
      if (targetIndex === undefined) {
        missingPlayerIds.push(playerId);
        var missing = {
          contributionId: contributionId,
          playerId: playerId,
          attached: false,
          skipped: true,
          reason: matchingHandIndexes.length
            ? 'stable player ID did not match a finalized event'
            : 'no finalized event matched lifecycle or authoritative hand identity',
          counts: counts,
          candidateHandIds: candidateHandIds.slice()
        };
        attachmentResults.push(missing);
        preflopDebug('flop-cbet-stats-ingestion', missing);
        return;
      }
      var previous = next[targetIndex];
      var matchedHandId = String(previous.handId);
      var before = {
        flopCBetMade: binaryCount(previous.flopCBetMade),
        flopCBetOpportunities: binaryCount(previous.flopCBetOpportunities),
        foldToFlopCBet: binaryCount(previous.foldToFlopCBet),
        foldToFlopCBetOpportunities: binaryCount(previous.foldToFlopCBetOpportunities)
      };
      var duplicate = String(previous.flopCBetContributionId || '') === contributionId;
      var annotated = duplicate ? previous : Object.assign({}, previous, counts, {
        playerId: playerId,
        flopCBetOpportunityVersion: reducerVersion,
        flopCBetOpportunityHandId: matchedHandId,
        flopCBetContributionId: contributionId
      });
      if (!duplicate) {
        next[targetIndex] = annotated;
        changed = true;
      }
      appliedPlayerIds.push(playerId);
      var attached = {
        contributionId: contributionId,
        eventId: String(previous.eventKey || previous.eventId || matchedHandId + ':' + playerId + ':' + targetIndex),
        targetEventIndex: targetIndex,
        targetHandId: matchedHandId,
        playerId: playerId,
        contributionFieldsPresent: true,
        duplicate: duplicate,
        rejectedAsDuplicate: duplicate,
        attached: true,
        skipped: false,
        before: before,
        after: counts,
        candidateHandIds: candidateHandIds.slice()
      };
      attachmentResults.push(attached);
      preflopDebug('flop-cbet-stats-ingestion', attached);
    });
    return {
      events: next,
      changed: changed,
      appliedPlayerIds: appliedPlayerIds,
      missingPlayerIds: missingPlayerIds,
      attachmentResults: attachmentResults
    };
  }

  function applyShowdownContribution(events, contribution) {
    var next = (events || []).slice();
    var candidateHandIds = handIdentityAliases(contribution);
    if (!candidateHandIds.length || !contribution || !contribution.players) {
      showdownDebug('stats-ingestion', { accepted: false, reason: 'contribution hand identity or players are missing', candidateHandIds: candidateHandIds });
      return { events: next, changed: false, appliedPlayerIds: [], missingPlayerIds: [], attachmentResults: [] };
    }
    var changed = false;
    var appliedPlayerIds = [];
    var missingPlayerIds = [];
    var attachmentResults = [];
    var reducerVersion = Number(contribution.reducerVersion || contribution.version || contribution.schemaVersion || 1);
    Object.keys(contribution.players).forEach(function (playerId) {
      playerId = String(playerId);
      var player = contribution.players[playerId];
      var counts = showdownContributionCounts(player);
      var contributes = counts.sawFlopForWTSD || counts.showdownsForWSD;
      var contributionId = ['showdown-stats', reducerVersion, candidateHandIds[0], playerId].join(':');
      if (!contributes) {
        var unsupported = {
          contributionId: contributionId,
          playerId: playerId,
          attached: false,
          skipped: true,
          reason: player && player.sawFlopForWTSD === 1
            ? player.wonMoneyAtShowdownCandidateReason || player.unsupportedReason || 'supported saw-flop state produced no authoritative counter'
            : player && player.unsupportedReason || 'no supported saw-flop or W$SD contribution',
          counts: counts,
          candidateHandIds: candidateHandIds.slice()
        };
        attachmentResults.push(unsupported);
        showdownDebug('stats-ingestion', unsupported);
        return;
      }
      var matchingHandIndexes = [];
      next.forEach(function (event, index) {
        if (candidateHandIds.includes(String(event && event.handId))) matchingHandIndexes.push(index);
      });
      var targetIndex = matchingHandIndexes.find(function (index) {
        return String(next[index] && next[index].playerId || '') === playerId;
      });
      if (targetIndex === undefined) {
        missingPlayerIds.push(playerId);
        var missing = {
          contributionId: contributionId,
          playerId: playerId,
          attached: false,
          skipped: true,
          reason: matchingHandIndexes.length
            ? 'stable player ID did not match a finalized event'
            : 'no finalized event matched lifecycle or authoritative hand identity',
          counts: counts,
          candidateHandIds: candidateHandIds.slice()
        };
        attachmentResults.push(missing);
        showdownDebug('stats-ingestion', missing);
        return;
      }
      var previous = next[targetIndex];
      var matchedHandId = String(previous.handId);
      var before = {
        sawFlopForWTSD: binaryCount(previous.sawFlopForWTSD),
        wentToShowdown: binaryCount(previous.wentToShowdown),
        showdownsForWSD: binaryCount(previous.showdownsForWSD),
        wonMoneyAtShowdown: binaryCount(previous.wonMoneyAtShowdown)
      };
      var duplicate = String(previous.showdownStatsContributionId || '') === contributionId;
      var annotated = duplicate ? previous : Object.assign({}, previous, counts, {
        playerId: playerId,
        showdownStatsReducerVersion: reducerVersion,
        showdownStatsContributionId: contributionId,
        showdownStatsMatchedHandId: matchedHandId
      });
      if (!duplicate) {
        next[targetIndex] = annotated;
        changed = true;
      }
      appliedPlayerIds.push(playerId);
      var attached = {
        contributionId: contributionId,
        eventId: String(previous.eventKey || previous.eventId || matchedHandId + ':' + playerId + ':' + targetIndex),
        targetEventIndex: targetIndex,
        targetHandId: matchedHandId,
        playerId: playerId,
        contributionFieldsPresent: true,
        duplicate: duplicate,
        rejectedAsDuplicate: duplicate,
        attached: true,
        skipped: false,
        before: before,
        after: counts,
        candidateHandIds: candidateHandIds.slice()
      };
      attachmentResults.push(attached);
      showdownDebug('stats-ingestion', attached);
    });
    return {
      events: next,
      changed: changed,
      appliedPlayerIds: appliedPlayerIds,
      missingPlayerIds: missingPlayerIds,
      attachmentResults: attachmentResults
    };
  }

  function normalizedEventRange(events, range) {
    var eventCount = Array.isArray(events) ? events.length : 0;
    var start = Math.max(0, Math.min(eventCount, Number(range && range.start || 0)));
    var length = Math.max(0, Math.min(eventCount - start, Number(range && range.length || 0)));
    return { start: start, length: length };
  }

  function applyWithinEventRange(events, range, operation) {
    events = Array.isArray(events) ? events : [];
    var normalized = normalizedEventRange(events, range);
    var result = operation(events.slice(normalized.start, normalized.start + normalized.length));
    if (result.changed) {
      for (var index = 0; index < result.events.length; index += 1) events[normalized.start + index] = result.events[index];
    }
    var attachments = (result.attachmentResults || []).map(function (record) {
      return record && Number.isInteger(record.targetEventIndex)
        ? Object.assign({}, record, { targetEventIndex: normalized.start + record.targetEventIndex })
        : record;
    });
    return Object.assign({}, result, { events: events, attachmentResults: attachments, range: normalized, historyEventsCopied: 0 });
  }

  function applyPreflopContributionRange(events, contribution, identityByPlayerId, range) {
    return applyWithinEventRange(events, range, function (handEvents) { return applyPreflopContribution(handEvents, contribution, identityByPlayerId); });
  }

  function applyFlopCBetContributionRange(events, contribution, range) {
    return applyWithinEventRange(events, range, function (handEvents) { return applyFlopCBetContribution(handEvents, contribution); });
  }

  function applyShowdownContributionRange(events, contribution, range) {
    return applyWithinEventRange(events, range, function (handEvents) { return applyShowdownContribution(handEvents, contribution); });
  }

  function preflopCountsFromEvents(playerEvents) {
    var byHand = new Map();
    (playerEvents || []).forEach(function (event) {
      var hasContribution = ['threeBetMade', 'threeBetOpportunities', 'foldToThreeBet', 'foldToThreeBetOpportunities'].some(function (field) {
        return Object.prototype.hasOwnProperty.call(event, field);
      });
      if (!hasContribution) return;
      var handId = String(event.handId);
      var duplicateContributionEvent = byHand.has(handId);
      var counts = byHand.get(handId) || {
        threeBetMade: 0,
        threeBetOpportunities: 0,
        foldToThreeBet: 0,
        foldToThreeBetOpportunities: 0
      };
      counts.threeBetMade = Math.max(counts.threeBetMade, binaryCount(event.threeBetMade));
      counts.threeBetOpportunities = Math.max(counts.threeBetOpportunities, binaryCount(event.threeBetOpportunities));
      counts.foldToThreeBet = Math.max(counts.foldToThreeBet, binaryCount(event.foldToThreeBet));
      counts.foldToThreeBetOpportunities = Math.max(counts.foldToThreeBetOpportunities, binaryCount(event.foldToThreeBetOpportunities));
      byHand.set(handId, counts);
      preflopDebug('stats-aggregation', {
        eventId: String(event.eventKey || event.eventId || handId + ':' + (event.playerId || event.player || 'unknown')),
        handId: handId,
        playerId: event.playerId || null,
        contributionFieldsPresent: true,
        rejectedAsDuplicate: duplicateContributionEvent,
        countersAfter: Object.assign({}, counts)
      });
    });
    return Array.from(byHand.values()).reduce(function (total, counts) {
      total.threeBetMade += counts.threeBetMade;
      total.threeBetOpportunities += counts.threeBetOpportunities;
      total.foldToThreeBet += counts.foldToThreeBet;
      total.foldToThreeBetOpportunities += counts.foldToThreeBetOpportunities;
      return total;
    }, {
      threeBetMade: 0,
      threeBetOpportunities: 0,
      foldToThreeBet: 0,
      foldToThreeBetOpportunities: 0
    });
  }

  function flopCBetCountsFromEvents(playerEvents) {
    var fields = ['flopCBetMade', 'flopCBetOpportunities', 'foldToFlopCBet', 'foldToFlopCBetOpportunities'];
    var byHand = new Map();
    (playerEvents || []).forEach(function (event) {
      var hasContribution = fields.some(function (field) {
        return Object.prototype.hasOwnProperty.call(event, field);
      });
      if (!hasContribution) return;
      var handId = String(event.handId);
      var duplicateContributionEvent = byHand.has(handId);
      var counts = byHand.get(handId) || {
        flopCBetMade: 0,
        flopCBetOpportunities: 0,
        foldToFlopCBet: 0,
        foldToFlopCBetOpportunities: 0
      };
      fields.forEach(function (field) {
        counts[field] = Math.max(counts[field], binaryCount(event[field]));
      });
      byHand.set(handId, counts);
      preflopDebug('flop-cbet-stats-aggregation', {
        eventId: String(event.eventKey || event.eventId || handId + ':' + (event.playerId || event.player || 'unknown')),
        handId: handId,
        playerId: event.playerId || null,
        contributionFieldsPresent: true,
        rejectedAsDuplicate: duplicateContributionEvent,
        countersAfter: Object.assign({}, counts)
      });
    });
    return Array.from(byHand.values()).reduce(function (total, counts) {
      fields.forEach(function (field) { total[field] += counts[field]; });
      return total;
    }, {
      flopCBetMade: 0,
      flopCBetOpportunities: 0,
      foldToFlopCBet: 0,
      foldToFlopCBetOpportunities: 0
    });
  }

  function showdownCountsFromEvents(playerEvents) {
    var fields = ['sawFlopForWTSD', 'wentToShowdown', 'showdownsForWSD', 'wonMoneyAtShowdown'];
    var byHand = new Map();
    (playerEvents || []).forEach(function (event) {
      var hasContribution = fields.some(function (field) { return Object.prototype.hasOwnProperty.call(event, field); });
      if (!hasContribution) return;
      var handId = String(event.handId);
      var duplicateContributionEvent = byHand.has(handId);
      var counts = byHand.get(handId) || { sawFlopForWTSD: 0, wentToShowdown: 0, showdownsForWSD: 0, wonMoneyAtShowdown: 0 };
      var countersBefore = Object.assign({}, counts);
      fields.forEach(function (field) { counts[field] = Math.max(counts[field], binaryCount(event[field])); });
      byHand.set(handId, counts);
      showdownDebug('stats-aggregation', {
        eventId: String(event.eventKey || event.eventId || handId + ':' + (event.playerId || event.player || 'unknown')),
        handId: handId,
        playerId: event.playerId || null,
        contributionFieldsPresent: true,
        rejectedAsDuplicate: duplicateContributionEvent,
        countersBefore: countersBefore,
        countersAfter: Object.assign({}, counts)
      });
    });
    return Array.from(byHand.values()).reduce(function (total, counts) {
      fields.forEach(function (field) { total[field] += counts[field]; });
      return total;
    }, { sawFlopForWTSD: 0, wentToShowdown: 0, showdownsForWSD: 0, wonMoneyAtShowdown: 0 });
  }

  function detectBigBlindWalk(handEvents, playerName) {
    var result = walkDetection.detectBigBlindWalk(handEvents, playerName);
    if (typeof window !== 'undefined') {
      diagnosticConsole.log(result.isWalk ? '[HUD WALK] detected' : '[HUD WALK] rejected', result);
      if (result.isWalk) diagnosticConsole.log('[HUD STATS] VPIP opportunity excluded', result);
    }
    return result;
  }

  function tableContextCounts(eventsByHand, countedHandIds, walkHandIds) {
    var result = {
      preflopTableSizeSum: 0,
      preflopTableSizeOpportunities: 0,
      unsupportedOpportunityCount: 0,
      unsupportedHandIds: []
    };
    countedHandIds.forEach(function (handId) {
      handId = String(handId);
      if (walkHandIds.has(handId)) return;
      var facts = Array.from(new Set((eventsByHand.get(handId) || []).filter(function (event) {
        return Number(event && event.playersDealtCountVersion) === 1 &&
          event.playersDealtCountSource === 'finalized-hand-participants' &&
          Number.isInteger(Number(event.playersDealtCount)) && Number(event.playersDealtCount) >= 2;
      }).map(function (event) { return Number(event.playersDealtCount); })));
      if (facts.length !== 1) {
        result.unsupportedOpportunityCount += 1;
        result.unsupportedHandIds.push(handId);
        return;
      }
      result.preflopTableSizeSum += facts[0];
      result.preflopTableSizeOpportunities += 1;
    });
    return result;
  }

  function statsFromCounts(playerName, counts) {
    var postflopAggressiveActions = counts.postflopBets + counts.postflopRaises;
    var af = counts.postflopCalls === 0
      ? (postflopAggressiveActions === 0 ? 0 : Infinity)
      : rounded(postflopAggressiveActions / counts.postflopCalls);
    var tableContextComplete = counts.vpipOpportunities > 0 &&
      counts.preflopTableSizeOpportunities === counts.vpipOpportunities &&
      counts.preflopTableSizeSum >= counts.preflopTableSizeOpportunities * 2;
    var effectiveTableSize = tableContextComplete
      ? rounded(counts.preflopTableSizeSum / counts.preflopTableSizeOpportunities)
      : null;
    return {
      player: playerName,
      handsPlayed: counts.handsPlayed,
      vpipOpportunities: counts.vpipOpportunities,
      vpipHands: counts.vpipHands,
      pfrOpportunities: counts.pfrOpportunities,
      pfrHands: counts.pfrHands,
      vpip: counts.vpipOpportunities ? rounded((counts.vpipHands / counts.vpipOpportunities) * 100) : 0,
      pfr: counts.pfrOpportunities ? rounded((counts.pfrHands / counts.pfrOpportunities) * 100) : 0,
      preflopTableSizeSum: counts.preflopTableSizeSum,
      preflopTableSizeOpportunities: counts.preflopTableSizeOpportunities,
      effectiveTableSize: effectiveTableSize,
      preflopTableContextDetails: {
        supported: tableContextComplete,
        source: tableContextComplete ? 'finalized-hand-participants-v1' : null,
        supportedOpportunities: counts.preflopTableSizeOpportunities,
        requiredOpportunities: counts.vpipOpportunities,
        unsupportedOpportunities: Number(counts.preflopTableSizeUnsupportedOpportunities || 0),
        unsupportedReason: tableContextComplete
          ? null
          : counts.vpipOpportunities === 0
            ? 'zero_preflop_opportunities'
            : 'one_or_more_preflop_opportunities_lack_exact_finalized_participant_count'
      },
      threeBetMade: counts.threeBetMade,
      threeBetOpportunities: counts.threeBetOpportunities,
      threeBetPercent: counts.threeBetOpportunities ? rounded((counts.threeBetMade / counts.threeBetOpportunities) * 100) : null,
      foldToThreeBet: counts.foldToThreeBet,
      foldToThreeBetOpportunities: counts.foldToThreeBetOpportunities,
      foldToThreeBetPercent: counts.foldToThreeBetOpportunities ? rounded((counts.foldToThreeBet / counts.foldToThreeBetOpportunities) * 100) : null,
      threeBetDetails: { made: counts.threeBetMade, opportunities: counts.threeBetOpportunities },
      foldToThreeBetDetails: { folds: counts.foldToThreeBet, opportunities: counts.foldToThreeBetOpportunities },
      flopCBetMade: counts.flopCBetMade,
      flopCBetOpportunities: counts.flopCBetOpportunities,
      foldToFlopCBet: counts.foldToFlopCBet,
      foldToFlopCBetOpportunities: counts.foldToFlopCBetOpportunities,
      sawFlopForWTSD: counts.sawFlopForWTSD,
      wentToShowdown: counts.wentToShowdown,
      showdownsForWSD: counts.showdownsForWSD,
      wonMoneyAtShowdown: counts.wonMoneyAtShowdown,
      handsDetails: {
        finalizedHands: counts.handsPlayed
      },
      vpipDetails: {
        qualifiedHands: counts.vpipHands,
        opportunities: counts.vpipOpportunities,
        callHands: counts.preflopCallHands,
        raiseHands: counts.preflopRaiseHands,
        walksExcluded: counts.walksExcluded,
        finalizedHands: counts.handsPlayed
      },
      pfrDetails: {
        raisedHands: counts.pfrHands,
        opportunities: counts.pfrOpportunities,
        walksExcluded: counts.walksExcluded,
        finalizedHands: counts.handsPlayed
      },
      af: af,
      afDetails: {
        bets: counts.postflopBets,
        raises: counts.postflopRaises,
        calls: counts.postflopCalls,
        formula: '(' + counts.postflopBets + ' + ' + counts.postflopRaises + ') / ' + counts.postflopCalls,
        display: af === Infinity ? '\u221e' : af.toFixed(1)
      }
    };
  }

  /**
   * Adds one already-decoded event to an event collection. Keeping this tiny
   * boundary in the pure stats module makes the live pipeline independently
   * observable without changing the calculation rules.
   *
   * @param {HandEvent[]} events
   * @param {HandEvent} event
   * @returns {HandEvent[]}
   */
  function addEvent(events, event) {
    if (typeof window !== 'undefined') {
      diagnosticConsole.log('[HUD PIPELINE 7] stats.addEvent called', {
        handId: event.handId,
        player: event.player,
        action: event.action,
        street: event.street,
        amount: event.amount,
        storedCountBefore: events.length,
        event: event
      });
    }
    return events.concat([event]);
  }

  /**
   * Computes standard basic poker stats for one player.
   * VPIP counts a voluntary preflop call, bet, or raise. Blind events are
   * explicitly ignored for both VPIP and PFR.
   *
   * @param {HandEvent[]} events
   * @param {string} playerName
   * @returns {PlayerStats}
   */
  function computePlayerStats(events, playerName) {
    var playerEvents = events.filter(function (event) {
      return event.player === playerName;
    });
    var countedHandIds = new Set();
    var vpipHands = new Set();
    var pfrHands = new Set();
    var preflopCallHands = new Set();
    var preflopRaiseHands = new Set();
    var postflopBets = 0;
    var postflopRaises = 0;
    var postflopCalls = 0;
    var preflopOpportunityCounts = preflopCountsFromEvents(playerEvents);
    var flopCBetOpportunityCounts = flopCBetCountsFromEvents(playerEvents);
    var showdownCounts = showdownCountsFromEvents(playerEvents);
    var eventsByHand = new Map();
    events.forEach(function (event) {
      if (!eventsByHand.has(String(event.handId))) eventsByHand.set(String(event.handId), []);
      eventsByHand.get(String(event.handId)).push(event);
    });

    playerEvents.forEach(function (event) {
      if (typeof window !== 'undefined') diagnosticConsole.log('[HUD] hand ID before count', { player: playerName, handId: event.handId });
      if (countedHandIds.has(event.handId)) {
        if (typeof window !== 'undefined') diagnosticConsole.log('[HUD] duplicate hand ignored', { player: playerName, handId: event.handId });
      } else {
        countedHandIds.add(event.handId);
        if (typeof window !== 'undefined') diagnosticConsole.log('[HUD] unique hand counted', { player: playerName, handId: event.handId });
      }
      if (typeof window !== 'undefined' && (event.action === 'call' || event.action === 'bet' || event.action === 'raise')) {
        diagnosticConsole.log('[HUD] stats action received', event);
      }
      if (event.street === 'preflop') {
        if (event.action === 'call' || event.action === 'bet' || event.action === 'raise') {
          vpipHands.add(event.handId);
        }
        if (event.action === 'call') preflopCallHands.add(event.handId);
        if (event.action === 'raise') preflopRaiseHands.add(event.handId);
        if (event.action === 'raise') {
          pfrHands.add(event.handId);
        }
      } else if (event.action === 'bet') {
        postflopBets += 1;
      } else if (event.action === 'raise') {
        postflopRaises += 1;
      } else if (event.action === 'call') {
        postflopCalls += 1;
      }
    });

    var walkHandIds = new Set();
    countedHandIds.forEach(function (handId) {
      var result = detectBigBlindWalk(eventsByHand.get(String(handId)) || [], playerName);
      if (result.isWalk) walkHandIds.add(String(handId));
    });
    var opportunities = countedHandIds.size - walkHandIds.size;
    var tableContext = tableContextCounts(eventsByHand, countedHandIds, walkHandIds);
    return statsFromCounts(playerName, {
      handsPlayed: countedHandIds.size,
      vpipOpportunities: opportunities,
      vpipHands: vpipHands.size,
      pfrOpportunities: opportunities,
      pfrHands: pfrHands.size,
      preflopTableSizeSum: tableContext.preflopTableSizeSum,
      preflopTableSizeOpportunities: tableContext.preflopTableSizeOpportunities,
      preflopTableSizeUnsupportedOpportunities: tableContext.unsupportedOpportunityCount,
      preflopCallHands: preflopCallHands.size,
      preflopRaiseHands: preflopRaiseHands.size,
      walksExcluded: walkHandIds.size,
      postflopBets: postflopBets,
      postflopRaises: postflopRaises,
      postflopCalls: postflopCalls,
      threeBetMade: preflopOpportunityCounts.threeBetMade,
      threeBetOpportunities: preflopOpportunityCounts.threeBetOpportunities,
      foldToThreeBet: preflopOpportunityCounts.foldToThreeBet,
      foldToThreeBetOpportunities: preflopOpportunityCounts.foldToThreeBetOpportunities,
      flopCBetMade: flopCBetOpportunityCounts.flopCBetMade,
      flopCBetOpportunities: flopCBetOpportunityCounts.flopCBetOpportunities,
      foldToFlopCBet: flopCBetOpportunityCounts.foldToFlopCBet,
      foldToFlopCBetOpportunities: flopCBetOpportunityCounts.foldToFlopCBetOpportunities,
      sawFlopForWTSD: showdownCounts.sawFlopForWTSD,
      wentToShowdown: showdownCounts.wentToShowdown,
      showdownsForWSD: showdownCounts.showdownsForWSD,
      wonMoneyAtShowdown: showdownCounts.wonMoneyAtShowdown
    });
  }

  var AUTHORITATIVE_COUNTER_FIELDS = Object.freeze([
    'handsPlayed',
    'vpipHands',
    'vpipOpportunities',
    'pfrHands',
    'pfrOpportunities',
    'threeBetMade',
    'threeBetOpportunities',
    'foldToThreeBet',
    'foldToThreeBetOpportunities',
    'flopCBetMade',
    'flopCBetOpportunities',
    'foldToFlopCBet',
    'foldToFlopCBetOpportunities',
    'sawFlopForWTSD',
    'wentToShowdown',
    'showdownsForWSD',
    'wonMoneyAtShowdown'
  ]);

  /*
   * Live PokerNow identity is the opaque player ID. Display names can be
   * reused or changed, so presentation code must not use them as the primary
   * key for cumulative authoritative counters. Legacy events without an ID
   * retain the established exact-name fallback.
   */
  function computePlayerStatsByIdentity(events, playerId, playerName) {
    var stableId = playerId === null || playerId === undefined ? '' : String(playerId);
    var displayName = String(playerName === null || playerName === undefined ? '' : playerName);
    if (!stableId) return computePlayerStats(events || [], displayName);
    var sentinel = '__PNHUD_STABLE_PLAYER__' + stableId;
    var isolated = (events || []).map(function (event) {
      if (!event || typeof event !== 'object') return event;
      var eventId = event.playerId === null || event.playerId === undefined ? '' : String(event.playerId);
      if (eventId === stableId || (!eventId && event.player === displayName)) {
        return Object.assign({}, event, { player: sentinel });
      }
      if (event.player === sentinel) return Object.assign({}, event, { player: sentinel + ':other' });
      return event;
    });
    var stats = computePlayerStats(isolated, sentinel);
    stats.player = displayName;
    stats.playerId = stableId;
    return stats;
  }

  function authoritativeCounterSnapshot(stats) {
    stats = stats || {};
    var snapshot = {};
    AUTHORITATIVE_COUNTER_FIELDS.forEach(function (field) {
      var value = Number(stats[field] || 0);
      snapshot[field] = Number.isFinite(value) && value >= 0 ? value : 0;
    });
    return snapshot;
  }

  function authoritativeCounterRegressions(before, after) {
    var previous = authoritativeCounterSnapshot(before);
    var current = authoritativeCounterSnapshot(after);
    return AUTHORITATIVE_COUNTER_FIELDS.filter(function (field) {
      return current[field] < previous[field];
    }).map(function (field) {
      return { field: field, before: previous[field], after: current[field], delta: current[field] - previous[field] };
    });
  }

  function cloneJsonSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /*
   * chrome.storage.local.set is asynchronous and does not promise completion
   * order. This queue permits one authoritative snapshot write at a time and
   * coalesces superseded pending snapshots without reordering callbacks.
   */
  function createSerializedPersistenceQueue(write, options) {
    options = options || {};
    var nextRevision = Math.max(0, Number(options.initialRevision || 0));
    var completedRevision = nextRevision;
    var inFlight = null;
    var pending = null;
    var history = [];
    var maxHistory = Math.max(1, Number(options.maxHistory || 50));

    function record(entry) {
      history.push(entry);
      if (history.length > maxHistory) history.shift();
    }

    function start(item) {
      inFlight = item;
      record({ type: 'started', revision: item.revision });
      write(cloneJsonSafe(item.payload), item.revision, function (error) {
        completedRevision = Math.max(completedRevision, item.revision);
        record({ type: error ? 'failed' : 'completed', revision: item.revision, error: error ? String(error.message || error) : null });
        var callbacks = item.callbacks.slice();
        inFlight = null;
        callbacks.forEach(function (callback) { callback(error || null); });
        if (pending) {
          var next = pending;
          pending = null;
          start(next);
        }
      });
    }

    function enqueue(payload, callback) {
      var item = {
        revision: ++nextRevision,
        payload: cloneJsonSafe(payload || {}),
        callbacks: typeof callback === 'function' ? [callback] : []
      };
      if (!inFlight) start(item);
      else {
        if (pending) {
          item.payload = Object.assign({}, pending.payload, item.payload);
          item.callbacks = pending.callbacks.concat(item.callbacks);
        } else item.payload = Object.assign({}, inFlight.payload, item.payload);
        pending = item;
        record({ type: 'coalesced', revision: item.revision });
      }
      return item.revision;
    }

    function observeRevision(value) {
      var revision = Number(value);
      if (Number.isFinite(revision) && revision >= 0) {
        nextRevision = Math.max(nextRevision, revision);
        completedRevision = Math.max(completedRevision, revision);
      }
      return nextRevision;
    }

    function inspect() {
      return {
        latestRevision: nextRevision,
        completedRevision: completedRevision,
        inFlightRevision: inFlight && inFlight.revision || null,
        pendingRevision: pending && pending.revision || null,
        history: history.map(function (entry) { return Object.assign({}, entry); })
      };
    }

    return Object.freeze({ enqueue: enqueue, observeRevision: observeRevision, inspect: inspect });
  }

  function combinePlayerStats(playerName, records) {
    var counts = (records || []).reduce(function (total, record) {
      total.handsPlayed += Number(record.handsPlayed || 0);
      total.vpipOpportunities += Number(record.vpipOpportunities || 0);
      total.vpipHands += Number(record.vpipHands || 0);
      total.pfrOpportunities += Number(record.pfrOpportunities || 0);
      total.pfrHands += Number(record.pfrHands || 0);
      total.preflopCallHands += Number(record.vpipDetails && record.vpipDetails.callHands || 0);
      total.preflopRaiseHands += Number(record.vpipDetails && record.vpipDetails.raiseHands || 0);
      total.walksExcluded += Number(record.vpipDetails && record.vpipDetails.walksExcluded || 0);
      total.postflopBets += Number(record.afDetails && record.afDetails.bets || 0);
      total.postflopRaises += Number(record.afDetails && record.afDetails.raises || 0);
      total.postflopCalls += Number(record.afDetails && record.afDetails.calls || 0);
      total.threeBetMade += Number(record.threeBetMade || 0);
      total.threeBetOpportunities += Number(record.threeBetOpportunities || 0);
      total.foldToThreeBet += Number(record.foldToThreeBet || 0);
      total.foldToThreeBetOpportunities += Number(record.foldToThreeBetOpportunities || 0);
      total.flopCBetMade += Number(record.flopCBetMade || 0);
      total.flopCBetOpportunities += Number(record.flopCBetOpportunities || 0);
      total.foldToFlopCBet += Number(record.foldToFlopCBet || 0);
      total.foldToFlopCBetOpportunities += Number(record.foldToFlopCBetOpportunities || 0);
      total.sawFlopForWTSD += Number(record.sawFlopForWTSD || 0);
      total.wentToShowdown += Number(record.wentToShowdown || 0);
      total.showdownsForWSD += Number(record.showdownsForWSD || 0);
      total.wonMoneyAtShowdown += Number(record.wonMoneyAtShowdown || 0);
      total.preflopTableSizeSum += Number(record.preflopTableSizeSum || 0);
      total.preflopTableSizeOpportunities += Number(record.preflopTableSizeOpportunities || 0);
      total.preflopTableSizeUnsupportedOpportunities += Number(record.preflopTableContextDetails && record.preflopTableContextDetails.unsupportedOpportunities || 0);
      return total;
    }, { handsPlayed: 0, vpipOpportunities: 0, vpipHands: 0, pfrOpportunities: 0, pfrHands: 0, preflopTableSizeSum: 0, preflopTableSizeOpportunities: 0, preflopTableSizeUnsupportedOpportunities: 0, preflopCallHands: 0, preflopRaiseHands: 0, walksExcluded: 0, postflopBets: 0, postflopRaises: 0, postflopCalls: 0, threeBetMade: 0, threeBetOpportunities: 0, foldToThreeBet: 0, foldToThreeBetOpportunities: 0, flopCBetMade: 0, flopCBetOpportunities: 0, foldToFlopCBet: 0, foldToFlopCBetOpportunities: 0, sawFlopForWTSD: 0, wentToShowdown: 0, showdownsForWSD: 0, wonMoneyAtShowdown: 0 });
    return statsFromCounts(playerName, counts);
  }

  var api = {
    addEvent: addEvent,
    applyPreflopContribution: applyPreflopContribution,
    applyPreflopContributionRange: applyPreflopContributionRange,
    applyFlopCBetContribution: applyFlopCBetContribution,
    applyFlopCBetContributionRange: applyFlopCBetContributionRange,
    applyShowdownContribution: applyShowdownContribution,
    applyShowdownContributionRange: applyShowdownContributionRange,
    detectBigBlindWalk: detectBigBlindWalk,
    computePlayerStats: computePlayerStats,
    computePlayerStatsByIdentity: computePlayerStatsByIdentity,
    authoritativeCounterFields: AUTHORITATIVE_COUNTER_FIELDS,
    authoritativeCounterSnapshot: authoritativeCounterSnapshot,
    authoritativeCounterRegressions: authoritativeCounterRegressions,
    createSerializedPersistenceQueue: createSerializedPersistenceQueue,
    combinePlayerStats: combinePlayerStats
  };
  root.PokerStats = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
