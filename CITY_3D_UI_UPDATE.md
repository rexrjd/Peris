# 3D city interface and guild crest

This patch gives the existing **3D** city mode a full workspace, with small floating controls instead of the two permanent side columns. Open City and choose **3D**. The selected view is remembered for this account during the browser session, including city switches and reloads.

The city name and switcher sit at the upper left. Residents, income and ready troops sit at the upper right. Income and military details open only when requested; construction, building search, Build/Expand and marker visibility remain around the edges. Resource stocks continue to use the shared top bar. Construction and recruitment use the same engine commands and authoritative rules.

Building windows opened from 3D use the existing live models and a slate palette. The newer painted Village mode keeps its renderer, layout and artwork. No landscape meshes, faction models, battle rules or database functions were changed.

Guild navigation displays your own guild's current crest. It follows crest edits and membership changes through the existing private social snapshot; viewing another guild does not change the navigation icon. Accounts without a guild keep the original Guilds picture.

## Installation

Base: `origin/main` at `a24dee6fd3a666a3f3bef6498ceba040cbfb10db`, which already contains the V19 guild and messaging update. Extract the patch into the repository root and review the changed files. This UI patch needs **no SQL migration** and adds no npm dependencies. An older deployment still needs the existing V19 social migration to use guilds.

Use `CITY_UI_FILES.json` to review the exact file list and SHA-256 hashes. The archive contains changed/new files only, screenshots, these notes and a patch against the checked main. It contains no environment files, installed dependencies, production data or generated SQL.

## Design references

- [Jon Shafer on Civ V's interface](https://www.gamedeveloper.com/design/revisiting-the-design-of-civ-5): match visual prominence to action importance and put occasional actions in secondary screens.
- [Total War: Rome II campaign interface](https://r2encv2.totalwar.com/en/manual/single-player/0015a_enc_page_campaign_play_interface/index.html): separate scene navigation from dedicated information panels.

The implementation uses Peris artwork and models; no reference-game assets were copied.

## Verification

Validation results and push steps are recorded in `CITY_UI_PUSH_NOTES.txt`. Screenshots under `docs/previews/city-ui` show the actual browser, not a mockup. Browser rendering was verified with Chromium and software WebGL; hardware FPS was not benchmarked.
