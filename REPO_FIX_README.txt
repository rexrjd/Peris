PERIS — MAP / CITY MERGE CONFLICT FIX

BASE
This patch is based on current GitHub main, dd5a6d8 (123), after the successful map merge dabddf4 (pull request #2).

CAUSE
The failed commit includes unresolved Git stash/merge markers in package.json, four TypeScript files and the SQL source/bundles. npm fails immediately with EJSONPARSE at package.json line 21. TypeScript and SQL also contain unresolved conflict sections. This explains the screenshot's early deployment failure; the previous map merge itself built successfully.

APPLY
1. Extract into your CURRENT Peris project, replacing matching files. Include the new src/features/map/domain/fieldProduction.ts file. This ZIP contains only changed files relative to dd5a6d8.
2. Keep both sets of test scripts from the resolved package.json. Dependencies did not change; package-lock.json needs no replacement.
3. Shared worlds: apply ONE appropriate SQL upgrade before deploying:
   - Friend's V9/map upgrade already installed: run supabase/UPGRADE_HOUSING_AND_POPULATION.sql from THIS package. Re-run this corrected script if you already ran the previous housing migration.
   - Map backend upgrade not yet installed: run supabase/UPGRADE_TO_V9.sql from THIS package; it includes the map and population modules.
   - Solo games need no SQL.
   Do not use a FRESH_INSTALL script on an existing world. Existing progress is retained.
4. Run npm run build. Commit these resolved files and push to your usual repository to trigger Vercel.

WHAT IS PRESERVED
The friend's map rendering, wrapped exploration, territory claims, field construction, map metadata and snapshots remain in the current repo. The patch retains both map field commands and the population debug command, both sets of settlement metadata, and chronological city/field construction completion. Terrain-adjusted external field income is included in population projections and server accrual. Field income retains its existing production rules; city building bonuses still scale with staffing.

Pure field production formulas now live in fieldProduction.ts and remain exported through territory.ts. This avoids an import cycle when the population economy reads map income. All generated SQL bundles, including V9, were rebuilt from the merged modules. The test suite includes a merge-marker check covering package.json, TypeScript and SQL deployment inputs.

VERIFIED
- Reproduced npm EJSONPARSE on unchanged dd5a6d8.
- Production build passed after the fix.
- All 158 unit tests passed, including map, city, population, save import, architecture and conflict-marker checks.
- Territory, map snapshot, population, city-slot, magic, faction, baseline and fresh-install database suites passed.
- 40 client/server population cases include external map field production.
- SQL bundles match their modular sources; git diff whitespace checks passed; deployment inputs contain no conflict markers.
- Tested the exact previous successful map release's FRESH_INSTALL_V9.sql with the corrected housing migration twice. Offline field construction earned legacy production before population began. Fields, future queued work, faction, troops, mage tower and spell research were preserved, and housing remained buildable.

No push or deployment was performed. Live browser/Vercel runtime verification was not performed; this patch addresses the reproduced repository/build failure and its map/city integration.
