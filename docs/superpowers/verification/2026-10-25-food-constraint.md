The reported error was `new row for relation "settlements" violates check constraint "settlements_food_check"` while opening the game. A matching server failure was reproduced in an isolated database at configured world speeds 1x, 10x and 100x. This identifies a real cause in the repository; the hosted database's failing request/logs were not inspected.

When a winning siege destroys the last building, `peris_damage_city` calls `peris_ruin_city`, which sets all city stocks to zero. `peris_finish_city_raid` then deducted loot calculated from its pre-siege settlement snapshot. With 100 stored food, the resulting update attempted to write -100. The failure propagates through `peris_finish`, `peris_tick_for` and the public `peris_tick` used by the online engine's automatic catch-up.

The fix takes and deducts loot before siege, matching the existing local domain implementation. Successful capture refunds the provisional loot and reports zero loot, preserving the captured city's resources. The food constraint remains enforced. Depleted-city login with negative crop production independently passed without requiring changes to the crop integrator.

`supabase/UPGRADE_CITY_RAID_RESOURCE_FIX.sql` is generated from the canonical modules. It replaces raid finalization and includes the existing private participant guard. It does not migrate capabilities or rewrite stored data. Applying it twice with an active battle preserves the battle, clock, crop integrator and all other public-schema function definitions. Complete/focused installers and compatibility aliases were regenerated so later reruns retain the repair. No SQL was deployed and no branch was pushed or merged.

Verification:

- Red/green reproduction: `npm run test:food-constraint-db` passes at 1x/10x/100x after first reproducing the exact constraint error at all three speeds. Tests cover depleted login, automatic siege completion, conserved food loot, permanent zero-stock ruins, repeat finalization, two private reports, repeatable focused installation and rejection of explicitly negative food.
- `npm test`: 649 tests, 648 passed, zero failed, one existing skip.
- `npm run test:tooling`: five passed.
- `npm run assets:check`: passed, including 46 registered GLBs and 33 Rally Point paintings.
- `npm run build`: passed; existing bundle-size advisory remains.
- `npm run check:sql` and `npm run check:world`: passed.
- General upgrade and fresh database suites passed.
- Crop-upkeep and city-capture isolated suites passed at 1x/10x/100x.
- Player-city-raid isolated suite passed.
- Independent code review found no correctness issues and reran the regression at all three speeds.

The first broad unit run caught a missing embedded participant guard in the new focused installer. Its prerequisite source was included, and the full unit suite and regression then passed. No check was weakened. Local logs are under ignored `artifacts/food-*.log`.

No UI, graphics or assets changed, so browser/Blender verification was not needed for this server-only repair. Database verification uses PGlite; independent PostgreSQL connection contention and the hosted production request remain unverified.
