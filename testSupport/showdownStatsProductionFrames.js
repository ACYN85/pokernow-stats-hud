'use strict';

var tbTrace = require('../tbTrace.js');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function socket(eventName, payload) { return '42[' + JSON.stringify(eventName) + ',' + JSON.stringify(payload) + ']'; }
function registered(state) { return socket('registered', { gameState: state }); }
function gc(patch) { return socket('gC', patch); }
function merge(initial, patches) {
  var state = clone(initial);
  (patches || []).forEach(function (patch) { state = tbTrace.mergeSnapshot(state, patch); });
  return state;
}

function base(handId, stacks) {
  stacks = stacks || { P1: 1000, P2: 1000 };
  var predeal = {
    hI: '<D>', gN: 0, gT: [0, 0], oTC: { '1': [] }, pot: 0, tB: {}, cHB: 0, mR: 40,
    cPI: '<D>', pITT: '<D>', cRPI: [], sBPI: '<D>', bBPI: '<D>', dealerID: '<D>', dealerId: '<D>', iHPI: [], pGS: {}, pC: {},
    players: { P1: { stack: stacks.P1 }, P2: { stack: stacks.P2 } }, seats: [[1, 'P1'], [6, 'P2']], gameResult: '<D>'
  };
  var initial = {
    hI: handId, gN: 1, gT: [1, 0], oTC: { '1': [] }, pot: 0, tB: { P1: 10, P2: 20 }, cHB: 20, mR: 40,
    cPI: 'P1', pITT: 'P1', cRPI: [], sBPI: 'P1', bBPI: 'P2', dealerID: 'P1', dealerId: 'P1', smallBlind: 10, bigBlind: 20,
    iHPI: ['P1', 'P2'], pGS: { P1: 'inGame', P2: 'inGame' }, pC: { P1: {}, P2: {} },
    players: { P1: { stack: stacks.P1 - 10 }, P2: { stack: stacks.P2 - 20 } }, seats: [[1, 'P1'], [6, 'P2']], gameResult: '<D>'
  };
  return { predeal: predeal, initial: initial, stacks: stacks };
}

function preflopOpenCall() {
  return [
    {},
    { tB: { P1: 60 }, cHB: 60, mR: 100, pITT: null, cRPI: ['P1'], pGS: {} },
    { cPI: 'P2', pITT: 'P2' },
    {},
    { tB: { P2: 60 }, pITT: null, cRPI: ['P1', 'P2'], pGS: {} }
  ];
}

function streetStart(round, cards, pot, stacks) {
  return {
    gT: [1, round], oTC: { '1': cards }, pot: pot, tB: { P1: '<D>', P2: '<D>' }, cHB: 0, mR: 20,
    cPI: 'P2', pITT: 'P2', cRPI: [], pC: { P1: {}, P2: {} }, players: { P1: { stack: stacks.P1 }, P2: { stack: stacks.P2 } }
  };
}

function checks(playerIds) {
  var patches = [];
  playerIds.forEach(function (playerId, index) {
    if (index) patches.push({ cPI: playerId, pITT: playerId });
    patches.push({});
    var tB = {}; tB[playerId] = 'check';
    patches.push({ tB: tB, pITT: null, cRPI: playerIds.slice(0, index + 1) });
  });
  return patches;
}

function betFold(playerId, amount, foldedId) {
  var tB = {}; tB[playerId] = amount;
  var pGS = {}; pGS[foldedId] = 'fold';
  return [
    { cPI: playerId, pITT: playerId }, {},
    { tB: tB, cHB: amount, mR: amount * 2, pITT: null, cRPI: [playerId], pGS: {} },
    { cPI: foldedId, pITT: foldedId }, {},
    { pITT: null, pGS: pGS }
  ];
}

function nextHand(handId, stacks) {
  return {
    hI: handId + '-NEXT', gN: 2, gT: [1, 0], oTC: { '1': [] }, pot: 0, tB: { P2: 10, P1: 20 }, cHB: 20, mR: 40,
    cPI: 'P2', pITT: 'P2', cRPI: [], sBPI: 'P2', bBPI: 'P1', dealerID: 'P2', dealerId: 'P2', iHPI: ['P1', 'P2'],
    pGS: { P1: 'inGame', P2: 'inGame' }, pC: { P1: {}, P2: {} }, players: clone(stacks), gameResult: '<D>'
  };
}

