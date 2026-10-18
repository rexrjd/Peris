# Unit statistics and starting faction balance

Status: approved for implementation on 2026-10-18 after the plan, stats and limitations were presented directly in chat for remote review. The user requested "Make the changes". The HTML review is saved at `output/unit-balance/peris-unit-stats-and-plan.html`. Work stays in the existing isolated worktree, on `plan/unit-stats-balance`. The unattended-worker proposal remains separate and unimplemented.

## Intended outcome

Give players readable unit statistics and useful army comparisons, and establish a reasonable starting balance between fighting ability, resource investment and production time across all eleven factions. Preserve the nine existing roles, recruited counts, account research, heroes, equipment, armies, garrisons, reports, automatic AI, simultaneous combat, morale, spells and travel rules. Keep the v6 save identity/format; allow additive, validated balance-version metadata. No SQL deployment, main merge, force push or player reset.

The chosen approach shares recruitment costs/training times across factions and adds small attack/protection trade-offs. It avoids 99 independently maintained unit definitions and discounts that can be converted through troop transfers. A fully separate faction roster/economy or a new aggregate battle resolver is outside this first pass.

## What is already implemented

`frontier/domain/units.ts` already defines nine roles with attack, defence, speed, carry, costs and training; `army/domain/roster.ts` exposes them to the active game. The combat engine applies class damage rates, attack/defence, research, heroes, smithies, spells, terrain, stances, facing and charges. Unit inspection already exists, but primarily exposes multipliers rather than comparable reference ratings.

Important integration findings:

- `makeFormations` currently applies role stats through its advanced-roster branch; the three basic types otherwise rely on defaults. SQL always reads their catalog rows. Explicit basic-unit values must be applied consistently before changing them.
- `peris_apply_hero` reconstructs base attack/defence from the SQL catalog, so applying faction modifiers only in formation construction would be overwritten. Both paths need the same resolver.
- An army's displayed faction follows its home city, while account research follows the first city. Preserve these distinct existing concepts.
- Faction selection is freely available. Treat faction combat differences as the home city's army doctrine, captured when a battle starts. A city change, rebase or transfer affects a later battle's doctrine; it cannot rewrite an active battle. Every doctrine has strengths and weaknesses, with identical role recruitment prices/times. Persistent birth-faction cohorts would require a separate roster redesign and are not introduced here.
- Save validation currently compares formation values against the current catalog. Raising elite or archer stats without versioned validation would reject legitimate old battles.
- Casualty replacement costs and old-report fallbacks also read current prices. They must use the battle/report's balance version, rather than repricing an old battle after an upgrade.
- New frontend code can be used with an older online database because deployment is explicitly separate. Such a server must continue to display/use v1 unit economics.

## Reference statistics

Keep the actual damage formula, class coefficients, attack intervals, charge rules and formation geometry. Display:

- `attackPoints = 100 * classDamageRate / 0.020 * unitAttack * permanentAttackModifiers`.
- `protectionPoints = 100 * unitDefence * permanentProtectionModifiers`.
- Existing tactical speed, ranged reach/contact, carry, four resource costs and exact batch training time.

The class rates remain infantry `0.020`, archers `0.012`, cavalry `0.031`. Attack points describe uncharged open-ground reference pressure, and are not health, damage per hit, or a win probability. Ranged troops use their ranged coefficient; existing melee and movement penalties still apply. Show base, faction-adjusted and army-effective values without applying research/heroes twice. Label cost per soldier and training for a selected batch; the five-second batch floor remains.

Army comparison shows total reference attack/protection points, composition, carry and slowest-role travel pace with commander/research modifiers. Keep siege identified separately. Do not collapse everything into an unvalidated power score or expose rival private troops/research.

## Initial shared candidate values

These are initial calibration candidates, not a claim that the complete game is balanced. All factions use the same role costs/training. Existing research unlock requirements and research costs are unchanged. Speed, range and carry are unchanged. No new upkeep, health, scouting mechanic or faction ability is added.

| Role | Attack multiplier | Protection multiplier | Reference attack / protection | Wood | Stone | Food | Gold | Base seconds/soldier |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Infantry | 1.00 | 1.00 | 100 / 100 | 4 | 2 | 6 | 1 | 2 |
| Spearmen | 0.90 | 1.30 | 90 / 130 | 5 | 3 | 7 | 1 | 3 |
| Archers | 1.25 | 0.90 | 75 / 90 | 6 | 2 | 5 | 1 | 3 |
| Elite infantry | 1.60 | 1.60 | 160 / 160 | 7 | 5 | 10 | 1 | 4 |
| Light cavalry | 1.00 | 1.00 | 155 / 100 | 5 | 6 | 10 | 3 | 5 |
| Scouts | 0.45 | 0.75 | 69.75 / 75 | 3 | 2 | 4 | 1 | 2 |
| Heavy cavalry | 1.45 | 1.40 | 224.75 / 140 | 8 | 10 | 16 | 4 | 8 |
| Rams | 0.60 | 2.00 | 60 / 200 | 18 | 12 | 12 | 4 | 12 |
| Catapults | 2.40 | 0.70 | 144 / 70 | 25 | 18 | 14 | 6 | 18 |

