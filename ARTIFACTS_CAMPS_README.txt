PERIS — ARTIFACT PAINTINGS AND CAMP DIFFICULTY
2026-10-11

Compatibility
Integrated with https://github.com/rexrjd/Peris main commit d82272e and the
unified Rally Point. The normal Peris app includes artifact paintings, ten camp
levels, nine troop roles, research, shared camp stock and farm lists together.
Use the repository changes together; copying files from an older archive can
remove mechanics added by the other developer.

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
An existing game database requires the regenerated supabase/UPGRADE_TO_V16.sql
to install the complete Peris mechanics alongside the updated frontend.
For a new database use supabase/FRESH_INSTALL_V16.sql.
The focused supabase/UPDATE_ARTIFACTS_AND_CAMPS.sql updates artifact/camp metadata
on older V13–V15 databases, but does not install research, camp stocks or the worker.
It is not a substitute for the complete V16 upgrade.
Migrations preserve camp IDs, coordinates, factions, current casualties, troop
roles, stock, inventories, XP, receipts and farm targets. Busy camps retain their
current difficulty until a later safe migration. Repeated upgrades are safe.
Do not use a fresh-install script on an existing campaign.
No production database changes or deployments were performed for this update.

Solo saves
Existing version-6 campaigns upgrade their known camp definitions once on load.
Accounts, cities, armies, equipped items, progress and farm targets are retained.
Active raids keep their existing defenders until a later safe load.
The 605 generated camp IDs, coordinates and factions match the prior layout exactly.
These mechanics are part of the main Peris game. Historical Frontier server files
remain developer fixtures; players do not need a separate server or game.

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
