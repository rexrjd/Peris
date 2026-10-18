# Reliable unattended multiplayer battle progression

Status: proposed for user review; implementation has not started.

Investigated at `11ccee7`, in branch `plan/unattended-battle-progression` in a separate worktree. The user requested the design and implementation plan together, with approval before implementation. Execution is intended to remain in the current session to limit token use.

## Outcome and boundaries

Online battles must advance and settle when every browser is closed. Scheduled calls, client ticks, withdrawals, retries, and restarts must converge on one committed result, with casualties, XP, artifacts, prestige, siege damage, reports, and loot applied once.

Keep the existing React/TypeScript/Three.js application and SQL authority. Preserve automatic AI, spells, morale, simultaneous damage, 0.1-second simulation steps, the ten-second catch-up cap, the 900-second battle limit, faction and troop identities, result shapes, and local save formats. This work changes orchestration and contention handling, not combat balance or strategic travel rules. Do not change legacy copies, delete player data, deploy SQL, merge main, or force-push.

Assumption: the existing optional database scheduler is the preferred host. Its production installation, PostgreSQL version, extension version, and capacity are unknown; no live project was queried.

## Evidence from the current implementation

| Area | Current behavior and implication |
|---|---|
| `src/engine/online/OnlineEngine.ts:280` | An open client calls `peris_tick` for an active battle; peaceful clients call `sync_my_state`. |
| `supabase/modules/campaign/game-worker.sql` | `peris_game_tick(40)` already settles owners, starts arrivals, ticks battles, and accrues camps. Global transaction advisory lock `204215` prevents overlapping workers. |
| `supabase/ENABLE_GAME_WORKER.sql` | A separately installed `peris-world-worker` job calls the worker every ten seconds. Installing ordinary gameplay SQL does not enable it. |
| `supabase/modules/battle/peris_tick.sql` | Locks the battle, checks participation, and advances `last_tick_at` only by processed time. It calls the existing simulation and finalizers. Participant lock contention is preflighted for city raids, but not story/bandit fights or accepted duels. |
| `supabase/modules/battle/peris_finish.sql` and `campaign/player-raids.sql` | Both finalizers lock and recheck the battle. Mutations and the resolved marker share the caller's transaction. Reports are unique by `(owner_id,battle_id)`; artifacts also have a battle uniqueness key. These protections must remain the settlement boundary. |
| `supabase/modules/campaign/camp-schema.sql` | Return delivery locks the army, credits available storage, updates its receipt, and clears carried loot in one transaction. |
| Current tests | Embedded PostgreSQL tests cover repeat calls, casualties, rewards, private helpers, and upgrades, but not independent concurrent sessions or real pg_cron execution. |

The current documentation is inconsistent: `docs/automatic-battles.md` describes client-only catch-up, whereas `docs/frontier-wars.md` and the code describe the optional worker.

An isolated PGlite 17.5 probe loaded the current V19 installer, created two rulers and two overdue battles, and inserted an invalid due field order for the first ruler. Two calls to `peris_game_tick(1)` both returned `processed=0`; neither battle advanced and no owner fairness row was recorded. Removing the injected order let each battle advance ten seconds on its next visit, retaining more than twenty seconds of backlog. Nothing was changed in a live database.

Root causes:

1. An owner's economic failure rolls back and prevents that owner's subsequent battle tick.
2. Failed owners never receive a fairness timestamp, so a small budget can repeatedly select them ahead of healthy owners.
3. Owner count bounds neither battle simulation cost nor total transaction duration. Camp accrual is outside the owner exception boundary.
4. Processing at most ten simulated seconds once every ten wall-clock seconds gives a repeatedly serviced battle little catch-up headroom; larger queues worsen the deficit.
5. A worker can hold a player lock before requesting a battle lock, while ticks/finalizers take the reverse path. Existing city-raid `NOWAIT` protections need consistent coverage; actual deadlock behavior remains to be tested on real PostgreSQL.

