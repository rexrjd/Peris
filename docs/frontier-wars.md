# Frontier Wars — first playable milestone

Frontier Wars is a new mode in the existing Peris application. Open it from the
launcher or `/?frontier=1`. Campaign, Quick Battle, Shared world, faction models,
artwork and browser saves keep their existing behavior. Frontier has its own local
realm; it does not import, overwrite, or deploy to the existing Supabase world.

## Start and play

Use Node 20.19+ (tested here with Node 22.11). In the **Git checkout**, run:

```powershell
cd C:\Users\kjksz\Documents\GitHub\Peris
npm.cmd ci
npm.cmd run dev:frontier
```

Open **http://127.0.0.1:5174/?frontier=1**. This command starts Vite on 5174 and
the local authority on 8787. It needs no paid service, API key, Docker, or Supabase
configuration. Keep the terminal and computer running; the browser may be closed.
Ctrl+C stops the development processes. Restart the same command to resume.

1. Name your village and choose any of the eleven existing factions.
2. Choose **Barracks**, **Stables**, or **Workshop**. Basic infantry, archers and
   light cavalry are ready immediately. Research other units, then recruit them.
   Costs are paid when ordered; units arrive only when training finishes.
3. Select a low camp. Compare its stock, garrison, production and route distance.
   Its displayed intelligence can change before your army arrives.
4. Enter a troop allocation and send the raid. Those troops leave your garrison.
5. Arrival automatically resolves the existing AI battle rules. A victorious force
   takes stored resources up to its survivors' carrying capacity. Defeating troops
   gives **no additional resource bounty**. Defenders that survive a rout remain.
6. The surviving force travels home. Only then are troops and carried resources
   credited to your village. Expand the camp's report group, then a report row, to see casualties,
   replacement costs, delivery, storage overflow and estimated profit.
7. Use **Quick access → Farm lists** to create a named list. Choose whether it
   should show every report or only reports with losses among **your** troops.
   In a camp's **Save to farm list** panel, choose that list and save a troop preset.
   Enable a repeat interval when
   ready. Every scheduled launch must have the actual troops at home; an
   unavailable preset is skipped and shown in the list. Different rows compete
   for your same garrison. New schedules first run after their selected interval.

## Quick access, farm lists and reports

The **Quick access** button is available in both Frontier Wars and the existing
campaign. In Frontier it opens Barracks, Stables or Workshop recruitment tabs,
and jumps to Farm lists, Storehouse (resources/capacity), Camps, Army movements,
and Reports. The resource strip stays visible as you scroll. Building upgrades in
Frontier remain a later milestone; these shortcuts use its existing controls.

In the campaign, shortcuts open the selected city's barracks, stables, warehouse,
granary or main building. An unbuilt building opens a free plot with that building
selected, without spending resources; a full city opens the main building instead.
Recruit troops and Reports open the existing army and chronicle screens. The
campaign's Farm lists link opens **Frontier Wars's separate village**. Run
`npm run dev:frontier` to serve both interfaces and the local farm authority.

Each named list groups multiple saved camp targets. Targets keep their own troop
presets and intervals. Enable/Pause list changes all of its schedules; enabling an
already-enabled target leaves its next departure unchanged. One village can save
each camp once, and move that target between lists from its preset editor. This
avoids accidental duplicate schedules. Existing saved targets migrate into a
**Saved farms** list with all reports enabled, preserving their timers and presets.

Choose a faction-specific troop mix when creating or editing each list. **Use
[list name] troop preset** copies that mix into a target's raid editor; review and
save it there. **Apply preset to N targets** explicitly updates every target in
that list without changing schedules or armies already travelling. Editing the
list preset alone preserves existing target overrides. New quantities do not
reserve troops until departure. Missing advanced counts in old saves mean zero.

## Recruitment buildings and troop icons

