# Original Peris artwork

The original raster assets were generated with the built-in image generation tool for this game and are included in the project. They are also embedded in the standalone playable file. No Total War images, logos or other game assets are used.

**`public/art/peris-dawn.png`** — menu background. Final prompt:

> Use case: historical-scene. Asset type: opening background artwork for an original browser strategy game, Peris. Create one cinematic panoramic landscape painting, 1536x1024 landscape or wider: an ancient Mediterranean valley at dawn with a walled Roman-inspired stone city and terracotta roofs on the right half, a winding river, cypress trees, farmland, distant hazy mountains. In the lower right foreground show small ranks of original ancient infantry and crimson standards, seen from behind overlooking the valley, no specific copyrighted insignia. Premium painterly strategy game concept art, tactile oil-painted atmospheric detail, warm muted gold sunlight against deep olive and charcoal shadows, restrained palette. Composition: leave the left third mostly dark atmospheric hillside/sky for readable UI text. Beautiful, grounded, not cartoon, no text, no logo, no watermark. This is a world establishing shot rather than a close character portrait.

**`public/art/legion-portraits.png`** — three-column unit portrait atlas, consumed through CSS in the infantry, archer and cavalry cards. Final prompt:

> Use case: historical-scene. Asset type: an ORIGINAL unit portrait atlas for a Roman-inspired browser strategy game called Peris. Generate ONE very wide 3:1 triptych canvas, ideally 1536 x 512. Exactly three equal square portrait panels, seamless composition but clean panel boundaries, NO text, NO labels, NO decorative borders. Each panel is a shoulder-up character portrait centered in its own third with dark desaturated olive background, consistent painterly premium strategy-game illustration style, dramatic warm light, charcoal shadows, bronze and ivory highlights. LEFT THIRD: heavy legionary wearing weathered silver iron Roman-inspired helmet with red horsehair crest, crimson cloak and segmented iron armor, holding a small part of a rectangular red shield at bottom. CENTER THIRD: Mediterranean archer in muted olive-green tunic and leather cap, quiver of wooden arrows visible above shoulder, curved wooden bow on the right of this panel. RIGHT THIRD: mounted cavalry officer, iron helmet with modest brass detail, tan-gold cloak and chain armor, a dark horse's head partly visible at bottom right and a long spear. All three characters must have their face centered near the upper-middle of their respective panels, with shoulders filling bottom half. Grounded historical materials, realistic painterly faces, mature and restrained rather than cartoon, high clarity at small card sizes. No copyrighted marks, no text, no watermark. All three cards belong to one game's coherent art direction.

Campaign terrain, settlement structures, standards, minimap, icons, individual soldiers, horses, arrows, dust and fallen troops are rendered from original code in `src/game/graphics.ts`, `renderer.ts`, and `src/components`. The crest is an original SVG. Precise terrain effects are defined in game rules and matched by the server migration.

## v7 artwork

Four additional original generated assets are included:

- `public/art/roman-city.png`: overhead isometric Roman frontier settlement with a forum, barracks, stables, granary, quarry, sawmill and fields. Warm Mediterranean light, painted limestone and terracotta materials. Interactive pins are drawn separately by the app.
- `public/art/meadow-ground.png`: orthographic olive meadow texture without trees, rivers, buildings or UI; functional terrain is drawn separately.
- `public/art/field-soldiers.png`: transparent three-cell atlas of overhead Roman infantry, archer and mounted cavalry, facing right.
- `public/art/environment-props.png`: transparent four-cell atlas containing oak tree, Roman keep, rebel camp and rocky hill.

All were generated specifically for Peris. Sprite cropping, team tinting, animation, combat overlays and terrain behavior are implemented in code. Open Sans is bundled under the SIL Open Font License; see `public/fonts/OFL.txt`.
