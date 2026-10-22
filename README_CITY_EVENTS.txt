Peris - 3D City Events Panel (October 22, 2026)

Install: Extract this ZIP into C:\Peris, keeping subfolders. It replaces 10 source/test files.

What changed:
- The same Events component from the Map view is now visible below the Garrison
  card in the live 3D City view.
- Current-city construction and recruitment are prioritized, with live countdowns;
  other city projects, troop movement, research and reinforcement shipments remain
  available under All events (All / Armies / Cities).
- Clicking local building/training work opens the corresponding City building;
  clicking travelling armies, remote work and shipments navigates to the Map
  and focuses the actual location.
- On narrow screens the panel starts folded, and can be expanded on demand.
- Map movement preview is unchanged. No simulation, SQL or server changes.
- Existing construction queue remains accessible in 3D City.

Checks:
- 14 relevant Node domain regression tests passed in the build environment.
- Changed TS/TSX files transpile without syntax errors; CSS parsed.
- Full React build and Playwright visual checks cannot run here without
  the repository's installed node_modules. Run on your Windows machine:
    cd C:\Peris
    npm.cmd test
    npm.cmd run build
    npm.cmd run test:e2e -- tests/e2e/city-scene-ui.spec.ts tests/e2e/map-activity.spec.ts

No Supabase database migration is required.
