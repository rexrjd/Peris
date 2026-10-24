# City capture verification

Implemented on `review/city-capture`, based on `f045b39`. Only the active root app is changed. No push, merge or database deployment was performed.

## Behavior

- Loyalty begins at 100 and recovers 25 per game hour. Victory with surviving participating diplomats lowers it by one each, capped at 25. Dead diplomats and unsent reserves cannot persuade.
- Diplomacy unlocks Main building level 2 training. Each faction has a civic title, original SVG portrait and native instanced battle geometry, with Canvas support. Prices are 100 times infantry.
- Culture eligibility and pending colony reservations use the settling rules. Culture is charged once when loyalty reaches zero. All cities can be captured, including a ruler's last city.
- Capture retains development and fields, consumes one diplomat to establish government and leaves the victorious army occupying the city. Former-owner troops evacuate or disband on defeat. Queues and ownership-sensitive arrivals cannot grant the conqueror foreign soldiers or refunds.
- Account research faction stays stable across capture. Rival map snapshots do not expose loyalty. Legacy saves gain defaults and older servers hide the new capability.

## Recorded checks

Logs are under the ignored local `artifacts/` directory.

- `npm test`: 628 tests, 627 passed, zero failures and one existing skip. Final counts recorded in `capture-unit-final.log`.
- `npm run test:tooling`, `npm run assets:check`, `npm run build`: pass. Build retains the existing large-chunk advisory.
- `npm run check:sql` and `npm run check:world`: generated bundles and geography match source.
- `node --import tsx tests/city-capture-database.test.mts`: passes at 1×, 10× and 100×, including defended victory, routed/dead diplomats, culture reservations, last-city defeat, owner changes, private helpers, transport/settler ownership, replay and repeated capture/crop/logistics upgrades.
- Affected isolated suites pass: unit balance (220 stat combinations, 110 recruitment batches), army role operations (all ten roles), city raids, city logistics, guild reinforcements, crop upkeep, research, factions and automatic trade routes. Individual results are in `capture-*-db-final.log` and `capture-unit-balance-db.log`.
- `npm run test:e2e -- tests/e2e/city-capture.spec.ts`: eight desktop/mobile cases pass. Recruitment and Diplomacy linking use the live 3D City. Shared-world review submits an exact party and displays the server's final capture receipt; old-server gating is checked. Native battle and Canvas identity are exercised separately, preserving quiet city-raid behavior.
- Inspected desktop/mobile capture review, report, recruitment/dossier and battle screenshots. A final targeted battle rerun verifies the corrected faction title; logs/screenshots are in `capture-presentation-e2e-final.log` and `artifacts/capture-presentation-browser/`.

## Limits and release

The browser shared-world fixture uses isolated PGlite and fake authentication; it never connects to production. Database suites do not verify independent PostgreSQL sessions or production lock contention. No new GLBs or Blender exports were created; no Blender verification is needed for this procedural artwork. Frame-rate targets were not benchmarked.

The separately reviewable `supabase/UPGRADE_CITY_CAPTURE.sql` applies after the current V19, Crop Upkeep and Market Routes updates. It is generated from modular SQL and tested for reruns. It remains undeployed; the shared server advertises `conquest_version:1` only once the capability is installed.
