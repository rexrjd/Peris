# Peris v0.8 · Gameplay architecture

## Village artwork

The campaign **City → Village** view uses original soft-painted buildings with
deeper shadows for all eleven factions. Romans have a square masonry courtyard,
Orcs a circular timber palisade, and Elves a living woodland boundary. Smaller
buildings leave space for sixteen ordinary plots plus the Main building; resource
sites stay outside the enclosure. Plots still unlock through existing Main building
upgrades. **3D** and the searchable **Buildings** list remain available.

Building clicks open the existing upgrade dialog with the matching artwork,
actual costs and persistent construction queue. Water, smoke, banners and magical
light are decorative. Race-specific guards patrol outside completed walls, soldiers
drill beside built barracks, and residents gather beside the Main building and homes.
Every outside road enters through the gate. Activity stays clear of building controls,
pauses in hidden tabs, and respects game and system reduced-motion settings.
See `assets/city-village-v1.json` and `ARTWORK.md` for sources and export instructions.

## Camps, recruitment and farming in Peris

These mechanics are integrated into the existing game. Run `npm ci` and `npm run dev`, then open the URL Vite prints. Old `?frontier=1` bookmarks open normal Peris. Use your existing campaign or shared-world account, cities, resources, legions and reports.

**Army → Recruitment** has Barracks, Stables and Workshop tabs for nine faction-named troop roles. Advanced units require research in the selected city. Buildings have independent queues; training still uses the existing legion capacity and city resources. Small faction troop icons appear in recruitment, camp inspection, raid reviews, farms and reports.

Roaming camps now accumulate shared resource stocks and grow defenders at private, unpredictable intervals. The six story sites retain their progression and cooldowns. Raids use Peris's existing automatic formation battles. Survivors carry limited loot back to the departure station; resources are credited to the legion's home city on return, with storage overflow recorded in the report. Camps keep depleted stocks and casualties until production and recruitment replenish them.

**Quick access → Farm lists** provides editable default troop presets, target editing, moving between lists, sorting and removal. **Start list** reviews a manual batch before confirming. One available legion can launch one party; unsent soldiers remain as a garrison at an owned village or field. Returning survivors merge with that station's remaining troops up to 1,000; overflow remains stationed. New orders allow cancellation during the first 30 seconds. Reinforcement destinations must currently be owned; alliances remain a future feature.

Repeats are optional and use a player-chosen interval. Shared-world schedules need a successful manual launch to record the validated route; busy or unavailable targets skip that interval. Solo catch-up resumes when the campaign opens. Shared-world offline processing uses the prepared database worker, not a second game or Node service.

This integration is **local review work**. Nothing has been pushed, merged into `main` or applied to production. The other developer's account directory and map activity updates from `main` are included on the local integration branch. The activity panel preserves advanced troop identities and includes ongoing unit research. Fetch and review any further `main` changes before publication. Existing databases need the reviewed `supabase/UPGRADE_TO_V16.sql`; empty installations use `FRESH_INSTALL_V16.sql`. Offline processing additionally needs the separately reviewed `ENABLE_GAME_WORKER.sql` job. Do not apply either automatically.

See [integrated camps and farming](docs/frontier-wars.md) for behavior, migration boundaries and verification.

Development tools: see **docs/DEV_TOOLS.md** for Codex/Blender/Playwright setup and **docs/GRAPHICS_PIPELINE.md** for model export and the next 3D battle milestone. On Windows, `START-PERIS-TOOLS.cmd` prepares the local checkout after Node.js is installed.

The map release integrates a seeded seamless world and persistent external fields with latest main's city, eleven factions, magic, Empire and Heroes systems. See **MAP_RELEASE.md** for publication/database deployment and **MAP_WORLD.md** for map rules. Existing databases use **UPGRADE_TO_V11.sql**; empty installations use **FRESH_INSTALL_V11.sql**. The earlier map notes below describe the preceding continental release.

