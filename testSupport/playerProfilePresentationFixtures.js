'use strict';

function raw(hands, archetype, status, bestCandidate, bestScore, margin, confidence, runnerUp) {
  var scores = {};
  if (bestCandidate) scores[bestCandidate] = bestScore;
  if (runnerUp) scores[runnerUp] = Math.max(0, bestScore - margin);
  return {
    hands: hands,
    primary: {
      archetype: archetype,
      classificationStatus: status,
      bestCandidate: bestCandidate,
      runnerUp: runnerUp || null,
      confidence: confidence,
      scoreMargin: margin,
      scores: scores
    }
  };
}

var cases = {
  D1: {
    description: 'Stable Loose Passive control from roughly 42 to 67 hands',
    sequence: [
      raw(42, 'Loose Passive', 'supported', 'Loose Passive', 0.58, 0.18, 0.68, 'Calling Station'),
      raw(46, 'Loose Passive', 'supported', 'Loose Passive', 0.56, 0.17, 0.69, 'Calling Station'),
      raw(51, 'Loose Passive', 'supported', 'Loose Passive', 0.57, 0.16, 0.70, 'Calling Station'),
      raw(58, 'Loose Passive', 'supported', 'Loose Passive', 0.59, 0.19, 0.72, 'Calling Station'),
      raw(67, 'Loose Passive', 'supported', 'Loose Passive', 0.60, 0.20, 0.74, 'Calling Station')
    ]
  },
  D2: {
    description: 'Mature strong TAG control at roughly 89 hands',
    sequence: [raw(89, 'TAG', 'supported', 'TAG', 0.67, 0.25, 0.78, 'Nit')]
  },
  D3: {
    description: 'Mature TAG and Tight Passive boundary with Unknown to TAG to Unknown crossings',
    sequence: [
      raw(105, 'Unknown / Uncertain', 'ambiguous', 'Tight Passive', 0.418, 0.071, 0.54, 'TAG'),
      raw(108, 'TAG', 'supported', 'TAG', 0.46, 0.09, 0.61, 'Tight Passive'),
      raw(110, 'Unknown / Uncertain', 'ambiguous', 'Tight Passive', 0.43, 0.06, 0.55, 'TAG'),
      raw(114, 'TAG', 'supported', 'TAG', 0.47, 0.10, 0.62, 'Tight Passive'),
      raw(116, 'Unknown / Uncertain', 'ambiguous', 'Tight Passive', 0.425, 0.05, 0.54, 'TAG'),
      raw(120, 'TAG', 'supported', 'TAG', 0.46, 0.09, 0.61, 'Tight Passive'),
      raw(124, 'Unknown / Uncertain', 'ambiguous', 'Tight Passive', 0.42, 0.06, 0.54, 'TAG'),
      raw(132, 'Unknown / Uncertain', 'ambiguous', 'Tight Passive', 0.418, 0.071, 0.54, 'TAG')
    ]
  },
  D4: {
    description: 'Established mature TAG oscillating across the TAG and Nit boundary',
    sequence: [
      raw(100, 'TAG', 'supported', 'TAG', 0.66, 0.22, 0.76, 'Nit'),
      raw(106, 'Unknown / Uncertain', 'ambiguous', 'TAG', 0.47, 0.05, 0.56, 'Nit'),
      raw(109, 'TAG', 'supported', 'TAG', 0.48, 0.09, 0.62, 'Nit'),
      raw(111, 'Unknown / Uncertain', 'ambiguous', 'Nit', 0.46, 0.05, 0.55, 'TAG'),
      raw(113, 'TAG', 'supported', 'TAG', 0.49, 0.09, 0.63, 'Nit'),
      raw(116, 'Unknown / Uncertain', 'ambiguous', 'Nit', 0.45, 0.04, 0.54, 'TAG'),
      raw(119, 'TAG', 'supported', 'TAG', 0.48, 0.09, 0.62, 'Nit'),
      raw(123, 'Unknown / Uncertain', 'ambiguous', 'TAG', 0.46, 0.05, 0.55, 'Nit')
    ]
  },
  D5: {
    description: 'Established Tight Passive profile with one-hand Unknown crossings around 90 to 103 hands',
    sequence: [
      raw(82, 'Tight Passive', 'supported', 'Tight Passive', 0.52, 0.12, 0.65, 'TAG'),
      raw(86, 'Tight Passive', 'supported', 'Tight Passive', 0.53, 0.13, 0.66, 'TAG'),
      raw(90, 'Tight Passive', 'supported', 'Tight Passive', 0.52, 0.12, 0.65, 'TAG'),
      raw(92, 'Unknown / Uncertain', 'ambiguous', 'Tight Passive', 0.44, 0.06, 0.55, 'TAG'),
      raw(95, 'Tight Passive', 'supported', 'Tight Passive', 0.47, 0.09, 0.60, 'TAG'),
      raw(97, 'Unknown / Uncertain', 'ambiguous', 'Tight Passive', 0.43, 0.05, 0.54, 'TAG'),
      raw(100, 'Tight Passive', 'supported', 'Tight Passive', 0.46, 0.09, 0.59, 'TAG'),
      raw(103, 'Unknown / Uncertain', 'ambiguous', 'Tight Passive', 0.44, 0.06, 0.55, 'TAG')
    ]
  },
  D6: {
    description: 'Genuine sustained transition from established TAG to Loose Passive',
    sequence: [
      raw(80, 'TAG', 'supported', 'TAG', 0.65, 0.22, 0.75, 'Nit'),
      raw(120, 'Loose Passive', 'supported', 'Loose Passive', 0.55, 0.14, 0.68, 'TAG'),
      raw(124, 'Loose Passive', 'supported', 'Loose Passive', 0.56, 0.15, 0.69, 'TAG'),
      raw(128, 'Loose Passive', 'supported', 'Loose Passive', 0.57, 0.16, 0.70, 'TAG'),
      raw(132, 'Loose Passive', 'supported', 'Loose Passive', 0.58, 0.17, 0.71, 'TAG')
    ]
  },
  D7: {
    description: 'Synthetic T5 early LAG to Maniac spike to mature LAG',
    sequence: [
      raw(20, 'LAG', 'supported', 'LAG', 0.4689, 0.2244, 0.5496, 'Loose Passive'),
      raw(40, 'Maniac', 'supported', 'Maniac', 0.5378, 0.3808, 0.6608, 'Loose Passive'),
      raw(100, 'LAG', 'supported', 'LAG', 0.5796, 0.2384, 0.7338, 'Loose Passive'),
      raw(200, 'LAG', 'supported', 'LAG', 0.5251, 0.2564, 0.7488, 'Loose Passive')
    ]
  },
  D8: {
    description: 'Mature R3 Maniac control',
    sequence: [raw(349, 'Maniac', 'supported', 'Maniac', 0.8148, 0.8148, 0.8929, 'LAG')]
  }
};

module.exports = Object.freeze({ raw: raw, cases: cases });
