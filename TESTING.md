# Public 1.1.0 testing and certification

Automated behavioral coverage, immutable release integrity, and signed-in live validation are distinct evidence layers. The promoted V1.1 package Build ID is `v1.1.0-rc3-20260913-1702`.

## Normal behavioral suites

Run from the repository root with Node.js:

```powershell
node runTests.js fast
node runTests.js full
```

`fast` contains **187 test files**. `full` contains **206 behavioral test files**, including every checked-in root behavioral `*.test.js`. `testSuites.test.js` enforces membership. Counts refer to test files, not assertions or hands.

The protocol fixtures used by reducer and content-path tests are privacy-sanitized, de-identified, capture-derived behavioral fixtures. They preserve event shape while replacing player/card values and removing timestamps, source filenames, hashes, URLs, account data, and game/hand/session/player identifiers. They are deterministic regression evidence, not live certification.

## Release and freeze integrity

The immutable public-release gate is deliberately excluded from `fast` and `full` so ordinary development is not pinned to a frozen release:

```powershell
node scripts/release.js validate
node runTests.js release
```

`release` contains **1 test file**, `releaseMetadata.test.js`. It verifies synchronized release identity, 68 safe production paths, exact public-baseline hashes, deterministic ZIP structure, drift rejection, documentation links, and packaging contracts.

Maintainer release wrappers can record fingerprint-bound results and package only after all gates pass:

```powershell
node scripts/release.js test release
node scripts/release.js test focused
node scripts/release.js test fast
node scripts/release.js test full
node scripts/release.js gates
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-release.ps1
```

The focused release set has **63 test files**. Wrapper output is generated under `outputs/` and is ignored by Git.

## Browser-shaped and live evidence

`node testSupport/seatHudDomFixtureServer.js` serves local DOM fixtures, including `/live-panel.html`, for extracted production layout and drag functions. Fixture measurements and identities are synthetic test data.

Signed-in PokerNow validation is separate because genuine DOM, rendering, account state, and lifecycle behavior cannot be certified by repository fixtures. Before relying on a release, load it in desktop Chrome and verify Build ID, Seat HUD placement/drag/reset/source, native panels, Settings, dashboard, Career persistence, and Pot Odds on a test table. Record any live evidence outside the public repository unless it has been deliberately de-identified and reviewed.

See the [Release Runbook](RELEASE_RUNBOOK.md), [Live Validation Matrix](LIVE_VALIDATION_MATRIX.md), and [Release Audit](RELEASE_AUDIT.md).
