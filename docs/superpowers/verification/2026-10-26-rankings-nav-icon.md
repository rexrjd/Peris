# Rankings navigation icon — 2026-10-26

Replaced the crown with five original ascending sandstone columns, following the
statistics motif in the user's Travian reference. Muted beige faces, brown sides
and simple dimensional shading match the painted low-poly HUD icons.
Rankings now uses the same `LowPolyIcon` component and desktop/mobile sizing.
Its label, accessible name, active state and navigation action are unchanged.

This revision supersedes the rejected gold crown from commit `8fc6d94`.
The built-in `image_gen` tool created the transparent source at
`assets/source/ui-low-poly-v1/rankings.png`. Exact prompt, style references and
original Peris ownership are recorded in `assets/ui-low-poly-v1.json`.
`npm run build:ui-icons` generated the 96px runtime WebP at
`public/art/ui/low-poly-v1/rankings.webp`; existing icon exports stayed identical.

Visually inspected the actual browser navigation screenshots:

- [Desktop](../../previews/rankings-nav-icon/desktop.png)
- [Mobile](../../previews/rankings-nav-icon/mobile.png)

Checks passed:

- `npm.cmd test`: 672 passed, 1 existing skip, 0 failed.
- `npm.cmd run test:tooling`: 5 passed.
- `npm.cmd run check:ui-icons`: all 12 registered pictures verified.
- `npm.cmd run assets:check`: passed, including all 46 registered GLBs.
- `npm.cmd run build`: passed, with the existing chunk-size warning.
- `PERIS_TEST_PORT=4219 npm.cmd run test:e2e -- tests/e2e/compact-header.spec.ts tests/e2e/rankings.spec.ts --grep "compact command header\|solo Rankings opens" --reporter=list --output=artifacts/rankings-nav-columns/browser-results`: 4 passed on desktop/mobile. Image loading, navigation, active state, layout and campaign reload checked through actual browser interactions.
- `git diff --check`: passed.

The shared component integration received a read-only review with no actionable
issues in the preceding revision; this revision changes artwork and provenance
only. Final column-art logs and browser results are under
`artifacts/rankings-nav-columns/`. No SQL, gameplay, models or dependencies
changed. Saved on `review/rankings-nav-icon`; no push or deployment performed.
