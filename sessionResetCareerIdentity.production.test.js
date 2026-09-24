'use strict';

var assert = require('assert');
var support = require('./testSupport/productionContentScriptHarness.js');
var frames = require('./testSupport/flopCBetProductionFrames.js');
var settings = require('./settingsUi.js');

var careerById = {
  'stable-liam': { counters: { hands: 838, vpipMade: 300, vpipOpportunities: 838, pfrMade: 160, pfrOpportunities: 838, postflopAggressiveActions: 100, postflopCalls: 50 } },
  'stable-mail': { counters: { hands: 412, vpipMade: 120, vpipOpportunities: 412, pfrMade: 70, pfrOpportunities: 412, postflopAggressiveActions: 30, postflopCalls: 20 } },
  'stable-other-liam': { counters: { hands: 9, vpipMade: 1, vpipOpportunities: 9, pfrMade: 0, pfrOpportunities: 9, postflopAggressiveActions: 0, postflopCalls: 0 } },
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
        element.getClientRects = function () { return [element.getBoundingClientRect()]; };
        element.querySelector = function () { return null; };
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
    reconcileSeatHud: function (reason) { reconcileSeatOverlays(reason || 'reset Career fixture'); },
    prepareRemoval: prepareCurrentSessionCareerRemoval,
    cancelRemoval: cancelCurrentSessionCareerRemoval,
    confirmRemoval: confirmCurrentSessionCareerRemoval,
    reset: resetCurrentSession,
    restoreReset: function () { return new Promise(function (resolve, reject) { resetCurrentSession({ preserveAuthoritativePause: true, source: 'successful Career restore' }, function (error) { if (error) reject(error); else resolve(); }); }); },
    distinctSeats: function (rows) { return distinctDomSeatCandidates(rows); },
    seedCareerUiState: function () {
      playerDashboardState.open = true;
      playerDashboardState.playerId = 'stable-liam';
      playerDashboardState.displayName = 'liam';
      playerDashboardState.mode = 'career';
      playerDashboardState.careerStats = { counters: { hands: 838 } };
      playerDashboardState.trends = { windows: { 25: { counters: { hands: 25 } } } };
      playerDashboardState.profile = { displayedArchetype: 'TAG', hands: 838 };
      playerDashboardState.note = 'known opponent';
      playerDashboardState.noteDraft = 'known opponent';
      playerNotesState = PokerPlayerNotesStore.normalize({ version: 1, notes: { 'stable-liam': 'known opponent' } });
      trackedPlayersState.search = 'liam';
      trackedPlayersState.sort = 'hands';
      trackedPlayersState.summaries = [{ playerId: 'stable-liam', latestDisplayName: 'liam', hands: 838, revision: 7, summaryVersion: 1 }];
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
        renderedSeatStats: seatOverlayController ? Array.from(seatOverlayController.records.entries()).reduce(function (result, entry) { result[String(entry[0])] = cloneJson(entry[1].entry && entry[1].entry.stats || null); return result; }, {}) : {},
        renderedSeatHtml: seatOverlayController ? Array.from(seatOverlayController.records.entries()).reduce(function (result, entry) { result[String(entry[0])] = entry[1].element && entry[1].element.innerHTML || ''; return result; }, {}) : {},
        careerData: cloneJson(careerDataUiState),
        dashboard: cloneJson(playerDashboardState),
        notes: cloneJson(playerNotesState),
        tracked: cloneJson(trackedPlayersState),
        effectivePause: currentEffectivePauseState(),
        acquisitionPending: lifecycleBoundaryAcquisition.pending,
        evaluations: cloneJson(handTransitionDiagnostics.evaluations.slice(-5)),
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
    players: { 'stable-liam': { name: 'liam', stack: 1000 }, 'stable-mail': { name: 'mail', stack: 1000 } },
    seats: [[1, 'stable-liam'], [6, 'stable-mail']], gameResult: '<D>'
  };
}

