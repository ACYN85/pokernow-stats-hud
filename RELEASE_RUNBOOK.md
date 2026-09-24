# Public 1.2.0 release runbook

This runbook targets version `1.2.0`, local tag `v1.2.0`, and the accepted RC2 Build ID `v1.2.0-rc2-20260922-1612`. The GitHub Release asset must be the byte-identical promoted ZIP `pokernow-hud-v1.2.0.zip` with SHA-256 `65BB245759FA063CD434B7ECD26DE627FFE2F0C72920F29A1CD0D963F6C1D798`. Run local checks with Node.js, Git, and PowerShell; no npm installation is required.

## Review and behavioral validation

```powershell
git status --short
git diff --check
node packageValidation.test.js
node testSuites.test.js
node runTests.js fast
node runTests.js full
```

Stop after any nonzero result. Review the complete file list before staging. Do not add generated outputs, work directories, browser captures, local databases, logs, or secrets.

## Release/freeze validation

Run the immutable gate separately from behavioral development tests:

```powershell
node scripts/release.js validate
node runTests.js release
```

For fingerprint-bound release evidence and packaging:

```powershell
node scripts/release.js test release
node scripts/release.js test focused
node scripts/release.js test fast
node scripts/release.js test full
node scripts/release.js gates
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-release.ps1
```

The packer uses the sorted `release/production-files.json` allowlist, fixed archive metadata, safe entry validation, independent extraction, and source/stage/extraction integrity checks. It never overwrites an existing destination. Generated output is ignored by `.gitignore`. Any public reproduction is only a parity check; do not upload a separately rebuilt ZIP with different bytes. The certified final asset is the exact accepted RC2 byte copy prepared outside this public checkout.

## Manual validation and publication

Automated fixtures do not replace signed-in validation. The accepted RC2 passed signed-in manual smoke before promotion. [LIVE_VALIDATION_MATRIX.md](LIVE_VALIDATION_MATRIX.md) distinguishes that signoff from unpublished rare-case transcripts; do not commit live captures or private records.

After every gate passes, review and explicitly stage only intended source, public-suitable tests, documentation, and release tools. Inspect `git diff --cached --check`, create one public release commit, and add annotated local tag `v1.2.0` binding the accepted ZIP hash. Do not push or create a GitHub Release during local preparation. Never force-replace a published tag or rewrite published history.

For a future version, update `release/config.json`, manifest metadata, synchronized Build IDs, expected-ID tests, documentation, and the public baseline together. Generate a baseline only from an independently reviewed release tree; never weaken the integrity test to conceal drift.