## Approaches considered

1. **Harden the existing worker, recommended.** Give battles their own fair, bounded pass inside `peris_game_tick`, independent of owner settlement. Retain one scheduler and the existing simulation/finalization functions. This is the smallest operational change and preserves the current entry point.
2. **A dedicated battle job.** Isolates battle throughput and timeouts from economy work, but adds another scheduler, cross-job coordination, and operational ownership. Consider later if measurements show the single worker cannot meet demand.
3. **An external service or Edge Function.** Can supply independent transactions and scaling, but adds credentials, hosting, retries, and another runtime. It offers little benefit before the existing SQL worker is made safe.

## Proposed flow and interfaces

Keep `peris_game_tick(p_limit integer default 40) returns jsonb` and its service-role-only grant. Validate null as well as out-of-range budgets. Retain `processed` as the successful-owner count; add aggregate attempt/failure counts, a `battles` summary, and duration without exposing player details. A competing worker returns `busy=true` before mutation.

After acquiring the existing global lock:

1. Run private `peris_advance_battles(p_limit integer default 20, p_budget_ms integer default 2000) returns jsonb`.
2. Run the existing owner work with a separate 2,000 ms soft budget, capped by the existing owner limit. Remove the old per-owner battle-ticking loop so one run does not process a battle twice. Keep active owners eligible for their ordinary settlement. New arrivals can start battles in this pass and become eligible for the next run.
3. Accrue up to 100 due camps under a separate 500 ms soft budget, isolating each camp's failure.

Check soft deadlines using `clock_timestamp()` between work items. They prevent starting more work, not interrupting an item already running. The scheduled connection supplies an eight-second statement timeout and a 100 ms lock timeout before calling the worker; test these outside the function. A hard timeout cancels and rolls back the entire invocation, including successful earlier items. Do not claim those items committed, or swallow cancellation as success. Hard-timeout repetition is an operational failure to diagnose, not a reason to discard simulation time or raise limits blindly.

Initial scheduler interval: five seconds. Initial limits are tuning inputs, not throughput guarantees. Battle helper accepts 1–100 items and 1–5,000 ms; null is invalid. At sufficient measured capacity, a visit can process ten seconds for five seconds of incoming time and therefore drain backlog. Saturation is observable and must not silently alter battle rules.

## Fair selection and retries

Add private `public.peris_battle_work` in `supabase/modules/battle/progression.sql`:

- `battle_id bigint primary key references public.battles(id) on delete cascade`.
- `last_attempt_at timestamptz not null`, `next_attempt_at timestamptz not null`.
- `consecutive_failures integer not null default 0`, `last_sqlstate text`.

Enable RLS, grant no player policies, and revoke table access from public, anon, authenticated, and service_role. The definer worker and administrators access it. Do not add operational columns to `battles`, because snapshots currently serialize its complete rows.

Select active battles with at least 0.15 seconds due and a retry deadline that has arrived. Order by last attempt (never attempted first), then `last_tick_at`, then ID. Select and lock one battle at a time with `FOR UPDATE OF b SKIP LOCKED` inside its exception/savepoint block. Exclude IDs already visited in this invocation. The limit is applied after skipping locked rows; a locked oldest battle must not hide runnable younger battles.

Add `peris_battles_active_tick_idx` on `public.battles(last_tick_at,id) where status='active'` so historical results do not dominate candidate discovery. Check the real selection query with `EXPLAIN (ANALYZE, BUFFERS)` on a disposable fixture with substantial resolved history; the fairness join can still require sorting active rows, so an item limit alone is not proof of bounded query cost.

Call `peris_tick_for(id,attacker_owner_id)` as internal authority, without fabricating a JWT or changing the requesting identity. It retains the participation check and the existing client RPC signature. Record attempts after the simulation block, so errors roll back simulation but still rotate the failing item. A busy outcome must roll back the attempt's row/participant locks before bookkeeping; returning early while retaining those locks is insufficient.

