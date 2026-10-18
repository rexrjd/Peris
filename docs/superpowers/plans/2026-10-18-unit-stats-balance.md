# Unit Stats and Starting Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task in the current session. Steps use checkbox (`- [x]`) syntax. Await user review of the written design and plan before implementation.

**Goal:** Introduce readable unit/army statistics and a measured starting balance between power, resource costs and training time across eleven factions.

**Architecture:** A versioned catalog feeds the pure TypeScript stat resolver, UI and generated SQL. New battles snapshot modest faction doctrines, while old battles, queues, reports and unupgraded online servers retain their existing rules.

**Tech Stack:** Existing TypeScript/React, Canvas/Three.js renderers, modular PL/pgSQL, PGlite, Node test runner and Playwright. No additional application dependency.

**Spec:** [2026-10-18-unit-stats-balance-design.md](../specs/2026-10-18-unit-stats-balance-design.md)

## Global Constraints

- Shared nine-role recruitment costs/training across all eleven factions; initial candidate values and faction profiles are specified in the design.
- Final faction multipliers stay inside `0.94..1.06`; Roman stays at `1.00`. Calibrate within that bound and retain each faction's stated direction.
- Preserve automatic AI, damage timing/formula, simultaneous casualties, morale, spells, existing research, travel and siege rules. No new upkeep, health or scouting mechanic.
- Keep the v6 save identity/format. Missing historical battle/report version is v1; missing online world metadata is v1. Future local recruitment/new battles use v2.
- All database edits are source under `supabase/modules`; generate SQL catalog rows and bundles. No deployment, main merge, force push or player reset.
- Keep the unattended-worker implementation separate and pending. Use `plan/unit-stats-balance` in the current isolated worktree. Before a later push, fetch/reconcile current main and rerun affected checks.

## Review Focus

- A basic-only army must receive the same catalog stats as a mixed advanced roster and the SQL engine (Tasks 1–2).
- City faction changes/rebasing/transfer must not rewrite an active battle or allow cross-faction price conversion (Tasks 2–3).
- Old active elites/archers, missing metadata, and research-adjusted formation values must still validate without broadening invalid-save acceptance (Task 4).
- Old queued training and reports, including pruned-battle fallback economics, must retain their accepted time/prices (Tasks 3–4).
- Near-identical mathematical power budgets can yield different routing results; verify actual economic and tactical scenarios before asserting balance (Task 5).

## Task 1: Versioned canonical catalog and readable reference stats

**Files:** Create `src/features/army/domain/unitBalance.json`, `unitBalance.ts`, and `tests/unit-balance.test.ts`. Modify `src/features/army/domain/units.ts`, `roster.ts`, and `src/features/frontier/domain/units.ts` to use the shared source without a runtime cycle.

**Interfaces:** Export `type UnitBalanceVersion = 1 | 2`, `type UnitBalanceContext = {version:UnitBalanceVersion;faction:Faction}`, `unitRule(unit:RecruitUnit,version:UnitBalanceVersion):UnitRule`, and `unitStats(unit:RecruitUnit,context:UnitBalanceContext):UnitStats`. `UnitStats` includes `attackMultiplier`, `defenceMultiplier`, `attackPoints`, `protectionPoints`, `speed`, `range`, `carry`, `cost`, and `trainSeconds`. Keep the existing role IDs and public aliases. Shared data owns versioned values; presentation names/colors remain with their existing owners.

- [x] Write failing tests for exact v1 preservation, all nine v2 candidate rows, all eleven profiles, neutral Roman, unknown-version/faction rejection and immutable lookups. Pin Roman infantry to 100/100 points, cavalry to 155/100, and v2 archers to 75/90. Verify multiplying an archer's attack by 1.04 produces 78 points.
- [x] Run `node --import tsx --test tests/unit-balance.test.ts` and observe the missing-resolver failure.
- [x] Implement the JSON source and pure resolver. Store attack/defence multipliers as the mechanics; compute reference points from the unchanged class rates. Use type-only feature dependencies and keep army/frontier imports acyclic. Validate catalog uniqueness, positive finite values, integer resource/training values, and the profile bounds in tests/generation.
- [x] Run focused tests and `npm test` architecture/import checks. Confirm compatibility exports still reach the active root modules.
- [x] Commit as `feat: define versioned unit stats and starting costs`.

## Task 2: Snapshot faction stats consistently in local and SQL battle creation

**Files:** Modify `src/features/battle/domain/formations.ts`, `creation.ts`, `practice.ts`, `types.ts`, all real `newBattle` callers, `src/features/research/domain/effects.ts`; add SQL balance schema/resolver source and a generator. Modify `supabase/modules/battle/peris_add_formations.sql`, `supabase/modules/empire/gameplay.sql` (`peris_apply_hero` only), battle-creation callers, `supabase/modules/manifest.json`, `scripts/build-sql.mjs`, and package generation/check commands. Add `tests/unit-balance-database.test.mts` and extend `tests/automatic-battle.test.ts`.

