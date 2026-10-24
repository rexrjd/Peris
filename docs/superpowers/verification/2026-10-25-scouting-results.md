# Scouting verification

Completed on `review/scouting`, based on `bf2f8e7`. No push, merge or database deployment was performed. The active root application is changed; legacy copies are untouched.

## Delivered behavior

Existing faction scouts detach from an idle legion in its city. Commanders and other troops remain. Players choose troops/resources or troops/defenses, review travel, and cancel during the first 30 real seconds from Events or Rally Point. Pure-scout raid orders and farm entries automatically scout resources; mixed parties retain normal combat.

Counter-scouting uses the documented 35/20 scouting strengths, Peris smithy/research/wall modifiers and the documented Peris 3/2 casualty calculation. Defenders take no scouting casualties. Arrival-time reports show only physically present troops and the chosen intel. Failed missions reveal no enemy intel; detection notices reveal intercepted scouts only. Clean scouting creates no defender-visible mission, battle or report. Missions create no ordinary combat, loot, city damage, loyalty changes, XP or campaign progress.

Detached scouts pay canonical crop and can starve. Cancel/return credits never restore dead soldiers or exceed a legion's capacity. Captured source cities trigger a safe owned fallback; defeat disbands parties. Save imports validate counts, routes, receipt lineage and mode-specific privacy. Archived missions are bounded independently of saved reports.

## Review fixes

- Integrated scout participants and event deadlines into the existing settlement/crop kernel; defender processing cannot skip incoming observations and then report future production.
- Flushed pending camp observations before later normal raid starts/finalizers change that camp. A database regression reproduces a second ruler's later battle and verifies the earlier troop snapshot remains intact.
- Native armies must be in the actual city field; neighboring-field armies do not enter city intel or counter-scout strength. Source/delivery checks also retain the existing distance guard.
- Returning scouts are delivered before outbound observations at tied timestamps.
- Corrected SQL integer division so scout movement matches TypeScript's base speed of 50.6 logical units per game second.
- Hardened receipt lineage against references to unrelated active battles and bounded historical mission rows.
- Added real starvation/cancellation conservation checks and matching counter-scout recruitment-crop refunds.
- Added implicit whole-legion and unattended farm scouting, preserving ordinary mixed-army behavior.
- Repaired scoped mobile Events placement and radio sizing found through browser interaction and screenshot inspection. Suppressed automatic combat-result popups for scout receipts.

## Checks

Final command logs are under the ignored local `artifacts/` directory:

| Check | Result |
| --- | --- |
| `npm test` | 649 tests: 648 passed, zero failures, one existing skip |
| `npm run test:tooling` | 5 passed |
| `npm run assets:check` | Passed; 46 existing registered GLBs, 33 Rally Point paintings and licenses verified |
| `npm run build` | Passed; existing large-chunk advisory remains |
| `npm run check:sql`, `npm run check:world` | Generated bundles/geography match source |
| `npm run test:db`, `npm run test:fresh` | Upgrade and fresh installation integration passed |
| `node --import tsx tests/scouting-database.test.mts` | Passed at 1×, 10× and 100× |
| Existing crop, capture, guild, Market and trade-route isolated suites | Passed at 1×, 10× and 100× |
| Existing army role operations and player city-raid isolated suites | Passed |
| `npm run test:e2e -- -c playwright.integration.config.ts tests/e2e/scouting.spec.ts --output=artifacts/scouting-e2e-final` | All six desktop/mobile cases passed |

The scouting DB suite checks direct commands and receipt replay, cancellation, present/staged/guild scouts, both report modes, zero/partial/all deaths, crop and refund conservation, safe return/overflow, ownership changes, offline workers, early/late queues, detector privacy/RLS, tied scout returns, camp mutation order, implicit scout-only orders, farm dispatch, active-party budget, and repeated scouting/crop/capture/logistics installers.

Inspected desktop/mobile review, Events/Rally, shared-city action, old-server gating, resource/defense snapshots, and failed/detected receipt images. Saved browser captures are in `artifacts/scouting-ui/` and `artifacts/scouting-e2e-final/`. All eleven existing scout faction portraits are retained; no new external artwork or model export is needed.

## Limits and installation

SQL tests and the browser account fixture run against isolated PGlite, with fake authentication in the browser fixture. They never connect to production. Independent PostgreSQL-session contention is unverified; the existing Market/trade suites explicitly skip those checks without `PERIS_TEST_DATABASE_URL`. No FPS benchmark was performed. One earlier trade-route 100× run under parallel test load crossed a very short return deadline; isolated current/base controls and the final sequential full suite passed without weakening the test.

`supabase/UPGRADE_SCOUTING.sql` is generated and repeatable. Apply it separately after the current V19, Crop Upkeep and City Capture migrations. Existing servers keep scouting hidden until the private capability is installed. The migration is prepared, reviewed and tested, but remains undeployed.
