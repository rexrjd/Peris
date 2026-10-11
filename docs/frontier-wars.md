# Camps and farming integrated into Peris

The former Frontier prototype is now integrated into the main game's systems.
There is one application, one shared-world account, and the existing solo save.
`?frontier=1` opens Peris. No local Frontier API is required for player gameplay.

## Troops and villages

Nine actual troop roles use the existing eleven factions' names and icon atlases.
Infantry, spearmen, archers and elites train in Barracks; cavalry, scouts and heavy
cavalry in Stables; rams and catapults in a Workshop. Advanced roles require
city-specific research. Queue times and costs come from the shared catalog.
The same recruitment controls open inside Barracks, Stables and Workshop
building dialogs, with an owned-legion selector and each building's full research
and training queues. Transfers preserve exact quantities of all nine troop roles.
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
Every map and army shortcut reviews the selected legion and troop allocation
before sending. The slowest selected troop determines travel speed, with the
commander's speed bonus applied consistently in solo and the shared world.

## Farm lists

Create a list from Quick access, edit its default preset and losses-only report
preference, and add camps through the main map inspector. Target edits select
legion, quantities and destination list. Sorting includes distance, combat result,
last raid, last delivered bounty, all-time delivered bounty and next attack. Manual
Start list reviews saved parties; each available legion can send one party.
Unavailable targets are skipped without creating troops.
Select targets to move or delete them together, pause or enable an entire list,
apply its preset to all targets, and reverse sorting. Sent/skipped counters and
repeat deadlines are visible. Delivery history includes older and casualty-free
reports even when those reports are hidden; storage overflow never counts as bounty.

**Rally Point** combines owned stations, incoming and outgoing legions, farm lists
and reports. Reports can be grouped by camp and show troop replacement costs,
carrying capacity, delivered resources and profit after delivery. Old receipts
remain readable when their battle is pruned; unknown PvP sides are never guessed.
Camp details show recent private reports, stock capacity and land-route distance.
The raid review shows party capacity, replacement value and estimated return time.

Repeats are opt-in, with intervals from 60 seconds to one day. Shared-world repeats
require a successful manual start to save the validated land route. If a legion
moves, the stored route must pass current origin/terrain validation again; invalid
routes skip with a visible status. Missed intervals never flood a batch. Solo
schedules resume when the campaign opens. Shared-world schedules continue through
the private worker when the optional scheduler is installed.

## Deployment and compatibility

The integration includes main's account directory and compact map activity controls.
The map panel shows exact owned troop roles and active research; rival armies
retain their public aggregate information. Existing accounts, garrisons, farms
and cancellation tokens are checked against frozen pre-upgrade databases.
Code publication and database installation are separate steps. Fetch and review
current main before pushing changes. Review and apply `UPGRADE_TO_V17.sql`
to an existing production database before enabling the updated frontend; use
`FRESH_INSTALL_V17.sql` only for an empty project. The optional `ENABLE_GAME_WORKER.sql`
uses pg_cron and is kept separate so installing gameplay SQL does not silently
start a background job. It is safe to rerun the V17 upgrade: existing cities,
story progress, active raids, unit research, rosters, camps and reports remain.

Worker helpers use explicit owners internally, are revoked from anonymous and
player roles, and preserve authoritative ownership/route checks. Public snapshots
include stock and defenders but omit NPC recruitment deadlines. Worker owners are
processed in bounded batches ordered by last service time. A transaction lock
prevents overlapping jobs; owner failures are isolated and logged.

Shared-world orders use private command receipts. Before dispatch, the browser
saves the request in its tab's session storage. If the response is lost, the
pending order blocks new mutations and **Retry same order** reuses its original
request after reload. The receipt and gameplay mutation commit together, so an
accepted recruitment, farm batch or other order cannot run twice. Definite server
rejections clear the pending order. This requires V17; publication alone does not
install the endpoint. Closing the browser tab ends its session-storage lifetime.

## Verification

`npm test`, `test:tooling`, `assets:check`, generation checks and `build` cover domain
and repository rules. `test:integration-db` exercises research, parallel recruitment,
role-preserving raid reservation/cancellation, private helpers, offline battle
settlement, shared depletion, return delivery, repeated schedules and migration
reruns in an isolated database. `test:frontier-ui` now tests normal Peris on its
own port, with desktop and mobile projects. `test:e2e` retains the wider main-game
browser suite. Historical prototype server tests remain developer regression
references and do not create a player-facing side game.
`test:command-receipts-db` tests exactly-once recruitment/list creation and receipt
privacy. `test:farm-parity-db` checks atomic bulk controls and all-time history
against the generated database. Browser coverage loses a response after the real
SQL commits, reloads the page and confirms that retry creates only one list.