This is a structural refactor of the latest Peris v7 game. It keeps the current campaign, artwork, tactical rules, save compatibility and online behavior while separating map, battle, city, army, campaign, UI, rendering and platform systems.

Start with **INSTALL_FIRST.txt** to apply the update. Read **ARCHITECTURE.md** for the folder map, gameplay edit locations, dependency rules and SQL workflow.

## Run and verify

Requires Node 20.19 or later. Run `npm install`, then `npm run dev`. Use `npm.cmd` on Windows if PowerShell blocks npm scripts.

- `npm run build`: strict TypeScript and production bundle.
- `npm test`: gameplay, save/progression and architecture checks.
- `npm run test:db`: isolated upgrade/permissions/economy/tactical/PvP integration checks.
- `npm run test:fresh`: isolated empty installation and existing-world protection.
- `npm run test:signup-db`: existing-world signup hotfix, realistic planner/camp load, spacing, retries and data preservation.
- `npm run test:accounts-db`: name-based recovery, independent sessions, migration preservation, RLS and recovered-ruler gameplay/PvP.
- `npm run build:sql` / `npm run check:sql`: generate/verify complete SQL bundles from modular source.
- `npm run test:territory-db` / `npm run test:map-db`: persistent land/construction, wrapped visibility, faction metadata and privacy checks.
- `npm run build:standalone`: generate `standalone/Peris-v8-playable.html` for solo play.

The 200 × 200 seamless map requires `supabase/UPGRADE_TO_V11.sql` for existing databases, preserving world data and anonymous accounts. Unsafe occupied positions or saved routes abort the upgrade and require manual migration. Use `FRESH_INSTALL_V11.sql` only for an empty database. Browser solo saves retain the `peris-campaign-v6` key, format and legacy route coordinates. See **MAP_WORLD.md** for map architecture, controls and deployment requirements, and **MAP_ART.md** for original map assets and generation prompts.

## Empire gameplay

Open **Menu → Cities & expansion** or the city dock to train settlers and found cities. Open **Army** to hire commanders, choose armies, allocate hero skill points, equip artifacts, transfer nearby troops and change home cities. Existing saves automatically gain a captain for each army. See [docs/empire-and-heroes.md](docs/empire-and-heroes.md) for rules and installation.

- `npm run test:empire-db`: isolated multiple-city/army, culture/settler, hero/artifact, combat and migration checks.

## Game

Quick Battle, campaign battles and multiplayer duels now open with the published faction GLB troops in **3D units** view. The command panel also offers **2D**, with automatic fallback if WebGL or model loading fails. Army models use their home city's faction, including multiplayer armies with homes outside the visible map. Strategic maps use the published distance models at close zoom and retain lightweight markers in overview.

Open **Unit preview** from the launcher or the in-game **Menu** to inspect every faction's nine models, rotate them and review animations. Quick Battle lets you choose both factions and displays four foot formations and three mounted formations for each host. Campaign and shared-world recruitment now preserve all nine roles, with research and Workshop production as described above. Siege units participate in formation combat; structural siege damage is still a future mechanic. Source credits are in `public/licenses/peris-faction-rosters.txt`.

Campaign: develop sixteen city plots and outside resource sites, collect four resources, recruit faction troops, raid roaming camps and advance through six story locations. Strategic income/queues/travel use timestamps and continue while away. Troop casualties persist. Quick battle supports four terrains, three difficulties and three army doctrines. Settings include sound/music, display/order options and campaign export/import/backup.

Select formations by click, Shift-click or selection drag. Right-click moves/attacks; right-drag sets frontage/facing. Simple left-click orders and touch Move/Attack modes are also available. A selects all; H halts, G guards, R rallies, F focuses, Escape opens the battle menu and Space pauses local combat. The minimap and camera controls navigate the field.

