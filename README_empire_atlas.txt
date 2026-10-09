PERIS — EMPIRE ATLAS UI OVERHAUL

Apply these files over the latest Peris project, preserving their relative paths.
This is an incremental patch for the existing multi-city / heroes version.
No database migration is required for this UI update.

What changed:
- A large empire atlas replaces the cramped city-expansion dialog.
- Live map selection, nearby connected sites, and colony route previews.
- Illustrated faction-colored city cards and one-click city entry.
- Departure-city switching, settler preparation, and readiness checks.
- City name and launch action stay visible while the planner scrolls.
- Expedition journal with progress, arrival, founded cities and returns.
- Charcoal navigation and a light planning sheet; responsive phone layout.

Verification:
- Production build passed.
- 187 automated tests passed, including seven new colony-planning tests.
- Rendered UI checks passed for overview, map handoff, readiness,
  occupied sites, and a ten-city roster.
- Browser visual and touch review remains pending in this environment.

Run: npm install, npm test, npm run build
For a quick offline playthrough, open Peris_empire_atlas_playable.html.
Find the atlas via the city dock or the game menu.
