# Peris source architecture

This release organizes the existing game by feature and responsibility. It preserves the current rules, saved-campaign format, command shapes and multiplayer RPCs. It establishes practical boundaries for a small TypeScript browser game rather than introducing an ECS or a new networking framework.

## Folder ownership

| Folder | Responsibility |
|---|---|
| `src/app` | React root, navigation, global overlays and coordinated shell/responsive styles |
| `src/features/map` | Strategic map, camps, army travel, marching commands, map rendering and UI |
| `src/features/battle` | Formations, orders, movement, AI, combat, morale, outcome, battlefield rendering and UI |
| `src/features/city` | Buildings, production, capacity, construction, rename command, city layout and UI |
| `src/features/empire` | Culture, city founding, settlers, ownership context and save normalization |
| `src/features/heroes` | Commander classes, XP/attributes, artifacts, troop transfer and home-city changes |
| `src/features/frontier` | Reusable camp balance, stock arithmetic, nine-role catalog and faction icons; historical prototype UI is not a player entry point |
| `server/frontier` | Historical developer prototype and regression fixtures; not required by Peris |
| `src/features/army` | Unit definitions, troop counts, recruitment, training completion and UI |
| `src/features/campaign` | New realm, quests, rewards, progression, raid creation, strategic queue orchestration and battle settlement |
| `src/features/menu`, `settings`, `codex` | Their own screen components and styles |
| `src/engine/local` | Local engine lifecycle, ticks, subscriptions, command dispatch and once-only finalization |
| `src/engine/online` | Shared-world synchronization, subscriptions and RPC command mapping |
| `src/engine/rendering` | Canvas lifecycle, input binding, terrain composition and React canvas adapter |
| `src/platform` | Browser audio, preferences, save storage and Supabase client |
| `src/shared` | Reusable UI, geometry, random/time helpers, world/command DTOs and canvas utilities |
| `public/art` | Assets grouped under `menu`, `city`, `battle`, `army` and `shared` |
| `supabase/modules` | Ordered source fragments for database rules and permissions |
| `tests` | Gameplay, save/progression, architecture and isolated database integration checks |

Features contain `domain`, `ui`, `rendering` and `styles` only where needed. Domain code uses plain state and types. Rendering reads state and emits commands; it does not apply damage, spend resources or persist campaigns. The local engine coordinates feature systems. The online adapter asks authoritative database functions to perform mutations.

Camps and farming are part of the existing Peris realm. `src/main.tsx` redirects
old Frontier bookmarks into the same application. `unit_roster` preserves nine
recruited identities while legacy infantry/archer/cavalry totals remain combat
classes. Formations carry the actual recruited role and separate unit statistics;
hero/magic multipliers remain unchanged. Garrisons, recruitment, transfers,
cancellation, settlement and save validation preserve those identities.

The Rally Point is part of the main navigation. Its army-domain selector groups
owned stationed troops and movements by actual village/field coordinates, rather
than a legion's assigned home. Incoming and outgoing tabs follow the selected
city and its owned fields; farm lists and reports are labelled empire-wide.
The UI embeds the existing farm-list component and reuses march review, cancel
commands and report details. It does not create a second order system or infer
private rival movement from public map snapshots.

Local camp production and repeat dispatch use `campaign/domain/campStock.ts` and
`campEconomy.ts`; they feed the existing travel and automatic battle systems.
Shared worlds use the normal RPC adapter and generated V16 Supabase modules.
Private `peris_game_tick` performs bounded, fair owner processing through existing
settlement, travel and battle functions, plus camp accrual. Only service-role
execution is granted; an optional database scheduler runs it independently of
browsers. NPC growth deadlines are never exposed in public snapshots.
Online clients retain their battle and queued-work cadence while polling idle
state less often. Background core, map, cosmetic and social reads back off after
failures; explicit commands retain the existing server receipt and retry path.
See `docs/shared-world-polling.md` for intervals, limitations and measured traffic.
The old local Frontier server remains a development reference, not a second
player account, production service or navigation route.
See `docs/frontier-wars.md` for the migration and publication boundary.

## Where gameplay changes belong

