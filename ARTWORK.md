# Original Peris artwork

## Diplomatic envoys and city capture

The tenth troop role uses original editable SVG portraits in
`src/features/army/ui/diplomatPresentation.tsx`. Eleven civic titles, faction
palettes, headwear, scrolls and wax seals give every faction a distinct envoy.
These vectors do not reuse a combat portrait or alter the existing nine-cell atlases.
`assets/diplomats-v1.json` records the sources and original Peris ownership.

The battlefield factory renders diplomats as instanced native geometry: long
robes, a civic mantle, sealed scroll and a staff with a standard. Faction colours
follow the two battle armies. The Canvas compatibility renderer draws the same
robe, scroll and standard identity. Animation follows existing formation updates,
reduced-motion settings and resource disposal. Existing GLBs, rigs and clips are
retained; no new raster, external asset, Blender source or model export is used.
Desktop/mobile UI and screenshots cover the capture review, main-building
recruitment and finalized loyalty receipts. Frame-rate targets remain unmeasured.

## Market buildings and caravans

The live 3D City Market uses original procedural geometry in `city/rendering/three/market.ts`.
All eleven faction architectures have five physical development stages: an open stall,
twin stalls and loading cart, a merchant hall, side arcades, and a complete merchant court.
Columns, pylons, turquoise domes, hide awnings, living timber, basalt lintels, brass gears,
pagoda eaves, crypt ornaments and horned obsidian gateways retain faction identity.
The existing Main building keeps its saved `market` ID; the new slot is `bazaar`.

The city, inspector preview and selector portrait use the same material-batched factory.
Level zero remains construction markers. The painted Village retains its existing icon
fallback for roles without a painted atlas cell. No image, GLB, external model, new license
or Blender dependency is introduced. `tests/e2e/market-gallery.spec.ts` captures all 55
completed appearances for visual review; `market-art.test.ts` checks finite geometry,
distinct faction/stage shapes and lot bounds. Performance targets remain unmeasured.

## Shared map and 3D city interface

The map and live 3D city reuse the eleven existing faction texture
paintings from `public/art/ui/rally-point-v1/`, with thin muted borders instead
of ornate painted frames. The selected city controls the
materials across navigation, resources, city and army choosers, minimap controls,
activity, building inspectors, and city reports. Elven greens, Roman bronze,
and Orc hide retain their faction palettes; the small Orc skull
ornament in `public/art/ui/orc-skull.svg` is original vector geometry. No external
game assets or new model dependencies are introduced.

## Persistent city environments

City and Village views derive their scenery from the settlement's canonical world
field. The biome controls ground, distant relief, foliage and sky, while the
location seed varies scenery, plot arrangement, wall flanks and corner depths.
Faction architecture and materials remain distinct across all eleven factions.
Identity stays stable across city growth, reloads, owner changes and map wrapping;
saved building slot IDs are unchanged.

The live 3D city now uses a shared seeded plan for Roman, Elf and Orc layouts.
Romans use ordered streets within individually clipped polygonal walls; Elves
use curved approaches and organic oval enclosures; Orcs use clustered districts
inside irregular palisades. Geography seeds the proportions and highland sites
are narrower. The plan reserves all sixteen possible internal sites immediately,
keeping existing plot positions fixed as the main building unlocks more slots.
Walls, gate openings, paths, scenery clearance, residents, camera framing and
selector portraits consume the same plan. Paths avoid every reserved building
footprint, including future sites. Resource yards and fisheries stay outside the
walls. These layouts introduce no model assets, save schema or gameplay changes.
The painted Village and the other eight factions retain their existing layouts.

Native civic clearings now contain Roman tiered fountains with paved courts,
Elf groves with standing stones, or Orc gathering fires and stools. Deterministic
placement clears roads, walls, lamp posts and every future building site. The
landmarks also appear in city portraits. Fountain streams and fire geometry
animate gently and freeze under reduced motion. Orc, Undead and Demon native
cities have no decorative flowers, flower pots or hanging flower baskets.
Broad, lighter main avenues contrast with narrow earth-toned side paths; small
paved junction squares share the road batches. Existing legacy verges retain
clearance. All additions use original native geometry and existing palettes.

Live 3D terrain and original vector Village countryside use native geometry, with
no new textures, models, downloaded art or licenses. Streets, gates, villagers,
planting clearances and surface details share the selected city's environment.
River courses vary by seed; shores leave working yards on dry ground. The earlier
painted countryside remains available to context-free previews.