function sparseScenario(handId) {
  var hand = JSON.parse(JSON.stringify(frames.ordinaryScenario('bet-fold', handId)).replace(/P1/g, 'stable-liam').replace(/P2/g, 'stable-mail'));
  var first = 'stable-liam'; var second = 'stable-mail';
  var baseline = clone(hand.snapshots.predeal); var deal = clone(hand.snapshots.initial);
  Object.assign(baseline, { gN: 1, gT: [1, 0], cHB: 20, dealerID: first, dealerId: first, status: 'inProgress', pGS: {}, tB: {} });
  baseline.pGS[first] = 'inGame'; baseline.pGS[second] = 'inGame'; baseline.tB[first] = '<D>'; baseline.tB[second] = '<D>';
  baseline.players[first].status = 'active'; baseline.players[second].status = 'active';
  baseline.players[first].cards = []; baseline.players[second].cards = [];
  deal.players = {}; deal.players[first] = { stack: 1000, cards: ['As', 'Kd'] }; deal.players[second] = { stack: 1000 };
  return { hand: hand, baseline: baseline, deal: deal };
}

function finishScenario(harness, scenario, capturedAt) {
  scenario.frames.slice(2, -1).forEach(function (raw, index) {
    var packet = JSON.parse(raw.slice(2));
    dispatch(harness, 'incoming', packet[0], packet[1], 'restore-finish-' + index, capturedAt + index);
  });
}

