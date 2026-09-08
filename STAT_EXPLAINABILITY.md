# Per-Hand Statistic Explainability

> Current status — public 1.1.0: implemented and covered by automated behavioral tests.

The bounded read-only diagnostic view reports finalized statistic decisions. It does not parse WebSocket traffic, alter counters, persist data, or expose a MAIN-world bridge. The user-facing Hand Stat Inspector constrains itself to the available viewport and gives its 30-hand selector and selected-hand details separate scroll ownership; inspector state remains independent of canonical HUD-surface visibility.

## Hand Stat Inspector

Open Settings, select Diagnostics, and choose **Hand Stat Inspector**. The compact dialog lists retained finalized hands newest first. Selecting a hand shows stable-player-ID sections with counted decisions, meaningful `0/0` decisions, and unsupported decisions; **Show all** reveals otherwise irrelevant decisions. Values remain visibly distinct as `1/1`, `0/1`, `0/0`, and `Unsupported`.

**Copy Hand Summary** copies concise readable lines. **Copy JSON** copies the selected hand's exact JSON-safe explanation record. The inspector deliberately shows stable IDs rather than resolving display names, so it cannot introduce name-based statistic identity. It refreshes only after finalization, writes no storage, and is cleared by the existing Reset Session behavior together with the explanation FIFO.

The inspector header/close control and copy footer are outside the scrolling middle row. Opening an older hand preserves the history-pane position and resets only the newly selected detail pane. A newly finalized hand is inserted at the head of history without stealing the older selection, focus, or either retained scroll position.

## Isolated-world API

- `PokerNowHUDProfiles.lastHandStatExplanation()` returns the newest finalized-hand explanation or `null`.
- `PokerNowHUDProfiles.handStatExplanation(handId)` accepts either authoritative or lifecycle hand identity.
- `PokerNowHUDProfiles.handStatExplanations()` returns the bounded retained history.
- `PokerNowHUDProfiles.explainLastHand()` returns concise human-readable lines.

After a suspicious hand, use:

```js
JSON.stringify(PokerNowHUDProfiles.lastHandStatExplanation(), null, 2)
```

## Decision schema

Each player has `vpip`, `pfr`, `threeBet`, `foldToThreeBet`, `flopCBet`, `foldToFlopCBet`, `wtsd`, and `wsd` entries. Every entry includes:

- `decision.opportunity`: `true`, `false`, or `null` from the relevant semantic source.
- `decision.result`: `true`, `false`, or `null`.
- `semanticContribution`: `"1/1"`, `"0/1"`, `"0/0"`, or `null`.
- `counterContribution`: the actual integer numerator/denominator applied to authoritative counters.
- `status`: `counted`, `not_applicable`, or `unsupported`.
- `reasonCode` and `reasonText`.
- `sourceReason`: the unchanged reducer reason.
- `contributionId` when an authoritative finalized event was annotated.
- `candidateContributionId` for correlation when no counter was attached.
- bounded action/evidence references and attachment outcome.

`semanticContribution` and `counterContribution` are deliberately separate. Unsupported decisions stay `null` even when their correct persisted effect is `0/0`.

## Bounds and privacy

The module retains the latest 30 finalized hands in FIFO memory. Reset Session clears the buffer. It stores stable player IDs, hand identities, compact action references, reducer reasons, and contribution IDs only. It contains no player display names, raw frames, socket objects, cards, chat, URLs, tokens, cookies, or new `chrome.storage` key.
