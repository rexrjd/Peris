# Crop consumption and starvation

## Intent and authority

The user requested hourly troop crop upkeep and Travian starvation mechanics. They explicitly chose negative production with stored crop clamped at zero. Their specified costs override Travian tribe-specific prices: infantry 1, mounted troops 2, rams 3 and catapults 4 crop per game hour. Use the existing `food` resource and Peris production scale.

Research: [official starvation mechanics](https://support.travian.com/en/articles/83-starvation-mechanics), [crop problems](https://support.travian.com/en/articles/75-problems-with-crop), [resource and troop upkeep guide](https://support.travian.com/en/articles/214-guide-resources-explained), and [forwarding rules](https://support.travian.com/en/articles/72-special-servers-forwarding-troops). Public guides define behavior but do not publish server code. Match those documented rules for Peris's existing combat troop systems; do not claim identical undisclosed implementation or add unrelated Travian systems.

## Approved behavior and Peris mapping

- Each game hour costs `infantry/spearmen/archers/elite=1`, `cavalry/scout/heavyCavalry=2`, `ram=3`, `catapult=4` per soldier. These values apply to all eleven factions and both existing balance catalogs. Existing resident costs and production remain; consumption is not multiplied by research or battle speed. The 1/10/100 game clock supplies elapsed game time.
- Negative net production drains food reserves. At empty storage with insufficient production, choose the next starvation casualty and refund that role's recruitment food cost from the active unit balance catalog. Continue chronological integration with the smaller force and credited crop. Never store negative crop or kill a fixed percentage.
- Starvation priorities: foreign stationed support, own support away from its home, native/home troops, then travelling troops. Within a tier, the largest army row loses first. Re-evaluate after each casualty, giving equal rows alternating losses. Within a row use the most numerous role, then the existing `RECRUIT_UNITS` display order: infantry, spearmen, archers, elite, cavalry, scout, heavyCavalry, ram, catapult. Stable row-kind/key ordering resolves row ties.
- Stationed troops eat in their host city. Marches eat from their supplying home/source city until arrival, then change supply at the actual arrival timestamp. Raid reserves stay supplied at home. Owned-field station troops use the field's associated city, like village-linked oasis support. Returning guild parties use their owner's supplying city. Existing permanent city-to-city garrison transfers become native defenders at arrival; preserve that established Peris transfer behavior.
- Every existing actual combat troop store counts exactly once: legions, raid reserves, permanent city garrisons, temporary station pools, city transports, guild support, and ruin evacuation parties. An empty legion and its persistent commander remain valid. Commanders and settlers keep their existing Peris lifecycle; this feature covers the nine soldier roles rather than adding hero resurrection, traps, artefacts, or new logistics types.
- Residents do not die from a crop shortage under the enabled rules. Growth pauses while stores are empty and supply is inadequate. Preserve existing resident upkeep values, staffing and production rules. Existing construction and research requirements remain.
- No starvation before a city's calculated exhaustion time. Deliveries and refunds stop or defer starvation as soon as they arrive. Already queued recruits start consuming only on completion. Casualties, transfers and departures update consumption at their authoritative event boundary.
- Battle casualties and starvation must not be restored by later formation settlement. Active battle force counts represent the same soldiers as legion/garrison stores, not additional troops. A starvation loss updates the appropriate force and matching live formations. Refund the recruitment food for eligible combat/starvation losses exactly once; avoid refunding starvation again as a combat loss at battle finalization. Preserve existing casualties, loot, reports and battle results.

### Extended battle compatibility

Travian resolves combat immediately; Peris has extended battles and spells that heal ordinary combat casualties. Keep the committed backing roster supplied until the battle's irreversible settlement, matching the existing roster lifecycle. Credit food for permanent combat casualties at that settlement only. A starvation death immediately removes a backing soldier and records the captured source/formation loss. Formation survivors and healing are capped at initial soldiers minus starvation losses; finalization debits only remaining combat losses and never refunds a starvation death twice. This avoids granting food repeatedly by healing the same casualty and preserves post-capture recruits. This is an explicit Peris adaptation, rather than a claim about unpublished Travian server internals.

## State contract

`World.troop_upkeep_version?: 1` advertises the enabled system. Absence means a legacy save/server. Optional private Settlement fields:

```
food_troop_upkeep?: number       // crop per game MINUTE; UI multiplies by 60
starvation_losses?: number      // cumulative soldiers starved in this city
starvation_last_at?: string|null
```

Keep `food_upkeep` as resident upkeep for compatibility. `food_rate` becomes net production after resident AND troop consumption; `food_gross_rate` stays gross production. Additional private checkpoint/tie/refund metadata is allowed if required for exact idempotency, but it must be validated on import and omitted from public map DTOs.

## Integration approach

Use authoritative event-based settlement. Hourly flat deductions or rendering-frame attrition cannot match depletion timing, refunds and reinforcement changes. Pure domain systems and authoritative SQL mirror the same event rules; UI reads their state and sends existing commands.

Extend the existing population integrator with troop consumption and a starvation-boundary hook; keep display projection free of roster mutation. Authoritative city accrual has access to World troop stores. A complete settlement advances food to each ordered event, applies its troop/production/resource changes, refreshes supply, then continues. Include recruitment, construction/research production changes, marches, support arrival/return, caravans and combat transitions. Partial raid/import passes must not advance future event state out of order.

SQL implements the same contract in `supabase/modules`, with private helpers and existing player/component lock discipline. Connected foreign support owners/hosts must settle under a deterministic locked component; no sender/recipient recursion, unguarded trigger time travel or public economy leakage. The unattended worker includes idle owners with troop upkeep or crop shortages, so starvation cannot require a browser poll. Repeated settlement at the same time is idempotent.

## Compatibility and migration

Settle pre-upgrade progress using its existing rules to a clear activation boundary before enabling consumption. Do not retroactively charge previously free troop upkeep across an old offline period. Fresh realms start enabled. Solo import/export preserves enabled food state and losses. Older online servers remain usable and cannot advertise or simulate troop deaths client-side. Famine is authoritative online and domain-driven locally.

Generate all SQL bundles and a repeatable focused `supabase/UPGRADE_CROP_UPKEEP.sql`; do not deploy it. Preserve completed Markets and repeating caravan receipts. A food caravan arriving at the starvation boundary must be processed consistently and cannot rescue or kill troops retroactively.

## UI

Show troop crop use per hour in unit inspection/recruitment and army summaries. City food details separate production, resident use, troop use and net production; header net food may be negative. Display an estimated exhaustion time with reserves and a clear starvation warning/loss count when empty. Values must come from authoritative enabled state; do not mutate troops in renderers or expose another player's food balance.

## Verification and review focus

Test one long absence versus many short ticks, depletion exactly at zero, mixed-role/tied armies, refund-driven survival, population preservation, all troop stores without duplication, source-to-host changes at arrival, recruits only after completion, arriving crop rescue, battle/starvation conservation and one-time refunds, empty legions, destroyed sources/hosts, saves and upgrades, participant privacy, idle workers and 1/10/100 clocks. Include practical large-force catch-up checks; report measured limits instead of claiming throughput or FPS.

Run unit, tooling, assets and build checks, SQL generation and affected isolated database suites, and desktop/mobile browser flows with inspected captures. Preserve the documented 20 unrelated browser baseline failures. Keep changes on a review branch; no push or SQL deployment.
