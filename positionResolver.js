(function (root, factory) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerPositionResolver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var SCHEMA_VERSION = 1;
  var POSITION_ORDER = Object.freeze(['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  var NONBLIND_BY_COUNT = Object.freeze({
    2: Object.freeze([]), 3: Object.freeze([]), 4: Object.freeze(['CO']),
    5: Object.freeze(['UTG', 'CO']), 6: Object.freeze(['UTG', 'HJ', 'CO']),
    7: Object.freeze(['UTG', 'LJ', 'HJ', 'CO']),
    8: Object.freeze(['UTG', 'UTG+1', 'LJ', 'HJ', 'CO']),
    9: Object.freeze(['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO'])
  });
  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function stableId(value) { if (value === undefined || value === null) return null; var id = String(value).trim(); return id && id !== '<D>' ? id : null; }
  function uniqueIds(values) { var seen = new Set(); var result = []; (values || []).forEach(function (value) { var id = stableId(value); if (id && !seen.has(id)) { seen.add(id); result.push(id); } }); return result; }
  function unsupported(reason, input, dealtIds) {
    return { schemaVersion: SCHEMA_VERSION, status: 'unsupported', reason: reason, dealtPlayerCount: dealtIds && dealtIds.length >= 2 && dealtIds.length <= 9 ? dealtIds.length : null, assignments: {}, evidence: { dealtPlayerIds: clone(dealtIds || []), buttonPlayerId: stableId(input && input.buttonPlayerId), smallBlindPlayerId: stableId(input && input.smallBlindPlayerId), bigBlindPlayerId: stableId(input && input.bigBlindPlayerId), seats: clone(input && input.seats || []), deadButton: input && input.deadButton === true } };
  }
  function resolve(input) {
    input = input || {}; var rawDealt = Array.isArray(input.dealtPlayerIds) ? input.dealtPlayerIds : [];
    var dealt = uniqueIds(rawDealt);
    if (dealt.length !== rawDealt.length) return unsupported('dealt player IDs must be unique stable IDs', input, dealt);
    if (dealt.length < 2 || dealt.length > 9) return unsupported('position requires 2 through 9 dealt players', input, dealt);
    if (input.deadButton === true) return unsupported('dead-button hands are unavailable until an authoritative dead-button position policy is certified', input, dealt);
    var button = stableId(input.buttonPlayerId); var smallBlind = stableId(input.smallBlindPlayerId); var bigBlind = stableId(input.bigBlindPlayerId);
    if (!button || !smallBlind || !bigBlind || !dealt.includes(button) || !dealt.includes(smallBlind) || !dealt.includes(bigBlind)) return unsupported('button, small blind, and big blind must identify dealt players', input, dealt);
    var seatById = new Map(); var usedSeats = new Set(); var malformed = false;
    (input.seats || []).forEach(function (pair) {
      if (!Array.isArray(pair) || pair.length < 2) return;
      var id = stableId(pair[1]); var seat = Number(pair[0]);
      if (!id || !dealt.includes(id)) return;
      if (!Number.isInteger(seat) || seat < 0 || seatById.has(id) || usedSeats.has(seat)) { malformed = true; return; }
      seatById.set(id, seat); usedSeats.add(seat);
    });
    if (malformed || dealt.some(function (id) { return !seatById.has(id); })) return unsupported('every dealt player requires one unique frozen numeric seat', input, dealt);
    var clockwise = dealt.slice().sort(function (left, right) { return seatById.get(left) - seatById.get(right); });
    function next(id) { var index = clockwise.indexOf(id); return index < 0 ? null : clockwise[(index + 1) % clockwise.length]; }
    if (dealt.length === 2) {
      if (button !== smallBlind || next(button) !== bigBlind) return unsupported('heads-up requires the dealt button to post the small blind and the other player to post the big blind', input, dealt);
    } else if (next(button) !== smallBlind || next(smallBlind) !== bigBlind) return unsupported('blind identities conflict with clockwise dealt-seat order after the button', input, dealt);
    var assignments = {}; assignments[button] = 'BTN'; if (dealt.length > 2) assignments[smallBlind] = 'SB'; assignments[bigBlind] = 'BB';
    var nonblind = NONBLIND_BY_COUNT[dealt.length]; var cursor = next(bigBlind);
    for (var index = 0; index < nonblind.length; index += 1) { if (!cursor || cursor === button) return unsupported('dealt-seat order cannot assign every nonblind position exactly once', input, dealt); assignments[cursor] = nonblind[index]; cursor = next(cursor); }
    if (Object.keys(assignments).length !== dealt.length || dealt.some(function (id) { return !assignments[id]; })) return unsupported('position assignment did not cover every dealt player exactly once', input, dealt);
    return { schemaVersion: SCHEMA_VERSION, status: 'supported', reason: null, dealtPlayerCount: dealt.length, assignments: assignments, evidence: { dealtPlayerIds: dealt.slice(), clockwiseDealtPlayerIds: clockwise, buttonPlayerId: button, smallBlindPlayerId: smallBlind, bigBlindPlayerId: bigBlind, seats: dealt.map(function (id) { return [seatById.get(id), id]; }), deadButton: false } };
  }
  function playerPosition(result, playerId) {
    var id = stableId(playerId); var supported = result && result.status === 'supported' && id && result.assignments && result.assignments[id];
    return { schemaVersion: SCHEMA_VERSION, status: supported ? 'supported' : 'unsupported', dealtPosition: supported ? result.assignments[id] : null, dealtPlayerCount: result && Number.isInteger(result.dealtPlayerCount) ? result.dealtPlayerCount : null, unsupportedReason: supported ? null : result && result.reason || 'position provenance unavailable' };
  }
  return Object.freeze({ SCHEMA_VERSION: SCHEMA_VERSION, POSITION_ORDER: POSITION_ORDER, NONBLIND_BY_COUNT: NONBLIND_BY_COUNT, resolve: resolve, playerPosition: playerPosition });
});
