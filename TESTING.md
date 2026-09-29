# Testing and certification

The public V1.3.0 source includes deterministic behavioral tests and a separate immutable release-integrity gate. No npm installation is required.

```powershell
node runTests.js release
node runTests.js full
node scripts/release.js validate
```

The release sequence runs the fingerprint-bound release, focused, fast, and full suites, then `node scripts/release.js gates` and `scripts/package-release.ps1`. The packer validates the 73-file source and extracted archive against `release/baseline.json`. The final distribution archive is the byte-identical accepted RC4 copy. Use [the runbook](RELEASE_RUNBOOK.md) for commands and [the live matrix](LIVE_VALIDATION_MATRIX.md) for signed-in evidence boundaries.
