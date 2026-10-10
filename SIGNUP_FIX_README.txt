PERIS — MULTIPLAYER SIGNUP FIX
Based on main 7cea14e5ac546100d7610d11878a489376231335

The error "canceling statement due to statement timeout" came from starting-site
allocation checking the full set of sites against all NPC camps before choosing one.
The fix chooses sites in order and uses nearby indexed wrapped-field checks.

APPLY NOW (existing V10–V13 server)
1. Open Supabase SQL Editor for the current game project.
2. Run the ENTIRE supabase/FIX_MULTIPLAYER_SIGNUP.sql included in this archive.
3. Retry the same ruler name in Shared world.

No database reset, world reseeding, browser storage wipe or frontend deployment
is required to apply this server fix. Existing accounts, cities, armies, hero XP,
equipment, queues and camp progress are preserved. The hotfix can be rerun.
No changes have been deployed to the live server by this update.

KEEP THE REPOSITORY CONSISTENT
Copy the archive's project paths over the root that contains package.json,
then commit those changes. It contains changed files only, not the full game.
All full SQL installers are regenerated from modular source and include the fix.
For older servers use supabase/UPGRADE_TO_V13.sql. FRESH_INSTALL is for an empty
server only. Keep your .env values and existing assets.

VERIFIED
32 isolated new accounts using normal planner statistics, >2,300 starting sites,
611 camps: slowest allocation 84 ms locally (not a hosted Supabase benchmark).
Hotfix run twice preserves existing records. Wrapped spacing, dry rings, camp
protection, resource claims, settler reservations, private access, retry/name
errors and full-world rollback checks passed. Gameplay: 296 passed, one existing
skip. Production build, tooling, assets, SQL/world/camp generation and affected
isolated database suites passed.

Full cause and verification: docs/multiplayer-signup-fix.md
New regression command: npm run test:signup-db
