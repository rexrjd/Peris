# Management scene style verification — 2026-10-25

## Delivered

Armies, Rally Point and Research now use the selected city's existing scene palette and texture, matching Map, live 3D City and Rankings. Headers, tabs, spacing, portraits and stat cards are more compact. Rally retains a bounded scrolling panel and uses the standard game header/mobile destination dock. Its previously unstyled movement summaries now have readable compact rows.

Recruitment, troop dossiers, Raise Army and bonus tooltip body portals retain the originating faction materials. Raise Army changes its preview theme when its city selection changes. Bonus colors remain readable on the dark surfaces. Technology node geometry, research logic, commands, privacy and save formats are unchanged. No SQL, models, artwork exports, dependencies or legacy copies changed.

## Checks

| Command | Result |
| --- | --- |
| `npm.cmd test` | 669 tests: 668 passed, 1 existing skip, 0 failed. |
| `npm.cmd run test:tooling` | 5 passed. |
| `npm.cmd run assets:check` | Passed; 46 registered GLBs, 33 Rally paintings and existing asset checks. |
| `npm.cmd run build` | Passed; existing chunk-size warning remains. |
| `npm.cmd run test:e2e -- tests/e2e/management-scene-style.spec.ts tests/e2e/rally-point.spec.ts tests/e2e/research.spec.ts tests/e2e/compact-header.spec.ts` | 34 passed across desktop Chromium and Pixel 7 mobile, including explicit 320px cases. |
| `git diff --check` | Passed. |

The material regression first failed on the preceding implementation: Armies retained a slate header with no faction texture. Final browser coverage checks actual computed Map materials against all three screens for Roman, Persian and Elf cities; compact heading dimensions; portal materials and Raise Army city switching; real recruitment commands; nested tooltip dismissal and contrast; all army tabs and Rally sections at 320px; real raids, cancellation, farm batches, private reports; research switching/pause/resume/completion/reload; Academy flow; and the shared header.

Browser reports and logs are under `artifacts/management-scene-style/` and `artifacts/management-*.log`. The final complete browser run is `final-check-report/`, with images in `final-check-results/`. Desktop previews copied to `armies-desktop.png`, `rally-desktop.png` and `research-desktop.png` were visually inspected, along with faction variants, mobile/320px screenshots, recruitment, Raise Army and tooltips. No Blender verification is needed for this CSS/React presentation change; no FPS claim is made.

## Existing army suite failures

The broader `army-workspace.spec.ts` run still has three pre-existing scenarios failing on both projects: two expect nine troop cards while the shipped game has ten, including the diplomat; the all-troop inspector test's concept-roster name lookup has no diplomat and throws. These were already reproduced on the unchanged baseline during the preceding rankings task; see `2026-10-25-weekly-rankings.md`. The equipment and army bonus-tooltip scenarios passed in this run. The new suite separately verifies army tab navigation, recruitment, stats and tooltips without those obsolete fixtures.

Rally's two equivalent stale nine-card assertions were updated to ten, and its presentation assertions now expect the authorized compact font and dark material. Its entire 18-case desktop/mobile suite passes, including actual reviewed orders, cancellation and reports.

## Review

A fresh read-only review found two issues: the Raise Army body portal lacked a theme wrapper, and Rally tooltips retained dark semantic colors from the former paper surface. Both were fixed, covered by regressions and confirmed resolved by the reviewer. Final dialog material specificity was also verified in the browser. No material issues remain from that review.

Changes are retained on `review/management-scene-style`; no push, merge or deployment was performed.
