PERIS V19.12 - TOWN STONEWORK AND BUILDING IDENTITY
17 October 2026

Base: 4fc2bf71a613e4a9fdae9b619ca19fe8f371e00d (current main; includes V19.11 flowers and lanterns).
Repository: https://github.com/rexrjd/Peris

WHAT CHANGED
- A staggered flagstone avenue from the main gate to the civic square, paved
  forecourts and building approaches, earth working yards, and soft grass tones.
  Empty reserved lots remain available and the roads keep their existing routes.
- A taller Roman civic hall, columned entrance and upgraded tower; other faction
  halls keep their architectural forms with a taller silhouette and entrance steps.
- An open smithy with furnace, banded chimney, bellows, anvil and existing worker.
- Twin warehouse loading sheds with platforms, crates and a hoist. Later Orc
  warehouses use a lean-to awning that stays inside the building lot.
- Raised granary silos with bands, chutes, sacks and an access ladder.
- Military standards and a facade shield for the accepted barracks/drill yard.
- Building previews use the same new models in their resting pose.

INSTALL
Use ONE method on the base above:
1. Copy the twelve changed source/documentation/test files into the repository,
   preserving their folder paths; OR
2. From the repository root run: git apply --check /path/to/town-character.patch
   Then: git apply /path/to/town-character.patch
Do not copy the files and apply the patch together.

No SQL, dependencies, new images or GLBs are needed. Native city presentation and
building previews only. The strategic map's settlement models, painted village,
walls, gates, resource sites, game rules and saved state retain their behaviour.
Flowers, lanterns and resident activity from V19.11 remain in place.
This package has not been pushed or deployed.

VERIFICATION
- Production build (TypeScript/Vite and artwork checks): passed.
- Unit suite: 473 passed, 1 skipped, zero failures.
- Desktop/mobile browser checks: 30 passed,
  4 existing project-specific skips, zero final failures.
  Coverage includes projected clicks on the new buildings, compact previews,
  empty lot selection, camera controls, gates, resources, city switching,
  reduced motion, recruitment and battle-model training.
- Asset tooling: 5 passed; 46 registered GLBs and 33 Rally Point paintings verified.
- Native model bounds and five-stage geometry verified for all eleven factions.
  Visual review included Roman levels 1/3/5, Orc levels 3/5, Pandaren, Dwarf,
  Undead, Egyptian and Elf cities, plus phone framing and rotated views.
- Diff and patch checks passed. Rendering frame rate was not benchmarked.

TOWN_CHARACTER_MANIFEST.json records source and patch hashes.
