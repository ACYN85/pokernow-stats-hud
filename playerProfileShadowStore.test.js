'use strict';

var assert = require('assert');
var classifier = require('./playerProfileClassifier.js');
var presentation = require('./playerProfilePresentation.js');
var store = require('./playerProfileShadowStore.js');

function stats(overrides) {
  return Object.assign({
    handsPlayed: 200,
    vpipHands: 48,
    vpipOpportunities: 200,
    pfrHands: 40,
    pfrOpportunities: 200,
    afDetails: { bets: 38, raises: 27, calls: 35 },
    threeBetMade: 5,
    threeBetOpportunities: 60,
    foldToThreeBet: 12,
    foldToThreeBetOpportunities: 24,
    flopCBetMade: 24,
    flopCBetOpportunities: 40,
    foldToFlopCBet: 16,
    foldToFlopCBetOpportunities: 36,
    wentToShowdown: 22,
    sawFlopForWTSD: 70,
    wonMoneyAtShowdown: 11,
    showdownsForWSD: 22
  }, overrides || {});
}

function zeroStats(hands) {
  return stats({
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
  });
}

function tagNames(record) {
  return record.tags.map(function (tag) { return tag.tag; });
}

var state = store.createState({ classifier: classifier, presenter: presentation, maxPlayers: 200, maxHistoryPerPlayer: 10 });

// L1/L2: new and ten-hand players remain insufficient.
var l1 = store.update(state, 'stable-L', zeroStats(0), { generatedAt: 1 });
assert.strictEqual(l1.record.primary.archetype, 'Unknown / Insufficient Sample');
assert.strictEqual(l1.record.hands, 0);
var l2 = store.update(state, 'stable-L', zeroStats(10), { generatedAt: 2 });
assert.strictEqual(l2.record.primary.archetype, 'Unknown / Insufficient Sample');

// L3: supported TAG evidence after the minimum sample.
var l3Stats = stats({ handsPlayed: 50, vpipHands: 12, vpipOpportunities: 50, pfrHands: 10, pfrOpportunities: 50, afDetails: { bets: 10, raises: 8, calls: 10 } });
var l3 = store.update(state, 'stable-L', l3Stats, { generatedAt: 3 });
assert.strictEqual(l3.record.primary.archetype, 'TAG');
assert.strictEqual(store.displayedProfile(state, 'stable-L').rawArchetype, 'TAG', 'presentation state is stored separately from the raw record');
assert.strictEqual(Object.prototype.hasOwnProperty.call(l3.record, 'visible'), false, 'raw record is not mutated with presentation fields');

// L4: weak TAG tightness is LAG-like before later evidence becomes supported TAG.
var transitionState = store.createState({ classifier: classifier });
var uncertain = store.update(transitionState, 'stable-transition', stats({ vpipHands: 64, pfrHands: 52, afDetails: { bets: 40, raises: 28, calls: 34 }, threeBetMade: 7 }), { generatedAt: 10 });
assert.strictEqual(uncertain.record.primary.archetype, 'LAG');
var supportedTag = store.update(transitionState, 'stable-transition', stats(), { generatedAt: 11 });
assert.strictEqual(supportedTag.record.primary.archetype, 'TAG');
assert.ok(supportedTag.record.history.some(function (entry) { return entry.archetype === 'LAG'; }));
assert.strictEqual(supportedTag.record.history.slice(-1)[0].archetype, 'TAG');

// L5: the same stable ID transitions from TAG to LAG as cumulative evidence changes.
var tagToLagState = store.createState({ classifier: classifier });
assert.strictEqual(store.update(tagToLagState, 'stable-shift', stats({ handsPlayed: 100, vpipHands: 24, vpipOpportunities: 100, pfrHands: 20, pfrOpportunities: 100 }), { generatedAt: 20 }).record.primary.archetype, 'TAG');
var lagUpdate = store.update(tagToLagState, 'stable-shift', stats({ handsPlayed: 250, vpipHands: 100, vpipOpportunities: 250, pfrHands: 82, pfrOpportunities: 250, afDetails: { bets: 65, raises: 45, calls: 45 }, threeBetMade: 18, threeBetOpportunities: 100 }), { generatedAt: 21 });
assert.strictEqual(lagUpdate.record.primary.archetype, 'LAG');
assert.deepStrictEqual(lagUpdate.record.history.map(function (entry) { return entry.archetype; }), ['TAG', 'LAG']);

// L6-L9: support belongs to each situational denominator.
var l6 = store.update(state, 'stable-L6', stats({ foldToThreeBet: 1, foldToThreeBetOpportunities: 1 })).record;
assert.strictEqual(tagNames(l6).some(function (tag) { return /3B$/.test(tag); }), false);
var l7 = store.update(state, 'stable-L7', stats({ threeBetMade: 2, threeBetOpportunities: 2 })).record;
assert.strictEqual(tagNames(l7).includes('3B Heavy'), false);
var l8 = store.update(state, 'stable-L8', stats({ threeBetMade: 40, threeBetOpportunities: 80 })).record;
assert.strictEqual(tagNames(l8).includes('3B Heavy'), true);
var l9 = store.update(state, 'stable-L9', stats({ wonMoneyAtShowdown: 3, showdownsForWSD: 3 })).record;
assert.strictEqual(tagNames(l9).includes('High W$SD'), false);

