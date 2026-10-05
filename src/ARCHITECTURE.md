# Peris source architecture

This release organizes the existing game by feature and responsibility. It preserves the current rules, saved-campaign format, command shapes and multiplayer RPCs. It establishes practical boundaries for a small TypeScript browser game rather than introducing an ECS or a new networking framework.

## Folder ownership

| Folder | Responsibility |
|---|---|
| `src/app` | React root, navigation, global overlays and coordinated shell/responsive styles |
| `src/features/map` | Strategic map, camps, army travel, marching commands, map rendering and UI |
| `src/features/battle` | Formations, orders, movement, AI, combat, morale, outcome, battlefield rendering and UI |
| `src/features/city` | Buildings, production, capacity, construction, rename command, city layout and UI |
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

## Where gameplay changes belong

| Change | Primary source |
|---|---|
| Strategic travel interpolation and arrival | `src/features/map/domain/movement.ts` |
| Marching/raid destination and travel duration | `src/features/map/domain/commands.ts` |
| Formation creation and display footprint | `src/features/battle/domain/formations.ts` |
| Deployment, target and stance orders | `src/features/battle/domain/orders.ts` |
| Formation movement, speed, facing, stamina | `src/features/battle/domain/movement.ts` |
| Damage, range, charges, flanks, cover | `src/features/battle/domain/combat.ts` |
| Morale losses, routing and rally | `src/features/battle/domain/morale.ts` |
| Enemy targeting and maneuver decisions | `src/features/battle/domain/ai.ts` |
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

Run `npm run build:sql` after editing server source. Then `npm run check:sql`, `npm run test:db` and `npm run test:fresh`. Generated `UPGRADE_TO_V8.sql` and `FRESH_INSTALL_V8.sql` are complete files for Supabase SQL Editor. Historical v6/v7 bundle names remain generated compatibility aliases. Never manually edit those bundles or the existing-world protection in the fresh installer.

## Updating an existing repository

ZIP extraction does not delete moved paths. `node scripts/clean-legacy-paths.mjs` removes only legacy source/art files whose contents match a known v5/v6/v7 version. `--check` previews candidates. Modified files are preserved and flagged; merge those personal edits into the new owner modules before building. It never touches accounts, database data, save storage, Git metadata or environment configuration.
