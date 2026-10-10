# Optional 3D tactical prototype

Start the game normally (`npm ci`, `npm run dev`). Open **Quick battle**, choose terrain, and **Deploy your army**. In the command panel, choose **3D prototype**. Campaign battles and live duels have the same view switch. The default remains **2D**. Switching views keeps the current battle, selection, simulation, pause state and orders; the choice is not written into campaign saves.

## Controls

| Action | Control |
|---|---|
| Select formation / add or remove | Click / Shift-click |
| Select a group | Left-drag a screen rectangle |
| Move / attack enemy | Right-click, or the Move/Attack buttons then tap |
| Set frontage and facing | Right-drag a battle line |
| Pan | Middle-drag, Alt-left-drag, arrow keys; two-finger drag on touch |
| Zoom | Wheel, pinch, + / − buttons or keys |
| Rotate | Q / E, or ↶ / ↷ buttons |
| Focus / overview | F or focus buttons / 0 or reset button |
| Existing battle commands | A select all, H halt, G guard, R rally, 1–9 formations, Space local pause, Esc menu |

## Architecture and future characters

`BattleView` switches presentation only. `Battle3DCanvas` loads `three/BattleScene` on demand. The scene reads the existing `RenderState` and sends existing `RenderActions.order` commands through the same UI, local engine or authoritative multiplayer RPCs. Gameplay domains, armies/cities/map, SQL and campaign storage have no changes.

Logical battle `(x,y)` maps to Three.js `(x,height,z)` without changing units. `BattleCamera` projects screen gestures back into these coordinates. Selection rectangles operate in screen space after rotation. Forest and river colors follow `terrainAt`; the visual hill stays inside its existing high-ground footprint. These surfaces and trees have no additional collision or combat rules.

Procedural infantry, bowmen and mounted cavalry use instanced meshes, capped at the same 120 visual soldiers per formation as 2D. Counts in labels and combat remain authoritative. Movement bob and melee sway are cosmetic, honor reduced-motion/effects preferences, and freeze during local pause. This is a tactical prototype, with stylized terrain and placeholders rather than final fantasy art. The 3D view does not yet reproduce 2D particles, corpses or a minimap; use the existing 2D view when needed.

`SoldierVisualFactory` is the replacement point for character assets. Pass a factory as the last `BattleScene` constructor argument. Each visual owns an `Object3D`, `update(SoldierFrame)` and `dispose()`. A future GLB implementation can load/cache assets outside the simulation, clone rigged characters using `SkeletonUtils.clone`, place them using `soldierSlots`, and update its `AnimationMixer`s from the frame's movement/engagement state. Normalize Blender model scale and forward direction to +X, keep root motion visual only, and release mixers/textures in `dispose`. No GLB files or extra services are required by this prototype.

WebGL initialization failures, chunk-loading failures and context loss return to a fresh 2D canvas with a notice. Scene disposal releases its animation loop, events, resize observer, meshes, GPU instances, materials and shadows. It also guards against discarded React effects and stale asynchronous imports.

## Validation

`npm test` includes `tests/battle-3d.test.ts` and `tests/battle-3d-input.test.ts`: coordinate round trips on every terrain, anchored zoom, portrait/rotated overview, own-unit selection, deployment and line rules, attacks through existing combat, actual scene picking, casualties, bounded placeholders, graphics interruption/disposal, captured-pointer and canceled-touch behavior, and event cleanup. Run `npm run build` for strict TypeScript and bundling. Browser smoke checks should cover all terrain choices, 2D↔3D during deployment/combat/pause, camera controls, mouse/touch commands, and forced WebGL context loss. No database migration or live deployment is needed.

### Local verification — 2026-10-08

Applied to `mehdi/map-overhaul` with the existing toolkit and browser-test corrections preserved. The Three.js geometry utility uses the same `three/addons` import as the map to avoid a Vite dependency rescan reloading an active battle on the first 3D switch. Mobile formation labels use compact spacing.

- All 168 gameplay and architecture tests passed under Node 24.20.0 with `node --import tsx --test --test-concurrency=1 tests/*.test.ts`; the 10 focused 3D tests also passed after the import adjustment.
- All 3 tooling tests and `npm run assets:check` passed. This prototype ships no GLB assets.
- `npm run build` passed, including strict TypeScript checks. Vite retains the existing large-main-chunk advisory.
- All 14 Playwright cases passed across desktop Chromium and Pixel 7 emulation. The new cases exercise all four terrains, pointer orders, camera rotation, deployment/combat view changes, pause, preserved selection, and actual WebGL context loss with 2D recovery. Desktop and mobile captures were inspected; the mobile Open country case was repeated after the label-spacing adjustment.

These browser checks use emulation, not a physical phone or a measured FPS benchmark. Final character art and a future GLB/Blender integration still require their own asset and visual verification.
