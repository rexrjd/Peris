# Automatic trade routes and guild support

The user explicitly requested researching Travian's repeating trade routes and implementing them in Peris, with Send caravan and Create automatic route actions in the guild interface. Extend the existing Market and shared-world systems. The implementation choices below fit the existing approved caravan capacity model; they do not replace it.

## Research and approach

Primary reference: [Travian: Legends — Trade Routes](https://support.travian.com/en/articles/60-trade-routes), accessed 2026-10-23. It describes selecting destination and cargo, scheduling departure or arrival, specifying deliveries and repetition, and managing routes through edit, enable/disable and delete controls. Travian limits allied targets to special villages and gates routes behind Gold Club. Peris will offer routes to all living cities owned by current guild members, and to the player's own cities, without adding a premium gate.

Use persisted recurring route records that dispatch the existing caravans. A browser-only timer would stop supporting guildmates offline; automatically resending every returning caravan would make destination distance control the support schedule. Instead, use a fixed repeating schedule with an optional batch of one to three consecutive deliveries. Preserve all manual Market behavior, capacity, travel, overflow, refunds, game-clock timing, privacy and eleven faction graphics.

## Player experience

- Market Trade offers Send caravan, Automatic route and Manage routes. The shared cargo editor selects a source Market, destination and four whole resource amounts. Manual sends retain exact-cargo review.
- A route adds repeat interval (5 minutes through 24 hours; offer 15 minutes, 1/4/12/24 hours), one to three deliveries per run, and first departure/arrival after a chosen delay. Show the computed first departure, arrival and carrying requirement before saving.
- Saving a future route requires sufficient total completed Market capacity for one load, not resources/free merchants that will only be needed when it runs. Each actual shipment independently checks current stock and free capacity.
- Manage routes shows destination, cargo, interval, deliveries, next departure, enabled/paused state, last outcome and sent/skipped counts. Support edit, pause/resume and delete. Changes affect future departures; already dispatched caravans finish normally.
- Guild member rows offer Send caravan and Create automatic route beside existing Message/reinforcement actions. A compact dialog preselects that member and shows only their eligible cities; select a source among the player's completed Markets. Explain missing Markets and keep input on failure. Handle pending receipts through the existing journal/retry UI.
- Own-city routes work in campaigns and shared worlds. Guild support works online. Routes are private to their creator; recipients see actual incoming caravans, not another player's schedule, resources or building state.

## Scheduling rules (implementation choices)

- At most 20 routes per source city. Repeat interval is an integer 300–86,400 game seconds. Deliveries per run is 1–3. Cargo uses the existing four-resource positive whole bag, max 5,000 total and no more than the source's completed Market capacity.
- First departure is computed by the UI from departure/arrival mode and injected game time. The server/domain clamps a slightly past first departure to now and rejects malformed dates or a first start more than seven game days away. No device clock is authoritative.
- Each due route can attempt at most one dispatch per authoritative pass. Missed cycle slots are skipped/coalesced, never replayed as a burst or backdated resource spending. A normal unattended worker keeps future cycles running with the browser closed.
- At a cycle's first departure, move the next cycle anchor to the first future interval boundary, counting any missed slots. Set remaining deliveries to the configured count. After a successful shipment, schedule the next delivery in that batch at that caravan's actual return deadline; it still must independently have stock and carrying capacity. After the final delivery, schedule the next future cycle boundary, skipping any cycles that overlapped the batch.
- Insufficient resources or free merchants skips the rest of that cycle, records a readable reason and resumes at the next future cycle. Never partially change the chosen resource ratios or queue debt.
- Lost source, missing Market, changed recipient ownership, guild departure or no valid route pauses the route with a reason. Recheck eligibility at every automatic send and at actual caravan delivery. Pausing/deleting/editing never cancels cargo already travelling. Resume starts a fresh cycle at now.
- Dispatch is atomic, receipts protect route mutations, and each due attempt advances its schedule in the same transaction as any caravan creation. Concurrent worker/client runs cannot send a slot twice.

## Shared contract

New pure `TradeRoute` in `src/features/city/domain/tradeRoutes.ts`:
`id`, `owner_id`, `recipient_id`, `source_settlement_id`, `target_settlement_id`, `source_city`, `target_city`, `resources:Resources`, `march_path:[number,number][]`, `interval_seconds:number`, `deliveries:number`, `deliveries_left:number` (zero between cycles), `enabled:boolean`, `next_run_at:string`, `next_cycle_at:string`, `last_status:string`, `last_sent_at:string|null`, `sent:number`, `skipped:number`, `updated_at:string`.

Optional owner-private `World.trade_routes:TradeRoute[]`, empty for old saves/snapshots.

Commands:
- `{type:'saveTradeRoute',id?:number,settlementId:number,targetCityId:number,resources:Resources,route?:[number,number][],intervalSeconds:number,deliveries:number,firstRunAt:string}`
- `{type:'setTradeRouteEnabled',id:number,enabled:boolean}`
- `{type:'deleteTradeRoute',id:number}`

Online mapping for all three: `peris_trade_route_command(p_command jsonb)`, executed through `peris_submit_command`. Dedicated table `peris_trade_routes` and snapshot key `trade_routes`; participant target read reuses `peris_trade_targets`. DTO is owner-only, including server route paths; recipients do not read schedules. Local domain entry `commandTradeRoute(context,command)` and `advanceTradeRoutes(world,owner,now,nextId)`.

## Implementation and verification boundaries

Keep domain independent of React/browser/Three.js. The scheduler delegates cargo to the existing validated caravan dispatch core; do not duplicate movement/refund rules. Online worker progression must not depend on authenticated client context. Integrate due routes into the private worker and existing locked chronological Market settlement; acquire route-target participant locks before any dispatch. Optional hooks keep older focused installers usable. Edit SQL source then regenerate complete and focused `UPGRADE_TRADE_ROUTES.sql`; do not deploy it.

TDD covers fixed anchors, batches and held capacity, stock/capacity skips, no overdue burst, pause/edit/delete, duplicate receipt/worker calls, guild departure/owner changes, strict save import and old saves, owner privacy, unattended completion and clock rates 1/10/100. UI checks cover actual guild actions, source/member city selection, manual review, route review/save/management, pending-receipt recovery and desktop/phone layouts. Run required unit/tooling/assets/build/SQL/database/browser checks; preserve and distinguish documented baseline UI failures rather than weakening checks.
