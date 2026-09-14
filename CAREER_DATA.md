# Career data in V1

Career means **all hands currently stored by PokerNow HUD Career data**, not your lifetime PokerNow account history. Tracking begins with newly accepted finalized contributions; there is no import/backfill of earlier Session events or PokerNow Full Log history.

## Ownership and records

`careerServiceWorker.js` owns extension-origin IndexedDB through `careerIndexedStore.js` (storage schema 2). Content scripts use an allowlisted Chrome runtime-message proxy; they never open the host page's IndexedDB.

A contribution is an immutable finalized hand bundle containing canonical host/game/authoritative-hand identity, stable player IDs, exact counters, supported opportunity results, position/relational provenance and a semantic fingerprint. Record schema 2 adds provenance; supported older schema-1 records remain readable but cannot acquire missing relational coverage. Derived aggregate caches are rebuildable, not historical authority.

Fingerprint-keyed append transactions and durable pending/outbox replay prevent duplicate counting. Explicit linear supersession chains select the valid active tip; forks, broken identity/version transitions or ambiguous replacements are quarantined rather than silently summed. Physical record counts can exceed active logical-hand counts.

## Backup and restore

Use **Settings > Career Data > Export Career Backup**. The local JSON backup uses canonical format version 1 and SHA-256 integrity. It includes Career records/metadata, not Session state, profile/hysteresis state, notes or general UI preferences. SHA-256 detects corruption; it is not encryption or proof of who authored a backup.

Restore is **replace-only**, not merge: select a file, validate it without mutation, review the preview and explicit replace warning, then confirm **Restore Career History**. Confirmation binds both the candidate digest and current database digest. New data after preview invalidates confirmation. The worker validates/rebuilds before atomically replacing only Career stores, with in-transaction verification. Session, notes, profiles and settings remain separate.

Export a backup before replacement or extension removal. A release ZIP is not a data backup. Backups contain player/game information; keep them private and review them before sharing. There is no cloud sync or account-wide automatic recovery.

## Size and notes

`careerBackupPolicy.js` sets **32 MiB (33,554,432 bytes)** as the V1 whole-backup limit. Export preflight conservatively estimates 1 MiB overhead + 4 KiB per physical record; therefore 7,936 representative records is the preflight boundary, not a guaranteed hand capacity. Restore checks file size before parsing. Large-ledger backup can be refused while the database remains intact. The `unlimitedStorage` permission is not a guarantee against disk exhaustion or browser data deletion; there is no certified unlimited-capacity claim.

Player notes use `pokerNowHudPlayerNotesV1` in `chrome.storage.local`, keyed by canonical stable player ID. New note creation is capped at 500 players; text is limited to 5,000 characters. A legacy 501st entry can be retained by normalization; it does not authorize more new entries. Notes are outside Career Backup and outside immutable hand contributions.

## Source selection

V1.1 keeps three rebuildable, revision-keyed derived views alongside the immutable ledger: lightweight tracked-player summaries, exact supported 3+ handed profile projections, and fixed-window Recent Trends. Summary heads accelerate enumeration but never decide statistical authority; quarantine and supersession are resolved from authoritative records. Trends use only positive safe-integer `finalizedAt` values for chronology, while undated accepted hands remain in overall Career totals. Dashboard filtered queries share resolution only within a single batch request and do not retain resolved snapshots across requests.

Seat HUD Career queries are batched/deduplicated with stale-response guards. Dashboard Session/Career and position/relational filters aggregate supported stored contributions. Numeric Career selection does not switch the Session-derived profile classifier to a new Career model. The legacy leaderboard range controls do not query Career.

See [Architecture](ARCHITECTURE.md), [Privacy](PRIVACY.md), [Known Limitations](KNOWN_LIMITATIONS.md), and [Testing](TESTING.md).
