# Original Peris artwork

The active strategic world uses original, code-generated low-poly 3D scenery. Earlier painted relief and the transparent terrain/landmark atlas remain under `public/art/map/` for the illustrated minimap and 2D compatibility renderer. See **MAP_ART.md** for those asset prompts and **MAP_WORLD.md** for the current controls and rendering architecture. Existing tactical troop atlases remain independent.

## Strategic 3D scenery

`src/features/map/rendering/WorldCanvas.tsx` starts the Three.js scene, with a Canvas 2D compatibility view if WebGL initialization is unavailable. `three/WorldScene.ts` coordinates the scene, dynamic entities, selection, route overlays and minimap. `three/SceneCamera.ts` owns the tilted camera and converts its projection back to the game's existing signed world coordinates.

`three/landscape.ts` builds continuous faceted terrain and original procedural materials, mountain ridges, sand-colored coastal banks, animated water, shallow rivers, farmland and country lanes. Trees, grass and rocks use instancing. `three/models.ts` constructs villages, keeps, ruins, sanctuaries, river crossings and army standards from original geometry, merging parts by material. Nearby detailed public models are capped at 48, while wider views use instanced markers. Optional field-grid, region-name and resource layers do not form part of the permanent terrain artwork. Visual elevations and decorations never determine gameplay movement or ownership.

The generated low-poly preview images selected during design provide art direction for the camera, palette, landscape detail and restrained interface. They are **not runtime background images**. The interactive terrain, villages, armies and routes are live meshes and overlays. The earlier continental illustration is retained for the minimap and compatibility view, not stretched beneath the 3D landscape.

Three.js is the rendering library, distributed under the MIT license copied to `public/licenses/three.txt`. The meshes and procedural scenery are original PERIS code. Tactical battles retain their Canvas 2D compatibility renderer and also expose the 3D battle prototype described below.

## Tactical unit prototypes

The standalone `/?unit-gallery=1` viewer inspects the same textured GLBs used by `/?battle-preview=1&unit-prototypes=1`. Eleven factions each have four infantry looks, three mounted looks including a scout, and two siege studies. The 77 troop appearances use the existing infantry, archer and cavalry simulation. The 22 siege appearances are inspection studies; Academy research, Workshop recruitment and dedicated siege combat are not implemented by this art work.

Models have separate humanoid and mount skeletons, embedded color/normal/metal-roughness surfaces, and idle/walk/attack clips. The battle renderer instances their geometry and uses a shared 48-sample animation palette. Carried shields target 60% of their bearer’s bare body height, excluding mounts, weapons and helmet ornaments. Dwarves use a mechanical catapult with a geared winch instead of a rock-throwing giant.

The current mount direction uses great antlered stags for all three Elf cavalry roles, shaggy mountain rams for Dwarves, and huge rats for Gnomes. Heavy ram armor follows the supplied dark navy and gold direction; scouts keep an exposed wool coat. These new ram and rat silhouettes use adapted quadruped motion rigs and refitted seated riders. They remain visual prototypes requiring animation and art review. Elf metal armor is gilded. Persian troops have fitted gold lamellar, silk trim and rank ornaments; the Cataphract has an enclosed visor, gloves and articulated horse barding. Demon heavy cavalry and the Stonehurler have an additional fitted armor and surface pass.

The nearest explicit model node's `peris_role` metadata owns role selection in both the solo viewer and battle renderer. Ancestor names are a fallback for earlier assets. This prevents a copied mount with older ancestor metadata from appearing inside another formation. Copied mount bodies also retain the donor's explicit parent inverse and local basis so their source orientation survives reparenting.

`public/models/battle/faction-rosters.json` records the active source edition and near/distance fingerprints. Cache URLs use those fingerprints; the gallery’s Refresh models button reloads that publication record. `orc-pilot=1` is a separate development override and can show a staged historical edition rather than the current public Orc pack.

Editable packed and unjoined Blender editions, earlier rejected studies, downloaded references and original screenshots remain under `assets/source/battle`, `assets/references/units` and `artifacts/battle-preview` locally. Raw and optimized exports are separate files. The publisher validates embedded resources, clips, component credits, byte budgets and actual support vertices at all 49 phase samples before replacing a public pack. Artist native frames remain 1–25 at 24 FPS; an unsaved export clone captures complete transforms at 48 FPS. Runtime node names are namespaced after export without changing geometry or animation targets.

These are visual prototypes with an open art review, not final production art. Concept portraits and rendered models are separate assets. Source components retain their license and artist attribution in each GLB, `assets/manifest.json` and `public/licenses/peris-faction-rosters.txt`; changing them in Blender does not remove their license requirements.

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

## Commander portraits

`public/art/heroes/` contains ten original PNG portraits generated for Peris using the built-in image generation tool. `assets/hero-portraits.json` records their filenames, art direction and prompts. The subjects cover four human cultures, Elves, Dwarves, Gnomes, Pandaren, Necropolis and Demons. Orcs retain an original geometric face portrait. No images or characters from Heroes of Might and Magic are used.

`heroes/domain/portraits.ts` supplies the same faction identity to commander dossiers, army rosters and world-map markers. WebGL uses accessible face buttons above the actual army, preserving published faction models underneath. Canvas uses cached circular portrait images, with own armies readable even in the realm overview. Bandit camps use lightweight original tent and campfire meshes with faction colours.

The battlefield is five times its original area. Forest instances, rocky ground, snowy and sandy palettes, river shallows and a stone bridge use the same scaled footprints as authoritative terrain rules. Troop sizes and weapon ranges remain unchanged.
