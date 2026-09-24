# 1.2.0

PokerNow Stats HUD 1.2.0 adds portable Career Data management and clearer sample-support presentation while preserving the existing finalized-hand statistics model.

## Added

- **Export Career Data** creates a gzip-compressed `.json.gz` portable backup. Existing uncompressed Backup v1 JSON remains accepted for import and restore.
- **Import Career Data (Merge)** adds nonduplicate Career records to the existing ledger; an exact duplicate import adds no new hands.
- **Restore Career Backup (Replace)** provides an explicitly confirmed recovery path. A successful replacement resets Session after Career commits; a failed replacement leaves Session intact.
- **Remove Current Session from Career & Reset** uses exact stored hand identity rather than date, name, or count estimates.
- Dashboard Statistical Evidence shows exact support counts and sample-strength labels for supported slices, without a visible “Insufficient” suffix on low-support values.

## Improved

- Leaderboard Career loading distinguishes unresolved, unavailable, settled no-history, and settled values. A Session-to-Career switch may briefly show Loading before values arrive; it no longer presents a pending lookup as authoritative H0.
- Restore, Pause/Resume, reload, and controller hand-ownership fences protect the first eligible fresh hand and prevent stale Career append outcomes from crossing a successful replacement.
- Career transfer validation, duplicate/ambiguity handling, and bounded whole-ledger processing strengthen data integrity.

## Data limits

- Compressed input and decoded JSON have separate 64 MiB limits. Whole-ledger export/import/restore processing is conservatively bounded to 4,032 physical records; gzip does not make the format streaming or unlimited.

# 1.1.0

PokerNow Stats HUD 1.1.0 expands Career analysis and improves live-table reliability while preserving local-only data storage and conservative evidence requirements.

## Added

- Career-backed numeric source for the Leaderboard while preserving its current-table player list and alphabetical ordering.
- Seat HUD visibility control.
- Settings → Players browser with local search, sorting, lightweight Career summaries, and stable-ID dashboard navigation.
- Career player profiles derived only from accepted history with exact supported 3+ handed context.
- Movable and resizable Player Dashboard with page-lifetime geometry retention and Reset Position.
- Exact heads-up-postflop In position / Out of position Dashboard situations; incomplete, multiway, legacy, and unsupported-position hands are excluded rather than inferred.
- Career Recent Trends for the latest 25, 50, 100, and 250 eligible dated hands.

## Improved

- Career Dashboard filtered-query resolution reuse, player-summary indexing, query caching, concurrent-request sharing, and deterministic invalidation.
- Dashboard snapshot isolation, revision consistency, partial supported table-context handling, and quarantine-aware summaries.
- Settings-to-player navigation and Leaderboard reset behavior.
- Reset Session now clears Session statistics and lifecycle state while immediately reconciling current-seat stable identities, preserving Career links without adding or deleting Career data.
- Verified Pause blocks stale or sparse nonterminal traffic from creating hand boundaries or betting-action inference until verified Resume.
- Startup, reload, Reset Session, and Resume can rearm one tightly gated sparse fresh-hand acquisition without weakening normal ownership, signature, or deduplication checks.
- Pot Odds placement resets to its canonical position once on the first authoritative measured flop of each hand, then preserves later user movement across streets and same-hand reload.
- Related lifecycle, race, cache, correctness, and quarantine handling.

## Notes

- Profiles require sufficient supported evidence; heads-up and unknown-context hands do not enter Career archetypes.
- IP/OOP situations require exact supported two-player postflop provenance.
- Trends are Career-only and are not changed by Dashboard position, situation, or opponent filters.
- BTN-vs-blinds, blinds-vs-steal, trend charts, arbitrary date ranges, and Session Trends are not part of V1.1.

# 1.0.0

- Initial public release with live Seat HUD statistics, Session and Career persistence, player dashboards and notes, player profiles, Pot Odds, backup/restore, and lifecycle-safe finalized-hand accounting.