New fisheries require a river, marsh, lake or coastal field in the city's wrapped
3×3 neighbourhood. Existing fisheries and pending construction retain their water
frontage, production and upgrades. The local command and authoritative SQL enforce
the same construction rule. `supabase/UPGRADE_CITY_ENVIRONMENT.sql` is generated
from modular source for review and separate application to an existing server;
this artwork change does not deploy SQL. No GPU frame-rate claim is made.

## Rally Point operations ledger

The Rally Point uses the approved ivory operations-ledger presentation in
`src/features/army/styles/rally-ledger.css`: light paper surfaces, oxblood accents,
fine gold rules, and the bundled Cinzel and Crimson Text fonts. Existing faction
crests, commander portraits, and nine-role troop icons remain tied to the actual
city and legion. The earlier faction paintings are retained as artwork sources;
the ledger no longer downloads or waits for those large background/frame images.

On phones, four Rally sections occupy the bottom navigation. Movements combines
owned incoming and outgoing orders with filters, arrival countdowns, carried
spoils, and expandable troop breakdowns. Reports adds a camp filter and keeps full
resource receipts one tap away. These are presentation changes over the existing movement, privacy,
cancellation, save, and reporting rules.

## Compact command header

Nine original transparent low-poly pictures depict the map, city, armies,
Rally Point, reports, timber, stone, food and gold. Generated individually with the built-in image tool
on 2026-10-11, they use simple sandstone, ivory and slate-blue facets that remain
readable at small sizes. `assets/ui-low-poly-v1.json` records the complete prompts
and file mapping. Untouched PNG sources live in `assets/source/ui-low-poly-v1/`.
`npm run build:ui-icons` trims and exports 96px transparent WebP pictures into
`public/art/ui/low-poly-v1/`; `npm run check:ui-icons` verifies the runtime set.
Navigation labels and exact resource amounts remain accessible independently of
the pictures. No artwork from another strategy game is included.

## Soft-painted villages

The selected city direction uses original transparent building atlases for all
eleven factions, generated with the built-in image tool on 2026-10-11. Soft painted
materials, richer midtones and deeper natural shadows retain detail at small sizes.
Each race has twelve building roles and distinct materials or silhouettes; the
Dwarf and Gnome sets were revised to avoid resembling recoloured human buildings.
Spartan, Persian and Egyptian revision-two atlases use independent stone halls,
vaulted adobe/turquoise courts and mudbrick/reed architecture respectively.

`assets/city-village-v1.json` records full prompts, role order and original ownership.
Untouched generated sheets are preserved in `assets/source/city-village-v1/`.
`node scripts/build-city-art.mjs` reproduces the 1200×1600 WebP atlases in
`public/art/city/village-v1/`. Exporting trims each cell independently, preserves
alpha, fits it into a 400px square and leaves a 24px transparent gutter. It does
not redraw the artwork. One atlas is decoded and shared across a village.

The painted layout reserves sixteen ordinary plots plus the main hall, keeping
the existing level-based unlock rules and saved slot identities. Resource sites
are outside the boundary. Race outlines and gates are original SVG geometry:
square masonry, circular timber, living woodland and additional faction variants.
These local city outlines never change ownership of fields on the global map.

The Village tab and upgrade dialogs use these sprites. The existing live 3D city
and model fallback remain available. Decorative water, chimney smoke, a gate
standard and small magical glow respect system and in-game reduced-motion settings.
The original simplified countryside painting is also recorded in the manifest and
exported by the same script. Wheat lies above the enclosure, woodland surrounds
the timber site, rocky heights back the quarry and a river inlet serves the fishery.
The enclosure is offset onto dry land; this presentation never changes world fields.
Raised wall faces, mortar, parapets, palisade posts and living foliage are original
SVG geometry. Outside access uses north and south gates; inside paths are clipped
to the boundary. The previous perimeter road loops are removed. A timber bridge
connects the shore and completed fishery, with its fisherman standing on the deck.
Up to twelve lightweight SVG NPCs use faction-specific proportions, soft lighting,
faces, clothing and equipment: two guards, two trainees, up to four residents and
four resource workers. Stone guards patrol parapets; other guards use cleared
western lanes. Work pads, wheat and the dock provide explicit walkable surfaces.
Saws, wheels, picks, crops and fishing props animate separately from the buildings.
Activities appear only beside completed buildings, avoid building images, retain
their animation timeline during economy updates, pause in hidden tabs and hide
with either reduced-motion setting. Residents are decorative and do not represent
stationed troop numbers. Evening lighting remains a preview study.
No timing, production, combat or save rule depends on animation.

