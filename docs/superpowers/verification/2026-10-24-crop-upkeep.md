# Crop upkeep verification — 24 October 2026

Branch: `review/crop-upkeep-starvation`, base `ba19265`.

## Scope

Implemented hourly role upkeep, negative net production with nonnegative food storage, prioritized individual starvation with recruitment-food refunds, source/host feeding, chronological recruitment/research/movement/caravan transitions, non-retroactive activation, permanent battle starvation and one-time combat refunds, UI balances/warnings, private SQL helpers and unattended worker scheduling. All eleven factions use the requested fixed prices.

## Evidence

| Check | Result |
| --- | --- |
| `npm test` | 609 passed, 1 existing skip, 0 failed; 610 total |
| `npm run test:tooling` | 5 passed |
| `npm run assets:check` | Passed; 46 registered GLB models |
| `npm run build` | Passed; existing chunk-size advisory remains |
| SQL generation / `npm run check:sql` | Generated bundles and focused crop upgrade match module sources |
| Crop isolated database suite | Passed at 1×, 10×, 100×: rates, depletion/refund conservation, resident preservation, idempotency, waiting crop, ruined source fallback, foreign host priority, permanent battle losses/refunds, legacy activation and upgrade reruns, helper privacy |
| Existing Market database suite | Passed at 1×, 10×, 100× including no-Market upgrade compatibility, cargo conservation, ruins/stranding and reruns |
| Existing automatic route database suite | Passed at 1×, 10×, 100× |
| Existing guild support database suite | Passed at 1×, 10×, 100× |
| Population database suite | Passed 40 client/server population scenarios; troop effects isolated into crop suite |
| City logistics, player city raids, unattended battles | Passed affected isolated suites |
| Clock gameplay | Passed paid orders and economy/science/culture/camp accounting at 1×, 10×, 100× |
| Fresh install | Passed geography, movement, visibility and existing-world guard |
| Targeted Playwright | Crop UI, Market and automatic routes passed on desktop and Pixel 7 profiles (six cases). City balance and catapult upkeep captures inspected. |

Logs are under ignored `artifacts/crop-*.log`; browser captures are under ignored `test-results/`.

The first browser crop test used the obsolete navigation label “Army”; corrected to the actual “Armies” button and reran both profiles successfully. Existing Market tests with fixed income explicitly retain a legacy fixture; real crop/cargo integration has separate tests. The guild integration suite now controls game time to avoid a short 100× return finishing between assertions. No check was weakened to suppress gameplay failures.

## Review corrections

A fresh read-only review found two material issues. Added regression tests and fixed both: waiting return crop now feeds at depletion boundaries, and transports with destroyed sources select a surviving owned supplier. An additional staged-raid regression confirms attacks retain home priority during their cancellation window. Updated final combat allocation to exclude starvation already removed from captured sources, including post-capture recruits. Older focused installers preserve an already enabled crop coordinator.

## Limits

Travian publishes behavior, not its server code. The specification records Peris mappings for merged garrisons, commanders and extended healing battles; identical unpublished server internals are not claimed. Domain projections are read-only and never apply online casualties.

PGlite supplies isolated database verification, not independent concurrent PostgreSQL sessions. `PERIS_TEST_DATABASE_URL` is unset, so contention/load behavior is not claimed. No full browser-suite rerun was needed for these economy panels; affected desktop/mobile flows ran. The twenty unrelated browser failures documented in the previous Market/routes task remain outside this change. No graphics assets changed, Blender verification was unnecessary, and no FPS claim is made. No push, merge or SQL deployment was performed.
