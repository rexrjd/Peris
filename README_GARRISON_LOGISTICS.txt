PERIS - City Garrison Logistics Update
=====================================
Three features:
1. Existing garrison card: troop-type artwork + sliders, exact inputs, Max/All/Clear.
2. Recruitment: Train for Legion / Train for Garrison. Garrison training credits permanent defenders at finish, not a legion, using ordinary city queues and costs.
3. Send: dispatch 1-1000 real garrison soldiers to another owned living city. Validated land routes, actual ETA, authoritative offline worker delivery, retry-safe receipt, no free heroes.

INSTALL
1. Back up C:\Peris. Extract this ZIP over C:\Peris, preserving subfolders.
2. In PowerShell:
   cd C:\Peris
   npm.cmd run build:sql
   npm.cmd run check:sql
   npm.cmd test
   npm.cmd run test:city-logistics-db
   npm.cmd run test:city-garrisons-db
   npm.cmd run test:player-raids-db
   npm.cmd run test:integration-db
   npm.cmd run build
3. AFTER the City Ruins and City Garrisons migrations are installed, apply:
   supabase/UPGRADE_CITY_LOGISTICS.sql
   in the Supabase SQL Editor. It is a focused transaction-based upgrade; do not run a full FRESH_INSTALL on an existing database.
4. Push tested source to GitHub main and redeploy the frontend AFTER the SQL upgrade succeeds.
5. The existing unattended peris_game_tick worker (pg_cron or service-job) must be running to deliver arrivals when nobody is logged in; the new due-queue is included in that worker.

VERIFICATION HERE
- 18 relevant TypeScript domain/regression tests passed via lightweight TS test loader.
- SQL generation and consistency check succeeded.
- Source-focused compiler diagnostics (excluding missing npm types) reported zero errors.
- Real PGlite DB tests and Vite production build NOT run here; run on C:\Peris.

IMPORTANT
- Only changed source files and the focused SQL upgrade are packaged.
- Existing wall bonus stays +10% per level, maximum +50%.
- The pre-existing offline battle engine and siege damage logic are not replaced.
- This update adds no new heroes, armies or manual battle decisions.
