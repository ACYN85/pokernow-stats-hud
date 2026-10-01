# Public V1.4.0 release runbook

V1.4.0 promotes the exact accepted RC2 archive. The final package retains Build ID `v1.4.0-rc2-20260930-2250`: `pokernow-hud-v1.4.0.zip`, 73 files, 2,377,285 bytes, SHA-256 `E1F804E1FF9E47A937E857A2F65201B36CEB07C99620E633E3739DC0236AB8BB`. Do not rebuild a replacement distribution archive or rewrite its Build ID.

## Public source and package verification

The 73 root production files must match the accepted private archive byte-for-byte. `release/baseline.json` binds every public production file and the deterministic ZIP hash. Check the release manifest name and version, the Build ID in all runtime contexts, and the sorted allowlist. Then run `node scripts/release.js validate`, the public privacy scan, and the directly relevant release-integrity tests. The final asset is the exact accepted RC2 ZIP copied under its final filename.

The public checkout keeps synthetic fixtures and public documentation. Raw captures, private certification records, experiment files, local artifacts, and private roadmap files are excluded. Verify the public tracked files and archive inventory before distribution.

## Publication

Public push, tag push, GitHub Release, and other distribution require an explicit project-owner record that the PokerNow terms and third-party-tool policy check is complete. Signed-in acceptance of the exact RC2 ZIP is separate from that administrative check. When the publication gate is confirmed, push the curated release commit and annotated `v1.4.0` tag without rewriting prior tags. Attach the exact accepted ZIP to the GitHub Release and verify its hash.
