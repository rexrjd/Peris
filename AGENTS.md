# Peris development instructions

Read `ARCHITECTURE.md`, `MAP_WORLD.md`, and `ARTWORK.md` before changing gameplay or graphics. The root application is active; `peris-starter/` and `src/src/` contain legacy copies. Do not implement features in those copies.

## Product direction

Peris combines persistent, field-based strategy with automatic AI-controlled formation battles. Develop an original fantasy identity, including Shahnameh-inspired creatures and Persian architecture. Preserve the existing eleven factions and working flows while introducing that direction incrementally. Use reference artwork for art direction, not as a substitute for interactive terrain or game-ready models.

## Architecture and compatibility

- Keep the existing React/TypeScript/Three.js stack. Domain logic must remain independent of React, Three.js, browser APIs, and rendering frame rate.
- Renderers read state and emit existing commands. Damage, morale, costs, travel, and results belong to domain systems and authoritative server functions.
- The strategic world already uses Three.js. Tactical battles currently use Canvas 2D. Both 3D and Canvas battle renderers preserve faction visuals, formation geometry, inspection, facing and automatic simulation rules. Players prepare armies before marching; AI controls both sides during combat.
- The map is 200 x 200 wrapped fields, canonical coordinates -100..99, 128 logical units per field. Preserve wrapped pathfinding, seam selection, save compatibility, and server agreement. Decorative elevation must not silently change movement or ownership.
- Preserve all factions, campaign saves, online privacy boundaries, and the Canvas compatibility map. Never deploy SQL as part of a graphics change.
- Edit database source in `supabase/modules`, then regenerate bundles. Edit geography source, then regenerate world and SQL files. Do not hand-edit generated outputs.

## Tools and graphics

- Project MCP settings are in `.codex/config.toml`: Playwright, Context7, and the existing MCP for Blender workflow. Local tools need a trusted project, installed prerequisites, and a running Blender addon. Do not claim a connection works without testing it.
- Use Context7 or official documentation matching the installed library version for unfamiliar APIs. If documentation access fails, report it and use official documentation directly.
- Use browser screenshots and actual pointer/keyboard interactions for map/battle changes. The accessibility tree does not describe objects drawn inside a canvas.
- Keep editable Blender sources under `assets/source/` and game models under `public/models/`. Record shipped models and their licenses in `assets/manifest.json`.
- Use `scripts/blender/export_glb.py` for explicit collection export. Never export the entire scene accidentally or overwrite a source file. Preserve rigs and animation clips; inspect exports in the game.
- Run `npm run assets:inspect -- file.glb`, optimize to a separate output with `npm run assets:optimize -- input.glb output.glb`, and run `npm run assets:validate -- output.glb`. Compression must match the runtime loader configuration. Optimization can change appearance; compare it visually.
- Instance repeated static props; chunk terrain; use distance-based detail and shared materials. Animated armies need a measured animation strategy beyond plain InstancedMesh. Avoid per-soldier rigid-body physics as an initial requirement.
- Keep benchmarks explicit: target 60 FPS desktop and 30 FPS mobile, with named hardware, soldier count, settings, and measurements. These are goals, not verified performance claims.

## Verification

Run `npm test`, `npm run test:tooling`, `npm run assets:check`, and `npm run build` for this toolkit. Run `npm run test:e2e` for UI/rendering changes and inspect captured images. World or server changes also require generation checks and the affected isolated database suites. Separate pre-existing failures from regressions; never weaken a check merely to make it pass.

Use small review branches. Report what changed, what passed, and what still needs local Blender/browser verification.