Every faction now has nine distinct Frontier inventories, using its existing names
and artwork. Barracks contains line infantry, spear guards, archers and elites;
Stables contains light cavalry, mounted scouts and heavy cavalry; Workshop contains
rams and catapults. The three starter classes remain unlocked for compatibility.
Research is a one-time resource cost and persisted completion time for each village.
Each building has separate serial research and training queues, which continue
while the browser is closed and catch up after a server restart. Research does not
create troops. The authority rejects recruitment until the unlock is complete.

The nine-cell faction atlases supply 99 reusable mini icons and larger recruitment
portraits. Selectors, saved lists, queues, movements and reports use the same icon
and accessible unit name. No artwork is replaced or copied from Travian.

Advanced units use separate formations in the existing automatic battle simulator,
with their own attack/defence factors and speed; casualties keep their original
unit identities. Scouts are fast light riders for now; dedicated scouting missions
are future work. Siege units participate in combat but carry no loot; wall/building
damage is future work. These additions apply to Frontier only; the existing
campaign's recruitment and economy are unchanged.

**Show reports only when my troops are lost** is unchecked by default. Set it when
creating a list or change it directly on that list afterward. It hides casualty-free
scheduled raids, even if enemy defenders died. Losses and total defeats remain
visible. Manual raids and reports predating this feature remain visible. Changing
the preference filters earlier results from that list too; moving a target does
not reassign its earlier raids. Report preferences do not change loot, troop
settlement or the next departure. Every receipt remains stored, and filtering
happens before selecting the latest 50 matching reports. Removing an empty list
makes its earlier reports visible again; targets must be removed or moved first.

Farming never opens a battle viewer. Results stay in the report ledger without
popups. Army movements offers **All / Outbound / Returning** filters, countdowns,
arrival times, troop counts and carried loot. Returning armies are friendly
movements; actual incoming camp attacks remain a separate future milestone.

Ten infantry train in 20 seconds. The nearest development camp is roughly 2.4
tiles away: about 15 seconds each way for infantry. If a camp has been neglected,
check its defenders before sending such a small force. Starting camps have no
defenders or stock; both grow with elapsed server time.

To test competition, use a second browser profile or a private window at the same
URL. Each browser cookie identifies its own village; both see the **same camps**.
Reloading or restarting preserves identity when you keep the same browser profile,
hostname and cookie. Closing a private session or clearing its cookie loses access
to that test village; account recovery is not part of this local milestone.

## Saved data and configuration

The default saved database is `.peris-frontier/database` in the checkout, ignored
by Git. Stop the server before copying the `.peris-frontier` directory for a
backup. Restore into a separate data directory first. Never run two authorities
against the same directory. The process lock prevents this, including concurrent
stale-lock recovery. If a recovery lock remains after an interrupted startup,
check that no authority process owns that directory before removing only the lock.

Balance lives in `src/features/frontier/domain/balance.ts`. Values are saved when
a realm is created; restarting uses the saved configuration. Source edits do not
silently replace the saved configuration. Shared troop prices, unit speeds,
training and combat code still use the current source version. Use a **new directory** to try another balance
or seed while preserving an old world:

```powershell
$env:FRONTIER_DATA_DIR = '.peris-frontier/full-map-trial'
$env:FRONTIER_FIXTURE = 'full'
$env:FRONTIER_SEED = '1346720329'
npm.cmd run dev:frontier
```

Unset those variables or start a fresh terminal to return to the default realm.
Optional `FRONTIER_PORT` and `FRONTIER_UI_PORT` change the authority and Vite ports.
The launcher sets the matching allowed browser origins; a separately launched
authority uses `FRONTIER_UI_ORIGINS` (comma-separated origins).

| Setting | Development default | Full-map target |
|---|---:|---:|
| Low camps | 8 | 1,750 |
| Medium camps | 4 | 1,250 |
| Hard camps | 2 | 1,000 |
| Reserved village sites | 32, near the fixture | 256, spread across the world |

