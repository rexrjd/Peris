# Unattended Battle Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation awaits user approval; use the current session for token efficiency.

**Goal:** Progress and settle multiplayer battles without open browsers, with once-only committed casualties and rewards under retries and concurrency.

**Architecture:** Harden the existing SQL worker with an independent, fair battle pass that calls the existing authoritative simulation. Preserve transactional finalization and add consistent nonblocking participant guards, bounded retry state, separate scheduler installation, and real concurrency tests.

**Tech Stack:** Existing TypeScript/React client, modular PL/pgSQL, PGlite 0.3.10 (embedded PostgreSQL 17.5), real PostgreSQL 17 and pg_cron for acceptance tests. No new application runtime or combat engine.

**Spec:** [2026-10-18-unattended-battle-progression-design.md](../specs/2026-10-18-unattended-battle-progression-design.md)

## Global Constraints

- Preserve automatic AI, spells, morale, simultaneous damage, 0.1-second simulation steps, the ten-second catch-up cap, the 900-second battle limit, faction and troop identities, result shapes, and local save formats.
- All database edits live under `supabase/modules`. Generate bundles; never hand-edit them.
- Keep `peris_game_tick(p_limit integer default 40) returns jsonb` and its service-role-only grant.
- Soft budgets: battle 2,000 ms, owners 2,000 ms, camps 500 ms; default limits 20 battles, 40 owners, 100 camps.
- Scheduler: existing `peris-world-worker`, five seconds, caller statement timeout eight seconds and lock timeout 100 ms. Installation is separate and explicit.
- Retry errors after `min(300,5*2^(n-1))` seconds; contention retries after five seconds without increasing failures.
- Do not change legacy copies, delete player data, deploy SQL, merge main, or force-push.
- Work in the attached separate worktree. Before any later push, fetch `origin/main`, inspect and integrate other changes, then rerun affected checks. No push is required by this plan.

## Review Focus

- A failure during finalization must roll back both simulation time and every partial reward/casualty, including defender garrisons and siege damage (Task 4).
- A busy oldest battle, due settlers, or crossing PvP participants must not block unrelated work or consume elapsed time (Tasks 2, 3, 5).
- A lost commit response, process termination, or repeated return delivery must converge to one result and one credit (Tasks 4, 5).
- A populated upgrade rerun, legacy deployment phase, deleted battle, or stopped scheduler must preserve existing clocks, ownership, and saves (Tasks 3, 6).
- Empty queues, null budgets, sustained overload, and repeated failures must be bounded and observable; no apparent success after statement cancellation (Tasks 1, 3, 5, 7).

## File responsibilities

| File | Responsibility |
|---|---|
| New `supabase/modules/battle/progression.sql` | Private bookkeeping, participant lock helper, and fair battle pass. |
| Existing `battle/peris_tick.sql`, `battle/peris_finish.sql`, `campaign/player-raids.sql` | Use shared participant guard; preserve simulation and settlement algorithms. Paths in this table are relative to `supabase/modules`. |
| Existing `supabase/modules/campaign/game-worker.sql` | Invoke independent battle pass; bound and isolate owner/camp work; preserve RPC signature. |
| New `supabase/modules/install/unattended-battles-guard.sql`, `security/unattended-battles-permissions.sql` | Focused-upgrade prerequisites and explicit permissions. |
| New `supabase/modules/campaign/enable-game-worker.sql`, `disable-game-worker.sql` | Optional scheduler sources, excluded from ordinary manifest. |
| Existing `supabase/modules/manifest.json`, `scripts/build-sql.mjs` | Module ordering and deterministic generation of ordinary/focused/scheduler bundles. |
| New `tests/helpers/unattended-battle-fixtures.mts` | Shared auth bootstrap, fixtures and persisted-effect snapshots. |
| New `tests/unattended-battle-database.test.mts` | Embedded regression, fairness, rollback, compatibility and privacy tests. |
| New `tests/helpers/postgresHarness.mts`, `tests/unattended-battle-concurrency.test.mts` | Independent PostgreSQL sessions, barriers, contention/cancellation tests. |
| New `tests/unattended-battle-scheduler.test.mts` | Real pg_cron enable/rerun/disable and browser-free execution. |
| Existing `package.json`, docs and architecture | Test entry points, operating instructions and accurate persistence claims. |

