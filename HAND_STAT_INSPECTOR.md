# Hand Stat Inspector

> Current status — public 1.1.0: implemented and covered by automated behavioral tests.

The inspector presents the existing 30-hand in-memory statistic-explanation FIFO in a viewport-bounded read-only surface. It introduces no statistic semantics, counter mutation, profile mutation, or persistence. Opening or closing it does not alter the independently persisted seat-overlay and leaderboard visibility preferences.

## Placement and navigation

Open the existing PokerNow HUD Settings panel, select **Diagnostics**, then choose **Hand Stat Inspector**. The inspector opens as an accessible compact dialog inside Settings. Escape or the Close button returns focus to the launcher. History buttons are keyboard accessible, newest hand is listed first, and an explicitly selected older hand remains selected when a new finalized hand arrives.

The dialog uses fixed header, bounded middle, and fixed copy-footer rows. The recent-hand selector and selected-hand details are independent keyboard-focusable scroll containers. Selecting another hand keeps the history position and resets only the detail pane; a finalization refresh preserves the current older-hand selection and scroll positions.

## Hand detail

Each hand row shows its authoritative hand ID when available, a relative order label, and compact finalization status/reason. The selected hand groups decisions by stable player ID. Display names are intentionally not resolved; statistics remain keyed only by stable identity.

The compact view shows counted decisions, meaningful `0/0` exclusions, and unsupported decisions. **Show all** reveals irrelevant decisions. Contributions render as:

- `1/1` for a made result with an opportunity.
- `0/1` for a declined result with an opportunity.
- `0/0` for a supported non-opportunity relevant to the hand.
- `Unsupported` for null or unsupported semantic decisions.

## Copy and data boundaries

**Copy Hand Summary** copies concise human-readable decision lines. **Copy JSON** copies the selected explanation record as formatted JSON. The UI reads cloned explanation data, updates after finalized hands only, retains no separate history, and creates no storage key. It contains no raw WebSocket objects, DOM nodes, cards, chat, session credentials, or name-based identity inference.