**Interfaces:** Append optional `UnitBalanceContext` to `makeFormations` after its existing `counts` argument; append `{version,attackerFaction,defenderFaction}` to `newBattle` after existing arguments. Explicit context is required from production battle factories; compatibility defaults remain neutral v2 for standalone new fixtures. Add `balance_version?:UnitBalanceVersion` to local battle/result types and captured attacker/defender faction metadata. SQL helper `peris_unit_stats(p_unit text,p_faction text,p_version integer) returns jsonb` supplies base/faction values. It is private with empty search_path and revoked execution from clients.

- [x] Add red tests for all 99 combinations, basic-only versus advanced/mixed rosters, repeated hero/research application without compounding, NPC ownership null, practice overrides, accepted duels, and city defence using the defended city's doctrine. Assert unit inspection and actual construction can use the same resulting base/faction values.
- [x] Run the focused local and new database tests; confirm the basic-unit/default mismatch is exposed before the fix.
- [x] Implement unconditional catalog assignment during formation creation and capture doctrines before constructing either side. Modify `peris_apply_hero` to resolve the captured base/faction/version before applying existing bonuses, so it neither erases nor doubles faction modifiers. Apply profile stats to NPC formations even when hero application returns early for a null owner. Do not change battle tick algorithms.
- [x] Generate versioned catalog/profile rows from JSON. Put schema before the generated rows and before roster helpers that query the catalog; remove only duplicated hand-maintained value inserts from `army/roster.sql`. Add existing-battle SQL version default 1 first, then switch the insert default to 2; do not rewrite formations/clocks.
- [x] Run new parity tests plus `test:automatic-db`, `test:world-battles-db`, `test:player-raids-db`, `test:magic-db`, and local automatic-battle tests. Compare exact multipliers and invariants; do not demand identical floating-point trajectories from separate engines.
- [x] Commit as `feat: apply captured faction unit stats in both engines`.

## Task 3: Recruitment and unit/army comparisons use the authoritative version

**Files:** Modify `src/shared/model/world.ts`, local realm normalization/new-world setup, `src/features/army/domain/commands.ts`, `commandRoom.ts`, `recruitment.ts`, `troopDetails.ts`, `src/features/frontier/domain/balance.ts`, unit/recruitment/Rally UI, and the SQL snapshot/recruitment source. Add or extend `tests/troop-details.test.ts`, `tests/army-command-room.test.ts`, `tests/rally-army-details.test.ts` and an online v1/v2 fixture test.

**Interfaces:** Add `unit_balance_version?:UnitBalanceVersion` to World, advertised as 2 by upgraded private snapshots. Add `armyStrength(world:World,army:Army):{attackPoints:number;protectionPoints:number;carryingCapacity:number;composition:UnitRoster}` in a focused army-domain selector. Version-aware recruitment uses the same existing duration formula and floor. Frontend code with missing online metadata resolves v1; local loading explicitly sets the current version for future orders after tagging old battles.

- [x] Write red tests for exact resource deductions and batch times for all roles at levels 1/3 and training boosts 1/1.2; pin five-second single-infantry minimum and 20-second ten-infantry batch. Assert all factions pay identical role prices/times. Test insufficient supplies, quantity limits, capacity, three queue slots and parallel training buildings.
- [x] Add tests for nonmutating inspection/army totals, base/faction/army-effective values with hero/research/smithy bonuses, unknown/rival army privacy, and old-online-server v1 prices. Assert choosing a new home doctrine changes future previews while existing formation snapshots remain byte-for-byte unchanged.
- [x] Implement version-aware pricing/duration selection and reference-stat presentation in existing panels. Show per-soldier costs, exact selected-batch training, composition, attack/protection totals and carry. Explain the standard comparison conditions succinctly. Fix the stale tooltip implying travel ignores the slowest troop; do not alter travel calculations or existing deadlines.
- [x] Regenerate SQL and run focused UI/domain, recruitment/army parity and account/research database tests. Keep selected role quantities and existing navigation intact.
- [x] Commit as `feat: show comparable unit and army stats with fair recruitment`.

## Task 4: Preserve old saves, active battles and report economics

**Files:** Modify `src/platform/storage/saves.ts`, local normalization, `src/features/campaign/domain/reportEconomics.ts`, battle/city settlement and loot helpers, corresponding SQL cost/finalizer/delivery functions, and `scripts/build-sql.mjs`. Extend save/report/battle database tests and create the guarded focused upgrade source under `supabase/modules/install`.