Success clears failure state. Contention retries on the next five-second interval without increasing failure count. Other SQL errors retry after `min(300,5*2^(n-1))` seconds, with the exponent capped before arithmetic. Store only SQLSTATE and counts; detailed errors remain private server warnings. Delete completed battle bookkeeping; FK cleanup handles deleted battles. Retrying a stale candidate rechecks status under lock.

For owner work, update existing `peris_worker_owners.last_processed_at` after every attempted owner, including a failed attempt, outside its exception block. This private field becomes last-service-attempt time, fixing starvation without changing player data. Include owner failures in aggregate results and warnings. Do not rewrite or delete a corrupt economic order. An independent battle pass can continue nonterminal combat despite that error; if finalization itself requires failing settlement, that chunk must roll back and retry with an operator-visible error.

## Locking and once-only effects

Add private `peris_lock_battle_participants(p_attacker uuid,p_defender uuid) returns boolean`. In one rollback-capable block, try the shared land advisory lock `204200` when either participant has due settlers, then lock participant players in UUID order with `NOWAIT`. Failure releases partial acquisitions and returns false. No gameplay state changes before successful acquisition.

Use it before simulation clock changes for every battle mode. Preserve the battle row lock and existing `last_tick_at + processed` update. A busy client tick retains its existing `{busy:true}` contract. Both finalizers also use the same participant guard after their resolved check; contention raises SQLSTATE `55P03` and rolls back the attempt. The withdrawal path therefore fails retryably instead of recording a false success. Owner processing similarly preflights its land/player locks without waiting, inside the owner savepoint. The global worker must not block on the land lock before it has a chance to service unrelated battles.

Do not introduce a second reward implementation, asynchronous reward delivery, or a separate finalization marker. The battle lock plus status recheck and transactional effects are the once-only boundary:

- Tick/finish/withdraw races serialize at the battle. A loser observes resolved state or retries.
- Two successful calls may legitimately consume two different overdue chunks. Once-only means no overlapping simulated time or duplicate settlement, not one tick per battle or scheduler interval.
- A failure after casualty, XP, siege, or resource writes rolls all of them back with the battle clock and marker.
- A lost successful response can be retried; resolved battles perform no more mutations.
- Report/artifact uniqueness remains defense in depth, not a substitute for guarding XP and resources.
- Return loot remains on the army until the existing transactional delivery clears it; concurrent delivery/retry cannot credit it twice.

## Source, compatibility, and operations

All database edits live under `supabase/modules`. Generate ordinary installers, a focused `UPGRADE_UNATTENDED_BATTLES.sql`, and enable/disable scripts with `scripts/build-sql.mjs`; never hand-edit bundles. The focused upgrade guards required V19-era tables/functions and contains only progression bookkeeping, the locking/tick/finalizer/worker definitions, and their permissions. It must not replay geography, catalogs, account migrations, or the automatic-module deployment-clock reset. Apply it twice to a populated fixture and verify active clocks, rosters, accounts, research, farms, reports, diplomacy, and artifacts are preserved.

Keep scheduler enable/disable sources outside the ordinary module manifest. Enable requires the worker and a seconds-capable installed pg_cron, uses the existing case-sensitive job name `peris-world-worker`, and replaces that job rather than adding a second one. Do not install an extension or start a job as a side effect of a gameplay upgrade. Disable only unschedules that job and preserves all gameplay/bookkeeping. Existing clients continue to tick safely if the scheduler is stopped.

Document administrator queries for job presence, active state, last success/failure, execution duration, oldest active-battle lag, retry deadlines, and failure counts. Initial investigation thresholds: no successful job for 30 seconds, oldest battle lag over 30 seconds for five minutes, or three consecutive failures of one battle. These are operator actions, not a new notification service. Document cron-history retention as an operator concern; do not silently delete unrelated job history.

## Verification and acceptance

