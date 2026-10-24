# City capture implementation plan

Spec: `docs/superpowers/specs/2026-10-24-city-capture-design.md`.
Base: `f045b39`, branch `review/city-capture`. Root app only; no deployment/push.

## Shared contracts

`World.conquest_version?:1`; private `Settlement.loyalty?:number`, `loyalty_updated_at?:string`. Structured BattleResult.conquest receipt. Add `diplomat` tenth roster role in both catalogs with `building:'main'`, foot infantry class, crop upkeep1/hour, cost400/200/600/100, training200seconds, speed30, attack.1/defence.5/carry0. Diplomacy research unlocks the unit. Existing nine role stats remain unchanged. Reuse raidCity commands and finalizers; no capital/last-city immunity. All surviving participating diplomats count, max25 loyalty/attack. Culture eligibility matches settling; spend only on capture.

## Task 1 — Shared catalog and pure domain (root)

Write failing tests for loyalty recovery/caps, victory/surviving diplomat selection/cap, culture eligibility and one-time spending, capture/occupation and former-owner cleanup. Extend roster/catalog/training/research and source generator. Implement pure loyalty/transfer helper and integrate battle finalization, versioned fresh/load metadata and validated save fields. Revalidate transport/settler destinations after ownership changes. Run targeted tests RED→GREEN and full unit suite.

## Task 2 — Authoritative server (independent SQL scope)

SQL implementer owns supabase module sources and build-sql generator plus new database tests. Mirror domain rules, training/research, all ten-role roster arrays/validation and crop accounting, ownership cleanup/foreign arrivals, receipts and sorted participant locks. Generate focused City Capture upgrade and bundles. Test repeatable migration, completed/dead/partial diplomats, culture, captured last city, private rival DTOs, ownership changes in flight and 1/10/100 clocks. No SQL deployment.

## Task 3 — UI and original unit visuals (independent UI scope)

UI implementer owns feature UI/rendering, original diplomat icons/names/presentation, capture action/march review, main-building recruitment and city loyalty/report UI, plus targeted browser tests. Consume shared root contracts; keep private loyalty hidden on rival map. Preserve all11factions, existing3D/Canvasbattleflows and older-server gating. Add original lightweight procedural diplomat visuals; reuse existing faction art direction, not copyrighted reference assets. Root owns domain/types/save files.

## Task 4 — Verification/review/integration (root)

Integrate independent scopes; repair type errors and test actual behavior, not implementation text. Run unit/tooling/assets/build, SQL/world generation checks and affected isolated database suites, and affected Playwright desktop/mobile flows with inspected images. Fresh whole-branch review; fix material findings with regressions. Record exact results/limits and commit on review branch, keeping SQL undeployed.

## Review focus

Ten-role conservation through every roster, crop refund and legacy save; attacker casualties before persuasion; concurrent culture/capture rechecks and report replay; last-city defeat versus surviving-owner evacuation; transports/settlers/merchant resources never delivered to a new enemy owner; ownership/culture bonuses updated at exact game-time boundary; rival loyalty/economy stays private; activation/reruns never restore damaged loyalty or unsupported old-server capabilities.
