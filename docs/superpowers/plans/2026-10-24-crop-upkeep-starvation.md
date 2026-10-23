# Crop upkeep implementation plan

Spec: `docs/superpowers/specs/2026-10-24-crop-upkeep-starvation-design.md`
Base: `ba19265`; branch: `review/crop-upkeep-starvation`.

## Constraints and interfaces

Root application only. Pure domain and authoritative SQL share rates, source selection, event order, migration and private DTO fields. `food_upkeep` remains residents; `food_troop_upkeep` is crop/minute; net `food_rate` subtracts both. World enablement is `troop_upkeep_version: 1`. Legacy saves settle before activation. No SQL deployment or push.

## Task 1: Pure supply and depletion

Write failing tests for nine role rates, force enumeration, host/source changes, staging, tier/row/role priorities, exact depletion boundary, refund integration, paused resident growth, tick partition invariance and projections without troop mutation. Implement canonical force rows and starvation mutation plus population integration and authoritative accrual. Preserve legacy absent-field semantics.

Run `npx.cmd tsx --test tests/troop-supply.test.ts tests/crop-upkeep.test.ts`; expect all pass after observing initial failures.

## Task 2: Chronology, activation and battle compatibility

Test event-time arrival/recruit/delivery accounting, long offline catch-up, fresh/legacy save activation, active-battle starvation and healing caps, permanent combat refunds once, newly added troops preserved, clocks and privacy. Implement enabled settlement coordinator, command refresh, private save validation and battle loss receipts. Existing legacy coordinator remains for migration. Supply transitions occur even on partial raid passes; routes launch only on full passes.

Run affected domain suites and then `npm.cmd test`; baseline is 595 pass, 1 skip.

## Task 3: Authoritative database (independent SQL scope)

Implement module source, activation, canonical force selector, population/starvation accrual, chronological transitions, component locks, battle receipts/caps/refunds, private snapshot version and idle worker scheduling. Add isolated PGlite/optional PostgreSQL tests for migration, deterministic chronology, all stores, idempotency, privacy, clocks and work budgets. Generate SQL bundles and focused upgrade using generator. Do not deploy. Agent owns SQL modules, generator and new database test only; root owns TypeScript application and UI.

Run generation checks and affected database suites at 1/10/100 game clocks; retain existing market/guild/logistics behavior.

## Task 4: UI and integration

Show hourly unit/army upkeep, city production/resident/troop/net balance, depletion estimate and starvation loss warning. Use enabled authoritative state and mutation-free projection. Add functional browser tests for city/army/recruit information on desktop/mobile. Run full required unit/tooling/assets/build, generation/affected DB and e2e checks; inspect captures. Record baseline e2e failures separately.

## Task 5: Review and completion

Fresh whole-branch review focusing on supply double-counting, external event ordering, destroyed-city fallbacks, battle conservation/healing, migration and privacy. Fix material findings with regression tests. Record evidence and limitations, commit on review branch and report; no push/deploy.

## Review focus

Check each troop store and direction of travel; equal timestamp crop rescue; partition invariance; late commands after long offline periods; battle source snapshots plus new recruits; starvation healing cap; receipts surviving repeated finalization; old saves and old servers; SQL connected participants, idle worker retries and non-retroactive migration. No silent work-budget truncation.
