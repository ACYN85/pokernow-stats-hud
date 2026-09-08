/* Mock hands only. No PokerNow page data is read or transmitted. */
(function (root) {
  'use strict';
  if (typeof window !== 'undefined' && root.PokerNowRuntimeScope && !root.PokerNowRuntimeScope.isPokerNowGamePage(window.location)) return;

  var PLAYERS = [
    { name: 'Maya Tight', vpip: 0.18, raise: 0.11, aggression: 0.42 },
    { name: 'Leo LAG', vpip: 0.47, raise: 0.27, aggression: 0.73 },
    { name: 'Nina Solid', vpip: 0.25, raise: 0.16, aggression: 0.54 },
    { name: 'Owen Caller', vpip: 0.39, raise: 0.07, aggression: 0.28 },
    { name: 'Priya Balanced', vpip: 0.30, raise: 0.18, aggression: 0.48 }
  ];

  function seededRandom(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function event(handId, player, action, street, amount, timestamp) {
    return { handId: handId, player: player, action: action, street: street, amount: amount, timestamp: timestamp };
  }

  /** Generates deterministic, realistic-looking sample hands for the HUD. */
  function generateMockEvents(handCount, seed) {
    var random = seededRandom(seed);
    var events = [];
    var start = Date.now() - handCount * 90000;

    for (var hand = 1; hand <= handCount; hand += 1) {
      var handId = 'demo-' + seed + '-' + hand;
      var timestamp = start + hand * 90000;
      var inHand = [];

      PLAYERS.forEach(function (profile) {
        var action = 'fold';
        var amount = 0;
        if (random() < profile.vpip) {
          if (random() < profile.raise / profile.vpip) {
            action = 'raise'; amount = 6 + Math.floor(random() * 8);
          } else {
            action = 'call'; amount = 2 + Math.floor(random() * 4);
          }
          inHand.push(profile);
        }
        events.push(event(handId, profile.name, action, 'preflop', amount, timestamp));
      });

      if (inHand.length < 2) continue;
      var streets = ['flop', 'turn', 'river'];
      streets.forEach(function (street, streetIndex) {
        var remaining = inHand.filter(function () { return random() > 0.18 + streetIndex * 0.05; });
        if (remaining.length < 2) return;
        var aggressor = remaining[Math.floor(random() * remaining.length)];
        remaining.forEach(function (profile) {
          var action;
          if (profile === aggressor) {
            action = random() < profile.aggression ? 'bet' : 'check';
          } else if (random() < 0.42) {
            action = 'fold';
          } else if (random() < profile.aggression * 0.35) {
            action = 'raise';
          } else if (random() < 0.72) {
            action = 'call';
          } else {
            action = 'check';
          }
          events.push(event(handId, profile.name, action, street, action === 'fold' || action === 'check' ? 0 : 8 + Math.floor(random() * 30), timestamp + (streetIndex + 1) * 1000));
        });
        inHand = remaining.filter(function (profile) {
          return !events.some(function (item) { return item.handId === handId && item.street === street && item.player === profile.name && item.action === 'fold'; });
        });
      });
    }
    return events;
  }

  root.PokerMockData = { players: PLAYERS, generateMockEvents: generateMockEvents };
})(typeof globalThis !== 'undefined' ? globalThis : this);