function rows(snapshot) {
  return Array.from(snapshot.html.matchAll(/<tr><td>(.*?)<\/td>(.*?)<\/tr>/g)).map(function (match) {
    return [match[1]].concat(Array.from(match[2].matchAll(/data-pnhud-displayed-value="([^"]*)"/g)).map(function (cell) { return cell[1]; }));
  });
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function flush() { return Promise.resolve().then(function () { return Promise.resolve(); }).then(function () { return Promise.resolve(); }).then(function () { return Promise.resolve(); }); }

function create(initialStorage, messages, careerFixture) {
  var removalCommitted = false;
  return support.createHarness({
    gameId: 'session-reset-career-identity',
    initialStorage: initialStorage,
    controlledClock: true,
    transformContentSource: instrument,
    runtimeSendMessage: function (message, callback) {
      messages.push(clone(message));
      if (message.method === 'initialize') return callback({ ok: true, value: {} });
      if (message.method === 'careerHudStats') {
        var source = removalCommitted && careerFixture && careerFixture.after ? careerFixture.after : careerFixture && careerFixture.before || careerById;
        var players = {};
        message.args[0].forEach(function (playerId) { players[playerId] = source[playerId] || null; });
        return callback({ ok: true, value: { players: players, query: { batched: true, requestedCount: message.args[0].length, runtimeMessages: 1 } } });
      }
      if (message.method === 'prepareCareerSessionRemoval') {
        var sessionIds = message.args[0].sessionHandIds || [];
        return callback({ ok: true, value: { sessionHandCount: sessionIds.length, matchedSessionHandCount: sessionIds.length, unmatchedSessionHandCount: 0, logicalHandCount: sessionIds.length, physicalRecordCount: sessionIds.length, affectedPlayerCount: 2, affectedPlayerIds: ['stable-liam', 'stable-mail'], currentDigest: 'fixture-current-digest', confirmationToken: 'fixture-confirmation-token' } });
      }
      if (message.method === 'removeCareerSession') {
        removalCommitted = true;
        var removedIds = message.args[0].sessionHandIds || [];
        return callback({ ok: true, value: { preview: { logicalHandCount: removedIds.length, physicalRecordCount: removedIds.length, affectedPlayerIds: ['stable-liam', 'stable-mail'] }, ledgerInfo: { ready: true, revision: 9 } } });
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
  var initialStorage = { hudUiPreferences: preferences, careerRecordSentinel: { playerId: 'stable-liam', hands: 838 }, pokerNowHudPlayerNotesV1: { version: 1, notes: { 'stable-liam': 'known opponent' } } };
  var harness = create(initialStorage, messages);
  assert.deepStrictEqual(harness.evaluationErrors, []);

  call(harness, 'seedSession([], {"active-only":{"playerId":"stable-active","name":"active-only"}})');
  assert.deepStrictEqual(snapshot(harness).entries, [{ playerId: 'stable-active', playerName: 'active-only' }], 'active-hand enumeration retains an available exact stable ID');

  call(harness, 'seedSession(' + JSON.stringify([event('stable-liam', 'liam'), event('stable-mail', 'mail')]) + ')');
  call(harness, 'setRoster(' + JSON.stringify([
    { playerId: 'stable-liam', name: 'liam', seatId: 'seat-1' },
    { playerId: 'stable-mail', name: 'mail', seatId: 'seat-2' }
  ]) + ', "initial authoritative table")');
  call(harness, 'switchLeaderboard("session")');
  call(harness, 'switchSeatHud("session")');
  var threeHandEvents = [];
  ['SESSION-1', 'SESSION-2', 'SESSION-3'].forEach(function (handId) {
    threeHandEvents.push(event('stable-liam', 'liam', handId), event('stable-mail', 'mail', handId));
  });
  call(harness, 'seedSession(' + JSON.stringify(threeHandEvents) + ')');
  call(harness, 'reconcileSeatHud("three authoritative finalized Session hands")');
  var threeHandSession = snapshot(harness);
  assert.deepStrictEqual(rows(threeHandSession).map(function (row) { return row.slice(0, 2); }), [['liam', '3'], ['mail', '3']], 'Session Leaderboard reports exactly three finalized hands');
  assert.deepStrictEqual(Object.values(threeHandSession.renderedSeatStats).map(function (stats) { return stats.handsPlayed; }), [3, 3], 'mounted Session Seat HUD records use the same three-hand authority');
  assert.ok(Object.values(threeHandSession.renderedSeatHtml).every(function (html) { return html.includes('H 3'); }), 'the rendered Seat HUD DOM publishes H3');

  call(harness, 'reset()');
  var resetZero = snapshot(harness);
  assert.deepStrictEqual(rows(resetZero).map(function (row) { return row.slice(0, 2); }), [['liam', '0'], ['mail', '0']], 'Session reset publishes Leaderboard H0');
  assert.deepStrictEqual(Object.values(resetZero.renderedSeatStats).map(function (stats) { return stats.handsPlayed; }), [0, 0], 'Session reset immediately republishes mounted Seat HUD H0');
  for (var handCount = 1; handCount <= 3; handCount += 1) {
    var nextEvents = threeHandEvents.filter(function (item) { return Number(item.handId.slice(-1)) <= handCount; });
    call(harness, 'seedSession(' + JSON.stringify(nextEvents) + ')');
    call(harness, 'reconcileSeatHud("finalized Session hand ' + handCount + '")');
    var afterHand = snapshot(harness);
    assert.deepStrictEqual(rows(afterHand).map(function (row) { return Number(row[1]); }), [handCount, handCount], 'Leaderboard advances exactly once to H' + handCount);
    assert.deepStrictEqual(Object.values(afterHand.renderedSeatStats).map(function (stats) { return stats.handsPlayed; }), [handCount, handCount], 'Seat HUD advances exactly once to H' + handCount);
  }
  call(harness, 'reset()');
  assert.deepStrictEqual(Object.values(snapshot(harness).renderedSeatStats).map(function (stats) { return stats.handsPlayed; }), [0, 0], 'a second reset cannot retain the preceding H3 projection');
  call(harness, 'seedSession(' + JSON.stringify([event('stable-liam', 'liam'), event('stable-mail', 'mail')]) + ')');
  call(harness, 'switchLeaderboard("career")');
  call(harness, 'switchSeatHud("career")');
  call(harness, 'seedCareerUiState()');
  await call(harness, 'loadSeatCareer()');
  await flush();
  var beforeReset = snapshot(harness);
  assert.deepStrictEqual(rows(beforeReset).map(function (row) { return row.slice(0, 2); }), [['liam', '838'], ['mail', '412']], 'preexisting Career players render through the batched Career Leaderboard');
  assert.strictEqual(beforeReset.seatStats['stable-liam'].handsPlayed, 838, 'Career Seat HUD uses the same exact stable identity');
  var careerUiBeforeReset = { dashboard: beforeReset.dashboard, notes: beforeReset.notes, tracked: beforeReset.tracked };
  var appendCountBeforeReset = messages.filter(function (message) { return message.method === 'append'; }).length;

  call(harness, 'reset()');
  await flush();
  var afterReset = snapshot(harness);
  assert.deepStrictEqual(afterReset.mappings, ['stable-liam', 'stable-mail'], 'Reset Session retains authoritative current-seat stable IDs');
  assert.deepStrictEqual(afterReset.entries.map(function (entry) { return [entry.playerId, entry.playerName]; }), [['stable-liam', 'liam'], ['stable-mail', 'mail']], 'no finalized hand is required to retain the current-table roster');
  assert.deepStrictEqual(rows(afterReset).map(function (row) { return row.slice(0, 2); }), [['liam', '838'], ['mail', '412']], 'Career Leaderboard remains connected immediately after reset');
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
  assert.deepStrictEqual(rows(sessionAfterReset).map(function (row) { return row.slice(0, 2); }), [['liam', '0'], ['mail', '0']], 'Session Leaderboard retains current seats but exposes fresh zero-hand state');
  call(harness, 'switchLeaderboard("career")'); await flush();
  assert.deepStrictEqual(rows(snapshot(harness)).map(function (row) { return row.slice(0, 2); }), [['liam', '838'], ['mail', '412']]);
  call(harness, 'switchLeaderboard("session")');
  call(harness, 'switchLeaderboard("career")'); await flush();
  assert.deepStrictEqual(rows(snapshot(harness)).map(function (row) { return row.slice(0, 2); }), [['liam', '838'], ['mail', '412']], 'Career to Session to Career switching cannot revive old Session numbers or lose Career numbers');

  call(harness, 'switchSeatHud("session")');
  assert.deepStrictEqual(Object.values(snapshot(harness).seatStats).map(function (stats) { return stats.handsPlayed; }), [0, 0], 'Session Seat HUD is reset');
  call(harness, 'switchSeatHud("career")'); await call(harness, 'loadSeatCareer()'); await flush();
  assert.strictEqual(snapshot(harness).seatStats['stable-liam'].handsPlayed, 838, 'Career Seat HUD reconnects without a finalized Session hand');

  call(harness, 'seedSession(' + JSON.stringify([event('stable-liam', 'liam', 'PAUSED-HISTORY')]) + ')');
  dispatch(harness, 'incoming', 'registered', { currentPlayer: { id: 'stable-liam' }, ownerID: 'stable-liam', gameState: tableState('<D>', false) }, 'registered-before-reset-pause', 9000);
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
  assert.deepStrictEqual(rows(pausedReset).map(function (row) { return row.slice(0, 2); }), [['liam', '838'], ['mail', '412']], 'paused and repeated reset preserve Career identity without creating a phantom hand');

  call(harness, 'setRoster(' + JSON.stringify([
    { playerId: 'stable-liam', name: 'liam', seatId: 'seat-6' },
    { playerId: 'stable-mail', name: 'mail', seatId: 'seat-2' }
  ]) + ', "seat movement")');
  assert.strictEqual(snapshot(harness).mappingSeats['stable-liam'], 'seat-6', 'seat movement follows the same stable identity');

  call(harness, 'setRoster(' + JSON.stringify([
    { playerId: 'stable-liam', name: 'liam', seatId: 'seat-6' },
    { playerId: 'stable-other-liam', name: 'liam', seatId: 'seat-7' },
    { playerId: 'stable-mail', name: 'mail', seatId: 'seat-2' },
    { playerId: 'stable-new', name: 'new player', seatId: 'seat-3' }
  ]) + ', "same-name and join")');
  await flush();
  var joined = snapshot(harness);
  var discoveredSameNameSeats = clone(call(harness, 'distinctSeats(' + JSON.stringify([
    { displayedName: 'liam', directPlayerIds: ['stable-liam'], seatIndex: 1, reactPropKeys: [], dataAttributes: {}, boundingBox: { width: 100, height: 50 } },
    { displayedName: 'liam', directPlayerIds: ['stable-other-liam'], seatIndex: 2, reactPropKeys: [], dataAttributes: {}, boundingBox: { width: 100, height: 50 } }
  ]) + ')'));
  assert.deepStrictEqual(discoveredSameNameSeats.map(function (seat) { return seat.directPlayerIds[0]; }).sort(), ['stable-liam', 'stable-other-liam'], 'production discovery preserves same-name seats carrying distinct authoritative IDs');
  assert.deepStrictEqual(joined.entries.map(function (entry) { return entry.playerId; }), ['stable-liam', 'stable-other-liam', 'stable-mail', 'stable-new']);
  assert.deepStrictEqual(rows(joined).map(function (row) { return row.slice(0, 2); }), [['liam', '838'], ['liam', '9'], ['mail', '412'], ['new player', '27']], 'new and same-name players remain separated by exact stable ID');

  call(harness, 'setRoster(' + JSON.stringify([
    { playerId: 'stable-other-liam', name: 'liam', seatId: 'seat-7' },
    { playerId: 'stable-mail', name: 'mail', seatId: 'seat-2' },
    { playerId: 'stable-new', name: 'new player', seatId: 'seat-3' }
  ]) + ', "player left")');
  await flush();
  var afterLeave = snapshot(harness);
  assert.deepStrictEqual(afterLeave.entries.map(function (entry) { return entry.playerId; }), ['stable-other-liam', 'stable-mail', 'stable-new'], 'a departed current player disappears through normal roster retirement');
  assert.ok(messages.filter(function (message) { return message.method === 'careerHudStats'; }).every(function (message) { return message.args[0].length <= 64; }), 'Career presentation retains bounded batches');
  assert.strictEqual(messages.filter(function (message) { return message.method === 'careerPlayerSummaries' || message.method === 'careerPlayers'; }).length, 0, 'current-table repair never enumerates all Career players');

  var persistedAfterReset = clone(harness.storage);
  call(harness, 'stop()');
  var reloadMessages = [];
  var reloaded = create(persistedAfterReset, reloadMessages);
  assert.deepStrictEqual(reloaded.evaluationErrors, []);
  call(reloaded, 'setRoster(' + JSON.stringify([
    { playerId: 'stable-other-liam', name: 'liam', seatId: 'reload-seat-7' },
    { playerId: 'stable-mail', name: 'mail', seatId: 'reload-seat-2' },
    { playerId: 'stable-new', name: 'new player', seatId: 'reload-seat-3' }
  ]) + ', "reload authoritative table")');
  await flush();
  var afterReload = snapshot(reloaded);
  assert.strictEqual(afterReload.liveEvents, 0, 'reload cannot restore pre-reset Session statistics');
  assert.deepStrictEqual(rows(afterReload).map(function (row) { return row.slice(0, 2); }), [['liam', '9'], ['mail', '412'], ['new player', '27']], 'reload reconnects authoritative current seats to existing Career data');
  assert.deepStrictEqual(reloaded.storage.careerRecordSentinel, initialStorage.careerRecordSentinel);
  call(reloaded, 'stop()');

  var removalMessages = [];
  var removalPreferences = settings.merge(settings.DEFAULTS, { leaderboardEnabled: true, seatOverlaysEnabled: true, leaderboardStatSource: 'session', seatHudStatSource: 'session', selectedSettingsSection: 'career-data' });
  var removalCareer = {
    before: {
      'stable-liam': { counters: { hands: 8, vpipMade: 4, vpipOpportunities: 8, pfrMade: 2, pfrOpportunities: 8 } },
      'stable-mail': { counters: { hands: 7, vpipMade: 3, vpipOpportunities: 7, pfrMade: 2, pfrOpportunities: 7 } }
    },
    after: {
      'stable-liam': { counters: { hands: 5, vpipMade: 2, vpipOpportunities: 5, pfrMade: 1, pfrOpportunities: 5 } },
      'stable-mail': { counters: { hands: 4, vpipMade: 1, vpipOpportunities: 4, pfrMade: 1, pfrOpportunities: 4 } }
    }
  };
  var removalHarness = create({ hudUiPreferences: removalPreferences }, removalMessages, removalCareer);
  call(removalHarness, 'setRoster(' + JSON.stringify([
    { playerId: 'stable-liam', name: 'liam', seatId: 'removal-seat-1' },
    { playerId: 'stable-mail', name: 'mail', seatId: 'removal-seat-2' }
  ]) + ', "Career removal table")');
  call(removalHarness, 'seedSession(' + JSON.stringify(threeHandEvents) + ')');
  call(removalHarness, 'reconcileSeatHud("pre-removal Session H3")');
  call(removalHarness, 'prepareRemoval()');
  await flush();
  assert.strictEqual(snapshot(removalHarness).careerData.removalPreview.sessionHandCount, 3, 'the actual content handler opens a three-hand removal preview');
  call(removalHarness, 'cancelRemoval()');
  assert.strictEqual(snapshot(removalHarness).careerData.removalPreview, null, 'Cancel removes the actual content preview state');
  call(removalHarness, 'prepareRemoval()');
  await flush();
  assert.strictEqual(snapshot(removalHarness).careerData.removalPreview.logicalHandCount, 3, 'open/cancel/open produces one fresh exact preview');
  call(removalHarness, 'confirmRemoval()');
  await flush(); await flush();
  var removedSession = snapshot(removalHarness);
  assert.strictEqual(removedSession.liveEvents, 0);
  assert.deepStrictEqual(rows(removedSession).map(function (row) { return row.slice(0, 2); }), [['liam', '0'], ['mail', '0']], 'confirmed Career removal resets the Session Leaderboard to H0');
  assert.deepStrictEqual(Object.values(removedSession.renderedSeatStats).map(function (stats) { return stats.handsPlayed; }), [0, 0], 'confirmed Career removal resets the mounted Session Seat HUD to H0');
  assert.strictEqual(removedSession.careerData.removalPreview, null, 'successful removal clears its preview');
  assert.match(removedSession.careerData.message, /Removed 3 exact Career hands and reset Session/);
  call(removalHarness, 'switchSeatHud("career")');
  await call(removalHarness, 'loadSeatCareer()'); await flush();
  var retainedCareer = snapshot(removalHarness);
  assert.deepStrictEqual([retainedCareer.seatStats['stable-liam'].handsPlayed, retainedCareer.seatStats['stable-mail'].handsPlayed], [5, 4], 'Career Seat HUD publishes the retained aggregate after exact deletion');
  call(removalHarness, 'switchSeatHud("session")');
  assert.deepStrictEqual(Object.values(snapshot(removalHarness).seatStats).map(function (stats) { return stats.handsPlayed; }), [0, 0], 'Career to Session returns to reset Session H0');
  call(removalHarness, 'switchSeatHud("career")');
  await call(removalHarness, 'loadSeatCareer()'); await flush();
  assert.deepStrictEqual([snapshot(removalHarness).seatStats['stable-liam'].handsPlayed, snapshot(removalHarness).seatStats['stable-mail'].handsPlayed], [5, 4], 'Session to Career returns to the retained post-deletion aggregate');
  assert.strictEqual(removalMessages.filter(function (message) { return message.method === 'removeCareerSession'; }).length, 1, 'confirmed deletion performs one Career mutation');
  assert.strictEqual(removalMessages.filter(function (message) { return message.method === 'careerPlayers' || message.method === 'careerPlayerSummaries' || message.method === 'careerStats'; }).length, 0, 'Session Seat HUD refresh adds no Career history or enumeration scan');
  call(removalHarness, 'stop()');

  var restorePauseMessages = [];
  var restorePauseHarness = create({ hudUiPreferences: removalPreferences }, restorePauseMessages);
  dispatch(restorePauseHarness, 'incoming', 'registered', { currentPlayer: { id: 'stable-liam' }, ownerID: 'stable-liam', gameState: tableState('<D>', false) }, 'registered-before-restore-pause', 12000);
  dispatch(restorePauseHarness, 'outgoing', 'action', { type: 'UP' }, 'verified-host-pause-before-restore', 12010);
  assert.strictEqual(snapshot(restorePauseHarness).effectivePause, 'paused');
  await call(restorePauseHarness, 'restoreReset()'); await flush();
  var afterPausedRestoreReset = snapshot(restorePauseHarness);
  assert.strictEqual(afterPausedRestoreReset.effectivePause, 'paused', 'restore-driven Session reset preserves the authoritative Pause latch');
  assert.strictEqual(afterPausedRestoreReset.liveEvents, 0);
  var restorePauseHostControlKey = 'pokerNowHudHostControl:game:pokernow.com%3Asession-reset-career-identity';
  assert.strictEqual(restorePauseHarness.storage[restorePauseHostControlKey].authoritativePauseState, 'paused', 'preserved Pause remains durable across the restore boundary');
  dispatch(restorePauseHarness, 'incoming', 'gC', tableState('PAUSED-RESTORE-PHANTOM', true), 'paused-restore-phantom', 12020);
  dispatch(restorePauseHarness, 'incoming', 'gC', { hI: 'PAUSED-RESTORE-STALE', handId: 'PAUSED-RESTORE-STALE' }, 'paused-restore-stale', 12030);
  await flush();
  assert.strictEqual(snapshot(restorePauseHarness).liveEvents, 0, 'paused restore boundary cannot create a phantom Session hand');
  assert.strictEqual(restorePauseMessages.filter(function (message) { return message.method === 'append'; }).length, 0, 'paused restore boundary cannot append a phantom Career hand');
  dispatch(restorePauseHarness, 'outgoing', 'action', { type: 'UR' }, 'verified-host-resume-after-restore', 12040);
  assert.strictEqual(snapshot(restorePauseHarness).effectivePause, 'resumed');
  var restoreFresh = sparseScenario('RESTORE-FRESH');
  dispatch(restorePauseHarness, 'incoming', 'gC', restoreFresh.baseline, 'restore-fresh-baseline', 12100);
  dispatch(restorePauseHarness, 'incoming', 'gC', restoreFresh.deal, 'restore-fresh-deal', 12110);
  finishScenario(restorePauseHarness, restoreFresh.hand, 12120);
  await flush(); await flush();
  var afterFreshHand = snapshot(restorePauseHarness);
  assert.strictEqual(new Set(afterFreshHand.finalizedHandIds).size, 1, 'first fresh post-resume hand enters Session exactly once: ' + JSON.stringify({ acquisitionPending: afterFreshHand.acquisitionPending, evaluations: afterFreshHand.evaluations }));
  assert.strictEqual(restorePauseMessages.filter(function (message) { return message.method === 'append'; }).length, 1, 'first fresh post-resume hand enters Career exactly once');
  call(restorePauseHarness, 'stop()');

  console.log('Reset Session current-table Career identity, restore Pause/Resume boundary, source, invariance, roster lifecycle, batching, idempotence, and reload regressions passed.');
})().catch(function (error) { console.error(error); process.exitCode = 1; });
