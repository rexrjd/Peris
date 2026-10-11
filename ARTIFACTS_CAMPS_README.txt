PERIS — INTEGRATED RALLY POINT, ARTIFACTS AND CAMPS
2026-10-11 · compatible with main cc16233

Compatibility
Use these repository changes together with the current main branch. The normal
Peris game includes the Rally Point, recurring farms, nine troop roles, research,
growing camps, worker and artifact paintings. Players need no separate Frontier
server or side game. Existing accounts, cities, armies, research, ownership,
inventory, XP, farm targets and report receipts are retained.

Frontend
Run npm ci and npm run build, then deploy the resulting frontend. All 24 original
artifact paintings ship in public/art/artifacts/v1/. The build checks that every
painting is present, distinct, transparent and the correct size. Copying SQL alone
does not update artwork or the interface.

Reports
The Reports navigation button displays the number of unread visible receipts and
turns yellow while any remain unread. Opening a report through Reports, Rally
Point or a camp marks it read, including reports whose battle has been pruned.
Visiting the Reports tab alone does not clear the count. Quiet zero-loss farm
receipts are excluded when their list enables losses-only reports.
Read status survives reloads and is separate for each ruler and game mode in this
browser. Other browsers and devices keep their own read status. This indicator
needs no database migration.

Artifacts and camps
24 distinct paintings appear in the backpack, equipped slots, selected item and
victory receipt. The 12 original IDs/bonuses are retained; 12 additional artifacts
cover Rare, Epic and Legendary equipment.
  Camp level 1–2   Easy      Common equipment / tier 1
  Camp level 3–5   Guarded   Rare equipment / tier 2
  Camp level 6–8   Hard      Epic equipment / tier 3
  Camp level 9–10  Deadly    Legendary equipment / tier 4
NPC victory grants one item of the advertised rarity within the existing backpack
limit. Reopening reports never creates another reward. Camp IDs, coordinates and
factions retain the existing 605-camp layout. Upgrades preserve casualties,
stored resources and active encounters. All ten levels grow toward matching solo
and multiplayer caps. Empty camps can be raided without invalid empty rosters.
Private random recruitment deadlines remain hidden from players.

Multiplayer installation
Existing databases: supabase/UPGRADE_TO_V17.sql.
New databases only: supabase/FRESH_INSTALL_V17.sql.
The V17 upgrade installs complete troop operations, farms, private statistics,
economic receipts and safe retry commands alongside the frontend. It is safe to
repeat and preserves existing game data. Never run a fresh install on a campaign.
Review supabase/ENABLE_GAME_WORKER.sql separately to enable the background worker.
Production database installation is a separate step; it was not performed here.

The focused supabase/UPDATE_ARTIFACTS_AND_CAMPS.sql requires an existing V16 world.
It installs compatible camp and artifact corrections, retains live state, and
skips metadata changes for busy camps. It is not a replacement for the complete
V17 mechanics and safe retry upgrade. Older databases need the complete upgrade.

Solo saves
Existing version-6 campaigns retain accounts, cities, armies, equipped items,
progress, ownership and farm targets. Known camp metadata upgrades once on load;
active raids and current casualties are preserved.

Maintenance
Original prompts and sources: assets/artifacts-v1.json and assets/source/artifacts-v1/.
Runtime paintings: public/art/artifacts/v1/*.webp (384px transparent images).
Rebuild paintings: npm run build:artifact-art
Rebuild catalog: npm run build:artifact-catalog
Rebuild camps: npm run build:bandits
Rebuild SQL: npm run build:sql
Rebuild focused update: npm run build:camp-artifact-upgrade
Verify paintings: npm run check:artifact-art
See docs/frontier-wars.md for the integrated mechanics and installation details.
