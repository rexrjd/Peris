# Automatic trade routes verification

Branch: `review/automatic-trade-routes`. Base: `370cf37` (completed faction Markets and manual caravans). Feature commit: `3f7281d`; final arrival-ordering fix: `8b60be6`.

## Feature and research

Implemented owner-private repeating Market instructions and direct guild-member resource support. The Market and guild dialog share exact mixed-cargo review and route editing/management. Routes use existing caravans, capacity, land paths, game clocks, receipt recovery and unattended server settlement. See `AUTOMATIC_TRADE_ROUTES.md` for player behavior and the official Travian research source.

## Verified

- `npm.cmd test`: 595 passed, 1 skipped, 0 failed (596 tests), including the final army-arrival ordering regression.
- `npm.cmd run test:tooling`: 5 passed.
- `npm.cmd run assets:check`: passed, 46 registered GLBs and existing artwork/font checks. Existing model portability/unused-object warnings remain; no asset-validation errors. No new model or Blender changes.
- `npm.cmd run build`: passed, including TypeScript, artwork checks and Vite. Existing bundle-size warning remains.
- `npm.cmd run check:sql`: passed after generated installers were rebuilt.
- `npm.cmd run test:trade-routes-db`: passed at 1×, 10× and 100×. Covers receipts and lost replies, owner-only schedules, no-Market/invalid schedules, future stock and carrying availability, 20 routes per city, merchant/stock shortages, repeated and delayed settlement, no catch-up burst, return-timed batches, edit/pause/resume/delete, membership/ownership/ruins, and populated repeatable upgrades.
- Existing affected isolated database suites passed: Market, guild reinforcements, social (58 checks), clock, clock gameplay, clock upgrades, clock journeys, general database and fresh installation.
- Independent read-only review found no consequential issues and independently reran the initial 9 domain route tests and all three clock profiles of the route database suite. The final route suite contains 10 tests after adding the arrival-ordering regression.

## Browser verification

Actual Playwright pointer/keyboard workflows cover the live 3D City Market, exact mixed cargo, departure/arrival selection, route create/edit/pause/resume/delete, guild member targeting, missing source Market, native-dialog Escape behavior, and command acknowledgement recovery without duplicate schedules. Existing caravan and guild reinforcement regressions are included. Desktop/phone screenshot layouts are inspected.

The initial focused run caught a missing explicit native-dialog role, which let the parent modal handle Escape. It was fixed. The final `guild-trade.spec.ts` and `trade-routes.spec.ts` run passed all 4 desktop/phone workflows. Existing manual Market, manual acknowledgement recovery and guild reinforcement flows also passed on both layouts in the broader focused run. Route interval wording was made explicit in game minutes, and the final 4 workflows passed after that change.

Inspected screenshots include the live City route review/manager, phone guild member actions, and guild route editor/manager. No horizontal overflow was observed, keyboard Escape preserved the guild screen, and receipt retry left exactly one private schedule. Full-run artifacts are isolated under `artifacts/automatic-routes-full-e2e/`, with selected captures preserved under `artifacts/automatic-routes/`.

Final settlement review found that local routes attempted departure before the existing army-arrival/loot loop. A new test first failed with zero sends despite arriving cargo covering the order, then passed after route advancement moved behind that loop. This matches the server's core-settlement-before-route ordering. Partial raid/import settlement also leaves route timestamps and counters untouched until a full arrival pass; the same regression verifies both passes. The reviewer confirmed this guard, and all 10 route domain tests and the full unit suite/build passed. Both City route browser workflows passed after moving the call; the full phone suite covers the final guard as well.

## Complete browser result and baseline separation

`npm.cmd run test:e2e -- --output=artifacts/automatic-routes-full-e2e --reporter=line` completed in 36 minutes using a separate local test port: **243 passed, 25 skipped, 20 failed**. All new route/guild workflows passed on both layouts, as did existing Market shipment/recovery and guild reinforcement flows. The desktop Market contact sheet also passed (the phone contact-sheet case is intentionally skipped).

All 20 failures match the previously documented baseline classes: four obsolete `Recruiting legion` selectors, duplicate city card/preview selectors after the garrison dock was added, and preserved City Events/reinforcement labels or attributes. Desktop has 11 of these failures and phone has 9. Exact names and traces remain in `artifacts/automatic-routes-full-e2e.log` and the isolated artifact directory. See the previous Market verification report for reproduction on detached baseline `c802709`. No unrelated check was weakened or changed to make this run pass; the full suite remains red because of those existing failures.

## Limits

PGlite uses one database connection. Independent-session lock contention was not exercised because `PERIS_TEST_DATABASE_URL` is unset and no local PostgreSQL runtime is installed. Sequential receipt and settlement checks do not establish concurrent-server or load performance. No production SQL deployment, push, hosted-world change or Blender verification is claimed.

The preceding Market feature documented 20 unrelated baseline browser failures, including old recruitment selectors, duplicate garrison text and Events labels. Compare the current complete run with `docs/superpowers/verification/2026-10-23-market-caravans.md`; do not weaken those checks as part of this feature.
