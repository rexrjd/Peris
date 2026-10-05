# Peris v0.8 · Gameplay architecture

This is a structural refactor of the latest Peris v7 game. It keeps the current campaign, artwork, tactical rules, save compatibility and online behavior while separating map, battle, city, army, campaign, UI, rendering and platform systems.

Start with **INSTALL_FIRST.txt** to apply the update. Read **ARCHITECTURE.md** for the folder map, gameplay edit locations, dependency rules and SQL workflow.

## Run and verify

Requires Node 20.19 or later. Run `npm install`, then `npm run dev`. Use `npm.cmd` on Windows if PowerShell blocks npm scripts.

- `npm run build`: strict TypeScript and production bundle.
- `npm test`: gameplay, save/progression and architecture checks.
- `npm run test:db`: isolated upgrade/permissions/economy/tactical/PvP integration checks.
- `npm run test:fresh`: isolated empty installation and existing-world protection.
- `npm run build:sql` / `npm run check:sql`: generate/verify complete SQL bundles from modular source.
- `npm run build:standalone`: generate `standalone/Peris-v8-playable.html` for solo play.

The previous v7 database needs no SQL change for this refactor. Earlier v5/v6 databases use the complete `supabase/UPGRADE_TO_V8.sql`, preserving world data and anonymous accounts. Use `FRESH_INSTALL_V8.sql` only for an empty database. Browser solo saves retain the `peris-campaign-v6` key and format. The existing GitHub/Vercel connection and publishable Supabase configuration remain supported.

## Game

Campaign: develop eight buildings, collect four resources, recruit infantry/archers/cavalry, march to six camps, deploy, fight and rebuild. Strategic income/queues/travel use timestamps and continue while away. Troop casualties persist. Quick battle supports four terrains, three difficulties and three army doctrines. Settings include sound/music, display/order options and campaign export/import/backup.

Select formations by click, Shift-click or selection drag. Right-click moves/attacks; right-drag sets frontage/facing. Simple left-click orders and touch Move/Attack modes are also available. A selects all; H halts, G guards, R rallies, F focuses, Escape opens the battle menu and Space pauses local combat. The minimap and camera controls navigate the field.

Online accounts use anonymous name-based login. PvP invitations require acceptance and both commanders' readiness. Database functions enforce mutations. Tactical simulation pauses when both participants disconnect; strategic timers continue offline. The current world has 12 starting slots, one settlement and one army per player, and simplified formation movement without per-soldier collision/pathfinding.

Original artwork is recorded in ARTWORK.md. Open Sans is bundled with its SIL OFL license. No live Supabase SQL or Vercel deployment was executed to create this archive.
