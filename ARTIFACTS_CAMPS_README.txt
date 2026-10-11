PERIS — ARTIFACT PAINTINGS, CAMP LEVELS AND UNREAD REPORTS
2026-10-11 · corrected compatibility edition

Install the frontend
This archive contains updated files with their repository paths, plus all 24
original artwork sources and all 24 runtime paintings. Apply it to the current
https://github.com/rexrjd/Peris main, checked at commit
 d82272ea6a79d7dc8fab0fef8c9d59b6cfeed6ad.
Keep the directory structure. Run npm ci, then npm run build and deploy the
resulting frontend. Reload the deployed game after the deployment completes.
The supplied screenshot shows the older generic-icon equipment renderer; the
current renderer has been verified against every artifact image. Copying SQL
alone cannot change that screen. Paintings ship from public/art/artifacts/v1/.
A build now fails clearly if an artifact painting is missing or invalid.
No live deployment or production database changes were performed.

Reports
The top Reports button displays the unread count: Reports 1, Reports 2, etc.
Only that button turns yellow while reports remain unread. Opening a battle
report marks it read; visiting the Reports tab alone does not clear the count.
Read status survives reloads and is separate for each ruler and game mode in
this browser. Other browsers/devices keep their own read status.
The pictures and unread indicator need no database migration.

Compatibility fixes
The earlier ZIP was based on commit 7797152, before the friend's V16 integration.
This edition preserves its workshop/siege troops, nine recruitment roles, unit
research bonuses, parallel recruitment, growing camp stock, recurring farm lists
and background battle worker. Save import retains those new fields and roles.
Camp upgrades preserve live defenders, advanced troop rosters and stored stock.
Levels 1–10 now grow toward caps matching their actual starting strength, with
matching solo/server rules. Busy camps keep their current encounter state.
Empty defender forces no longer cause a "Choose whole troop counts" SQL error
when finishing a repeat raid. Existing input validation remains strict.

Artifacts and camp difficulty
24 distinct original paintings, one for every artifact ID. Duplicate copies of
an item share its painting. Artwork appears in the backpack, equipped slots,
selected item and victory receipt. The 12 original item IDs/bonuses are retained;
12 additional artifacts cover Rare, Epic and Legendary equipment.
  Camp level 1–2   Easy      Common equipment / tier 1
  Camp level 3–5   Guarded   Rare equipment / tier 2
  Camp level 6–8   Hard      Epic equipment / tier 3
  Camp level 9–10  Deadly    Legendary equipment / tier 4
NPC victory grants one item of the advertised rarity, subject to the existing
200-item backpack limit. Reopening a report never rolls another reward.
Camp IDs, coordinates and factions retain the existing 605-camp layout.

Optional multiplayer gameplay SQL
If your database has not received the friend's V16 integration, apply the included
supabase/UPGRADE_TO_V16.sql first, as the database owner in the SQL editor.
It contains this edition's catalog, camp rules and compatible functions.
For an already upgraded V16 world, apply
supabase/UPDATE_ARTIFACTS_AND_CAMPS.sql for the focused gameplay corrections.
That transaction updates catalog entries and functions without rebuilding tables;
it retains accounts, inventories, XP, receipts, cities, armies and farm targets.
Camps involved in moving raids or active battles are skipped for metadata updates;
rerun the focused file after those encounters end. It is repeatable.
Never use a fresh-install script on an existing campaign.

Artwork and maintenance
assets/artifacts-v1.json records complete image-generation prompts and source paths.
assets/source/artifacts-v1/*.png are the untouched original generated paintings.
public/art/artifacts/v1/*.webp are the 384px transparent runtime images.
No existing game artwork was copied. The paintings use the project's original
fantasy art direction.
Rebuild paintings: npm run build:artifact-art
Rebuild catalog: npm run build:artifact-catalog
Rebuild camp SQL: npm run build:bandits
Regenerate bundles: npm run build:sql
Regenerate focused update: npm run build:camp-artifact-upgrade
Verify runtime paintings: npm run check:artifact-art

Validation
387 unit tests passed; one existing optional test skipped.
Production TypeScript/Vite build, tooling tests and all 46 registered model
checks passed. Catalog, camp definitions, focused upgrade and SQL generation
checks passed. Isolated V16 integration, hero-loot, world-battle and focused
upgrade database suites passed. Coverage includes all ten camp growth caps,
repeat migrations, live defender preservation, nine-role parties, account/city
compatibility, research, recurring farms, empty camps, and all 24 equipped items.
Desktop/mobile browser validation covers painting loads, equipment persistence,
loot receipts, camp difficulty, unread counts and the new recruitment/farm flows.
See UPDATE_FILES.txt for the complete archive file list.
