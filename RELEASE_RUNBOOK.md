# Public V1.3.0 release runbook

V1.3.0 promotes the exact accepted RC4 archive. Final tag `v1.3.0` retains Build ID `v1.3.0-rc4-20260929-0321`. The 73-file ZIP is 2,270,972 bytes with SHA-256 `18966EA9C96C102139E3DAABD0778248847ECFA8F3123D67ABAE47304BC6FD92`. Do not rebuild a replacement distribution archive.

## Public source verification

In a fresh clone, verify the public `v1.3.0` tag, clean status, production manifest name and version 1.3.0, and equal Build IDs in `content.js`, `runtimeScope.js`, `popup.js`, and `careerServiceWorker.js`. Then run:

```powershell
node runTests.js release
node runTests.js full
node scripts/release.js validate
node scripts/release.js test release
node scripts/release.js test focused
node scripts/release.js test fast
node scripts/release.js test full
node scripts/release.js gates
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-release.ps1
```

The packer uses the sorted 73-file allowlist, fixed archive metadata, independent extraction, and source/stage/extraction checks. Compare the reproduced ZIP byte-for-byte with the accepted final archive; only the accepted archive is the release asset. Generated output is ignored by Git.

## Publication

Review the tracked file list and scan for credentials, identifiers, absolute paths, and raw captures. Stage only public-suitable source, tests, docs, and release tools. Commit the V1.3 sync, add an annotated `v1.3.0` tag binding the accepted ZIP hash, and push the commit and tag without rewriting history. Preserve V1.1/V1.2 public tags. Signed-in acceptance and unobserved cases are recorded in [the live matrix](LIVE_VALIDATION_MATRIX.md).
