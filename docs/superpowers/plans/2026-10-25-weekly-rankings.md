# Weekly Rankings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship a top-navigation Rankings view with five authoritative weekly Top 10 boards and the player's own rank.

**Architecture:** Private SQL aggregates and triggers preserve authoritative scoring without changing the battle/economy finalizers. A bounded read RPC and pure local counterpart expose one shared DTO to the React view. Server, local-domain and UI ownership are separate for parallel work.

**Tech Stack:** Existing React 19.1.1 / TypeScript / Supabase PostgreSQL / PGlite / Playwright. No new dependency or art asset.

**Spec:** `docs/superpowers/specs/2026-10-25-weekly-rankings-design.md`

## Global Constraints

- Root app only; preserve all eleven factions, saves, current city/battle/navigation flows and the prior siege food fix.
- Domain code remains independent of UI/browser/engine and frame rate. No runtime import cycles.
- Edit database source in `supabase/modules`, regenerate bundles; no production SQL deployment, push or main merge.
- Monday 00:00 UTC real-calendar weeks, independent of game speed; current and previous week only.
- Exact-once scoring, excluded practice/scouting/starvation, conserved proportional guild defense credit.
- Public output contains only bounded rankings metadata; raw score/receipt/contribution tables and helpers remain private.
- The shared DTO and GameEngine interface are exactly the spec's Shared interface.
- User authorized choosing details and implementing; continue without design/execution permission questions.

## Review Focus

- A battle finalizer changes ownership and deletes guild troops before its final status update: defense attribution must survive.
- Historical report edits, focused installer reruns and repeated finalization must not award scores twice.
- Sunday/Monday boundaries and accelerated clocks must preserve a real seven-day week and the previous standings.
- Captures, ruins, initial capitals and newly founded cities must produce correct signed growth without migration windfalls.
- Fast period changes, navigation/unmount and missing old-server RPCs must not show wrong-week or wrong-player data.

### Task 1: Authoritative scoring and bounded read API (server agent)

**Files:** Create `supabase/modules/rankings/rankings.sql`, `tests/rankings-database.test.mts`; modify `supabase/modules/manifest.json`, `supabase/modules/security/permissions.sql`, `scripts/build-sql.mjs` and generated bundles only. Do not edit App, engine or local domain files.

**Interfaces:** Produce `peris_rankings(p_period text default 'current')` returning the exact shared DTO. Source contains private receipts/defender attribution/weekly totals and triggers. Add focused generated `UPGRADE_WEEKLY_RANKINGS.sql` without capability migration side effects.

- [x] Write a failing isolated database test using current fresh SQL and two/three actual player identities. Prove new RPC is absent before implementing.
- [x] Add schema, activation, UTC week helpers, crop-weighted formation kill scoring excluding starvation, captured defense weights and exact integer split, robber loot and net population triggers. Capture active battles' contribution weights at installation, without scoring old finished battles.
- [x] Add authenticated-only RPC, Top 10 / self rank / ties / previous-week output; deny raw table/helper access. Include current public guild tags.
- [x] Add source generation and final permission grant; test focused install twice with unchanged pending battle and previously earned totals. Existing installers must retain triggers and regrant the RPC on full reruns.
- [x] Verify real battle outcomes/camp/raid/capture/ruin, zero/scout/practice/starvation, guild owner attribution, report pruning, replay, UTC rollover and rate 1/10/100. Run targeted tests and SQL generation check.
- [x] Self-review and report changed files, evidence and limitations to parent; do not commit shared work or deploy.

### Task 2: Local campaign parity and save compatibility (domain agent)

**Files:** Create `src/features/rankings/domain/types.ts`, `rankings.ts`, `validation.ts`, `tests/rankings.test.ts`; modify `src/shared/model/world.ts`, local battle/campaign hooks as needed, `src/engine/local/LocalEngine.ts`, `src/platform/storage/saves.ts`. This agent owns DTO types and optional World state. Do not edit App, GameEngine contracts, OnlineEngine or SQL.

**Interfaces:** Implement `LocalEngine.rankings(period): Promise<RankingsResponse>` and pure helpers. DTO exactly matches spec. Notify UI/server agents once types are written; they may build against the documented contract meanwhile.

- [x] Write failing tests for UTC weeks, weighted kills/exclusions, integer defense shares, loot and signed growth, ties/self/Top10, historical baseline and replay/save validation.
- [x] Implement serializable ranking state with bounded previous/current totals, receipts and pending defender ownership. Establish baselines before mutations; never score historical resolved outcomes on migration.
- [x] Hook completed battle scoring after final loot/capture. Capture defending ownership before pools disappear. Synchronize net population after gameplay settlement/mutations, excluding initial starting stock. Keep practice isolated.
- [x] Add engine read method, persist/validate ranking metadata on imported saves, support legacy saves unchanged. Guard pending-battle hydration and repeated reload/finalization.
- [x] Run domain, architecture/save tests and TypeScript/build where available; self-review and report to parent without committing.

### Task 3: Rankings view, top navigation and online adapter (UI agent)

**Files:** Create `src/features/rankings/ui/RankingsView.tsx`, optional hook, `src/features/rankings/platform/client.ts`, `src/features/rankings/styles/rankings.css`, `tests/rankings-ui.test.ts`; modify `src/shared/ui/GameNavigation.tsx`, `src/app/App.tsx`, `src/app/styles/index.css`, relevant navigation CSS, `src/engine/contracts.ts`, `src/engine/online/OnlineEngine.ts`. Do not edit LocalEngine, World, ranking DTO source or SQL.

**Interfaces:** Consume shared DTO spec and `GameEngine.rankings`. Online method calls existing authenticated RPC adapter with `{p_period:period}` and validates the bounded response. Local implementation arrives from Task 2. Do not compute authoritative scores in UI.

- [x] Add failing meaningful UI/adapter tests for seven-item navigation, five tables and units, own unranked/outside Top10, error/old-server states and period response handling.
- [x] Add real Rankings view in top nav, consistent with existing fantasy theme; accessible responsive tables and This week/Last week selector, tracking-since/UTC reset text, empty/loading/retry and solo scope. Use existing vector icon system without fake art paths.
- [x] Fetch only while view is mounted; bound refresh to visible intervals, clean up and discard stale responses after period/player changes. Validate server response, require no global core/map snapshot expansion.
- [x] Preserve existing navigation and responsive header behavior, including reports popup. Run UI/adapter tests and TypeScript where integration permits. Report changed files/evidence, no shared commit.

### Task 4: Integrated verification, browser review and packaging (parent)

**Files:** Add `tests/e2e/rankings.spec.ts`; extend `tests/helpers/account-server.mjs` RPC allowlist as needed; add package test command and verification notes. Read changes from every task, resolve overlaps, then regenerate source bundles.

- [x] Review task diffs/contracts and run their focused tests. Ask fresh reviewers for scoped correctness/spec/privacy reviews; resolve important findings.
- [x] Test actual local and isolated-online Rankings through pointer/keyboard interactions at desktop/mobile sizes, including period switching, error/retry and old-server behavior. Inspect captured screenshots for layout/overflow/visual consistency.
- [x] Run `npm test`, `npm run test:tooling`, `npm run assets:check`, `npm run build`, SQL/world generation checks and affected isolated ranking/general/fresh/crop/capture/raid suites. Rerun changed UI/header e2e as appropriate. Separate existing failures without weakening checks.
- [x] Record exact evidence and SQL deployment boundary; commit on the review branch after verification. No merge, push or hosted database mutation.
