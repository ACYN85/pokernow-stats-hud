# Stable table-local BoardCompanion layout

## Defect and ownership correction

The previous resolver recomputed a canonical viewport rectangle on ordinary renders. Its eligible sources included explicit slot nodes, reconstructed visible-card geometry, last-known viewport geometry, and a table-relative bootstrap. Those sources do not necessarily share the same physical origin. Card count, board subtree presence, or the timing of a reconcile could therefore select a different rectangle within an otherwise unchanged PokerNow table layout.

The remaining intermittent Settings jump had a separate exact cause: a combined comma selector returned matches in document order, not selector-priority order. Settings contains its own `<main>`, so that measurable extension node could be supplied as the table owner when it preceded a late-mounted PokerNow table. The synthetic board model was then projected through Settings geometry. The same wrong canonical base made a correct reset offset render below/left of the real board.

That ownership model is removed. Card DOM is observational evidence; it does not own companion coordinates.

## Stable table coordinate owner

`PokerBoardCompanionLayout` selects the persistent PokerNow table/stage element, in priority order:

1. `#table`;
2. `.game-table` / `[class~="game-table"]`;
3. the persistent game `main` stage.

`content.js` queries those selectors individually, retains a connected owner when it remains the highest available priority, and promotes a generic `main` when a stronger PokerNow owner appears. Settings roots are marked extension-owned, and both the controller and layout service exclude extension-owned candidates. The owner exists preflop and postflop, survives community-card subtree replacement, and is independent of extension Settings. Hero cards, board-card nodes, the pot, and Settings are never coordinate owners.

Diagnostics expose `tableOwnerSource`, `tableViewportRect`, raw transform/origin evidence, local size, scale, viewport, device-pixel ratio, and visual-viewport scale. Fresh live DOM alignment remains required because no real layout snapshot is included in this public copy.

## Layout epoch

A layout epoch is one stable physical PokerNow table coordinate system. It is identified by the table/route, persistent table-owner identity, viewport and visual-viewport metrics, owner viewport rectangle, local dimensions, layout mode, transform, and scale evidence.

A new epoch is accepted only for a genuine coordinate-system change:

- viewport, zoom, or visual-viewport scale changes;
- table-owner size or viewport position changes;
- table-owner transform or scale changes;
- responsive table coordinate-space changes;
- route/table or persistent table-owner replacement.

These do **not** create an epoch:

- preflop/flop/turn/river or card count;
- hand start, action, showdown, hand end, or between-hands state;
- board wrapper/card mount, unmount, or replacement;
- Settings open, close, or tab changes;
- pot-odds contents, dragging, offset persistence, or reset.

Every accepted epoch receives `layoutEpochId`, advances the material layout revision, and records an explicit reason in `acceptedLayoutEpochChanges` and the bounded BoardCompanion event history.

## Canonical table-local board model

Each epoch owns exactly one full five-card community-board slot:

```text
canonicalBoardLocalRect = {
  left/top relative to the stable table owner,
  width/height in the owner's local CSS coordinate space
}
```

The current viewport rectangle is derived only from the epoch model:

```text
canonicalBoardViewportRect =
  tableViewportOrigin + canonicalBoardLocalRect × table scale
```

At epoch establishment, five explicit persistent card-slot nodes define the strongest structural five-card envelope. If 3–5 actual community cards are already visible and have a credible pitch, the service reconstructs the complete five-slot envelope from the true first-card slot, card width/height, and four pitches. A previously observed local envelope may be reused at a later genuine epoch only for the exact same local table dimensions and layout mode. Only then does the checked-in PokerNow table-local five-card model `pokernow-five-card-table-local-v1` act as fallback. The fallback is synthetic and explicitly diagnosed as awaiting fresh live alignment signoff.

Once written, `canonicalBoardLocalRect` is immutable for that epoch. A board wrapper, three-card union, four-card union, five-card union, pot-relative rectangle, hero-card rectangle, or saved panel rectangle cannot replace it.

## Cards establish only at an epoch boundary, then validate

Visible community cards are converted into the same table-local coordinate space and compared with expected slot positions, pitch, height, and top alignment. Diagnostics expose:

- `boardCardCount`;
- `validationOnlyActualCardRects`;
- `validationOnlyActualCardLocalRects`;
- `cardValidation` and pitch/tolerance evidence.

Agreement validates the model. Disagreement is recorded but cannot move LEFT or RIGHT. If structural slot evidence proposes a materially different local rectangle while the epoch, owner, viewport, table geometry, and transform are unchanged, the service records `ILLEGAL_CANONICAL_GEOMETRY_CHANGE` and rejects the proposal. A Settings-correlated owner/canonical replacement is rejected as `ILLEGAL_SETTINGS_GEOMETRY_CHANGE`.

Card evidence may establish a different structural envelope only after an independently proven new table-layout epoch has started.

## Shared LEFT and RIGHT contracts

Both companion slots consume the same canonical board rectangle:

```text
LEFT.right   = canonicalBoardViewportRect.left - 10px
LEFT.centerY = canonicalBoardViewportRect.centerY

RIGHT.left   = canonicalBoardViewportRect.right + 10px
RIGHT.centerY = canonicalBoardViewportRect.centerY
```

Pot Odds consumes LEFT. The future Turn/River probability companion must consume RIGHT and must not inspect board DOM, create another layout observer, choose another anchor, or hide when its computation is unavailable.

## Feature offset layer

Canonical geometry and feature positioning are separate layers:

```text
actual feature position = canonical companion slot + feature-owned offset
```

Pot Odds owns only `potOddsOffsetX` and `potOddsOffsetY`. Its offset remains unchanged across every street, hand lifecycle state, Settings state, and board remount. A genuine new epoch recalculates the base rectangle and reapplies the exact same offset. Manual overlap outranks collision avoidance; only the 8px viewport-accessibility clamp can alter rendered pixels.

