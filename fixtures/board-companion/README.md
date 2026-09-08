# BoardCompanion fixture policy

Public BoardCompanion fixtures must be synthetic and minimal. They may exercise `PokerBoardCompanionLayout.resolveEvidence()` with generic geometry, table-owner aliases, viewport values, card-count markers, feature offsets, and layout epochs, but must not contain player/table identity, card values, chat, tokens, cookies, authorization data, or browser/session metadata.

Live validation can use the production-page command below locally:

```js
await PokerNowHUDBoardCompanion.captureLayoutSnapshot()
```

Keep any resulting snapshot, screenshot, or diagnostic export outside the repository. The ignored `captured/` directory is reserved for local validation artifacts and must never be used as a path around the public fixture policy.

Synthetic regressions should assert:

- one unchanged epoch across ordinary card/lifecycle/Settings states;
- identical `canonicalBoardLocalRect` and zero-offset LEFT coordinates;
- independent feature-offset semantics;
- explicit epoch-change reasons only for genuine table/viewport changes;
- rejected/logged illegal same-epoch and Settings-owned replacement proposals; and
- stable drag, Reset, clamp, and Pot Odds alignment behavior.

Synthetic fixture success does not replace signed-in live DOM validation.
