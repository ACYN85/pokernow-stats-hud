# V1.6.0 publication boundary

Final publication is not yet authorized. Publish only the separately verified V1.6.0 runtime ZIP and reviewed public documents. Preserve existing releases/tags/history; never push private development history or backups. The frozen V1.5 packaging commands below are historical and must not generate the V1.6 package.

## Preserved V1.5 documentation

# Public V1.5.0 release runbook

V1.5.0 promotes the exact manually accepted RC2 archive. The final asset is a byte-identical copy named `pokernow-hud-v1.5.0.zip`: 83 files, 2,651,237 bytes, SHA-256 `560DAF7A3E7F6E586732BC8C7807482261FFF5BEBFF1CFF235BB0BA69B14573E`. Build ID `v1.5.0-rc2-20261006-2218` is retained. Never rebuild, recompress, or rewrite the accepted artifact.

## Mechanical verification

The 83 root production files must match the independently extracted accepted archive byte-for-byte. The only established private-source staging projection changes the manifest display name from development to release. `release/production-files.json` defines the inventory; `release/baseline.json` binds every runtime hash and the accepted archive identity. Run `node runTests.js release`, `node scripts/release.js validate`, complete-tree privacy/parity checks, and `git diff --check`. Retained private RC2 certification and manual acceptance do not require repeating feature reviews or rebuilding an archive.

## Publication

After checks pass and publication is explicitly authorized, commit the curated public source, create an annotated `v1.5.0` tag on that commit, and push main and the tag without force. Create the GitHub Release using [the release notes](release/v1.5.0-notes.md), attach only the byte-identical final asset, then download it and verify size and SHA-256. Preserve all V1.4 tags, releases, and assets. Keep private evidence and experimental work out of the public tree.
