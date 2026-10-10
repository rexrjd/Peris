# Automatic battles compatibility review

Reviewed on 10 October 2026 against main commit `a82e532f9e0c2d4a8834e3571c9f427bce3d9e76`.

## Recent commits

| Commit | Change | Integration status |
| --- | --- | --- |
| a82e532 | Faction unit models in campaign, multiplayer and quick battles | Preserved, including faction selection, portraits, presentation metadata and bounded online culture lookup |
| 91b475b | Mehdi map and unit prototypes merged into main | Map implementation and model assets retained |
| 9a77a4c | 99 faction unit prototypes and fantasy mounts | All faction assets, near/far models, textures and tooling retained |

## Finding and correction

The previously delivered automatic-battle ZIP was not directly compatible with latest main. Replacing its files would remove the newer 3D battle view, faction-aware practice arguments, online faction lookup and development dependencies.

This package merges the update onto latest main. It retains the current package-lock and the latest Playwright/model tooling, keeps 3D graphics as the default with the 2D fallback, and makes the 3D input spectator-only. Clicking inspects either army; dragging pans the camera. Manual move, attack, stance, spell and rally controls cannot override AI. Troop and siege inspection, faction portraits, mesh quality controls and WebGL context-loss fallback are retained. Casualty grids and strike animations follow the automatic battle state.

The mage-tower migration now retains `housing` in its building-type constraint before the population module runs. Previously, existing housing rows caused SQLSTATE 23514 during V11 upgrades. All complete SQL bundles are regenerated from the corrected source; `npm run test:slot-upgrade-db` verifies upgrade preservation and constraint enforcement.

The CSS import now precedes rules, so the spectator stylesheet loads without invalidating subsequent global stylesheet imports.

## Verification

| Check | Result |
| --- | --- |
| Latest main before the merge | Production build passed; 266 unit tests passed, one skipped |
| Merged unit suite | 278 passed, zero failed, one existing skip |
| Production TypeScript/Vite build | Passed |
| Tooling tests | Four passed |
| Registered model/asset validation | Passed; existing generated-tangent warnings remain |
| Generated SQL and world consistency | Passed |
| Automatic battle database tests | Passed: both-side AI, researched spells, command permissions, PvP starts, troop conservation, exactly-once rewards and existing-world upgrade |
| Existing housing regression | Reproduced SQLSTATE 23514 before the fix; passes after the fix with all eight building types, level-ten mage towers, research and heroes retained over repeated V11 upgrades |
| Legacy upgrade/database integration | Passed: preserves existing data, recruitment, travel, permissions, battle outcomes, invitations, rewards and public/private snapshots |
| Fresh database installation | Passed, including protection against installing over an existing world |
| Magic database integration | Passed: unique tower, ten levels, all twenty spells, hero scaling, research, mana, cooldown, resurrection and private AI executor access |
| Empire/hero database integration | Passed: multiple cities, settlers, armies, commander skills/equipment, selected-army casualties and migration reruns |
| Map snapshot database integration | Passed: bounded periodic snapshots, faction fields, canonical travel, privacy and retention |
| Browser test collection | All 34 desktop/mobile cases collect successfully; obsolete manual-control expectations updated |
| Browser execution / screenshots | Unverified: the normal browser download returned unusable HTML; the alternate isolated Chromium launch did not become ready and reported denied NETLINK access; the remote browser could not access the local dev server |

Code, data migrations and renderer contracts pass the listed checks. Full visual compatibility still requires running the browser suite on a machine with working Chromium/WebGL. No browser pass or screenshot approval is claimed.

## Applying the files

1. Start from the tested main commit and preserve any local edits.
2. Copy the matching file paths from this package into the repository. Alternatively apply `automatic-battles.patch` with `git apply --check` followed by `git apply`; use one method.
3. Run `npm ci`, `npm test`, `npm run build`, `npm run check:sql`, and `npm run test:automatic-db`. For graphical validation install Chromium with `npx playwright install chromium` and run `npm run test:e2e`.
4. For an existing Supabase world run `supabase/UPGRADE_TO_V11.sql`. Run the complete V11 upgrade after any older feature-only migrations. Use `FRESH_INSTALL_V11.sql` only for an empty database.

This review changes an isolated local checkout. It does not push commits, deploy the app, reset the original checkout or alter a live database. The package contains changed source files and a patch; the unchanged faction/model assets remain supplied by latest main.

Online combat is automatic for both armies, but there is no new background server scheduler. Unwatched online battles catch up when a client next polls them. Existing clients need the new code and V11 SQL together because tactical command RPCs now reject manual control.
