# Weekly Rankings

Rankings is a top-level destination in the game navigation. The five weekly Top 10 boards show public ruler names, current guild tags, scores and the signed-in ruler's own rank, including players outside the Top 10. This week and Last week are available. Solo campaigns show their own campaign standings.

The interface uses the selected city's shared map/3D City colors, material texture and controls, with compact category tabs, separate player/guild columns and highlighted personal rows. Top 10 shows all five boards across three desktop columns; each category tab focuses one board. Arrow keys, Home and End move between categories. Scoring and tracking details expand below the tables. Unranked personal rows use a dash with an accessible label and tooltip; repeated rank summaries are omitted.

| Board | Score |
| --- | --- |
| Attack | Player troops killed while attacking in real PvP battles, weighted by hourly crop upkeep. |
| Defense | Attacking player troops killed, weighted by upkeep. Defending players share the points in proportion to the troops they committed, including guild reinforcements. |
| Robbers | Wood, stone, food and gold stolen in completed camp/city raids, after carrying limits. |
| Camps | NPC troops killed while attacking campaign or roaming camps, weighted by upkeep. |
| Growth | Net population gained across living cities, including founded and captured cities and population lost through conquest or ruins. |

Combat weights use the existing Peris upkeep: infantry and diplomats 1, mounted troops/scouts 2, rams 3, catapults 4. Routed survivors are alive; starvation, scouting and practice do not earn combat points. Kill points can be earned in a loss or draw. Integer defense shares conserve the total, with stable player-ID ordering for ties/remainders. A city without defending troops still credits its defending ruler for actual attacker deaths, such as tower magic.

Robbers records resources taken at battle completion. Returning-storage overflow does not reverse theft; trade, gifts, quest rewards and recruitment refunds do not count. Successfully captured cities retain their resources and award no robber loot. Growth preserves fractional changes internally and displays whole people by truncating the net total toward zero. Initial capital population is a baseline. Only positive scores enter the Top 10; the player's own zero or negative score remains visible as Unranked. Equal scores share their rank.

Weeks begin Monday at 00:00 UTC and last seven real days, independent of accelerated game time. Authoritative events enter the week when processed. This feature starts tracking at installation/first local activation: it does not invent historical scores from partial private reports. The UI labels tracking dates and partial first weeks.

The reference is Travian's weekly player combat/raiding/PvE categories, with the user-requested Growth board retained for Peris. See [Travian's weekly medal categories](https://support.travian.com/en/articles/168-how-medals-work) and [the PvP/PvE ranking split](https://blog.travian.com/2022/04/new-hero-interface-and-much-more/). This change does not add medals or all-time/guild boards.

For an existing current shared world, review and apply the generated [weekly rankings migration](supabase/UPGRADE_WEEKLY_RANKINGS.sql) after the current V19, crop, capture and scouting updates. New/full installers also include the feature. No SQL is deployed by this repository change. Existing worlds without the read RPC show a usable unavailable state; network failures offer Retry.

Authoritative source is `supabase/modules/rankings/rankings.sql`. Private score, receipt and defender-attribution tables use RLS and deny client access. The authenticated `peris_rankings(p_period)` RPC returns bounded public standings only. Narrow triggers survive unrelated finalizer replacements and prevent repeated awards. Local campaigns use `src/features/rankings/domain` and validated private save metadata. Report deletion/delivery updates do not affect scores.

Regenerate SQL with `npm run build:sql`; check it with `npm run check:sql`. Run `npm run test:rankings-db`, `npm test`, and the Rankings/compact-header browser suites for scoring, privacy, calendar, replay, save and UI verification.

Completed implementation and verification evidence is recorded in [the weekly rankings verification report](docs/superpowers/verification/2026-10-25-weekly-rankings.md), including the independently reproduced pre-existing browser test failures. The focused desktop/mobile Rankings and compact-header suite passes all eight cases.
