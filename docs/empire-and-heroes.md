# Empire and heroes gameplay

The city and army selectors now target independent assets. Resources, construction, external fields, research and settler training belong to the selected city. Recruitment, marches and raids belong to the selected army. Battle casualties, home regrouping, loot and hero experience affect only the participating army and its home city.

## Start playing

1. Open **Menu → Cities & expansion**, or choose **Empire** in the city dock.
2. Upgrade the main building to level 2. Train three settlers using the source city’s supplies.
3. Accumulate culture, choose a dry site on the map, and use **Found a city here** in the field inspector. The expansion panel also accepts X/Y field coordinates.
4. Send the settlers. Their supplies and culture are committed at departure; the city appears at arrival. Select it from the city selector to develop it independently.
5. Open **Army**, select a hiring city, and hire a Knight, Ranger or Mage. Train soldiers there or bring two idle armies together and transfer troops.
6. Select each army on the map to march or raid independently. The hero panel contains equipment, experience, skill points and the home-city control.

For a fast solo check, city debug tools can fill storage and set the main building to level 2. **Expansion debug → +1,000 culture** skips the initial culture wait. Settlers still train and travel on their actual timers. Multiplayer debug remains subject to the existing server debug flag.

## Expansion rules

| Rule | Current value |
| --- | --- |
| City limit | 10 per ruler |
| Culture income | 5/min per city + 2/min per legacy building level + 3/min per placed building level |
| Next-city culture cost | 300 × existing/reserved city count²: 300, 1,200, 2,700… |
| Settlers required | 3 per colony; main building level 2 unlocks training |
| Training cost per settler | 350 wood, 250 stone, 450 food, 100 gold |
| Colony supplies | 500 wood, 400 stone, 600 food, 150 gold |
| Prepared settler limit | 6 per source city, including those on expeditions |
| Minimum separation | 4 fields from other cities and reserved colonies |
| Travel | Connected dry-land path at 18 world pixels/second |

The city center and its eight neighboring fields must be dry. Claimed fields and campaign landmarks protect their neighboring land. Shared-world founding and arrival reserve land under a database lock, so two rulers cannot settle the same area. A site that becomes invalid returns its settlers, culture and colony supplies; resource refunds respect storage capacity. New cities start with eight level-zero building records, empty optional plots, 750 wood, 600 stone, 800 food and 250 gold. They inherit the source city’s faction and receive no free army.

Culture and production integrate chronologically through queue completions and colony arrivals. Starting another colony reserves the higher next-city culture cost immediately. Each city has its own construction queue and territory development allowance.

## Armies and commanders

Each city supports two armies across the empire, up to twenty. A new commander costs 500 gold in the hiring city and creates an empty army. Every army has a 1,000-soldier capacity and up to three sequential recruitment batches. Training requires an idle army near the selected city and uses that city’s barracks/stables and supplies. A training queue blocks only that army’s movement.

Troop transfers conserve infantry, archers and cavalry. Both armies must be owned, idle, within 90 world pixels, and have no pending recruitment. A city can become an army’s home under the same proximity and training rules. Survivors return there after battles; only that city receives their loot and supplies the battle’s smithy bonus.

| Class | Attack | Defence | Spell power | Knowledge | Special |
| --- | --- | --- | --- | --- | --- |
| Knight | 3 | 2 | 1 | 1 | Stronger battle line |
| Ranger | 2 | 1 | 1 | 2 | +10% march speed |
| Mage | 1 | 1 | 3 | 2 | Stronger spells and larger mana pool |

Heroes advance through 20 levels. Level N requires 100 × N × (N − 1) / 2 total XP. Each new level grants one freely allocated attribute point. Battles award two XP per enemy casualty plus 50 for victory or 20 otherwise, capped at 19,000 total XP.

- Attack: +2% troop damage per point.
- Defence: incoming physical damage divided by 1 + 0.025 × Defence.
- Spell power: +8% spell damage/healing per point.
- Knowledge: +10 battle mana per point, added to the highest owned mage tower’s mana pool.
- Attack + Defence add up to ten starting morale.

Five equipment slots hold one artifact each: weapon, armour, head, boots and charm. The catalog contains twelve artifacts. The six campaign landmarks each award one fixed artifact on their first victory; repeating a victory grants XP and supplies without duplicating that reward. Unequip an artifact before moving it to another hero. Equipped bonuses affect actual combat, spell effects and travel time. Research remains city-specific; armies can cast valid spells researched at any currently owned and sufficiently leveled mage tower.

Only one tactical battle can be active per ruler. Other cities’ economic timers and armies’ strategic travel continue. Recruitment and army management remain available outside the active battle.

## Install and save compatibility

Replace the delivered files at their matching repository paths. Existing Supabase worlds run **supabase/UPGRADE_TO_V10.sql**; empty installations use **supabase/FRESH_INSTALL_V10.sql**. The upgrade retains cities, armies, troops, accounts, queues and timestamps, removes the old one-city/one-army ownership constraints, backfills queue associations, and adds culture, expeditions, heroes and inventory. Rerunning V10 is supported. Do not apply older feature-only migrations after V10, because their function bodies predate these systems.

Solo saves keep the existing v6 format/key and preserve historical coordinates and routes. Legacy armies automatically gain a level-one Knight captain without receiving extra troops. City/army IDs, hero XP/attributes, equipment and expeditions are validated on import. No live database migration or deployment is performed by this update.

SQL source lives in **supabase/modules/empire/** alongside scoped changes in the existing city, army, battle and map modules. Run **npm run build:sql** after editing modular SQL; **npm run check:sql** checks generated bundles. The client rules are under **src/features/empire/** and **src/features/heroes/**.

## Validation

- Production TypeScript/Vite build and the existing automated gameplay/save/rendering suite.
- Ten dedicated solo tests cover migration, culture integration, settlers, independent queues, recruitment, transfers, hero stats/equipment, battle settlement and multi-city save validation.
- **npm run test:empire-db** tests fresh V10, authenticated ownership/RLS, two cities, reserved sites, multiple armies, army-specific training/marches, troop conservation, rebasing, hero skill/equipment rules, actual bonuses and mage casting, selected-army PvP, battle reward idempotence and repeated migrations on a populated empire.
- Existing database tests cover old-world upgrades, accounts, city plots, all twenty spells, factions, external fields, population and map snapshots.

Browser visual/touch QA remains outstanding in this environment. The standalone HTML embeds its game assets and runs solo gameplay without a build step.

## Design references

The expansion loop draws from [Travian’s culture system](https://support.travian.com/en/articles/51) and [settler founding](https://support.travian.com/en/articles/56-settling-villages). Independent commanded armies draw from [Total War’s generals](https://r2enc.totalwar.com/en/manual/single-player/0047a_enc_page_campaign_play_characters_generals_admirals/index.html). Hero progression and equipment draw from [Heroes of Might and Magic’s hero RPG systems](https://news.ubisoft.com/en-us/article/62HpoWQkAIVogVkoVk8JuJ/heroes-of-might-and-magic-olden-era-unveiled-at-gamescom). The values above are Peris’s own initial balancing rules.
