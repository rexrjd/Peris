# Server reliability and shared clock implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task, with test-driven development and verification-before-completion. Native execution preserves the user's low-usage preference.

**Goal:** Keep normal-world progression responsive and recoverable, and give every gameplay system one authoritative time source before introducing an accelerated test world.

**Architecture:** Retain the existing SQL-authoritative engine and automatic battle rules. Repair worker scheduling and request recovery first; introduce an anchored virtual game clock with a fixed rate per backend, defaulting to 1x. Elapsed gameplay time and real operational time are separate.

**Tech stack:** Existing TypeScript/React/Three.js, PostgreSQL 17, Supabase, PGlite 0.3.10 and Playwright 1.64.0; no new production service.

**Spec:** [Approved work division, A1/A2](../specs/2026-10-22-core-game-work-division.md). This plan supplies the concrete interfaces for those work packages.

**Status:** Approved by the user on 22 October; implementation in progress. Baseline: main 7f933205db48cdacdab42101e6637d0e89e7290d. Review branch: feat/server-clock-foundation.

**Implementation update:** Core worker, recovery and clock changes are implemented and received a fresh review. Main through `0edf013` was integrated, preserving its own-city logistics. See [actual verification and remaining limits](../evidence/2026-10-22-server-clock-verification.md). The user subsequently asked to stop broad rechecking of the partner's UI; focused account/clock checks remain in scope. Full accelerated capacity and exhaustive per-mode fault matrices are not claimed complete.

## Plain-language sequence

1. Prevent a broken account or a busy battle from holding up everyone else.
2. Reuse the existing polling fix and make temporary load failures recover without losing the player's identity or repeating an uncertain command.
3. Add the clock at 1x, preserving current dates and orders.
4. Connect production, travel, construction, recruitment, research, camps and battles to it; verify equivalent accounting at controlled 1x/10x/100x times.
5. Measure contention and response times in an isolated backend. A correct clock does not prove capacity for 200 bots at 100x.

## Global constraints

- Preserve player data, password protections, name-only legacy access, saves, eleven factions, existing receipts, wall/garrison/ruins rules and automatic combat order.
- AI -> movement -> simultaneous damage -> morale/routing -> resolution remains unchanged. No skipping combat to clear a backlog.
- Edit SQL source in supabase/modules; regenerate bundles with npm.cmd run build:sql. No production deployment, world reset, merge or force push.
- Keep normal worlds at 1x. Configure 10x/100x only before creating players in a separate disposable backend; no hot speed changes.
- Do not raise request timeouts, suppress errors or weaken checks to claim a fix.
- Partner owns allied reinforcement features. Coordinate shared snapshots, command routing, SQL manifest/generators and finalizers before editing overlapping sections.

## Evidence and limits

The current-main isolated diagnostic reproduced starvation: two calls to peris_game_tick(1) both returned processed=0 and both eligible battles stayed at elapsed=0 when the oldest owner had an invalid field order. Removing only that order allowed the next two calls to advance each battle by 10 game seconds. The fixture deliberately corrupts isolated setup; it does not claim normal player commands can create that order.

See [machine-readable baseline](../evidence/2026-10-22-server-clock-baseline.json) and [disposable probe](../evidence/probes/2026-10-22-worker-starvation.mjs). PGlite verifies SQL behavior, not concurrent locks or hosted performance.

Earlier live evidence contains HTTP500/SQLSTATE57014 failures in snapshot/sync/map/social paths. The polling review branch reduced requests but did not eliminate the later errors. At 02:43 UTC on 22 October, live inspection found no active battles or waiting client locks and 359 successful worker jobs in the previous hour. A quiet database does not reproduce the load incident or establish its CPU/IO/lock cause.

## Shared clock contract for the partner

These interfaces are implemented on the review branch. They are not deployed or present on main through the baseline above.

- New pure module src/shared/time/gameClock.ts:
  - GameClockSample = { version: 1; rate: 1 | 10 | 100; profile_id: 'normal-v1' | 'accelerated-test-v1'; real_now: string; game_now: string }.
  - projectGameNow(sample: GameClockSample, elapsedRealMs: number): number returns parsed game_now + max(0, elapsedRealMs) * rate. Reject invalid dates, nonfinite elapsed and unsupported rates; negative elapsed clamps to zero.
  - realSecondsUntil(deadlineGameMs: number, nowGameMs: number, rate: 1 | 10 | 100): number returns max(0, deadline-now)/1000/rate.
