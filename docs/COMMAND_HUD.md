# Peris — scene-first HUD

This replaces the left navigation rail and large resource header from the compact-city-header version.

## Final layout

- A 52 px desktop strip holds the PERIS wordmark, Map/City/Army/Reports navigation, compact resource counters, and Menu. It uses charcoal, ivory, and restrained brass accents.
- Resource cards become inline icon/count/income readouts with thin capacity meters. Exact storage limits, resource names, and income are in accessible labels and the existing clickable resource ledger.
- The left rail and bottom desktop status strip are removed. Save/player information lives in Menu alongside Codex, Settings, and Main menu. Menu closes on outside click or Escape.
- The city uses the whole workspace. Its name, faction/plot count, and expandable economy sit on small floating plates.
- City/Buildings/Build occupy a bottom construction dock. A current construction order appears above the dock with its remaining time.
- The city inspector starts closed. Select a building/plot to open it. Close it with its visible X or Escape; Escape preserves an open dialog's interaction.
- Economy signals worker shortages or declining food without requiring the detailed overview to be opened.
- Building search, plot construction, magic research, faction switching, and debug controls remain available through their existing controls and the selected-building inspector.
- On mobile, resources use a 48 px top strip, destination navigation becomes a bottom dock, and building details float above the construction controls.

## Research

The design draws on Anno's emphasis on the city scene and construction controls, Against the Storm's compact edge HUD and contextual building panels, and Civilization's unobtrusive top-level information. Artwork was not copied.

References:
- [Anno 1800 city interface](https://interfaceingame.com/screenshots/anno-1800-city/)
- [Against the Storm — official UI redesign and screenshot gallery](https://eremitegames.com/rationing-update/)
- [Against the Storm — interface screenshots](https://interfaceingame.com/games/against-the-storm/)
- [Civilization VI — official manual](https://cdn.steamstatic.com/steam/apps/289070/manuals/CIV_VI_25TH_ONLINE_MANUAL_ENG.pdf)

## Apply

Extract `Peris_scene_first_HUD_changed_files.zip` over the current compact-city-header version, preserving paths. This is an incremental update; it relies on the modern UI and resource HUD files already present in that version. No dependencies or database changes are required.

The standalone HTML embeds the game and its assets. Download and open it, start/continue a solo campaign, and choose City to inspect the interface.

## Validation

Production TypeScript/Vite build passed. All 170 Node regression tests passed using `node --import tsx --test --test-concurrency=2 tests/*.test.ts`. Focused UI tests were run again after the final menu/Escape changes. Whitespace checks passed.

Browser visual and pointer/touch verification could not run because the required browser-control capability is unavailable in this environment. Review the desktop header, opening/closing the inspector, construction progress, economy disclosure, narrow layouts, and Menu in a real browser before deploying.
