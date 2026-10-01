# Public V1.4.0 release audit

The public production source mirrors the accepted V1.4.0 RC2 payload. The final archive is an exact byte copy: 73 files, 2,377,285 bytes, SHA-256 `E1F804E1FF9E47A937E857A2F65201B36CEB07C99620E633E3739DC0236AB8BB`. The runtime Build ID remains `v1.4.0-rc2-20260930-2250`.

## Public-copy scope

The repository includes the 73-file production payload, public documentation, release tooling, tests, and de-identified synthetic fixtures. It excludes private development history, raw network captures, browser account data, private certification records, probability experiments, generated archives, and local work snapshots. The sorted `release/production-files.json` allowlist defines the installed extension; docs, tests, and fixtures are excluded.

## Validation boundary

The exact RC2 ZIP passed automated, native IndexedDB, browser geometry, clean-checkout parity, and user-reported signed-in acceptance. Signed-in acceptance covered Session, Career, Recent, History, Trends, live refresh, historical deletion, current-Session protection, Dashboard open/closed reload state, selector styling, and the small unset Leaderboard size. Dashboard mode restoration after reload remains a non-blocking V1.4.1 item. See [the live matrix](LIVE_VALIDATION_MATRIX.md).

The public baseline binds each production file and the deterministic archive hash. Validate source and package byte parity and run the public privacy guard before distribution. The release asset is the accepted RC2 ZIP copied under its final filename.

## Publication status

The PokerNow terms and third-party-tool publication-policy check requires an explicit project-owner approval record before a public push, tag push, GitHub Release, store submission, or other distribution. Signed-in product acceptance does not establish platform policy approval.

## Privacy

Session and Career data remain in browser-local storage. User-generated backups and diagnostics may contain player or game information and require review before sharing. The public repository must not contain account credentials, cookies, tokens, private keys, raw captures, or live player-identifying records. Historical public tags are immutable.