The active strategic world uses original, code-generated low-poly 3D scenery. Earlier painted relief and the transparent terrain/landmark atlas remain under `public/art/map/` for the illustrated minimap and 2D compatibility renderer. See **MAP_ART.md** for those asset prompts and **MAP_WORLD.md** for the current controls and rendering architecture. Existing tactical troop atlases remain independent.

## Strategic 3D scenery

`src/features/map/rendering/WorldCanvas.tsx` starts the Three.js scene, with a Canvas 2D compatibility view if WebGL initialization is unavailable. `three/WorldScene.ts` coordinates the scene, dynamic entities, selection, route overlays and minimap. `three/SceneCamera.ts` owns the tilted camera and converts its projection back to the game's existing signed world coordinates.

`three/landscape.ts` builds continuous faceted terrain and original procedural materials, mountain ridges, sand-colored coastal banks, animated water, shallow rivers, farmland and country lanes. Trees, grass and rocks use instancing. `three/models.ts` constructs villages, keeps, ruins, sanctuaries, river crossings and army standards from original geometry, merging parts by material. Nearby detailed public models are capped at 48, while wider views use instanced markers. Optional field-grid, region-name and resource layers do not form part of the permanent terrain artwork. Visual elevations and decorations never determine gameplay movement or ownership.

The generated low-poly preview images selected during design provide art direction for the camera, palette, landscape detail and restrained interface. They are **not runtime background images**. The interactive terrain, villages, armies and routes are live meshes and overlays. The earlier continental illustration is retained for the minimap and compatibility view, not stretched beneath the 3D landscape.

Three.js is the rendering library, distributed under the MIT license copied to `public/licenses/three.txt`. The meshes and procedural scenery are original PERIS code. Tactical battles retain their Canvas 2D compatibility renderer and also expose the 3D battle prototype described below.

## Tactical unit prototypes

The standalone `/?unit-gallery=1` viewer inspects the same textured GLBs used by `/?battle-preview=1&unit-prototypes=1`. Eleven factions each have four infantry looks, three mounted looks including a scout, and two siege studies. The 77 troop appearances use the existing infantry, archer and cavalry simulation. The 22 siege appearances are inspection studies; Academy research, Workshop recruitment and dedicated siege combat are not implemented by this art work.

Frontier Wars separately implements recruitment and research for these nine roles.
Its mini icons and recruitment portraits reuse the existing nine-cell PNG atlases
through `TroopIcon.tsx`; no atlas or model is modified. Frontier siege units use
automatic class combat, with building destruction still deferred. The campaign
and model viewers retain the behavior described above.

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

`public/art/heroes/portraits/` contains 220 original painted WebP portraits: 20 for each of the eleven factions, including Orcs and all four human cultures. Eleven 5×4 source sheets were created with the built-in image generation tool. `assets/hero-portrait-roster.json` records the complete generation prompts, source sheets and export layout. Run `npm run build:hero-portraits` to reproduce the 256×320 runtime crops from `assets/source/heroes/`. The earlier ten PNGs and their manifest remain available for compatibility. No images or characters from Heroes of Might and Magic are used.

`heroes/domain/portraits.ts` selects a stable portrait from the hero ID and faction, preserving the face through class changes, renames, level gains and reloads. Commander dossiers, army rosters, victory receipts and world-map markers use the same selection. WebGL uses accessible face buttons above the actual army, preserving published faction models underneath. Canvas uses cached circular portrait images, with own armies readable even in the realm overview. Bandit camps use lightweight original tent and campfire meshes with faction colours.

The battlefield is five times its original area. Forest instances, rocky ground, snowy and sandy palettes, river shallows and a stone bridge use the same scaled footprints as authoritative terrain rules. Troop sizes and weapon ranges remain unchanged.

## Frontier camp silhouettes

Three original transparent camp sprites distinguish low (open tent outpost), medium
(timber enclosure) and hard (fortified war camp) from all player villages. Generated
with the built-in image tool on 2026-10-10. Full prompts and provenance are recorded
in assets/frontier-camps-v1.json. Originals are preserved under
assets/source/frontier-camps-v1; 384px WebP runtime files with alpha live in
public/art/map/camps-v1. No Travian assets are included.

