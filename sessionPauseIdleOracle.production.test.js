'use strict';

var assert = require('assert');
var harnessSupport = require('./testSupport/productionContentScriptHarness');
var stats = require('./stats.js');
var career = require('./careerStatsAggregator.js');

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
        source: 'pokernow-stats-hud-main',
        type: 'websocket-frame',
        frameId: frameId,
        hookInstanceId: 'session-pause-idle-oracle',
        capturedAt: capturedAt,
        framesCaptured: 1,
        socketId: 'session-pause-idle-oracle-socket',
        socketUrl: 'wss://example.invalid/socket',
        direction: direction,
        dataType: 'string',
        data: socket(eventName, payload),
        binaryBytes: null
      }
    });
  });
}

function hand(handId, smallBlindPlayerId, bigBlindPlayerId) {
  var smallStack = smallBlindPlayerId === 'P1' ? 990 : 980;
  var bigStack = bigBlindPlayerId === 'P1' ? 980 : 990;
  var tB = {};
  tB[smallBlindPlayerId] = 10;
  tB[bigBlindPlayerId] = 20;
  return {
    hI: handId,
    handId: handId,
    status: 'inProgress',
    gT: [1, 0],
    oTC: { '1': [] },
    pot: 0,
    tB: tB,
    cHB: 20,
    mR: 40,
    cPI: smallBlindPlayerId,
    pITT: smallBlindPlayerId,
    cRPI: [],
    sBPI: smallBlindPlayerId,
    bBPI: bigBlindPlayerId,
    dealerID: smallBlindPlayerId,
    dealerId: smallBlindPlayerId,
    iHPI: ['P1', 'P2'],
    pGS: { P1: 'inGame', P2: 'inGame' },
    pC: { P1: {}, P2: {} },
    players: { P1: { stack: smallStack }, P2: { stack: bigStack } },
    seats: [[1, 'P1'], [6, 'P2']],
    gameResult: '<D>'
  };
}

function predeal() {
  return {
    hI: '<D>', handId: '<D>', status: 'inProgress', gT: [0, 0], oTC: { '1': [] }, pot: 0, tB: {}, cHB: 0, mR: 40,
    cPI: '<D>', pITT: '<D>', cRPI: [], sBPI: '<D>', bBPI: '<D>', dealerID: '<D>', dealerId: '<D>',
    iHPI: [], pGS: {}, pC: {}, players: { P1: { stack: 1000 }, P2: { stack: 1000 } },
    seats: [[1, 'P1'], [6, 'P2']], gameResult: '<D>'
  };
}

function storageSetup(gameId) {
  var keys = harnessSupport.storageKeys(gameId);
  var storage = {};
  storage[keys.schema] = 4;
  storage[keys.playerMap] = { P1: 'Player A', P2: 'Player B' };
  return { keys: keys, storage: storage };
}

function register(harness, state, timestamp) {
  dispatch(harness, 'incoming', 'registered', {
    currentPlayer: { id: 'P1' },
    ownerID: 'P1',
    gameState: state
  }, 'registered-' + timestamp, timestamp);
}

function handsFor(storage, keys, player) {
  return stats.computePlayerStats(storage[keys.liveEvents] || [], player).handsPlayed;
}

var gameId = 'session-pause-idle-oracle';
var setup = storageSetup(gameId);
var active = harnessSupport.createHarness({ gameId: gameId, initialStorage: setup.storage, controlledClock: true });
assert.deepStrictEqual(active.evaluationErrors, []);
register(active, predeal(), 1000);
dispatch(active, 'incoming', 'gC', hand('H1', 'P1', 'P2'), 'active-h1', 5000);
assert.strictEqual(handsFor(active.storage, setup.keys, 'Player A'), 0, 'an active hand is staged, not counted before finalization');

dispatch(active, 'outgoing', 'action', { type: 'UP' }, 'host-pause', 9000);
dispatch(active, 'incoming', 'gC', { hI: 'H1', handId: 'H1', tB: { P1: 20, P2: 20 }, pGS: { P1: 'inGame', P2: 'fold' }, cPI: 'P2', pITT: 'P2' }, 'paused-stale-betting-state', 9500);
dispatch(active, 'incoming', 'gC', { hI: 'PAUSED-PHANTOM-1', handId: 'PAUSED-PHANTOM-1', now: 10000 }, 'paused-id-change-1', 10000);
dispatch(active, 'incoming', 'gC', { hI: 'PAUSED-PHANTOM-2', handId: 'PAUSED-PHANTOM-2', now: 14000 }, 'paused-id-change-2', 14000);
assert.strictEqual(handsFor(active.storage, setup.keys, 'Player A'), 0, 'verified Pause suppresses hand boundaries and cannot increment Session hands');

