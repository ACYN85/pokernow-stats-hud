# PokerNow Stats HUD - V1.6.0 compatibility

Live PokerNow seat overlays, leaderboard and player dashboards with Session and
Career statistics, notes, tracked players, local assigned names, and explicit
user-managed account grouping with eligible weighted combined Career statistics.
The established V1.5 ingestion engine remains the sole live gameplay writer.
Native gameplay/account admission and native numerical Pot Odds remain disabled.

## Install and update

Extract the release ZIP into a dedicated folder. For a new installation, enable
Developer mode in desktop Chrome's Extensions page, choose Load unpacked, and
select the folder containing manifest.json. Verify version 1.6.0 and popup build
v1.6.0-compatibility-20261030-final.

For an existing unpacked installation, back up files and complete extension data
first. Keep the same loaded folder and extension ID, replace runtime files with
Chrome fully closed, and then reopen Chrome. Do not uninstall, clear storage or
load another copy to update. A different folder can create a separate ID with
separate history. Refresh PokerNow between hands after an extension update,
before the next deal; incomplete observations may be excluded. Runtime rollback
does not undo later storage writes. No automatic updater is included.

The runtime ZIP contains 107 files with manifest.json at its root. This public
source tree contains the same loadable JavaScript/HTML/CSS runtime plus these
reviewed documents. It contains no profiles, captures, backups or private test
records. The development repository's inherited source manifest is not the
release identity; the prepared release projection supplies the public metadata.

## Scope and limitations

See [release notes](CHANGELOG.md) for supported features, backup scope, the
conditional-GO acceptance limits and deferred Pot Odds dialog layering.
[Privacy](PRIVACY.md) describes local storage, permissions and opt-in diagnostics.
Only desktop Chrome and supported PokerNow observations are in scope; native
gameplay is excluded. User grouping does not prove account ownership. Missing
history is not fabricated, and no universal statistical accuracy is claimed.
The TEST-only 1.6.0.8 installation is separate; public 1.6.0 is numerically lower.
Prepared for final approval; publication requires explicit authorization.

## Development Disclosure

This project was built with OpenAI Codex, which wrote most of the code. I directed the product and feature decisions, wrote the requirements, tested the extension in live PokerNow sessions, reproduced and prioritized defects, validated fixes, and set the statistical modeling parameters.
