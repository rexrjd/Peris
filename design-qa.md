# PERIS map sample — current design QA

Date: 2026-10-08. Branch: `mehdi/map-overhaul`.

## Current sample scope

The current direction is **The Wild Crown**, combining the Wild Riverlands layout with the darker Broken Crown atmosphere. The user delegated the choice. The playable native-renderer sample opens through `?map-preview=1`, with an independent seeded 200 × 200 terrain and temporary demonstration state. It is not a replacement for the existing campaign or an authoritative multiplayer implementation.

The latest user revision requests actual architectural upgrades and a seamless world. Resource walls, roofs and machinery now advance through level 20, while central village halls mature with population. The sample realm now wraps east/west and north/south, with periodic geography, shared native tile assets and wrapped ownership/navigation. These changes build on the larger Civilization-inspired silhouettes and richer scenery. City responsibilities remain separate.

Village and external resource-building visuals are exclusively map assets in `src/features/map/preview/`. No files under the city, army, battle, platform or Supabase systems were modified for this sample. The city team's four internal resource fields and city architecture are outside this implementation. Existing game entry points only gain a query switch and a launcher link.

## Visual target and evidence

- Selected combined direction: `C:/Users/alipo/.codex/generated_images/01a118be-cfda-7901-a9df-65db482f0964/exec-38bb84a1-2583-4466-9b7b-7cce732e5219.png`, 1672 × 941 pixels. Generated and displayed before implementation.
- Earlier supporting Peri-desert concept: `C:/Users/alipo/.codex/generated_images/01a10d68-67f6-7492-ae34-a02cac3d2e2c/exec-78185382-51e1-410d-b4bc-0ff6d6edfc1c.png`.
- The images establish atmosphere and scale. The user's interactive-game requirement calls for original native terrain and models. No concept image is used as the playable map background. The illustration's rectangular minimap and some oversized structures are deliberately corrected in code with square navigation and compact cell-bounded models.
- Current sample browser screenshots: **none**. The older campaign-map captures below do not show this sample and cannot establish its fidelity or functionality.

## Findings and gate

- **[P1] Rendered visual verification is blocked.** Opening `http://127.0.0.1:5173/?map-preview=1` was rejected by an active saved browser permission. A further retry after the user's “enable” reply returned the same explicit denial. No alternate browser, address, port, raw browser protocol or indirect capture was used.
- **Impact:** actual village readability, landscape composition, shader compilation, browser console status, desktop/mobile overflow, and primary interactions remain unverified in the browser. Build and native-geometry tests do not replace these checks. No percentage-fidelity or exact-look claim is supported.
- **Required next verification:** once effective browser access is restored, capture the 1672 × 941 world, regional and close views and a 390 × 844 mobile view. Compare matching views against the source. Inspect all five race compounds, particularly the Peri desert. Claim an empty mountain field, inspect its −25% farm rate, construct it, and compare walls/roofs/equipment at levels 1/2/3/5/8/10/15/20. Fill four starter slots and test population-driven expansion. Pan through both edges and a corner at several rotations, select repeated settlements, and inspect the minimap's split viewport. Search for coordinates 100 and −101 and verify canonical field ownership. Test close field focus, minimap navigation, zoom/rotation and error recovery; check the browser console. Change realm seed, verify inspector/minimap/terrain agreement and repeat the same seed to check reproducibility. Check invalid seeds preserve the current sample and a same-seed restart resets developments.

## Implemented surfaces with code evidence

