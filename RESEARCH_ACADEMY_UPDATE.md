# Peris — account science and technology tree (V18)

## Install

This changed-files package builds on main commit `980b6df`. Extract its contents
into the root repository, preserving the relative paths. The active app is `src/`;
legacy `src/src/` and `peris-starter/` copies are not modified.

**Apply the complete `supabase/UPGRADE_TO_V18.sql` in Supabase SQL Editor before
deploying the frontend.** It preserves accounts, cities, existing orders, armies,
heroes, equipment, reports, world coordinates and legacy unit research. Use
`FRESH_INSTALL_V18.sql` only for an empty database; its existing-world guard remains.
The migration is rerunnable with Academy rows and completed research present.
No production SQL, website deployment or remote Git push is performed by this patch.

Then run `npm ci`, `npm run build`, and deploy through the existing workflow.

## Play

Research joins Map, City, Rally Point, Armies and Reports in the compact top bar.
The default picture is an original low-poly book and armillary sphere. While a
technology is active its own picture replaces it, with a thin progress indicator.

The separate tree contains five eras, linked prerequisites, branch and status
filters, search, zoom, mouse dragging, and native touch scrolling. Select a card
to see its actual bonuses, science cost, time, prerequisites and research action.
Every branch can eventually be completed. No mutually exclusive choices are imposed.

There are **210 technologies**: 100 shared discoveries across ten branches, plus
ten heritage discoveries for each of the eleven existing factions. An account sees
its shared tree and its own heritage. Roman, Spartan, Persian and Egyptian humans
retain their separate identities alongside Orc, Elf, Dwarf, Gnome, Pandaren, Undead
and Demon factions.

Academies can be built repeatedly in any ordinary empty city plot. Each has five
levels. Science production is pooled across all owned cities, never per city.

| Academy level | Science / minute |
|---|---:|
| 1 | 12 |
| 2 | 28 |
| 3 | 48 |
| 4 | 72 |
| 5 | 100 |

Independent scholars provide 6 science/minute and accounts begin with 75 points.
Empire science bonuses apply to the total. Points accumulate both while studying
and while idle, up to one billion. Click the science balance to inspect sources or
open Academy construction.

One project runs per account. Starting pays its full point cost once; time is a
separate requirement. Pausing or switching stores elapsed work. Resuming does not
charge again. Accepted research, building, training and travel timings persist.
New speed bonuses apply when a new order or resumed study is accepted. Offline
settlement changes production exactly at completion; Academies yield nothing
while their first level is under construction.

## Bonuses with gameplay effects

- Account unlocks for Spearmen, Scouts, Elite Infantry, Heavy Cavalry, Rams and
  Catapults. Existing completed city unit studies still unlock their old units.
- Troop attack and defence, including infantry, archery and cavalry branches.
  These are captured in formation statistics when a battle starts and preserve
  separate hero, smithy, terrain and spell modifiers.
- Faster recruitment and internal/external construction; preview times reflect
  the same modifiers used by accepted commands.
- Timber, stone, gross food and gold production; staffing, population growth and
  food consumption retain their existing rules. Research does not reduce upkeep.
- Warehouse and granary capacity, culture production and hero experience.
- Faster marches, more carried loot, spell strength and mana capacity.
- Trading-post income from the existing external field economy. This does not
  add a player-to-player trading service.
- Stronger rams and catapults, retaining the existing two-level maximum damage per
  assault. Academies are valid catapult targets; damage lowers their science yield.

The account faction follows its first city. Changing that faction keeps discoveries
and paid progress. Only its current heritage bonuses apply; an incompatible
active heritage study pauses. Shared research remains available.

## Persistence and compatibility

Science and progress live in private owner-scoped Supabase tables. Public player
and map listings do not disclose another account's science or technologies.
Commands use the existing retry receipt system so a lost response cannot debit
science twice. Owner-filtered realtime and normal polling update the client.
The existing private game worker includes due research projects, allowing completion
without an open browser when that worker is scheduled. Login also settles overdue work.

Every historical generated migration accepts the Academy building type. This avoids
the earlier building-type constraint failure when a newer world reruns an older
bundle name. Current friend changes to the map, army roles, Rally Point, reports,
raids and village artwork are integrated at the unchanged latest-main baseline.

## Artwork and sources

All 210 technologies have distinct transparent 192px WebP pictures. Academies have
eleven original faction paintings and an additional Roman master-stage painting;
native 3D Academies have five different geometry stages for every faction.

The 23 original generated PNGs are included under `assets/source/research-v1/`.
`assets/research-v1.json` records their ownership, source mapping and atlas order.
These originals were recovered from the previous generation session; no other
game's screenshots or assets are shipped. `npm run build:research-art` reproduces
the crops without redrawing them. `npm run check:research-art` verifies sizes,
alpha, unique pictures, faction counts and the prerequisite graph.

Edit `src/features/research/domain/catalog.json` to adjust names, costs, timing or
effects. `npm run build:research-catalog` generates the server catalog from that
same source, and `npm run build:sql` rebuilds all deployment bundles.

## Verification

The patch includes research domain and authoritative database regression tests for
costs, switch/resume, deadlines, offline income, prerequisites, faction ownership,
repeatable Academies, saved boosted formations, source/catalog parity, private RLS,
worker completion and migration reruns. Existing gameplay, tooling, asset, world,
population, raid and army-role checks are also exercised. Browser tests cover the
new tree, loaded artwork, progress, persistence and Academy actions at desktop,
mobile and narrow widths. Build and verification outcomes are reported with delivery.

## Push handoff

This package includes the recovered Academy styling and navigation cleanup. Read `PUSH_NOTES.txt` for the exact verification achieved and the remaining isolated browser-suite check. No remote push or production migration has been performed.
