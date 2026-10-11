PERIS — MAP PANEL AND LIVE ACTIVITY UPDATE
11 October 2026

Compatible baseline
Repository: https://github.com/rexrjd/Peris
Latest main checked: 0c92070e35b469a815fbe09db25f849858b4042d
This baseline already includes the preceding account/login compatibility update.

Installation
This is a changed-files package. Copy src/ and tests/ into the root of the
Peris checkout, preserving their paths. The package does not replace the
whole repository. Alternatively, apply map-ui-activity.patch to the stated
baseline with git apply; use either copying or the patch, not both.
Run npm run build, then your normal frontend deployment workflow.
No dependencies, SQL migrations or save conversions are needed.

What changed
- A compact slate right panel replaces the oversized selected-location UI.
- Selected armies show their commander, level, troop composition and status,
  with contextual March / Follow army / Manage actions.
- Camps, cities and fields retain their existing actions with compact styling.
- Activity includes outbound raids, returning troops, reinforcement marches,
  active battles, construction, field improvements, recruitment, settler
  training and travelling settlers from every owned city and army.
- All / Armies / Cities filters, arrival countdowns, progress and destinations.
- Click an event to focus its location and select the correct city/commander.
- Departure cancellation uses the existing persisted token and real deadline.
- Battle reports are available directly from the panel.
- Mobile uses a collapsible bottom sheet with an Activity jump button.
  Collapse it to return to the full map and army-switching dock.

Compatibility
The activity list reads authoritative existing state. It neither changes
travel, combat or queue rules nor exposes rival private queues. Late events
remain visible until normal engine/server settlement. Returns describe their
actual departure station rather than assuming their army's home city.
Both Three.js and Canvas map paths are preserved.

Verification
- npm test: 374 passed, one existing test skipped.
- npm run test:tooling: four passed.
- npm run assets:check: 46 registered models passed.
- npm run build: passed; existing large-chunk warning remains.
- npm run check:sql and git diff --check: passed.
- Desktop/mobile browser checks: activity, filters, commander selection,
  cancellation/reload, map clicks, camp selection, farm lists, reinforcement
  review, saved returning troops and quiet automatic bandit farming.
- Screenshots inspected on desktop and Pixel 7 layouts; Chromium used a
  software graphics renderer. No hardware frame-rate claim is made.

Package contents
src/features/map/domain/activity.ts
src/features/map/styles/operations.css
src/features/map/ui/MapArmyDetails.tsx
src/features/map/ui/MapOperations.tsx
src/features/map/ui/WorldView.tsx
tests/map-activity.test.ts
tests/e2e/map-activity.spec.ts
tests/e2e/campaign-marches.spec.ts
MAP_ACTIVITY_README.txt
map-ui-activity.patch (source/test changes only)
