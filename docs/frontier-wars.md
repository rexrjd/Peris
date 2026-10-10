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
2. Recruit infantry, archers, or cavalry. Village resources pay the existing troop
   prices immediately; troops become available only after training finishes.
3. Select a low camp. Compare its stock, garrison, production and route distance.
   Its displayed intelligence can change before your army arrives.
4. Enter a troop allocation and send the raid. Those troops leave your garrison.
5. Arrival automatically resolves the existing AI battle rules. A victorious force
   takes stored resources up to its survivors' carrying capacity. Defeating troops
   gives **no additional resource bounty**. Defenders that survive a rout remain.
6. The surviving force travels home. Only then are troops and carried resources
   credited to your village. Expand the camp's grouped report to see casualties,
   replacement costs, delivery, storage overflow and estimated profit.
7. Save a target and troop preset in the farm list. Enable a repeat interval when
   ready. Every scheduled launch must have the actual troops at home; an
   unavailable preset is skipped and shown in the list. Different rows compete
   for your same garrison. New schedules first run after their selected interval.

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
way. Training reuses `recruitSeconds(unit, quantity, 1)` and one serial queue.
Village output starts at 14 wood, 12 stone, 18 food and 3 gold per minute.
New villages have 1,250 wood, 1,000 stone, 1,500 food and 500 gold, with capacity
5,000 each. The initial limits are 600 troops per raid, 100 active raids per ruler,
50 saved farm targets, and a minimum repeat interval of sixty seconds.

| Camp | Production/minute: wood / stone / food / gold | Total/min | Total storage | Recruits/batch | Garrison cap |
|---|---|---:|---:|---:|---:|
| Low | 3 / 2 / 2 / 1 | 8 | 240 | 1–3 | 30 |
| Medium | 9 / 6 / 6 / 3 | 24 | 720 | 2–6 | 100 |
| Hard | 24 / 15 / 15 / 6 | 60 | 1,800 | 4–10 | 250 |

Each resource stores thirty minutes of production. A deterministic random batch
arrives every 1–5 minutes (mean roughly three); type weights depend on tier.
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
training precedes returning raids, then camp recruitment, outbound arrivals and
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
persistence, session isolation, and the real combat worker. The Frontier browser
suite starts a separate disposable authority and checks desktop/mobile recruitment,
raid return, reports, saved schedules and reload. Install Chromium with
`npx.cmd playwright install chromium` if missing. Browser-launch failures occur
before application assertions and must be reported separately from passing tests.
On Windows, if downloaded Chromium cannot launch but Edge is installed, use
`$env:PERIS_BROWSER_CHANNEL = 'msedge'` before either browser test command.

This is a local playable slice, with public camp intelligence, existing troop
classes and no hero/research bonuses. Planned expansion:

- Dedicated scouting, village development in this mode, more balance playtests,
  and strategic-map presentation using the existing renderers.
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