## Task 1: Capture the failure and test fixtures

**Files:** Create `tests/helpers/unattended-battle-fixtures.mts` and `tests/unattended-battle-database.test.mts`; modify `package.json`.

**Interfaces:** `createBattleFixture(): Promise<BattleFixture>` supplies isolated PGlite, admin/login/query helpers, two owned armies, and cleanup. `snapshotBattleEffects(db,battleId): Promise<BattleEffects>` reads persisted clocks, rosters, rewards and receipts. Use current V19 generated SQL and existing pathfinding/roster helpers rather than inventing routes or identities. Add `test:unattended-db` as `node --import tsx tests/unattended-battle-database.test.mts`.

- [ ] Write `failed_owner_does_not_starve_healthy_owner`: two overdue owners, first with the same invalid field order used in the investigation; two one-owner worker calls must service the healthy owner and record both attempts. On current source, assert the failure is the unchanged healthy battle clock/fairness row, not fixture setup.
- [ ] Run `npm run test:unattended-db`; record the expected assertion failure. Keep the isolated fixture independent of real accounts and never remove the corrupt order as a proposed fix.
- [ ] Add fixture snapshot checks proving an unchanged installer produces identical starting troop/reward totals across repeated fixture creation, excluding generated IDs and wall-clock timestamps.
- [ ] Commit the fixtures and deliberate red regression as `test: reproduce unattended battle starvation`; immediately proceed to the guarded implementation tasks after approval. The final branch must not retain failing tests.

## Task 2: Consistent participant locking across all settlement paths

**Files:** Create `supabase/modules/battle/progression.sql`; modify `supabase/modules/battle/peris_tick.sql`, `battle/peris_finish.sql`, `campaign/player-raids.sql`, `manifest.json`, and Task 1 tests.

**Interfaces:** Produce private `peris_lock_battle_participants(p_attacker uuid,p_defender uuid) returns boolean`. Consume it in the existing `peris_tick_for(bigint,uuid)` and both existing finalizers; do not change their argument/result shapes. Insert the progression module before `battle/peris_finish.sql` in the manifest. Explicitly revoke the new helper from all client roles, including service_role.

- [ ] Write `participant_guard_covers_every_battle_mode` and `resolved_finalizer_is_a_noop`. Assert story, bandit, accepted duel, and city-raid ticks retain participation checks; finalizer repeats leave persisted effect snapshots equal; untrusted callers cannot invoke the guard. Reserve real contention assertions for Task 5.
- [ ] Generate SQL with `npm run build:sql` and run `npm run test:unattended-db`; observe the new missing-helper/security assertion fail while the original starvation assertion remains red. Use `node:test` test cases so focused execution can select them independently.
- [ ] Implement the guard as one exception block: try due-settler land lock `204200`, then participant players ordered by UUID with `FOR UPDATE NOWAIT`; release partial locks on contention. Call it before any phase/clock changes in all tick modes, returning `busy=true` on failure. Use it after status rechecks in both finalizers and raise `55P03` on failure so withdrawals cannot report an uncommitted finish.
- [ ] Regenerate, then run `node --import tsx --test --test-name-pattern='participant_guard|resolved_finalizer' tests/unattended-battle-database.test.mts` and `npm run test:automatic-db`, `npm run test:player-raids-db`, and `npm run test:magic-db`. Verify unchanged spell, combat, casualty and result behavior. Keep the Task 1 starvation regression explicitly pending until Task 3.
- [ ] Commit only this responsibility and its generated outputs as `fix: guard battle participants consistently`.

## Task 3: Independent fair battle pass and bounded worker

**Files:** Modify `supabase/modules/battle/progression.sql`, `supabase/modules/campaign/game-worker.sql`, and Task 1 tests.

**Interfaces:** Produce private `peris_advance_battles(p_limit integer default 20,p_budget_ms integer default 2000) returns jsonb`; consume existing `peris_tick_for(bigint,uuid)`. Add `peris_battle_work` with the exact columns in the spec. Keep `peris_game_tick(integer)`; return existing `processed` plus `attempted`, `failed`, `battles`, and `duration_ms`. Battle summary fields: `attempted`, `advanced`, `resolved`, `busy`, `failed`, `simulated_seconds`.

