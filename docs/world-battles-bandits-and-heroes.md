# World battles, bandits and heroes — V12

Based on checked main revision `a82e532f9e0c2d4a8834e3571c9f427bce3d9e76`. This package includes the previous automatic-battle compatibility merge and the housing-constraint fix. The existing faction GLBs, quick battle faction selection, map geography, multiplayer privacy and independent cities/armies are preserved.

## Gameplay

- Battlefield area is exactly five times the old 1200×700 arena: approximately 2683×1565 logical units. Army deployments remain around the centre, preserving troop scale, weapon ranges and march speeds while adding flanking and retreat space.
- Campaign encounters use their camp's actual world cell; accepted duels use the defending army's cell. Forest maps contain woods, mountain/stone maps contain rocky high ground, and rivers contain matching slow shallows plus a dry stone crossing. Farmland, desert, snow, marsh, coast and darklands have their own ground palettes and scenery.
- 605 camps cover roughly 1.6% of land fields. Their locations, IDs, race and troop mix are seeded and agree between solo and multiplayer. They avoid protected starting rings, existing towns/claims during migration, sea and neighbouring camps. All eleven factions appear; roughly 70% of camps are tier 1–2.
- Winning a raid yields resource spoils and 2 hero XP per enemy casualty plus 50 victory XP. Casualties remain permanent. A camp regroups after ten minutes for that ruler. Reports and XP settle once, even when a tick or finish is repeated. Limited first-clear artifact drops use tier-appropriate equipment.
- Campaign sites 1–6 remain the six standards. Farming bandits cannot trigger the campaign ending or replace a campaign briefing.
- Army map markers display commander faces. The same artwork appears in army and hero panels. Existing map unit models remain underneath those markers.

## Portraits

Ten original painted PNGs live under `public/art/heroes/`: Roman, Spartan, Persian, Egyptian, Elf, Dwarf, Gnome, Pandaren, Undead and Demon commanders. Orcs retain original geometric portrait artwork. Faces are faction-based and shared by heroes of that faction; a portrait-picker is not part of this update.

The built-in image generation tool produced the pictures. `assets/hero-portraits.json` contains the prompt set and file paths. The set takes inspiration from classic painted fantasy strategy portraits while using original characters, no borrowed game images.

## Installation

Copy the included files into the matching repository paths. Run `npm ci`, then `npm run build`.

For an existing Supabase world, run `supabase/UPGRADE_TO_V12.sql` once in its SQL editor. For a completely empty database, use `supabase/FRESH_INSTALL_V12.sql`. The migration keeps housing valid throughout, preserves gameplay state, and can be rerun. Complete older bundle aliases contain the same current modules. Feature-only historical SQL fragments should not be applied afterward.

No live SQL, commit, push or deployment was performed.

## Verification

Unit tests cover deterministic camp generation, all factions, starting-ring separation, wrapped city protection, campaign separation, repeated XP settlement, save migration and portrait assets. Automatic battle simulations cover all ten land biomes. Isolated database checks compare every camp and terrain effect between client and server, exercise repeat raids, and rerun V12 upgrades.

291 unit tests pass, with one existing skip. Production build, four tooling checks, 46 registered model checks, generation checks and the affected automatic, general, fresh, map, magic, empire and housing database suites pass. Server-side React rendering also exercises every generated camp inspector.

Browser end-to-end execution is blocked here: the expected Playwright Chromium executable is absent, and the alternate runtime does not start in this environment. Actual screenshot/pointer verification remains necessary locally. Run `npx playwright install chromium`, then `npm run test:e2e`; the new encounter test covers face-marker selection and bandit inspection. Desktop/mobile frame-rate targets have not been measured.
