# Reports scene style verification — 2026-10-25

## Delivered

Reports now shares the selected city's faction colors, texture, fine borders and compact typography with Map, live 3D City, Rankings and management screens. A local scene wrapper themes the small inbox overlay consistently over every background, including the compatible painted City. Opening Reports preserves the active screen and its state.

Report rows are about 60px high. Headers, filters, receipt sections, equipment cards, scouting observations and milestones use tighter spacing. Search has a visible keyboard-focus outline. Loss values remain red, and outcomes and equipment rarity retain distinct colors. Native outcome filtering remains usable over Rally's scoped styles. Existing commands, read receipts, privacy, rewards, scouting data and save formats are unchanged.

No SQL, domain rules, assets, models, dependencies or legacy application copies changed. Nothing was pushed, merged or deployed.

## Verification

| Check | Result |
| --- | --- |
| `npm.cmd test` | 669 tests: 668 passed, 1 existing skip, 0 failed. |
| `npm.cmd run test:tooling` | 5 passed. |
| `npm.cmd run assets:check` | Passed, including 46 registered GLBs and 33 Rally paintings. |
| `npm.cmd run build` | Passed; existing chunk-size warning remains. |
| Report-focused browser run | 20 passed across desktop Chromium and Pixel 7 mobile. |
| Final outcome-tint regression | 2 passed, exercising all six background screens on desktop/mobile. |
| Final 320px focus/scouting/milestone regression | 2 passed; normal milestone cards remain at most 120px high. |
| `git diff --check` | Passed. |

The new style test first failed against the original popup's slate background and missing faction texture. The passing tests compare computed Map materials with the Reports popup and detail surface for Roman, Persian and Elf cities over Map, City, Rally Point, Armies, Research and Rankings. They check dense rows, all eight toolbar controls, search, outcome filtering, loss colors, scouting resources, milestones, popup dismissal and focus return.

Existing inbox, popup, receipt-economics and unread tests verify sorting/search/filter behavior, saved observations and rewards, rival-report privacy, all-read handling, pruned receipts, badge persistence and save reload.

The complete report-focused command was:

```powershell
npm.cmd run test:e2e -- tests/e2e/reports-scene-style.spec.ts tests/e2e/reports-popup.spec.ts tests/e2e/report-inbox.spec.ts tests/e2e/report-economics.spec.ts tests/e2e/unread-reports.spec.ts --grep-invert 'camp inspector and reviewed party'
```

## Baseline failure kept separate

The initial full run had 20 passing cases and two failures: the unrelated `camp inspector and reviewed party show land route, stock limits and selected-role pace` scenario on desktop and mobile. It expects `.march-review` inside Prepare camp raid; that element is absent at the assertion. The unchanged `2dd43f8` baseline reproduced the same missing-element failure on both projects in an isolated temporary checkout. Its test and application flow remain unchanged. This one scenario was excluded from the focused Reports rerun after baseline confirmation, rather than weakening it.

## Evidence and review

Logs are in `artifacts/reports-*.log`; browser images/reports are under `artifacts/reports-scene-style/`. `final-results/` contains the complete focused run, `outcome-results/` the final outcome checks, `compact-results/` the final narrow-layout refinement, and `baseline-results/` the unchanged-code reproduction. Desktop, faction variants, receipt/loss details, scouting, search focus and 320px milestone captures were visually inspected.

Stable previews are `preview-desktop.png`, `preview-receipt.png`, `preview-mobile.png` and `preview-320.png` in that artifact directory. No local Blender verification is needed for this CSS/React presentation change, and no performance claim is made.

A fresh read-only review found a missing search-focus cue and a toolbar outcome-color specificity issue. Both were fixed, covered by browser assertions and confirmed resolved. The final compact milestone layout was also reviewed; no material issues remain from that review.

Saved on `review/reports-scene-style`.