Infantry remains an affordable, fast production baseline. Defensive troops pay with offensive pressure and production time; elites pay with supplies/time for soldier-cap efficiency. Archers trade protection and training speed for useful protected ranged damage. Cavalry pays for mobility, charge opportunities and carrying. Scouts are affordable fast, weak troops; no price premium is justified by an unimplemented scouting system. Siege is valued through existing fortification effects as well as field combat.

Do not add wood+stone+food+gold as if they were interchangeable. Evaluate actual four-resource baskets and gold scarcity, plus independent barracks/stables/workshop production. The existing level/training-research formula and five-second minimum remain unchanged. Never retroactively spend/refund resources or change an accepted order's timestamps.

## Adjusted faction candidate multipliers (second probe)

Each cell is attack/protection for that combat class, applied once before existing research/hero bonuses. Spearmen, elites and rams follow infantry; catapults follow archers; scouts/heavy cavalry follow cavalry. No speed, morale, mana or siege-damage modifier is introduced in this pass. Richer faction concepts in the illustrations remain future design directions.

| Faction | Infantry A / D | Archers A / D | Cavalry A / D | Initial emphasis |
|---|---|---|---|---|
| Roman | 1.00 / 1.00 | 1.00 / 1.00 | 1.00 / 1.00 | Neutral reference |
| Spartan | 1.00 / 1.03 | 0.98 / 0.98 | 0.98 / 0.98 | Protected infantry |
| Persian | 0.98 / 0.98 | 1.04 / 1.00 | 1.04 / 1.00 | Ranged/cavalry pressure |
| Egyptian | 1.00 / 1.02 | 1.00 / 1.02 | 0.96 / 0.96 | Protected foot troops |
| Orc | 1.03 / 0.99 | 0.965 / 0.965 | 1.03 / 0.99 | Melee/cavalry attack |
| Elf | 0.99 / 0.99 | 1.06 / 1.02 | 0.99 / 0.99 | Ranged specialisation |
| Dwarf | 0.99 / 1.05 | 0.99 / 0.99 | 0.965 / 0.965 | Infantry/ram durability |
| Gnome | 0.99 / 0.99 | 1.05 / 1.02 | 0.99 / 0.99 | Archers/catapult support |
| Pandaren | 1.00 / 1.02 | 0.99 / 0.99 | 0.99 / 0.99 | Durable line |
| Undead | 0.99 / 1.02 | 0.97 / 0.97 | 1.02 / 1.01 | Durable line and cavalry |
| Demon | 1.04 / 0.97 | 1.06 / 0.99 | 1.00 / 0.95 | Attack with protection trade-offs |

Calibration may adjust these candidates, preserving shared prices and faction directions. Keep final faction multipliers inside `0.94..1.06`; proposed Orc/Dwarf values are inside that range. Keep Roman at 1.00. If tests show a stronger change is needed, present the revised design rather than widening this limit silently. New role-stat changes beyond the candidate table require evidence and a documented before/after; new mechanics require another design decision.

The simple weighted reference budget `0.5*sqrt(infantryA*infantryD) + 0.3*sqrt(archerA*archerD) + 0.2*sqrt(cavalryA*cavalryD)` is approximately 1.0 for every candidate. This is only a sanity check; it does not establish battlefield balance. Simulation tests remain the acceptance evidence.

## Data ownership and compatibility

Create one versioned JSON catalog under `src/features/army/domain`, containing immutable v1 rules, current v2 rules and v2 faction profiles. A pure domain resolver supplies both game logic and UI. Generate SQL catalog/profile rows from that JSON before composing bundles; remove the duplicated hand-maintained SQL unit values. Keep existing exports as compatibility aliases while migrating active consumers to version-aware access. Avoid a runtime import cycle between army and frontier modules.

Add optional `unit_balance_version` to World snapshots and `balance_version` to battles/results. Missing online metadata means v1; do not assume an old server installed v2. Local campaigns migrate future recruitment to v2, while pre-existing battles are tagged/interpreted as v1. New local/server battles use v2 and capture attacker/defender doctrines before formations are built. Unknown versions or faction IDs are rejected by input/save validation.

In SQL, adding battle version must initially mark existing rows v1, then change the default for newly inserted battles to v2. Do not update existing formation values, battle clocks, queued orders or stored reports. Existing queued production completes on its recorded finish time. Formation snapshots retain their starting base/faction/research values through a faction change or save round trip.

