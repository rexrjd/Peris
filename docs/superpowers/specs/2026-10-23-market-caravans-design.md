# Market buildings and resource caravans

Status: proposed for approval. The user chose caravan capacity in chat on 2026-10-23. The remaining defaults below are the builder's proposals, not decisions attributed to the user.

## Intent and scope

Add a Market that lets a ruler send wood, stone, food and gold to another city they own or a current guild member's city. Higher completed levels permit more resources to be transported concurrently. Provide original live 3D City graphics for all eleven factions and all five building levels, matching each faction's existing architecture.

Success means a player can construct a Market, prepare and review a resource shipment, watch its authoritative delivery and merchant return, and upgrade to send more. Own-city transfers work in campaigns and online; guild transfers work online. Existing buildings, factions, campaigns, account privacy, guild reinforcements and the Canvas compatibility map remain functional.

There is no player-to-player resource exchange, public offer board, automatic trade route, resource conversion, taxation, caravan interception or ship transport in this feature. The painted Village receives only the compatibility support needed for the new building; its artwork is not the implementation or visual-review target. No SQL is deployed.

## Approaches

1. **Caravan capacity, chosen by the user:** resources travel between cities, and the shipment reserves capacity until its merchants return. Upgrades expand simultaneous carrying volume. This suits the game's existing wrapped land travel, persistent time and timed operations, at the cost of implementing outbound and return lifecycle state.
2. **Daily sending allowance:** deduct an allowance per dispatch and reset it by time period. This is simpler transport accounting but introduces a reset boundary and does not give returning merchants a role. The user selected caravan capacity instead.

Use the existing React/TypeScript/Three.js stack, pure domain systems, command receipt journal, shared game clock and authoritative SQL modules. New graphics use original procedural geometry through the existing city model kit. These are builder choices based on repository architecture, not new platform dependencies.

## Building identity and progression

The saved `BuildingType` ID `market` already means Main building, and map fields with that ID are Trading posts. Preserve both IDs and all their rules. The new internal city-slot ID is `bazaar`, displayed everywhere as **Market**.

Proposed defaults:

- One Market per city, in any ordinary unlocked building plot. Construction and upgrading use the existing city queue, cost scaling, research construction speed and completed-upgrade progression. A level-zero construction contributes no capacity.
- Maximum level five. Capacity is 1,000 / 2,000 / 3,000 / 4,000 / 5,000 resource units at completed levels 1–5. Each wood, stone, food or gold unit counts equally; a mixed cargo uses their sum.
- Initial construction costs 220 wood, 180 stone, 100 food and 50 gold; subsequent upgrades use the normal 1.55 cost multiplier and normal level durations.
- Capacity is shared by all active caravans originating at this city. Both outbound and returning merchants reserve their original dispatched volume. Upgrading immediately adds the newly completed capacity. No per-shipment or daily allowance is added.
- The receiving city does not need a Market. Existing Trading post income/research, Main building plots and gold production do not change. No new population staffing or research bonus is introduced for Markets.

Example: a level-two Market sends 700 wood and 500 stone. Its 1,200 occupied capacity leaves 800 available until those merchants return. Delivering the goods does not release that capacity early.

## Preparing and sending resources

The live 3D City construction picker offers Market, and the completed building's inspector contains Trade and Upgrade tabs. Trade shows total, occupied and available capacity; a destination selector grouped into My cities and Guild cities; four resource quantity inputs with available amounts and Max controls; total load; and one-way delivery and merchant-return estimates.

Only a different, living, eligible city can be selected. A dedicated online target read returns current guild members' living city IDs, names, owner names and canonical coordinates, without resources, capacity, queues or building lists. Own destinations come from the owner's existing private city state. Campaigns explain that guild destinations require the shared world.

Quantities must be finite safe integers, nonnegative, with a positive total no greater than available source resources and free Market capacity. Reject unknown resource keys, malformed commands, ruined cities, a missing/completing Market, ineligible recipients and disconnected land routes. Source ownership and recipient eligibility are checked on the server immediately before spending. Preparation previews are not authoritative.

Send resources opens an explicit review with source, destination/owner, exact cargo, total load, delivery time and return time. Confirmation dispatches through the normal receipt journal. While an outcome is unconfirmed, retry the same receipt and original selection; do not create another shipment or debit again. Preserve entered values on errors. Show success and the resulting caravan in activity after acceptance.

## Travel, delivery and capacity release

