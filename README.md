# PERIS v0.6 · The Age of Ambition

A playable, original **2D strategy prototype** with a persistent campaign and Rome-inspired real-time formation battles. Built on the user's Peris v5 project. The canonical repository remains **https://github.com/rexrjd/Peris**; your existing Vercel project stays connected to it.

## Install this update

1. Extract **Peris-v6-Empire-changed-files.zip** into your existing local **Peris repository root**, alongside `package.json`. Choose **Replace files**. Keep your existing `.git` directory.
2. In **Supabase → SQL Editor**, paste and run the **entire** `supabase/UPGRADE_V5_TO_V6.sql` file. This upgrades a v5 world without deleting its players, settlements, troops, resources or Auth accounts. It is safe to rerun. This migration has been tested against the v5 archive supplied in this conversation.
3. Locally run `npm.cmd install` and then `npm.cmd run dev` on Windows. On macOS/Linux use `npm install` and `npm run dev`. Use Node 20.19 or later. The local URL is normally `http://localhost:5173`.
4. In GitHub Desktop, select **Peris**, commit the changes with **Peris v6 Empire prototype**, and click **Push origin**. Vercel deploys that commit through the existing project. Your configured production domain stays the same.

Your existing publishable Supabase URL/key are included as client fallbacks, as previously requested. You do not have to add environment variables. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` override the defaults if already configured.

**Existing world:** use the UPGRADE file above. Do not run a reset. `supabase/schema.sql` is also the safe v5-to-v6 migration. Old reset scripts have been replaced with harmless notices.

**New, empty Supabase project only:** use `supabase/FRESH_INSTALL_V6.sql`, then enable anonymous sign-ins. The fresh installation refuses to run if player records already exist. It does not delete Auth users. It is not an alternative to upgrading an existing campaign.

## Play immediately

`Peris-v6-playable.html` is a separate self-contained solo preview. Download it and open it in a current desktop browser. It embeds the game, graphics, and styles; no server, npm, Supabase, or account is required for solo play. Multiplayer is enabled in the deployed project, not the file preview.

The menu offers three paths:

- **Solo campaign:** choose a ruler name, build a settlement, and reclaim the six rebel camps. Saves automatically in this browser. **Continue** resumes the saved realm. Starting a new realm replaces the browser's previous solo campaign.
- **Multiplayer:** the existing anonymous Supabase account reopens its realm. New players enter a unique name, with no email, Google, or password. Another browser/device has its own account. Clearing that account's browser storage loses access to it; leaving through the game's menu keeps the session.
- **Quick battle:** nine friendly formations against a recruit, veteran, or expert AI host, on plains, woodland, highlands, or a river crossing. No campaign resources or troops are spent.

## A complete campaign loop

**Build → produce → train → march → deploy → fight → collect loot → rebuild.**

- Eight functional structures: timber yard, quarry, wheat fields, forum, barracks, stables, city walls and granary.
- Four resources, real costs, capacity limits, timed construction, and a three-slot sequential training queue.
- Income continues while away. Completed upgrades affect production from their actual completion timestamps. Fractional income is retained rather than lost at every update.
- Higher barracks/stables levels reduce training time. Walls improve initial army morale. Granaries raise every resource's storage limit.
- One field army per ruler, capped at 1,000 soldiers. It must be home to recruit, and must finish training before marching. No campaign recruitment or movement during combat.
- Time-based world travel and routes. Marching orders can redirect the army. **Return home** regroups it for recruitment.
- Six camps with increasingly strong hosts, battlefield types, resource spoils, a two-minute victory cooldown, and conquest progress recorded for each ruler.
- Four claimable objectives, prestige, survivor counts, losses, and battle reports. Quest and battle rewards can be granted only once.
- Defeat and withdrawal preserve surviving troops, including routed survivors. Fallen troops stay lost. The army regroups at its keep after the result.

## Tactical battles

Armies split into several infantry, archer, and cavalry formations. Every formation renders individual animated soldier/horse glyphs, standards and morale indicators. Up to 120 glyphs are drawn per formation for performance; its displayed count and combat calculation still use the full troop count.

- Deployment before combat, including position, frontage, and facing.
- Select one formation, Shift-select several, or drag a selection rectangle.
- Right-click an enemy to attack; right-click ground to move. Right-drag a line to specify destination, facing and frontage.
- Infantry holds a line and can brace in **Guard** against frontal cavalry. **Attack** increases damage but reduces protection. **Line** is the balanced stance.
- Archers fire at range, can fire automatically, and are weak in close combat. The renderer shows travelling arrows.
- Cavalry moves faster, earns charge shock after a long approach, and rewards flank/rear attacks. Running consumes stamina; resting restores it.
- Morale breaks formations before total destruction. Routed survivors flee. **Rally** restores morale once per side and can bring living routed formations back.
- Terrain is functional: woodland slows movement and protects against ranged fire, cavalry struggles in woods, high ground helps ranged attacks, and river shallows slow crossing while the bridge remains traversable.
- The AI advances, selects nearby targets, favours archers with cavalry, and pulls archers away from close threats. Harder hosts have stronger morale/damage and larger forces in quick battles.
- Camera zoom, middle-drag pan, arrow-key pan, selection focus, minimap, troop cards, force balance and result screen.
- Solo/practice can pause while giving orders, and run at 1×, 2× or 3× speed. Shared multiplayer battles use one common clock.

| Input | Action |
|---|---|
| Left click | Select a formation |
| Shift + left click | Add/remove a formation |
| Left drag | Select formations in a box |
| Right click | Move or attack |
| Right drag | Set a formation line and facing |
| A / 1–9 | Select all / select a unit card |
| H / G / R | Halt / Guard / Rally |
| F | Focus the selected formation |
| Space | Pause/resume solo or quick battle |
| Scroll / middle drag / arrow keys | Zoom / pan / pan |

On touch screens, select a unit card, press **Move** or **Attack**, and tap the field. Camera buttons replace the scroll wheel. The command strip can scroll to expose additional controls. Desktop is the intended experience for precise formation control.

## Multiplayer behavior

A ruler invites a rival army or settlement to a **live duel**. The rival must accept. Both players deploy and press **Begin battle** before the common field starts. Survivors and casualties affect both campaign armies; duels grant prestige but no fabricated resource loot.

The database checks ownership, resources, queue limits, army availability, invitations, deployment, orders, combat, casualties and rewards. Browsers submit commands and render snapshots. Old instant recruitment/upgrade and unaccepted-battle RPCs are revoked, as are internal simulation helpers. New tables have read-only RLS policies for clients.

The tactical simulation advances through a participant's periodic database RPC while at least one participant is connected. There is no always-running dedicated battle server in this version: if both disconnect, tactical combat pauses and can resume on return. Strategic movement, income and queue completions remain timestamp-based while away. Realtime notifications and polling refresh shared state without using a mutating snapshot function or refetching on every rendered frame.

The inherited strategic prototype has **12 starting slots** and one settlement/army per player. Camps are personal campaign encounters; their conquest progress is per ruler. PvP duels are by mutual invitation and can start across the map. Siege warfare, settlement capture, trade/diplomacy, a dedicated simulation service, true 3D terrain, and per-soldier collision/pathfinding are outside this 2D prototype.

## Verification

- `npm run build`: strict TypeScript check and production Vite build.
- `npm run build:standalone`: creates a portable `standalone/Peris-v6-playable.html` from that build, with all graphics embedded.
- `npm test`: nine tests covering offline income and queue timing, fractional production, storage, movement, formation conservation, ownership, deployment, battle outcomes, terrain, charges and costs.
- `npm run test:db`: an isolated PostgreSQL-compatible PGlite database. Creates a v5 world, tests preservation and repeat migration, queues and rewards, private helpers and retired bypasses, battle resolution/loot/cooldowns, and a two-player invitation/deployment/rally/report flow. It never connects to your live Supabase database.
- Browser checks exercised main menu, city upgrades, recruiting, quick-battle deployment and selection, pause/resume, retreat/results, saved solo resumption, and mobile width. A complete campaign raid reached victory through the UI, including survivors, loot and the chronicle.
- The standalone file was opened with the browser offline: hero/portrait graphics, a quick battle, orders, pause, results, recruitment and campaign persistence worked with zero external requests and zero browser errors.
- Empty-database installation and its existing-world protection were also verified in an isolated database.

These checks validate the packaged app and migration locally. Running the supplied SQL in your hosted Supabase project and letting Vercel deploy the commit are the remaining installation steps.

## Project layout

- `src/game/renderer.ts`, `graphics.ts`: native Canvas terrain, sprites, camera and pointer interaction.
- `src/game/simulation.ts`, `rules.ts`: solo tactical rules and campaign constants.
- `src/lib/local.ts`: solo persistence, queues, campaign actions and result settlement.
- `src/lib/online.ts`: online command adapter, snapshots, updates and common battle ticks.
- `supabase/UPGRADE_V5_TO_V6.sql`: authoritative multiplayer rules, safe upgrade and permissions.
- `ARTWORK.md`: included asset paths, image-generation prompts, and original-art notes.

There are no licensed Total War assets, external runtime fonts, image CDNs, analytics, ads, or payment integrations. The game keeps the previous React/Vite/Supabase deployment shape while replacing the Phaser display layer with a native Canvas renderer.
