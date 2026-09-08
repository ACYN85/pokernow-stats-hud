# Known limitations — public 1.1.0

The following are deliberate support boundaries, not claims that every rare case was manually observed:

- Career starts with newly tracked finalized contributions. There is no lifetime PokerNow history retrieval, Full Log backfill, missed-hand importer, cloud sync or merge restore.
- Tracking while disconnected or attaching mid-hand cannot reconstruct unobserved actions. Exact saved reload checkpoints preserve supported continuity; incomplete/recovered evidence remains conservative.
- Unknown action ordering, full-raise legality/reopening, short-all-in eligibility or missing direct responses can withhold 3Bet/F3B/CBet/FCB opportunities. Flop CBet/FCB do not cover turn/river continuation betting.
- Production has no universal pot/board identity or side-pot eligibility normalization. Incremental/multi-message settlement, multiple boards, rake/odd chips and unresolved return/award distinctions remain limited. Supported atomic contested awards can still yield binary W$SD; rich pot outcomes may remain unsupported.
- Mucked showdown membership is supported only with explicit independent evidence, including the bounded complete-river-check-through rule. Missing shown cards or a completed board alone are insufficient.
- Position assignment requires 2–9 dealt players and consistent button/blind/clockwise-seat evidence. Dead-button hands and ten-handed position semantics are unsupported. Small/unknown samples and uncalibrated heads-up archetype context can keep profiles Unknown; numeric heads-up stats are not thereby disabled.
- Seat statistics may use Career while profile labels remain Session-derived. The leaderboard has its own persisted Session/Career numeric source and keeps the current Session participant list rather than enumerating historical Career players.
- Pot Odds is arithmetic on supported current state, not an outs/draw-probability, equity or advice engine. Unsupported/missing eligible-pot or call-cost evidence is shown as unavailable; it is not guessed.
- Career whole-backup/restore has a 32 MiB policy and conservative export preflight. There is no guarantee of unlimited browser storage. Notes (500 new-player entries, 5,000 characters each) are not included in Career Backup.
- Desktop Chrome/PokerNow DOM and protocol assumptions apply. Other browsers, variants, versions and arbitrary viewport/zoom combinations are not universally certified. Painted-panel fallback and accessibility clamps remain intentional; default eight-pixel geometry is subject to rendering clamps.
- Diagnostics/exports can contain sensitive local data. There is no automatic remote backup; uninstalling or clearing extension storage can lose data.

These boundaries were checked against the current reducers, position resolver, profile classifier, Pot Odds and Career modules. Earlier phase documents may contain superseded “deferred” features or pending-signoff statements; [README](README.md), [stat support](STAT_SUPPORT.md), [Career Data](CAREER_DATA.md) and [the live matrix](LIVE_VALIDATION_MATRIX.md) are the current release summaries.
