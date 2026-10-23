# Automatic Trade Routes Implementation Plan

> **For agentic workers:** Use executing-plans for the coupled domain/UI work. The independent SQL task may use one delegated implementer under dispatching-parallel-agents, followed by a whole-feature review.

**Goal:** Repeating Market caravans and direct guild support actions.
**Architecture:** Persist owner-private route schedules; authoritative domain/server code dispatches existing caravans; reuse the cargo editor in City and a guild support dialog.
**Tech Stack:** Existing TypeScript, React, Supabase PostgreSQL/PGlite and Playwright.
**Spec:** `docs/superpowers/specs/2026-10-23-automatic-trade-routes-design.md`

## Global constraints and interfaces

Use the exact DTO/command/RPC/scheduling contract in the spec. Preserve Market capacity and legacy main-building IDs, all factions, saves and privacy. No new dependency, deployed SQL or changes to legacy copies. Source SQL generates all installers. Work on `review/automatic-trade-routes`.

## Review focus

Repeated settlement at the same instant must not duplicate a scheduled departure. Delayed processing must not replay a burst. Batch deliveries wait for actual return capacity. Guild departure must stop future support. Acknowledged receipt recovery must finish both manual and route editors.

### Task 1: Domain route commands, scheduler and persistence

- [x] Write failing `tests/trade-routes.test.ts` for route creation/validation, scheduling, batches, skipped runs, ownership and pause/delete/edit.
- [x] Add `tradeRoutes.ts`, optional World DTO and typed commands; wire LocalEngine, campaign settlement, IDs, saves and online RPC mapping.
- [x] Dispatch through `sendResources`, preserving existing cargo lifecycle; use one due attempt per route per pass and injected game time.
- [x] Verify malformed/old saves, repeated settlement, overdue coalescing, workers/capacity and all affected domain tests.

### Task 2: Online authority and worker

- [x] Write failing PGlite route tests, then add owner-private route schema/RLS, receipt-only command, shared caravan dispatch core, due hooks, locked worker scheduling and private snapshots.
- [x] Refactor existing Market helpers minimally so worker sends do not need client auth or recursively settle. Include active route recipient locks in the existing component lock discipline.
- [x] Generate `UPGRADE_TRADE_ROUTES.sql` and all bundles. Verify 1/10/100 clocks, no duplicate sends/catch-up burst, batches, strict validation, stock/capacity skips, guild departure/ruins, privacy and installer reruns.
- [x] Run affected Market/guild/social/clock/fresh/general database suites and SQL generation checks.

### Task 3: Market and guild UI

- [x] Add failing UI/browser cases for route controls and member Send caravan/Create automatic route actions.
- [x] Extend the shared editor with schedule/review and a source-city Routes manager; retain exact-cargo manual sending and receipt recovery.
- [x] Add guild support dialog with eligible own Markets and selected member cities; wire existing App command journal and retry behavior. Keep narrow layouts and keyboard flow usable.
- [x] Verify create/edit/pause/resume/delete, guild member targeting, unavailable Market/target feedback, server errors and acknowledgement recovery on desktop/phone.

### Task 4: Verification and delivery

- [x] Run unit/tooling/assets/build, SQL generation and affected database suites. Run full browser suite and focused new workflows; inspect screenshots and separate documented baseline failures.
- [x] Independently review final source, fix consequential findings and rerun affected checks. Record Travian sources and the Peris scheduling/eligibility choices in update documentation.
- [x] Commit the feature on the review branch. No push, main merge or SQL deployment.
