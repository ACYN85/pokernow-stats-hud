# Public V1.3.0 release audit

The public source mirrors the accepted V1.3.0 production payload from private RC4. The final archive is an exact byte copy of RC4: 73 files, 2,270,972 bytes, SHA-256 `18966EA9C96C102139E3DAABD0778248847ECFA8F3123D67ABAE47304BC6FD92`. The Build ID remains `v1.3.0-rc4-20260929-0321`.

## Public-copy scope

The repository includes production source, deterministic tests, release tooling, documentation, and de-identified synthetic fixtures. It excludes private development history, raw network captures, browser account data, generated archives, and local work snapshots. The sorted `release/production-files.json` allowlist is the complete 73-file extension archive; tests, docs, and fixtures are excluded from the installed extension.

## Validation boundary

The accepted exact RC4 ZIP was tested signed-in: the production Dashboard mounted, Session/Career and contextual filters rendered correctly, All/HU/3–5/6+ and HU population filtering worked, Profile population, cards, Evidence, and stat details rendered, and Import succeeded. The small imported sample did not fully exercise Insights, Strategic Implications, or Review Signals live; their automated regressions passed. This limitation is not a release blocker. See [the live matrix](LIVE_VALIDATION_MATRIX.md).

The public release baseline hashes every production file and the final archive. Run `node runTests.js release`, `node runTests.js full`, and `node scripts/release.js validate` in a fresh public clone. Public packaging is a reproduction check; distribution uses the exact accepted RC4 byte copy. The publication process must verify all four runtime Build ID sites together.

## Privacy

Session and Career data remain in browser-local storage. User-generated backups and diagnostics may contain player or game information and require review before sharing. The public repository must not contain account credentials, cookies, tokens, private keys, raw captures, or live player-identifying records. No private source history or frozen historical tags are rewritten during V1.3 publication.
