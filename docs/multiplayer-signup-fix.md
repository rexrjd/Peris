# Multiplayer signup timeout fix

## Apply to the current server

1. Copy the changed files over the project rooted at `package.json`. The update is based on main commit `7cea14e5ac546100d7610d11878a489376231335` and includes the V13 hero portraits and equipment changes already present there.
2. Open the current project's Supabase SQL Editor and run **all of `supabase/FIX_MULTIPLAYER_SIGNUP.sql`**. It is a targeted update for an existing V10–V13 world and is safe to run again.
3. Retry the same ruler name in Shared world. A timed-out creation is rolled back; an account that already completed creation is returned without a second city or army.

The hotfix updates the `create_player` function and creates two indexes. It reloads the RPC schema cache. It does not reset or reseed the world, alter existing player data, or need a frontend redeployment. The repository changes keep future generated SQL bundles consistent with the fix.

For an older schema, use the updated `supabase/UPGRADE_TO_V13.sql`. Use `FRESH_INSTALL_V13.sql` only for an empty database. This update has not been applied to the live database.

## Cause and change

The old starting-site query combined proximity checks with `ORDER BY … LIMIT 1`. With normal PostgreSQL planner statistics, it could check every candidate against the 611 NPC camps before sorting and choosing one. The repeated wrapped-distance functions caused signup to exceed the request timeout. The old isolated database tests used a planner configuration that did not expose this plan.

Allocation now tries unused sites in their original ID order, reads the world land mask once, and checks nearby wrapped fields with indexed equality lookups. It stops as soon as a safe site is found. Dry neighbouring fields, city/camp spacing, external resource claims, and travelling settler reservations retain their previous rules. The shared land-allocation lock and row locks still protect competing requests. Existing-player retries return before waiting on the global land lock and are checked again after acquiring it.

## Verification

`npm run test:signup-db` restores the previous V13 allocation in an isolated database, seeds an existing player's equipment, XP, queues and camp progress, applies the hotfix twice, and verifies those records are unchanged. It then enables normal sequential-scan planning, runs `ANALYZE`, and creates 32 new rulers against more than 2,300 sites and 611 camps. Each also completes snapshot and state sync. The slowest measured allocation in this local PGlite run was 84 ms; hosted Supabase latency has not been measured.

The regression also checks wrapped map seams, sea/coast rejection, camp protection, resource claims, settler reservations, one starter army and commander, duplicate/invalid names, idempotent retries, anonymous access denial, private helper permissions, and exhausted worlds without partial records.

Passed: gameplay tests (296 passed, one existing skip), production build, tooling, asset validation, SQL/world/bandit generation checks, and isolated database suites for upgrades, fresh installs, Empire/heroes, hero loot, territory and signup. The existing build-size and asset informational warnings remain.