The strategic 3D map now uses original static camp geometry from
`three/models.ts`: beige tent outpost, ochre palisade camp, and red stockade with
a timber watchtower. Faction color paints the standard. Each model fits within a
field and merges its parts into seven material batches. Frontier uses these same
models on the existing landscape, reading actual server camps and raid positions.
Campaign story landmarks retain their models. The Canvas compatibility terrain
uses small original vector trees, rocks and furrows on quiet ground; the earlier
full-cell painted atlas is preserved as an asset, but is no longer repeated
across its close map view.

## Artifact paintings

Twenty-four original individual equipment paintings were generated with the built-in
image tool on 2026-10-11. Each catalog ID has its own image; duplicate inventory
instances share that item's painting. The twelve existing IDs and their attribute
bonuses remain intact. Six Epic items, five new Legendary items and one Rare charm
complete the higher-tier loadouts. Empty slots retain the original SVG glyphs.

`assets/artifacts-v1.json` records full prompts and provenance. Untouched PNGs live
in `assets/source/artifacts-v1/`; `npm run build:artifact-art` trims transparent
padding and exports 384px WebP icons into `public/art/artifacts/v1/` without
redrawing them. Backpack cards, equipped slots and victory receipts use the same
item ID, painting and rarity. No other game's equipment artwork is included.

## Research and Academies (V18)

210 distinct original transparent technology pictures and a Research navigation picture were generated for Peris on 2026-10-12. Eleven faction Academy paintings plus a Roman master stage match the existing village art direction. The 23 untouched PNG sheets and their ordered mapping are retained in `assets/source/research-v1` and `assets/research-v1.json`. `npm run build:research-art` exports the separate runtime WebP pictures through Sharp; `npm run check:research-art` validates uniqueness, alpha and dimensions. No other strategy game assets are used. Native Academies use original faction-aware code geometry with five distinct development stages.

## V19 community navigation

Original Guilds and Messages navigation pictures use the same ivory, sandstone and slate-blue low-poly style as the existing HUD. The built-in Imagegen tool created the transparent sources under `assets/source/ui-low-poly-v1/`; prompts and export paths are recorded in `assets/ui-low-poly-v1.json` and `assets/social-art-prompts.json`. `npm run build:ui-icons` exports their 96px WebP assets, and `npm run check:ui-icons` verifies the complete set. Guild crests are original editable SVG compositions with six sigils and six preset colors, rendered by `features/social/ui/Crest.tsx`. No Travian or Albion artwork is shipped.

## V19.4 live 3D city

The native 3D settlement has an independent orthographic orbit camera with cursor-anchored wheel zoom, Q/E rotation, and compact rotation/zoom/reset controls. Its surrounding procedural landscape is wider; settlement plots, wall growth and game coordinates retain their existing rules. Resizing and upgrading the main building preserve camera zoom and rotation.

City-only moving geometry preserves windmill blades, saw wheels, crane loads, flags, a working blacksmith, fishing poles and the level-ten mage crystal outside the static material batches. Shared instanced smoke and arcane motes add ambient activity. The ordinary map and building preview factories retain their static default. All effects use original native geometry and existing faction palettes; no external assets or license dependencies are introduced. Effects pause while the tab is hidden and respect the OS/game reduced-motion setting, including when it changes while the scene is open.

## V19.5 city art direction

The native 3D city now has a central avenue, cross-streets, paved building courtyards, a civic forecourt, landscaped verges and distinct timber, farming and stoneworking yards. Available plots retain clear low foundations; their preview does not invent a completed building. A dedicated siege Workshop has five native development stages, including a ram and catapult. Buildings have larger city-only presentation scales, sill/shutter details and a more oblique default camera.

A broader, gentler river stays clear of the inner lots and connects two timber/stone bridges. The wall has an east gate aligned with the inner bridge. Shared route geometry keeps walkers on streets, uses the southern gate for resource buildings and avoids walking through the farm on trips to the lumber yard. Faction groves use four instanced draws with broadleaf, conifer, palm, bamboo or bare-tree silhouettes. Rolling terrain, reeds, rocks, softer lighting and distant fog frame the settlement.

The floating HUD uses smaller translucent plates and compact controls. Building levels appear on hover/selection, with a separate Show building levels toggle for the full overview. Wheel zoom, Q/E rotation, reduced motion, hidden-tab pause, selection, city switching and the WebGL fallback remain supported. The painted Village view and authoritative city/world rules are retained.

Research references: Anno 117's official Roads & building in the grid and UI visual-design developer articles, Townscaper's official screenshot gallery, and Civilization VII's official gameplay overview. Reference artwork is used for study only. The shipped graphics are original procedural geometry; no third-party textures or new GLB files are added.

