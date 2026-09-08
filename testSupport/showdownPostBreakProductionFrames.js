'use strict';

var source = require('./showdownStatsProductionFrames');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function packet(raw) { return JSON.parse(String(raw).slice(2)); }
function payload(raw) { return clone(packet(raw)[1]); }
function gc(patch) { return source.gc(clone(patch)); }
function registered(state) { return source.registered(clone(state)); }

function fullStateFromRegistered(raw) { return payload(raw).gameState; }

function waitingState(stacks, status) {
  return {
    hI: '<D>', gN: 0, gT: [0, 0], oTC: { '1': [] }, pot: 0, tB: {}, cHB: 0, mR: 40,
    cPI: '<D>', pITT: '<D>', cRPI: [], sBPI: '<D>', bBPI: '<D>', dealerID: '<D>', dealerId: '<D>', iHPI: [],
    pGS: { P1: 'inGame', P2: 'away' }, pC: {}, gameResult: '<D>', status: status || 'waitingForPlayer',
    players: { P1: { stack: stacks.P1, status: 'active' }, P2: { stack: stacks.P2, status: 'away' } },
    seats: [[1, 'P1'], [6, 'P2']]
  };
}

function breakPatch(stacks) {
  return {
    status: 'waitingForPlayer', iHPI: [], pGS: { P1: 'inGame', P2: 'away' },
    players: { P1: { stack: stacks.P1, status: 'active' }, P2: { stack: stacks.P2, status: 'away' } },
    seats: [[1, 'P1'], [6, 'P2']]
  };
}

function rejoinPatch(stacks, status) {
  return {
    status: status || 'waitingToStart', pGS: { P1: 'inGame', P2: 'inGame' },
    players: { P1: { stack: stacks.P1, status: 'active' }, P2: { stack: stacks.P2, status: 'active' } },
    seats: [[1, 'P1'], [6, 'P2']]
  };
}

function handPatches(handId, options) {
  options = options || {};
  var scenario = source.ordinary('showdown', handId);
  var patches = scenario.frames.slice(1, -1).map(payload);
  var initial = patches[0];
  initial.status = options.resumeSignalLate ? undefined : 'inProgress';
  if (options.startImmediately) {
    initial.players.P1.status = 'active';
    initial.players.P2.status = 'active';
  }
  if (options.sparseInitialMetadata) {
    delete initial.players;
    delete initial.seats;
    delete initial.pGS;
  }
  if (options.lateAuthoritativeHandId) {
    initial.hI = '<D>';
    initial.pC = {
      P1: { cards: [{ value: 'hidden', showing: false }] },
      P2: { cards: [{ value: 'hidden', showing: false }] }
    };
  }
  if (options.resumeSignalLate) patches.splice(Math.min(4, patches.length - 1), 0, { status: 'inProgress' });
  var terminal = patches.pop();
  if (options.splitSettlement) {
    var early = {
      gameResult: clone(terminal.gameResult),
      players: clone(terminal.players),
      pot: terminal.pot,
      cPI: terminal.cPI
    };
    if (options.lateAuthoritativeHandId) early.hI = handId;
    var complete = clone(terminal);
    delete complete.gameResult;
    patches.push(early);
    if (options.duplicateTerminal) patches.push(clone(early));
    patches.push(complete);
    if (options.duplicateTerminal) patches.push(clone(complete));
  } else {
    patches.push(terminal);
    if (options.duplicateTerminal) patches.push(clone(terminal));
  }
  return patches.map(gc);
}

function initializedPlay(handId) {
  var scenario = source.ordinary('showdown', handId || 'PRE-BREAK-HAND');
  return {
    registered: scenario.frames[0],
    completeHandFrames: scenario.frames.slice(1, -1),
    terminalState: payload(scenario.terminalFrame)
  };
}

module.exports = Object.freeze({
  gc: gc,
  registered: registered,
  fullStateFromRegistered: fullStateFromRegistered,
  waitingState: waitingState,
  breakPatch: breakPatch,
  rejoinPatch: rejoinPatch,
  handPatches: handPatches,
  initializedPlay: initializedPlay
});
