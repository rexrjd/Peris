PERIS - Reinforcement route and shipment details in Events

APPLY
1. Extract this ZIP into C:\Peris, preserving folder paths.
2. This patch builds on Peris_Empire_Events_Troop_Movements.zip.
3. Run from C:\Peris:
   npm.cmd test
   npm.cmd run build
   npm.cmd run test:e2e

FEATURES
- Compact reinforcement rows show Source City -> Destination City and troops/ETA,
  even in the Map Events preview (not only the expanded City activity feed).
- Clicking a reinforcement opens a native accessible modal with origin, destination,
  unit icons and counts, exact departure and arrival time, ETA, and progress.
- Close via the X, Escape, or the Close button. View destination selects its map location.
- Other Events rows keep existing navigation and filtering.
- No SQL, gameplay, save-format, simulation, or troop movement changes.

CHANGED FILES
 - src/features/map/domain/activity.ts
 - src/features/map/ui/MapOperations.tsx
 - src/features/map/ui/ReinforcementDetailsDialog.tsx
 - src/features/map/styles/operations.css
 - tests/map-activity.test.ts
 - tests/e2e/map-activity.spec.ts
 - tests/e2e/city-scene-ui.spec.ts

LOCAL VERIFICATION
- TypeScript/TSX syntax checked using TypeScript transpileModule (no diagnostics).
- CSS parsed with PostCSS.
- Static desktop + 390px mobile modal opened in Chromium, Escape closed it,
  no horizontal overflow in 390px viewport.
- Full npm tests, Vite build and real-app Playwright tests require local dependencies.