Use existing wrapped eight-neighbour land pathfinding and authoritative route validation, including seam crossings, diagonal corner rules and canonical city positions. No straight-line travel through sea. The proposed caravan speed is 22 logical units per game second, with the existing two-second minimum per leg. All factions use the same gameplay speed. Use shared-clock time for persisted dates and clock-aware real-time countdowns.

Accepted dispatch atomically deducts cargo, reserves its summed volume, records sender and intended recipient identity, source/destination city identity, route and deadlines, and creates one caravan. A client cannot provide an authoritative price, capacity, distance, sender ID or arrival time.

At the actual arrival deadline, settle the recipient city's production/construction through that instant before crediting the shipment. Check that the recorded recipient still owns the living destination and is either the sender or currently in the same guild. If valid, deliver each resource up to its own available storage space (food uses food capacity; other resources use material capacity). The recipient's stocks never exceed storage. Undelivered overflow stays on the returning caravan. If the recipient is no longer eligible, return the entire cargo. Never credit a new owner of the recorded city.

Incoming deliveries are part of the recipient's chronological settlement as well as the sender's/worker's due work. A recipient command, snapshot settlement or worker must process incoming arrivals before advancing the affected stocks beyond those deadlines. If required participant locks cannot be acquired, defer/retry that advancement rather than skip the arrival and advance the city anyway. Do not try to rewind stocks already settled to a later time, and do not change delivery to the processing time. Share an internal nonrecursive event-processing layer so sender/recipient settlement cannot recursively call one another indefinitely. This temporal contract is a builder choice needed to make storage and long-absence results agree with the described rules.

Merchants then travel home even when their cargo is empty. Normal return takes the same duration as the outbound leg and is scheduled from the original arrival deadline, so an overdue tick can complete both legs without adding an artificial wait. Release the originally reserved volume once the return is complete and all returning cargo is unloaded.

If the home city cannot store returned goods, unload what fits and retain the remainder in a private **Waiting to unload** caravan. This keeps its original capacity occupied and shows the exact remaining cargo and reason. Subsequent authoritative settlement attempts to unload the remaining resources as space becomes available, without duplication or silent loss. Sending/spending resources can create space for the waiting cargo; mutations must settle in a consistent order. No free storage warehouse or unlimited dispatch capacity is created.

If the source city is ruined before return, route the caravan from its actual current return point to the sender's nearest reachable living city, using the existing deterministic nearest-city routing convention. Retain the original capacity/source attribution. If no reachable living city exists, keep the undelivered cargo in a private stranded state rather than deleting or crediting it to another owner; normal defeat rules can freeze it. Empty returning merchants can finish without a refund destination. A ruined destination triggers the same return behavior as an ineligible recipient. No manual cancel or recall is added in this version.

Delivery, refund and capacity release are independent once-only transitions. Concurrent transfers, opposite-direction sends, guild membership changes and worker/client ticks must serialize without double spending, double delivery or deadlock-prone inconsistent lock order. Use the established participant lock strategy, ordered settlement row locks and receipt transaction boundaries. Membership is rechecked at delivery under the same serialization discipline as existing guild operations.

## State, persistence and privacy

A caravan records immutable ID, sender, recorded recipient, source/destination city IDs and labels/coordinates needed for receipts, original resource bag and reserved volume, remaining return cargo, canonical path, departure/arrival/return deadlines and lifecycle status. Only sender and recipient can see the relevant shipment; only the sender sees returned/stranded cargo details after the outbound delivery result. The public map and other guild members receive no trade state or private stock data.

Pure trade-domain selectors own capacity, cargo validation and lifecycle calculations. Pure local commands and chronological settlement own campaign mutation. Rendering and React only read state and emit commands. Add optional campaign caravan state with an empty default for old saves; validate IDs, ownership, resource bags, levels, routes, statuses and lifecycle dates on import. Campaign saves must not synthesize guild membership or accept foreign-owned shipment recipients. Preserve the existing save format/key and all legacy main-building IDs.

Online SQL owns participant-private storage, dispatch, delivery, refund and worker progression. Integrate due caravans into the private unattended worker, so the browser is not required for completion. Add participant-filtered snapshot data and a narrowly scoped target read. Cover the new dispatch RPC with the existing command receipt mechanism and supported-function permissions. Keep optional private hooks where older focused installers need compatibility. Edit only modular SQL source, then regenerate complete bundles and a focused Market upgrade through the SQL build system. Ship SQL files for separate review/application.

## City activity and usability