| Change | Primary source |
|---|---|
| Culture, founding and settlers | `src/features/empire/domain/expansion.ts` |
| Hero levels, equipment and combat bonuses | `src/features/heroes/domain/heroes.ts`, `commands.ts` |
| Strategic travel interpolation and arrival | `src/features/map/domain/movement.ts` |
| Marching/raid destination and travel duration | `src/features/map/domain/commands.ts` |
| Owned stations, private troop pools and merging | `src/features/map/domain/garrisons.ts` |
| Saved campaign farm targets and manual batch dispatch | `src/features/campaign/domain/farms.ts` |
| Formation creation and display footprint | `src/features/battle/domain/formations.ts` |
| Deployment, target and stance orders | `src/features/battle/domain/orders.ts` |
| Formation movement, speed, facing, stamina | `src/features/battle/domain/movement.ts` |
| Damage, range, charges, flanks, cover | `src/features/battle/domain/combat.ts` |
| Morale losses, routing and rally | `src/features/battle/domain/morale.ts` |
| Both armies targeting and maneuver decisions | `src/features/battle/domain/ai.ts` |
| Terrain effects | `src/features/battle/domain/terrain.ts` |
| Tick sequence | `src/features/battle/domain/simulation.ts` |
| Winner, timeout and tactical result | `src/features/battle/domain/resolution.ts` |
| Campaign survivors, loot and reports | `src/features/campaign/domain/battleSettlement.ts` |
| Building definitions and upgrade completion | `src/features/city/domain/buildings.ts`, `construction.ts` |
| Resource income and affordability | `src/features/city/domain/economy.ts` |
| Recruitment cost, duration and completion | `src/features/army/domain/units.ts`, `recruitment.ts`, `commands.ts` |
| Completion of strategic timed queues | `src/features/campaign/domain/settlement.ts` |
| Map entities and map background | `src/features/map/rendering/MapRenderer.ts`, `terrain.ts` |
| Formation visuals, soldier sprites and particles | `src/features/battle/rendering/BattleRenderer.ts`, `soldiers.ts`, `effects.ts` |
| Mouse/touch/keyboard bindings | `src/engine/rendering/InputController.ts` |
| Camera and coordinate conversion | `src/shared/rendering/RenderContext.ts` |
| Import/export validation and backup | `src/platform/storage/saves.ts` |
| RPC names and arguments | `src/engine/online/rpcCommands.ts` |

The battle tick order is **AI → movement → accumulated damage → morale/routing → winner resolution**. Damage remains simultaneous. Visual interpolation and particles belong to the renderer, and never determine the outcome.

## Dependency rules

- Gameplay domains must not import React, renderer/UI modules, browser storage/audio/network APIs or engine implementations at runtime. Command handlers receive a typed context with state and callbacks.
- Shared world and command DTOs compose feature-owned types through type-only imports. A type dependency is distinct from a runtime dependency.
- Feature UI may call engine adapters; it must not duplicate simulation or server rules.
- Runtime import cycles are prohibited. `npm test` checks these boundaries and validates every source import.
- Use direct imports from the module that owns a system. There is no replacement giant `rules.ts` or `simulation.ts` barrel holding unrelated systems.

The current simulation mutates the supplied World/Formation state by design. This refactor isolates those mutations by system; it does not change the save or network protocol. Local and SQL battle rules remain separate implementations. A gameplay change affecting multiplayer must update both, with corresponding tests.

## Styles and assets

Feature-specific rules live in each feature's `styles` folder. Shared controls/theme and the coordinated application shell are separate. `src/app/styles/index.css` explicitly preserves the baseline, presentation and responsive passes; do not arbitrarily reorder its imports. All runtime art paths and the standalone generator use the grouped asset directories.

## Database source and generated bundles

Edit the relevant function under `supabase/modules`. The ordered `manifest.json` composes schema, gameplay functions and final permissions into the deployment scripts. These fragments are source files, not individually runnable migrations.

Run `npm run build:sql` after editing server source. Then `npm run check:sql`, `npm run test:db` and `npm run test:fresh`. Generated `UPGRADE_TO_V16.sql` and `FRESH_INSTALL_V16.sql` are complete files for Supabase SQL Editor. Historical v6/v7/v8/v9 bundle names remain generated compatibility aliases. Never manually edit those bundles or the existing-world protection in the fresh installer.

