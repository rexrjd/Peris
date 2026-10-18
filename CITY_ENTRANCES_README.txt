PERIS V19.10 - CITY ENTRANCES
Base: rexrjd/Peris main c0b2c3108276b64bb9f3121cb183c340f06ea267
This is a focused update on top of V19.9's accepted walls/resource design.
Main was fetched and checked on 2026-10-17.

INSTALL
Copy the src/ and tests/ folders and ARTWORK.md into the project, preserving paths.
Alternatively apply city-entrances.patch on the matching base:
  git apply --check city-entrances.patch
  git apply city-entrances.patch
Use copying or the patch, not both. Review overlaps if main advances.
Only six changed/new files are included. No SQL or new dependencies are needed.

DESIGN
- Solid arched front gatehouse, paired watchtowers and open timber doors.
- Stone jambs, thresholds, banners, exterior arrow slits and raised portcullis.
- Smaller covered service gateways at the rear and eastern bridge.
- River arches integrated into solid wall portals with open water underneath.
- Timber gateways for early wall levels; low construction markers at level zero.
- All five completed stages and eleven faction palettes/roof styles preserved.
- Compact domes and canopies avoid oversized roof silhouettes on narrow gates.
- The native building inspector's wall model now matches the actual gatehouse.

The accepted wall sections, resource buildings, city size and gameplay rules
remain intact. Paths and water channels stay open. No saved state, production,
construction, combat, multiplayer or painted village rules are changed.
Original procedural geometry only: no new image, GLB or external asset.

VALIDATION
- Full unit suite: 467 passed, 1 skipped, no failures.
- Desktop/mobile browser checks: 21 passed, 1 existing skip, no failures or flaky cases.
  Includes real gatehouse selection, native wall preview, resource selection,
  compact inspector, city panels, camera controls and WebGL fallback.
- Gate clearance checks cover all 11 factions and five completed stages.
- Production build, TypeScript, artwork checks, 5 tooling tests and assets passed.
- Assets: 46 registered GLBs and 33 Rally Point paintings verified.
- Two visual passes checked zoom, rotation, phone framing and faction variants.
- ZIP CRC, file hashes, whitespace and patch application checks passed.

No deployment or database changes were performed. Frame rate was not benchmarked.
