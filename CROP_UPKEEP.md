# Crop upkeep and starvation

Combat soldiers consume crop per game hour across all eleven factions:

| Roles | Crop per soldier / hour |
| --- | ---: |
| Infantry, spearmen, archers, elite | 1 |
| Cavalry, scouts, heavy cavalry | 2 |
| Rams | 3 |
| Catapults | 4 |

Production can be negative. Stored food stays at zero or above. Once reserves run out and production cannot cover consumption, starvation removes soldiers individually and reclaims their recruitment crop cost. Incoming crop and crop waiting on returned merchants feed troops before further losses. Residents keep their existing upkeep; shortages pause growth rather than killing residents.

Starvation chooses foreign reinforcements, own troops supporting another city, home troops, then travelling troops. Within a group it repeatedly chooses the largest force row, then its most numerous role. Equal roles follow the displayed roster order. Staging troops remain stationed until their actual departure.

Stationed soldiers eat from the host city. Moving soldiers eat from their supplying city until arrival. All legions, garrisons, reserves and troop transports are included once. Existing permanent city transfers become native garrison soldiers on arrival. Destroyed suppliers fall back to a living owned city.

The city report shows production, resident and troop upkeep, net food, estimated depletion and cumulative starvation losses. Army composition, recruitment and unit inspection show hourly crop costs.

These rules follow Travian's published [starvation mechanics](https://support.travian.com/en/articles/83-starvation-mechanics), [crop-shortage behavior](https://support.travian.com/en/articles/75-problems-with-crop), and [stationed-troop feeding rules](https://support.travian.com/en/articles/214-guide-resources-explained). The requested 1/2/3/4 prices replace Travian's tribe-specific values. Peris commanders and settlers retain their existing lifecycle. Peris's extended battles keep committed soldiers supplied until permanent combat settlement, with crop credited for final combat deaths once. Starvation deaths immediately reduce the backing force and permanent formation cap, so healing cannot restore them or farm crop refunds.

Fresh solo campaigns enable the feature immediately. Legacy campaigns finish their previously free troop period before activation. Online worlds require the reviewed [crop upgrade](supabase/UPGRADE_CROP_UPKEEP.sql), after the current Market, routes and guild reinforcement updates. It is generated from `supabase/modules/city/crop-upkeep.sql` and is safe to rerun. No SQL was deployed by this change.

Verification evidence and limits: [verification record](docs/superpowers/verification/2026-10-24-crop-upkeep.md).
