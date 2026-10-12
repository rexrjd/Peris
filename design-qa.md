# Rally Point integration design QA

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