var pausedReload = harnessSupport.createHarness({ gameId: gameId, initialStorage: active.storage, controlledClock: true });
assert.deepStrictEqual(pausedReload.evaluationErrors, []);
register(pausedReload, Object.assign(hand('PAUSED-RELOAD-PHANTOM', 'P2', 'P1'), { status: 'paused', gamePaused: true }), 18000);
assert.strictEqual(handsFor(pausedReload.storage, setup.keys, 'Player A'), 0, 'reload into a verified paused table cannot finalize or create a hand');

dispatch(pausedReload, 'outgoing', 'action', { type: 'UR' }, 'host-resume', 22000);
dispatch(pausedReload, 'incoming', 'gC', hand('H2', 'P2', 'P1'), 'resumed-h2', 26000);
assert.strictEqual(handsFor(pausedReload.storage, setup.keys, 'Player A'), 0, 'the unobserved recovered hand is conservatively discarded when verified play resumes');
dispatch(pausedReload, 'incoming', 'gC', hand('H3', 'P1', 'P2'), 'resumed-h3', 31000);
assert.strictEqual(handsFor(pausedReload.storage, setup.keys, 'Player A'), 1, 'the next verified active boundary finalizes the observed post-resume hand exactly once');

dispatch(pausedReload, 'incoming', 'gC', { now: 35000 }, 'resumed-idle', 35000);
dispatch(pausedReload, 'incoming', 'gC', { now: 65000 }, 'resumed-idle-long', 65000);
assert.strictEqual(handsFor(pausedReload.storage, setup.keys, 'Player A'), 1, 'elapsed active or paused time without a hand boundary cannot increment Session hands');

var settlementGameId = 'session-pause-owned-settlement-oracle';
var settlementSetup = storageSetup(settlementGameId);
var pausedSettlement = harnessSupport.createHarness({ gameId: settlementGameId, initialStorage: settlementSetup.storage, controlledClock: true });
assert.deepStrictEqual(pausedSettlement.evaluationErrors, []);
register(pausedSettlement, predeal(), 70000);
dispatch(pausedSettlement, 'incoming', 'gC', hand('SETTLE-H1', 'P1', 'P2'), 'settle-active', 71000);
dispatch(pausedSettlement, 'incoming', 'gC', hand('SETTLE-H2', 'P2', 'P1'), 'settle-owned-hand', 71500);
dispatch(pausedSettlement, 'outgoing', 'action', { type: 'UP' }, 'settle-pause', 72000);
dispatch(pausedSettlement, 'incoming', 'gC', { hI: 'SETTLE-H2', handId: 'SETTLE-H2', tB: { P1: 20, P2: 20 }, pGS: { P1: 'inGame', P2: 'fold' } }, 'settle-paused-stale-actions', 72500);
dispatch(pausedSettlement, 'incoming', 'gC', {
  hI: 'SETTLE-H2', handId: 'SETTLE-H2', gT: [1, 5], status: 'paused', gamePaused: true,
  gameResult: { P1: { gained: 40 }, P2: { gained: 0 } },
  tB: { P1: 20, P2: 20 }, pGS: { P1: 'inGame', P2: 'fold' }
}, 'settle-terminal-with-stale-actions', 73000);
var pausedSettlementStats = stats.computePlayerStats(pausedSettlement.storage[settlementSetup.keys.liveEvents] || [], 'Player A');
assert.deepStrictEqual({ hands: pausedSettlementStats.handsPlayed, vpip: pausedSettlementStats.vpipHands, pfr: pausedSettlementStats.pfrHands, af: pausedSettlementStats.af }, { hands: 1, vpip: 0, pfr: 0, af: 0 }, 'owned terminal settlement completes during Pause without importing repeated stale tB/pGS as actions');

function statEvent(handId, player, action, timestamp, extra) {
  return Object.assign({ handId: handId, player: player, action: action, street: 'preflop', amount: 0, timestamp: timestamp }, extra || {});
}

