/* Pure presentation model for the existing settings-panel Hand Stat Inspector. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && !isSupportedRuntimePage(root.PokerNowRuntimeScope, window.location)) return;

  var STAT_ORDER = Object.freeze(['vpip', 'pfr', 'threeBet', 'foldToThreeBet', 'flopCBet', 'foldToFlopCBet', 'wtsd', 'wsd']);
  var LABELS = Object.freeze({
    vpip: 'VPIP', pfr: 'PFR', threeBet: '3B', foldToThreeBet: 'F3B',
    flopCBet: 'CB', foldToFlopCBet: 'FCB', wtsd: 'WTSD', wsd: 'W$SD'
  });
  var CONCISE_REASONS = Object.freeze({
    voluntary_preflop_action: 'voluntary preflop action',
    no_voluntary_preflop_action: 'no voluntary preflop action',
    preflop_raise: 'raised preflop',
    no_preflop_raise: 'did not raise preflop',
    no_supported_preflop_opportunity: 'no supported preflop opportunity',
    qualifying_three_bet: 'qualifying 3Bet',
    qualifying_squeeze: 'qualifying squeeze 3Bet',
    direct_fold_to_qualifying_three_bet: 'folded to qualifying 3Bet',
    direct_call_to_qualifying_three_bet: 'called qualifying 3Bet',
    direct_raise_to_qualifying_three_bet: 'raised over qualifying 3Bet',
    player_not_in_pot_before_three_bet: 'not in pot before qualifying 3Bet',
    intervening_four_bet_changed_price: '4Bet changed the price before response',
    short_raise_not_full_three_bet: 'short raise was not a full 3Bet',
    missing_direct_response: 'direct response was not observed',
    unsupported_action_order: 'action order was unsupported',
    three_bettor_not_eligible: '3-bettor is not eligible for F3B',
    final_preflop_aggressor_bet_flop: 'qualifying flop CBet',
    aggressor_checked_flop: 'checked with a CBet opportunity',
    prior_donk_removed_cbet_opportunity: 'prior donk removed CBet opportunity',
    aggressor_all_in_before_flop: 'aggressor was already all-in',
    no_supported_final_preflop_aggressor: 'final preflop aggressor unsupported',
    unsupported_flop_order: 'flop order was unsupported',
    direct_fold_to_qualifying_cbet: 'folded to qualifying CBet',
    direct_call_to_qualifying_cbet: 'called qualifying CBet',
    direct_raise_to_qualifying_cbet: 'raised over qualifying CBet',
    already_responded_to_cbet: 'direct CBet response was already frozen',
    not_facing_qualifying_cbet: 'not facing a qualifying CBet',
    prior_donk_removed_cbet: 'prior donk prevented a qualifying CBet',
    unsupported_side_pot_order: 'side-pot order was unsupported',
    supported_flop_entry_and_contested_showdown: 'saw flop and reached contested showdown',
    did_not_reach_contested_showdown: 'saw flop, did not reach showdown',
    uncontested_river: 'hand ended uncontested',
    showdown_membership_unsupported: 'showdown membership unsupported',
    positive_showdown_award: 'positive showdown award',
    complete_showdown_no_positive_award: 'no positive showdown award',
    not_in_showdown_denominator: 'not in showdown denominator',
    incomplete_settlement: 'settlement incomplete',
    award_vs_return_ambiguous: 'award versus return ambiguous'
  });
  var MEANINGFUL_NO_OPPORTUNITY = Object.freeze(new Set([
    'intervening_four_bet_changed_price',
    'short_raise_not_full_three_bet',
    'prior_donk_removed_cbet_opportunity',
    'aggressor_all_in_before_flop',
    'prior_donk_removed_cbet',
    'not_in_showdown_denominator'
  ]));

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

  function identityAliases(explanation) {
    var values = [explanation && explanation.handId, explanation && explanation.lifecycleHandId];
    return Array.from(new Set(values.filter(function (value) { return value !== null && value !== undefined && String(value) !== ''; }).map(String)));
  }

  function primaryIdentity(explanation) {
    return explanation && explanation.handId !== null && explanation.handId !== undefined && String(explanation.handId) !== ''
      ? String(explanation.handId)
      : explanation && explanation.lifecycleHandId !== null && explanation.lifecycleHandId !== undefined && String(explanation.lifecycleHandId) !== ''
        ? String(explanation.lifecycleHandId)
        : null;
  }

  function createState() {
    return { open: false, selectedHandId: null, showAll: false };
  }

  function newestFirst(history) {
    return clone(Array.isArray(history) ? history : []).reverse();
  }

  function selectedExplanation(state, history) {
    var records = newestFirst(history);
    if (!records.length) return null;
    var selected = String(state && state.selectedHandId || '');
    return records.find(function (record) { return identityAliases(record).includes(selected); }) || records[0];
  }

  function open(state, history) {
    state.open = true;
    var selected = selectedExplanation(state, history);
    state.selectedHandId = selected ? primaryIdentity(selected) : null;
    return state;
  }

  function close(state) {
    state.open = false;
    return state;
  }

  function select(state, history, handId) {
    var requested = String(handId === null || handId === undefined ? '' : handId);
    var match = newestFirst(history).find(function (record) { return identityAliases(record).includes(requested); });
    if (match) state.selectedHandId = primaryIdentity(match);
    return Boolean(match);
  }

  function toggleShowAll(state) {
    state.showAll = !state.showAll;
    return state.showAll;
  }

  function shortStableId(playerId) {
    playerId = String(playerId || 'unknown');
    return playerId.length <= 16 ? playerId : playerId.slice(0, 8) + '\u2026' + playerId.slice(-5);
  }

  function conciseReason(entry) {
    var code = entry && entry.reasonCode || '';
    return CONCISE_REASONS[code] || String(entry && entry.reasonText || code || 'no explanation available').replace(/[.\s]+$/, '');
  }

  function displayValue(entry) {
    if (!entry || entry.semanticContribution === null || entry.status === 'unsupported') return 'Unsupported';
    return entry.semanticContribution || '0/0';
  }

  function valueKind(entry) {
    var value = displayValue(entry);
    return value === 'Unsupported' ? 'unsupported' : value === '1/1' ? 'made' : value === '0/1' ? 'declined' : 'none';
  }

  function usefulEntry(statId, entry, player, showAll) {
    if (!entry) return false;
    if (showAll || entry.status === 'counted' || entry.status === 'unsupported') return true;
    if (entry.semanticContribution !== '0/0') return false;
    if (MEANINGFUL_NO_OPPORTUNITY.has(entry.reasonCode)) return true;
    return statId === 'wsd' && player && player.wtsd && player.wtsd.semanticContribution !== '0/0';
  }

  function playerRows(player, showAll) {
    return STAT_ORDER.filter(function (statId) { return usefulEntry(statId, player && player[statId], player, showAll); }).map(function (statId) {
      var entry = player[statId];
      return {
        statId: statId,
        label: LABELS[statId],
        value: displayValue(entry),
        valueKind: valueKind(entry),
        reasonCode: entry.reasonCode || null,
        reason: conciseReason(entry)
      };
    });
  }

  function compactFinalizationReason(record) {
    var reason = String(record && record.finalizationReason || 'Finalized').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return reason.length > 72 ? reason.slice(0, 69) + '\u2026' : reason;
  }

  function buildModel(state, history) {
    var records = newestFirst(history);
    var selected = selectedExplanation(state, history);
    if (selected && state && !identityAliases(selected).includes(String(state.selectedHandId || ''))) state.selectedHandId = primaryIdentity(selected);
    return {
      open: Boolean(state && state.open),
      empty: records.length === 0,
      showAll: Boolean(state && state.showAll),
      hands: records.map(function (record, index) {
        return {
          handId: primaryIdentity(record),
          authoritativeHandId: record.handId || null,
          lifecycleHandId: record.lifecycleHandId || null,
          orderLabel: index === 0 ? 'Latest' : index + ' prior',
          finalizationReason: compactFinalizationReason(record),
          selected: Boolean(selected && identityAliases(selected).some(function (alias) { return identityAliases(record).includes(alias); }))
        };
      }),
      selectedExplanation: clone(selected),
      selectedHand: selected ? {
        handId: primaryIdentity(selected),
        authoritativeHandId: selected.handId || null,
        lifecycleHandId: selected.lifecycleHandId || null,
        finalizationReason: compactFinalizationReason(selected),
        players: Object.keys(selected.players || {}).map(function (playerId) {
          return { playerId: playerId, label: 'Player ' + shortStableId(playerId), rows: playerRows(selected.players[playerId], Boolean(state && state.showAll)) };
        })
      } : null
    };
  }

  function summaryText(model) {
    if (!model || !model.selectedHand) return 'No finalized hand explanations are available.';
    var lines = ['Hand ' + model.selectedHand.handId, 'Finalization: ' + model.selectedHand.finalizationReason];
    model.selectedHand.players.forEach(function (player) {
      lines.push('', player.label);
      player.rows.forEach(function (row) { lines.push(row.label + ' ' + row.value + ' - ' + row.reason); });
    });
    return lines.join('\n');
  }

  function jsonText(model) {
    return JSON.stringify(model && model.selectedExplanation || null, null, 2);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function renderHtml(model) {
    if (!model || !model.open) return '';
    var history = model.hands.map(function (hand) {
      return '<li><button type="button" class="pnhud-hand-stat-history-item' + (hand.selected ? ' active' : '') + '" data-pnhud-inspector-hand-id="' + escapeHtml(hand.handId) + '" data-pnhud-inspector-focus="hand:' + escapeHtml(hand.handId) + '" aria-current="' + (hand.selected ? 'true' : 'false') + '"><span>' + escapeHtml(hand.orderLabel) + '</span><strong>' + escapeHtml(hand.authoritativeHandId || hand.lifecycleHandId || 'Unknown hand') + '</strong><small>' + escapeHtml(hand.finalizationReason) + '</small></button></li>';
    }).join('');
    var detail = '<div class="pnhud-hand-stat-empty" role="status">No finalized hand explanations yet. Complete a hand and it will appear here.</div>';
    if (model.selectedHand) {
      var players = model.selectedHand.players.map(function (player) {
        var rows = player.rows.length ? player.rows.map(function (row) {
          return '<div class="pnhud-hand-stat-row pnhud-hand-stat-' + escapeHtml(row.valueKind) + '"><dt>' + escapeHtml(row.label) + '</dt><dd><strong>' + escapeHtml(row.value) + '</strong><span>\u2014 ' + escapeHtml(row.reason) + '</span></dd></div>';
        }).join('') : '<p class="pnhud-settings-help">No relevant decisions in the filtered view.</p>';
        return '<section class="pnhud-hand-stat-player"><h4>' + escapeHtml(player.label) + '</h4><dl>' + rows + '</dl></section>';
      }).join('');
      detail = '<div class="pnhud-hand-stat-detail-heading"><div><strong>' + escapeHtml(model.selectedHand.authoritativeHandId || model.selectedHand.lifecycleHandId) + '</strong><small>' + escapeHtml(model.selectedHand.finalizationReason) + '</small></div><button type="button" class="pnhud-hand-stat-show-all" data-pnhud-inspector-focus="show-all" aria-pressed="' + (model.showAll ? 'true' : 'false') + '">' + (model.showAll ? 'Show useful only' : 'Show all') + '</button></div>' + players;
    }
    return '<section class="pnhud-hand-stat-inspector" role="dialog" aria-modal="false" aria-labelledby="pnhud-hand-stat-inspector-title"><div class="pnhud-hand-stat-inspector-heading"><div><h3 id="pnhud-hand-stat-inspector-title">Hand Stat Inspector</h3><p>Read-only finalized-hand decisions</p></div><button type="button" class="pnhud-close-hand-stat-inspector" data-pnhud-inspector-focus="close" aria-label="Close Hand Stat Inspector">\u00d7</button></div><div class="pnhud-hand-stat-inspector-layout"><aside class="pnhud-hand-stat-history" tabindex="0" aria-label="Recent finalized hands"><ol>' + history + '</ol></aside><div class="pnhud-hand-stat-detail" tabindex="0" role="region" aria-label="Selected hand statistic decisions">' + detail + '</div></div><div class="pnhud-hand-stat-copy-actions"><button type="button" class="pnhud-copy-hand-stat-summary" data-pnhud-inspector-focus="copy-summary"' + (model.selectedHand ? '' : ' disabled') + '>Copy Hand Summary</button><button type="button" class="pnhud-copy-hand-stat-json" data-pnhud-inspector-focus="copy-json"' + (model.selectedHand ? '' : ' disabled') + '>Copy JSON</button><span class="pnhud-hand-stat-copy-status" role="status" aria-live="polite"></span></div></section>';
  }

  var api = Object.freeze({
    STAT_ORDER: STAT_ORDER,
    LABELS: LABELS,
    createState: createState,
    open: open,
    close: close,
    select: select,
    toggleShowAll: toggleShowAll,
    buildModel: buildModel,
    summaryText: summaryText,
    jsonText: jsonText,
    renderHtml: renderHtml,
    shortStableId: shortStableId
  });
  root.PokerHandStatInspector = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
