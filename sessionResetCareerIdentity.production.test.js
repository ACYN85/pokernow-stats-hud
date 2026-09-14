'use strict';

var assert = require('assert');
var support = require('./testSupport/productionContentScriptHarness.js');
var settings = require('./settingsUi.js');

var careerById = {
  'stable-player-a': { counters: { hands: 838, vpipMade: 300, vpipOpportunities: 838, pfrMade: 160, pfrOpportunities: 838, postflopAggressiveActions: 100, postflopCalls: 50 } },
  'stable-player-b': { counters: { hands: 412, vpipMade: 120, vpipOpportunities: 412, pfrMade: 70, pfrOpportunities: 412, postflopAggressiveActions: 30, postflopCalls: 20 } },
  'stable-player-c': { counters: { hands: 9, vpipMade: 1, vpipOpportunities: 9, pfrMade: 0, pfrOpportunities: 9, postflopAggressiveActions: 0, postflopCalls: 0 } },
  'stable-new': { counters: { hands: 27, vpipMade: 10, vpipOpportunities: 27, pfrMade: 4, pfrOpportunities: 27, postflopAggressiveActions: 4, postflopCalls: 2 } }
};

function instrument(source) {
  source = source.replace("    recordPauseLifecycleHudRender('full-hud-render',", "    globalThis.__resetCareerLeaderboardHtml = host.innerHTML;\n    recordPauseLifecycleHudRender('full-hud-render',");
  return source.replace(/\n\}\)\(\);\s*$/, `
  var resetCareerTestSeats = new Map();
  globalThis.resetCareerTest = {
    seedSession: function (events, participants) {
      liveEvents = cloneJson(events || []);
      handAccounting = PokerHandFinalization.createState({ finalizedEvents: liveEvents });
      activeHandState = participants ? { participants: cloneJson(participants), events: [], handId: 'ACTIVE-BEFORE-RESET' } : null;
      capturedFingerprints.add('old-fingerprint');
      socketHandSignatures.add('old-signature');
      advanceFinalizedSessionRevision('reset Career fixture seed');
      refreshHud();
    },
    setRoster: function (rows, reason) {
      var previousRosterKey = currentTableRosterKey();
      resetCareerTestSeats.forEach(function (record) { record.element.isConnected = false; });
      identityDiagnostics.socketPlayers.clear();
      (rows || []).forEach(function (row, index) {
        identityDiagnostics.socketPlayers.set(String(row.playerId), { playerId: String(row.playerId), stack: 100 + index, seatIndex: index, orderIndex: index });
      });
      var seats = (rows || []).map(function (row, index) {
        var element = document.createElement('div');
        element.id = String(row.seatId);
        element.getBoundingClientRect = function () { return { left: 100 + index * 180, top: 100, right: 240 + index * 180, bottom: 150, width: 140, height: 50 }; };
        document.body.appendChild(element);
        domSeatElements.set(String(row.seatId), element);
        domSeatAnchorElements.set(String(row.seatId), element);
        var seat = { elementId: String(row.seatId), displayedName: String(row.name), assignedFullName: String(row.name), displayedStack: 100 + index, directPlayerIds: [String(row.playerId)], seatIndex: index, clockwiseIndex: index, occupied: true };
        resetCareerTestSeats.set(String(row.playerId), { element: element, seat: seat });
        return seat;
      });
      identityDiagnostics.domSeats = seats;
      seats.forEach(function (seat, index) {
        var row = rows[index];
        if (!confirmIdentityMapping(String(row.playerId), String(row.name), 'direct internal player ID', { fixture: true }, seat)) throw new Error('fixture identity confirmation failed for ' + row.playerId);
      });
      pruneDetachedSeatDomState(seats, reason || 'production reset Career fixture roster');
      publishCurrentTableRosterChange(previousRosterKey, reason || 'production reset Career fixture roster');
      return currentTableRosterKey();
    },
    switchLeaderboard: updateLeaderboardSource,
    switchSeatHud: function (source) { updateHudUiPreferences({ seatHudStatSource: source }, 'reset Career fixture'); refreshHud(); },
    loadSeatCareer: function () { return requestSeatHudCareerBatch(Array.from(confirmedSeatMappings.keys()), 'reset Career fixture', true); },
    reset: resetCurrentSession,
    distinctSeats: function (rows) { return distinctDomSeatCandidates(rows); },
    seedCareerUiState: function () {
      playerDashboardState.open = true;
      playerDashboardState.playerId = 'stable-player-a';
      playerDashboardState.displayName = 'Player A';
      playerDashboardState.mode = 'career';
      playerDashboardState.careerStats = { counters: { hands: 838 } };
      playerDashboardState.trends = { windows: { 25: { counters: { hands: 25 } } } };
      playerDashboardState.profile = { displayedArchetype: 'TAG', hands: 838 };
      playerDashboardState.note = 'known opponent';
      playerDashboardState.noteDraft = 'known opponent';
      playerNotesState = PokerPlayerNotesStore.normalize({ version: 1, notes: { 'stable-player-a': 'known opponent' } });
      trackedPlayersState.search = 'Player A';
      trackedPlayersState.sort = 'hands';
      trackedPlayersState.summaries = [{ playerId: 'stable-player-a', latestDisplayName: 'Player A', hands: 838, revision: 7, summaryVersion: 1 }];
    },
    snapshot: function () {
      var data = displayData({});
      return {
        entries: data.playerEntries,
        mappings: Array.from(confirmedSeatMappings.keys()).map(String).sort(),
        mappingSeats: Array.from(confirmedSeatMappings.entries()).reduce(function (result, entry) { result[String(entry[0])] = entry[1].seatElementId; return result; }, {}),
        liveEvents: liveEvents.length,
        activeHand: activeHandState,
        finalizedEvents: handAccounting.finalizedEvents.length,
        finalizedHandIds: Array.from(handAccounting.finalizedHandIds),
        handSignatures: socketHandSignatures.size,
        fingerprints: capturedFingerprints.size,
        leaderboardSource: currentLeaderboardStatSource(),
        seatHudSource: currentSeatHudStatSource(),
        seatStats: Array.from(confirmedSeatMappings.entries()).reduce(function (result, entry) { result[String(entry[0])] = seatHudStatsForPlayer(String(entry[0]), entry[1].name); return result; }, {}),
        dashboard: cloneJson(playerDashboardState),
        notes: cloneJson(playerNotesState),
        tracked: cloneJson(trackedPlayersState),
        effectivePause: currentEffectivePauseState(),
        runtimeLabel: hudRuntimePresentation(hudRuntimeStatusState.displayedStatus).label,
        runtimeStatus: hudRuntimeStatusState.displayedStatus,
        html: globalThis.__resetCareerLeaderboardHtml || ''
      };
    },
    stop: function () { cleanupExtension('reset Career fixture teardown'); }
  };
})();
`);
}

