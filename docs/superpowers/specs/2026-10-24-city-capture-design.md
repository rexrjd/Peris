# City capture and diplomats

## User requirements and clarified rule

Add capture of any enemy city. Loyalty begins at 100, caps at 100 and recovers 25 points per game hour. A victorious attacker lowers loyalty by one per surviving participating diplomat, capped at 25 per attack. The user explicitly confirmed that defeating defenders in the same battle qualifies; the city need not be empty on arrival. Dead diplomats provide no persuasion. Count actual surviving participating soldiers, excluding unsent reserves. Existing automatic battles remain authoritative.

Chiefing needs the same culture cost and ten-city limit as settling, with pending settler reservations included. Sufficient culture is needed to persuade and checked again at battle settlement. Charge culture only when ownership changes. All cities, including the first or last city, can be captured. Do not add capital immunity, administration-building destruction prerequisites, Travian expansion slots or random loyalty damage.

Research unlocks a tenth troop role, `diplomat`, through the existing Diplomacy account technology. Train it in the existing Main building (`market` saved ID), minimum level 2. It occupies normal army capacity, moves/transfers/defends/fights/starves with the army and can die in battle. Resource prices are 100 times basic infantry: 400 timber, 200 stone, 600 food, 100 gold each. Base training is 200 game seconds. Weak foot infantry stats: attack .1, defence .5, speed 30, carry 0, crop upkeep 1/game hour. All factions have their own administrator name and original visual identity. Existing nine combat roles and balance versions retain their prices and stats.

## Capture flow

Add a Capture city entry to the enemy-city map controls, opening the existing march review with diplomats required and culture/loyalty information. Any ordinary city attack that includes diplomats also attempts persuasion, clearly explained in review. Reuse `raidCity`; no second battle or travel pipeline. Older online servers without `conquest_version:1` keep their nine-role flow and cannot accept capture/diplomat commands.

Private settlement fields are `loyalty?:number` and `loyalty_updated_at?:string`; absence means 100 on legacy data. Use exact game-time integration, capped at 100, and do not reset damaged loyalty on normalization, projection or repeat upgrades. Keep rival loyalty out of public map DTOs; enemy review explains that the actual value is hidden. Battle result adds a structured `conquest` receipt containing loyalty before/after, diplomats that persuaded, reduction, captured flag, culture cost, former/new owner IDs and a clear failure reason. No loyalty or culture effect on camp, practice, defeat or replayed settlement.

At zero loyalty, transfer the existing city, its resources, population, buildings, slots and claimed fields to the attacker; retain faction and development. Reset loyalty to zero and recover normally. One surviving participating diplomat establishes the new government and is consumed; the other survivors remain. Victorious troops occupy the acquired city rather than returning, without creating a free commander. Legacy unsent raid reserves stay at their original owned home.

Cancel the former owner's local construction/training/research queues at this city without resource refunds to the new owner. Account research stays with each account; city-specific spell/unit research is removed. Local garrisons and former-owner troops on captured land retreat to another living owned city through existing travel/evacuation mechanisms; no soldiers convert ownership. Armies homed here adopt another living owned home. If no cities remain, mark that ruler defeated using existing defeat behavior and disband their remaining soldiers. Do not transfer commanders, account culture, private reports or guild membership.

Before ownership changes, retain both rulers' account research faction in optional `Player.research_faction`. Legacy accounts derive it from their oldest city until their first capture. Capturing an older foreign city or losing the original city must not switch heritage research eligibility or passive bonuses. The existing explicit main-city faction change still updates account heritage.

Transport, settler, guild support and caravan ownership must remain with the original participant. Redirect or safely return parties whose endpoint ownership changed; do not deliver foreign troops, settlers or refunds into the captured city. Revalidate both owner and living state at arrival. Disable automatic routes whose endpoints are no longer eligible. Preserve trade receipts and resources in flight. Capture and siege damage are processed once, in battle-time order; a city already reduced to ruins cannot be captured.

## Architecture and verification

Pure domain `city/domain/conquest.ts` owns loyalty, eligibility and transfer. Local/server battle finalizers call it after irreversible casualties and siege resolution, before reports and return orders. SQL source belongs in `supabase/modules`; generate a repeatable focused `UPGRADE_CITY_CAPTURE.sql`, no deployment. Extend catalog/roster/save/type checks to ten roles and include diplomats in canonical crop supply and combat-food receipts. Preserve old saves and old-server absence metadata; never initialize rival private economy client-side.

Use tests first for regeneration/caps/game clocks, surviving counts and cap, culture checks/spend, guarded capture/replay, all ownership cleanup and source fallbacks, catalog/training/research, death/starvation, import validation and privacy. Run required unit/tooling/assets/build/generation checks, affected isolated database suites and desktop/mobile march/recruit/report browser flows with inspected screenshots. Keep work on the review branch; do not push or deploy.

Research: Travian's official [conquering guide](https://support.travian.com/en/articles/54-conquering-villages), [loyalty](https://support.travian.com/en/articles/66-loyalty), and [culture points](https://support.travian.com/en/articles/51). Peris uses the user's numeric rules and exclusions, not Travian's immunity, random persuasion or administration-building rules.
