# Guild Reinforcements Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task in this session.

**Goal:** Send selected troops to guildmates from member rows and track support in Events.

**Architecture:** Pure selectors expose eligible sources and project private support into Events. Existing online commands/receipts submit atomic server dispatch and recall; private snapshots supply authoritative progress.

**Tech Stack:** React 19, TypeScript 5.9, Supabase PostgreSQL, Playwright, PGlite.

**Spec:** `docs/superpowers/specs/2026-10-23-guild-reinforcements-design.md`

## Global Constraints

- Root application only; preserve eleven factions, wrapped routes, solo saves and public map privacy.
- 1–1,000 selected soldiers; atomic troop conservation and retry safety.
- Generate bundles; never deploy SQL.

## Review Focus

- Source changes and stale inventories must not dispatch incorrect amounts.
- Lost responses must replay the same receipt, never duplicate soldiers.
- Foreign users must not read or recall another player's support.
- Arrival, guild departure, ruined cities and recall use authoritative shared time.
- Nested dialog keyboard dismissal and phone width remain usable.

### Task 1: Restore compilable sources and authoritative reinforcement commands

Files: conflicted UI/server/generator files; `city/guild-reinforcements.sql`, `security/command-receipts.sql`, `snapshot/peris_snapshot.sql`, command DTO and RPC adapter; `tests/guild-reinforcements-database.test.mts`.
Interfaces: `reinforceGuild` with settlementId, optional armyId, targetCityId, troops, route; `recallGuildReinforcements` with reinforcementId. Participant snapshot DTO includes source/target identities, coordinates, faction, status, roster and timestamps.

- [x] Preserve upstream clocks/reliability while integrating guild conflict hunks.
- [x] Write/run failing isolated tests for army/garrison dispatch, insufficient stock, private status, receipts, arrival and recall.
- [x] Implement atomic source validation/deduction and shared-clock travel; generate SQL.
- [x] Run SQL generation and affected database suites.

### Task 2: Member action and compact picker

Files: social reinforcement domain/UI/style modules; `GuildsPanel.tsx`, `App.tsx`; unit selectors and browser tests.
Interfaces: pure `guildReinforcementSources(world, owner)` and popup `onSend(command): Promise<void>` using engine command journal.

- [x] Write/run failing source selector tests and browser flow.
- [x] Build member action, recipient-city/source selection, troop quantities, totals, ETA, send/error handling and pending-receipt recovery.
- [x] Verify source eligibility, changing sources, empty stock and narrow screens.

### Task 3: Events and full verification

Files: map activity selector, MapOperations and reinforcement details, polling, tests.
Interfaces: guild event identifier/status maps to participant snapshot; sender-owned stationed support can recall via command.

- [x] Write/run failing projection tests covering both participants and outsider privacy.
- [x] Add Events projection, details/recall and normal online refresh.
- [x] Run required unit/tooling/assets/build/e2e and affected DB checks; inspect screenshots.
- [x] Review full change and document results/limitations.

## Execution record

- Ruling: execute inline after the user's explicit “good go”; use a review branch in the shared checkout so the result is directly reviewable.
- Baseline: build and SQL generation fail on committed merge-conflict markers; four existing guild regex contract tests pass despite those failures.
- Review fixes: pin source selection (including initially empty pickers); reuse ordered, nonblocking participant locks for dispatch, recall and automatic return; preserve original recipient-city metadata; select an offscreen destination by canonical cell.
- Verification: 572 unit tests passed, one skipped; tooling, assets, build and SQL checks passed. Isolated guild tests pass at 1x/10x/100x including actual battle casualties, guild departure and repeat focused upgrades. Core/fresh/social/garrison/logistics/player-raid/battle-atomicity/clock-journey database suites pass. Four targeted desktop/phone browser cases pass; member, popup, retry, Map and live City screenshots inspected.
- Full browser sweep was interrupted after 11 failures outside the new guild reinforcement flow (112 passed and 6 skipped before stopping). Detailed results and remaining limitations are in `artifacts/guild-reinforcements/verification.txt`; logs and screenshots are retained under that directory and `test-results/`. No SQL deployed. No real multi-session PostgreSQL stress environment was available.
