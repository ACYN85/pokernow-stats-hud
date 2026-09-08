'use strict';

var tbTrace = require('../tbTrace.js');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function socket(eventName, payload) { return '42[' + JSON.stringify(eventName) + ',' + JSON.stringify(payload) + ']'; }
function registered(state) { return socket('registered', { gameState: state }); }
function gc(patch) { return socket('gC', patch); }

function mergeFrames(initial, patches) {
  var state = clone(initial);
  (patches || []).forEach(function (patch) { state = tbTrace.mergeSnapshot(state, patch); });
  return state;
}

function ordinaryScenario(kind, handId) {
  handId = handId || ('CBET-' + String(kind || 'bet-fold').toUpperCase());
  var deepAggression = /^deep-/.test(String(kind || ''));
  var fiveBet = /^deep-five-bet/.test(String(kind || ''));
  var predeal = {
    hI: '<D>', gN: 0, gT: [0, 0], oTC: { '1': [] }, pot: 0, tB: {}, cHB: 0, mR: 40,
    cPI: '<D>', pITT: '<D>', cRPI: [], sBPI: '<D>', bBPI: '<D>', dealerID: '<D>', dealerId: '<D>', iHPI: [], pGS: {}, pC: {},
    players: { P1: { stack: 1000 }, P2: { stack: 1000 } }, seats: [[1, 'P1'], [6, 'P2']], gameResult: '<D>'
  };
  var initial = {
    hI: handId, gN: 1, gT: [1, 0], oTC: { '1': [] }, pot: 0, tB: { P1: 10, P2: 20 }, cHB: 20, mR: 40,
    cPI: 'P1', pITT: 'P1', cRPI: [], sBPI: 'P1', bBPI: 'P2', dealerID: 'P1', dealerId: 'P1', smallBlind: 10, bigBlind: 20,
    iHPI: ['P1', 'P2'], pGS: { P1: 'inGame', P2: 'inGame' }, pC: { P1: {}, P2: {} },
    players: { P1: { stack: 990 }, P2: { stack: 980 } }, seats: [[1, 'P1'], [6, 'P2']], gameResult: '<D>'
  };
  var preflopPatches = deepAggression ? [
    {},
    { tB: { P1: 60 }, cHB: 60, mR: 100, pITT: null, cRPI: ['P1'], pGS: {} },
    { cPI: 'P2', pITT: 'P2' },
    {},
    { tB: { P2: 180 }, cHB: 180, mR: '<D>', pITT: null, cRPI: ['P2'], pGS: {} },
    { cPI: 'P1', pITT: 'P1' },
    {},
    { tB: { P1: 500 }, cHB: 500, pITT: null, cRPI: ['P1'], pGS: {} },
    { cPI: 'P2', pITT: 'P2' },
    {},
    { tB: { P2: 500 }, pITT: null, cRPI: ['P1', 'P2'], pGS: {} }
  ] : [
    {},
    { tB: { P1: 60 }, cHB: 60, mR: 100, pITT: null, cRPI: ['P1'], pGS: {} },
    { cPI: 'P2', pITT: 'P2' },
    {},
    { tB: { P2: 60 }, pITT: null, cRPI: ['P1', 'P2'], pGS: {} }
  ];
  if (fiveBet) {
    preflopPatches = preflopPatches.slice(0, -1).concat([
      { tB: { P2: 900 }, cHB: 900, pITT: null, cRPI: ['P2'], pGS: {} },
      { cPI: 'P1', pITT: 'P1' },
      {},
      { tB: { P1: 900 }, pITT: null, cRPI: ['P2', 'P1'], pGS: {} }
    ]);
  }
  var flopStart = {
    gT: [1, 1], oTC: { '1': ['As', '7d', '2c'] }, pot: 120, tB: { P1: '<D>', P2: '<D>' }, cHB: 0, mR: 20,
    cPI: 'P2', pITT: 'P2', cRPI: [], pC: { P1: {}, P2: {} }, players: { P1: { stack: 940 }, P2: { stack: 940 } }
  };
  var flopPatches;
  if (fiveBet) {
    flopPatches = [
      flopStart, {},
      { tB: { P2: 80 }, cHB: 80, mR: 160, pITT: null, cRPI: ['P2'], pGS: {} },
      { cPI: 'P1', pITT: 'P1' }, {},
      { pITT: null, pGS: { P1: 'fold' } }
    ];
  } else if (kind === 'check-back' || kind === 'deep-check-back') {
    flopPatches = [
      flopStart, {},
      { tB: { P2: 'check' }, pITT: null, cRPI: ['P2'] },
      { cPI: 'P1', pITT: 'P1' }, {},
      { tB: { P1: 'check' }, pITT: null, cRPI: ['P2', 'P1'] }
    ];
  } else if (kind === 'donk-bet') {
    flopPatches = [
      flopStart, {},
      { tB: { P2: 50 }, cHB: 50, mR: 100, pITT: null, cRPI: ['P2'], pGS: {} },
      { cPI: 'P1', pITT: 'P1' }, {},
      { pITT: null, pGS: { P1: 'fold' } }
    ];
  } else if (kind === 'bet-call') {
    flopPatches = [
      flopStart, {},
      { tB: { P2: 'check' }, pITT: null, cRPI: ['P2'] },
      { cPI: 'P1', pITT: 'P1' }, {},
      { tB: { P1: 80 }, cHB: 80, mR: 160, pITT: null, cRPI: ['P1'], pGS: {} },
      { cPI: 'P2', pITT: 'P2' }, {},
      { tB: { P2: 80 }, pITT: null, cRPI: ['P1', 'P2'], pGS: {} }
    ];
  } else {
    flopPatches = [
      flopStart, {},
      { tB: { P2: 'check' }, pITT: null, cRPI: ['P2'] },
      { cPI: 'P1', pITT: 'P1' }, {},
      { tB: { P1: 80 }, cHB: 80, mR: 160, pITT: null, cRPI: ['P1'], pGS: {} },
      { cPI: 'P2', pITT: 'P2' }, {},
      { pITT: null, pGS: { P2: 'fold' } }
    ];
  }
  var winner = kind === 'donk-bet' ? 'P2' : 'P1';
  var terminal = { gT: [1, 5], pot: 0, tB: {}, cPI: null, players: {}, gameResult: {} };
  terminal.players[winner] = { stack: 1060 };
  terminal.gameResult[winner] = { gained: 120 };
  var next = {
    hI: handId + '-NEXT', gN: 2, gT: [1, 0], oTC: { '1': [] }, pot: 0, tB: { P2: 10, P1: 20 }, cHB: 20, mR: 40,
    cPI: 'P2', pITT: 'P2', cRPI: [], sBPI: 'P2', bBPI: 'P1', dealerID: 'P2', dealerId: 'P2', iHPI: ['P1', 'P2'],
    pGS: { P1: 'inGame', P2: 'inGame' }, pC: { P1: {}, P2: {} }, players: { P1: { stack: 1040 }, P2: { stack: 940 } }, gameResult: '<D>'
  };
  var patches = [initial].concat(preflopPatches, flopPatches, [terminal, next]);
  var frames = [registered(predeal)].concat(patches.map(gc));
  var afterPreflop = mergeFrames(initial, preflopPatches);
  var beforeSettlement = mergeFrames(afterPreflop, flopPatches);
  return {
    kind: kind,
    handId: handId,
    frames: frames,
    splitAfterPreflop: 1 + 1 + preflopPatches.length,
    splitBeforeSettlement: 1 + 1 + preflopPatches.length + flopPatches.length,
    reloadPreflopRegistered: registered(afterPreflop),
    reloadFlopCompleteRegistered: registered(beforeSettlement),
    terminalFrame: gc(terminal),
    nextFrame: gc(next),
    snapshots: { predeal: predeal, initial: initial, afterPreflop: afterPreflop, beforeSettlement: beforeSettlement }
  };
}

function authoritativeFixtureFrames(fixture) {
  var event = JSON.parse(fixture.frames[0].rawPayload.slice(fixture.frames[0].rawPayload.indexOf('[')));
  var target = event[1].gameState;
  var predeal = clone(target);
  Object.assign(predeal, { hI: '<D>', gT: [0, 0], pot: 0, tB: {}, iHPI: [], pC: {}, cPI: '<D>', pITT: '<D>', sBPI: '<D>', bBPI: '<D>' });
  return [registered(predeal), gc(target)].concat(fixture.frames.slice(1).map(function (frame) { return frame.rawPayload; }));
}

module.exports = Object.freeze({ ordinaryScenario: ordinaryScenario, authoritativeFixtureFrames: authoritativeFixtureFrames, registered: registered, gc: gc });
