# Diplomat portrait verification — 2026-10-26

The Roman Senator and the other ten faction diplomats now use original painted
portraits matching their existing unit rosters. The shared component supplies the
same portrait throughout Army, Rally Point, recruitment, dossiers and battle UI.
Civic titles, rules, costs, save formats, nine-cell atlases and battlefield models
are unchanged. No SQL, dependencies or legacy copies changed.

## Artwork and previews

The built-in `image_gen` tool generated eleven distinct transparent PNGs using
the corresponding shipped roster as a style reference. The successful Roman
portrait also guided framing for the other ten. Complete prompts, references,
original Peris ownership, source hashes and runtime hashes are recorded in
`assets/diplomats-v2.json`. Originals are retained under
`assets/source/diplomats-v2/`; the technical exporter produces 512×512 WebPs under
`public/art/battle/diplomats-v2/`. The complete runtime set is 945,374 bytes.

Visually inspected all eleven paintings and both actual-browser comparison sheets:

- [All eleven portraits](../../previews/diplomat-portraits/all-factions.png)
- [Desktop comparison with existing infantry](../../previews/diplomat-portraits/desktop-comparison.png)
- [320px mobile comparison](../../previews/diplomat-portraits/mobile-comparison.png)
- [Roman Senator dossier](../../previews/diplomat-portraits/senator-dossier.png)

Actual Army, Rally and dossier screenshots for each faction and viewport remain
under `artifacts/diplomat-portraits/ui-*.png`. Roman desktop dossiers, Undead 320px
dossiers, Orc Rally Point and the all-faction sheets were inspected directly.

## Verification

| Command or check | Result |
| --- | --- |
| `npm.cmd test` | 673 tests: 672 passed, 1 existing skip, 0 failed. |
| `npm.cmd run test:tooling` | 5 passed. |
| `npm.cmd run assets:check` | Passed: 46 registered GLBs, existing artwork checks and all 11 diplomat portraits. |
| `npm.cmd run build` | Passed; existing chunk-size warning remains. |
| `PERIS_TEST_PORT=4216 npx.cmd playwright test tests/e2e/diplomat-portraits.spec.ts --output=artifacts/diplomat-portraits/ui-green-results` (PowerShell environment assignment) | 22 desktop/mobile cases passed in 2.3m, including 320px mobile. |
| `npm.cmd run test:e2e -- tests/e2e/city-capture.spec.ts --grep "live 3D main building\|original diplomat geometry" --reporter=list --output=artifacts/diplomat-portraits/capture-results` | 4 passed across desktop/mobile; recruitment plus automatic 3D and Canvas battle inspection. |
| Production bundle and deployed-file check | All 11 literal portrait URLs discovered in built JS; copied WebPs exactly match runtime source bytes. |
| `git diff --check` | Passed. |

The updated capture UI regression first failed against the old SVG; the desktop
Roman browser test also failed because the painted image did not exist. Final
coverage checks the actual loaded image dimensions, faction URL, accessible name,
full-image fitting, unchanged infantry atlas, real Army/Rally/dossier clicks,
mobile overflow and browser errors. Export validation checks complete faction
coverage, distinct images, source/runtime hashes, transparent outer margins,
512px dimensions, exact reproducible export bytes and a 160 KB budget per image.

Logs for unit, tooling, assets, build and recruitment/battle UI are under
`artifacts/diplomat-portraits/`. Browser results are `ui-green-results/` and
`capture-results/` there; `ui-green-verification.txt` records the all-faction run.
The existing skipped test is the withheld-faction roster
publisher scenario. No checks were weakened.

## Review and limits

A fresh read-only review found no actionable issues. It independently checked the
portrait export validation, eight capture UI tests, diff whitespace, production
URL discovery and visible desktop/mobile images.

An extra standalone-export probe reported zero embedded images: the existing
packager only traverses entry scripts while the app is loaded through lazy
chunks. That baseline packaging limitation predates this portrait change. All
eleven new URLs preserve its literal discovery contract and are present in the
normal production build; repairing general standalone packaging is outside this
portrait task.

No Blender export or model verification is needed for this image-only change.
No frame-rate claim is made. Changes are retained on
`review/diplomat-portraits`; no push, merge or deployment was performed.
