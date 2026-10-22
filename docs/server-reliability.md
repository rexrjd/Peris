# Server reliability and shared clock

This review branch separates battle progression from owner settlement, defers busy participants, rotates failed work, reduces background requests and retries temporary ruler-state reads without entering the account again. Existing automatic combat rules, command receipts and result guards remain authoritative.

The shared clock defaults to 1x. Engine projections, gameplay deadlines and accrual use game UTC. Authentication, audit/social dates, polling, worker scheduling and database budgets use real time. A single backend still represents one world.

## What this does and does not establish

The old worker's starvation and locked-owner timeout were reproduced in disposable databases. The new scheduling and rollback paths have isolated regression tests. Hosted historical HTTP500/57014 incidents have several possible causes; local passing checks alone do not prove those production incidents are resolved. No live SQL, hosting region, database limits or production accounts are changed by this branch.

Worker budgets are soft: they stop starting another item after the budget. A single combat item may exceed it, and a hard statement cancellation rolls back that transaction. Combat retains its existing ten-game-second processing cap and every unprocessed second of debt. At 100x, a ten-real-second scheduler interval creates 1000 game seconds of debt; the existing cap cannot clear that per visit. The clock is a prerequisite for acceleration, not evidence that 200 bots at 100x can run yet. Measure compute, lag and scheduling before that experiment.

Snapshots currently perform activity/science/city initialization writes. Treat them as potentially contending operations, not read-only queries. No history was capped or deleted to improve benchmark results.

## Local setup and checks (PowerShell)

Normal game and PGlite checks need the existing Node setup:

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd test
npm.cmd run test:unattended-db
npm.cmd run test:battle-atomicity-db
npm.cmd run test:clock-db
npm.cmd run test:clock-gameplay-db
```

True lock/cancellation tests additionally need a **local PostgreSQL 17** server and `psql` (portable binaries work). Use a fresh empty database for each initialization. These tools refuse remote hosts and databases whose names do not start with `peris_test_`. They never accept the production Supabase URL.

```powershell
# Create these empty databases in your local PostgreSQL first.
$env:PERIS_PSQL_PATH = 'C:\path\to\PostgreSQL\17\bin\psql.exe'
$env:PERIS_TEST_DATABASE_URL = 'postgresql://LOCAL_USER:LOCAL_PASSWORD@127.0.0.1:5432/peris_test_concurrency'
npm.cmd run test:server-concurrency

# A different empty database; initializes five synthetic accounts/history.
$env:PERIS_TEST_DATABASE_URL = 'postgresql://LOCAL_USER:LOCAL_PASSWORD@127.0.0.1:5432/peris_test_load'
npm.cmd run check:server-reliability -- --initialize --minutes=10
```

Do not put real credentials in source control or screenshots. Keep the PC awake. Ctrl+C asks the probe to stop and write its partial report after in-flight requests finish. Output is `reports/server-reliability/<UTC-run>/report.md` and `report.json`. The JSON records build/dirty status, workload, hardware, PostgreSQL version, errors, payload sizes, latency distributions, query plan and game-time lag. Credentials are omitted. Shorter runs (`--minutes=1`) are diagnostic only; they do not meet the ten-minute acceptance duration.

The probe uses five independent **psql clients**, not browser bots or the Supabase HTTP gateway. It includes process-startup overhead. Setup creates barracks/history in the isolated fixture; paid queue actions and runtime sync/read/worker functions then use the real game SQL. Synthetic reports are labelled and are not claimed as played battles. Repeat initialization refuses nonempty databases. Use the ordinary browser suite separately for UI coverage.

## Clock integration rules

- Call `engine.nowGameMs()` in runtime gameplay and pass explicit time into domain functions. Pure domain helpers use an injected world instant rather than a browser clock.
- Use `peris_game_now()` inside authoritative SQL gameplay functions. It is stable for the entire transaction.
- Store accepted duration once in game seconds. Show real countdowns by dividing remaining game time by the fixed rate once.
- Keep production at 1x. `peris_configure_test_clock(10|100)` is private operator-only setup for an empty disposable backend; it refuses a world with players. There is no accelerated campaign import or live rate change.
- Edit `supabase/modules`, then regenerate with `npm.cmd run build:sql`, `build:report-reads`, and `build:camp-artifact-upgrade` when those installers change. Run their matching `check:*` commands.
- Preserve all troop pools: active armies/formations, raid reserves, field stations, permanent city garrisons and ruin evacuations. The partner's allied-defence work must retain per-owner provenance too.

See [partner handover](partner-allied-defence-handover.md). Final verification results are recorded separately; commands listed here are instructions, not claims that they passed.
