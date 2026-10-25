# World HUD, lock recovery and social styling — 26 October 2026

## Delivered

- Shared-world sync, private snapshot and map polls recognize PostgreSQL lock contention (`55P03`, or the exact uncoded `lock_not_available` message). The client retains loaded state and retries through the existing 5–60 second backoff. Short conflicts do not replace the map with a raw warning. Persistent contention gives a readable automatic-retry status; a genuine existing error remains visible until a successful read. Initial state loading makes at most three attempts without re-entering the account or replaying orders.
- Map rotation controls now sit directly above the minimap in its dock. Existing rotation handlers, keyboard controls, view controls, minimap navigation and Canvas fallback are preserved.
- Guilds and Messages, including native trade and reinforcement dialogs, use the selected city's existing scene colors, textures, thin borders, Cinzel headings and compact controls. The local social wrapper also works over the compatible painted City without restyling that background.
- Owned-city loyalty is integrated beside Land in the city preview's stats strip. The separate floating panel is gone. Recovery information appears on hover or keyboard focus and closes with Escape. Existing loyalty calculation, ownership/ruin privacy guards and selected-city behavior remain intact.

No SQL, domain rules, models, assets, dependencies, private data boundaries or save formats changed. Nothing was pushed, merged or deployed.

## Checks

| Check | Result |
| --- | --- |
| `npm.cmd test` | 673 tests: 672 passed, 1 existing skip, 0 failed. Includes four new account lock-recovery tests. |
| `npm.cmd run test:tooling` | 5 passed. |
| `npm.cmd run assets:check` | Passed: 46 registered GLBs, 33 Rally paintings and existing checks. |
| `npm.cmd run build` | Passed; existing chunk-size warning remains. |
| HUD/shared city selector/header browser suites | 8 passed on desktop and mobile. |
| Social material and populated UI coverage plus existing social/trade/reinforcement suites | 14 passed across desktop and mobile. |
| Online lock recovery and existing polling-controller suites | 18 passed across desktop and mobile. |
| Stronger genuine-error retention regression | 2 passed after reproducing and fixing replacement of an older genuine error after repeated locks. |
| Final integrated social/HUD rerun | 8 passed, including all eleven faction materials, populated forms/conversations, 320px layouts and 740×360 landscape. |
| `git diff --check` | Passed. |

The browser suites cover 40 distinct desktop/mobile cases, with the final refinements rerun separately. Root logs are `artifacts/world-hud-final.log`, `artifacts/world-lock-final.log`, `artifacts/world-lock-retention-green.log`, and `artifacts/world-social-integration.log`. Existing social regression evidence is in `artifacts/world-social-polish/social-final/.last-run.json` (passed) and its per-case captures. All social sending and database error injection use isolated test accounts/services, not real conversations or production state.

## Regression and visual evidence

The lock regression first reproduced the raw top warning. Tests inject transient locks into each polling endpoint, require later recovery, verify unchanged private/public snapshots, retain pending mutation receipts without sending them, and keep permission errors visible through sustained locks. Exhausted account loading is bounded and retains its failure code. Account credentials and command intent behavior remain unchanged.

The HUD tests first failed because rotation was outside the minimap dock and loyalty was outside the city card. Final checks use actual pointer interactions on the 3D map and observe projected army-marker movement after rotation. They also click the minimap and focus controls, switch cities, enter the live 3D City, focus loyalty help and inspect narrow/landscape geometry. An older broad city-preview test selector matched the existing garrison emblem as well as the city thumbnail; it now targets the actual thumbnail and city selector explicitly.

The social material regression first reproduced the old slate palette. Final tests compare actual Map material with both social overlays for all eleven factions. Populated fixtures cover directory and member searches, settings and crests, ranks/invites, treasury/diplomacy, guild chat, private message sending/history, unread behavior, archive/block/restore, and native trade/reinforcement pickers and recovery. A focused test caught inherited modal input margins making search rows too tall; scoped social resets keep those controls compact.

Actual screenshots were inspected for desktop Guilds, 320px Messages, city loyalty, native 3D map rotation, all representative faction materials and the compact input refinements. Stable previews in `artifacts/world-social-polish/` are `preview-map.png`, `preview-loyalty-320.png`, `preview-guilds.png` and `preview-messages.png`. The final integrated captures are under `integration-results/`; initial lock diagnostics and final recovery captures are under `lock-final/` and `retention-green/`.

## Review and limits

A fresh read-only review inspected the complete production diff, regression coverage and actual HUD/social screenshots and found no material issues. It included the stronger genuine-error retention fix. An independent live low-height probe was interrupted by a test-server shutdown; the final integrated browser rerun subsequently passed actual 740×360 layout checks.

No Blender verification is needed for these client UI/polling changes, and no FPS or live production contention claim is made. The fix recovers from temporary database locks; it does not remove legitimate server-side concurrency protection. Existing genuine failures remain visible.

Saved on `review/world-social-polish`.