// L10-L12 preserve the isolated classifier semantics exactly.
var l10 = store.update(state, 'stable-L10', stats({ vpipHands: 118, pfrHands: 26, afDetails: { bets: 8, raises: 9, calls: 58 }, foldToFlopCBet: 7, foldToFlopCBetOpportunities: 50, wentToShowdown: 48, sawFlopForWTSD: 100 })).record;
assert.strictEqual(l10.primary.archetype, 'Calling Station');
assert.ok(tagNames(l10).includes('Sticky vs CBet') && tagNames(l10).includes('Showdown Heavy'));
var l11 = store.update(state, 'stable-L11', stats({ handsPlayed: 400, vpipHands: 340, vpipOpportunities: 400, pfrHands: 300, pfrOpportunities: 400, afDetails: { bets: 105, raises: 55, calls: 10 }, threeBetMade: 50, threeBetOpportunities: 100 })).record;
assert.strictEqual(l11.primary.archetype, 'Maniac');
var l12 = store.update(state, 'stable-L12', stats({ vpipHands: 64, pfrHands: 52, afDetails: { bets: 40, raises: 28, calls: 34 }, threeBetMade: 7 })).record;
assert.strictEqual(l12.primary.archetype, 'LAG');

// Exact numeric signatures prevent render-cycle recomputation.
var signatures = store.createState({ classifier: classifier });
var signatureInput = stats();
var first = store.update(signatures, 'stable-signature', signatureInput, { generatedAt: 100 });
var second = store.update(signatures, 'stable-signature', Object.assign({ player: 'renamed display value', seat: 9 }, signatureInput), { generatedAt: 200 });
assert.strictEqual(first.updated, true);
assert.strictEqual(second.reused, true);
assert.strictEqual(second.record.generatedAt, 100, 'timestamps, display names, and seats are absent from the signature');
assert.strictEqual(store.inspect(signatures).classifications, 1);
assert.strictEqual(store.inspect(signatures).signatureReuses, 1);

// Stable ownership is never keyed by seat, order, or display name.
assert.strictEqual(second.record.playerId, 'stable-signature');
assert.strictEqual(Object.prototype.hasOwnProperty.call(second.record, 'player'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(second.record, 'seat'), false);

// Malformed input and classifier exceptions fail closed.
var malformed = store.update(state, 'stable-malformed', { handsPlayed: 40 }).record;
assert.strictEqual(malformed.primary.archetype, 'Unknown / Unsupported');
assert.strictEqual(malformed.diagnostic.unsupported, true);
var throwingState = store.createState({ classifier: { classify: function () { throw new Error('synthetic classifier failure'); } } });
var failure = store.update(throwingState, 'stable-error', stats());
assert.strictEqual(failure.failed, true);
assert.strictEqual(failure.record.primary.archetype, 'Unknown / Unsupported');

// Deterministic LRU bounds and per-player history bounds.
var bounded = store.createState({ classifier: classifier, maxPlayers: 2, maxHistoryPerPlayer: 3, confidenceDelta: 0 });
store.update(bounded, 'A', zeroStats(0), { generatedAt: 1 });
store.update(bounded, 'B', zeroStats(0), { generatedAt: 2 });
store.update(bounded, 'A', zeroStats(1), { generatedAt: 3 });
store.update(bounded, 'C', zeroStats(0), { generatedAt: 4 });
assert.deepStrictEqual(store.list(bounded).map(function (record) { return record.playerId; }), ['A', 'C'], 'least recently updated player is evicted');
assert.strictEqual(store.inspect(bounded).evictions, 1);
for (var handCount = 20; handCount < 28; handCount += 1) {
  store.update(bounded, 'A', stats({ handsPlayed: handCount, vpipHands: Math.floor(handCount * 0.24), vpipOpportunities: handCount, pfrHands: Math.floor(handCount * 0.20), pfrOpportunities: handCount }), { generatedAt: handCount });
}
assert.ok(store.get(bounded, 'A').history.length <= 3);

// Debug API returns detached values and clear affects profiles only.
var api = store.createDebugApi(state);
var listed = api.list();
listed[0].primary.archetype = 'mutated externally';
assert.notStrictEqual(api.list()[0].primary.archetype, 'mutated externally');
assert.ok(api.summary().every(function (entry) { return !Object.prototype.hasOwnProperty.call(entry, 'inputSummary'); }));
assert.ok(api.allDisplayedProfiles().length > 0);
var decomposition = api.scoreDecomposition('stable-L3');
assert.strictEqual(decomposition, null, 'unknown stable identity has no synthetic decomposition');
var knownDecomposition = api.scoreDecomposition('stable-L10');
assert.ok(knownDecomposition && knownDecomposition.archetypes['Calling Station'], 'debug API reconstructs a read-only score decomposition from authoritative input counters');
assert.doesNotThrow(function () { JSON.stringify(knownDecomposition); });
var removed = api.clear();
assert.ok(removed > 0);
assert.deepStrictEqual(api.list(), []);
assert.deepStrictEqual(api.allDisplayedProfiles(), []);

assert.doesNotThrow(function () { JSON.stringify(l11); });
assert.strictEqual(JSON.stringify(l11).includes('Infinity'), false);
console.log('Player-profile shadow L1-L12, signatures, transitions, bounds, identity, API, and failure containment passed.');
