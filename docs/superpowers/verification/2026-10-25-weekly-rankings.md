# Weekly Rankings verification

Implemented on `review/weekly-rankings`, based on `b08df6a`, in the active root application. No push, main merge or database deployment is included.

## Delivered behavior

The top navigation opens five weekly Top 10 boards: Attack, Defense, Robbers, Camps and Growth. Each board shows the player's own standing even outside the Top 10 or with zero/negative growth. Current and previous weeks, tracking dates, partial first weeks, solo scope, loading, retry and older-server states are supported. Reports remains a dialog action.

Private SQL aggregates and receipts score finalized outcomes exactly once. Defender ownership is captured before guild support disappears or city ownership changes, and deterministic integer shares conserve every defense point. Camp/player kills use existing crop upkeep weights and exclude practice, scouting and starvation. Loot is counted after carrying limits; capture retains resources without awarding theft. Growth records fractional net population changes while baselining initial stock. Local campaigns persist equivalent metadata through validated saves.

Only authenticated, player-bound ranking reads expose bounded public names, guild tags, IDs, scores and ranks. Raw tables and helpers stay private. Existing public map/core snapshots are unchanged.

## Checks

Commands run with `npm.cmd` on Windows because the host PowerShell execution policy blocks the `npm.ps1` shim. Logs and browser artifacts are retained locally under the ignored `artifacts/weekly-rankings/2026-10-25/` directory. Focused screenshots also remain in `test-results/`.

| Check | Result |
| --- | --- |
| `npm test` | 668 tests: 667 passed, zero failures, one existing skip. |
| `npm run test:tooling` | 5 passed. |
| `npm run assets:check` | Passed; 46 existing registered GLBs and 33 Rally Point paintings verified. |
| `npm run build` | Passed; existing chunk-size/dynamic-import advisories remain. |
| `npm run build:sql`, `npm run check:sql`, `npm run check:world` | SQL regenerated and source checks passed; geography matches. |
| `npm run test:rankings-db` | Passed at 1x, 10x and 100x, including UTC rollover, DST-independent seven-day weeks, finalized city/camp outcomes, guild shares, growth/capture/ruins, privacy, replay and installer reruns. |
| `npm run test:db`, `npm run test:fresh` | Passed. |
| Food constraint, player city raids and population isolated suites | Passed. |
| Crop upkeep, city capture, guild reinforcements and scouting isolated suites | Passed at 1x, 10x and 100x. |
| `npm run test:e2e -- tests/e2e/rankings.spec.ts tests/e2e/compact-header.spec.ts` | All 8 desktop/mobile cases passed. |
| Independent whole-feature review | No Critical, Important or Minor findings; reviewer independently verified 24 focused tests. |

The focused browser tests use pointer/keyboard interactions with real local campaigns and the isolated SQL/Auth harness. They cover five boards, own rank 13, current/previous switching, report popup compatibility, retry, missing old-server RPC, solo reload and horizontal overflow. Inspected desktop current/error and mobile current/Growth/header captures. Existing models and Blender sources are untouched.

The full 310-test browser run was stopped after 59 completed desktop cases: 47 passed and 12 failed. Each observed failure was rerun on the unchanged base commit `b08df6a` in an isolated worktree and reproduced with the same failing expectation. The remaining 251 cases were not completed; the full browser suite is not claimed green. No test assertion was relaxed.

| Existing failing test | Baseline cause |
| --- | --- |
| `army-frontier-parity.spec.ts`: building popup recruitment | Test expects an older recruiting-legion control. |
| `army-frontier-parity.spec.ts`: logistics transfer | Test expects nine role inputs; the existing diplomat makes ten. |
| `army-frontier-parity.spec.ts`: building return shortcut | Test waits for the older recruiting-legion control. |
| `army-workspace.spec.ts`: hero identity/recruitment | Test expects nine troop cards; the game has ten. |
| `army-workspace.spec.ts`: raising a commander | Same obsolete nine-card expectation. |
| `army-workspace.spec.ts`: every troop inspector | Test's concept-roster lookup has no diplomat entry and throws. |
| `city-art-direction.spec.ts`: Roman, Elf and Undead districts (three cases) | Broad preview selector now matches both city and garrison previews. |
| `city-scene-ui.spec.ts`: reports/building interactions | Broad city selector now matches both city and garrison controls. |
| `city-scene-ui.spec.ts`: city switching without WebGL | Same broad-selector ambiguity. |
| `city-scene-ui.spec.ts`: all-city Events/reinforcements | Test expects case-sensitive `Walls`; the existing label is `City walls`. |

The original skipped unit test is `actual roster publisher refuses a withheld faction before changing its retained packs or report`. These existing checks remain unchanged for separate maintenance.

## Scoring decisions retained

- Weeks use real Monday UTC boundaries, independent of accelerated game time; late events enter the week when processed. This intentionally differs from retroactively assigning simulated event dates.
- Robbers counts resources taken at finalization, rather than delivery/profit or the victim's net balance. Storage overflow on return does not reverse theft.
- SQL event timestamps remain statement-stable, so one event cannot split categories or defenders across a Monday boundary.
- The read RPC forces UTC so a session's daylight-saving transition cannot stretch a week to 169 hours.
- A city without committed troops credits its defending ruler for actual attacker deaths, including tower magic.

## Installation and limits

`supabase/UPGRADE_WEEKLY_RANKINGS.sql` is generated from `supabase/modules/rankings/rankings.sql`. Apply it separately after the current V19, Crop Upkeep, City Capture and Scouting updates. Full/fresh installers include the same source. Existing shared worlds without the new RPC show the unavailable state until installation.

Database and shared-world browser verification use isolated PGlite with test authentication, without contacting production. This does not establish independent PostgreSQL-session contention or desktop/mobile FPS. No new raster artwork, model export or Blender verification is required.
