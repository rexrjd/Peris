# Peris v0.8 · Gameplay architecture

The map release integrates a seeded seamless world and persistent external fields with latest main's city, eleven factions and magic systems. See **MAP_RELEASE.md** for branch publication/database deployment and **MAP_WORLD.md** for current rules. Existing databases use **UPGRADE_TO_V10.sql**; empty installations use **FRESH_INSTALL_V10.sql**. The earlier map notes below describe the preceding continental release.

This is a structural refactor of the latest Peris v7 game. It keeps the current campaign, artwork, tactical rules, save compatibility and online behavior while separating map, battle, city, army, campaign, UI, rendering and platform systems.

Start with **INSTALL_FIRST.txt** to apply the update. Read **ARCHITECTURE.md** for the folder map, gameplay edit locations, dependency rules and SQL workflow.

## Run and verify

Requires Node 20.19 or later. Run `npm install`, then `npm run dev`. Use `npm.cmd` on Windows if PowerShell blocks npm scripts.

- `npm run build`: strict TypeScript and production bundle.
- `npm test`: gameplay, save/progression and architecture checks.
- `npm run test:db`: isolated upgrade/permissions/economy/tactical/PvP integration checks.
- `npm run test:fresh`: isolated empty installation and existing-world protection.
- `npm run build:sql` / `npm run check:sql`: generate/verify complete SQL bundles from modular source.
- `npm run test:territory-db` / `npm run test:map-db`: persistent land/construction, wrapped visibility, faction metadata and privacy checks.
- `npm run build:standalone`: generate `standalone/Peris-v8-playable.html` for solo play.

The 200 × 200 seamless map requires `supabase/UPGRADE_TO_V10.sql` for existing databases, preserving world data and anonymous accounts. Unsafe occupied positions or saved routes abort the upgrade and require manual migration. Use `FRESH_INSTALL_V10.sql` only for an empty database. Browser solo saves retain the `peris-campaign-v6` key, format and legacy route coordinates. See **MAP_WORLD.md** for map architecture, controls and deployment requirements, and **MAP_ART.md** for original map assets and generation prompts.

## Empire gameplay

Open **Menu → Cities & expansion** or the city dock to train settlers and found cities. Open **Army** to hire commanders, choose armies, allocate hero skill points, equip artifacts, transfer nearby troops and change home cities. Existing saves automatically gain a captain for each army. See [docs/empire-and-heroes.md](docs/empire-and-heroes.md) for rules and installation.

- `npm run test:empire-db`: isolated multiple-city/army, culture/settler, hero/artifact, combat and migration checks.

## Game

Campaign: develop eight buildings, collect four resources, recruit infantry/archers/cavalry, march to six camps, deploy, fight and rebuild. Strategic income/queues/travel use timestamps and continue while away. Troop casualties persist. Quick battle supports four terrains, three difficulties and three army doctrines. Settings include sound/music, display/order options and campaign export/import/backup.

Select formations by click, Shift-click or selection drag. Right-click moves/attacks; right-drag sets frontage/facing. Simple left-click orders and touch Move/Attack modes are also available. A selects all; H halts, G guards, R rallies, F focuses, Escape opens the battle menu and Space pauses local combat. The minimap and camera controls navigate the field.

Online accounts use anonymous name-based login. PvP invitations require acceptance and both commanders' readiness. Database functions enforce mutations. Tactical simulation pauses when both participants disconnect; strategic timers continue offline. The world has 200 × 200 fields and thousands of candidate starting sites, up to ten cities and two hero-led armies per city (twenty armies maximum). Historical sites are retained; new accounts need a safe dry starting ring. Land marches follow validated wrapped routes; tactical formation movement remains simplified without per-soldier collision/pathfinding. Thousand-player concurrency has not been load tested.

Original artwork is recorded in ARTWORK.md. Open Sans is bundled with its SIL OFL license. No live Supabase SQL or Vercel deployment was executed to create this archive.
