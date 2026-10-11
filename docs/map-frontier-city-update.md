# Combined map, Frontier Wars and city update

- Preserves Peris's cellular 3D world, conquered fields and six story locations. Adds clearer field lines, quieter compatibility terrain, grab-and-drag navigation and three distinct camp silhouettes. New Frontier realms distribute camps fairly by eligible land; existing saved camp positions remain intact.
- Frontier Wars has a persistent local authority for shared camp stock, production, random defender growth, automatic combat, loot and returning troops. Random defender-spawn deadlines remain private.
- Camp names and coordinates open the same map detail window, with defender icons/counts, resources, production, distance, recent reports and farm-list actions.
- Farm lists support faction troop presets, target editing, sorting, moving, removal, report preferences and reviewed manual **Start list** batches. Frontier also retains server-owned repeat schedules.
- Frontier recruitment separates **Barracks / Stables / Workshop**, including research and serial training queues. Nine classes across eleven factions share 99 troop mini-icons in recruitment, selectors, movements and reports.
- Campaign attacks select a legion and troop allocation before confirmation. New departures have a server-enforced 30-second cancellation window. Unsent troops remain at owned stations; returning survivors merge with troops there. Ordinary movement ends on owned villages or fields.
- Cities gain resource/population/production, home-troop, movement and construction ledgers, hover details and centered building dialogs. Sixteen ordinary plots plus the Main building preserve existing unlocks and saves; the original 3D view remains available.
- All eleven factions have original painted buildings, race-specific enclosures, gates and residents. The latest city scenery places wheat above, woodland by the timber yard, rocks by the quarry and a fishing inlet with a bridge. Walls stay dry, outside loop roads are removed, workers use safe surfaces, and subtle animations respect reduced motion and hidden tabs.

The combined branch includes main's Frontier Wars milestone and V14 name-only
account/session work. Frontier's local realm and campaign/Supabase saves remain
separate. Strategic allied reinforcement, public Frontier hosting/account recovery,
dedicated scouting and siege damage remain future work.

For the shared world, apply `supabase/UPGRADE_TO_V14.sql` before deploying the new
frontend; use `FRESH_INSTALL_V14.sql` only for an empty database. Frontier starts
with `npm run dev:frontier`. Preparing this update does not deploy SQL or publish
the application.

Initial combined-update validation on 2026-10-11 with Windows and headless Edge: 348 unit tests passed
(one intentional skip), four tooling tests passed, and the production build,
Frontier typecheck, SQL/world/camp generation and asset checks passed. Frontier
passed 29 server tests and all ten desktop/mobile browser tests.

The general browser run passed 72 cases and caught a background-tab timeout plus
a fallback fixture that did not match revised atlas filenames. Both fixtures were
corrected; all eight account/model-preview cases passed in the focused rerun,
covering the two initial failures. The twelve general-suite skips are ten Frontier
cases run separately and two expensive roster checks covered on desktop. Terrain
checks verified every faction on desktop and mobile, including wall clearance,
gate access, building bounds, NPC feet and unchanged saves. Repository CI now also
runs the Frontier typecheck, server tests and dedicated browser suite.
The artwork exporter was run successfully; all 132 published faction cells have
visible artwork, transparent gutters and the expected dimensions.

The PR #6 compatibility follow-up merges the latest main, including the completed
Frontier Wars and account changes. Village troop rows now retain the culture of
visiting legions. Hidden or covered world maps suspend rendering, and unchanged
paused battles and reduced-motion maps redraw only when their presentation changes;
camera controls, model loading, moving troops and automatic combat remain active.
Regression tests cover these redraw rules and mixed-culture village troops.
Follow-up validation passed 355 unit tests (one intentional skip), four tooling
tests, asset validation and the production build. Headless Edge passed all 24
city/account cases, all ten Frontier cases, and all twelve focused desktop/mobile
battle-renderer and world-map cases. Battle picking checks use the rendered camera
projection and pause before model loading so narrow-screen selections stay reliable.

The software-renderer follow-up bounds unfinished WebGL work in world maps and
battles. Fence polling never blocks the UI thread; camera input and overlays stay
active while model uploads and drawing wait for the previous frame. Slow frames
reserve a short interval for application work, while fast hardware keeps its
existing cadence and visual settings. Canvas targeting retains completed-frame
cameras and pick geometry so deferred drawing cannot change the clicked target.
Browser CI runs desktop and mobile projects on separate runners, retaining every
case and publishing a separate report for each device.
