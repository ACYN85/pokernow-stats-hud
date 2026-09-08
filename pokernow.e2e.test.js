const assert = require('node:assert/strict');
const parser = require('./parser.js');
const { computePlayerStats } = require('./stats.js');

// Exact live PokerNow Full Log lines supplied from hand #3, in chronological
// order (PokerNow displays this list bottom-to-top).
const realPokerNowLines = [
  "14:43 -- starting hand #3 (id: kn97iusdd320)  No Limit Texas Hold'em (dealer: playerA) --",
  '14:43 Player stacks: #2 playerA (173) | #9 PlayerB (73)',
  '14:43 Your hand is 7♠, 5♦',
  '14:43 playerA posts a small blind of 10',
  '14:43 PlayerB posts a big blind of 20',
  '14:43 playerA raises to 60',
  '14:43 PlayerB raises to 73 and go all in',
  '14:43 playerA calls 73',
  '14:43 playerA shows a 7♠, 5♦.',
  '14:43 PlayerB shows a 10♠, 10♥.',
  '14:43 Flop:  [Q♠, 9♠, 5♥]',
  '14:43 Turn: Q♠, 9♠, 5♥ [10♦]',
  '14:43 River: Q♠, 9♠, 5♥, 10♦ [3♠]',
  '14:43 PlayerB collected 146 from pot with Three of a Kind...',
  '14:43 -- ending hand #3 --'
];

parser.reset();
const details = realPokerNowLines.map(parser.parseLogLineDetailed);
const events = details.map((detail) => detail.event).filter(Boolean);

assert.equal(events.length, 5);
assert.equal(details.find((detail) => detail.roster)?.roster.join('|'), 'playerA|PlayerB');
const playerAStats = computePlayerStats(events, 'playerA');
const playerBStats = computePlayerStats(events, 'PlayerB');
assert.deepEqual({ player: playerAStats.player, handsPlayed: playerAStats.handsPlayed, vpip: playerAStats.vpip, pfr: playerAStats.pfr, af: playerAStats.af }, { player: 'playerA', handsPlayed: 1, vpip: 100, pfr: 100, af: 0 });
assert.deepEqual(playerAStats.vpipDetails, { qualifiedHands: 1, opportunities: 1, callHands: 1, raiseHands: 1, walksExcluded: 0, finalizedHands: 1 });
assert.deepEqual({ player: playerBStats.player, handsPlayed: playerBStats.handsPlayed, vpip: playerBStats.vpip, pfr: playerBStats.pfr, af: playerBStats.af }, { player: 'PlayerB', handsPlayed: 1, vpip: 100, pfr: 100, af: 0 });
assert.deepEqual(playerBStats.vpipDetails, { qualifiedHands: 1, opportunities: 1, callHands: 0, raiseHands: 1, walksExcluded: 0, finalizedHands: 1 });
assert.equal(details[details.length - 1].terminal, true);
assert.equal(details[details.length - 1].reason, 'hand-end state line');
assert.ok(events.filter((event) => event.action === 'call' || event.action === 'raise').every((event) => event.street === 'preflop'));

console.log('Real PokerNow end-to-end test passed.');
