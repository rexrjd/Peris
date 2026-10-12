PERIS — 3D CITY CAMERA & ANIMATIONS — V19.4

Compatible base: 4bfa6e8d72f744f2c542c07d6baa90a72128ee90 (latest main checked 2026-10-12).

Apply the included source files to the existing project root, preserving their paths.
Use a review branch. If any listed source file has changed after this base, merge
those edits before replacing it. The included city_3d_camera.patch is also available
for review or git apply. This archive contains the changed files, not a full clone.
No SQL migration, new image assets or server deployment is required.

CONTROLS
- Mouse wheel: zoom toward the cursor, with limits from 0.7x to 3x.
- Q / E: rotate left / right, matching the Map's 22.5-degree arrow steps.
- Bottom arrows: rotate; minus / plus: zoom; target icon: restore the default view.
- Camera controls work with touch. Keys do not rotate while typing or in a modal.
- Camera zoom and rotation survive resizing and main-building expansion.

CITY PRESENTATION
- The surrounding low-poly terrain is about 17% wider, with a closer default view.
- Diagonal rotation gets extra framing room for outside plots.
- Working windmills, saw wheels, quarry loads and flags retain real moving parts.
- A blacksmith works at the anvil; fishing poles nod; the level-ten mage crystal
  floats and turns. Mage towers have subtle arcane motes.
- Shared instanced smoke rises over housing, lumber yards and smithies.
- Existing walking villagers remain active. All eleven faction palettes are kept.
- Ambient motion pauses in hidden tabs and respects OS/game reduced motion.
- Static world-map and building-preview model factories retain their defaults.
- Building selection works with nested animated geometry. Offscreen markers hide.

VALIDATION
- npm test: 449 passed, 1 existing skip; 0 failures.
- npm run test:tooling: 4 passed.
- npm run assets:check: 46 registered GLB models passed.
- npm run build: passed; existing large-chunk advisory remains.
- City camera / City HUD browser tests: 9 passed, 1 intentional skip (the shared
  animation test runs once on desktop; mobile camera interaction is tested).
- Desktop/mobile screenshots inspected, including real WebGL rendering,
  rotation, zoom, selection, building commands, reloads and WebGL fallback.
- Browser verification used headless Chromium with SwiftShader. No hardware
  frame-rate claim is made.

The manifest records SHA-256 hashes of every source file and its previous version.