- [ ] Add red cases `battle_pass_ignores_owner_settlement_failure`, `all_modes_progress_without_clients`, `attempt_limit_rotates_failed_and_healthy_battles`, `backlog_is_retained_and_drained_over_visits`, `legacy_deployment_starts_without_resetting_clock`, `empty_and_resolved_queues_are_noops`, `deleted_battle_cleans_bookkeeping`, `null_and_invalid_budgets_are_rejected`, and `retry_state_is_private`. Pin ten seconds maximum per visit, 0.15-second due threshold, attempt limits, and the backoff sequence 5, 10, 20, 40, 80, 160, 300, 300 seconds using tolerances for wall-clock observations.
- [ ] Run `npm run test:unattended-db`; confirm failures correspond to absent fair processing/bookkeeping rather than fixture mistakes.
- [ ] Implement one-at-a-time `FOR UPDATE OF b SKIP LOCKED` selection after due/backoff filtering, ordered by never-attempted/last-attempt, `last_tick_at`, ID. Add `peris_battles_active_tick_idx` on `(last_tick_at,id) where status='active'`. Exclude already-visited IDs. Enclose selection and tick in one rollback-capable attempt; convert busy responses to a caught contention exception so locks release. Record metadata after rollback; retain elapsed time on any failure; clear retry state on success and delete it on resolution. Cap backoff arithmetic before exponentiation. Backlog tests backdate the clock once, then repeatedly invoke the worker without resetting it between visits.
- [ ] Change the worker to battle pass, owner pass, then camp pass with independent 2,000/2,000/500 ms soft deadlines. Retain global lock `204215`; remove per-owner battle simulation. Preflight owner land/player locks without blocking, rotate owner attempt timestamps even on errors, and catch camp failures individually. Validate null limits. Do not swallow statement cancellation. Preserve existing farm/arrival/return order inside owner work.
- [ ] Regenerate and run `npm run test:unattended-db`, `npm run test:integration-db`, `npm run test:automatic-db`, `npm run test:player-raids-db`. The Task 1 regression and all new cases must now pass. Verify a newly started arrival battle is eligible on the next invocation without changing its initial timestamp.
- [ ] Commit as `feat: advance unattended battles with fair bounded work`.

## Task 4: Failure injection and once-only result coverage

**Files:** Extend `tests/unattended-battle-database.test.mts` and its fixtures; modify finalizers or delivery source only if a new failure demonstrates a defect.

**Interfaces:** Consume `snapshotBattleEffects` and the existing finish, hero-reward and return-delivery functions. Fault injection belongs only to temporary test schemas/triggers; no production fault flags.

- [ ] Add `rollback_after_casualties_or_xp_preserves_entire_chunk`, `rollback_after_siege_or_loot_preserves_both_players`, `lost_successful_response_retries_without_effects`, and `return_delivery_clears_loot_once`. Install temporary triggers that fail after real writes, then compare all affected rows with their pre-attempt snapshot; remove the trigger and require exactly one successful result. Include advanced troop roles, defender armies and garrisons, finite camp stocks, hero artifacts, victory/prestige totals, report uniqueness, storage overflow, and carried loot/report IDs. Normalize ordinary resource accrual in comparisons.
- [ ] Run the focused tests. If a case passes immediately, retain it as evidence; if it fails, use systematic-debugging to isolate the first divergent write before changing production source. A report-count assertion alone is insufficient.
- [ ] Make only demonstrated fixes in `supabase/modules/battle/peris_finish.sql`, `campaign/player-raids.sql`, or `campaign/camp-schema.sql`; regenerate as needed and rerun the focused regression.
- [ ] Run `npm run test:hero-loot-db`, `npm run test:army-parity-db`, `npm run test:command-receipts-db`, `npm run test:report-reads-db`, and `npm run test:player-raids-db` with the unattended tests.
- [ ] Commit as `test: prove atomic once-only battle settlement` (describe a fix in the commit if one was necessary).