function ordinary(kind, handId) {
  handId = handId || ('SHOWDOWN-' + String(kind).toUpperCase());
  var unequal = kind === 'return-showdown';
  var foundation = base(handId, unequal ? { P1: 300, P2: 200 } : undefined);
  var preflop = preflopOpenCall();
  var postflop = [];
  var remaining = unequal ? { P1: 240, P2: 140 } : { P1: 940, P2: 940 };
  postflop.push(streetStart(1, ['As', '7d', '2c'], 120, remaining));

  if (kind === 'turn-fold') {
    postflop = postflop.concat(checks(['P2', 'P1']));
    postflop.push(streetStart(2, ['As', '7d', '2c', 'Kd'], 120, remaining));
    postflop = postflop.concat(checks(['P2'])).concat(betFold('P1', 80, 'P2'));
  } else if (kind === 'river-fold') {
    postflop = postflop.concat(checks(['P2', 'P1']));
    postflop.push(streetStart(2, ['As', '7d', '2c', 'Kd'], 120, remaining));
    postflop = postflop.concat(checks(['P2', 'P1']));
    postflop.push(streetStart(3, ['As', '7d', '2c', 'Kd', '4h'], 120, remaining));
    postflop = postflop.concat(checks(['P2'])).concat(betFold('P1', 80, 'P2'));
  } else if (kind === 'postflop-allin' || kind === 'postflop-allin-muck' || kind === 'return-showdown') {
    postflop = postflop.concat(checks(['P2']));
    var p1Bet = remaining.P1;
    postflop.push({ cPI: 'P1', pITT: 'P1' }, {}, { tB: { P1: p1Bet }, cHB: p1Bet, mR: p1Bet * 2, pITT: null, cRPI: ['P1'], pGS: { P1: 'allIn' } });
    postflop.push({ cPI: 'P2', pITT: 'P2' }, {}, { tB: { P2: remaining.P2 }, pITT: null, cRPI: ['P1', 'P2'], pGS: { P2: 'allIn' } });
    postflop.push({ pot: unequal ? 400 : 2000, tB: { P1: '<D>', P2: '<D>' }, pC: { P1: { cards: [{ value: 'Ah', showing: true }, { value: 'Ad', showing: true }] }, P2: { cards: [{ value: 'Kh', showing: true }, { value: 'Kd', showing: true }] } }, players: { P1: { stack: 0 }, P2: { stack: 0 } } });
    postflop.push(streetStart(2, ['As', '7d', '2c', 'Kd'], unequal ? 400 : 2000, { P1: 0, P2: 0 }));
    postflop.push(streetStart(3, ['As', '7d', '2c', 'Kd', '4h'], unequal ? 400 : 2000, { P1: 0, P2: 0 }));
  } else if (kind === 'river-call-muck') {
    postflop = postflop.concat(checks(['P2', 'P1']));
    postflop.push(streetStart(2, ['As', '7d', '2c', 'Kd'], 120, remaining));
    postflop = postflop.concat(checks(['P2', 'P1']));
    postflop.push(streetStart(3, ['As', '7d', '2c', 'Kd', '4h'], 120, remaining));
    postflop = postflop.concat(checks(['P2']));
    postflop.push({ cPI: 'P1', pITT: 'P1' }, {});
    postflop.push({ tB: { P1: 80 }, cHB: 80, mR: 160, pITT: null, cRPI: ['P1'], pGS: {} });
    postflop.push({ cPI: 'P2', pITT: 'P2' }, {});
    postflop.push({ tB: { P2: 80 }, pITT: null, cRPI: ['P1', 'P2'], pGS: {} });
  } else {
    postflop = postflop.concat(checks(['P2', 'P1']));
    postflop.push(streetStart(2, ['As', '7d', '2c', 'Kd'], 120, remaining));
    postflop = postflop.concat(checks(['P2', 'P1']));
    postflop.push(streetStart(3, ['As', '7d', '2c', 'Kd', '4h'], 120, remaining));
    postflop = postflop.concat(checks(['P2', 'P1']));
  }

  var terminal;
  if (kind === 'turn-fold' || kind === 'river-fold') {
    terminal = { gT: [1, 5], pot: 0, tB: {}, cPI: null, players: { P1: { stack: 1060 } }, gameResult: { P1: { gained: 120 } } };
  } else if (kind === 'missing-settlement') {
    terminal = { gT: [1, 5], pot: 0, tB: {}, cPI: null, pC: { P1: { cards: [{ value: 'Ah', showing: true }, { value: 'Ad', showing: true }] }, P2: { cards: [{ value: 'Kh', showing: true }, { value: 'Kd', showing: true }] } }, players: { P1: { stack: 930 }, P2: { stack: 930 } }, gameResult: { P1: {} } };
  } else if (kind === 'muck' || kind === 'river-call-muck') {
    terminal = { gT: [1, 5], pot: 0, tB: {}, cPI: null, pC: { P1: { cards: [{ value: 'Ah', showing: true }, { value: 'Ad', showing: true }] }, P2: {} }, players: { P1: { stack: 1060 }, P2: { stack: 940 } }, gameResult: { P1: { gained: 120 } } };
  } else if (kind === 'split') {
    terminal = { gT: [1, 5], pot: 0, tB: {}, cPI: null, pC: { P1: { cards: [{ value: 'Ah', showing: true }, { value: 'Ad', showing: true }] }, P2: { cards: [{ value: 'Kh', showing: true }, { value: 'Kd', showing: true }] } }, players: { P1: { stack: 990 }, P2: { stack: 980 } }, gameResult: { P1: { gained: 60 }, P2: { gained: 60 } } };
  } else if (kind === 'return-showdown') {
    terminal = { gT: [1, 5], pot: 0, tB: {}, cPI: null, pC: { P1: { cards: [{ value: 'Ah', showing: true }, { value: 'Ad', showing: true }] }, P2: { cards: [{ value: 'Kh', showing: true }, { value: 'Kd', showing: true }] } }, players: { P1: { stack: 490 }, P2: { stack: 0 } }, gameResult: { P1: { gained: 400 } } };
  } else if (kind === 'postflop-allin' || kind === 'postflop-allin-muck') {
    terminal = { gT: [1, 5], pot: 0, tB: {}, cPI: null, pC: { P1: { cards: [{ value: 'Ah', showing: true }, { value: 'Ad', showing: true }] }, P2: { cards: [{ value: 'Kh', showing: true }, { value: 'Kd', showing: true }] } }, players: { P1: { stack: 2000 }, P2: { stack: 0 } }, gameResult: { P1: { gained: 2000 } } };
    if (kind === 'postflop-allin-muck') terminal.pC = { P1: {}, P2: {} };
  } else {
    terminal = { gT: [1, 5], pot: 0, tB: {}, cPI: null, pC: { P1: { cards: [{ value: 'Ah', showing: true }, { value: 'Ad', showing: true }] }, P2: { cards: [{ value: 'Kh', showing: true }, { value: 'Kd', showing: true }] } }, players: { P1: { stack: 1050 }, P2: { stack: 920 } }, gameResult: { P1: { gained: 120 } } };
  }
  var nextStacks = kind === 'return-showdown' ? { P1: { stack: 500 }, P2: { stack: 0 } } : { P1: { stack: 1060 }, P2: { stack: 940 } };
  var next = nextHand(handId, nextStacks);
  var patches = [foundation.initial].concat(preflop, postflop, [terminal, next]);
  var beforeTerminal = merge(foundation.initial, preflop.concat(postflop));
  return {
    kind: kind,
    handId: handId,
    frames: [registered(foundation.predeal)].concat(patches.map(gc)),
    splitBeforeTerminal: 1 + 1 + preflop.length + postflop.length,
    reloadBeforeTerminalRegistered: registered(beforeTerminal),
    terminalFrame: gc(terminal),
    nextFrame: gc(next)
  };
}

