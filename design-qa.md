# Unit card stats and bonus breakdowns — 2026-10-18

The unit cards now show base attack/defence, a signed green bonus or red penalty, and the resulting current total. Army and Rally cards expose the source breakdown on hover, keyboard focus or tap. Barracks, Stables and Workshop recruitment choices show unboosted base stats. Existing combat, recruitment prices and saves are unchanged.

Source visual truth: `artifacts/unit-card-stats-2026-10-18/source-unit-card.png` (1070 × 1470, illustrative Legionary card). Implementation evidence in that folder's `qa/` includes `desktop-rally-stat-card.png`, `desktop-rally-stat-breakdown.png`, `mobile-rally-stat-breakdown.png`, desktop/mobile `unit-bonus-breakdown.png`, and desktop/mobile `base-stats-infantry.png`, `base-stats-cavalry.png`, `base-stats-ram.png` (all filenames prefixed with the device).

Full and focused comparisons: `qa/card-comparison.png` (624 × 560) and `qa/stats-comparison.png` (1024 × 180). The source and actual 209 × 391 desktop card are normalized without stretching. Actual CSS viewports are 1440 × 900 desktop (scale 1) and Pixel 7 at 393 × 851 (scale 2.625); phone captures are inspected at normalized display size. The mock uses illustrative 50/40 stats, while the actual Spear Guard fixture uses real 90/120 base values. The original unit grid, counts, selected-unit inspection and real portraits remain authoritative; the isolated mock's large single-card layout is adapted to that grid.

## Findings and corrections

- P2, corrected: adding base stats to the recruitment choices exposed column flex wrapping and cramped text. Recruitment choices now prevent flex wrapping, use two columns and readable base rows. The final stylesheet import order preserves these overrides. Browser geometry checks ensure rows remain inside their cards.
- P2, corrected: an enclosing inspector intercepted Escape before the tooltip. The modal now yields to its own described tooltip; the first Escape dismisses the breakdown and the second dismisses the inspector. Browser coverage exercises this exact sequence.
- Correctness, corrected: supporting city defenders were omitted from live battle lookup. Recorded `city_defenders` now participate, with a unit regression verifying the non-leading army path.
- Test isolation: a first browser attempt connected to another checkout on port 4173. Those results were discarded. `PERIS_TEST_PORT=4187` provides a dedicated server for this implementation without disturbing the other session.
- Test locale: canonical numeric attributes avoid a host/browser decimal-separator mismatch. Visible numbers retain browser locale formatting.

## Required fidelity surfaces

- Fonts/typography: existing Army/building Open Sans and Rally Cinzel/Crimson Text are retained. Card figures use tabular numbers; the column grid aligns base, bonus and current totals. Tooltips use the surrounding light or dark palette and readable explanatory text.
- Spacing/layout: card bodies retain existing portrait and count placement. Stats occupy separate aligned rows. Hover/tap controls are siblings of inspection controls, avoiding nested buttons. Tooltips render outside clipped panels, remain inside the viewport, and can be read while hovered.
- Colors/tokens: ivory/oxblood/gold Rally colors remain intact; Army/buildings retain their existing dark style. Positive and negative contributions have separate green/red colors plus explicit signs, with bold current totals.
- Image quality: all original troop and hero portraits remain in place. The generated card is a concept reference only; no new raster asset or replacement portrait is shipped.
- Copy/content: current numbers use the existing research, home-city smithy, commander/equipment and live spell calculations. Contributions are computed in multiplicative order. Different live formations show a range with separate breakdowns. Recorded older battle bonuses are labelled as battle-start bonuses rather than falsely attributed to current equipment. Attack points normalize an unmodified infantry damage rate to 100; defence points use 100 times the existing protection multiplier. These are display units, not a rebalance.

Verification: full unit suite 480 passed, one existing skip; five tooling checks, asset checks and production build passed. All 14 final desktop/mobile browser cases passed after the corrections, covering tooltip hover/tap/focus, outside dismissal, nested Escape handling, all troop inspectors, all three recruitment buildings, training actions, Rally city scope, raid review and cancellation. Captured page errors: zero. No production deployment is part of this change.

final result: passed

---

# Ivory Operations Ledger design QA — 2026-10-18

The approved Option 2 is implemented on `codex/rally-ivory-ledger`, after pulling main from `11ccee7` to `f075876`. This review supersedes the earlier faction-frame presentation review preserved below.

## Sources and rendered evidence

Source visual truth: `artifacts/rally-ui-concepts-2026-10-18/02-ivory-operations-ledger.png` and `04-ivory-movements.png`, both 853 × 1844 pixels. Rendered evidence is in that folder's `qa/`: `ivory-movements-mobile.png`, `ivory-reports-mobile.png`, their `-desktop.png` equivalents, `rally-mobile.png`, `rally-desktop.png`, and `ivory-battle-result-mobile.png` / `ivory-battle-result-desktop.png`.