## Task 5: Real PostgreSQL concurrency, cancellation and retry

**Files:** Create `tests/helpers/postgresHarness.mts` and `tests/unattended-battle-concurrency.test.mts`; add `test:unattended-concurrency` to `package.json`.

**Interfaces:** `withDisposablePostgres(test:(h:PostgresHarness)=>Promise<void>): Promise<void>` uses `psql` processes for independent persistent sessions. Require `PERIS_TEST_PG_ADMIN_URL` pointing to a loopback-only disposable PostgreSQL test server; never print the URL. Create a uniquely named test database, bootstrap auth roles idempotently, and clean up only that database. No production or Supabase-hosted URL is accepted. Missing prerequisites fail with an actionable message, not a silent pass. No new application dependency is needed.

- [ ] Implement and validate harness isolation: reject non-loopback hosts, create the unique test database, apply current generated SQL, and open at least three independent sessions. Coordinate with explicit query completion markers and `pg_locks`/`pg_stat_activity` conditions with bounded deadlines, not timing sleeps. If local PostgreSQL cannot be provisioned, stop claiming concurrency verification and report that prerequisite.
- [ ] Write `workers_exclude_each_other`, `client_tick_and_worker_serialize_elapsed_time`, `tick_and_withdraw_settle_once`, `crossing_pvp_locks_defer_without_deadlock`, `locked_oldest_battle_does_not_hide_others`, `busy_players_and_settler_land_do_not_consume_time`, `concurrent_returns_credit_once`, `killed_connection_rolls_back_and_retries`, and `statement_timeout_cancels_entire_invocation`. Assert before/after snapshots and SQLSTATE, not only RPC success. For overdue nonterminal combat, two serialized calls may process separate chunks: assert the simulation elapsed delta equals the persisted `last_tick_at` delta and does not exceed available elapsed time; require one settlement when terminal. Verify busy attempts release partial locks and unrelated work commits after the holder releases.
- [ ] Run `npm run test:unattended-concurrency` against actual PostgreSQL 17. Demonstrate tests detect a deliberately removed participant guard in a disposable source fixture, then restore it. Do not weaken assertions or replace the server with PGlite.
- [ ] Resolve any exposed implementation defect with its failing case, regenerate, and rerun the affected embedded and real-server suites.
- [ ] Commit as `test: exercise battle worker concurrency on PostgreSQL`.

## Task 6: Generated focused upgrade and explicit scheduler lifecycle

**Files:** Create the guard, permissions and scheduler source files from the file map; modify `scripts/build-sql.mjs`, `supabase/modules/security/permissions.sql`, and `tests/unattended-battle-scheduler.test.mts`. Generate `supabase/UPGRADE_UNATTENDED_BATTLES.sql`, `ENABLE_GAME_WORKER.sql`, `DISABLE_GAME_WORKER.sql`, plus the existing complete bundles. Add `test:unattended-scheduler`.

**Interfaces:** The focused upgrade composes the guard, progression module, existing tick/finish definitions, extracted `peris_finish_city_raid`, worker, and explicit permissions in one transaction. Generalize the builder's existing named-function extraction only as needed to extract that existing finalizer. Optional scheduler sources must not appear in the ordinary manifest.