Trade lists outgoing caravans and returning merchants for the selected city, incoming deliveries for the selected recipient city, and waiting/stranded returns belonging to the sender. Include origin/destination, cargo, current phase and countdown or waiting reason. Integrate these rows into the existing live City/Map Events selector as well as the Market inspector; do not expose them as army movements or public map markers. Labels and participant filtering must stay stable if a city is renamed or ruined.

Support keyboard entry, labelled controls, narrow phones, readable disabled reasons, busy/receipt recovery, destination-load retry and changing selected city without sending from stale state. The game remains playable when WebGL is unavailable. Compatibility building previews can use the existing native model fallback when no painted sprite exists. Do not repaint the Village atlas or reuse Main building artwork for Market identity.

## Original 3D artwork

Use a dedicated `createMarket` factory wired through the city slot model, building preview and shared city thumbnail paths. Stage changes alter actual geometry, not only scale or colour. All plots respect the existing building footprint, reserved neighbouring plots, streets and wall clearance. Static geometry uses the existing material batching and proper disposal; no new image, GLB, Blender connection, dependency or license is needed.

Shared level progression:

| Level | Added visual development |
| --- | --- |
| 1 | Open trading stall, counter, awning and visible cargo |
| 2 | Second stall and a small loading cart |
| 3 | Permanent merchant hall with an open trading court |
| 4 | Side arcade, sheltered stock and a larger loading area |
| 5 | Full merchant court, prominent gateway and faction ornament |

Each faction has a silhouette/structural distinction at every level, alongside its existing materials and roof family:

| Faction | Market architectural identity |
| --- | --- |
| Roman | Columned stone trading arcade, terracotta roofs and bronze scales |
| Spartan | Broad austere stone portico, crimson canopy and shield ornament |
| Persian | Sandstone bazaar, vaulted/iwan entrance, turquoise dome and tiled court |
| Egyptian | Flat mudbrick stalls, reed awnings, pylon entrance and lapis trim |
| Orc | Heavy timber/hide booths, tusk supports and iron-banded cargo |
| Elf | Curved living-wood supports, leaf canopies and crystal ornament |
| Dwarf | Low angular basalt vaults, heavy lintels and copper trade fittings |
| Gnome | Round booths, domed brass exchange house and gear ornament |
| Pandaren | Timber pavilion, layered curved roofs, jade detail and lanterns |
| Undead | Crypt-like exchange arcade, bone supports and restrained green crystals |
| Demon | Obsidian trading court, horned gateway and molten-colour inlays |

Keep level zero as construction markers. Any optional flags or awning motion use the existing reduced-motion/hidden-tab lifecycle and never affect trade timing. No new per-caravan world geometry or per-resident physics is required.

## Verification and delivery

Tests cover uniqueness and completed-level capacity; mixed-resource validation; simultaneous capacity reservation; sender resource debit; once-only retry/delivery/refund; returning capacity; full food/material storage; overflow unloading; guild departure; ownership changes; ruined cities; disconnected/wrapped routes; old/malformed campaign saves; chronological overdue settlement; shared-clock rates; participant-only reads; worker completion; and concurrent dispatches/settlement. Local/SQL parity must be checked for shared rules.

Run `npm test`, `npm run test:tooling`, `npm run assets:check`, `npm run build`, `npm run test:e2e` and inspect captured screenshots. Run SQL generation/checks and fresh/upgrade/affected isolated database suites, including Market, guild support, social, city slots/logistics and clock/worker behavior. Keep pre-existing failures distinct and do not weaken checks.

Browser review uses actual pointer/keyboard actions in the live 3D City: construct/select/upgrade a Market, prepare/review/send cargo, see returning capacity and unloading feedback, switch cities, and inspect desktop/phone layouts. Capture a native model contact sheet of all 55 faction/level combinations and inspect it, plus in-city early/mature stages and compatibility fallback. Screenshots and draw/lifecycle checks do not establish GPU frame-rate targets; report performance as unmeasured unless measured on named hardware.

Work on a small review branch. Before any push fetch `origin/main`, inspect the other developer's changes since divergence, integrate without overwriting either person's work, and rerun affected checks. No push, publish, production database application or unrelated cleanup is part of design approval.

## Decisions delegated to implementation

The builder may choose exact file decomposition, DOM/CSS layout within the established inspector, batching geometry details, internal table/function names, generated upgrade filename and bounded retention of completed delivery receipts. Keep a useful recent trade history without unbounded private snapshots. These choices must not change capacity, permissions, delivery/refund behavior, the five stages or eleven-faction coverage described above.
