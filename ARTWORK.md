# Original Peris artwork

The active strategic world uses original, code-generated low-poly 3D scenery. Earlier painted relief and the transparent terrain/landmark atlas remain under `public/art/map/` for the illustrated minimap and 2D compatibility renderer. See **MAP_ART.md** for those asset prompts and **MAP_WORLD.md** for the current controls and rendering architecture. Existing tactical troop atlases remain independent.

## Strategic 3D scenery

`src/features/map/rendering/WorldCanvas.tsx` starts the Three.js scene, with a Canvas 2D compatibility view if WebGL initialization is unavailable. `three/WorldScene.ts` coordinates the scene, dynamic entities, selection, route overlays and minimap. `three/SceneCamera.ts` owns the tilted camera and converts its projection back to the game's existing signed world coordinates.

`three/landscape.ts` builds continuous faceted terrain and original procedural materials, mountain ridges, sand-colored coastal banks, animated water, shallow rivers, farmland and country lanes. Trees, grass and rocks use instancing. `three/models.ts` constructs villages, keeps, ruins, sanctuaries, river crossings and army standards from original geometry, merging parts by material. Nearby detailed public models are capped at 48, while wider views use instanced markers. Optional field-grid, region-name and resource layers do not form part of the permanent terrain artwork. Visual elevations and decorations never determine gameplay movement or ownership.

The generated low-poly preview images selected during design provide art direction for the camera, palette, landscape detail and restrained interface. They are **not runtime background images**. The interactive terrain, villages, armies and routes are live meshes and overlays. The earlier continental illustration is retained for the minimap and compatibility view, not stretched beneath the 3D landscape.

Three.js is the rendering library, distributed under the MIT license copied to `public/licenses/three.txt`. The meshes and procedural scenery are original PERIS code. Battle rendering remains Canvas 2D and continues to use its existing soldier sprites, portraits and terrain effects.

The original raster assets were generated with the built-in image generation tool for this game and are included in the project. They are also embedded in the standalone playable file. No Total War images, logos or other game assets are used.

**`public/art/menu/peris-dawn.png`** — menu background. Final prompt:

> Use case: historical-scene. Asset type: opening background artwork for an original browser strategy game, Peris. Create one cinematic panoramic landscape painting, 1536x1024 landscape or wider: an ancient Mediterranean valley at dawn with a walled Roman-inspired stone city and terracotta roofs on the right half, a winding river, cypress trees, farmland, distant hazy mountains. In the lower right foreground show small ranks of original ancient infantry and crimson standards, seen from behind overlooking the valley, no specific copyrighted insignia. Premium painterly strategy game concept art, tactile oil-painted atmospheric detail, warm muted gold sunlight against deep olive and charcoal shadows, restrained palette. Composition: leave the left third mostly dark atmospheric hillside/sky for readable UI text. Beautiful, grounded, not cartoon, no text, no logo, no watermark. This is a world establishing shot rather than a close character portrait.

**`public/art/army/legion-portraits.png`** — three-column unit portrait atlas, consumed through CSS in the infantry, archer and cavalry cards. Final prompt:

> Use case: historical-scene. Asset type: an ORIGINAL unit portrait atlas for a Roman-inspired browser strategy game called Peris. Generate ONE very wide 3:1 triptych canvas, ideally 1536 x 512. Exactly three equal square portrait panels, seamless composition but clean panel boundaries, NO text, NO labels, NO decorative borders. Each panel is a shoulder-up character portrait centered in its own third with dark desaturated olive background, consistent painterly premium strategy-game illustration style, dramatic warm light, charcoal shadows, bronze and ivory highlights. LEFT THIRD: heavy legionary wearing weathered silver iron Roman-inspired helmet with red horsehair crest, crimson cloak and segmented iron armor, holding a small part of a rectangular red shield at bottom. CENTER THIRD: Mediterranean archer in muted olive-green tunic and leather cap, quiver of wooden arrows visible above shoulder, curved wooden bow on the right of this panel. RIGHT THIRD: mounted cavalry officer, iron helmet with modest brass detail, tan-gold cloak and chain armor, a dark horse's head partly visible at bottom right and a long spear. All three characters must have their face centered near the upper-middle of their respective panels, with shoulders filling bottom half. Grounded historical materials, realistic painterly faces, mature and restrained rather than cartoon, high clarity at small card sizes. No copyrighted marks, no text, no watermark. All three cards belong to one game's coherent art direction.

Current strategic scenery lives under `src/features/map/rendering/three`, with the original Canvas 2D map retained in `src/features/map/rendering`. Tactical soldiers, horses, arrows, dust and fallen troops remain in `src/features/battle/rendering`; shared canvas infrastructure lives in `src/engine/rendering`. The crest and interface icons are original SVGs. Precise terrain effects are defined in game rules and matched by the server migration.

## v7 artwork

Four additional original generated assets are included:

- `public/art/city/roman-city.png`: overhead isometric Roman frontier settlement with a forum, barracks, stables, granary, quarry, sawmill and fields. Warm Mediterranean light, painted limestone and terracotta materials. Interactive pins are drawn separately by the app.
- `public/art/shared/meadow-ground.png`: orthographic olive meadow texture without trees, rivers, buildings or UI; functional terrain is drawn separately.
- `public/art/battle/field-soldiers.png`: transparent three-cell atlas of overhead Roman infantry, archer and mounted cavalry, facing right.
- `public/art/shared/environment-props.png`: transparent four-cell atlas containing oak tree, Roman keep, rebel camp and rocky hill.

All were generated specifically for Peris. Sprite cropping, team tinting, animation, combat overlays and terrain behavior are implemented in code. Open Sans is bundled under the SIL Open Font License; see `public/fonts/OFL.txt`.