## Updating an existing repository

ZIP extraction does not delete moved paths. `node scripts/clean-legacy-paths.mjs` removes only legacy source/art files whose contents match a known v5/v6/v7 version. `--check` previews candidates. Modified files are preserved and flagged; merge those personal edits into the new owner modules before building. It never touches accounts, database data, save storage, Git metadata or environment configuration.

## Weekly rankings

`features/rankings/domain` owns the pure local weekly scoring, saved receipts,
defender attribution and population baselines. `features/rankings/ui` displays
five bounded public Top 10 boards through the engine's optional `rankings` read
method; `platform/client` validates the shared DTO. Weeks use real Monday UTC
boundaries, independent of the accelerated game clock. Private SQL aggregates
and narrow triggers in `supabase/modules/rankings` score finalized outcomes and
actual population changes exactly once. The authenticated read RPC publishes
only names, guild tags, scores and ranks, with no private reports or troop data.
Generate `UPGRADE_WEEKLY_RANKINGS.sql` from source; deployment is separate.
See `WEEKLY_RANKINGS.md` for rules and installation.

## Scouting

`features/scouting/domain` owns scout detachments, counter-scout strength, immutable intelligence receipts and save validation. Scouting joins the canonical campaign settlement timeline and crop supply. Returning scouts arrive before observations at a tied deadline. Scout-only raids and farm entries dispatch reconnaissance; mixed armies retain their combat flow. Scouts use the existing role, research and faction artwork.

The existing Reports inbox renders `BattleResult.scouting` snapshots. Resolved `mode:'scouting'` battle rows satisfy the report foreign key only: they have no defender owner, combat formations or rewards. A separate defender notice contains only intercepted scout counts. Mission rows are owner-only and excluded from the public map. SQL modules under `scouting/` integrate participant locks, camp mutation cutoffs, worker deadlines and repeatable focused installers. Generate `UPGRADE_SCOUTING.sql` from the modules; it remains a separate deployment step.

## Account research (V18)

`features/research/domain` owns the shared 210-node catalog, bonus selectors, account science and project timing. Its private World arrays serialize through the existing engine and save path. `features/research/ui` owns the linked tree and navigation context. Academies remain ordinary repeatable city slots. SQL sources live in `supabase/modules/research`; generate catalog and V18 bundles with `npm run build:sql`. Owner-scoped science/progress stay outside public map and player metadata. Existing worker settlement includes research deadlines. See `RESEARCH_ACADEMY_UPDATE.md` for installation and balance.

## Guilds and messages (V19)

Guild reinforcement preparation lives in `features/social/ui/GuildReinforcementDialog.tsx`; pure source eligibility and participant DTOs live in `features/social/domain/reinforcements.ts`. Dispatch and recall use the online engine's existing command receipt journal. Authoritative source is `city/guild-reinforcements.sql`; participant-only snapshot data feeds the shared Map/3D City Events selector. The preserved recipient-city ID keeps returning support in the right filter even after its destination changes. Optional private hooks keep older focused installers usable without installing the guild-support subsystem. No troop transfer, travel completion or combat result is decided by the UI.

`features/social/domain` owns social types, guild/rank selectors and message-page merging. `features/social/platform` owns bounded Supabase RPC access, and `features/social/ui` owns the guild hall, messenger, navigation, and safe pending-action retries. Social state is account-scoped and separate from campaign saves and public map snapshots. The guild and message entry points remain in the upper left on desktop and mobile. Solo campaigns show an entry guide to the shared world.

Authoritative source lives in `supabase/modules/social`. Guild permissions, receipts, treasury transfers, and channel privacy are checked in SQL. Guild membership, accepted alliances, and non-aggression pacts guard outgoing and arriving city raids. Generate complete V19 installers and the focused V18-to-V19 migration with `npm run build:sql`. `UPGRADE_GUILDS_TO_V19.sql` alters only social state and the two city-raid entry functions. See `GUILDS_AND_MESSAGES_UPDATE.md`.
