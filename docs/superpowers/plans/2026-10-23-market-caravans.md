# Market Caravans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build five-level Markets for all eleven factions and reliable resource caravans between owned/guild cities.
**Architecture:** Add the ordinary unique `bazaar` city slot, leaving legacy `market` Main building untouched. Pure TypeScript owns campaign trade and SQL owns shared-world transfers; both feed the existing city inspector and activity UI. Native procedural models supply all 55 appearances.
**Tech Stack:** Existing React 19, TypeScript, Three.js 0.186.1, Supabase PostgreSQL, PGlite and Playwright.
**Spec:** `docs/superpowers/specs/2026-10-23-market-caravans-design.md`

## Global Constraints

- One Market per city. Maximum level five. Capacity is 1,000 / 2,000 / 3,000 / 4,000 / 5,000 resource units at completed levels 1–5.
- Both outbound and returning merchants reserve their original dispatched volume.
- Preserve `market` Main building, Trading posts, saves, eleven factions and painted Village compatibility.
- Original native 3D City graphics; no new runtime library, images, GLBs or deployed SQL.
- Edit only `supabase/modules` SQL source, then regenerate bundles.
- Work on `review/market-caravans`; do not push or merge as part of implementation.

## Review Focus

- Recipient activity advancing past a pending arrival must not change storage headroom at delivery.
- Duplicate confirmation/retry must debit and deliver exactly once.
- Full food storage and full material storage are independent and overflow returns without loss.
- Guild departure or city destruction must not credit an ineligible/new owner.
- Imported malformed trade dates/cargo must be rejected, while old saves still load.

## Shared interfaces

`TradeCaravan` in `src/features/city/domain/trade.ts`: `id`, `owner_id`, `recipient_id`, `source_settlement_id`, `target_settlement_id`, `source_city`, `target_city`, `resources: Resources`, `returning_resources: Resources`, `delivered_resources: Resources`, `volume`, `march_path: [number,number][]`, `departure_at`, `arrival_at`, `return_at`, `status: 'outbound'|'returning'|'waiting'|'stranded'|'completed'`, optional `return_settlement_id`.

`World.trade_caravans?: TradeCaravan[]`; command `{type:'sendResources';settlementId:number;targetCityId:number;resources:Resources;route?:[number,number][]}`. Online RPC `peris_send_resources(p_source bigint,p_target bigint,p_resources jsonb,p_path jsonb)`; targets RPC `peris_trade_targets()` returns own/guild living cities `{id,name,owner_id,owner_name,x,y}`. Snapshot key `trade_caravans` uses the shared DTO. `marketCapacity(world,sid)` returns `{total,used,available}`. `resourceTotal(resources)` returns summed resource units.

### Task 1: Campaign building and trade domain

**Files:** create `src/features/city/domain/trade.ts`, `tests/market.test.ts`; modify `slots.ts`, `slotCommands.ts`, `world.ts`, `commands.ts`, `LocalEngine.ts`, campaign `settlement.ts`, storage `saves.ts`.
**Interfaces:** Produce shared DTO, `marketCapacity`, `resourceTotal`, `sendResources`, chronological trade event advancement and validated persisted campaign state.

- [x] Write tests for capacity `[0,1000,2000,3000,4000,5000]`, one Market including unfinished construction, positive whole mixed cargo, resource debit, return-held capacity and own-city eligibility.
- [x] Run `node --import tsx --test tests/market.test.ts`; observe missing feature failure.
- [x] Implement unique `bazaar` slot, cost `{wood:220,stone:180,food:100,gold:50}`, max five, command and pure domain lifecycle at 22 units/game-second.
- [x] Integrate chronological delivery/return events with ordinary upgrades/production, overflowing returns, waiting unloading, ruined-city rerouting and old-save defaults/strict validation.
- [x] Extend tests for food/material overflow, long-absence equivalence, ruined target/source, disconnected/seam routes and invalid/old saves; run all relevant domain tests green.

### Task 2: Authoritative online trade

**Files:** create `supabase/modules/city/market.sql`, private optional trade hooks, `tests/market-database.test.mts`; modify city-slot construction, settlement, snapshot, worker, receipts, module manifest, `scripts/build-sql.mjs`, package scripts and generated bundles.
**Interfaces:** Consume the shared DTO/RPC contracts above. Produce atomic participant-private transfers, target read, once-only worker delivery and focused `UPGRADE_MARKET.sql`.

