/* Pure local browse/search/sort presentation for lightweight Career player summaries. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerTrackedPlayers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SORT_RECENT = 'recent';
  var SORT_HANDS = 'hands';
  var SORT_NAME = 'name';
  var SORT_OPTIONS = Object.freeze([SORT_RECENT, SORT_HANDS, SORT_NAME]);

  function esc(value) {
    return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, function (character) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
    });
  }

  function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }
  function normalizedText(value) { return text(value).toLocaleLowerCase(); }
  function validSort(value) { return SORT_OPTIONS.indexOf(value) >= 0 ? value : SORT_RECENT; }
  function hands(value) { var number = Number(value); return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0; }
  function timestamp(value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number > 8640000000000000) return null;
    return Number.isFinite(new Date(number).getTime()) ? number : null;
  }
  function displayName(value) { return text(value) || 'Unknown player'; }

  function normalizeSummaries(rows) {
    var byId = new Map();
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var playerId = text(row && row.playerId);
      if (!playerId) return;
      var normalized = {
        playerId: playerId,
        latestDisplayName: displayName(row.latestDisplayName),
        hands: hands(row.hands),
        lastSeenAt: timestamp(row.lastSeenAt),
        revision: Number.isFinite(Number(row.revision)) ? Number(row.revision) : 0,
        summaryVersion: Number.isFinite(Number(row.summaryVersion)) ? Number(row.summaryVersion) : 0
      };
      var previous = byId.get(playerId);
      if (!previous || normalized.revision >= previous.revision) byId.set(playerId, normalized);
    });
    return Array.from(byId.values());
  }

  function compareId(left, right) { return left.playerId.localeCompare(right.playerId); }
  function compareName(left, right) {
    var compared = normalizedText(left.latestDisplayName).localeCompare(normalizedText(right.latestDisplayName));
    return compared || compareId(left, right);
  }
  function compareRecent(left, right) {
    var leftTime = timestamp(left.lastSeenAt); var rightTime = timestamp(right.lastSeenAt);
    if (leftTime !== null && rightTime === null) return -1;
    if (leftTime === null && rightTime !== null) return 1;
    if (leftTime !== rightTime) return (rightTime || 0) - (leftTime || 0);
    return compareId(left, right);
  }
  function compareHands(left, right) {
    var compared = hands(right.hands) - hands(left.hands);
    return compared || compareId(left, right);
  }

  function visibleRows(summaries, search, sort) {
    var needle = normalizedText(search);
    var filtered = normalizeSummaries(summaries).filter(function (row) {
      return !needle || normalizedText(row.latestDisplayName).includes(needle) || normalizedText(row.playerId).includes(needle);
    });
    return filtered.sort(validSort(sort) === SORT_HANDS ? compareHands : validSort(sort) === SORT_NAME ? compareName : compareRecent);
  }

  function shortId(playerId) {
    var id = text(playerId);
    return id.length > 12 ? id.slice(0, 6) + '\u2026' + id.slice(-4) : id;
  }

  function localDayNumber(value) {
    var date = new Date(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }
  function formatLastSeen(value, now) {
    var time = timestamp(value);
    if (time === null) return { text: 'Last seen unavailable', title: '' };
    var date = new Date(time); var today = localDayNumber(now === undefined ? Date.now() : now); var day = localDayNumber(time);
    var dayDifference = Math.round((today - day) / 86400000);
    var label = dayDifference === 0 ? 'Today' : dayDifference === 1 ? 'Yesterday' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return { text: 'Last seen ' + label, title: date.toLocaleString() };
  }

  function resultCount(count, total, search) {
    if (normalizedText(search)) return count + ' of ' + total + ' ' + (total === 1 ? 'player' : 'players');
    return total + ' tracked ' + (total === 1 ? 'player' : 'players');
  }

  function rowHtml(row, now) {
    var seen = formatLastSeen(row.lastSeenAt, now);
    var id = shortId(row.playerId);
    return '<button type="button" class="pnhud-tracked-player-row" data-tracked-player-id="' + esc(row.playerId) + '" data-tracked-player-name="' + esc(row.latestDisplayName) + '" aria-label="Open ' + esc(row.latestDisplayName) + ' player dashboard">' +
      '<span class="pnhud-tracked-player-primary"><strong>' + esc(row.latestDisplayName) + '</strong><small>' + esc(row.hands) + ' ' + (row.hands === 1 ? 'hand' : 'hands') + ' \u00b7 <span title="' + esc(seen.title) + '">' + esc(seen.text) + '</span></small></span>' +
      '<span class="pnhud-tracked-player-id" title="Stable player ID: ' + esc(row.playerId) + '">' + esc(id) + '</span></button>';
  }

  function bodyHtml(state, rows) {
    if (state.loading && !state.summaries.length) return '<div class="pnhud-tracked-players-state" role="status"><strong>Preparing tracked players\u2026</strong><span>Career summaries are loading or completing their one-time preparation.</span></div>';
    if (state.error && !state.summaries.length) return '<div class="pnhud-tracked-players-state pnhud-tracked-players-error" role="status"><strong>Tracked players unavailable</strong><span>' + esc(state.error) + '</span><button type="button" class="pnhud-tracked-players-retry">Try again</button></div>';
    if (!state.summaries.length) return '<div class="pnhud-tracked-players-state"><strong>No tracked players yet</strong><span>Players will appear after finalized hands are saved to Career.</span></div>';
    if (!rows.length) return '<div class="pnhud-tracked-players-state"><strong>No matching players</strong><span>Try a display name or any part of a stable ID.</span></div>';
    return '<div class="pnhud-tracked-player-list" role="list">' + rows.map(function (row) { return rowHtml(row, state.now); }).join('') + '</div>';
  }

  function render(state) {
    state = state || {};
    var summaries = normalizeSummaries(state.summaries); var rows = visibleRows(summaries, state.search, state.sort);
    var loading = state.loading && summaries.length ? '<span class="pnhud-tracked-players-updating" role="status">Updating\u2026</span>' : '';
    return '<div class="pnhud-tracked-players-window" ><header><div><h2>Tracked Players</h2><p>Browse Career identities and open the existing Player Dashboard.</p></div></header>' +
      '<div class="pnhud-tracked-players-controls"><label><span>Search</span><input type="search" class="pnhud-tracked-players-search" autocomplete="off" placeholder="Name or stable ID" value="' + esc(state.search) + '"></label><label><span>Sort</span><select class="pnhud-tracked-players-sort"><option value="recent"' + (validSort(state.sort) === SORT_RECENT ? ' selected' : '') + '>Most recent</option><option value="hands"' + (validSort(state.sort) === SORT_HANDS ? ' selected' : '') + '>Most hands</option><option value="name"' + (validSort(state.sort) === SORT_NAME ? ' selected' : '') + '>Name A\u2013Z</option></select></label></div>' +
      '<div class="pnhud-tracked-players-meta"><span>' + esc(resultCount(rows.length, summaries.length, state.search)) + '</span>' + loading + '</div>' +
      '<div class="pnhud-tracked-players-results">' + bodyHtml(Object.assign({}, state, { summaries: summaries }), rows) + '</div></div>';
  }

  return Object.freeze({
    SORT_RECENT: SORT_RECENT, SORT_HANDS: SORT_HANDS, SORT_NAME: SORT_NAME, SORT_OPTIONS: SORT_OPTIONS,
    normalizeSummaries: normalizeSummaries, visibleRows: visibleRows, shortId: shortId,
    formatLastSeen: formatLastSeen, render: render
  });
});