Placement is seeded, reproducible and unique on eligible dry tiles. It reserves
village rings and excludes existing campaign/bandit cells and protected historical
starting fields. Development camps share reachable land near the first villages.
The 200×200 wrapped world and eight-neighbour land pathfinder are reused.
The camp browser shows the nearest 120 camps plus saved targets, and the ledger
shows the latest 50 reports. Full-world browsing and report pagination come later.

## Initial balance assumptions

These are starting values for playtesting, not a proven competitive economy.
The four resource types retain their existing names and troop prices. Summing
them is only a simple comparison, not a currency exchange rate.

| Unit | Wood / stone / food / gold | Total replacement cost | New carry capacity | Strategic speed |
|---|---|---:|---:|---:|
| Infantry | 4 / 2 / 6 / 1 | 13 | 20 | 22 world units/sec |
| Archers | 6 / 2 / 5 / 2 | 15 | 15 | 18.7 world units/sec |
| Cavalry | 4 / 7 / 12 / 4 | 27 | 40 | 41.8 world units/sec |

Carry capacity is new and configurable, shared across all four resources. Loot
is allocated proportionally in whole units; fractional stock stays in the camp.
Travel starts with the existing strategic
speed of 22 and scales by the slowest present unit's existing `UNITS.speed / 40`.
Terrain detours use the real route distance; minimum travel is two seconds each
way. Starter training preserves the old times; training now queues independently
in each building. Batches take at least five seconds.
Village output starts at 14 wood, 12 stone, 18 food and 3 gold per minute.
New villages have 1,250 wood, 1,000 stone, 1,500 food and 500 gold, with capacity
5,000 each. The initial limits are 600 troops per raid, 100 active raids per ruler,
50 saved farm targets, and a minimum repeat interval of sixty seconds.

Advanced balance is centralized in `src/features/frontier/domain/units.ts`. All
factions initially share these role statistics; their names and artwork differ.
These are first playtest values, not established race balance:

| Role | Cost: wood / stone / food / gold | Carry | Train seconds each | Research seconds | Attack / defence vs class |
|---|---|---:|---:|---:|---|
| Spear guard | 5 / 3 / 7 / 1 | 15 | 3 | 30 | 0.90 / 1.20 infantry |
| Elite guard | 8 / 6 / 12 / 3 | 15 | 4 | 60 | 1.40 / 1.35 infantry |
| Mounted scout | 3 / 5 / 9 / 3 | 10 | 4 | 30 | 0.45 / 0.75 cavalry |
| Heavy cavalry | 8 / 12 / 20 / 7 | 35 | 8 | 60 | 1.45 / 1.35 cavalry |
| Ram | 20 / 15 / 15 / 6 | 0 | 12 | 90 | 0.60 / 2.00 infantry |
| Catapult | 30 / 20 / 18 / 10 | 0 | 18 | 120 | 2.40 / 0.70 ranged |

Higher combat strength costs more and usually travels slower. Scouts trade combat
strength and carry capacity for speed. Research costs are explicit in the same
catalog and shown before ordering. Camp production is unchanged by these unlocks.

| Camp | Production/minute: wood / stone / food / gold | Total/min | Total storage | Recruits/batch | Garrison cap |
|---|---|---:|---:|---:|---:|
| Low | 3 / 2 / 2 / 1 | 8 | 240 | 1–3 | 30 |
| Medium | 9 / 6 / 6 / 3 | 24 | 720 | 2–6 | 100 |
| Hard | 24 / 15 / 15 / 6 | 60 | 1,800 | 4–10 | 250 |

Each resource stores thirty minutes of production. A random batch arrives every
1–5 minutes (mean roughly three); type weights depend on tier. The authority
samples intervals with server-only cryptographic randomness, independently of the
map seed, and persists each deadline. Players receive no next-recruit timestamp,
sequence, seed or interval configuration in the API. Developers can inspect the
local database; there is no browser-side developer bypass.
Recruitment pauses at the garrison cap, then resumes 1–5 minutes after casualties
free room. This avoids processing endless no-op recruitment events during downtime.