**Interfaces:** Version-aware `troopCost(troops,version=1)`; new private SQL `peris_roster_loss_cost(jsonb,jsonb,integer) returns jsonb`. Retain the two-argument SQL function as a current-version wrapper; calls resolving actual battles/reports must pass their explicit version. New results carry `balance_version`; missing historical metadata means v1. Generate `UPGRADE_UNIT_BALANCE.sql` from the exact affected definitions with independent explicit permissions.

- [x] Write red round-trip tests for v1 active elite/archer formations, legacy absent unit multipliers, research-adjusted v1 and v2 values, and all eleven captured factions. Reject unknown versions, invalid faction IDs, impossible role/class pairs, non-finite values and out-of-bound bonuses. Do not relax the existing checks into unconditional acceptance.
- [x] Write tests that queued training timestamps and paid balances remain unchanged across loading/upgrading; existing active battle clocks/formations stay unchanged. Assert a v1 loss uses v1 replacement prices after upgrade, a v2 loss uses v2 prices, and stored historical receipts are never recomputed. Include returning loot, overflow, missing cost fields and pruned battle references.
- [x] Implement version-aware validation/cost lookup and minimal additive normalization. Preserve the v6 save key/version and all ownership protections. Keep ordinary settlement once-only guards and report uniqueness unchanged.
- [x] Generate the focused upgrade, apply it twice to a populated isolated V19 fixture, and assert accounts, research, artifacts, social state, troop roles, queues, battles and reports are preserved. Upgrades must not schedule a worker or reseed geography. Never run SQL against a live project.
- [x] Run `test:db`, `test:fresh`, `test:integration-db`, `test:report-reads-db`, `test:hero-loot-db`, `test:command-receipts-db`, `test:army-parity-db`, `test:research-db` and affected local save/report suites.
- [x] Commit as `fix: retain legacy battle and recruitment economics across balance updates`.

## Task 5: Calibrate, inspect the UI and complete repository verification

**Files:** Create `scripts/check-unit-balance.mts`, deterministic scenario fixtures and `docs/unit-balance-v2.md`; modify only justified candidate catalog values and affected tests. Save calibration output under `output/unit-balance` and document the chosen release values and remaining limits.

**Interfaces:** `npm run check:unit-balance` verifies source/generated parity and a fast representative scenario set; `npm run balance:units` produces the full reproducible report. Each scenario records source/version, faction/doctrine, role counts, four-resource spend/unspent amounts, per-building training time, terrain, orientation, duration, winner, survivors and casualties. It calls the actual fixed-step simulation without rendering or modifying saved player data.

- [x] Write deterministic scenario assertions first: casualty conservation, finite/bounded state, zero unexplained timeouts, faction multiplier bounds, basic/advanced parity, shared economic rules, viable counter/raid/siege cases and reproducibility. Generate every faction pair and both orientations rather than sampling only Roman opponents.
- [x] Run the complete 990-battle baseline matrix from the design. Add equal-resource, equal-production-time and soldier-cap matrices, plus representative research/PVE checks. Target 40–60% pooled faction score on the agreed base matrix and a mix of wins/losses per faction. Report terrain/composition slices so an average cannot hide dominance. Treat research/endgame diagnostics separately from starting-balance claims.
- [x] Tune catalog candidates only in response to a named failing economic/tactical case. Preserve role/faction directions and modifier bounds; record before/after values and their effects. A mathematically equal reference score is insufficient. If the bounds cannot meet the target, report the limitation and request a design revision instead of weakening the check.
- [x] Run `npm test`, `npm run test:tooling`, `npm run assets:check`, `npm run build`, `npm run check:sql`, `npm run check:world`, `npm run check:bandits`, new generation/balance checks and all affected isolated database suites. Regeneration should repair the known checkout CRLF research-catalog check without changing the checker. Broaden testing only for new failures/changes.
- [ ] Run `npm run test:e2e`, exercise unit selection, inspection, recruitment and Rally comparisons with actual pointer interactions, and inspect desktop/mobile screenshots. Test the older online-server fixture. Do not claim real hosted database installation or browser functionality from static markup alone.
- [ ] Use verification-before-completion, review `git diff --check` and the branch diff, commit the measured catalog/documentation, and report passes, skips, pre-existing failures and unverified environments. The subsequent chat instruction authorizes pushing a review PR and merging main after verification; SQL deployment remains prohibited.

## Review and execution handoff

The proposed tables are initial values, and measured calibration is an explicit implementation task. Spec/plan self-review covers all nine roles and eleven factions, class coefficients, existing research, old-server behavior, faction switching, legacy saves, queues and receipts. After written approval, execute natively in this session using test-driven small commits; no parallel agents are needed for these coupled interfaces.