| Surface | Current evidence | Browser acceptance |
| --- | --- | --- |
| Continuous realm and five homelands | Periodic seeded 40,000-cell geography, branching rivers and lake basins; five tested seeds satisfy 85–94% land. Heights, gradients and water beds join across both seams and corners. | Pending |
| Viable but varied resources | All generated starts have eight dry choices and reachable resource viability after other starting rings are protected. Richer bonuses vary. Spacing, protection and reachability use wrapped distances; settlement names are unique. | Pending |
| Race villages and scale | Five distinct native compounds bounded to 0.72 cell width/depth (1.8× earlier horizontal size) with five population stages; resource models at most 0.56 cell width/depth (2× earlier horizontal size). Models remain within their own cells. | Pending |
| Empty starting plots | No external plots preclaimed; four chosen among eight immediate neighbors, no building or income before completion. | Pending |
| Development potential | All four resource choices available on land; modifier and level-one potential visible before a claim. Grassland farms +10%, mountain farms −25%. | Pending |
| Population expansion | Connected claims across seams and corners, configurable milestones/radius, protected neighbors and canonical ownership aliases. Immutable construction and income transitions. | Pending |
| Visible improvements | Completed models only. Actual wall/roof geometry changes at every level through 20, with eight architecture milestones from hut to master works. Original race-specific barns/granaries/windmills, enclosed mills/waterwheels/saws, mine headframes/hoists/processing halls and masonry kilns/chimneys. Central village halls mature with population. Mature structures remain intact above 20. | Pending |
| Richer scenery and shadows | Layered pine/clustered oak, shrubs/scrub, dry oasis palms, rare broken arches and rune stones. Ten shared chunk-instanced geometry families; near detail hides at span 70, forest detail at 110. Larger clearings prevent neighboring crowns covering villages. Cached close-view shadow map increased to 2,048 × 2,048. | Pending |
| Restrained overlays | Selected village labels, close-view grid, claim highlighting, sparse distant markers. Ownership edges suppress internal seams and use at most seven material batches. | Pending |
| Minimap | Same cell geography, square projection, client-size/DPR backing, matching hit navigation and gutter guards. Seam-crossing viewports draw clipped translated footprints on opposite edges, including four corner pieces. | Pending |
| Responsive inspector and controls | Scoped subdued styles, mobile dock, keyboard/touch controls, seed modal, close field focus, modal focus, graphics-loss callback/restoration. | Pending |
| Enlarged model selection | Visible native meshes select their own field where roofs/flags project over a neighbor. Hidden and marker-only models cannot steal clicks; foreground terrain depth still occludes buildings. | Pending |
| Seamless native exploration | Independent wrapped camera; shared 3 × 3 terrain/scenery geometry, materials and instance buffers, periodic shaders, clipped water faces. Visible village/building copies share assets and select canonical cells. Overview shows one primary realm. | Pending |

## Automated validation and limits

- All **98** repository TypeScript/architecture/gameplay/native-renderer tests pass, including **23** sample-domain, **21** native-renderer and **4** architectural-evolution tests. Tests compare actual walls/roofs independently of crops and stockpiles, verify periodic heights/slopes, canonical ownership and duplicate-alias rejection, wrapped pan/zoom/focus, seam picking, split minimap footprints, bounded shared geometry, construction clearings, culling and exactly-once disposal. The local test runner required execution outside the filesystem sandbox because its Windows user-information lookup failed before imports inside the sandbox.
- Application and Node TypeScript checks pass. Production Vite build succeeds (194 transformed modules). The single JavaScript bundle is 1,242.84 kB before gzip and 360.03 kB gzipped; Vite emits its large-chunk advisory. This retains the existing single-bundle architecture. The bundler also required execution outside the filesystem sandbox because it could not read the project configuration through the restricted directory tree.
- Diff whitespace checks pass. Dependencies are unchanged. No city-view changes, shared-state writes, database migrations, deployment, commit or push were performed.
- Browser WebGL rendering, real touch hardware, GPU frame times, server persistence and thousands-of-player concurrency were not verified. Repeated native tiles, richer scenery and the larger shadow map specifically need close/regional/overview GPU checks before acceptance; no numeric “100% more graphics” or quality increase is claimed. The sample contains 190 settlements, not a thousands-of-player simulation. The six-second queues, initial supplies and population increments are sample balance. Economic levels are uncapped; each race/resource building uses at most 24 templates, with mature architecture fixed above 20 and five secondary detail phases. Resource models use at most nine material batches and 1,400 triangles. Shared tile/copy assets bound memory growth, but they do not establish GPU frame rates.

final result: blocked

---

# Previous campaign-map QA record — 2026-10-06

Date: 2026-10-06. Branch: `mehdi/map-overhaul`.

**Findings**

- [P1] Final visual acceptance is blocked.
  Evidence: the browser captured the playable Three.js map before the last terrain and interaction corrections. Subsequent reloads were denied, first as declined access and then by a saved user permission for `http://127.0.0.1:5173/`. The user approved verification and reported enabling permission, but the saved permission still blocked the retry. No alternate browser or indirect capture was attempted.
  Impact: the final smoothing, forest density, river surface, occlusion and label-march behavior have code/test evidence but no fresh browser screenshot or interaction evidence. The older close view also remains visibly simpler than the approved illustration; it cannot establish final art fidelity.
  Fix: restore the browser's effective permission, capture the current desktop regional/close and mobile states, compare against the references, test the corrected interactions, and update this report. Do not mark the visual gate passed from build or geometry checks.