Full comparisons: `qa/movement-comparison.png` and `qa/report-comparison.png` place the source and implementation together. Both are 804 × 844 pixels, with each panel normalized to 390 × 844 without stretching. The implementation captures use 390 × 844 and 1440 × 900 CSS viewports at device scale 1. Pixel 7 result-dialog evidence uses 393 × 851 CSS pixels at device scale 2.625; it is inspected at normalized display size. Focused route, unit count, and timer evidence: `qa/movement-detail-comparison.png` (772 × 180). Tests also cover a 761-pixel tablet viewport.

States: populated owned incoming returns, outgoing reinforcements and raids; All/Incoming/Outgoing filtering; city switching; carried spoils; cancellable orders; populated reports with camp filtering; saved and current battle receipts. Fixture cities, counts, and timestamps differ from the illustrative mockup. Actual campaign data remains authoritative.

## Findings and comparison history

- P2, corrected: the initial phone header and expanded nine-role movement roster consumed too much space and pushed arrival details out of view. Compact mobile headings, a right-hand arrival column, and expandable troop breakdowns restore readable timers. Revised full and focused comparisons show the corrected layout; browser assertions verify the timer remains within the viewport and route text is at least 14 pixels.
- P2, corrected: hiding global navigation text on phones exposed missing accessible button names. Explicit labels now preserve every navigation control; Map navigation and the affected browser suite pass.
- P2, corrected: report explanations and inline economic receipts made the list too dense. Explanations now follow the rows, and opening a report retains its full resource accounting. The revised report comparison shows three readable fixture reports and the camp filter above the fold.
- P2, corrected: a legacy result-dialog background could override the ivory surface depending on stylesheet load order. A desktop computed-style regression reproduced the dark background after the mobile case passed. Explicit scoped result-dialog specificity now preserves the ivory panel and responsive bounds regardless of load order. Fresh captures and computed-style checks verify current and saved report backgrounds are `rgb(252, 249, 241)`.
- No remaining actionable P0/P1/P2 findings in the reviewed states.

## Required fidelity surfaces

- Fonts/typography: bundled Cinzel headings and Crimson Text body copy preserve the selected historical ledger direction. Route, timer, button, dialog, and report text were inspected; browser checks cover minimum route size and loaded font families.
- Spacing/layout: compact city selector, thin section rules, right-aligned countdowns, and four bottom Rally tabs follow the selected hierarchy. Existing global game navigation is retained above the Rally header, so fewer movement rows fit than in the isolated mockup. Inner content scrolls; persistent controls remain visible with no horizontal overflow.
- Colors/tokens: ivory paper `#f5f0e5`, light receipt panels `#fcf9f1`, oxblood `#741f25`, gold `#a78043`, and incoming green `#3e5c34`. Scoped selectors keep the palette within Rally and its dialogs. The paper is a solid surface rather than the mockup's decorative grain.
- Image quality: existing licensed faction crests, commander portraits, and all nine game troop icons remain in use with correct aspect ratios. Existing production navigation and resource icons are retained as an intentional compatibility choice. Earlier large faction-frame paintings remain preserved as source assets.
- Copy/content: production city names, owned movement counts, travel timing, cancellation metadata, casualties, carried spoils, storage overflow, replacement cost, and net resources come from existing selectors and receipts. No illustrative mockup values are hard-coded into production.

## Interactions and verification

The 22 affected desktop/mobile browser cases passed, covering movement filters, ownership boundaries, city scope, cancellation, roster identity, farm-list editing and batch review, report privacy, and old receipts after battle pruning. Follow-up targeted runs verify the condensed report list and ivory current/saved dialogs. Captured browser page errors: zero. Unit checks: 475 passed, one existing skip; tooling: five passed; artwork checks and production build passed. The build retains its existing chunk-size warning.

Checklist: approved layout implemented; populated movement and report states inspected beside their sources; phone/desktop navigation and scrolling checked; existing gameplay rules preserved; no deployment performed. Residual limitation: this is local browser verification with deterministic campaign fixtures, not a live production multiplayer session.

final result: passed

---

# Earlier Rally Point integration design QA

Source visual truth: `C:/Users/kjksz/AppData/Local/Temp/codex-clipboard-b92c55f9-7521-4e17-b61f-217ad58660a5.png` (1920 × 1320, four-faction reference board). The original 33 faction paintings were preserved byte-for-byte under `assets/source/rally-point-v1` and exported through the validated raster pipeline.