Preserve saved replacement costs. For missing historical cost fields, use the report's version (absence means v1), including pruned battle references. Add an explicit versioned loss-cost helper and retain the old two-argument helper as a current-version compatibility wrapper. Do not change casualty counts, finite stock, carrying capacity, loot delivery, siege rules or once-only settlement.

All SQL sources and permissions live under `supabase/modules`. Generate complete installers plus a guarded focused `UPGRADE_UNIT_BALANCE.sql`; never hand-edit bundles. The focused upgrade changes only catalogs, balance metadata, affected formation/hero/recruitment/snapshot/economics definitions and permissions. Apply twice only to isolated populated fixtures. Publish/deploy nothing.

## Balance evidence and acceptance

The current-rule probe used a resource basket `{wood:560,stone:480,food:720,gold:120}`, corresponding to forty minutes at existing base production. It could buy 120 infantry, 102 spearmen, 60 archers, 40 elites, 30 light cavalry, 40 scouts or 17 heavy cavalry. Both sides were swapped in each tested matchup. This confirms that per-soldier multipliers alone do not establish economic balance.

A second candidate probe using the table above bought 72 elites against 120 infantry: infantry won with 40 surviving, while 16 elites survived routed. Thirty heavy cavalry beat forty light cavalry with 12 versus 10 surviving. These limited results support meaningful cost/capacity trade-offs; they do not prove every role is useful. Scout travel/raid utility and siege usefulness need separate scenarios.

A 22-battle diagnostic compared each candidate faction against Roman in both orientations on plains, 60 infantry/30 archers/12 cavalry per side, with no hero/research/spells. All resolved; the Roman mirror drew. Several small modifiers produced decisive routing differences. Do not infer fairness from their near-identical weighted reference budgets.

The first complete 990-battle probe of the initial profiles took 62.126 seconds, with zero timeouts. Every faction played 180 games. Its scores were Roman 45.56%, Spartan 60.00%, Persian 46.11%, Egyptian 46.67%, Orc 66.11%, Elf 35.56%, Dwarf 51.11%, Gnome 39.44%, Pandaren 57.78%, Undead 71.11%, Demon 30.56%. These values fail the proposed pooled-score target for several factions. They are investigation results, not approved release balance.

The second 990-battle probe used the adjusted table above, took 72.641 seconds and had zero timeouts, valid troop states and conserved casualties. Its scores were Roman 46.11%, Spartan 61.11%, Persian 41.67%, Egyptian 41.11%, Orc 61.11%, Elf 42.78%, Dwarf 50.56%, Gnome 39.44%, Pandaren 58.33%, Undead 65.00%, Demon 42.78%. Seven of eleven factions meet the proposed target; Spartan, Orc, Gnome and Undead still need tuning. The complete diagnostic report and throwaway probe are under `output/unit-balance`. No application code or SQL has been changed.

Implementation must supply a reproducible report with:

- All 55 faction pairs in both orientations, three mixed compositions and plains/woods/river: 990 baseline battles, zero unexplained timeouts/non-finite or negative state, and casualty conservation.
- Equal four-resource budgets, equal production time per building, and equal soldier-cap scenarios; unused resources and actual troop counts remain visible. Do not force pure scouts/siege to win frontline duels.
- Base research as the starting-balance acceptance target. Add matched research-investment and advanced-research diagnostics without deleting or silently nerfing existing research. Document any endgame imbalance separately.
- Aggregate faction win/draw scores and per-composition/terrain results. Target 40–60% pooled score for each faction in the agreed baseline matrix, with each faction winning some and losing some matchups. This is a suite target, not a public win-probability claim. If bounded adjustments cannot meet it, report that before calling the balance pass complete.
- Relevant PVE camp, cavalry counter, guarded infantry, protected archer, siege and scout travel/raid cases. Role changes must be justified by actual combat/economic evidence.
- Exact local/SQL stat and recruitment parity for all 99 faction-role combinations at base and representative researched states; practice, story, bandit, duel and city-raid construction paths are covered.
- Old active saves, legacy missing stats, queued training, returning loot and old reports survive round trips/upgrades. New UI agrees with the effective formation values; old online servers still show v1 costs/stats.

Run repository unit/tooling/assets/build, all relevant generation and isolated database checks, and E2E with screenshots and real pointer interactions on the unit inspector, army comparison and recruitment UI. The earlier unchanged-source baseline passed 458 tests (one skipped), tooling/assets/build and five database suites. `check:sql` previously failed solely on the checkout's CRLF research catalog bytes; regeneration must repair those bytes without weakening the checker.

## Approval boundary

Approve the design and accompanying plan before implementation. The table and profile values are concrete starting candidates; bounded test-driven calibration is part of implementation. No production source or SQL has been changed during this investigation.
