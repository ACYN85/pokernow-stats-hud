const assert = require('node:assert/strict');
const parser = require('./parser.js');

parser.reset();
const bottomToTop = [
  '14:43 -- starting hand #3 (id: kn97iusdd320)  No Limit Texas Hold\'em (dealer: playerA) --',
  '14:43 playerA posts a small blind of 10',
  '14:43 PlayerB posts a big blind of 20',
  '14:43 playerA raises to 60',
  '14:43 PlayerB raises to 73 and go all in',
  '14:43 playerA calls 73',
  '14:43 Flop:  [Q♠, 9♠, 5♥]',
  '14:43 Turn: Q♠, 9♠, 5♥ [10♦]',
  '14:43 River: Q♠, 9♠, 5♥, 10♦ [3♠]'
];

const actions = bottomToTop.map(parser.parseLogLine).filter(Boolean);
assert.deepEqual(actions.map(({ timestamp, ...event }) => event), [
  { handId: 'kn97iusdd320', player: 'playerA', action: 'blind', street: 'preflop', amount: 10, blindType: 'small' },
  { handId: 'kn97iusdd320', player: 'PlayerB', action: 'blind', street: 'preflop', amount: 20, blindType: 'big' },
  { handId: 'kn97iusdd320', player: 'playerA', action: 'raise', street: 'preflop', amount: 60 },
  { handId: 'kn97iusdd320', player: 'PlayerB', action: 'raise', street: 'preflop', amount: 73 },
  { handId: 'kn97iusdd320', player: 'playerA', action: 'call', street: 'preflop', amount: 73 }
]);

const ending = parser.parseLogLineDetailed('14:43 -- ending hand #3 --');
assert.equal(ending.terminal, true);
assert.equal(ending.handId, 'kn97iusdd320');

console.log('All parser tests passed.');
