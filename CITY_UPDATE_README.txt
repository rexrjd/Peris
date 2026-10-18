Peris V19.7 — Roads, countryside, front gate and barracks training

Based on current main: 11ccee7b843c41b7515dcb561e72b82442a16b52. Includes the recent Rally Point integration.

What changed
- Terrain-following roads extend to all four landscape edges.
- The top vignette is removed and the northern terrain tone is softer.
- Up to 1,100 instanced faction trees fill a larger countryside, clear of roads and buildings.
- The main gate faces the front avenue.
- Barracks have larger five-stage models and an open drill yard.
- Active barracks recruitment shows an instructor and up to six trainees using the existing classic faction battle models and skeletal animations.
- Training pauses for reduced motion/hidden tabs and stops when its queue ends. Other cities' queues do not animate the selected city.
- Wide phone views keep the foreground ahead of the camera's near plane.

Install the source files
Copy the included folders/files into the repository root, preserving paths and replacing matching files. The ZIP contains updated files, not an entire new project. Alternatively apply city-training.patch with git apply; use only one method.

Multiplayer database update
Run supabase/UPGRADE_UNIQUE_BARRACKS.sql from this ZIP in Supabase SQL Editor to enforce one new barracks per city on the server. The campaign rule and picker are already included in the source files. Complete generated installers are included for repository consistency; use the focused update for an existing current world.

Compatibility
Existing duplicate barracks are preserved with their levels, troops and queues. New duplicates are blocked; normal upgrades remain available. Repeated Academies, housing, storage, smithies and other existing construction rules retain their behavior. Current campaign saves and the painted Village view remain compatible. No SQL was deployed and no live account was changed by this work.

Verification
- Full unit suite passed (one skipped), including unique construction, city-specific queue timing, scenery clearance, camera clipping, reduced motion and source cleanup.
- Final TypeScript/production build passed.
- Browser checks: 17 passed, 7 intentional skips, zero failures. Desktop/mobile construction, real recruitment completion, faction models, rotation/zoom, city switching and WebGL fallback checked; captured images inspected.
- Tooling and asset checks passed (46 existing GLB files, Rally artwork/font checks).
- Complete upgrade, fresh-install protection, city-slot and focused barracks migration database checks passed.
- SQL regeneration check and git diff checks passed.
