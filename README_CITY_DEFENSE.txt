PERIS | Permanent City Garrisons + Passive Wall Defence
October 22, 2026

WHAT CHANGES
- Dedicated city garrison, separate from temporary station troop pools.
- 3D City view: new Defence button and modal for station/withdraw troops.
- A real idle legion must physically occupy the city to assign or withdraw soldiers.
- Stationing removes those soldiers from that legion; withdrawing returns them
  subject to its 1,000-soldier capacity. No free soldiers or extra heroes.
- Permanent garrison soldiers fight in normal, authoritative automatic PvP
  battles even when neither ruler is online. The existing server worker and
  AI battle system are unchanged. Garrison casualties are settled exactly once.
- Walls add 10% defence per level, capped at +50% (level 5). No physical gates,
  wall pathfinding or manual battle orders. Rams still damage walls after
  victorious sieges under the pre-existing building-destruction system.
- Ruined-city garrison survivors evacuate with the existing ruins transport.
- City selector and military overview include permanent defenders in totals.

INSTALL INTO YOUR TESTED LOCAL WORKTREE
1. Make a Git commit or backup of C:\Peris before overwriting files.
2. Extract this ZIP over C:\Peris, preserving its folder paths. It contains
   changed files only and does NOT contain the full game, node_modules or .env.
3. In PowerShell run:
   cd C:\Peris
   npm.cmd run build:sql
   npm.cmd run check:sql
   npm.cmd test
   npm.cmd run test:city-garrisons-db
   npm.cmd run test:player-raids-db
   npm.cmd run test:integration-db
   npm.cmd run build

SUPABASE DATABASE (SEPARATE FROM GITHUB PUSH)
- A Git push / Vercel deployment does not update the database.
- Back up the production database before applying the migration.
- If you ALREADY applied UPGRADE_CITY_RUINS.sql successfully to this database:
    Apply supabase/UPGRADE_CITY_GARRISONS.sql in Supabase SQL Editor.
- If the city ruins migration was never successfully applied:
    Apply the freshly generated supabase/UPGRADE_CITY_RUINS.sql instead. This
    regenerated ruins migration includes the new garrison schema and functions.
- To check which case applies (read-only):
    select to_regprocedure('public.peris_ruin_city(bigint)') is not null as ruins_installed;
- Keep frontend and database versions aligned. Apply the database upgrade
  BEFORE deploying the new frontend.

PUSH TO MAIN AFTER CHECKS PASS
  cd C:\Peris
  git status
  git add src supabase scripts/build-sql.mjs tests package.json
  git commit -m "Add persistent city garrisons and passive wall defence"
  git pull --rebase origin main
  git push origin main

LOCAL VERIFICATION PERFORMED WHEN PACKAGING
- 16 targeted domain/ruins/PvP/SQL-generation tests passed (0 failed).
- scripts/build-sql.mjs generated and checked consistent SQL bundles.
- 16 edited/new TS/TSX files passed syntax transpilation.
- SQL ordering check passed: garrison table precedes dependent functions.

NOT VERIFIED IN THIS ENVIRONMENT
- Full TypeScript/Vite production build: dependencies not available.
- PGlite integration suite: dependencies not available.
- Supabase SQL execution: no live database connection.
Run the commands above before treating this as production verified.
