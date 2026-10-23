# Automatic Market routes

Players can open a completed **Market → Trade** to send one caravan, create an automatic route, or manage routes from that city. In **Guilds → Members**, another current member has **Send caravan** and **Automatic route** actions. The guild picker selects one of the sender's completed Markets and only offers that member's eligible cities. Existing reinforcement and messaging actions remain available.

The cargo review shows the exact resources, source, destination, first departure and arrival, repeat interval and delivery count. Routes support departure or arrival timing for the first delivery, a delay of up to seven game days, a repeat interval of 5 minutes to 24 hours in game time, and 1–3 deliveries per run. Each further delivery waits for the preceding caravan's return. Normal and accelerated world clocks use the same domain timestamps; displayed dates map to the world's sampled real clock.

Each Market supports up to 20 routes. All manual and scheduled caravans share the existing 1,000 carrying spaces per completed Market level. Saving a future route does not reserve resources or merchants. At departure, the complete mixed cargo must fit available stores and merchants. A shortage skips the rest of that run and records the reason. Delayed processing sends at most one current-time caravan per due route; missed runs are coalesced instead of spending historical resources or creating a catch-up burst.

The manager offers edit, pause, resume and delete, next departure, status, sent and skipped counts. Editing preserves a paused route. Resuming starts a fresh run now. Existing caravans finish independently after a route is paused, edited or deleted. Loss of the source Market, required total capacity, city ownership or current guild eligibility pauses future shipments. Existing cargo retains the Market delivery, overflow-return, waiting-storage and ruin recovery rules.

Online schedules are private to their owner. Their actual caravans are visible to the sender and recipient. Mutations use the existing persisted command-receipt journal; retrying a lost acknowledgement does not create a second route or debit cargo twice. The authoritative game worker handles schedules while the player is offline. Solo routes support the ruler's own cities and persist in campaign saves.

## Research and adaptation

The [official Travian: Legends trade-route guide](https://support.travian.com/en/articles/60-trade-routes) describes target and cargo selection, departure/arrival timing, delivery counts, repeating schedules and route management. Peris adopts those useful scheduling controls. Travian's premium access and special allied-village restrictions are not used: Peris supports all eligible cities belonging to current guild members.

## Installation

Use generated `supabase/UPGRADE_TRADE_ROUTES.sql` after the existing Market installer for an existing shared world, or a generated fresh installer for a new world. Sources are `supabase/modules/city/trade-routes.sql`, `trade-route-hooks.sql`, and the associated Market/worker/snapshot/receipt modules; regenerate with `npm run build:sql`. The focused installer is repeatable and preserves populated schedules and caravans. The repository change does not deploy SQL or alter a hosted world. The existing game worker must be scheduled for unattended dispatch.

Verification results are recorded in `docs/superpowers/verification/2026-10-23-automatic-trade-routes.md`.