- [x] Write PGlite tests against the fresh installer for Market construction, guild/own eligibility, strict quantities, capacity and receipt replay; run to observe missing-feature failure.
- [x] Implement row-locked authority, participant-private RLS/snapshots, correct food/material capacities, chronological incoming delivery integration and ordered lock retries. No rewinding recipient resources or skipping a due incoming delivery before advancing resources.
- [x] Implement overflow return/waiting/ruined-city behavior, worker due work and bounded completed receipts. Preserve optional-hook compatibility with older focused installers.
- [x] Regenerate SQL; run fresh/upgrade Market tests at clock rates 1/10/100, privacy, worker, opposite-direction dispatch, invalid routes, overflow and membership departure cases.
- [x] Run SQL checks plus affected city/social/guild/logistics/clock isolated suites. Do not deploy SQL.

### Task 3: Native faction Market models

**Files:** create `src/features/city/rendering/three/market.ts`, `tests/market-art.test.ts`; modify `slotModels.ts`, appropriate icon/compatibility paths and `ARTWORK.md`.
**Interfaces:** `createMarket(level:number,faction:Faction,animated?:boolean):THREE.Group` consumed by `createSlotModel('bazaar',...)` and existing thumbnails/previews.

- [x] Write geometry tests for all eleven factions and levels 0–5: finite vertices, footprint, distinct geometry per stage/faction and bounded material batches; observe absent factory failure.
- [x] Build original stalls/counters/cargo, then cart, merchant hall, arcade and grand gateway through five stages, with the exact faction identities in the spec.
- [x] Wire native previews, compatibility fallback and disposal; verify models with targeted tests and later browser contact sheet.

### Task 4: Market trade UI and activity

**Files:** create `src/features/city/ui/MarketPanel.tsx` and feature styles; modify `BuildingDialog.tsx`, `BuildingPicker.tsx`, online RPC mapping, polling/activity integration, `src/features/map/domain/activity.ts` and activity display.
**Interfaces:** Consume Task 1 selectors/DTO and Task 2 target/dispatch RPCs; use existing `run` command/receipt recovery flow and shared clock.

- [x] Add meaningful UI tests for Market picker uniqueness, tab/quantity limits, destination selection, explicit confirmation, errors and selected-city filtering; observe absent behavior failure.
- [x] Add Trade/Upgrade tabs, owner/guild destinations, four quantities, Max, total/free capacity, outbound/return estimates and exact-cargo review. Preserve input on errors and retry pending receipts via the existing engine.
- [x] Integrate outgoing/incoming/return/waiting rows into City/Map Events and Market panel; keep private participant boundaries.
- [x] Verify desktop/phone keyboard/pointer flows, stale city/destination changes and compatibility fallback.

### Task 5: Whole-feature verification and review

**Files:** `tests/e2e/market.spec.ts`, screenshot artifacts, design/plan progress and artwork documentation.

- [x] Run `npm test`, `npm run test:tooling`, `npm run assets:check`, `npm run build`, `npm run check:sql`, fresh/affected isolated database suites and `npm run test:e2e`.
- [x] Inspect actual screenshots of all 55 faction/level models, in-city early/mature Markets and desktop/phone send/review/return behavior. Use pointer/keyboard interactions, not canvas accessibility alone.
- [x] Dispatch fresh whole-branch spec/code review; fix consequential findings and rerun affected checks.
- [x] Commit reviewed feature on the review branch and report checks plus any genuine remaining environment limitations. No push, merge, publish or SQL deployment.

## Execution rulings and progress

- Baseline before implementation: 572 gameplay tests passed, one skipped; tooling 5/5; asset check and production build passed with existing GLB/chunk warnings.
- Use the existing clean review branch in the active checkout. A second worktree would move the requested live root application unnecessarily; main remains unchanged.
- Execute tightly coupled domain/UI integration here. The self-contained authoritative SQL task can be assigned to one implementation agent once the shared contracts are fixed; no overlapping file ownership or simultaneous implementation subagents.

- Review regressions fixed and tested: research/storage deadline chronology; imported return-route/date/topology validation; clearing accepted drafts after global receipt recovery; and zero-distance ruined-home reroutes preserving valid saves.
- Final unit suite: 585 passed, one skipped. Build, tooling, assets, SQL generation and Market database tests at 1?/10?/100? passed. Actual independent-session PostgreSQL remains an explicit environment skip.
- Full browser run: 236 passed, 25 skipped, 21 failures. The feature-related nine-to-ten building choice assertion was corrected and passed on both layouts. Other failures are being compared with the detached pre-Market revision; see MARKET_UPDATE.md and final verification record.