## Ornate faction Rally Point (V19.6)

The Rally Point uses the approved original ornate prototype's eleven faction
backgrounds, transparent frames and quiet material textures. All 33 individual
paintings were generated for Peris with the built-in image tool on 2026-10-12.
Untouched PNGs are preserved in `assets/source/rally-point-v1/`;
`assets/rally-point-v1.json` records every exact prompt, source and runtime SHA-256,
generated ownership, original Peris reference paths and export byte budgets.
No other game's images, interface assets or characters are included.

`node scripts/build-rally-art.mjs` exports native 1672×941 backgrounds and
1254×1254 frames/textures to `public/art/ui/rally-point-v1/`. Format compression
does not trim, crop, resize or repaint the artwork. Frames use lossless WebP and
retain their entire original alpha plane; nine-slice cuts remain 225 source
pixels, or 290 for Orcs, 265 for Elves and 340 for Dwarves/Gnomes.
`node scripts/build-rally-art.mjs --check`, also called by `npm run assets:check`,
verifies uniqueness, hashes, dimensions, frame alpha, font weights and licenses.

Cinzel and Crimson Text regular, semibold and bold are copied unchanged from the
prototype into `public/fonts/rally-point/`. Their authors' copyrights and full
SIL Open Font License 1.1 texts are retained in `public/licenses/Cinzel-OFL.txt`
and `public/licenses/CrimsonText-OFL.txt`, with upstream sources and font hashes
recorded in the same manifest. Faction surfaces follow the selected village;
the artwork does not change army, movement, combat, account or save rules.

The eleven faction crest vectors reuse the prototype's Game Icons through
`react-icons/gi`. Lorc created Eagle Emblem, Tree Branch, Anvil, Clockwork,
Skull Shield and Daemon Skull; Delapouite created Spartan Helmet, Winged Scepter,
Egyptian Bird, Orc Head and Pagoda. `public/licenses/peris-rally-point-icons.txt`
records each original artist and primary icon page, the CC BY 3.0 artwork license,
interface color/size adaptations and the complete react-icons 5.5.0 MIT software
notice. These licensed vectors are distinct from the original generated paintings.

## V19.7 city roads and barracks training

The native city removes its screen vignette and softens the northern terrain tone.
Terrain-following roads extend to all four landscape edges. The orthographic camera retreats along its existing viewing direction to keep the foreground ahead of its near plane when zoomed out on narrow phones; framing and zoom controls remain the same. Up to 1,100 instanced
faction trees fill the wider countryside while avoiding streets, the river, city
walls and working yards. The main gate sits on the front avenue. The city-only
barracks has five larger development stages and an open drill yard; Orc halls use
paired tents to keep their broad roofs inside the lot.

An instructor and up to six trainees reuse the existing classic faction battle
GLBs, their skeletal clips, and the shared instanced animation palette. There are
two small visual batches, independent of gameplay formation state. Activity reads
only the selected owner's current city recruitment, ignores future/expired work
and other recruitment buildings, pauses with reduced motion or a hidden tab, and
releases visual/source resources when the scene closes or its faction changes.
The existing battle compatibility geometry remains available if a model fails to
load. No new image, GLB, external source or license is introduced.

New construction allows one barracks per city in the picker, campaign commands
and the authoritative row-locked server function. Earlier repeated barracks,
troops, levels and pending work remain intact. Generated complete installers and
UPGRADE_UNIQUE_BARRACKS.sql contain the same rule; SQL is not deployed by this patch.

## V19.9 walls and working resource sites

The native 3D city uses thicker stepped fortifications with stone footings,
buttresses, inset wall walks, corner towers, access steps and an open front
gatehouse. Early levels retain timber palisades. River passages have open arches;
the front avenue, northern postern and eastern bridge gate stay clear at every
city growth stage. The foreground wall remains lower so it frames the city.

City resource models have five original procedural development stages: a sawmill
with a flywheel and cut logs, a terraced quarry with lifting gear, a barn and
windmill, and a fishing landing with a boat and covered dock. Faction palettes,
roof shapes and heraldry carry through all eleven factions. Country yards use
soil, stock and fenced golden crop rows instead of civic paving. Their larger
clearings reserve the existing service roads and keep resource sites outside
the walls. Equipment uses the existing reduced-motion-aware activity system.

