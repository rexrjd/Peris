# Unit statistics and balance v2

The active game uses the nine existing recruited roles and eleven factions. `src/features/army/domain/unitBalance.json` owns frozen historical v1 prices/stats, v2 prices/stats and faction profiles. `unitBalance.ts` resolves them for domain code and UI; `scripts/build-unit-balance.mjs` generates the private SQL catalog. No damage, AI, morale, charge, spell, travel, siege, casualty, reward or settlement algorithm was replaced.

## Reading the ratings

Attack is reference pressure: `100 × class rate / 0.020 × effective attack multiplier`. Protection is `100 × effective defence multiplier`. Ordinary unmodified infantry is 100/100. Army values include faction doctrine and existing research, commander/equipment and smithy bonuses. Range, formation geometry, terrain, stamina, morale, charges and counters remain separate; these ratings are not a victory probability or a new health stat.

Shared per-soldier costs and training rates:

| Role | Reference attack / protection | Wood / stone / food / gold | Base seconds |
|---|---:|---|---:|
| Infantry | 100 / 100 | 4 / 2 / 6 / 1 | 2 |
| Spearmen | 90 / 130 | 5 / 3 / 7 / 1 | 3 |
| Archers | 75 / 90 | 6 / 2 / 5 / 1 | 3 |
| Elite infantry | 160 / 160 | 7 / 5 / 10 / 1 | 4 |
| Light cavalry | 155 / 100 | 5 / 6 / 10 / 3 | 5 |
| Scouts | 69.75 / 75 | 3 / 2 / 4 / 1 | 2 |
| Heavy cavalry | 224.75 / 140 | 8 / 10 / 16 / 4 | 8 |
| Rams | 60 / 200 | 18 / 12 / 12 / 4 | 12 |
| Catapults | 144 / 70 | 25 / 18 / 14 / 6 | 18 |

Batch time retains the existing formula and five-second minimum. Barracks, stables and workshop retain independent queues. Accepted orders retain their paid resources and stored timestamps.

## Captured faction doctrines

Each cell is attack/protection multiplier. Spearmen, elites and rams use infantry; catapults use archers; scouts and heavy cavalry use cavalry. Costs and training are identical across factions, preventing faction changes from converting cheaper recruits into expensive soldiers.

| Faction | Infantry | Archers | Cavalry |
|---|---|---|---|
| Roman | 1 / 1 | 1 / 1 | 1 / 1 |
| Spartan | 1 / 1.015 | .98 / .98 | .98 / .98 |
| Persian | .98 / .98 | 1.04 / 1 | 1.04 / 1 |
| Egyptian | 1 / 1.02 | 1 / 1.02 | .96 / .96 |
| Orc | 1.02 / .99 | .965 / .965 | 1.03 / .99 |
| Elf | .99 / .99 | 1.06 / 1.02 | .99 / .99 |
| Dwarf | .99 / 1.05 | .99 / .99 | .965 / .965 |
| Gnome | 1 / .99 | 1.05 / 1.02 | 1 / .99 |
| Pandaren | 1 / 1.01 | .99 / .99 | .99 / .99 |
| Undead | .98 / 1.012 | .97 / .97 | 1.015 / 1.01 |
| Demon | 1.04 / .97 | 1.06 / .99 | 1 / .95 |

An army uses its home city's doctrine. City defenders use the defended city. NPCs use their camp faction and practice battles use their explicit selections. New battles capture both doctrines and the catalog version before formations are created. Changing faction, transferring troops or rebasing does not recalculate an active formation.

## Calibration and its limits

`npm run balance:units` runs the actual fixed-step automatic formation engine with no rendering or saved player data. The baseline is all 55 faction pairs, both orientations, three compositions and plains/woods/river: 990 battles. The selected profiles scored:

| Roman | Spartan | Persian | Egyptian | Orc | Elf |
|---:|---:|---:|---:|---:|---:|
| 51.67% | 51.67% | 41.67% | 48.33% | 56.67% | 41.11% |

| Dwarf | Gnome | Pandaren | Undead | Demon |
|---:|---:|---:|---:|---:|
| 53.89% | 48.89% | 57.22% | 53.89% | 45.00% |

All eleven meet the agreed 40–60% pooled baseline target. The original implemented candidates failed for Spartan, Orc, Gnome and Undead. Bounded calibration reduced the relevant infantry advantages, improved Gnome's non-ranged attack trade-offs, and adjusted Pandaren after the other changes exposed an indirect advantage. Roman remains neutral and every multiplier stays within .94–1.06.

The wider report adds 110 all-pair battles for each of resource baskets, independent building production, soldier capacity and advanced-role compositions, plus 22 matched neutral-research and endgame diagnostics. The first complete 1,452-battle run had zero timeouts and conserved casualties. The report records actual rosters, each resource spent, unused budget, production time, source hash, doctrines, winners, survivors and terrain/composition/matrix slices. `npm run check:unit-balance` verifies generation and a fast representative sample.

These are starting-balance measurements. Individual composition/terrain slices can be strongly one-sided. For example, Undead won its 20 matches in the single resource-basket recipe, while Egyptian and Demon scored 10% in that slice. Such slices remain visible in the report; the pooled target does not promise equality at every army size. Research diagnostics are separate and do not certify endgame balance. Live multiplayer outcomes and production pacing still need player feedback.

Resource utility regressions also exercise both orientations: the basket `{wood:560,stone:480,food:720,gold:120}` buys 120 infantry or 72 elites; infantry win that field matchup, preserving a cost/capacity trade-off. Thirty heavy cavalry beat forty light cavalry at the same basket. Existing role-transfer, travel, city siege, PVE, hero, research and automatic settlement suites exercise the unchanged utility rules.

## Compatibility and installation boundary

- Save format/key remains v6. Missing battle/report version means v1. Old formation values, receipts and queued training are preserved; malformed versions and new snapshots missing required stats are rejected.
- Local future recruitment uses v2. An older online server with no `unit_balance_version` advertises v1 by absence, so the new frontend retains its old prices, training and previews.
- Full installers and `supabase/UPGRADE_UNIT_BALANCE.sql` are generated from `supabase/modules`. The focused V19 upgrade adds legacy version defaults before changing new-insert defaults, replaces only affected definitions and permissions, and schedules no worker. Isolated tests apply it twice to populated accounts, research, artifacts, messages, queues and active battles.
- Historical report fallback prices use their recorded version even if the battle has been pruned. Stored replacement costs take priority, including later loot delivery and overflow calculations.
- Catalogs/helpers remain private. The authoritative server computes recruitment and battle state. Existing once-only finalization and command receipts remain intact.

SQL deployment and scheduler activation are separate actions. The unattended-worker proposal remains separate.
