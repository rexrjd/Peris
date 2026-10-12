# Compact raids and player siege

Based on `rexrjd/Peris` main at `71a1870`, including the latest Reports icon update.
The root application is active; copy these changed paths into the repository root.

## Install

1. Run the bundled `supabase/UPGRADE_TO_V17.sql` in Supabase SQL Editor for the
   existing world. It adds city raid metadata and replaces the relevant functions.
2. Deploy the frontend after applying the SQL. Existing camp raids, reports,
   accounts, factions, recruitment, farm lists and saved journeys remain supported.

The fresh installer is for an empty database. The other SQL version filenames are
generated compatibility copies; apply one upgrade file. Database source remains
under `supabase/modules`; regenerate with `npm run build:sql`.
The existing private game worker can process city raids and return journeys.

## Sending

Camp raids, city raids and marches share the new compact review. Available troop
types appear as small tiles; icons select all, clear the party or reveal empty
types. Travel follows the slowest selected role, including siege units. Selected
troops, travel and carrying capacity stay visible above the fixed Send controls.
Route length, replacement value and round-trip estimates are under Trip details.
Orders retain the existing 30-second cancellation window and actual station pool.

Choose another player's city on the map and select **Raid city**. No invitation
or defender acceptance is required. With catapults selected, choose the building
type to target or leave Automatic selected. Rams target walls.

## Combat and damage

The existing AI controls both armies. Defence combines idle legions physically
stationed in the target city's field and its stationed troop pool. The most
experienced present commander leads defence. Troops at other cities do not join.
Defender casualties are distributed across the captured parties without deleting
newly completed recruits. Each commander receives experience in their own report.

Walls give 6% protection and two morale per effective level. Sent rams reduce the
effective wall bonus during the assault. A victory with surviving, unrouted
engines can permanently damage the walls and one catapult target. Each weapon
can remove at most two levels per battle; higher levels need more engines:

- A ram level hit needs `6 + 4 × current level` rams.
- A catapult level hit needs `4 + 3 × current level` catapults.
- Engines allocated to one level hit are subtracted from that assault's remaining
  siege strength before calculating another hit; the surviving units are retained.

Automatic targets the most developed eligible building in that city. Catapults
also reach its external lumber mills, quarries, farms and trading posts. Resource
production, storage, staffing and housing are recalculated after damage. Other
cities' buildings and fields are unaffected. Buildings may fall to level zero;
their plots remain occupied and can be rebuilt through normal upgrades. The main
building stays intact so existing city plots and wall layout retain their space.
Queued upgrades remain queued and complete from the damaged level.

Successful raiders take whole resources from the target city's actual stocks,
limited by surviving carrying capacity. The loot travels back along the accepted
route and credits the legion's home city once, with storage overflow recorded.
Defenders see resources stolen; attackers see returning loot and final delivery.
Both reports show the exact building levels lost and retain their battle side even
after the tactical record is pruned. Read/unread persistence remains unchanged.

## Validation

Production build and TypeScript pass. 431 unit tests pass with one existing skip;
four tooling tests and all 46 registered models pass. Ten browser cases pass across
desktop, mobile and 320px widths, covering nine-role selection, fixed Send/travel,
real city dispatch, invalid quantities, cancellation, siege reports, existing camp
raids and party economics. Screenshots were inspected.

Isolated database checks cover fresh installation, migration reruns, owner and
target validation, command idempotency, combined defence, casualty conservation,
new recruit preservation, resource theft and return delivery, external field
damage, private reports/helpers, siege threshold parity and automatic resolution
of undefended cities. Existing battle, troop identity/transfer and farm parity
suites pass. SQL and world generation checks pass.
