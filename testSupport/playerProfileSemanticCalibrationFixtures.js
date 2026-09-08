'use strict';

function stats(overrides) {
  return Object.assign({
    handsPlayed: 200,
    vpipHands: 0,
    vpipOpportunities: 200,
    pfrHands: 0,
    pfrOpportunities: 200,
    afDetails: { bets: 0, raises: 0, calls: 0 },
    threeBetMade: 0,
    threeBetOpportunities: 0,
    foldToThreeBet: 0,
    foldToThreeBetOpportunities: 0,
    flopCBetMade: 0,
    flopCBetOpportunities: 0,
    foldToFlopCBet: 0,
    foldToFlopCBetOpportunities: 0,
    wentToShowdown: 0,
    sawFlopForWTSD: 0,
    wonMoneyAtShowdown: 0,
    showdownsForWSD: 0
  }, overrides || {});
}

var cases = Object.freeze([
  {
    id: 'R7',
    description: 'Sanitized real ultra-loose, very-low-PFR contradiction shape',
    stats: stats({
      handsPlayed: 134,
      vpipHands: 91,
      vpipOpportunities: 133,
      pfrHands: 10,
      pfrOpportunities: 133,
      afDetails: { bets: 25, raises: 6, calls: 31 },
      threeBetMade: 1,
      threeBetOpportunities: 67,
      foldToFlopCBet: 11,
      foldToFlopCBetOpportunities: 15,
      wentToShowdown: 20,
      sawFlopForWTSD: 73,
      wonMoneyAtShowdown: 11,
      showdownsForWSD: 20
    }),
    expected: { primary: 'Unknown / Uncertain', best: 'Loose Passive' }
  },
  {
    id: 'R8',
    description: 'True Nit contrast',
    stats: stats({
      vpipHands: 26,
      pfrHands: 20,
      afDetails: { bets: 12, raises: 8, calls: 20 },
      threeBetMade: 2,
      threeBetOpportunities: 60
    }),
    expected: { primary: 'Nit', best: 'Nit' }
  },
  {
    id: 'R9',
    description: 'Tight Passive contrast',
    stats: stats({
      vpipHands: 42,
      pfrHands: 20,
      afDetails: { bets: 7, raises: 5, calls: 36 },
      threeBetMade: 2,
      threeBetOpportunities: 60
    }),
    expected: { primary: 'Tight Passive', best: 'Tight Passive' }
  },
  {
    id: 'R10',
    description: 'Loose Passive contrast',
    stats: stats({
      vpipHands: 110,
      pfrHands: 25,
      afDetails: { bets: 15, raises: 10, calls: 50 },
      threeBetMade: 3,
      threeBetOpportunities: 60
    }),
    expected: { primary: 'Loose Passive', best: 'Loose Passive' }
  },
  {
    id: 'R11',
    description: 'Loose-aggressive contrast',
    stats: stats({
      vpipHands: 90,
      pfrHands: 66,
      afDetails: { bets: 40, raises: 20, calls: 30 },
      threeBetMade: 12,
      threeBetOpportunities: 60
    }),
    expected: { primary: 'LAG', best: 'LAG' }
  }
]);

module.exports = Object.freeze({ cases: cases });
