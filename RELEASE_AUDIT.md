# Public V1.5.0 release audit

The public runtime corresponds to accepted RC2, with Build ID `v1.5.0-rc2-20261006-2218`. The final asset `pokernow-hud-v1.5.0.zip` is a byte-identical copy of that archive: 83 files, 2,651,237 bytes, SHA-256 `560DAF7A3E7F6E586732BC8C7807482261FFF5BEBFF1CFF235BB0BA69B14573E`. No shipped runtime behavior changes during final promotion.

## Curated boundary

Only the production allowlist and user-facing release documentation are promoted. Existing public tooling, synthetic fixtures, and intentionally public demo images are retained. Private certification logs, benchmark evidence, profiles, backups, raw captures, private paths, handoffs, and experiment code are excluded. Runtime files match accepted source after the established manifest-name projection and match the independently extracted archive without any projection.

## Acceptance

RC2 automated release gates passed. The project owner accepted prior A–H smoke and focused RC2 I/J/K: Replace resets Session across hard reload; Merge preserves Session; browser restart persists Career and the correct Session. Backup v2 runtime/portability is certified through 150,000 physical records. 250k and natural idle-eviction are not certified. See [the live matrix](LIVE_VALIDATION_MATRIX.md), [Career Data](CAREER_DATA.md), and [Known Limitations](KNOWN_LIMITATIONS.md).

Final publication requires complete public privacy/parity verification and a downloaded-asset hash check. Historical tags and artifacts remain immutable.
