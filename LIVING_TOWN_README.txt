PERIS V19.11 - A LIVING TOWN
17 October 2026

Base: b790d22c61c2c383b7aad2dd71ce000165ac74c4 (main, including V19.10 gates).
Repository: https://github.com/rexrjd/Peris

WHAT CHANGED
- Hanging street lanterns with warm emissive glass and subtle flicker; Pandaren
  lantern shapes and faction colours. Selected posts have hanging flower baskets.
- Coordinated flower beds and terracotta pots around completed buildings and the
  avenue. Empty building lots and walking routes stay available.
- A striped produce stall with fruit, crates and barrels in the civic square once
  the main building reaches level 2. A shopkeeper gestures beside it.
- Backrests on the square's existing benches and a resident reading on one bench.
- Twenty-two residents walk at varied speeds, pause briefly at destinations and
  carry occasional parcels instead of everyone carrying the same thing.
- City switching, construction, demolition and faction changes rebuild the props.
  Reduced motion settles lantern flicker and gestures; hidden tabs stop animation.
  A scheduling fix ensures the final resting frame draws when the OS preference
  changes inside the scene's frame throttle.

INSTALL
Use ONE method on the base above:
1. Copy the six source/documentation/test files from this ZIP into the repository,
   preserving their paths; OR
2. From the repository root run: git apply --check /path/to/living-town.patch
   Then: git apply /path/to/living-town.patch
Do not copy files and apply the patch together.

No SQL, package changes, new images or GLBs are needed. Native 3D city only;
existing city models, camera, building interactions and game rules are retained.
This package has not been pushed or deployed.

VERIFICATION
- Production build (TypeScript/Vite and artwork checks): passed.
- Unit suite: 470 passed, 1 skipped, 0 failed.
- Final focused city life/camera tests: 7 passed.
- Desktop/mobile browser checks: 23 passed, 1 existing skip, 0 failed after the
  reduced-motion scheduling fix. Includes camera, gates, resource buildings,
  compact inspector, empty plot selection, city switching and new town details.
- Asset tooling: 5 passed; all 46 registered GLBs and 33 Rally Point paintings
  verified. Diff and patch checks passed.
- Visual review covered normal/zoomed/rotated views, mobile, and Roman, Pandaren,
  Persian, Undead, Dwarf and Orc cities. Procedural town models tested for all
  eleven factions. No GPU frame-rate benchmark was performed.

The manifest records SHA-256 hashes for the six changed files and patch.
