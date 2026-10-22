PERIS | Right-hand Garrison Card UI
22 October 2026

PURPOSE
- Removes the old 'Defence' button and fullscreen garrison modal.
- Adds a compact garrison card to the TOP RIGHT of the live 3D city,
  aligned with the existing city selector on the left.
- Card shows permanent defenders, wall level, the passive defence bonus,
  and an automatic defence status without opening a modal.
- The Manage button or card opens a scrollable, anchored dropdown with
  the existing station/withdraw soldier operations.
- Click outside or press Escape to close; switching city resets the panel.
- Smaller viewports show two compact side-by-side cards; the dropdown
  remains right-aligned and scrollable.

INSTALL
Extract this ZIP over C:\Peris, preserving directories. The zip includes
ONLY changed source/test files. Requires the preceding
Peris_City_Defense_Garrisons_v1.zip to have been applied.

TEST
cd C:\Peris
npm.cmd test
npm.cmd run build

Only UI and CSS files were changed. No database migration is necessary
for this update. The existing garrison RPC and offline autobattle
systems are left untouched.

VERIFIED HERE
- TypeScript/TSX syntactic transpilation passed for changed TSX/test files.
- Existing garrison and city ruins domain tests: 7 passed, 0 failed.
- Old Defence button and modal class references removed from the city UI.

NOT VERIFIED HERE
- Full TypeScript/Vite build, all React SSR tests and in-browser visual
  interaction (project's npm dependencies are not installed here).
