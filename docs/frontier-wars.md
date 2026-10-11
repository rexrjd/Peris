# Camps and farming integrated into Peris

The former Frontier prototype is now integrated into the main game's systems.
There is one application, one shared-world account, and the existing solo save.
`?frontier=1` opens Peris. No local Frontier API is required for player gameplay.

## Troops and villages

Nine actual troop roles use the existing eleven factions' names and icon atlases.
Infantry, spearmen, archers and elites train in Barracks; cavalry, scouts and heavy
cavalry in Stables; rams and catapults in a Workshop. Advanced roles require
city-specific research. Queue times and costs come from the shared catalog.
Existing three-class counts remain aggregates; `unit_roster` preserves roles
through combat casualties, training, station pools, transfers and cancellation.
Legacy armies without a roster retain their original three troop types.

The Workshop is an ordinary city plot and currently uses the faction's smithy
artwork. Dedicated Workshop art can be reviewed separately. Existing painted
village boundaries, resource sites, sixteen plots and the 3D view remain intact.
Siege units participate in formation combat; structural siege damage is not
implemented. Scouts are units, not a new hidden-intelligence mechanic.

## Raids and resources

The existing roaming camp IDs, positions, races and three map models remain.
Each camp stores resources up to tier-specific capacity. Production continues
while a battle runs; defender recruitment pauses during that battle. Growth
intervals are private and random in the shared authority. Old depleted soldiers
and stock persist across repeated upgrades. Six story camps keep their existing
progression, fixed spoils and cooldowns.

Camp raids use the existing automatic battles and faction models. Loot is limited
by surviving soldiers' carrying capacity, removed from shared stock once, and
credited to the army's home city when survivors return to their departure station.
Reports record delivered resources and storage overflow. Unsent troops remain in
that owned station's garrison and can join a different legion. Returning armies
merge what is still there; troops exceeding legion capacity remain stationed.
March and raid cancellation expires after 30 seconds. Ordinary station destinations
must be owned villages or fields. Allied reinforcement requires an alliance system
and is not enabled by this update.

## Farm lists

Create a list from Quick access, edit its default preset and losses-only report
preference, and add camps through the main map inspector. Target edits select
legion, quantities and destination list. Sorting includes distance, combat result,
last raid, last bounty, total bounty in loaded reports and next attack. Manual
Start list reviews saved parties; each available legion can send one party.
Unavailable targets are skipped without creating troops.

Repeats are opt-in, with intervals from 60 seconds to one day. Shared-world repeats
require a successful manual start to save the validated land route. If a legion
moves, the stored route must pass current origin/terrain validation again; invalid
routes skip with a visible status. Missed intervals never flood a batch. Solo
schedules resume when the campaign opens. Shared-world schedules continue through
the private worker when the optional scheduler is installed.

## Deployment hold and compatibility

This local branch includes main's account directory and map activity updates.
The map panel shows exact owned troop roles and active research; rival armies
retain their public aggregate information. Existing accounts, garrisons, farms
and cancellation tokens are checked against frozen pre-upgrade databases.
No production changes are authorized yet. Fetch and review further main changes
before publication. Review and apply V16
manually only after integration and tests. The optional `ENABLE_GAME_WORKER.sql`
uses pg_cron and is kept separate so installing gameplay SQL does not silently
start a background job. It is safe to rerun the V16 upgrade: existing cities,
story progress, active raids, unit research, rosters, camps and reports remain.

Worker helpers use explicit owners internally, are revoked from anonymous and
player roles, and preserve authoritative ownership/route checks. Public snapshots
include stock and defenders but omit NPC recruitment deadlines. Worker owners are
processed in bounded batches ordered by last service time. A transaction lock
prevents overlapping jobs; owner failures are isolated and logged.

## Verification

`npm test`, `test:tooling`, `assets:check`, generation checks and `build` cover domain
and repository rules. `test:integration-db` exercises research, parallel recruitment,
role-preserving raid reservation/cancellation, private helpers, offline battle
settlement, shared depletion, return delivery, repeated schedules and migration
reruns in an isolated database. `test:frontier-ui` now tests normal Peris on its
own port, with desktop and mobile projects. `test:e2e` retains the wider main-game
browser suite. Historical prototype server tests remain developer regression
references and do not create a player-facing side game.
