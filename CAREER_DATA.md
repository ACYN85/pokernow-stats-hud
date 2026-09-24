# Career data in V1.2

Career means **all hands currently stored by PokerNow HUD Career data**, not your lifetime PokerNow account history. Tracking begins with newly accepted finalized contributions; there is no import/backfill of earlier Session events or PokerNow Full Log history.

## Ownership and records

`careerServiceWorker.js` owns extension-origin IndexedDB through `careerIndexedStore.js` (storage schema 2). Content scripts use an allowlisted Chrome runtime-message proxy; they never open the host page's IndexedDB.

A contribution is an immutable finalized hand bundle containing canonical host/game/authoritative-hand identity, stable player IDs, exact counters, supported opportunity results, position/relational provenance and a semantic fingerprint. Record schema 3 adds exact dealt-position/table-count provenance; supported schema-2 and older schema-1 records remain readable but cannot acquire missing provenance. Derived aggregate caches are rebuildable, not historical authority.

Fingerprint-keyed append transactions and durable pending/outbox replay prevent duplicate counting. Explicit linear supersession chains select the valid active tip; forks, broken identity/version transitions or ambiguous replacements are quarantined rather than silently summed. Physical record counts can exceed active logical-hand counts.

## Export, import, and restore

Use **Settings > Data > Export Career Data** for a portable `.json.gz` backup. New exports gzip-compress compact Backup v1 JSON with SHA-256 integrity; Import and Restore also accept older uncompressed Backup v1 JSON, detected by content rather than filename. Career records and reconstruction metadata are included, but Session state, notes, UI preferences and rebuildable derived caches are not. SHA-256 detects corruption; it is not encryption or proof of who authored a backup.

**Import Career Data (Merge)** validates the file and the combined local-plus-imported ledger before an atomic union. Exact duplicate physical records count once; ambiguous combined history is rejected without mutation. A successful import leaves Session unchanged.

**Restore Career Backup (Replace)** is advanced recovery, not merge: select a file, validate it without mutation, review the preview and explicit replace warning, then confirm. Confirmation binds both the candidate and current Career digests. The worker rebuilds and verifies before atomically replacing Career stores. Only after successful replacement does the current Session reset; failure preserves Session. Notes and settings remain separate.

**Remove Current Session from Career & Reset** matches retained finalized Session hand IDs to exact same-room Career provenance. It removes every physical version of a matched logical hand for all participants, fails closed on ambiguity, and resets Session only after the Career commit. It never guesses by date, player name, or recent count.

Export a backup before replacement or extension removal. A release ZIP is not a data backup. Backups contain player/game information; keep them private and review them before sharing. There is no cloud sync or account-wide automatic recovery.

## Size and notes

Compressed input and decoded compact JSON have separate **64 MiB (67,108,864 bytes)** limits. Export preflight conservatively estimates 1 MiB overhead plus 16 KiB per physical record, limiting this whole-ledger format to **4,032 physical records**; Import checks the merged union and Restore checks the replacement candidate against the same exportable bound. Malformed, truncated, oversized, or invalid input fails before mutation. Gzip improves transfer size but does not make processing streaming or unlimited. The `unlimitedStorage` permission does not guarantee against disk exhaustion or browser data deletion.

Player notes use `pokerNowHudPlayerNotesV1` in `chrome.storage.local`, keyed by canonical stable player ID. New note creation is capped at 500 players; text is limited to 5,000 characters. A legacy 501st entry can be retained by normalization; it does not authorize more new entries. Notes are outside Career exports and immutable hand contributions.

## Source selection

V1.2 keeps three rebuildable, revision-keyed derived views alongside the immutable ledger: lightweight tracked-player summaries, exact supported 3+ handed profile projections, and fixed-window Recent Trends. Summary heads accelerate enumeration but never decide statistical authority; quarantine and supersession are resolved from authoritative records. Trends use only positive safe-integer `finalizedAt` values for chronology, while undated accepted hands remain in overall Career totals. Dashboard filtered queries share resolution only within a single batch request and do not retain resolved snapshots across requests.

Seat HUD and Leaderboard Career queries are batched/deduplicated with stale-response guards. A pending first Career batch displays Loading, a failed batch displays Unavailable, and only settled genuine missing history displays H0. An ordinary same-room/same-roster refresh may reuse a warm settled snapshot; incompatible source, room or roster changes clear it. Dashboard Session/Career and position/relational filters aggregate supported stored contributions. Numeric Career selection does not switch the Session-derived profile classifier to a new Career model. The legacy leaderboard range controls do not query Career.

See [Architecture](ARCHITECTURE.md), [Privacy](PRIVACY.md), [Known Limitations](KNOWN_LIMITATIONS.md), and [Testing](TESTING.md).
