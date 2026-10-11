PERIS — ARTIFACT PAINTINGS AND CAMP DIFFICULTY
2026-10-11

Compatibility
Built against https://github.com/rexrjd/Peris main commit
779715281b71418d4d3b02bf12066c8ecbe69645.
Main was fetched again after implementation and still matches this baseline.
The preceding compact map UI is already included in that baseline.
This archive contains changed and new files with their repository paths.
Copy them over that version, keeping the directory structure.

What changes
24 distinct original equipment paintings, one for every artifact ID.
Duplicate copies of the same artifact use the same painting.
12 new items: one Rare charm, six Epic items and five Legendary items.
All four rarities cover weapons, armour, headgear, boots and charms.
The 12 existing item IDs and their attribute bonuses are retained.
Paintings appear in the backpack, equipped slots, selected item and victory receipt.

Camps now have difficulty levels 1–10 and advertise the actual loot rarity:
  Level 1–2   Easy      Common equipment / artifact tier 1
  Level 3–5   Guarded   Rare equipment / artifact tier 2
  Level 6–8   Hard      Epic equipment / artifact tier 3
  Level 9–10  Deadly    Legendary equipment / artifact tier 4
Every NPC victory grants one item from the advertised rarity, subject to the
existing 200-item backpack limit. Reward rolls match solo and multiplayer.
Reopening a report never generates a second reward.
Higher camp levels have larger defender armies; high-level strongholds are scarce.
Camp cards and raid preparation show the level, difficulty and loot rarity.
The six story encounters now span levels 1, 4, 4, 6, 8 and 10.

Multiplayer installation
For an existing V13–V15 database with hero battle rewards, run ONLY the included
supabase/UPDATE_ARTIFACTS_AND_CAMPS.sql in the SQL editor as the database owner.
Apply this together with the updated frontend, so the UI and server agree.
This focused transaction adds the catalog entries and updates loot/raid functions
and camp defenders. It does not rebuild tables or recreate accounts.
It preserves camp IDs, coordinates, factions, inventories, XP, receipts and farming
targets. Camps targeted by moving armies or active battles are skipped;
rerun the same focused SQL after those raids finish to update the skipped camps.
The operation can be repeated safely.
Regenerated full-install and upgrade bundles are included for source consistency.
Do not use a fresh-install script on an existing campaign.
No production database changes or deployments were performed for this update.

Solo saves
Existing version-6 campaigns upgrade their known camp definitions once on load.
Accounts, cities, armies, equipped items, progress and farm targets are retained.
Active raids keep their existing defenders until a later safe load.
The 605 generated camp IDs, coordinates and factions match the prior layout exactly.
Frontier server gameplay and its separate low/medium/high encounter rules are intact.

Artwork sources
Generated using the built-in image-generation tool, one independent call per item,
with transparent backgrounds. No existing game artwork is included.
assets/artifacts-v1.json contains every complete prompt, item name and source path.
assets/source/artifacts-v1/*.png are the untouched generated images.
public/art/artifacts/v1/*.webp are the shipped 384px transparent UI paintings.
Rebuild runtime artwork with npm run build:artifact-art.
Rebuild SQL catalog with npm run build:artifact-catalog, then npm run build:sql.
Rebuild the focused migration with npm run build:camp-artifact-upgrade.

Validation
379 unit tests passed; one existing optional test skipped.
Production TypeScript/Vite build passed.
Tooling tests and checks for all 46 registered GLB models passed.
Artifact catalog, 605 camp definitions, focused migration and SQL bundle
generation checks passed.
Isolated hero-loot, world-battle, general database and fresh-install suites passed.
Focused migration tests cover existing gear/XP, busy camps, repeat application
and authenticated equip/unequip commands for all 24 items.
Artwork checks cover unique content, transparent alpha and all 24 runtime paths.
26 desktop/mobile browser scenarios passed across the initial run and targeted
rerun: all paintings load, equipment persists after reload, loot receipts,
camp difficulty/raid review, army markers, map activity and campaign marches.
Desktop and mobile screenshots were inspected for equipment, rewards and camps.