- World gains optional game_clock: GameClockSample. server_now continues to mean current game time; absent metadata means legacy 1x.
- GameEngine gains nowGameMs(): number. Engines own receipt anchors using a monotonic browser clock; domain functions receive explicit numeric game time. Rendering, UI and command previews consume this same engine clock.
- SQL source time/game-clock.sql defines private peris_world_clock configuration and private helper peris_game_now() returns timestamptz. Map one transaction timestamp through persisted real/game anchors at the fixed rate. Private peris_clock_snapshot() returns matching real_now/game_now/rate/profile/version in the same transaction.
- Anchor formula: game_anchor + (transaction_timestamp() - real_anchor) * rate. At initial 1x installation set both anchors to the same transaction timestamp; existing timestamps need no conversion or mass rewrite.
- Current backend is one world. This adds one private clock row, not multi-world routing inside the production database.
- Installers preserve an existing row. RLS and revoked client privileges protect configuration; no player-command clock setter. A private configuration function permits accelerated profiles only while the isolated world has no players and its profile is explicitly marked accelerated-test-v1.
- New partner journeys store departure_at/arrival_at in game UTC, with unscaled rule durations. Never both divide duration by rate and advance the game clock.
- Requested arrival times/defence-call deadlines use game UTC. UI may display real remaining seconds using rate, labelled clearly.
- SQL retries, fairness timestamps, lock/statement budgets, scheduler intervals, authentication, command-receipt retention and abuse windows stay on real time.
- Gameplay cursors use game time even when named updated_at: resources_updated_at, population/culture/science accrual, research active_since, camp stock/growth, farm next_at, progress regrouping, order/travel/cancellation and battle tick/cooldown deadlines.
- Human/audit records use real time: account activity, login/security, receipt creation, social message timestamps and report creation/read timestamps. Reports retain separate battle game times; no converting virtual dates into a human wall-clock assertion.
- Solo/practice remain compatible at 1x; spectator speed/pause are separate existing battle controls, not world-clock configuration. No accelerated campaign imports in this increment.
- Preserve accepted orders and their balance versions. Existing world rates cannot change, so an accepted duration keeps its meaning.

## Review focus

1. A failing owner, locked participant or cancellation must not consume another owner's progress or partially apply results — Tasks 1 and 2.
2. A retry after commit but before HTTP response must not duplicate casualties, loot, XP, artifacts, returns or reports — Tasks 2 and 3.
3. Legacy saves/queues, permanent garrisons and ruins evacuations must retain identity and conservation — Tasks 2, 4 and 5.
4. Mixed time sources, device clock changes and applying speed twice must not alter authoritative durations — Tasks 4 and 5.
5. Large history, hidden tabs and repeated read errors must remain bounded and recoverable without leaking rival state — Tasks 3 and 6.

## Task 1: Independent, fair battle work

**Files:** campaign/game-worker.sql, new campaign/battle-worker.sql under supabase/modules; manifest.json; security/permissions.sql; tests/unattended-battle-database.test.mts; tests/helpers/unattendedBattleFixture.ts; package.json.

**Interfaces:** Preserve peris_game_tick(p_limit integer default 40) returns jsonb and its processed field. Add private peris_advance_battles(p_limit integer default 20, p_budget_ms integer default 2000) returns jsonb; private work metadata records last real attempt, next real attempt, failure count and SQLSTATE per battle.

- [ ] Write the starvation regression from the diagnostic, expecting healthy battles to advance despite the invalid owner. Add null/out-of-range budgets, failed-owner rotation and overdue ruins evacuation cases. Run with node --import tsx tests/unattended-battle-database.test.mts; observe the intended assertions fail before changing SQL.
- [ ] Implement battle selection separately from owner settlement, one eligible row at a time with SKIP LOCKED and per-item rollback. Bound attempts to one per battle per pass, select oldest attempts first and preserve unprocessed last_tick_at debt. Owner scheduling records attempts even on failure; back off persistent failures for 5,10,20,40,80,160,300 real seconds.
- [ ] Remove the redundant settlement call from worker orchestration without changing the public sync_my_state behavior. Include due ruin evacuations as owner work.
- [ ] Keep real-time soft budgets: battle pass 2000ms, owner pass 2000ms, camp pass 500ms. Stop starting items when exhausted; explicitly report that an individual item can overrun a soft budget and hard cancellation rolls back the whole transaction.
- [ ] Return processed plus attempted/failed/busy/duration counters, with no raw user data. Verify private worker tables/helpers are unavailable to anon/authenticated.
- [ ] Add npm.cmd run test:unattended-db; generate SQL, run the new suite plus test:integration-db and test:city-garrisons-db, then commit only source, generated outputs and tests.

## Task 2: Lock ordering and exactly-once settlement

