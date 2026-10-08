# PERIS seamless world — map v4 / database v9

The actual game now uses the seeded low-poly map, built on the city, faction and magic work merged from `origin/main` (`a26e5e7`). There are 200 × 200 fields of 128 logical units, canonical field coordinates −100 through 99. Both axes wrap. Shared seed: 1346720329. About 93.26% is dry land, with rivers, lakes, forests, mountains, desert and ruins. Historic starting sites and campaign positions retain their coordinates and dry surroundings.

## Village architecture and development

An independent map cache reads the city team's eleven faction builders: Roman, Spartan, Persian, Egyptian, Orc, Elf, Dwarf, Gnome, Pandaren, Undead and Demon. City components, models and troop atlases are unchanged. Village compounds fit within approximately 0.72 cell; external resource compounds fit within 0.56 cell. Completed development changes actual building geometry through five stages. Public rival records expose a completed map stage without private building lists or resource stocks.

The five-race art demo at `/?map-preview=1` remains a temporary sample. Its Peri, wood/iron/clay/wheat economy, level-20 artwork and accelerated construction are separate. The actual game follows main's wood, stone, food and gold economy and five-stage resource buildings.

Internal city resource buildings occupy no map fields. Each village has four initial claim slots; the player chooses four empty fields from its eight immediate neighbours, including diagonals. Claiming and construction are separate. Empty plots and unfinished level-zero buildings produce nothing and retain natural scenery. Completed farms, lumber mills, quarries and trading posts appear on their fields with faction architecture.

Every building type can be placed on any dry terrain. Grass/farmland farms gain 10%; mountain farms lose 25%. Forest lumber gains 25%; mountain quarries gain 30%; river/coastal trading posts gain 10%. The inspector displays modifiers, output, costs and construction times before spending resources. All modifiers live in `territory.ts` and are mirrored in SQL.

Population uses main's persisted completed-upgrade counter: 80 + 10 × completed upgrades. Claim allowance starts at four, becomes five at population 120 and grows by one every further 40. Defaults live in `TERRITORY_RULES` and the corresponding SQL. Later claims must connect to existing territory, remain within six wrapped fields of the village and respect occupied fields, campaign centers and other starting rings. The first four always stay in the starting ring. Server locks and the canonical `(col,row)` primary key prevent duplicate ownership, including coordinate aliases.

Costs scale by 1.55 per completed level. Duration is 15 + 10 × current level seconds, maximum level five. Different fields can construct concurrently; each field has one pending order. Income is per minute and supplements city production. Client and server settle overdue jobs chronologically: old rate before completion, new rate afterward. Main's fisheries, separate storage capacities, faction choices, city slots, research and magic towers remain intact.

## Controls and rendering

- Drag/arrows pan; wheel/pinch zoom; Q/E rotate the 3D view. Home/Army focus owned entities; World frames one canonical realm.
- Edge navigation, claims, selection, routes and minimap footprints wrap consistently. Field search accepts whole-number aliases.
- Choose land highlights eligible fields. Claim a selected field in its inspector, then construct separately. Ineligible fields explain the restriction.
- Layers offer subtle grid lines and contextual names/resource potential. The square minimap uses actual geography and splits seam-crossing camera footprints.

Native terrain and instanced scenery share assets across a bounded 3 × 3 display. A material-batched cache shares faction/stage models. Nearby owned villages remain detailed; other villages have a 48-model detail budget. Field compounds have a 96-visible-image budget, selected first, owned next and then nearest. Other completed fields use up to 2,048 pickable instanced markers with screen-space thinning. Wider views use markers; distant scenery hides by scale. Entity removal preserves borrowed cache assets; scene teardown frees them once. WebGL context restoration resumes the existing resources. The Canvas 2D fallback also supports wrapped navigation, fields, selection and routes. Tactical battle drawing retains its existing rules and art.

## Server rules and compatibility

Private snapshots include all owned plots. Public viewport pages cap rivals at 600 villages, 600 armies and 2,000 fields, preserve seam visibility and report truncation. Fields include faction and completed level; city records contain presentation metadata only. Own rows use filtered realtime invalidation; rival pages refresh independently. No rival resource balances or construction queues are public.

New marches use wrapped eight-neighbour A* with land validation and corner protection. The server validates geometry, overrides the start, computes distance/arrival and tags accepted routes with map version four. Previous untagged/version-three routes retain linear interpolation. Claims and pending jobs persist through validated save import/export. Campaign encounters and real-time battles retain their rules.

Thousands of candidate spawn sites exist. New accounts require a dry 3 × 3 ring, no neighbouring claims and safe village spacing. Existing IDs and positions remain intact. Main still supports one village and one army per player. Multiple village founding, alliances, trade, conquest, ships and autonomous battle workers are future work. Thousands of simultaneous players have not been load tested.

## Build and release

Change geography, run `npm run build:world`, then `npm run build:sql`. Server geography contains a 5 kB walkability mask plus a 40 kB terrain byte map. Run their check commands, TypeScript/build, gameplay tests and database suites. See MAP_RELEASE.md for publication commands.

Apply `supabase/UPGRADE_TO_V9.sql` to an existing database after backup/review; use `FRESH_INSTALL_V9.sql` only for an empty one. Generating source does not deploy SQL. The transaction aborts instead of moving/deleting unsafe occupied positions or turning a town into sea. Existing routes and historic spawn IDs remain. Online v4 commands require matching metadata. Local saves keep their v6 format/key; larger-world legacy imports do not silently relocate armies.

Rendered browser QA remains pending because the saved local browser permission rejects access. Automated geometry, interaction, save, route and isolated migration tests do not establish visual fidelity or GPU frame rates.
