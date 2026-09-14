# Public 1.1.0 release runbook

This runbook targets version `1.1.0`, tag `v1.1.0`, and promoted package Build ID `v1.1.0-rc3-20260913-1702`. Run it from a clean Git checkout with Node.js, Git, and PowerShell available. No npm installation or external package is required.

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

The packer uses the sorted `release/production-files.json` allowlist, fixed archive metadata, safe entry validation, independent extraction, and source/stage/extraction integrity checks. It never overwrites an existing destination. Generated output is ignored by `.gitignore`.

## Manual validation and publication

Automated fixtures do not replace signed-in validation. Load the package in desktop Chrome and perform the checks in [LIVE_VALIDATION_MATRIX.md](LIVE_VALIDATION_MATRIX.md) without committing live captures or private records.

After every gate passes, review and explicitly stage only intended source, tests, privacy-sanitized fixtures, documentation, and release tools. Configure the maintainer's Git identity locally, inspect `git diff --cached --check`, create the release commit, and add annotated tag `v1.1.0` only when publication is authorized. Never force-replace a published tag or rewrite published history.

For a future version, update `release/config.json`, manifest metadata, synchronized Build IDs, expected-ID tests, documentation, and the public baseline together. Generate a baseline only from an independently reviewed release tree; never weaken the integrity test to conceal drift.