**Files:** battle/peris_tick.sql, battle/peris_finish.sql, campaign/player-raids.sql, map/march-orders.sql; new battle/participant-locks.sql; tests/unattended-battle-database.test.mts; tests/helpers/unattendedBattleFixture.ts.

**Interfaces:** Private peris_lock_battle_participants(p_attacker uuid,p_defender uuid) returns boolean. Acquire necessary land reservation lock before ordered player rows; all entry points follow one reviewed order. Existing finalizer and receipt signatures stay intact.

- [ ] Add tests for ordinary camp, city raid, challenge and practice modes. Inject faults after casualty, hero reward, siege and loot writes; assert complete rollback, then successful retry and a no-op duplicate.
- [ ] Include real troops in armies, raid reserves, transient garrisons, permanent city garrisons, active formations and ruins evacuations. Assert identities/roles and per-owner conservation rather than summing army totals alone.
- [ ] Make nonblocking participant acquisition release partial locks on failure. Recheck battle status under its row lock and preserve unique report/artifact and one-time delivery guards. Never catch a cancellation as success.
- [ ] Run red/green for every new failure case. Run test:automatic-db, test:player-raids-db, test:hero-loot-db, test:command-receipts-db, test:city-garrisons-db and test:integration-db; regenerate SQL and commit.

## Task 3: Request load and session recovery

**Files:** src/engine/online/OnlineEngine.ts; src/platform/backend/polling.ts; src/platform/backend/accountLogin.ts; existing social polling files; tests/online-polling.test.ts; tests/e2e/online-polling*.spec.ts; tests/e2e/accounts.spec.ts; focused new tests/e2e/online-recovery.spec.ts.

**Interfaces:** Integrate existing commit 652faf25c4c1f44b2f28a94359310baa1d76dcf4 / PR14 against current main, resolving rather than replacing garrison/ruins changes. Preserve MutationJournal and peris_submit_command receipt protocol.

- [ ] Run the existing polling tests before and after integration. Add a failing regression for successful identity resolution followed by temporary sync/snapshot failure: retry the same session/ruler; do not turn a read failure into an expired login.
- [ ] Retain tested polling policy: idle visible10s/hidden30s, map15s/30s, social6s open/10s closed, selected conversation2s; backoff5/10/20/40/60 real seconds. Keep existing active battle/queued cadence initially.
- [ ] Treat cosmetic lookup failure separately. Preserve pending uncertain commands and use their same request ID; refreshing state never blindly resubmits an irreversible action.
- [ ] Verify one outstanding read per channel, bounded retry, recovery after HTTP500, account switch isolation and hidden-tab behavior on desktop/mobile. Run the focused browser specs with the integration config, inspect failure captures, then commit.

## Task 4: Add compatible clock metadata and pure helpers

**Files:** new src/shared/time/gameClock.ts; src/shared/model/world.ts; src/engine/contracts.ts; new supabase/modules/time/game-clock.sql; snapshot sources; manifest.json; security/permissions.sql; tests/game-clock.test.ts; tests/game-clock-database.test.mts; package.json.

**Interfaces:** The clock contract above is authoritative for this task and the partner.

- [ ] Write red tests: 1000ms real elapsed advances 1000/10000/100000ms at rates1/10/100; a 30-game-second deadline at100x is0.3 real seconds; invalid/NaN/infinite inputs fail; negative elapsed clamps; absent metadata preserves1x.
- [ ] Add the private persistent clock and helpers. Use one stable transaction timestamp per operation; forbid accelerated configuration after a player exists. Prevent clients invoking private configuration/helpers directly.
- [ ] Add game_clock metadata to private/public snapshots consistently; keep server_now for old clients. Client validation rejects unknown version/rate, rather than silently treating accelerated data as1x.
- [ ] Add npm.cmd run test:clock-db. Verify repeat-install preservation and byte-for-byte unchanged existing accepted queue dates, balances, battle versions, accounts and troop pools after a1x upgrade.
- [ ] Generate SQL; run focused clock tests, test:clock-db, test:account-compatibility-db, test:fresh and test:db; commit.

## Task 5: Route gameplay through the shared clock

**Files:** engine/local/LocalEngine.ts and online/OnlineEngine.ts; app/App.tsx; shared/rendering/contracts.ts, RenderContext.ts and overlays.ts; map renderers/UI; active gameplay domain modules in army, battle, campaign, city, empire, heroes, map and research; corresponding supabase/modules source.

**Interfaces:** nowGameMs() is supplied by engines; domain APIs accept explicit nowGameMs:number. Existing formatting helper shared/time/clock.ts remains a duration formatter.