- [ ] Add red tests `focused_upgrade_preserves_populated_v19_twice`, `full_upgrade_preserves_combat_and_resolved_battles`, `ordinary_install_does_not_schedule`, and `scheduler_enable_is_idempotent_and_disable_preserves_state`. Seed both owners, science, diplomacy, farms, role rosters, artifacts, reports, an overdue combat battle, and a legacy deployment battle. Assert the focused upgrade does not change clocks or invoke unrelated data migrations. Test deployment clock preservation with the focused upgrade; the complete installer's historical deployment migration is existing behavior outside this change. Wrong-schema prerequisites must fail transactionally.
- [ ] Implement deterministic generated outputs. Keep new helpers and metadata private; grant only `peris_game_tick(integer)` to service_role. Focused permissions must stand alone without relying on the full installer's blanket revoke. Ordinary installers still end with the existing complete permissions pass.
- [ ] Implement explicit scheduler enable/disable sources. Require installed seconds-capable pg_cron and the new worker helper; use the existing job name, five-second cadence, and connection-level `statement_timeout='8s'`, `lock_timeout='100ms'` before `peris_game_tick(40)`. Fail clearly for missing/unsupported extension rather than enabling it. Disable affects only this job. Repeated enable updates the same job for the same installation owner; reject conflicting owner/name ambiguity instead of creating another worker.
- [ ] Run `npm run build:sql`, `npm run check:sql`, `npm run test:unattended-db`, `npm run test:db`, and `npm run test:fresh`. Regeneration should remove the baseline checkout-only CRLF catalog difference. Inspect diff; do not weaken the check or manually edit generated SQL.
- [ ] Run `npm run test:unattended-scheduler` on a disposable local PostgreSQL instance with pg_cron preloaded. Enable twice, close all game clients, observe automatic clock progress and a result, inspect `cron.job_run_details`, disable twice, and require gameplay/bookkeeping preservation. Real scheduling remains unverified if this runtime is unavailable; stubs prove only script structure.
- [ ] Commit as `feat: generate safe battle worker upgrade and scheduler controls`. Do not run any generated script against a live project.

## Task 7: Documentation, measurement, repository verification

**Files:** Modify `docs/automatic-battles.md`, `docs/automatic-battles-compatibility.md`, `docs/frontier-wars.md`, `ARCHITECTURE.md`; add `docs/unattended-battle-worker.md`. Update this plan's checkboxes and record exact results.

**Interfaces:** Document only implemented behavior and measured limits. Include administrator-only health queries for job state/history, duration, oldest lag, and retry failures, plus enable/disable and existing client fallback instructions.

- [ ] Measure no-client progress/backlog recovery on the real test database: 1, 10, and 40 battles, record actual formation counts and an initial 60-second lag over a 120-second observation window with five-second cadence. Record CPU/RAM, database/extension versions, limits, runtime distribution, lag and errors. Inspect `EXPLAIN (ANALYZE, BUFFERS)` for candidate selection with at least 10,000 resolved historical battles in the disposable fixture. Do not call an overloaded case supported; adjust the operational recommendation based on evidence without changing combat time accounting.
- [ ] Document soft-budget overshoot, whole-invocation hard-timeout rollback, corrupt-data intervention, the 30-second/no-success and 30-second/5-minute lag thresholds, and three-consecutive-failure investigation. Correct the old client-only persistence claim while preserving historical installation context. Explain production enablement remains a separate operator action.
- [ ] Run `npm test`, `npm run test:tooling`, `npm run assets:check`, `npm run build`, `npm run check:sql`, `npm run check:world`, and `npm run check:bandits`; capture exit codes and distinguish baseline warnings/failures.
- [ ] Run `npm run test:db`, `test:fresh`, `test:automatic-db`, `test:integration-db`, `test:player-raids-db`, `test:magic-db`, `test:hero-loot-db`, `test:army-parity-db`, `test:command-receipts-db`, `test:report-reads-db`, `test:research-db`, `test:empire-db`, and `test:social-db`, plus all three new unattended suites. Run these independently or in modest batches, inspect every result, and do not repeat broad checks without a new reason.
- [ ] Run `npm run test:e2e`; inspect captured battle/map screenshots and actual pointer-driven observer interactions. Any local fixture coverage must be identified as such; it cannot substitute for SQL concurrency/scheduling acceptance.
- [ ] Apply Superpowers verification-before-completion, inspect `git diff --check` and the complete branch diff, and confirm only the worktree changed. Commit documentation and report actual passes, skips, baseline issues, and any unverified runtime. Stop with the review branch; do not deploy, merge, or push.

## Planning review and approval

Design/plan self-review: checked scope, interfaces, exact limits, every once-only effect, privacy, compatibility, cancellation, fair failure handling, and test ownership. No implementation or deployment is authorized until the user approves these proposed artifacts. Current-session execution is recommended; parallel implementation would add coordination across tightly coupled SQL interfaces.

The design contains the actual pre-change verification results. The existing test suite does not establish the new behavior, and missing real PostgreSQL/pg_cron remains a prerequisite for its concurrency/scheduler acceptance claims.
