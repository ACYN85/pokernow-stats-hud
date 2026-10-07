# Career data in V1.5.0

Career is the history this extension observed and stored locally, not lifetime PokerNow account history. Settings → Data offers **Export Backup v2** and **Restore or Merge Backup v2** for large histories. The certified runtime/portability target is 150,000 physical records; 250k portability is not certified.

## Backup v2

1. Open Settings → Data from the PokerNow game whose Session you want the transfer page to use.
2. For export, select **Export Backup v2**, choose a **fresh filename**, and keep the page open until completion. Streaming gzip avoids materializing a whole-history Backup v1 JSON document. Existing-file overwrite is interruption-unsafe and may destroy its old content immediately.
3. To restore or combine histories, select **Restore or Merge Backup v2**, choose Replace or Merge, select your file, wait for validation, and review the confirmation before publication.

**Replace** replaces Career with the validated backup and resets the selected current Session after Career commits. Hard reload and browser restart preserve the reset. If Session storage fails after Career publication, Career stays committed; follow the reported Reset Session instruction. Other open games retain independent Sessions.

**Merge** combines compatible Career histories, deduplicates identical records, rejects conflicts rather than overwriting them, and preserves the current Session. A fully duplicate backup can report NO_CHANGE. Career changes during staging may require retrying. Failed or canceled imports before publication preserve existing Career.

Backups include authoritative physical Career records, supersession links, and required boundary metadata. They exclude Session state, notes, UI preferences, and rebuildable derived data. Backups are not encrypted and may contain player/game information: keep them private.

Incomplete Backup v2 files are invalid. Interrupted transfers are not durably resumable; discard incomplete exports and restart with a fresh filename. Before derived READY, exact raw History/Recent/Trends reads may take minutes. Very large rebuilds may take substantial time. IndexedDB physical disk compaction is not immediate or guaranteed. See [Known Limitations](KNOWN_LIMITATIONS.md).

## Ownership and records

`careerServiceWorker.js` owns extension-origin IndexedDB through `careerIndexedStore.js` (storage schema 5). Content scripts use an allowlisted Chrome runtime-message proxy; they never open the host page's IndexedDB.

A contribution is an immutable finalized hand bundle containing canonical host/game/authoritative-hand identity, stable player IDs, exact counters, supported opportunity results, position/relational provenance and a semantic fingerprint. Current record schema 4 adds `session: { schemaVersion: 1, sessionId: string | null }`; null means exact Session provenance was unavailable. Schema-3 records retain exact dealt-position/table-count provenance; supported schema-2 records retain relational coverage and schema-1 records remain readable. Older records cannot acquire missing historical Session provenance. Derived aggregate caches are rebuildable, not historical authority.

Fingerprint-keyed append transactions and durable pending/outbox replay prevent duplicate counting. Explicit linear supersession chains select the valid active tip; forks, broken identity/version transitions or ambiguous replacements are quarantined rather than silently summed. Physical record counts can exceed active logical-hand counts.

Derived Career aggregate schema 4 maintains Overall, supported position and postflop IP/OOP counters, and exact dealt-player-count partitions with the same contexts. The count comes from frozen finalized-hand `iHPI` provenance through the position resolver; Away, sitting-out, and late-joining seats are excluded, while a dealt player who later folds or leaves remains counted. Product buckets are disjoint: HU (2), 3–5, and 6+ (6–9). Missing or inconsistent old provenance is UNKNOWN: its counters remain in All but no table-size segment. Ordinary finalized appends extend the applicable partitions in the existing transaction. Derived aggregates and historical projections are rebuilt through bounded, resumable local work; warm maintained Dashboard reads do not traverse player history. Supersession, Import, Restore, and Session removal preserve shared-resolver authority and atomically update or invalidate coupled derived state. Backup v1 contains immutable records, not aggregate caches, so its format is unchanged. Session maintains equivalent partitions in memory from finalized events and reconstructs them on hydration.

The Dashboard selects All, HU, 3–5, or 6+ without clearing position, situation, or opponent filters. All shows combined raw counters and table-size tracking coverage. A mixed or unknown All population has no calibrated Profile, Insights, Implications, or Review Signals; an authoritatively single-bucket slice may be analyzed. Evidence support gates remain independent of the table-size product heuristics in `playerInsights.js`. Relational filters retain their existing resolved-history path and apply table size during that traversal.

## Historical Sessions, Recent, and Trends

Each new Session receives an opaque per-game ID that persists across reload and rotates when Session state is explicitly cleared. The Dashboard lists only Sessions with exact recorded provenance; older unassigned hands remain in Career totals. Historical detail supports recorded table-size, situation, position, and relational filters where the underlying hand has sufficient provenance. Recent selects either canonical player Sessions or eligible dated hands before applying those filters, then compares the selected counters with full Career counters. Session Trends retain canonical Session order and show each Session's observed statistics without forecasting.

Confirmed historical Session deletion removes the selected canonical Session and all physical versions of its hands from Career for every affected player, then rebuilds derived Career state. The current live Session is protected from this path and continues normally. An old Backup v1 file may reintroduce deleted records through Import or Restore.

## Backup v1 export, import and advanced recovery

Use **Settings > Data > Export Career Data** for portable transfer. New exports are compact Backup format version 1 JSON compressed with browser-native gzip and use the `.json.gz` extension. Decompression produces the same complete Backup v1 semantics with SHA-256 integrity; no Career storage or record schema changes. The file includes every authoritative physical Career record, including namespaces, authoritative/lifecycle hand IDs, stable player IDs, fingerprints and supersession links, plus the minimal Career boundary metadata needed to reconstruct the ledger. Session state, notes, general UI preferences, aggregate caches, player heads/summaries, Trends caches and profile/hysteresis state are not included. SHA-256 detects corruption; it is not encryption or proof of who authored a backup.

