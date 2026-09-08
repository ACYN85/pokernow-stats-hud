# Privacy-sanitized capture-derived protocol fixtures

These fixtures preserve behaviorally useful protocol shapes from prior PokerNow observations so the production replay seam and preflop opportunity reducer can be tested without publishing the underlying captures. They are de-identified and privacy-sanitized, not wholly synthetic scenarios.

Only the minimum state required by the regression cases is retained. Player identifiers are fixture-local `P1`/`P2`/`P3` aliases, hand identifiers are scenario-local labels, and card values are synthetic placeholders. Capture timestamps, URLs, headers, cookies, account/display names, source filenames, source hashes, message ordinals, session identifiers, and original game/hand/player identifiers are absent.

The retained behavior shapes cover ordinary open/3Bet/fold and call paths, a multiway squeeze, a short non-full all-in, a full all-in, a 4Bet jam, and a limp/raise/3Bet sequence. They are neither raw WebSocket captures nor complete PokerNow session exports, and they must not be represented as independent live certification.

`testSupport/captureDerivedPreflopProductionReplay.js` replays the privacy-sanitized `registered` and `gC` Socket.IO-shaped payloads through the production lifecycle, semantic ledger, and reducer code. `sanitizedCaptureDerivedPreflopFixtures.production.test.js` verifies both the privacy boundary and the retained finalization, opportunity ownership, short-all-in nullability, automatic-runout, and duplicate-suppression behavior.