Every offset mutation is reason-coded `DRAG_COMMIT`, `RESET_POSITION`, or `PREFERENCE_MIGRATION`. Settings open/close/navigation is not an allowed write source; an attempted Settings write is rejected and recorded as `ILLEGAL_SETTINGS_OFFSET_CHANGE`.

Future RIGHT companions own independent offsets. LEFT and RIGHT offsets cannot mutate one another or shared canonical geometry.

Reset Pot Odds Position means only:

```text
potOddsOffsetX = 0
potOddsOffsetY = 0
actual position = current epoch's canonical LEFT slot
```

Because the base slot is immutable within the epoch, reset yields the same physical position before the hand, preflop, postflop, at showdown, and between hands.

Drag input is delegated from the stable `#pnhud-pot-odds-root`, not imperatively owned by one host instance. The title has an 18px minimum hit area. Diagnostics record accepted/rejected pointerdown, capture request/result, threshold crossing, transient moves, commit/cancel, and persistence, so content refresh or host replacement cannot silently remove ownership.

## Visibility and invalidation

The table-scoped Pot Odds host remains visible on a supported table when Show Pot Odds is on and canonical hero/table applicability is known. Poker content state (`CALL`, `ZERO`, or `UNKNOWN`) is independent from placement and visibility. Temporary missing computation uses `—`; temporary missing layout geometry retains the last visible position or the deterministic visible fallback.

`PokerBoardCompanionLayout.subscribe(state, listener)` is event-driven. Revisions advance for initial readiness, accepted layout epochs, table/route replacement, or explicit cleanup invalidation—not for street/card/Settings activity. There is no polling or permanent animation loop.

## Safe live diagnostics

From ordinary PokerNow DevTools:

```js
await PokerNowHUDBoardCompanion.layoutInfo()
await PokerNowHUDBoardCompanion.captureLayoutSnapshot()
await PokerNowHUDBoardCompanion.eventHistory()
```

The frozen MAIN-world bridge exposes only these asynchronous reads through same-origin `postMessage`. It strips table/player identity, card values, chat, token, cookie, and authorization-like fields and exposes no mutation operations.

The schema-3 layout snapshot includes:

- `layoutEpochId` and accepted-change reason;
- `tableOwnerSource`, `tableViewportRect`, and transform/scale evidence;
- `canonicalBoardLocalRect` and `canonicalBoardViewportRect`;
- canonical LEFT/RIGHT rectangles;
- feature offset, unclamped/rendered Pot Odds rectangles, clamp, and drag state;
- street/card count for correlation only;
- validation-only card geometry;
- `boardAlignment`: expected/observed first-slot rectangles and deltas, expected/actual Pot Odds rectangles and deltas, and tolerance status;
- reset state, delegated drag/capture state, and latest offset-mutation reason;
- Settings visibility for correlation only;
- the latest rejected illegal same-epoch proposal.

`eventHistory()` keeps at most 160 meaningful events. Accepted epoch changes, rejected illegal geometry, applicability, render request/commit, host lifecycle, drag, offset persistence, reset, clamp, and explicit Settings open/tab/close before/after snapshots are recorded without sampling or sensitive poker data.

## Synthetic-layout regression workflow

Synthetic fixtures prove invariants but cannot certify real alignment. For release alignment:

1. Load the candidate unpacked in Chrome and open one PokerNow table.
2. At zero offset, capture preflop, flop, turn, river, and between-hands screenshots.
3. At each state run `await PokerNowHUDBoardCompanion.captureLayoutSnapshot()`.
4. Save the already privacy-scrubbed JSON under `fixtures/board-companion/captured/` with viewport/layout metadata.
5. Review once more for identity or card values, then commit the sanitized fixture.
6. Replay its exact table owner, transform, board-slot, and card rectangles through `PokerBoardCompanionLayout.resolveEvidence()`.
7. Assert one epoch and identical canonical/LEFT coordinates across card states; repeat with a feature offset.
8. Compare diagnostic rectangles with the screenshots. A synthetic pass does not replace this step.

The fixture directory contains the required metadata and certification policy. The public repository intentionally contains no real layout capture; status is: **LIVE RESET/DRAG/SETTINGS POSITION SIGNOFF REQUIRED.**

## Permanent BoardCompanion rules

1. The persistent PokerNow table/stage owns the coordinate system.
2. One immutable `canonicalBoardLocalRect` exists per layout epoch.
3. Card DOM validates the model and never owns or replaces it within an epoch.
4. Community-card count and poker lifecycle cannot create an epoch.
5. Settings visibility and tab selection cannot create an epoch.
6. Board subtree remount cannot create an epoch while the table owner/layout is unchanged.
7. LEFT and RIGHT derive from the same canonical rectangle and 10px gap contract.
8. Every feature owns an independent relative offset.
9. Manual offset outranks collision avoidance; only viewport accessibility clamping applies.
10. Feature visibility is independent from calculation availability; unavailable values render `—`.
11. Reset means offset `0/0` plus immediate current canonical-slot rendering.
12. Genuine layout changes create a diagnosed epoch and preserve feature offsets.
13. Consumers subscribe to material revisions; polling and permanent RAF loops are forbidden.
14. Illegal same-epoch canonical replacements are rejected and logged.
15. Diagnostics remain read-only, privacy-safe, ordinary-DevTools accessible, meaningful-event based, and bounded.
16. Future RIGHT-side Turn/River UI inherits this exact controller, lifecycle, drag, reset, and visibility contract.
17. Real captured-layout and live screenshot signoff are required; handcrafted fixture success is not live certification.
