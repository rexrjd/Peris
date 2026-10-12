PERIS — 3D CITY REDESIGN — V19.5

Built against latest main ecb151ed9c5038adcdc1ce27904f7235eef833e4.
This is an incremental update on top of the V19.4 camera/animation release.
Apply the included source files to the project root, preserving their paths.
Use a review branch and merge edits to any listed file made after this base.
The patch is included for review or git apply. This is a changed-files archive.

WHAT CHANGED
- Connected avenues and cross-streets with proper resource service roads.
- Paved courtyards, kerbs, planting, civic forecourt and distinct working yards.
- Larger native city buildings, facade detail and a more oblique default camera.
- Clear available plots, with a separate small riverside building site.
- Wider river, two bridges, reeds, bankside stones and an aligned eastern gate.
- Instanced faction forests: broadleaf, pine, palm, bamboo and bare trees.
- Warmer lighting, softer shadows, rolling terrain and distance haze.
- Smaller translucent HUD plates. Levels appear on hover/selection; the
  numbered button enables all levels for an overview.
- A proper five-stage siege Workshop model, including a ram and catapult.
- Walking citizens follow streets, stop at entrances and avoid the farm
  when travelling to the lumber yard.

Wheel zoom, Q/E rotation, touch controls, animations, reduced motion and
hidden-tab pause are retained. Construction commands, city switching and
WebGL fallback remain supported. The painted Village view is retained.
City costs, slots, ownership, account science and strategic map coordinates
retain their existing rules. No SQL, new image downloads or server changes.

REFERENCES STUDIED
- Anno 117: street connections and urban structure:
  https://www.anno-union.com/devblog-roads-building-in-the-grid/
- Anno 117: visual hierarchy and consistent interface materials:
  https://www.anno-union.com/devblog-the-user-interface-team-and-a-deeper-dive-into-the-visuals/
- Townscaper: compact architectural silhouettes and clear courtyards:
  https://www.townscapergame.com/
- Civilization VII: official gameplay overview:
  https://civilization.2k.com/civ-vii/en-GB/news/civilization-vii-gameplay-pre-order-now/

All shipped changes use original native geometry and existing Peris palettes.
Reference images are study material and are not included as game assets.

VERIFICATION
- Full unit suite: 450 individual checks passed; 1 existing skip.
- City browser suites: 12 passed; 4 intentional mobile duplicates skipped.
- Fresh Roman, Elf and Necropolis campaigns verified, including real roof
  clicks, available-plot selection, level display and construction dialogs.
- Desktop/mobile camera, queues, reloads, city switching and fallback checked.
- Tooling: 4 passed. Assets: 46 registered GLB models passed.
- Production build passed. Existing large-chunk advisory remains.
- Browser screenshots inspected; Chromium used software WebGL for checks.

Source and previous-version SHA-256 values are in the package manifest.
