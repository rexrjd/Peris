# Market buildings and resource caravans

Build **Market** in an ordinary city plot, then open its **Trade** tab. Select another city you own or a current guild member's city, enter wood, stone, food and gold, and review the exact shipment before confirming. Own-city trade also works in solo campaigns. The destination does not need a Market.

Each city can construct one Market. Completed levels 1–5 provide 1,000–5,000 total carrying capacity. A mixed cargo uses the sum of all four resources. Outbound and returning caravans hold their original capacity until the merchants return and unload. Upgrades increase available carrying capacity immediately on completion.

Caravans use the normal wrapped land routes at 22 logical units per game second. Delivery uses each resource's actual storage headroom. Overflow returns; a full home store keeps it waiting to unload without losing goods. Guild departure or a ruined/ineligible destination returns undelivered cargo. A ruined home redirects cargo to a reachable living city; stranded cargo is preserved. City and Map Events show the selected cities' private trade activity.

The new building's internal slot ID is `bazaar`. The existing `market` Main building, external Trading posts and their income remain intact. All eleven factions have five original native 3D models, also used by previews and city portraits. No new external asset or Blender export is needed.

## Shared-world installation

The server update is generated in `supabase/UPGRADE_MARKET.sql` for a current V19 world with City Logistics and Guild Reinforcements installed. Review and apply it separately through your normal database release process; this development change does not deploy SQL. Complete fresh/upgrade installers also include the Market subsystem. Source lives in `supabase/modules/city/market.sql` and `market-hooks.sql`; rebuild with `npm run build:sql`, verify with `npm run check:sql`.

The server validates ownership, current guild membership, cargo, route and capacity; receipts prevent duplicate spending when retrying an unconfirmed order. Participant-private snapshots redact another ruler's return cargo. The unattended worker advances shipments without a browser. Older campaign saves load with no caravans, and new campaign exports preserve active shipments.

## Verification

`npm test`, `npm run test:tooling`, `npm run assets:check`, `npm run build`, SQL generation checks and the affected isolated database suites cover this feature. `npm run test:market-db` exercises rates 1×/10×/100×, receipts, storage chronology, overflow, privacy, eligibility, wrapped routes, ruined cities and focused migration reruns. Its independent-session PostgreSQL contention tests need a configured isolated `PERIS_TEST_DATABASE_URL`; PGlite alone does not verify real concurrent lock scheduling.

`tests/e2e/market.spec.ts` exercises the actual City send/review/delivery/return flow; `market-recovery.spec.ts` covers guild target loading/retry and acknowledged receipt recovery. `market-gallery.spec.ts` captures all 55 completed appearances. Desktop and phone screenshots were inspected. Frame-rate targets and large connected trade-network throughput remain unmeasured.
