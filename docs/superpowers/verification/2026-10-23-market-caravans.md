# Market verification — 2026-10-23

Implementation branch: `review/market-caravans`. Baseline: `c802709` (before feature code).

## Passing checks

- `npm test`: 585 passed, one skipped, no failures (586 total).
- `npm run test:tooling`: five passed.
- `npm run assets:check`: passed; existing GLB tangent/unused-object warnings remain.
- `npm run build`: passed; existing large-chunk warning remains.
- `npm run check:sql`: generated bundles match modular source.
- `npm run test:market-db`: passed at 1×/10×/100× for all five capacity levels, unfinished construction, strict cargo, receipts, wrapped routing, chronological recipient storage, reservation through return, overflow/unloading, participant privacy, guild departure, owner changes, destroyed source/target, actual-position rerouting, stranded cargo, workers and fresh/focused installer reruns.
- Affected database checks passed: general/fresh, city slots, city logistics/garrisons, guild reinforcements, social, clock, clock gameplay/upgrade/journeys and command receipts. Detailed execution report is retained locally in `artifacts/market-sql-report.md`.
- Final focused browser run: 13 passed, one intentional mobile contact-sheet skip; its two recovery-harness failures were subsequently corrected and both passed in the dedicated rerun. The harness originally returned one HTTP 503, which the SDK could automatically retry; it now models a persistent rejected target read until the explicit user retry. Product assertions were retained.
- Ten building options, pinned construction, existing recruitment/upgrade/spellbook behavior, Market review/confirm and return-held capacity passed on desktop and phone. The recovery test covers guild destination loading, retry, exact selected recipient and clearing the accepted review after an unconfirmed command resolves.

The Market contact sheet covers all eleven factions at levels 1–5. Native geometry checks cover levels 0–5, finite vertices, bounded material batches, lot bounds and distinct faction/stage geometry. Actual City screenshots and the 55-model contact sheet were inspected. Local copies: `artifacts/market/all-factions-levels.png`, `desktop-review.png`, `mobile-review.png`.

## Full browser suite and baseline separation

`npm run test:e2e` completed: **236 passed, 25 skipped, 21 failed**. One failure was the existing picker test expecting nine building types after Market added a tenth; the expectation was updated to ten with an explicit Market assertion and passed on both layouts.

The remaining failure classes are pre-existing:

- The army parity tests look for `Recruiting legion`; the baseline inspector already labels the selector `Recruitment destination`. Both named desktop tests reproduce on detached baseline `c802709`; the mobile failures use the same unchanged locator.
- Existing city thumbnail/card selectors match both the city chooser and garrison dock; existing Events/reinforcement assertions also disagree with preserved labels/attributes. A targeted baseline run of those tests reproduced all sixteen corresponding failures, with three skips and one pass.

Baseline evidence is retained in the user's temporary directory: `peris-market-baseline-e2e.log`, `peris-market-baseline-other.log` and their screenshot/trace directories. The isolated diagnostic worktree is `C:/Users/pc/AppData/Local/Temp/peris-market-baseline-c802709`. No root branch reset, unrelated test weakening or production access was used. The full suite therefore remains red; this feature does not claim to repair those existing UI tests.

## Review fixes and limits

The independent review identified research/storage deadline ordering, unchecked saved return routes/dates, stale review after receipt recovery, and a zero-distance destroyed-home reroute that generated an invalid save. Each was reproduced, fixed and covered by a passing regression. The reviewer checked the first three fixes and identified the fourth during follow-up; the final zero-distance correction was locally reviewed/tested after the reviewer hit its workspace credit limit.

Real independent-session PostgreSQL contention tests are explicitly skipped because an isolated `PERIS_TEST_DATABASE_URL` is not configured. PGlite tests do not certify concurrent PostgreSQL lock scheduling. Large connected trade-network throughput and GPU frame-rate goals remain unmeasured.

SQL is generated for separate review/application in `supabase/UPGRADE_MARKET.sql`; it was not deployed. No push, main-branch merge, new Blender source/export, GLB, external raster asset or license change is part of this feature.