Why start at these rates? Ten infantry carry 200 resources. An empty low camp
needs 25 minutes to produce that load; after five minutes it has at most 40.
If that trip loses one infantry, its estimated total profit is 40−13=27 before
any storage overflow. The same one-infantry casualty needs 13/8≈1.63 minutes of
low-camp production just to break even. A nearest-camp infantry round trip takes
roughly 29 seconds, yielding only about four new resources at that camp. Repeating
it rapidly with casualties is therefore inefficient. At five minutes, a medium
camp offers at most 120 and a hard camp 300, with stronger defenders; ten infantry
could carry only 200 of the hard camp's stock even if all survived.

The one-casualty examples are assumptions, not battle predictions. Composition,
terrain, morale, competing arrivals and defender growth determine actual losses.
Reports provide the measured feedback: **delivered resources − actual lost-troop
replacement cost**, per resource. They exclude upkeep, opportunity cost, and the
time required to train replacements. Routine reports are grouped, without popups
or sounds. There are no actual incoming camp attacks in this milestone.

## Authority, events and conservation

`server/frontier` is one Node authority using the existing pinned PGlite package
for persistent PostgreSQL storage. [PGlite's API documentation](https://pglite.dev/docs/api)
describes filesystem persistence and transaction rollback. The server binds only
to loopback; opaque HttpOnly cookies and server-side session records select the
owner. Private troops, queues, raids, farms and reports are filtered by that owner.
The browser sends commands, never balances, results, timestamps or routes.
Vite also blocks direct access to the saved database directory through its
[filesystem deny rules](https://vite.dev/config/server-options#server-fs-deny).
Keep database directories outside `public/`, which Vite serves as public assets.

SQL source is `supabase/modules/frontier/local.sql`; `npm run build:sql` generates
`supabase/FRONTIER_LOCAL.sql`. This is separate from existing Supabase installers;
do not paste it into the live Shared world. No existing SQL gameplay rules changed.

One scheduler drains indexed due events in bounded batches. All due times and
recruitment sequences are persisted. Camp production is calculated lazily from
timestamps; reading the page does not persist or create extra production. Events
run in chronological order, including during restart catch-up.
Stopping the server does not pause elapsed game time: overdue farm launches,
recruitment, arrivals and returns are processed when it restarts. At equal times,
research precedes training and returning raids, then camp recruitment, outbound arrivals and
farm launches. Equal-time raids use stable ID order. A large backlog is drained
before new commands are accepted, with a retry message if necessary.

Commands and arrivals share a serialized transaction queue. Each command carries
a reusable request ID; duplicate IDs with the same payload do nothing, while a
different payload using that ID is rejected. Arrival atomically deducts camp
stock, applies both sides' casualties, records loot and changes the raid to its
return journey. Return atomically credits survivors/delivery and completes the
report. A failed event rolls back and remains due. A worker thread performs the
bounded tactical simulation, keeping that computation off the HTTP event loop.
Battles settle at their strategic arrival timestamp; tactical duration is report
information, not additional occupation time. Return uses the original march
duration and route, conservatively retaining the departed force's pace.
If the combat worker itself crashes, restart the authority; a command retry
cannot revive a stopped worker. Uncommitted arrivals remain due for recovery.

Resource sources are elapsed production and initial village grants. Sinks are
recruitment costs and explicit storage overflow. Camp loot transfers existing
stock; combat never mints resources. Carry capacity is calculated after casualties.
Training moves paid recruits from queue to garrison; raids reserve garrison troops
and return only survivors. Routed living soldiers are preserved on both sides.

## Camp map, target windows and village overview

The Frontier village shows troops currently at home, production per hour, time
until storage fills, and separate outgoing/returning army counts and next arrival
times. Select a garrison row to open its recruitment building. Question-mark help
works on hover, keyboard focus and touch; unit icons show carrying capacity and
costs on hover. Returning armies are never labelled as enemy attacks.

The default camp map reuses the existing Peris 3D landscape, canonical 200 × 200
wrapped fields and camera. Low camps have open beige tents, medium camps have a
timber enclosure, and hard camps have red tents, a stockade and a timber watchtower.
Faction banners retain their colors. Terrain decorations are cleared beneath
compounds without changing elevation, field ownership or movement rules.
**Classic map** offers the compact 7, 11 or 17-field illustrated view. The automatic
Canvas compatibility view uses quiet ground and small vector terrain features,
rather than a full terrain picture on each field. Pan with buttons or arrow keys
on the focused map, enter coordinates,
or select **My village**. All development camps are loaded. Full fixtures currently
load the nearest 120 plus saved targets; the coverage note makes this limit explicit.
Distant unsaved targets and other players' villages are not shown in this slice.

This is a read-only presentation adapter over the real Frontier server snapshot,
not a second economy or a campaign save. Active raids use their actual route,
timestamps and surviving troop counts. Campaign bandits receive the new camp
models while retaining their IDs, positions and existing campaign combat rules.
The six story locations, campaign saves and field conquest remain intact.

New full realms apportion camps across 10 × 10 sectors according to eligible land
after village and legacy reservations. Seeded jitter chooses fields within each
sector; proportional difficulty allocation and a seeded shuffle preserve the exact
1,750 / 1,250 / 1,000 totals. This balances density and difficulty per land area,
not guaranteed travel times or loot. Development still uses fourteen nearby
reachable targets, with independently shuffled difficulties. Existing persisted
realms are never reset or relocated by this generator change.

Selecting a map camp, the nearby list, or a farm's name and coordinates centers
the map and opens the same detail window. It includes camp artwork, shared stock,
rates, capacity, route distance, a vertical icon/count/name defender roster
and up to five recent visible reports. **Prepare raid** opens the troop
form. **Add to farm list / Edit farm target** opens a separate editor with a list
selector, faction troop quantities, repeat interval and deactivation checkbox.
New targets are paused by default. Changing list does not silently overwrite the
target mix: **Use list troop preset** explicitly copies it. Escape closes windows
and restores keyboard focus.

Each list sorts by target name, route distance, combat result, last raid, last
delivered loot, all-time delivered loot or next departure, in either direction.
Missing results and paused schedules sort last. Combat ordering is defeat, draw,
victory with losses, then victory without losses. Select one or more targets to
move or delete together; edit an individual target to move it by changing its list.
Moves preserve troop presets, counters and departure times. Editing troops alone
also preserves the schedule; changing the interval or enabling a paused target
starts its next interval. Deletes stop future departures; existing raids finish.
These commands are owner-checked, transactional and safe to retry.

Farm summaries use the owner's completed raid records, including quiet reports
and records beyond the latest report page. Totals are resources actually delivered
after overflow, never the camp's current stock or a defender-kill bounty. Historical
raid report preferences retain the list association captured at departure.
Farm targets are camps in this milestone; PvP village farming requires its own
combat, permissions and privacy design before it can be enabled.

### Manual batches and cancellation

**Start list** opens a review of its saved targets and troop presets. Confirming
starts a single batch in saved creation order, including paused targets, without
changing their enabled flags or next scheduled times. Each successful party
reserves actual available village troops in the same transaction. Invalid targets,
troop shortages and active-raid limits become saved skipped statuses. A repeated
request receipt cannot dispatch the batch twice. These raids retain their list's
report preference, including the casualties-only setting.

Sending a single raid also opens a confirmation before dispatch. All new raids,
including repeats, wait 30 seconds before departure. **Cancel raid** is available
in Marches until the original deadline, then disappears. The server enforces that
cutoff and restores the reserved party once by adding it to the current home
garrison; concurrent recruitment or other orders are preserved. Reloading or
restarting never extends the window. Cancelling one raid leaves future repeat
schedules alone. Incoming returners are still your own troops, not attack alerts.

### Campaign legions and saved targets

Campaign **Quick access → Farm lists** manages real campaign bandit targets.
Selecting **Add to farm list** from a bandit inspector saves a list, legion and
three-class troop preset. **Start list** reviews a manual batch; each available
legion can carry one party, so additional targets assigned to that legion are
skipped while it is away. **Prepare raid** reviews one target. The six story
locations remain outside farm lists.

Campaign raids record their owned departure station, put unsent troops in a
private location garrison and return survivors along the actual route. An idle
legion at that station can collect troops; returning survivors merge with troops
still there, up to the legion cap, leaving overflow stationed. Recruitment must
finish before collecting or departing. Ordinary movement stops only on owned
villages/fields. Preserved neutral-position armies can relocate home. Strategic
alliances have no membership authority yet, so unrelated villages cannot receive
reinforcements. Campaign bandit battles resolve without opening an animation or
automatic result modal; their reports are available in the Chronicle.

Campaign farm metadata and station troops persist in solo saves and in private
Supabase snapshots. Apply the regenerated **UPGRADE_TO_V13.sql** to an existing
shared world before using its new commands; fresh installers are only for empty
databases. This work does not deploy SQL. The campaign retains its existing
troop classes and victory rewards; Frontier's shared production/stock economy,
nine-unit roster, automatic repeats and list report filtering remain separate.

## Verification and next milestone

```powershell
npm.cmd test
npm.cmd run check:frontier
npm.cmd run test:frontier-server
npm.cmd run test:tooling
npm.cmd run check:world
npm.cmd run check:bandits
npm.cmd run check:sql
npm.cmd run test:db
npm.cmd run test:fresh
npm.cmd run assets:check
npm.cmd run build
npm.cmd run test:frontier-ui
```

The server suites use isolated in-memory/disk databases and controlled clocks.
They cover resource and troop conservation, simultaneous arrivals, retry
idempotency, chronology, farm troop shortages, transaction rollback, restart
persistence, session isolation, named-list migration, independent report preferences,
filtering before pagination, all-time farm summaries, atomic bulk moves/deletes,
unchanged schedules, and the real combat worker. The Frontier browser
suite starts a separate disposable authority and checks desktop/mobile recruitment,
raid return, reports, named lists, independent checkboxes, quick shortcuts, map and
farm-link windows, wrapped map navigation, sorting, target edits/moves/deletes,
accessible overview help and reload.
The campaign quick-access browser test also covers building navigation and keyboard
closing on desktop/mobile. Install Chromium with
`npx.cmd playwright install chromium` if missing. Browser-launch failures occur
before application assertions and must be reported separately from passing tests.
On Windows, if downloaded Chromium cannot launch but Edge is installed, use
`$env:PERIS_BROWSER_CHANNEL = 'msedge'` before either browser test command.

This is a local playable slice, with public camp intelligence, nine recruitable
roles, one-time research unlocks and no hero bonuses. Planned expansion:

- Dedicated scouting, village development in this mode, PvP village farming,
  more balance playtests and loading map camps by viewport beyond the nearby snapshot.
- Neglected-camp attacks within twenty tiles, with configurable strength
  thresholds and prominent actual incoming-attack notices. Keep their events
  separate from camp production and ordinary raid reports.
- Public deployment with account recovery, rate limits, shared PostgreSQL
  infrastructure, worker coordination, metrics and retention rules.
- Load tests with thousands of travelling raids; indexed queues and bounded work
  are preparation, **not evidence of that capacity**. Alliances and territorial
  objectives follow the stable farming loop.

Before **every push**, fetch and inspect `origin/main`, integrate partner changes
on the review branch without overwriting either person's work, resolve overlaps
and rerun affected checks. Never force-push main.

### Map navigation and artwork

Frontier supports left/middle mouse drag and one-finger drag, wheel zoom, arrow
buttons/keys and coordinate search. The map wraps at world edges; dragging does
not open a camp. Three original military silhouettes identify the tiers, separate
from village artwork. The existing 3D global map, Canvas compatibility map, preview
and campaign territory rules are preserved. Global dragging also works in March
mode without dispatching troops; only a click confirms a destination. Frontier
territorial conquest remains a later milestone.