1. PGlite regression tests demonstrate owner starvation before the fix, bounded fairness after it, browser-free starts/progression/finalization/return, retained overdue time, old deployment phase handling, invalid budgets, retry/backoff, and isolated failures.
2. Inject failures after actual casualty/reward/loot/siege mutations. Compare persisted battle clocks, formations, army and garrison rosters, XP, artifact identities, stock, resources, prestige, siege levels, and receipts before rollback and after one successful retry. Freeze/accrual-normalize economic time in assertions so ordinary income is not mistaken for duplicate loot.
3. Real PostgreSQL 17 tests use independent sessions and condition-based barriers for worker/worker, worker/client, tick/withdraw, crossing PvP participants, a busy oldest battle, a blocked land lock, return delivery, cancellation, and connection termination. Require single committed effects and progress after lock release. PGlite serialization is not evidence for these cases.
4. Test enable/rerun/disable and unattended execution against real pg_cron in a disposable local test instance. A stub can test installer generation, but cannot verify scheduling. Without that runtime, report the scheduling acceptance test as unverified.
5. Run repository unit, tooling, assets, build, SQL/world generation checks and affected isolated database suites. Run E2E and inspect captured battle/map images with real pointer interactions for observer regressions. Browser fixtures do not establish server concurrency.
6. Measure runtime and backlog recovery with named CPU/RAM, PostgreSQL/pg_cron versions, battle counts, formation counts, initial lag, cadence, and worker limits. Record durations and lag over a fixed sample. No ranked-season or scale claim until service capacity exceeds incoming work and backlog demonstrably shrinks.

## Investigation baseline (before implementation)

Environment: Windows, Node 22.11.0, npm 10.9.0; package-lock installed using `npm ci`. No `psql`, Docker executable, or PostgreSQL service was discovered. This does not establish production configuration.

| Check | Actual result |
|---|---|
| `npm test` | Exit 0: 458 passed, 1 skipped, 0 failures (459 total). |
| `npm run test:tooling` | Exit 0: 5 passed. |
| `npm run assets:check` | Exit 0: 46 registered GLBs and 33 Rally Point paintings verified; existing model warnings emitted. |
| `npm run build` | Exit 0; existing large-chunk warnings. |
| `npm run test:db`, `test:fresh` | Exit 0. |
| `npm run test:automatic-db`, `test:integration-db`, `test:player-raids-db` | Exit 0. |
| `npm run check:world`, `check:bandits` | Exit 0. |
| `npm run check:sql` | Exit 1 before edits: `Stale technology SQL`. In-memory reproduction confirms 213 CRLF endings are the entire difference from generated LF content. |
| `node scripts/build-sql.mjs --check` | Exit 0: bundles match normalized modular source. |
| New concurrency/scheduler tests, browser E2E | Not run during planning; no implementation exists. |

Regeneration during implementation should correct the checkout catalog bytes without weakening its checker. Recheck and report; do not describe the baseline failure as a battle regression.

## Documentation references

- [PostgreSQL 17 locking](https://www.postgresql.org/docs/17/explicit-locking.html): transaction locks and savepoint rollback underpin the design; Context7 successfully returned these official references.
- [PostgreSQL 17 SELECT](https://www.postgresql.org/docs/17/sql-select.html): `NOWAIT` and `SKIP LOCKED`.
- [PostgreSQL 17 timeouts](https://www.postgresql.org/docs/17/runtime-config-client.html): statement and lock timeouts must be tested at the calling connection.
- [Supabase Cron quickstart](https://supabase.com/docs/guides/cron/quickstart): seconds schedules, named-job replacement, job history, and explicit enable/disable.
- [pg_cron](https://github.com/citusdata/pg_cron): a job has at most one executing instance, with later runs queued; the application lock also covers manual invocations.

The Supabase changelog was checked, including current extension-version policy and PostgreSQL minor-version notices. No installed production version is assumed from those documents.
