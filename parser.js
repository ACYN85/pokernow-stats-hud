/* PokerNow text-log parser. It does not access the page DOM. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;
  console.log('[HUD] parser loaded');

  var currentStreet = 'preflop';
  var currentHandId = null;
  var currentPlayers = [];

  function cleanLine(text) {
    return String(text || '')
      .replace(/^\s*\d{1,2}:\d{2}\s*/, '')
      .trim();
  }

  function actionEvent(player, action, amount) {
    return {
      handId: currentHandId,
      player: player,
      action: action,
      street: currentStreet,
      amount: amount || 0,
      timestamp: Date.now()
    };
  }

  /**
   * Parses one PokerNow log line. It returns only gameplay actions; street and
   * hand-start lines update parser state and return null.
   *
   * @param {string} text
   * @returns {HandEvent|null}
   */
  function parseLogLineDetailed(text) {
    var rawLine = String(text || '');
    var line = cleanLine(text);
    var match;
    var event = null;
    if (!line) return { rawLine: rawLine, normalizedLine: line, event: null, rejected: true, reason: 'empty after timestamp removal' };

    match = line.match(/^--\s*starting hand\s+#\d+\s+\(id:\s*([^)\s]+)\)/i);
    if (match) {
      currentHandId = match[1];
      currentStreet = 'preflop';
      currentPlayers = [];
      return { rawLine: rawLine, normalizedLine: line, event: null, rejected: true, reason: 'hand-start state line', handId: currentHandId };
    }
    if (/^--\s*ending hand\s+#\d+\s*--/i.test(line)) {
      return { rawLine: rawLine, normalizedLine: line, event: null, rejected: true, reason: 'hand-end state line', handId: currentHandId, terminal: true };
    }
    if (/^Flop:/i.test(line)) { currentStreet = 'flop'; return { rawLine: rawLine, normalizedLine: line, event: null, rejected: true, reason: 'flop state line', handId: currentHandId }; }
    if (/^Turn:/i.test(line)) { currentStreet = 'turn'; return { rawLine: rawLine, normalizedLine: line, event: null, rejected: true, reason: 'turn state line', handId: currentHandId }; }
    if (/^River:/i.test(line)) { currentStreet = 'river'; return { rawLine: rawLine, normalizedLine: line, event: null, rejected: true, reason: 'river state line', handId: currentHandId }; }

    if (/^Player stacks:/i.test(line)) {
      currentPlayers = Array.from(line.matchAll(/#\d+\s+([a-zA-Z0-9_-]+)\s+\(/g)).map(function (item) { return item[1]; });
      return { rawLine: rawLine, normalizedLine: line, event: null, rejected: true, reason: 'dealt-in roster line', handId: currentHandId, roster: currentPlayers.slice() };
    }

    match = line.match(/^([a-zA-Z0-9_-]+)\s+posts a (small|big) blind of\s+(\d+)/i);
    if (match) {
      event = actionEvent(match[1], 'blind', Number.parseInt(match[3], 10));
      event.blindType = match[2].toLowerCase();
    }
    match = line.match(/^([a-zA-Z0-9_-]+)\s+folds\b/i);
    if (!event && match) event = actionEvent(match[1], 'fold', 0);
    if (!event) { match = line.match(/^([a-zA-Z0-9_-]+)\s+checks\b/i); if (match) event = actionEvent(match[1], 'check', 0); }
    if (!event) { match = line.match(/^([a-zA-Z0-9_-]+)\s+calls\s+([\d,]+)\b/i); if (match) event = actionEvent(match[1], 'call', Number.parseInt(match[2].replace(/,/g, ''), 10)); }
    if (!event) { match = line.match(/^([a-zA-Z0-9_-]+)\s+bets\s+([\d,]+)\b/i); if (match) event = actionEvent(match[1], 'bet', Number.parseInt(match[2].replace(/,/g, ''), 10)); }
    if (!event) { match = line.match(/^([a-zA-Z0-9_-]+)\s+raises to\s+([\d,]+)\b/i); if (match) event = actionEvent(match[1], 'raise', Number.parseInt(match[2].replace(/,/g, ''), 10)); }
    if (!event) return { rawLine: rawLine, normalizedLine: line, event: null, rejected: true, reason: 'unrecognized or non-action log line', handId: currentHandId };
    if (!currentHandId) return { rawLine: rawLine, normalizedLine: line, event: null, rejected: true, reason: 'action appeared before a starting-hand line' };
    return {
      rawLine: rawLine,
      normalizedLine: line,
      event: event,
      rejected: false,
      reason: null,
      handId: currentHandId,
      roster: currentPlayers.slice(),
      playerNameMatched: !currentPlayers.length || currentPlayers.includes(event.player)
    };
  }

  function parseLogLine(text) {
    return parseLogLineDetailed(text).event;
  }

  function reset() {
    currentStreet = 'preflop';
    currentHandId = null;
    currentPlayers = [];
  }

  function getState() {
    return { handId: currentHandId, street: currentStreet, players: currentPlayers.slice() };
  }

  var api = { parseLogLine: parseLogLine, parseLogLineDetailed: parseLogLineDetailed, reset: reset, cleanLine: cleanLine, getState: getState };
  root.PokerNowParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
