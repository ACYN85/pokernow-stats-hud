'use strict';

function profileStats(hands, overrides) {
  return Object.assign({
    handsPlayed: hands,
    vpipHands: 0,
    vpipOpportunities: hands,
    pfrHands: 0,
    pfrOpportunities: hands,
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

var callingStation = [
  { id: 'C1', stats: profileStats(80, { vpipHands: 52, pfrHands: 14, afDetails: { bets: 8, raises: 4, calls: 30 } }) },
  { id: 'C2', stats: profileStats(100, { vpipHands: 65, pfrHands: 18, afDetails: { bets: 10, raises: 5, calls: 38 }, foldToFlopCBet: 12, foldToFlopCBetOpportunities: 20 }) },
  { id: 'C3', stats: profileStats(160, { vpipHands: 104, pfrHands: 28, afDetails: { bets: 16, raises: 7, calls: 60 }, foldToFlopCBet: 12, foldToFlopCBetOpportunities: 80 }) },
  { id: 'C4', stats: profileStats(200, { vpipHands: 130, pfrHands: 34, afDetails: { bets: 20, raises: 8, calls: 75 }, foldToFlopCBet: 12, foldToFlopCBetOpportunities: 90, wentToShowdown: 55, sawFlopForWTSD: 110, wonMoneyAtShowdown: 27, showdownsForWSD: 55 }) },
  { id: 'C5', stats: profileStats(300, { vpipHands: 195, pfrHands: 51, afDetails: { bets: 40, raises: 15, calls: 100 }, foldToFlopCBet: 72, foldToFlopCBetOpportunities: 150, wentToShowdown: 60, sawFlopForWTSD: 220, wonMoneyAtShowdown: 30, showdownsForWSD: 60 }) }
];

var transitions = {
  T1: [
    profileStats(20, { vpipHands: 2, pfrHands: 1, afDetails: { bets: 1, raises: 1, calls: 3 } }),
    profileStats(40, { vpipHands: 7, pfrHands: 5, afDetails: { bets: 3, raises: 2, calls: 5 } }),
    profileStats(80, { vpipHands: 18, pfrHands: 14, afDetails: { bets: 9, raises: 6, calls: 9 } }),
    profileStats(150, { vpipHands: 36, pfrHands: 30, afDetails: { bets: 20, raises: 14, calls: 18 } })
  ],
  T2: [
    profileStats(20, { vpipHands: 6, pfrHands: 5, afDetails: { bets: 4, raises: 3, calls: 4 } }),
    profileStats(40, { vpipHands: 13, pfrHands: 10, afDetails: { bets: 8, raises: 5, calls: 7 } }),
    profileStats(80, { vpipHands: 27, pfrHands: 22, afDetails: { bets: 17, raises: 10, calls: 14 } }),
    profileStats(150, { vpipHands: 54, pfrHands: 44, afDetails: { bets: 32, raises: 20, calls: 27 }, threeBetMade: 6, threeBetOpportunities: 50 })
  ],
  T3: [
    profileStats(20, { vpipHands: 12, pfrHands: 3, afDetails: { bets: 1, raises: 1, calls: 8 } }),
    profileStats(40, { vpipHands: 25, pfrHands: 7, afDetails: { bets: 3, raises: 2, calls: 16 } }),
    profileStats(80, { vpipHands: 51, pfrHands: 16, afDetails: { bets: 7, raises: 4, calls: 31 } }),
    profileStats(150, { vpipHands: 95, pfrHands: 35, afDetails: { bets: 16, raises: 7, calls: 54 } })
  ],
  T4: callingStation.map(function (entry) { return entry.stats; }),
  T5: [
    profileStats(20, { vpipHands: 17, pfrHands: 15, afDetails: { bets: 10, raises: 3, calls: 1 }, threeBetMade: 3, threeBetOpportunities: 6 }),
    profileStats(40, { vpipHands: 32, pfrHands: 28, afDetails: { bets: 18, raises: 7, calls: 3 }, threeBetMade: 5, threeBetOpportunities: 10 }),
    profileStats(100, { vpipHands: 55, pfrHands: 35, afDetails: { bets: 28, raises: 10, calls: 20 }, threeBetMade: 7, threeBetOpportunities: 35 }),
    profileStats(200, { vpipHands: 90, pfrHands: 55, afDetails: { bets: 50, raises: 18, calls: 45 }, threeBetMade: 12, threeBetOpportunities: 80 })
  ],
  T6: [
    profileStats(20, { vpipHands: 5, pfrHands: 4, afDetails: { bets: 3, raises: 2, calls: 3 }, threeBetMade: 2, threeBetOpportunities: 3 }),
    profileStats(40, { vpipHands: 10, pfrHands: 8, afDetails: { bets: 7, raises: 4, calls: 7 }, threeBetMade: 2, threeBetOpportunities: 8 }),
    profileStats(80, { vpipHands: 20, pfrHands: 16, afDetails: { bets: 15, raises: 8, calls: 15 }, threeBetMade: 4, threeBetOpportunities: 40 }),
    profileStats(150, { vpipHands: 37, pfrHands: 30, afDetails: { bets: 29, raises: 15, calls: 28 }, threeBetMade: 7, threeBetOpportunities: 75 })
  ],
  T7: [
    profileStats(20, { vpipHands: 5, pfrHands: 4, afDetails: { bets: 3, raises: 2, calls: 3 }, wentToShowdown: 4, sawFlopForWTSD: 5, wonMoneyAtShowdown: 3, showdownsForWSD: 4 }),
    profileStats(40, { vpipHands: 10, pfrHands: 8, afDetails: { bets: 7, raises: 4, calls: 7 }, wentToShowdown: 15, sawFlopForWTSD: 20, wonMoneyAtShowdown: 10, showdownsForWSD: 15 }),
    profileStats(100, { vpipHands: 25, pfrHands: 20, afDetails: { bets: 19, raises: 10, calls: 18 }, wentToShowdown: 18, sawFlopForWTSD: 60, wonMoneyAtShowdown: 11, showdownsForWSD: 18 }),
    profileStats(200, { vpipHands: 50, pfrHands: 40, afDetails: { bets: 38, raises: 20, calls: 36 }, wentToShowdown: 35, sawFlopForWTSD: 120, wonMoneyAtShowdown: 20, showdownsForWSD: 35 })
  ],
  T8: [
    profileStats(150, { vpipHands: 36, pfrHands: 30, afDetails: { bets: 30, raises: 18, calls: 25 }, threeBetMade: 6, threeBetOpportunities: 60 }),
    profileStats(180, { vpipHands: 43, pfrHands: 36, afDetails: { bets: 36, raises: 22, calls: 30 }, threeBetMade: 7, threeBetOpportunities: 72 }),
    profileStats(220, { vpipHands: 53, pfrHands: 44, afDetails: { bets: 44, raises: 27, calls: 37 }, threeBetMade: 9, threeBetOpportunities: 88 }),
    profileStats(250, { vpipHands: 60, pfrHands: 50, afDetails: { bets: 50, raises: 31, calls: 42 }, threeBetMade: 10, threeBetOpportunities: 100 })
  ]
};

module.exports = Object.freeze({ profileStats: profileStats, callingStation: callingStation, transitions: transitions });