Online accounts use anonymous name-based login. PvP invitations require acceptance and both commanders' readiness. Database functions enforce mutations. Tactical simulation pauses when both participants disconnect; strategic timers continue offline. The world has 200 × 200 fields and thousands of candidate starting sites, up to ten cities and two hero-led armies per city (twenty armies maximum). Historical sites are retained; new accounts need a safe dry starting ring. Land marches follow validated wrapped routes; tactical formation movement remains simplified without per-soldier collision/pathfinding. Thousand-player concurrency has not been load tested.

Original artwork is recorded in ARTWORK.md. Open Sans is bundled with its SIL OFL license. No live Supabase SQL or Vercel deployment was executed to create this archive.

## Automatic battles

All campaign, quick and accepted multiplayer battles use AI on both sides, including researched spells and rallies. Both the published faction models in 3D and Canvas 2D remain available. Click to inspect and drag to pan; solo viewers can pause or change speed. Existing worlds use `supabase/UPGRADE_TO_V11.sql`. See `docs/automatic-battles.md` for rules, verification and the current background scheduling limit.

### V12: world encounters

Battles now cover five times the area and use the target world's biome. Stable seeded bandit camps provide faction-varied PvE raids, resources and hero XP. Ten original painted portraits identify commanders in the roster and on the map. See [world encounters](docs/world-battles-bandits-and-heroes.md). Existing Supabase worlds use `supabase/UPGRADE_TO_V12.sql`; empty databases use `supabase/FRESH_INSTALL_V12.sql`.

### V13: commander portraits and victory rewards

Each faction has 20 original painted hero portraits (220 total). Every NPC victory with a commander awards equipment, including repeat raids, with actual XP and gear recorded once in a compact battle receipt. Open equipment selects the rewarded commander and the new item directly. See [hero portraits and loot](docs/hero-portraits-and-loot.md). Existing Supabase worlds use `supabase/UPGRADE_TO_V13.sql`; empty databases use `supabase/FRESH_INSTALL_V13.sql`.

### Multiplayer signup timeout fix

If creating a ruler reports **canceling statement due to statement timeout**, run the complete `supabase/FIX_MULTIPLAYER_SIGNUP.sql` in Supabase SQL Editor, then retry the same ruler name. This targeted V10–V13 hotfix preserves existing accounts, cities, armies, equipment and world data. Updated full installers include it too. See [signup fix](docs/multiplayer-signup-fix.md) for the cause and verification.

### V14: name-only accounts

Enter a ruler name to control that account. Names are case-insensitive and ignore surrounding spaces. Existing names reopen their original realm from any browser; new names create one starter city, army and commander. Page refreshes resume the current realm, expired sessions reconnect by name, and **Menu → Switch ruler** returns to name entry. Each tab has an independent connection. Knowing a name is intentionally sufficient to control its account.

Apply **`supabase/UPGRADE_TO_V14.sql`** to the existing database before deploying this frontend. Player IDs and progress remain intact, and anonymous Auth-user cleanup no longer deletes a ruler. Use `FRESH_INSTALL_V14.sql` only for an empty database. See [account stability](docs/name-only-accounts.md).

### V15: account browser and race selection

Shared world now has separate **Log in** and **Create account** screens. Browse all rulers through searchable portrait cards, race/activity filters and pagination. Select a ruler to see cities, armies, total population, strongest hero level and recent activity, then enter their realm. You can also log in by typing an existing name.

Creation requires an unused name and one of the eleven races, including the four human cultures. The first city and its army/hero appearance use that race immediately. Login does not create a missing account; creation does not overwrite an occupied name. Lost-response retries reuse the same creation request and estate. Name-based control, independent tabs and session recovery remain as in V14.

Run the entire **`supabase/UPGRADE_TO_V15.sql`** before deploying this frontend. Use `FRESH_INSTALL_V15.sql` only for an empty project. Frontier Wars remains a separate local mode. See [account entry and stability](docs/name-only-accounts.md).

The revised V15 overlay targets main `3ebbb81` and keeps the painted faction villages, private garrisons, thirty-second march cancellation, farm lists and current Frontier authority. `npm run test:account-compatibility-db` verifies migration from that exact main snapshot, including live orders and troop conservation.
