# Shared City Selector Implementation Plan

> For agentic workers: use superpowers:executing-plans inline, with a final independent review.

**Goal:** A shared selector with an actual city miniature, population and stationed army counts in 3D City and Map.

**Architecture:** Read existing city economy and military selectors; render static thumbnails from the same plot models and geography as the City scene. Composite these over generated biome art. Cache a bounded set by appearance, independent of resources and clock ticks.

**Tech Stack:** React 19.1, TypeScript 5.9, Three.js 0.186, Sharp, Playwright.

**Spec:** User-approved design in this conversation: owned-city dropdown, current view retained, Map focuses selected city, actual buildings and walls over generated terrain, population and stationed soldiers including garrison.

## Constraints and review focus

- Root app only; ignore Village. No SQL or save changes.
- Preserve report access, all factions and existing commands.
- Exclude hostile cities, marching armies, active battle troops and training queues.
- Handle one city, long names, keyboard dismissal and unavailable WebGL.
- Share plot assembly so City and thumbnail agree; dispose thumbnail resources and bound cache memory.

### Task 1: Preview data and artwork

- [x] Add failing unit tests for counts, private ownership and appearance invalidation; run them red.
- [x] Implement city selector model and shared plot factory; use actual geometry for thumbnail.
- [x] Copy generated originals into assets/source/city-preview-v1 and export checked WebPs with recorded prompts.
- [x] Run focused unit checks green.

### Task 2: Shared card and integrations

- [x] Add browser coverage for switching in City and Map, keyboard interaction, thumbnails and mobile layout; verify spacing and Tab regressions red then green.
- [x] Implement shared accessible dropdown and static cached preview; preserve report button in City.
- [x] Replace 3D identity card and remove old Map city dropdown; focus Map after selection.
- [x] Update existing 3D selector tests; leave Village behavior intact.
- [x] Run targeted browser tests and inspect screenshots.

### Task 3: Verify and review

- [x] Run npm test, npm run test:tooling, npm run assets:check, npm run build and npm run test:e2e.
- [x] Request independent read-only review, address material findings and rerun affected checks.
- [x] Report changes, test results and artwork paths; do not deploy or push.

## Execution ledger

- Review branch: `feat/shared-city-selector`, starting at `b3821ed`.
- Ruling: execute inline in the current checkout; preserve the existing AGENTS.md preference change and do not push or deploy.
- Initial browser fixture exceeded the 32-character saved city-name limit; corrected the fixture without relaxing save validation.
- Unit regression proved the shared 3D identity was absent, then passed after integration.
- Review regressions proved missing accessible count description, legacy queued-fishery frontage mismatch, mobile Events/toolbar overlap, and Tab remaining in the menu; fixed and verified.
- Independent read-only review: no remaining material findings after the fixes.
- Final focused browser check: both desktop and mobile passed. Affected existing City suites: 18 passed, 6 platform-specific skips.
- Final unit check: 512 passed, 1 skipped. Tooling: 5 passed. Asset check: 46 GLBs and 3 new backdrop exports passed.
- Final production build passed; existing bundle-size warning remains.
- Full browser run: 212 passed, 22 skipped, 2 failures caused by the same old fixed canvas click now hitting the repositioned Land button. Updated that point from y=175 to uncovered map space at y=325, retaining actual pointer input and all assertions. The complete affected Map activity file then passed all 6 desktop/mobile cases.
- Final image inspection also moved the mobile map-hover coordinate label above the zoom controls so it cannot peek out behind the city card. Final Map activity plus selector rerun: all 8 desktop/mobile cases passed; production build passed again.
- Browser outcome across the full run and corrected affected-file reruns: 214 distinct cases passed, 22 platform-specific skips. Captures under `artifacts/city-selector/`; final shared-card and Map activity captures in `final-layout/`.
