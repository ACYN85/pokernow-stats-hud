# Public V1.4.0 live-validation matrix

**SIGNED-IN V1.4 RC2 ZIP ACCEPTED.** The exact accepted ZIP was loaded manually and Session, Career, Recent, History, Trends, finalized-hand refresh, historical deletion, current-Session protection, Dashboard open/closed reload state, Recent/Trend selector styling, and the small unset Leaderboard size passed. The final V1.4.0 ZIP is a byte-for-byte copy of that RC2 ZIP: SHA-256 `E1F804E1FF9E47A937E857A2F65201B36CEB07C99620E633E3739DC0236AB8BB`. Dashboard mode selection returns to Session after reload; this is deferred to V1.4.1. This public record does not contain a signed-in session transcript or private capture.

## Earlier V1.3.0 acceptance

**SIGNED-IN RC4 SMOKE ACCEPTED.** Final V1.3.0 is the exact accepted RC4 ZIP, with Build ID `v1.3.0-rc4-20260929-0321` and SHA-256 `18966EA9C96C102139E3DAABD0778248847ECFA8F3123D67ABAE47304BC6FD92`. This public record does not include a signed-in session transcript or private capture.

| Case | Evidence boundary |
| --- | --- |
| Production Dashboard mount and layout | Signed-in RC4 observation: Session/Career source row and Table/Situation/Position context row rendered correctly. |
| Table-size and Profile | Signed-in RC4 observation: All/HU/3–5/6+ selector present, coverage populated, HU filtering and Profile population display worked. Other support boundaries have automated coverage. |
| Stat cards and details | Signed-in RC4 observation: cards, Evidence, and stat calculations rendered. |
| Career Import | Signed-in RC4 Import succeeded on the tested sample. Migration and rare data-management paths have separate automated coverage. |
| Insights, Strategic Implications, Review Signals | Automated calibration, Evidence, and production mounting tests passed. The small imported live sample lacked enough support to fully exercise outputs. |
| Live refresh, schema-4 upgrade, rare Pot Odds and persistence cases | Automated and browser-fixture regressions passed; this public record makes no separate signed-in claim for every edge case. |

Automated fixtures are not a substitute for signed-in PokerNow evidence. The accepted smoke was sufficient for final promotion, with the listed limits retained.