**Source visual truth**

- Approved close concept: `C:/Users/alipo/.codex/generated_images/01a10d68-67f6-7492-ae34-a02cac3d2e2c/exec-14b7a99e-7489-41e7-8084-1643b0816d4a.png` (1672 × 941 pixels).
- Approved regional concept: `C:/Users/alipo/.codex/generated_images/01a10d68-67f6-7492-ae34-a02cac3d2e2c/exec-b863fed2-53c5-425a-bba6-aa9087e20cb0.png` (1672 × 941 pixels).
- These are art-direction previews for a native interactive game scene, not images to use as map backdrops. Canonical fields, original campaign positions, real state and commands remain the implementation's content. The existing resource/navigation shell is preserved intentionally.

**Browser-rendered evidence**

All paths below are under `C:/Users/alipo/.codex/visualizations/2026/10/05/01a10d68-67f6-7492-ae34-a02cac3d2e2c/`.

| Screenshot | Pixels | State and limitation |
| --- | --- | --- |
| `lowpoly-close-before.jpg` | 1671 × 940 | Earlier close view with excessive rectangular crops and segmented water. |
| `peris-lowpoly-close.jpg` | 1671 × 940 | Home focus, four zoom-in steps and rotated camera; default overlays off. Captured before final regional smoothing and input fixes. |
| `peris-lowpoly-wide.jpg` | 1671 × 940 | Full 200 × 200 world, north up, region layer enabled; opaque extended ocean. Captured before final regional smoothing. |
| `peris-lowpoly-region-before.jpg` | 1671 × 940 | Oakwood region after activating its label; shows hard biome edges and ridge walls subsequently corrected in code. |
| `peris-lowpoly-mobile-before.jpg` | 390 × 844 | Army inspector open; real march action, minimap, army status and navigation remain visible. Captured before final geometry/input fixes. |

Desktop CSS viewport: 1672 × 940; reported device pixel ratio approximately 1. The browser capture has a one-pixel right-edge difference from the CSS viewport; source has one extra vertical pixel. No resampling or percentage-fidelity claim was used. Mobile CSS viewport and capture: 390 × 844, DPR approximately 1; document scroll width was 390, with no horizontal overflow.

The source close image and the saved close screenshot were opened together in the same comparison input, most recently after the browser permission block. The source regional concept and the whole-world capture were also opened together earlier, but they are different camera states: that pair demonstrates world scale, not regional visual fidelity. The missing matching regional/field-(4,3) close capture must be obtained before acceptance.

At full resolution, the close pair makes the toolbar, labels, model shapes and landscape density readable. It shows enough detail to identify drift, but does not replace a final focused comparison of the village/forest/river composition. A matching post-fix focused view remains pending.

**Required fidelity surfaces**

- Fonts and typography: the existing Georgia display headings and Open Sans/Arial controls retain PERIS's serif hierarchy. Actual toolbar labels and inspector headings were readable in desktop/mobile captures; small mobile world metadata was reduced to fit. The concept's decorative title mark is not a verified 1:1 match.
- Spacing and layout rhythm: campaign and layers start collapsed, labels are limited to important entities/selected content, and the army card is compact. The mobile inspector occupies a scrollable dock below the map; its primary march action stays visible. The existing resource bar and navigation make the chrome taller than the concept intentionally.
- Colors and tokens: dark green/gold chrome, cream/terracotta villages, olive foliage and blue water follow the chosen direction. Harsh rectangular terrain colors in the regional screenshot were a substantive mismatch; blurred, warped presentation colors are now implemented but still require a new capture.
- Image quality and asset fidelity: runtime terrain, trees, settlements and army figures are original native 3D geometry, as required by the interactive-map scope. They remain simpler than the generated concept. The retained illustrated minimap is an existing original asset; it is not evidence that the main scene matches the illustration. Full final forest/ridge/water quality cannot be accepted without post-fix rendered evidence.
- Copy and content: `200 × 200 · 40,000 fields` is real metadata. Find uses signed -100..99 coordinates. Labels and army strength come from the existing campaign state rather than invented preview data. Inspectors distinguish field resource potential from actual building production, and sea destinations retain shipping limitations.

