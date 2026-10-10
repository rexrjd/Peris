# Peris map, battle and model pipeline

## Existing foundation

The live strategic map already has Three.js terrain, instancing, wrapped navigation, material-batched faction models and Canvas compatibility rendering. Its geography is seeded and gameplay coordinates come from the domain model. The tactical battle still draws sprites on Canvas 2D. Preserve that game logic while developing a 3D view.

Treat original Shahnameh/Persian fantasy artwork as the desired new direction, introduced alongside existing factions rather than replacing them wholesale. A reference sheet is not a finished, rigged model.

## Model workflow

1. Keep editable `.blend` sources in `assets/source/`. Install Git LFS locally before committing them.
2. Put the intended meshes, rig, and attachments into a `PERIS_EXPORT` collection. Exclude reference planes, cameras, lights and unrelated objects. Include the armature used by exported meshes.
3. Work in Object Mode. Check scale, orientation, normals, materials and the rig. Bake procedural materials to textures where the glTF exporter cannot represent them. Give animation clips stable names, such as `idle`, `walk`, `attack`, `hit`, and `death`.
4. Export using Blender's glTF exporter or the collection script:

   ```text
   blender assets/source/white-div.blend --background --python scripts/blender/export_glb.py -- --collection PERIS_EXPORT --output public/models/white-div.raw.glb
   ```

   This script restores object selection and does not save the `.blend`. It refuses an existing output unless `--overwrite` is explicit. Its runtime execution still needs verification with the user's Blender version; Python syntax checks do not prove a valid rig/export.

5. Inspect and optimize to a new output. Do not ship the `.raw.glb` intermediary: keep intermediates outside `public/models/` or remove/move it after review.

   ```text
   npm run assets:inspect -- public/models/white-div.raw.glb
   npm run assets:optimize -- public/models/white-div.raw.glb public/models/white-div.glb --compress meshopt --texture-compress webp
   npm run assets:validate -- public/models/white-div.glb
   ```

   Before integrating this compression, configure the game loader's Meshopt decoder. Draco requires DRACOLoader; KTX2 textures require KTX2Loader and renderer support detection. The existing procedural map does not already prove these loaders are wired. Preserve an uncompressed export until loading and visual comparison pass.

6. Register shipped models in `assets/manifest.json` and run `npm run assets:check`. Example entry:

   ```json
   { "id": "white-div", "file": "public/models/white-div.glb", "license": "original", "maxBytes": 5242880 }
   ```

   Supported license records are `original`, `CC0`, `CC-BY-4.0`, and `licensed`. Third-party entries require an HTTPS `source`. Attributed/restricted licenses require `attribution` describing credits/terms. This manifest is an inventory, not a legal determination. Public GLB files must all be registered. The initial inventory is empty because no finished GLB model is added here.

7. Review the model in-game at actual camera distances, with animations and both team colors. Check feet, shields, hammer clearance, silhouettes and animation transitions. A basic standing pose is insufficient for troop approval.

Poly Haven (https://polyhaven.com/license) provides CC0 materials and environment assets. Choose and optimize individual assets to match the game's style and record their source; no bulk asset download is required for this toolkit.

## First 3D battle milestone

- Render the existing formation state with Three.js while preserving domain coordinates, tick sequence and authoritative results.
- Keep current unit selection, deployment, movement/attack orders, frontage, facing, morale and pause/withdrawal controls working.
- Start with one terrain and two representative unit types. Benchmark 100-200 visible soldiers first; visible counts need not redefine the simulation's troop counts.
- Use formation-based gameplay; avoid per-soldier rigid-body physics. Prototype animation with a small rigged group, then measure shared animation, shader/VAT, or instanced skinning options before scaling armies.
- Add a camera, selection rings, order arrows, readable formations, dust/projectiles and sound. Keep effects from determining combat results.
- Preserve a compatibility option when 3D is unavailable. Only add a polished White Div once the asset import and animation path works.

## Map improvements and benchmarks

Keep the existing 200 x 200 wrapping model and coordinate aliases. Improve terrain/scenery incrementally; use shared assets, chunk/detail budgets, and semantic zoom. Match visible mountains, rivers and roads to domain terrain rather than deriving gameplay from decorative geometry.

Record device/GPU/browser, resolution, quality, formation/soldier count, draw calls, loading size, memory, and measured frame time. Initial goals: 60 FPS desktop and 30 FPS real mobile, to be revised from profiling. Headless browser tests validate basic rendering and flows, not those targets. A desktop-emulated phone is not a phone GPU benchmark.