function preflopFold(handId) {
  handId = handId || 'SHOWDOWN-PREFLOP-FOLD';
  var foundation = base(handId);
  var fold = { pITT: null, pGS: { P1: 'fold' } };
  var terminal = { gT: [1, 5], pot: 0, tB: {}, cPI: null, players: { P2: { stack: 1010 } }, gameResult: { P2: { gained: 30 } } };
  var next = nextHand(handId, { P1: { stack: 990 }, P2: { stack: 1010 } });
  return { handId: handId, frames: [registered(foundation.predeal), gc(foundation.initial), gc({}), gc(fold), gc(terminal), gc(next)], terminalFrame: gc(terminal), nextFrame: gc(next) };
}

function multiwayMuck(handId) {
  handId = handId || 'SHOWDOWN-MULTIWAY-MUCK';
  var playerIds = ['P1', 'P2', 'P3'];
  var predeal = {
    hI: '<D>', gN: 0, gT: [0, 0], oTC: { '1': [] }, pot: 0, tB: {}, cHB: 0, mR: 40,
    cPI: '<D>', pITT: '<D>', cRPI: [], sBPI: '<D>', bBPI: '<D>', dealerID: '<D>', iHPI: [], pGS: {}, pC: {},
    players: { P1: { stack: 1000 }, P2: { stack: 1000 }, P3: { stack: 1000 } }, seats: [[1, 'P1'], [4, 'P2'], [7, 'P3']], gameResult: '<D>'
  };
  var initial = {
    hI: handId, gN: 1, gT: [1, 0], oTC: { '1': [] }, pot: 0, tB: { P1: 10, P2: 20 }, cHB: 20, mR: 40,
    cPI: 'P3', pITT: 'P3', cRPI: [], sBPI: 'P1', bBPI: 'P2', dealerID: 'P3', iHPI: playerIds.slice(),
    pGS: { P1: 'inGame', P2: 'inGame', P3: 'inGame' }, pC: { P1: {}, P2: {}, P3: {} },
    players: { P1: { stack: 990 }, P2: { stack: 980 }, P3: { stack: 1000 } }, seats: [[1, 'P1'], [4, 'P2'], [7, 'P3']], gameResult: '<D>'
  };
  var patches = [
    initial, {},
    { tB: { P3: 20 }, pITT: null, cRPI: ['P3'], pGS: {} }, { cPI: 'P1', pITT: 'P1' }, {},
    { tB: { P1: 20 }, pITT: null, cRPI: ['P3', 'P1'], pGS: {} }, { cPI: 'P2', pITT: 'P2' }, {},
    { tB: { P2: 'check' }, pITT: null, cRPI: ['P3', 'P1', 'P2'] }
  ];
  [
    { round: 1, cards: ['As', '7d', '2c'] },
    { round: 2, cards: ['As', '7d', '2c', 'Kd'] },
    { round: 3, cards: ['As', '7d', '2c', 'Kd', '4h'] }
  ].forEach(function (street) {
    patches.push({
      gT: [1, street.round], oTC: { '1': street.cards }, pot: 60, tB: { P1: '<D>', P2: '<D>', P3: '<D>' }, cHB: 0, mR: 20,
      cPI: 'P1', pITT: 'P1', cRPI: [], iHPI: playerIds.slice(), pC: { P1: {}, P2: {}, P3: {} },
      players: { P1: { stack: 980 }, P2: { stack: 980 }, P3: { stack: 980 } }
    });
    patches.push.apply(patches, checks(playerIds));
  });
  var terminal = {
    gT: [1, 5], pot: 0, tB: {}, cPI: null,
    pC: { P1: { cards: [{ value: 'Ah', showing: true }, { value: 'Ad', showing: true }] }, P2: {}, P3: {} },
    players: { P1: { stack: 1040 }, P2: { stack: 980 }, P3: { stack: 980 } }, gameResult: { P1: { gained: 60 } }
  };
  var next = {
    hI: handId + '-NEXT', gN: 2, gT: [1, 0], oTC: { '1': [] }, pot: 0, tB: { P2: 10, P3: 20 }, cHB: 20, mR: 40,
    cPI: 'P1', pITT: 'P1', cRPI: [], sBPI: 'P2', bBPI: 'P3', dealerID: 'P1', iHPI: playerIds.slice(),
    pGS: { P1: 'inGame', P2: 'inGame', P3: 'inGame' }, pC: { P1: {}, P2: {}, P3: {} },
    players: { P1: { stack: 1040 }, P2: { stack: 970 }, P3: { stack: 960 } }, gameResult: '<D>'
  };
  return { handId: handId, frames: [registered(predeal)].concat(patches.concat([terminal, next]).map(gc)), terminalFrame: gc(terminal), nextFrame: gc(next) };
}

module.exports = Object.freeze({ ordinary: ordinary, preflopFold: preflopFold, multiwayMuck: multiwayMuck, registered: registered, gc: gc });