**Comparison and repair history**

| Earlier finding | Correction | Post-fix evidence |
| --- | --- | --- |
| [P1] Repeated field artwork and symbols overwhelmed the close map. | Native continuous terrain, instanced scenery, material-batched models, default-off overlays, limited labels and thinned distant markers. | `peris-lowpoly-close.jpg`; native campaign selection and marching tested in browser. |
| [P2] Crops read as repeated rectangular stamps. | Reduced plot count, bevels, terrain-following furrows and open clearings. | `peris-lowpoly-close.jpg` compared with `lowpoly-close-before.jpg`. |
| [P2] Water revealed a rectangular map-board boundary at overview. | Opaque water shader and ocean geometry extending beyond playable bounds. | `peris-lowpoly-wide.jpg`. |
| [P2] Hard biome rectangles, ridge walls and sparse distant forests. | Presentation height/color smoothing, warped color sampling and fuller varied instanced canopies; gameplay geography unchanged. | Finite geometry/heights checked; six legacy site/ford heights preserved; about 819k triangles in 12 landscape mesh draws. Browser evidence pending. |
| [P2] River ribbon could disappear below terrain triangles downstream. | Shared vertices across six width segments, clearance sampled against the actual ground triangles. | 60 independent terrain-ray clearance probes passed, minimum clearance about 0.008 field units. Browser evidence pending. |
| [P2] Camera picking, anchored zoom, pan and portrait overview could drift. | Ray/surface picking, iterative anchor compensation and overview resize preservation. | All 11 camera tests pass on final terrain. Rotation/overview/field search tested in browser before final input corrections. |
| [P2] Clicking a realm label did not navigate. | Label activation focuses its real region coordinate. | Oakwood click and camera change verified; `peris-lowpoly-region-before.jpg`. |
| [P2] Hidden/thinned markers could be selected, and labels intercepted march orders. | Track emitted/detailed hit targets, reject terrain-occluded anchors and share validated march dispatch with selectable labels. | Four regression tests call the actual scene picking, occlusion, march and label handlers; all pass. Browser interaction retest pending. |
| [P2] Scene teardown left light/instance GPU buffers allocated. | Dispose directional shadow targets and InstancedMesh resources as well as geometry/materials. | Seven instance disposal events and safe repeated landscape disposal checked; TypeScript passes. |

**Function and validation evidence**

- Browser-tested before the final polish: campaign loading; field search and inspection; real march command, countdown and arrival; return home; army inspector; camera rotation, zoom and overview; layer controls; realm navigation; mobile inspector without overflow.
- Existing quick battle entered deployment and ran real time; its tactical Canvas 2D renderer and troop atlases remain in place.
- No console warnings/errors were present in the last successful local browser check. The final source needs a new console check.
- Final product sources passed all 46 existing TypeScript/architecture tests plus four new scene regressions (50 total), app/Node typechecks and the production build. The 11 camera tests passed after final terrain smoothing. Existing database/fresh-install checks and generated-world/SQL consistency checks passed; unchanged database suites were not repeated for visual-only fixes.
- The final standalone export, `C:/Users/alipo/OneDrive/Desktop/mmmm/Peris/standalone/Peris-v8-playable.html`, is 32,261,401 bytes. It has no external/dynamic script imports, eight byte-verified embedded images, valid inline scripts and the full Three.js MIT notice. No remote database migration, deployment, push or thousand-player load test was performed.

**Follow-up polish and test gaps**

- More settlement variation and finer environmental storytelling can follow the first native scene, after its base quality is accepted.
- Real two-finger hardware input, low-end GPU frame times, context-loss recovery and large-server concurrency have not been physically/load tested.
- Multi-village founding, naval movement, alliances, trade, siege and conquest remain subsequent game systems, not features completed by this map change.

**Implementation checklist**

- [x] Keep the approved 200 × 200 canonical world and existing gameplay baseline.
- [x] Implement native low-poly rendering and real map/game-state interactions.
- [x] Preserve tactical battles and shared Git history.
- [x] Build, typecheck and run relevant automated checks.
- [ ] Capture final regional/close/mobile views once effective browser permission is restored.
- [ ] Retest hidden-marker picking and marching through labels in the browser.
- [ ] Recompare the final village/forest/river composition and resolve remaining P1/P2 visual drift.

final result: blocked
