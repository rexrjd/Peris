PERIS — CITY HEADER & ECONOMY REDESIGN

Copy the included source files into your current Peris project,
preserving their relative paths. This patch is for the latest version
with the Empire Atlas. No new SQL migration is needed.

The two floating cards above the city are replaced by a single compact
context bar in normal layout flow, leaving the city scene unobstructed.

- City selection, faction and main building level are grouped clearly.
- Free plot count opens a real available building slot.
- Residents opens housing details; Staffing opens production details.
- City report has Overview, Residents and Production sections.
- Food warnings and recommended actions point to actual city buildings.
- The report closes before opening building details; keyboard focus moves
  into the inspector and returns to the triggering control on close.
- Header and building details adapt to narrow screens.

Verification:
Production build passed. All 193 automated tests passed, including six
new header/report checks. Browser visual and touch review is pending.

To run: npm install, npm test, npm run build.
For a quick offline playthrough, open Peris_city_header_redesign_playable.html.