**Import Career Data** is the normal transfer workflow. It detects gzip by content magic bytes rather than filename, and continues to accept existing uncompressed Backup v1 JSON. After bounded decompression it applies the same Backup v1 schema, graph and integrity validation, replays pending durable Career appends, deduplicates exact physical fingerprints and resolves the complete local-plus-imported union with the existing Career resolver. Exact duplicate hands count once. A complete supersession chain remains authoritative regardless of which side already had the newer tip. Competing roots, branches, broken chains, fingerprint collisions or any other combined graph ambiguity are not guessed: the whole import is rejected before mutation. Confirmation binds both the candidate and current Career digests. A successful import commits the union and rebuilds aggregates, summaries/heads, Dashboard/Profile/Trends projections and caches in one Career transaction. Session and notes are unaffected.

**Advanced Recovery > Restore Career Backup (Replace)** accepts both compressed exports and legacy Backup v1 JSON while retaining SAFE REPLACE disaster recovery. It validates without mutation, shows an explicit warning that newer current Career hands will be removed, and binds confirmation to both candidate and current digests. The worker rebuilds and verifies before atomically replacing Career stores. Only after that verified commit succeeds, the current Session is reset to establish a clean provenance boundary; a failed replacement leaves Session intact, and an authoritative Pause latch survives the reset. Notes and settings remain separate. Import/Merge and Export continue to leave Session unchanged.

Export Career Data before replacement or extension removal. A release ZIP is not a data backup. Career files contain player/game information; keep them private and review them before sharing. There is no cloud sync or account-wide automatic recovery.

## Session and exact Career removal

**Settings > Data** owns the only **Reset Session** control. Reset keeps Career history, notes, tracked-player metadata and HUD settings while clearing the current room's Session statistics/lifecycle state and manual seat positions, preserving the established Reset Session behavior.

**Remove Current Session from Career & Reset** uses the retained finalized Session hand IDs and exact Career provenance already present in V1.1 records: canonical provider/host/game namespace, `authoritativeHandId`, `lifecycleHandIds`, logical `handKey` and fingerprint. It never guesses by date, display name, count or recency. A Session ID must map to at most one same-room logical hand; ambiguity or malformed provenance fails closed. Unmatched Session hands are reported as absent from Career. Every physical supersession/quarantine record for each matched logical hand is selected together, so the shared hand is removed for all participating stable IDs.

Preview and confirmation are bound to the current Career SHA-256 digest and exact deletion plan. Pending appends settle first. The mutation uses one ledger snapshot and one atomic IndexedDB transaction, deletes only selected physical records, recomputes ledger metadata, and replaces only affected player heads/aggregate caches; Dashboard/Trends runtime caches are invalidated. Session reset is invoked only after Career commit. If Career mutation fails, Session remains available for retry. A player with no remaining active Career aggregate is absent from Tracked Players, matching its existing active-summary definition. Notes and preferences are stored separately and are not changed.

## Backup v1 limits and notes

`careerBackupPolicy.js` keeps a **64 MiB (67,108,864 bytes)** compressed-input ceiling and a separate **64 MiB decoded compact-JSON ceiling**. Export allocation preflight conservatively estimates 1 MiB overhead + 16 KiB per physical record, currently at most 4,032 physical records, because player-rich records vary substantially. After canonical Backup v1 creation, export verifies the exact compact UTF-8 JSON size; gzip output is also bounded. Therefore this version cannot knowingly publish a supported export that its own reader refuses on size. Import and restore inspect content and stream gzip decompression into a bounded collector before UTF-8 decoding/`JSON.parse`; Import checks the merged union and Restore checks the replacement candidate against the same exportable physical-record bound at preview and confirmation. Malformed, truncated, oversized or schema/integrity-invalid input fails before mutation.

Gzip improves transfer size, not the whole-ledger memory model. Export still materializes the Career export, Backup v1 object, compact JSON text/bytes and compressed blob. Import/restore still retain the selected file, decoded bytes/text, parsed object and validation/rebuild working data. The supported envelope is therefore the policy above, not millions of hands. Backup v2 supplies the separately certified large-history streaming path described above. The `unlimitedStorage` permission is not a guarantee against disk exhaustion or browser data deletion; there is no certified unlimited-capacity claim.

Player notes use `pokerNowHudPlayerNotesV1` in `chrome.storage.local`, keyed by canonical stable player ID. New note creation is capped at 500 players; text is limited to 5,000 characters. A legacy 501st entry can be retained by normalization; it does not authorize more new entries. Notes are outside Career export/import/restore and outside immutable hand contributions.

## Source selection

Seat HUD and Leaderboard Career queries are batched/deduplicated with stale-response guards. The Leaderboard retains a last-good Career batch only for the same room and exact stable-ID roster while an ordinary revision replacement is pending; source, room, roster and SAFE REPLACE changes clear it. Dashboard Session/Career and position/relational filters aggregate supported stored contributions. Numeric Career selection does not switch the Session-derived profile classifier to a new Career model. The legacy leaderboard range controls do not query Career.

See [Architecture](ARCHITECTURE.md), [Privacy](PRIVACY.md), [Known Limitations](KNOWN_LIMITATIONS.md), and [Testing](TESTING.md).
