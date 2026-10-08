PERIS — DYNAMIC CITY / 5-LEVEL BUILDINGS
=======================================

This update replaces the single busy city painting with a landmark-based city scene inspired by classic turn-based fantasy town screens.

WHAT CHANGED
------------
1. The city is now made from separate interactive building graphics, not one AI-style background image.
2. Every building has an UNBUILT state (level 0) plus FIVE upgrade levels (1-5).
3. The actual graphic changes at every level:
   - Level 0: foundation / rubble / scaffolding
   - Level 1: basic structure
   - Level 2: annexes / secondary structures
   - Level 3: towers / larger silhouette
   - Level 4: banners / fortification / decoration
   - Level 5: final landmark / gold details / elite silhouette
4. The town background is intentionally simple so each building is immediately readable.
5. The old 20-level cap is changed to 5 in local gameplay and Supabase upgrade logic.
6. New realms start at level 0 with baseline production.
7. Old solo saves are accepted and levels above 5 are clamped to 5 when loaded.

HOW TO APPLY CODE
-----------------
Copy the files in this ZIP over the same paths in your Peris repo.

ONLINE DATABASE
---------------
If your existing Supabase database is already running, execute:

    supabase/CITY_LEVELS_0_TO_5.sql

in the Supabase SQL Editor once.

That migration:
- clamps existing building levels to 5,
- changes the building constraint to 0..5,
- updates production/capacity from the new levels,
- updates upgrade completion and upgrade queue functions,
- makes newly created players start with level-0 buildings.

VALIDATION
----------
The changed TypeScript city/game files pass a targeted TypeScript compile.
The SQL bundles were rebuilt and `node scripts/build-sql.mjs --check` passes.
The full repository test/build could not be executed in this Linux container because the uploaded project contains Windows-only esbuild/node_modules binaries. This is an environment issue in the uploaded node_modules, not a TypeScript error in the changed city files.
