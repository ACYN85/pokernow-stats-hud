# Public 1.2.0 testing and certification

Automated behavioral coverage, immutable release integrity, and signed-in live validation are distinct evidence layers. The promoted V1.2 package retains accepted RC2 Build ID `v1.2.0-rc2-20260922-1612`. The final ZIP is byte-identical to the accepted RC2 artifact.

## Normal behavioral suites

Run from the repository root with Node.js:

```powershell
node runTests.js fast
node runTests.js full
```

`fast` contains **193 test files**. `full` contains **212 behavioral test files**, including every checked-in root behavioral `*.test.js`. `testSuites.test.js` enforces membership. Counts refer to test files, not assertions or hands. The V1.2 additions cover exact Session removal, portable Career files and merge, post-Restore first-hand ownership, and Evidence presentation.

The protocol fixtures used by reducer and content-path tests are privacy-sanitized, de-identified, capture-derived behavioral fixtures. They preserve event shape while replacing player/card values and removing timestamps, source filenames, hashes, URLs, account data, and game/hand/session/player identifiers. They are deterministic regression evidence, not live certification.

## Release and freeze integrity

The immutable public-release gate is deliberately excluded from `fast` and `full` so ordinary development is not pinned to a frozen release:

```powershell
node scripts/release.js validate
node runTests.js release
```

`release` contains **1 test file**, `releaseMetadata.test.js`. It verifies synchronized release identity, 70 safe production paths, exact public-baseline hashes, the accepted ZIP SHA-256, deterministic ZIP structure, drift rejection, documentation links, and packaging contracts.

Maintainer release wrappers can record fingerprint-bound results and package only after all gates pass:

```powershell
node scripts/release.js test release
node scripts/release.js test focused
node scripts/release.js test fast
node scripts/release.js test full
node scripts/release.js gates
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-release.ps1
```

The focused release set has **69 test files**. Wrapper output is generated under `outputs/` and is ignored by Git.

## Browser-shaped and live evidence

`node testSupport/seatHudDomFixtureServer.js` serves local DOM fixtures, including `/live-panel.html`, for extracted production layout and drag functions. Fixture measurements and identities are synthetic test data.

Signed-in PokerNow validation is separate because genuine DOM, rendering, account state, and lifecycle behavior cannot be certified by repository fixtures. Accepted RC2 passed signed-in manual smoke before byte-identical final promotion. Case-specific live transcripts are not published in this repository; [the live matrix](LIVE_VALIDATION_MATRIX.md) preserves evidence boundaries. A cold Session-to-Career switch may briefly display Loading before values arrive; pending data does not display authoritative H0.

See the [Release Runbook](RELEASE_RUNBOOK.md), [Live Validation Matrix](LIVE_VALIDATION_MATRIX.md), and [Release Audit](RELEASE_AUDIT.md).
