# Rankings UI redesign verification

Implemented on `review/rankings-ui-redesign`, based on `875034a`, in the active root application. Presentation only: no SQL, scoring, ranking DTO, engine, save, map or battle logic changed.

## Result

Rankings now uses a compact light statistics sheet with forest-green tabs, thin table rules, readable dark text, separate player/guild columns and highlighted own rows. Desktop displays two columns; mobile stacks tables. Top 10 shows all five boards, and category tabs focus an individual board. This/Last week, own rank outside Top 10, signed growth, errors/retry and solo reload remain supported. Scoring/tracking details expand below the tables.

The visual research uses actual online screenshots:

- [Classic Travian defense statistics](https://www.travian-help.cz/tipy-triky/zaklady-travianu/statistiky/) — compact ruled rows, green names and explicit numeric columns.
- [Travian 3.5 statistics screenshot](https://adameck-travian.wbs.cz/travian_35/T3.5_statistika.JPG) — restrained statistics sheet and selected-player highlighting.
- [Travian: Legends statistics screenshot](https://www.cherrycredits.com/img/games/Travian/Screenshot3.png) — light central sheet, category strip and green section hierarchy.
- [Weekly Top 10 screenshot indexed by image search](https://forum.ragezone.com/threads/travianz-version-modified-by-shadow-and-many-others.967580/page-5) — paired weekly boards. The host refused direct image downloading; it was not represented as a locally inspected image.

Downloaded references remain ignored under `artifacts/rankings-redesign/references/`. The shipped interface is original HTML/CSS and existing Peris icons; no reference images, new raster assets, models or dependencies are shipped.

## Verification

| Check | Final result |
| --- | --- |
| `npm test` | 669 tests: 668 passed, zero failed, one existing skip. |
| `npm run test:tooling` | 5 passed. |
| `npm run assets:check` | Passed; 46 existing registered GLBs and 33 Rally Point paintings verified. |
| `npm run build` | Passed; existing large-chunk and mixed static/dynamic import advisories remain. |
| `npm run test:e2e -- tests/e2e/rankings.spec.ts tests/e2e/compact-header.spec.ts --output=artifacts/rankings-redesign/e2e-results` | All 10 Chromium desktop/mobile cases passed. |
| `git diff --check` | Passed. |

Commands use `npm.cmd` on this Windows host because PowerShell blocks the `npm.ps1` shim. Logs, report, screenshots and failing-regression evidence remain under ignored `artifacts/rankings-redesign/`.

Browser tests exercise real pointer/keyboard actions against local campaigns and an isolated SQL/Auth fixture. They cover five-board overview, category selection, arrow/Home/End keys, retained period and own rank 13, collapsed/expanded help, retries, missing older-server RPC, solo resume, Reports and other navigation, plus 320px layouts with a long name, 12-digit scores and negative growth. No horizontal overflow is accepted. The light heading's contrast must be at least 4.5:1.

Inspected final desktop overview/category/error images, mobile overview, and the 320px long-name/large-score capture. Screenshot review found and corrected inherited dark-theme typography; the contrast regression was observed failing at 1.11:1 before the correction and passed afterward. A live-growth-sensitive visual fixture now starts at population capacity so its signed total remains stable while the real engine runs.

## Independent review

One fresh reviewer inspected the whole change, actual screenshots and test evidence, and independently ran the nine focused UI tests. No Critical issue was found. Its Important finding was a clipped keyboard-focus ring on the week selector: the real keyboard/geometry regression failed before the fix, and the final desktop/mobile run passes with an inset outline. Its Minor wording finding was corrected by making the Growth heading independent of the selected period. No finding remains deferred.

The parent ran the full repository unit/build/tooling/asset checks; the reviewer did not repeat them. Browser verification is Chromium-based; real assistive-technology operation and other browser engines were not independently tested. The existing unrelated failures recorded in the original weekly-rankings verification were not changed or rerun as part of this presentation-only work.

No SQL migration or Blender verification is required for this redesign. No push, merge, hosted database mutation or deployment is included.