function event(playerId, player, handId) {
  return { playerId: playerId, player: player, handId: handId || 'SESSION-BEFORE-RESET', action: 'fold', street: 'preflop', amount: 0, timestamp: 1 };
}

function socket(eventName, payload) {
  return '42[' + JSON.stringify(eventName) + ',' + JSON.stringify(payload) + ']';
}

function dispatch(harness, direction, eventName, payload, frameId, capturedAt) {
  if (typeof harness.setNow === 'function') harness.setNow(capturedAt);
  (harness.listeners.message || []).slice().forEach(function (listener) {
    listener({
      source: harness.contextWindow,
      origin: 'https://pokernow.com',
      data: {
        source: 'pokernow-stats-hud-main', type: 'websocket-frame', frameId: frameId,
        hookInstanceId: 'session-reset-career-identity', capturedAt: capturedAt, framesCaptured: 1,
        socketId: 'session-reset-career-identity-socket', socketUrl: 'wss://example.invalid/socket',
        direction: direction, dataType: 'string', data: socket(eventName, payload), binaryBytes: null
      }
    });
  });
}

function tableState(handId, paused) {
  return {
    hI: handId, handId: handId, status: paused ? 'paused' : 'inProgress', gamePaused: Boolean(paused),
    gT: [0, 0], oTC: { '1': [] }, pot: 0, tB: {}, cHB: 0, mR: 40, cPI: '<D>', pITT: '<D>', cRPI: [],
    sBPI: '<D>', bBPI: '<D>', dealerID: '<D>', dealerId: '<D>', iHPI: [], pGS: {}, pC: {},
    players: { 'stable-player-a': { name: 'Player A', stack: 1000 }, 'stable-player-b': { name: 'Player B', stack: 1000 } },
    seats: [[1, 'stable-player-a'], [6, 'stable-player-b']], gameResult: '<D>'
  };
}