These changes affect city presentation and its model thumbnails. Strategic field
models, the painted village, building locations, costs, production and saved
state retain their current rules. No new image, GLB, external source, license or
SQL migration is introduced. Visual review covered desktop and phone framing,
rotation, early and mature development, and all eleven faction styles. Frame
rate targets remain unmeasured.

## V19.10 city entrances

The main city entrance is a solid arched gatehouse with flanking watchtowers,
open timber doors, stone jambs, a raised portcullis and faction roof details.
Smaller covered gateways finish the northern service road and eastern bridge.
River portals use solid spandrels above open channels, so they read as part of
the fortifications rather than freestanding bridge arches. Early wall levels
use timber gateways; level zero retains only low construction markers.

The native wall preview uses the same gatehouse factory. Static geometry remains
material-batched; custom arch source geometries are disposed after batching.
The accepted wall sections, resource sites, city growth and gameplay rules are
preserved. All geometry is original procedural Peris artwork, with no new image,
GLB, external asset or SQL migration.

## V19.11 living town details

The native 3D city adds hanging street lanterns, flower baskets, coordinated
flower beds, terracotta pots, courtyard barrels and crates, and a striped produce
stall in the existing civic square. The square's benches have backrests and one
resident reading; a shopkeeper gestures beside the stall. Street lights use shared
instanced meshes and emissive glass rather than individual dynamic lights. Flower
stems, petals and centres are instanced with faction-aware colours. All props are
original procedural Peris geometry and use the existing faction material family.

Lantern bases avoid the rendered streets and every reserved city lot. Flowers and
household props follow completed buildings; empty or unfinished plots retain their
normal construction presentation. The town details rebuild with city growth,
construction, demolition or faction changes and release their geometry/materials.
Twenty-two resident silhouettes walk at varied speeds, stop briefly at destinations
and carry fewer identical parcels. The existing route geometry remains unchanged.

Town gestures and subtle lantern flicker follow the scene's existing reduced-motion
and hidden-tab scheduling. The painted village, world map, building selection,
production, population, saves and multiplayer rules retain their existing behaviour.
No new image, GLB, dependency or SQL migration is introduced. GPU frame rate has
not been benchmarked.

## V19.12 town stonework and building identity

The native 3D city's main avenue, civic square and completed building approaches
use staggered flagstones with restrained colour variation. Working courtyards
retain earth floors; broad, softly blended grass patches break up the surrounding
lawn. Surface generation follows city growth and leaves every unbuilt reserved
plot clear. Stonework and lawn variation use two vertex-coloured material batches,
with no textures or individual tile meshes.

The Roman main hall has a taller columned facade, entrance stairs and an upgraded
bell tower. The other ten faction halls retain their architectural forms with a
taller civic silhouette and entrance steps. The smithy is an open forge with a
banded chimney, bellows, furnace, anvil and the existing animated blacksmith.
Warehouses have twin loading sheds, platforms, stock and a hoist; granaries have
raised grain silos, bands, chutes, sacks and an access ladder. Barracks retain
their accepted drill yard and gain military standards and a facade shield.
All five levels use original procedural geometry and the existing faction palette
and roof family. Building inspector previews use the same new resting models.

The strategic map's settlement factories, resource sites, walls, gates, painted
village, walking routes, recruitment animation and existing flowers and lanterns
retain their behaviour. All changes are presentation-only, release owned render
resources, and use the existing reduced-motion-aware scene lifecycle. No SQL,
dependency, external asset, image, GLB or license change is required. Frame-rate
targets remain unmeasured.

## Shared City and Map selector previews

The live 3D City and global Map use one city selector with population and stationed
army counts. Its static miniature uses the same plot model factory, transforms,
faction architecture, seeded layout and walls as the live City. Map-backed water
and preserved inland fishery frontage follow the same environment rules. Rendering
is lazy, deduplicated and cached for at most 32 appearances; batches release their
WebGL renderer, model geometry and materials. Resources, population ticks and army
changes do not invalidate the image. These are lifecycle limits, not measured FPS.

Three original landscape backdrops were generated with the built-in OpenAI
image-generation tool. Exact prompts and provenance are recorded in
`assets/city-preview-v1.json`; originals are in `assets/source/city-preview-v1/`
and shipped 256-pixel WebPs in `public/art/city/previews-v1/`. The generated images
contain terrain only; actual city geometry is composited over them in the browser.
Rebuild with `node scripts/build-city-preview-art.mjs`; `npm run assets:check`
verifies the exports. Painted Village, save formats and server rules are unchanged.