function careerRecord(handId, counters, finalizedAt) {
  var record = {
    schemaVersion: 1,
    recordType: 'certified-career-hand',
    handKey: ['pokernow', 'pokernow.com', 'hu-idle-oracle', handId].join('|'),
    namespace: { provider: 'pokernow', host: 'pokernow.com', gameId: 'hu-idle-oracle' },
    authoritativeHandId: handId,
    lifecycleHandIds: [handId],
    finalizedAt: finalizedAt,
    semanticVersions: { core: 1, preflop: 2, flopCBet: 1, showdown: 1, sourceLedger: 1 },
    players: [{ playerId: 'P1', displayName: 'Player A', counters: Object.assign(career.emptyCounters(), counters), decisions: {} }],
    supersedesFingerprint: null
  };
  record.fingerprint = career.fingerprint(record);
  return record;
}

var huEvents = [];
var careerState = career.createState();
for (var idleHand = 1; idleHand <= 742; idleHand += 1) {
  var idleHandId = 'HU-IDLE-' + idleHand;
  var timestamp = idleHand * 10;
  var counters;
  if (idleHand <= 700) {
    huEvents.push(statEvent(idleHandId, 'Player A', 'blind', timestamp, { amount: 10, blindType: 'small' }));
    huEvents.push(statEvent(idleHandId, 'Player B', 'blind', timestamp + 1, { amount: 20, blindType: 'big' }));
    huEvents.push(statEvent(idleHandId, 'Player A', 'fold', timestamp + 2));
    counters = { hands: 1, vpipOpportunities: 1, pfrOpportunities: 1 };
  } else if (idleHand <= 740) {
    huEvents.push(statEvent(idleHandId, 'Player B', 'blind', timestamp, { amount: 10, blindType: 'small' }));
    huEvents.push(statEvent(idleHandId, 'Player A', 'blind', timestamp + 1, { amount: 20, blindType: 'big' }));
    huEvents.push(statEvent(idleHandId, 'Player B', 'fold', timestamp + 2));
    counters = { hands: 1 };
  } else if (idleHand === 741) {
    huEvents.push(statEvent(idleHandId, 'Player A', 'blind', timestamp, { amount: 10, blindType: 'small' }));
    huEvents.push(statEvent(idleHandId, 'Player B', 'blind', timestamp + 1, { amount: 20, blindType: 'big' }));
    huEvents.push(statEvent(idleHandId, 'Player A', 'call', timestamp + 2, { amount: 10 }));
    counters = { hands: 1, vpipMade: 1, vpipOpportunities: 1, pfrOpportunities: 1 };
  } else {
    huEvents.push(statEvent(idleHandId, 'Player A', 'blind', timestamp, { amount: 10, blindType: 'small' }));
    huEvents.push(statEvent(idleHandId, 'Player B', 'blind', timestamp + 1, { amount: 20, blindType: 'big' }));
    huEvents.push(statEvent(idleHandId, 'Player A', 'raise', timestamp + 2, { amount: 60 }));
    counters = { hands: 1, vpipMade: 1, vpipOpportunities: 1, pfrMade: 1, pfrOpportunities: 1 };
  }
  assert.strictEqual(career.append(careerState, careerRecord(idleHandId, counters, timestamp + 5)).accepted, true);
}
var huSession = stats.computePlayerStats(huEvents, 'Player A');
var huCareer = career.playerStats(careerState, 'P1');
assert.deepStrictEqual({
  hands: huSession.handsPlayed,
  vpipHands: huSession.vpipHands,
  vpipOpportunities: huSession.vpipOpportunities,
  pfrHands: huSession.pfrHands,
  pfrOpportunities: huSession.pfrOpportunities,
  af: huSession.af
}, { hands: 742, vpipHands: 2, vpipOpportunities: 702, pfrHands: 1, pfrOpportunities: 702, af: 0 }, 'hundreds of HU folds and walks can legitimately produce 742 hands with near-zero action rates');
assert.deepStrictEqual({ hands: huCareer.counters.hands, vpip: huCareer.derived.vpip, pfr: huCareer.derived.pfr, af: huCareer.derived.af }, {
  hands: huSession.handsPlayed, vpip: huSession.vpip, pfr: huSession.pfr, af: huSession.af
}, 'Session and Career aggregation agree when fed the same controlled finalized-hand contributions');

console.log('Production Session Pause/idle boundary oracle passed.');
