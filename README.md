# PokerNow Stats HUD

PokerNow Stats HUD is a Chrome extension that turns observed PokerNow hands into a real-time, configurable player-statistics overlay with persistent Session and Career history.

**Version 1.3.0** · Release Build `v1.3.0-rc4-20260929-0321`

## Demo

![Live PokerNow table with Stats HUD seat overlays, leaderboard, and Pot Odds](docs/media/live-table-overview.png)

*The live table view combines per-seat finalized-hand statistics, a compact leaderboard, and in-hand Pot Odds without covering the core table controls.*

### Career dashboard and opponent context

![Player dashboard showing persistent Career statistics, showdown metrics, and relational opponent statistics](docs/media/player-dashboard.png)

*The dashboard exposes persistent Career samples, WTSD/W$SD showdown results, and relational 3Bet, F3B, and FCB statistics with opponent-context filtering.*

### Configurable Seat HUD

![HUD configuration with customizable statistics, Session and Career sources, overlay controls, and live preview](docs/media/hud-configuration.png)

*HUD Settings provides Session/Career source selection, draggable overlay controls, statistic ordering, visibility choices, and an immediate live preview.*

## Key features

- Real-time player statistics calculated from finalized hands, including VPIP, PFR, aggression factor, 3Bet/F3B, flop CBet/FCB, WTSD, and W$SD.
- Separate Session history and persistent local Career history for cross-session tracking.
- Career Data controls for exact current-Session removal, gzip-compressed portable export, Import (Merge), and Restore (Replace). Import and restore also accept legacy JSON backups.
- A successful Career Restore resets Session; a failed restore leaves Session intact. Export and Import do not reset Session.
- Session/Career Leaderboard sources plus a Settings → Players browser for every tracked Career player.
- Hand-state, lifecycle, position, action-opportunity, and showdown inference with conservative handling of incomplete evidence.
- Movable and resizable player dashboards with Reset Position, notes, position/opponent filters, and exact heads-up-postflop IP/OOP analysis.
- Statistical Evidence labels and exact support counts for dashboard statistics; low-support values retain their count without an “Insufficient” suffix. These labels describe sample support, not predictive certainty.
- Table-size-aware HU, 3–5, and 6+ Dashboard statistics and supported Profile explanations, with lightweight Career summaries and Recent Trends windows for the latest 25/50/100/250 eligible hands.
- Evidence-gated opponent Insights and Strategic Implications, plus self-only Review Signals, use the selected supported Dashboard population.
- In-hand Pot Odds showing call cost, eligible pot, and required equity.
- Configurable Seat HUD visibility, statistic ordering, display modes, and draggable persistent overlays.
- Hardened Reset Session identity, Pause/Resume, first-fresh-hand-after-Restore ownership, Career/Leaderboard pending-state presentation, cache/race/quarantine, and per-hand Pot Odds placement lifecycles.

## How it works

```text
PokerNow game events
  → Manifest V3 MAIN-world bridge
  → event normalization, hand-state inference, and exactly-once finalization
  → Session storage + separate IndexedDB Career contributions
  → Seat HUD, leaderboard, player dashboard, profiles, and Pot Odds
```

The extension observes PokerNow's existing WebSocket event stream and builds statistics from hands it observes while active. Statistics are attached only after a supported hand is finalized, so the active hand does not prematurely affect displayed totals.

Session and Career persistence remain separate, and no extension-controlled external server is used.

## Installation

### Load from source

1. Download or clone this repository into a stable directory with `manifest.json` at its root.
2. Open `chrome://extensions` in desktop Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the repository directory.
5. Open or reload a PokerNow game page.

### Install from a release ZIP

Extract the exact `pokernow-hud-v1.3.0.zip` release archive and load the extracted directory through **Load unpacked**.

Chrome does not load the ZIP directly.

Keep only one copy of the extension enabled at a time. Export a Career backup before replacing an existing installation, since uninstalling the extension or clearing its data can remove locally stored history.

## Testing

The public source includes behavioral tests and a separate release-integrity gate covering hand inference, statistics, Career portability, dashboards, overlays, Pot Odds, and package boundaries. The final ZIP is byte-identical to the accepted RC4 package (SHA-256 `18966EA9C96C102139E3DAABD0778248847ECFA8F3123D67ABAE47304BC6FD92`).

```powershell
node runTests.js full
node runTests.js release
node scripts/release.js validate
```

No npm installation or third-party test dependency is required.

See [Testing](TESTING.md) for additional details.

## Privacy, limitations, and non-affiliation

- Runtime Session and Career data stay in the browser's extension storage.
- Public test fixtures are privacy-sanitized, de-identified behavioral fixtures derived from captured event shapes. Identifying player, game, session, hand, URL, timestamp, and account data has been removed or replaced.
- Career tracking begins when the extension observes accepted hands; it does not backfill earlier PokerNow history.
- Incomplete or ambiguous evidence can cause a statistic opportunity to be withheld rather than guessed.
- This independent project is not affiliated with, endorsed by, or maintained by PokerNow.

See [Privacy](PRIVACY.md) and [Known Limitations](KNOWN_LIMITATIONS.md) for additional details.

## Development Disclosure

This project was developed in part with OpenAI Codex assistance. I directed the product and feature decisions, tested the extension in live PokerNow sessions, reproduced and prioritized defects, validated fixes, and iterated on the implementation.

## Technical documentation

- [Architecture](ARCHITECTURE.md) — runtime boundaries, ownership, data flow, and packaging.
- [Statistics support](STAT_SUPPORT.md) and [Statistics design](STATISTICS_DESIGN.md) — definitions, evidence requirements, reducers, and exclusions.
- [Semantic hand ledger](SEMANTIC_HAND_LEDGER.md) — normalized finalized-hand model and reducer boundary.
- [Career Data](CAREER_DATA.md) — local persistence, aggregation, backup, and restore behavior.
- [BoardCompanion layout](BOARD_COMPANION_LAYOUT.md) — stable table-local geometry used by Pot Odds.
- [Testing](TESTING.md), [Release audit](RELEASE_AUDIT.md), and [Changelog](CHANGELOG.md) — validation scope and release history.
