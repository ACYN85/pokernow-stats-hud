# V1.6.0 verification scope

The runtime is promoted from accepted Candidate 2 with build/display metadata only. See [release notes](release/v1.6.0-notes.md) for focused automated evidence and the limits of manual acceptance. Existing V1.5 tests and release scripts are preserved historical tools; their frozen version/inventory assertions are not V1.6 package certification. No broad test rerun is claimed.

## Preserved V1.5 documentation

# Testing and certification

V1.5.0 distributes the exact accepted RC2 runtime. Its automated RC2 gates, native checks, 150,000-record certification, and signed-in focused manual acceptance were completed before final release. Final promotion performs mechanical privacy, source/archive parity, documentation, tag, and downloaded-asset verification. It does not rerun feature certification or rebuild the accepted archive.

## Public release integrity

```powershell
node runTests.js release
node scripts/release.js validate
node packageValidation.test.js
```

These checks enforce the 83-file inventory, exact per-file release hashes, manifest world/script dependencies, documentation links, and accepted deterministic archive hash. The validation serialization is in memory only; the release asset is copied byte-for-byte. No npm installation is required.

Existing public behavioral tests and de-identified synthetic fixtures are retained as development resources. They are separate from the private V1.5 RC2 certification and the [signed-in acceptance record](LIVE_VALIDATION_MATRIX.md). Use [the runbook](RELEASE_RUNBOOK.md) for final-release steps.
