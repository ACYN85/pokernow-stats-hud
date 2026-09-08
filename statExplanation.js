/* Pure, bounded, isolated-world per-hand statistic explanations. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && !isSupportedRuntimePage(root.PokerNowRuntimeScope, window.location)) return;

  var SCHEMA_VERSION = 1;
  var DEFAULT_MAX_HANDS = 30;

  function isSupportedRuntimePage(scope, loc) {
    if (scope && typeof scope.isPokerNowGamePage === 'function') return scope.isPokerNowGamePage(loc);
    var host = String(loc && loc.hostname || '').toLowerCase();
    return String(loc && loc.protocol || '').toLowerCase() === 'https:' &&
      (host === 'pokernow.com' || host === 'www.pokernow.com') &&
      /^\/games\/[^/]+\/?$/.test(String(loc && loc.pathname || ''));
  }

  var REASON_TEXT = Object.freeze({
    voluntary_preflop_action: 'A voluntary preflop call, bet, or raise was recorded.',
    no_voluntary_preflop_action: 'No voluntary preflop action was recorded.',
    preflop_raise: 'A preflop raise was recorded.',
    no_preflop_raise: 'No preflop raise was recorded.',
    no_supported_preflop_opportunity: 'The finalized hand did not create a supported preflop denominator.',
    direct_fold_to_qualifying_three_bet: 'The player folded directly to the qualifying 3Bet.',
    direct_call_to_qualifying_three_bet: 'The player called the qualifying 3Bet.',
    direct_raise_to_qualifying_three_bet: 'The player raised directly over the qualifying 3Bet.',
    player_not_in_pot_before_three_bet: 'The player had not voluntarily entered before the qualifying 3Bet.',
    intervening_four_bet_changed_price: 'Another raise changed the price before this player responded.',
    short_raise_not_full_three_bet: 'The re-raise was not a qualifying full 3Bet.',
    missing_direct_response: 'No direct response was observed before finalization.',
    unsupported_action_order: 'The ordered action evidence was not sufficient for a supported decision.',
    three_bettor_not_eligible: 'The qualifying 3-bettor is not eligible for Fold-to-3Bet.',
    final_preflop_aggressor_bet_flop: 'The final preflop aggressor made the first qualifying flop bet.',
    aggressor_checked_flop: 'The final preflop aggressor checked when a CBet was available.',
    prior_donk_removed_cbet_opportunity: 'An opponent bet before the aggressor acted.',
    aggressor_all_in_before_flop: 'The final preflop aggressor was already all-in.',
    no_supported_final_preflop_aggressor: 'No supported final preflop aggressor was available.',
    unsupported_flop_order: 'The flop action order was unsupported or incomplete.',
    direct_fold_to_qualifying_cbet: 'The player folded directly to the qualifying flop CBet.',
    direct_call_to_qualifying_cbet: 'The player called the qualifying flop CBet.',
    direct_raise_to_qualifying_cbet: 'The player raised directly over the qualifying flop CBet.',
    already_responded_to_cbet: 'A later action did not replace the already-recorded direct CBet response.',
    not_facing_qualifying_cbet: 'The player did not face a qualifying flop CBet.',
    prior_donk_removed_cbet: 'A prior opposing flop bet prevented a qualifying CBet.',
    unsupported_side_pot_order: 'Side-pot action eligibility was not supported safely.',
    supported_flop_entry_and_contested_showdown: 'Supported flop entry and contested-showdown membership were recorded.',
    did_not_reach_contested_showdown: 'The player saw the flop but did not reach a supported contested showdown.',
    uncontested_river: 'The hand ended uncontested rather than at showdown.',
    showdown_membership_unsupported: 'Showdown membership could not be established safely.',
    positive_showdown_award: 'A supported positive contested award was recorded.',
    complete_showdown_no_positive_award: 'Complete settlement proved no positive contested award for this player.',
    not_in_showdown_denominator: 'The player was not in the supported W$SD denominator.',
    incomplete_settlement: 'Settlement was incomplete or unresolved.',
    award_vs_return_ambiguous: 'Award and returned-chip evidence could not be separated safely.'
  });

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function boundedInteger(value, fallback, minimum, maximum) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
  }

  function uniqueStrings(values) {
    return Array.from(new Set((values || []).filter(function (value) {
      return value !== null && value !== undefined && String(value) !== '';
    }).map(String)));
  }

  function identityAliases(identity) {
    identity = identity || {};
    return uniqueStrings([identity.handId, identity.lifecycleHandId]);
  }

  function semanticContribution(opportunity, result) {
    if (opportunity === null || result === null) return null;
    if (opportunity !== true) return '0/0';
    return result === true ? '1/1' : '0/1';
  }

  function counterContribution(numerator, denominator) {
    numerator = Number(numerator) > 0 ? 1 : 0;
    denominator = Number(denominator) > 0 ? 1 : 0;
    return String(denominator ? numerator : 0) + '/' + String(denominator);
  }

  function statusFor(opportunity, result) {
    if (opportunity === null || result === null) return 'unsupported';
    return opportunity === true ? 'counted' : 'not_applicable';
  }

  function normalizeReason(sourceReason, map, fallback) {
    sourceReason = sourceReason === null || sourceReason === undefined ? '' : String(sourceReason);
    return map[sourceReason] || sourceReason || fallback;
  }

  function findAttachment(integration, playerId) {
    var records = integration && integration.attachmentResults || [];
    return records.find(function (record) { return String(record && record.playerId || '') === String(playerId); }) || null;
  }

  function evidenceSummary(evidence) {
    return (evidence || []).slice(0, 8).map(function (entry) {
      return {
        sequence: Number.isFinite(Number(entry && entry.sequence)) ? Number(entry.sequence) : null,
        sourceSequence: Number.isFinite(Number(entry && entry.sourceSequence)) ? Number(entry.sourceSequence) : null,
        street: entry && entry.street || null,
        playerId: !entry || entry.playerId === null || entry.playerId === undefined ? null : String(entry.playerId),
        type: entry && entry.type || entry && entry.kind || null
      };
    });
  }

  function explanationEntry(options) {
    var attachment = options.attachment || null;
    var counts = options.counts || {};
    var reasonCode = options.reasonCode || options.sourceReason || 'not_evaluated';
    return {
      decision: {
        opportunity: options.opportunity,
        result: options.result
      },
      semanticContribution: semanticContribution(options.opportunity, options.result),
      counterContribution: counterContribution(counts.numerator, counts.denominator),
      status: statusFor(options.opportunity, options.result),
      reasonCode: reasonCode,
      reasonText: REASON_TEXT[reasonCode] || String(options.sourceReason || reasonCode).replace(/_/g, ' '),
      sourceReason: options.sourceReason || null,
      contributionId: attachment && attachment.attached === true ? attachment.contributionId || null : null,
      candidateContributionId: attachment && attachment.contributionId || options.candidateContributionId || null,
      attachment: attachment ? {
        attached: attachment.attached === true,
        duplicate: attachment.duplicate === true || attachment.rejectedAsDuplicate === true,
        reason: attachment.reason || null,
        eventId: attachment.eventId || null,
        targetHandId: attachment.targetHandId || null
      } : null,
      evidence: evidenceSummary(options.evidence)
    };
  }

  var F3B_REASONS = Object.freeze({
    opener_folded_facing_three_bet: 'direct_fold_to_qualifying_three_bet',
    participant_folded_facing_three_bet: 'direct_fold_to_qualifying_three_bet',
    opener_called_three_bet: 'direct_call_to_qualifying_three_bet',
    participant_called_three_bet: 'direct_call_to_qualifying_three_bet',
    opener_all_in_call_facing_three_bet: 'direct_call_to_qualifying_three_bet',
    participant_all_in_call_facing_three_bet: 'direct_call_to_qualifying_three_bet',
    opener_four_bet: 'direct_raise_to_qualifying_three_bet',
    participant_raised_facing_three_bet: 'direct_raise_to_qualifying_three_bet',
    opener_all_in_raise_facing_three_bet: 'direct_raise_to_qualifying_three_bet',
    participant_all_in_raise_facing_three_bet: 'direct_raise_to_qualifying_three_bet',
    not_voluntarily_entered_before_three_bet: 'player_not_in_pot_before_three_bet',
    action_did_not_return_before_four_bet: 'intervening_four_bet_changed_price',
    intervening_raise_legality_unknown: 'unsupported_action_order',
    short_non_full_reraise_does_not_prove_reopening: 'short_raise_not_full_three_bet',
    reraise_fullness_unknown: 'short_raise_not_full_three_bet',
    opener_response_not_observed: 'missing_direct_response',
    participant_response_not_observed: 'missing_direct_response',
    unsupported_opener_response: 'unsupported_action_order',
    unsupported_participant_response: 'unsupported_action_order',
    qualifying_three_bettor_not_eligible: 'three_bettor_not_eligible'
  });

  var CBET_REASONS = Object.freeze({
    qualifying_flop_cbet: 'final_preflop_aggressor_bet_flop',
    aggressor_checked_when_cbet_was_available: 'aggressor_checked_flop',
    opponent_bet_before_aggressor_action: 'prior_donk_removed_cbet_opportunity',
    final_preflop_aggressor_already_all_in: 'aggressor_all_in_before_flop',
    no_qualifying_preflop_aggressor: 'no_supported_final_preflop_aggressor',
    FINAL_AGGRESSOR_UNSUPPORTED: 'no_supported_final_preflop_aggressor',
    FLOP_ORDERING_UNSUPPORTED: 'unsupported_flop_order',
    aggressor_flop_decision_not_observed: 'unsupported_flop_order',
    SIDE_POT_ELIGIBILITY_UNSUPPORTED: 'unsupported_side_pot_order'
  });

  var FCB_REASONS = Object.freeze({
    folded_directly_to_qualifying_cbet: 'direct_fold_to_qualifying_cbet',
    continued_by_calling_qualifying_cbet: 'direct_call_to_qualifying_cbet',
    continued_by_raising_qualifying_cbet: 'direct_raise_to_qualifying_cbet',
    direct_response_not_observed: 'missing_direct_response',
    unsupported_direct_response: 'missing_direct_response',
    intervening_raise_changed_price_before_response: 'not_facing_qualifying_cbet',
    no_qualifying_cbet: 'not_facing_qualifying_cbet',
    opponent_bet_before_aggressor_action: 'prior_donk_removed_cbet',
    SIDE_POT_ELIGIBILITY_UNSUPPORTED: 'unsupported_side_pot_order'
  });

  function candidateId(prefix, contribution, playerId) {
    var identity = contribution && contribution.handIdentity || {};
    var aliases = uniqueStrings([identity.lifecycleHandId, identity.handId]);
    if (!aliases.length) return null;
    return [prefix, Number(contribution.reducerVersion || contribution.version || contribution.schemaVersion || 1), aliases[0], String(playerId)].join(':');
  }

  function laterActionsIgnored(record, playerId, evidence) {
    var sequence = (evidence || []).reduce(function (maximum, entry) {
      return Number.isFinite(Number(entry && entry.sequence)) ? Math.max(maximum, Number(entry.sequence)) : maximum;
    }, -Infinity);
    if (!Number.isFinite(sequence)) return [];
    return (record && record.actions || []).filter(function (action) {
      return String(action && action.playerId || '') === String(playerId) && Number(action.sequence) > sequence;
    }).slice(0, 5).map(function (action) {
      return { sequence: action.sequence, street: action.street, type: action.type, reasonCode: 'already_responded_to_cbet' };
    });
  }

  function basicEntry(value, stat) {
    value = value || {};
    var opportunities = Number(value.opportunities) > 0 ? 1 : 0;
    var made = Number(value.made) > 0 ? 1 : 0;
    var reason = opportunities
      ? made ? stat === 'vpip' ? 'voluntary_preflop_action' : 'preflop_raise'
        : stat === 'vpip' ? 'no_voluntary_preflop_action' : 'no_preflop_raise'
      : 'no_supported_preflop_opportunity';
    return explanationEntry({
      opportunity: opportunities ? true : false,
      result: opportunities ? made === 1 : false,
      reasonCode: reason,
      sourceReason: reason,
      counts: { numerator: made, denominator: opportunities },
      evidence: []
    });
  }

  function preflopEntries(contribution, integration, playerId) {
    var player = contribution && contribution.players && contribution.players[playerId] || {};
    var threeBet = player.threeBet || { opportunity: null, made: null, reason: 'preflop_reducer_result_missing', evidence: [] };
    var fold = player.foldToThreeBet || { opportunity: null, folded: null, reason: 'preflop_reducer_result_missing', evidence: [] };
    var attachment = findAttachment(integration, playerId);
    var attachmentCounts = attachment && (attachment.after || attachment.counts) || {};
    return {
      threeBet: explanationEntry({
        opportunity: threeBet.opportunity,
        result: threeBet.made,
        reasonCode: threeBet.reason,
        sourceReason: threeBet.reason,
        evidence: threeBet.evidence,
        attachment: attachment,
        candidateContributionId: candidateId('preflop', contribution, playerId),
        counts: { numerator: attachmentCounts.threeBetMade || 0, denominator: attachmentCounts.threeBetOpportunities || 0 }
      }),
      foldToThreeBet: explanationEntry({
        opportunity: fold.opportunity,
        result: fold.folded,
        reasonCode: normalizeReason(fold.reason, F3B_REASONS, 'not_facing_qualifying_three_bet'),
        sourceReason: fold.reason,
        evidence: fold.evidence,
        attachment: attachment,
        candidateContributionId: candidateId('preflop', contribution, playerId),
        counts: { numerator: attachmentCounts.foldToThreeBet || 0, denominator: attachmentCounts.foldToThreeBetOpportunities || 0 }
      })
    };
  }

  function flopEntries(record, contribution, integration, playerId) {
    var player = contribution && contribution.players && contribution.players[playerId] || {};
    var cbet = player.flopCBet || { opportunity: null, made: null, reason: 'flop_cbet_reducer_result_missing', evidence: [] };
    var fold = player.foldToFlopCBetDecision || { opportunity: null, folded: null, reason: 'flop_cbet_reducer_result_missing', evidence: [] };
    var attachment = findAttachment(integration, playerId);
    var attachmentCounts = attachment && (attachment.after || attachment.counts) || {};
    var foldEntry = explanationEntry({
      opportunity: fold.opportunity,
      result: fold.folded,
      reasonCode: normalizeReason(fold.reason, FCB_REASONS, 'not_facing_qualifying_cbet'),
      sourceReason: fold.reason,
      evidence: fold.evidence,
      attachment: attachment,
      candidateContributionId: candidateId('flop-cbet', contribution, playerId),
      counts: { numerator: attachmentCounts.foldToFlopCBet || 0, denominator: attachmentCounts.foldToFlopCBetOpportunities || 0 }
    });
    foldEntry.laterActionsIgnored = laterActionsIgnored(record, playerId, fold.evidence);
    return {
      flopCBet: explanationEntry({
        opportunity: cbet.opportunity,
        result: cbet.made,
        reasonCode: normalizeReason(cbet.reason, CBET_REASONS, 'not_facing_flop_cbet_opportunity'),
        sourceReason: cbet.reason,
        evidence: cbet.evidence,
        attachment: attachment,
        candidateContributionId: candidateId('flop-cbet', contribution, playerId),
        counts: { numerator: attachmentCounts.flopCBetMade || 0, denominator: attachmentCounts.flopCBetOpportunities || 0 }
      }),
      foldToFlopCBet: foldEntry
    };
  }

  function wtsdReason(player, contribution) {
    if (player.sawFlopForWTSD === null || player.wentToShowdown === null) return player.unsupportedReason || 'showdown_membership_unsupported';
    if (player.sawFlopForWTSD !== 1) return 'player_did_not_see_flop';
    if (player.wentToShowdown === 1) return 'supported_flop_entry_and_contested_showdown';
    if (contribution && contribution.hand && contribution.hand.uncontested === true) return 'uncontested_river';
    return 'did_not_reach_contested_showdown';
  }

  function wsdReason(player) {
    var source = player.wonMoneyAtShowdownCandidateReason || player.unsupportedReason || '';
    if (player.wentToShowdown !== 1) return player.wentToShowdown === null ? 'showdown_membership_unsupported' : 'not_in_showdown_denominator';
    if (player.wonMoneyAtShowdownCandidateSupported === true) return player.wonMoneyAtShowdownCandidate === 1 ? 'positive_showdown_award' : 'complete_showdown_no_positive_award';
    if (source === 'settlement_unresolved' || /missing|unresolved|incomplete/.test(source)) return 'incomplete_settlement';
    if (/return|refund/.test(source)) return 'award_vs_return_ambiguous';
    return source || 'settlement_unsupported';
  }

  function showdownEntries(contribution, integration, playerId) {
    var player = contribution && contribution.players && contribution.players[playerId] || {
      sawFlopForWTSD: null,
      wentToShowdown: null,
      wonMoneyAtShowdownCandidate: null,
      wonMoneyAtShowdownCandidateSupported: false,
      wonMoneyAtShowdownCandidateReason: 'showdown_reducer_result_missing',
      unsupportedReason: 'showdown_reducer_result_missing',
      evidence: { flop: [], showdown: [], settlement: [] }
    };
    var attachment = findAttachment(integration, playerId);
    var attachmentCounts = attachment && (attachment.after || attachment.counts) || {};
    var sawFlop = player.sawFlopForWTSD === 1 ? true : player.sawFlopForWTSD === 0 ? false : null;
    var reached = player.wentToShowdown === 1 ? true : player.wentToShowdown === 0 ? false : null;
    var wsdOpportunity = reached === true
      ? player.wonMoneyAtShowdownCandidateSupported === true ? true : null
      : reached === false ? false : null;
    var wsdResult = wsdOpportunity === true
      ? player.wonMoneyAtShowdownCandidate === 1 ? true : player.wonMoneyAtShowdownCandidate === 0 ? false : null
      : wsdOpportunity === false ? false : null;
    return {
      wtsd: explanationEntry({
        opportunity: sawFlop,
        result: sawFlop === true ? reached : false,
        reasonCode: wtsdReason(player, contribution),
        sourceReason: player.unsupportedReason || wtsdReason(player, contribution),
        evidence: (player.evidence && player.evidence.flop || []).concat(player.evidence && player.evidence.showdown || []),
        attachment: attachment,
        candidateContributionId: candidateId('showdown-stats', contribution, playerId),
        counts: { numerator: attachmentCounts.wentToShowdown || 0, denominator: attachmentCounts.sawFlopForWTSD || 0 }
      }),
      wsd: explanationEntry({
        opportunity: wsdOpportunity,
        result: wsdResult,
        reasonCode: wsdReason(player),
        sourceReason: player.wonMoneyAtShowdownCandidateReason || player.unsupportedReason,
        evidence: player.evidence && player.evidence.settlement || [],
        attachment: attachment,
        candidateContributionId: candidateId('showdown-stats', contribution, playerId),
        counts: { numerator: attachmentCounts.wonMoneyAtShowdown || 0, denominator: attachmentCounts.showdownsForWSD || 0 }
      })
    };
  }

  function build(input) {
    input = input || {};
    var record = input.semanticRecord || {};
    var identity = record.handIdentity || {};
    var playerIds = uniqueStrings((record.players || []).map(function (player) { return player && player.playerId; }).concat(
      Object.keys(input.preflopContribution && input.preflopContribution.players || {}),
      Object.keys(input.flopCBetContribution && input.flopCBetContribution.players || {}),
      Object.keys(input.showdownContribution && input.showdownContribution.players || {})
    ));
    var players = {};
    playerIds.forEach(function (playerId) {
      var preflop = preflopEntries(input.preflopContribution, input.preflopIntegration, playerId);
      var flop = flopEntries(record, input.flopCBetContribution, input.flopCBetIntegration, playerId);
      var showdown = showdownEntries(input.showdownContribution, input.showdownIntegration, playerId);
      players[playerId] = {
        vpip: basicEntry(input.basicContributionsByPlayer && input.basicContributionsByPlayer[playerId] && input.basicContributionsByPlayer[playerId].vpip, 'vpip'),
        pfr: basicEntry(input.basicContributionsByPlayer && input.basicContributionsByPlayer[playerId] && input.basicContributionsByPlayer[playerId].pfr, 'pfr'),
        threeBet: preflop.threeBet,
        foldToThreeBet: preflop.foldToThreeBet,
        flopCBet: flop.flopCBet,
        foldToFlopCBet: flop.foldToFlopCBet,
        wtsd: showdown.wtsd,
        wsd: showdown.wsd
      };
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      handId: identity.handId === null || identity.handId === undefined ? null : String(identity.handId),
      lifecycleHandId: identity.lifecycleHandId === null || identity.lifecycleHandId === undefined ? null : String(identity.lifecycleHandId),
      finalizedAt: Number.isFinite(Number(input.finalizedAt)) ? Number(input.finalizedAt) : Date.now(),
      finalizationReason: record.provenance && record.provenance.finalizationReason || null,
      players: players,
      ambiguities: {
        preflop: clone(input.preflopContribution && input.preflopContribution.ambiguities || []),
        flopCBet: clone(input.flopCBetContribution && input.flopCBetContribution.ambiguities || []),
        showdown: clone(input.showdownContribution && input.showdownContribution.ambiguities || [])
      },
      provenance: {
        source: 'finalized-semantic-hand-and-authoritative-stat-attachments',
        reducerVersions: {
          preflop: input.preflopContribution && input.preflopContribution.reducerVersion || null,
          flopCBet: input.flopCBetContribution && input.flopCBetContribution.reducerVersion || null,
          showdown: input.showdownContribution && input.showdownContribution.reducerVersion || null
        }
      }
    };
  }

  function createState(options) {
    options = options || {};
    return { schemaVersion: SCHEMA_VERSION, maxHands: boundedInteger(options.maxHands, DEFAULT_MAX_HANDS, 1, 50), records: [] };
  }

  function recordExplanation(state, input) {
    if (!state || !Array.isArray(state.records)) throw new TypeError('A statistic explanation state is required.');
    var explanation = build(input);
    var aliases = identityAliases(explanation);
    var existing = state.records.find(function (candidate) {
      return identityAliases(candidate).some(function (alias) { return aliases.includes(alias); });
    });
    if (existing) return { recorded: false, duplicate: true, explanation: clone(existing) };
    state.records.push(explanation);
    while (state.records.length > state.maxHands) state.records.shift();
    return { recorded: true, duplicate: false, explanation: clone(explanation) };
  }

  function latest(state) {
    return clone(state && state.records && state.records[state.records.length - 1] || null);
  }

  function get(state, handId) {
    handId = String(handId === null || handId === undefined ? '' : handId);
    return clone((state && state.records || []).find(function (record) { return identityAliases(record).includes(handId); }) || null);
  }

  function list(state) {
    return clone(state && state.records || []);
  }

  function summarize(explanation) {
    explanation = explanation || null;
    if (!explanation || !explanation.players) return [];
    var labels = { vpip: 'VPIP', pfr: 'PFR', threeBet: '3B', foldToThreeBet: 'F3B', flopCBet: 'CBet', foldToFlopCBet: 'FCB', wtsd: 'WTSD', wsd: 'W$SD' };
    var lines = [];
    Object.keys(explanation.players).forEach(function (playerId) {
      Object.keys(labels).forEach(function (stat) {
        var entry = explanation.players[playerId][stat];
        if (!entry || entry.status === 'not_applicable') return;
        lines.push(playerId + ': ' + labels[stat] + ' ' + (entry.semanticContribution === null ? 'unsupported' : entry.semanticContribution) + ' - ' + entry.reasonText);
      });
    });
    return lines;
  }

  var api = Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_MAX_HANDS: DEFAULT_MAX_HANDS,
    REASON_TEXT: REASON_TEXT,
    createState: createState,
    build: build,
    record: recordExplanation,
    latest: latest,
    get: get,
    list: list,
    summarize: summarize
  });
  root.PokerHandStatExplanation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
