PERIS V19.9 - CITY WALLS AND WORKING RESOURCE SITES
Base: rexrjd/Peris main 9bcd43041c26df515c762ead8e563be3fea3bb27
Checked against origin/main on 2026-10-17. This base includes V19.8's compact
building inspector. The archive contains only this update's changed files.

INSTALL
Copy the src/ and tests/ folders and ARTWORK.md into your project, preserving paths.
Alternatively apply city-walls-resources.patch from the matching base checkout:
  git apply --check city-walls-resources.patch
  git apply city-walls-resources.patch
Use either copying or the patch, not both. Review overlaps if main advances.
Run npm ci and npm run build. No SQL or new external assets are required.

DESIGN
Two visual passes refined the native 3D city:
- Thicker walls, stone foundations, spaced buttresses, wall walks and access steps.
- A front twin-tower gatehouse and open river arches instead of abrupt wall gaps.
- Timber palisades at early levels; stone fortifications at later levels.
- Lower foreground walls preserve a clear view of the city.
- Sawmill with a cutting shed, flywheel, bark-on logs and timber stock.
- Terraced quarry with cut stone faces, lifting crane, block stacks and a cart.
- Farm with a barn, rotating windmill, silo and denser fenced golden crop rows.
- Fishing hut, covered landing, dock equipment and a moored boat.
- Five completed resource stages using all eleven factions' palettes and roofs.
- Soil working yards replace the identical paved resource courtyards.
- Equipment respects reduced motion; city resource thumbnails match the models.

COMPATIBILITY
Existing city coordinates, growth, wall footprint, slots, service roads, resource
production, construction costs and saved state are preserved. Resource buildings
remain outside the wall. Strategic map field models and painted village art are
unchanged. Static parts remain batched by material; this is not an FPS benchmark.
No database changes or live deployment have been performed.

VALIDATION
- TypeScript and production build passed, including artifact/research art checks.
- Full unit suite: 465 passed, 1 skipped; no failures.
- Browser regression suite: 22 passed, 4 expected skips; no failures/flaky cases.
  Includes real resource geometry selection, camera controls, city panels,
  WebGL fallback and the existing compact building inspector on desktop/mobile.
- Tooling: 5 passed. Asset checks: 46 registered GLBs and 33 Rally paintings passed.
- Automated clearance checks cover all city growth stages and all 11 factions.
- Visual inspection covered zoom, rotation, phone framing and faction variants.
- ZIP CRC, file hashes, whitespace and patch application checks passed.
