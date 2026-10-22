PERIS - PGlite database initialization order fix (22 Oct 2026)

Problem:
  player-city-raids-database.test.mts and game-integration-database.test.mts
  failed while loading the generated FRESH_INSTALL SQL because the SQL-language
  peris_station_owned() function referenced settlements.ruined_at before that
  column existed. The players.defeated_at column had the same ordering risk.

Contents (3 changed/new source files):
  supabase/modules/manifest.json                UPDATED
  supabase/modules/city/ruins-columns.sql       NEW
  tests/ruins-schema-order.test.ts              NEW regression test

The new early module adds both columns idempotently after schema/base.sql.
The later city/ruins.sql deliberately retains its own idempotent ADD COLUMN
statements so the focused UPGRADE_CITY_RUINS.sql works independently.

How to install:
  1. Extract ZIP to C:\Peris and preserve directories.
  2. Run from PowerShell:

     cd C:\Peris
     npm.cmd run build:sql
     npm.cmd run check:sql
     npm.cmd run test:player-raids-db
     npm.cmd run test:integration-db
     npm.cmd test

Verification performed on uploaded Peris source:
  PASS: node scripts/build-sql.mjs
  PASS: node scripts/build-sql.mjs --check
  PASS: generated fresh/upgrade SQL puts columns before peris_station_owned()
  PASS: node --experimental-strip-types --test tests/ruins-schema-order.test.ts

Not verified here:
  PGlite database tests, which require dependencies unavailable in this
  environment. These are the decisive tests on your Windows machine.

IMPORTANT: Do not execute SQL on production as part of this fix.
This ZIP changes only local schema generation and regression test sources.