Implementation evidence: `../../outputs/peris-rally-integration/egyptian-raw.jpg`, `egyptian-roster.jpg`, `rally-desktop.png`, `rally-mobile.png`, `elf-appearance.jpg`, `dwarf-appearance.jpg`, and `pandaren-appearance.jpg` in that same output folder. Combined comparisons: `egyptian-comparison.png` and `roster-comparison.png`.

The reference board's Egyptian quadrant was cropped at 950 × 628 and normalized to 1232 px wide. The actual game was captured at the available desktop viewport (between 1441 × 749 and 1477 × 803 CSS px as the app window changed), with additional stable browser-test captures at 1440 × 900 and 390 × 844, device scale 1. Source CSS size is not supplied by the board itself; pixel crops are reported instead. Native browser captures were kept intact; comparison copies normalize width without stretching aspect ratio. The focused commander/roster crops normalize to 886 px wide.

The full-view comparison checks the frame, city selector, five tabs, four totals, expandable incoming/outgoing summaries, station list and commander tray. The focused comparison checks the Egyptian commander, all nine original unit portraits, quantities, labels, selected card, order controls and troop totals. Stable desktop evidence uses a real Roman campaign fixture; live Egyptian evidence uses an imported campaign validated by the current game's save validator. Counts and movement states differ as real campaigns advance.

## Findings and iteration history

- Initial P2: the existing `modern.css` normalization overrode Crimson body text with the current UI's sans serif face. Fixed with scoped typography and palette selectors. Revised captures and computed styles confirm Cinzel headings and Crimson Text body copy. The focused combined comparison shows the corrected text beside the original.
- Packaging issue found separately during review: dynamic art paths were invisible to the existing standalone asset discovery parser. Fixed with an explicit typed map of 33 literal paths and a focused tooling regression. The actual production bundle exposes every expected path.
- No remaining actionable P0/P1/P2 visual findings.

Production correction (2026-10-13): removed the preview-only Appearance selector and Explore appearances gallery. The nation banner and all artwork now follow the selected city's actual faction automatically. Revised evidence: `../../outputs/peris-rally-integration/city-faction-only.jpg`, plus the refreshed `rally-desktop.png` and `rally-mobile.png`. Browser inspection confirms zero preview controls and zero console errors. The city-faction test switches between Roman and Persian owned cities and verifies their corresponding artwork, banner and unchanged campaign data.

Intentional compatibility differences: the game's existing map/city/army/research/social navigation remains at the top; station rows retain locate controls; the live game's wording, timers and quantities remain authoritative. Shorter desktops and mobile use the existing inner-panel scroll pattern. The mobile layout stacks the content and retains the game's bottom navigation.

## Required fidelity surfaces

- Fonts/typography: original Cinzel and Crimson Text, original weights and licenses; headings, body notes, buttons and modal text checked after specificity repair.
- Spacing/layout: ornate framed stage, original section hierarchy, narrow station column and nine-card commander tray retained. Desktop 1440 × 900 shows all nine role portraits; mobile 390 × 844 has no horizontal overflow and its panel scrolls.
- Colors/tokens: all eleven nation palettes, backgrounds, frames and material textures follow the actual selected city's faction; styling is scoped to Rally and its dialogs.
- Image quality: original artwork and original game troop/hero portraits, lossless frame alpha and verified WebP dimensions; no replacement drawings, movie character art or placeholder illustrations.
- Copy/content: live city, commander identity, roster counts, routes, farm lists and reports. Production has no faction preview controls.

## Interaction and browser evidence

Manual game checks: all five tabs; summary expansion; removal of preview controls; Issue orders through the existing troop review dialog; commander management; removal of Rally styles on other views. The original eleven-theme artwork pass remains valid; automatic city-faction selection is now covered by the production test. Browser console: zero captured errors.

Automated checks: all fourteen related Rally desktop/mobile tests passed after removing the preview feature. The cases verify automatic city-faction artwork, absent preview controls, campaign identity/order/roster invariants, exact troop review, a confirmed partial raid, the 30-second cancellation token and restored troops, station rosters, farm lists and reports. Production build, TypeScript, 458 unit tests (one existing skip), five tooling tests and artwork checks passed. Broader pre-existing game-suite failures remain recorded separately and are not represented as a passing global regression run.

## Implementation checklist

- Restore original faction art and typography: complete.
- Connect every Rally tab to real game selectors and commands: complete.
- Preserve real save identity and owned-data boundaries: complete.
- Check desktop and mobile interactions and panel scrolling: complete.
- Review both full composition and focused unit/commander detail: complete.

P3 follow-up polish: small density refinements could be tuned further for short laptop windows without changing the design.

final result: passed