- [ ] First create a reviewed timestamp inventory: every gameplay timestamp/default/comparison is game time; every retry/security/audit/budget use is real time. Include SQL defaults and dynamically generated focused installers; do not globally replace now() or Date.now().
- [ ] Add parity scenarios at identical game instants for1x/10x/100x: chronological upgrades with old/new production rates, food/population/culture/science, recruitment queues, all research, march preparation/cancellation/return loot, settlers, camp regeneration/repeat farming, ruins evacuation and tactical elapsed/cooldowns.
- [ ] Inject engine time into domain call sites and outcome/return/loot functions that currently call Date.now internally. Change gameplay SQL helpers/defaults/comparisons to peris_game_now(); retain real-time operations from the inventory.
- [ ] Connect UI and Three.js/Canvas interpolation to the same sampled clock. Test a device wall-clock jump, reload/resynchronization and reconnect; server authorization still decides whether an action is timely. Countdown labels show rate and real remaining time without double scaling.
- [ ] Test legacy solo import/export and existing practice pause/speed behavior. At rate1, existing rules and accepted dates remain equivalent.
- [ ] Update generator dependencies so every focused installer containing a clock-dependent function includes or explicitly guards its clock prerequisite; no downloadable SQL file may leave undefined helper dependencies.
- [ ] Run affected domain and isolated SQL suites plus save tests and desktop/mobile E2E; inspect captured gameplay timing frames; commit.

## Task 6: Contention and history profiling; only measured optimizations

**Files:** new scripts/check-server-reliability.mts and tests/server-reliability-concurrency.test.mts; measured SQL hotspots only; docs/server-reliability.md; package.json.

**Interfaces:** npm.cmd run test:server-concurrency requires PERIS_TEST_DATABASE_URL pointing only to loopback or an explicitly allowed disposable test database. Refuse the production project hostname and refuse destructive initialization without an empty disposable DB. No production export or credentials in evidence.

- [ ] Before optimizing, record baselines: query plans, snapshot bytes, median/p95/max latency, worker duration and game-time lag, lock waits and SQLSTATE counts. Use seeded synthetic owners/history.
- [ ] Run actual independent PostgreSQL17 sessions: locked owner, locked battle, land reservation contention, overlapping workers, two clients ticking one battle, and statement cancellation. Assert healthy work progresses, no duplicate result and no receipt/inventory drift.
- [ ] Add source indexes or bounded/lazy history reads only where the measured query plan identifies the cost. Preserve report history and camp statistics; a recent-history cap must not silently erase cumulative totals or hide data needed for pending loot/commands.
- [ ] Add regressions for any snapshot write contention discovered. A claimed read-only path must actually perform no writes; preserve activity/research initialization by a deliberate alternative if moved.
- [ ] Compare equivalent fixed scenarios before/after. First acceptance target for the isolated five-client1x run: zero unexpected server errors/duplicate results and core-read p95 below2s over10 minutes. Record hardware, database/runtime, payload sizes and workload; targets are not present achievements.
- [ ] Verify at controlled accelerated game instants, then capacity ramp5->20->50->100->200 only when each stage preserves correctness and lag stops growing. Do not claim100x readiness while the10-game-second tick cap produces accumulating debt.
- [ ] If real multi-session Postgres is unavailable, keep the suite implemented and document that exact blocker. PGlite cannot substitute for concurrency verification.

## Final verification and handover

- [ ] Run npm.cmd test; npm.cmd run test:tooling; npm.cmd run assets:check; npm.cmd run build; npm.cmd run check:world; npm.cmd run check:bandits; npm.cmd run check:sql.
- [ ] Run affected database suites from Tasks1-5, plus research/population/territory/empire/social/march/garrison coverage where the timestamp inventory changed source. Some files have no npm alias; invoke their actual node test command.
- [ ] Run npm.cmd run test:e2e for the UI/timing changes, inspect images, and preserve genuine failures separately from tester/environment failures.
- [ ] Conduct a fresh whole-branch review using requesting-code-review; report actual pass/fail/blocker results. Fetch origin/main and integrate the partner's intervening changes before any push.
- [ ] Update the partner handover with implemented interface names and commit references. Keep branch reviewable; no live SQL/client publication or merge as part of this task.

## Plan self-review

Coverage includes A1/A2 and latest garrison/ruins behavior; A3 economy rebalance, new upkeep, B1 implementation and the200-bot season remain separate work. The five review risks map to explicit tests. Clock signatures and optional legacy metadata are consistent. Soft budgets and real PostgreSQL requirements are explicit; historical timeout cause and100x capacity remain unproven.
