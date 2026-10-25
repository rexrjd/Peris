# Rankings compactness and scene-theme correction

Completed on `review/rankings-scene-style`, based on `f06e587`. The user requested less wasted space and exact visual compatibility with map and live 3D City.

## Changes

- Rankings joins App's existing `scene-theme` condition and selected-city faction context. It uses the same `--scene-*` colors, texture/material, edge and accent tokens as map/3D City. The hardcoded ivory/green palette is removed.
- Title, scope and week controls share one compact heading. Category navigation uses narrow text tabs; dates share the navigation line on desktop.
- Five boards use three desktop columns, two on intermediate widths and one on phones. Header/cell padding and gaps are reduced; normal rows are browser-verified at no more than 24px.
- Ranked counts move into table headings. Redundant empty rows and repeated own-rank footers are removed. Highlighted personal rows still show rank/score, including rank 13 outside Top 10; unranked dashes have an explicit accessible label and tooltip.
- Scoring, DTO, reads, saves, SQL, world and battle rules are unchanged. No database update is required.

## Actual reference research

Opened Google Images in a browser, inspected the results and captured the actual PvE/Robbers weekly ranking image. Its tightly ruled rows, short headings, compact personal row and restrained navigation informed the layout; Peris's existing map/City supplies the visual theme.

Research captures are retained under ignored `artifacts/rankings-redesign/`: `google-ranking-results.png`, `google-weekly-ranking-results.png`, `google-weekly-top10.png`, and `travian-weekly-density-reference.png`. These are research evidence, not runtime assets. No new raster assets, GLBs or dependencies are shipped.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | 669 total: 668 passed, zero failed, one existing skip. |
| `npm run test:tooling` | 5 passed. |
| `npm run assets:check` | Passed: 46 registered GLBs and 33 Rally Point paintings retained. |
| `npm run build` | Passed; existing chunk-size/import advisories remain. |
| `npm run test:e2e -- tests/e2e/rankings.spec.ts tests/e2e/compact-header.spec.ts --output=artifacts/rankings-scene-style/e2e-results` | 12 desktop/mobile cases passed. |
| `git diff --check` | Passed. |

The new regression was observed failing against the previous interface: Rankings lost the material/colors present on map and live City. After correction it compares exact computed background color and texture across all three views for Roman, Persian and Elf cities, on desktop and mobile. It also checks normal row height <=24px and the complete sparse desktop panel <=440px.

Existing browser coverage retains real online/local standings, five tables, category/period switching, arrow/Home/End and week-button keyboard access, own rank 13, negative/unranked scores, expanded rules, retry, old-server state, reload, Reports and 320px long-name/large-score overflow/contrast. The keyboard traversal assertion now follows the new logical header-first DOM order. Theme verification explicitly selects the live 3D City, not the painted Village.

Inspected final shared-world and sparse Roman/Persian/Elf captures, mobile Elf and 320px screenshots. All evidence is retained under ignored `artifacts/rankings-scene-style/`. Windows commands use `npm.cmd` because PowerShell blocks the `npm.ps1` shim.

One independent whole-change reviewer inspected source, screenshots and the actual Travian reference and found no demonstrated issue. Verification is Chromium-based; physical assistive technology and other browser engines were not independently tested. Existing broader unrelated browser failures were not modified or rerun. No FPS benchmark or Blender export was needed. No push, merge, SQL deployment or production mutation is included.