function rows(snapshot) {
  return Array.from(snapshot.html.matchAll(/<tr><td>(.*?)<\/td>(.*?)<\/tr>/g)).map(function (match) {
    return [match[1]].concat(Array.from(match[2].matchAll(/data-pnhud-displayed-value="([^"]*)"/g)).map(function (cell) { return cell[1]; }));
  });
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function flush() { return Promise.resolve().then(function () { return Promise.resolve(); }).then(function () { return Promise.resolve(); }).then(function () { return Promise.resolve(); }); }

function create(initialStorage, messages) {
  return support.createHarness({
    gameId: 'session-reset-career-identity',
    initialStorage: initialStorage,
    controlledClock: true,
    transformContentSource: instrument,
    runtimeSendMessage: function (message, callback) {
      messages.push(clone(message));
      if (message.method === 'initialize') return callback({ ok: true, value: {} });
      if (message.method === 'careerHudStats') {
        var players = {};
        message.args[0].forEach(function (playerId) { players[playerId] = careerById[playerId] || null; });
        return callback({ ok: true, value: { players: players, query: { batched: true, requestedCount: message.args[0].length, runtimeMessages: 1 } } });
      }
      callback({ ok: true, value: {} });
    }
  });
}

function call(harness, expression) { return harness.evaluateInIsolatedWorld('resetCareerTest.' + expression); }
function snapshot(harness) { return clone(call(harness, 'snapshot()')); }

(async function () {
  var messages = [];
  var preferences = settings.merge(settings.DEFAULTS, { leaderboardEnabled: true, seatOverlaysEnabled: true, leaderboardStatSource: 'career', seatHudStatSource: 'career' });
  var initialStorage = { hudUiPreferences: preferences, careerRecordSentinel: { playerId: 'stable-player-a', hands: 838 }, pokerNowHudPlayerNotesV1: { version: 1, notes: { 'stable-player-a': 'known opponent' } } };
  var harness = create(initialStorage, messages);
  assert.deepStrictEqual(harness.evaluationErrors, []);

  call(harness, 'seedSession([], {"active-only":{"playerId":"stable-active","name":"active-only"}})');
  assert.deepStrictEqual(snapshot(harness).entries, [{ playerId: 'stable-active', playerName: 'active-only' }], 'active-hand enumeration retains an available exact stable ID');

  call(harness, 'seedSession(' + JSON.stringify([event('stable-player-a', 'Player A'), event('stable-player-b', 'Player B')]) + ')');
  call(harness, 'setRoster(' + JSON.stringify([
    { playerId: 'stable-player-a', name: 'Player A', seatId: 'seat-1' },
    { playerId: 'stable-player-b', name: 'Player B', seatId: 'seat-2' }
  ]) + ', "initial authoritative table")');
  call(harness, 'seedCareerUiState()');
  await call(harness, 'loadSeatCareer()');
  await flush();
  var beforeReset = snapshot(harness);
  assert.deepStrictEqual(rows(beforeReset).map(function (row) { return row.slice(0, 2); }), [['Player A', '838'], ['Player B', '412']], 'preexisting Career players render through the batched Career Leaderboard');
  assert.strictEqual(beforeReset.seatStats['stable-player-a'].handsPlayed, 838, 'Career Seat HUD uses the same exact stable identity');
  var careerUiBeforeReset = { dashboard: beforeReset.dashboard, notes: beforeReset.notes, tracked: beforeReset.tracked };
  var appendCountBeforeReset = messages.filter(function (message) { return message.method === 'append'; }).length;

  call(harness, 'reset()');
  await flush();
  var afterReset = snapshot(harness);
  assert.deepStrictEqual(afterReset.mappings, ['stable-player-a', 'stable-player-b'], 'Reset Session retains authoritative current-seat stable IDs');
  assert.deepStrictEqual(afterReset.entries.map(function (entry) { return [entry.playerId, entry.playerName]; }), [['stable-player-a', 'Player A'], ['stable-player-b', 'Player B']], 'no finalized hand is required to retain the current-table roster');
  assert.deepStrictEqual(rows(afterReset).map(function (row) { return row.slice(0, 2); }), [['Player A', '838'], ['Player B', '412']], 'Career Leaderboard remains connected immediately after reset');
  assert.strictEqual(afterReset.liveEvents, 0);
  assert.strictEqual(afterReset.activeHand, null);
  assert.strictEqual(afterReset.finalizedEvents, 0);
  assert.deepStrictEqual(afterReset.finalizedHandIds, []);
  assert.strictEqual(afterReset.handSignatures, 0);
  assert.strictEqual(afterReset.fingerprints, 0, 'Session fingerprints and signatures remain reset');
  assert.strictEqual(messages.filter(function (message) { return message.method === 'append'; }).length, appendCountBeforeReset, 'reset creates no phantom Career append');
  assert.deepStrictEqual({ dashboard: afterReset.dashboard, notes: afterReset.notes, tracked: afterReset.tracked }, careerUiBeforeReset, 'Career Dashboard, Trends, profile, notes, and Tracked Players state remain unchanged');
  assert.deepStrictEqual(harness.storage.careerRecordSentinel, initialStorage.careerRecordSentinel, 'Career-owned data is outside the Session reset update');

  call(harness, 'switchLeaderboard("session")');
  var sessionAfterReset = snapshot(harness);
  assert.deepStrictEqual(rows(sessionAfterReset).map(function (row) { return row.slice(0, 2); }), [['Player A', '0'], ['Player B', '0']], 'Session Leaderboard retains current seats but exposes fresh zero-hand state');
  call(harness, 'switchLeaderboard("career")'); await flush();
  assert.deepStrictEqual(rows(snapshot(harness)).map(function (row) { return row.slice(0, 2); }), [['Player A', '838'], ['Player B', '412']]);
  call(harness, 'switchLeaderboard("session")');
  call(harness, 'switchLeaderboard("career")'); await flush();
  assert.deepStrictEqual(rows(snapshot(harness)).map(function (row) { return row.slice(0, 2); }), [['Player A', '838'], ['Player B', '412']], 'Career to Session to Career switching cannot revive old Session numbers or lose Career numbers');

  call(harness, 'switchSeatHud("session")');
  assert.deepStrictEqual(Object.values(snapshot(harness).seatStats).map(function (stats) { return stats.handsPlayed; }), [0, 0], 'Session Seat HUD is reset');
  call(harness, 'switchSeatHud("career")'); await call(harness, 'loadSeatCareer()'); await flush();
  assert.strictEqual(snapshot(harness).seatStats['stable-player-a'].handsPlayed, 838, 'Career Seat HUD reconnects without a finalized Session hand');

  call(harness, 'seedSession(' + JSON.stringify([event('stable-player-a', 'Player A', 'PAUSED-HISTORY')]) + ')');
  dispatch(harness, 'incoming', 'registered', { currentPlayer: { id: 'stable-player-a' }, ownerID: 'stable-player-a', gameState: tableState('<D>', false) }, 'registered-before-reset-pause', 9000);
  dispatch(harness, 'outgoing', 'action', { type: 'UP' }, 'verified-host-pause-before-reset', 9100);
  assert.strictEqual(snapshot(harness).effectivePause, 'paused', 'production verified-host UP establishes the authoritative Pause latch');
  call(harness, 'reset()');
  call(harness, 'reset()');
  dispatch(harness, 'incoming', 'gC', tableState('PAUSED-RESET-PHANTOM', true), 'paused-authoritative-state-after-reset', 9200);
  dispatch(harness, 'incoming', 'gC', { hI: 'PAUSED-RESET-STALE', handId: 'PAUSED-RESET-STALE', now: 9300 }, 'paused-stale-state-after-reset', 9300);
  await flush();
  var pausedReset = snapshot(harness);
  assert.strictEqual(pausedReset.effectivePause, 'paused');
  assert.strictEqual(pausedReset.liveEvents, 0);
  assert.strictEqual(pausedReset.activeHand, null);
  assert.deepStrictEqual(rows(pausedReset).map(function (row) { return row.slice(0, 2); }), [['Player A', '838'], ['Player B', '412']], 'paused and repeated reset preserve Career identity without creating a phantom hand');

  call(harness, 'setRoster(' + JSON.stringify([
    { playerId: 'stable-player-a', name: 'Player A', seatId: 'seat-6' },
    { playerId: 'stable-player-b', name: 'Player B', seatId: 'seat-2' }
  ]) + ', "seat movement")');
  assert.strictEqual(snapshot(harness).mappingSeats['stable-player-a'], 'seat-6', 'seat movement follows the same stable identity');

  call(harness, 'setRoster(' + JSON.stringify([
    { playerId: 'stable-player-a', name: 'Player A', seatId: 'seat-6' },
    { playerId: 'stable-player-c', name: 'Player A', seatId: 'seat-7' },
    { playerId: 'stable-player-b', name: 'Player B', seatId: 'seat-2' },
    { playerId: 'stable-new', name: 'Player D', seatId: 'seat-3' }
  ]) + ', "same-name and join")');
  await flush();
  var joined = snapshot(harness);
  var discoveredSameNameSeats = clone(call(harness, 'distinctSeats(' + JSON.stringify([
    { displayedName: 'Player A', directPlayerIds: ['stable-player-a'], seatIndex: 1, reactPropKeys: [], dataAttributes: {}, boundingBox: { width: 100, height: 50 } },
    { displayedName: 'Player A', directPlayerIds: ['stable-player-c'], seatIndex: 2, reactPropKeys: [], dataAttributes: {}, boundingBox: { width: 100, height: 50 } }
  ]) + ')'));
  assert.deepStrictEqual(discoveredSameNameSeats.map(function (seat) { return seat.directPlayerIds[0]; }).sort(), ['stable-player-a', 'stable-player-c'], 'production discovery preserves same-name seats carrying distinct authoritative IDs');
  assert.deepStrictEqual(joined.entries.map(function (entry) { return entry.playerId; }), ['stable-player-a', 'stable-player-c', 'stable-player-b', 'stable-new']);
  assert.deepStrictEqual(rows(joined).map(function (row) { return row.slice(0, 2); }), [['Player A', '838'], ['Player A', '9'], ['Player B', '412'], ['Player D', '27']], 'new and same-name players remain separated by exact stable ID');

  call(harness, 'setRoster(' + JSON.stringify([
    { playerId: 'stable-player-c', name: 'Player A', seatId: 'seat-7' },
    { playerId: 'stable-player-b', name: 'Player B', seatId: 'seat-2' },
    { playerId: 'stable-new', name: 'Player D', seatId: 'seat-3' }
  ]) + ', "player left")');
  await flush();
  var afterLeave = snapshot(harness);
  assert.deepStrictEqual(afterLeave.entries.map(function (entry) { return entry.playerId; }), ['stable-player-c', 'stable-player-b', 'stable-new'], 'a departed current player disappears through normal roster retirement');
  assert.ok(messages.filter(function (message) { return message.method === 'careerHudStats'; }).every(function (message) { return message.args[0].length <= 64; }), 'Career presentation retains bounded batches');
  assert.strictEqual(messages.filter(function (message) { return message.method === 'careerPlayerSummaries' || message.method === 'careerPlayers'; }).length, 0, 'current-table repair never enumerates all Career players');

  var persistedAfterReset = clone(harness.storage);
  call(harness, 'stop()');
  var reloadMessages = [];
  var reloaded = create(persistedAfterReset, reloadMessages);
  assert.deepStrictEqual(reloaded.evaluationErrors, []);
  call(reloaded, 'setRoster(' + JSON.stringify([
    { playerId: 'stable-player-c', name: 'Player A', seatId: 'reload-seat-7' },
    { playerId: 'stable-player-b', name: 'Player B', seatId: 'reload-seat-2' },
    { playerId: 'stable-new', name: 'Player D', seatId: 'reload-seat-3' }
  ]) + ', "reload authoritative table")');
  await flush();
  var afterReload = snapshot(reloaded);
  assert.strictEqual(afterReload.liveEvents, 0, 'reload cannot restore pre-reset Session statistics');
  assert.deepStrictEqual(rows(afterReload).map(function (row) { return row.slice(0, 2); }), [['Player A', '9'], ['Player B', '412'], ['Player D', '27']], 'reload reconnects authoritative current seats to existing Career data');
  assert.deepStrictEqual(reloaded.storage.careerRecordSentinel, initialStorage.careerRecordSentinel);
  call(reloaded, 'stop()');

  console.log('Reset Session current-table Career identity, source, pause, invariance, roster lifecycle, batching, idempotence, and reload regressions passed.');
})().catch(function (error) { console.error(error); process.exitCode = 1; });
