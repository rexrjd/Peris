# Scouting

The user requests scouting like Travian. Implement the documented Legends mission behavior using Peris's existing scout role and original eleven factions. Preserve current research, recruitment and combat compatibility. No new art, troop role or external dependencies are needed.

## Approach

Use a separate scout detachment, borrowing the existing land routes, cancellation window, resource settlement, crop supply and report inbox. Reusing a whole legion raid would take its commander and normal soldiers along and trigger formation combat. A new independent report inbox would duplicate existing privacy and read-state flows. The selected implementation instead stores a timed scout mission and records its outcome as an already-resolved, attacker-private battle receipt solely to satisfy the existing report foreign key; it never enters combat simulation or grants combat progression.

## Rules

Existing scouts are researched and trained as before. A mission selects 1–1,000 available scouts from an idle legion at one of the sender's living cities; other troops and the commander remain. Offer resources plus troops, or defensive buildings plus troops. Allow foreign living cities and NPC camps. Foreign allied cities are permitted; scouting is independent of attack treaties. Camps have troop/resource reports and no administrative defenses. No loot, casualties to defenders, damage, loyalty, XP, prestige, artifact reward, quest completion, camp cooldown or resource depletion results from scouting.

Scout-only raid orders and farm entries automatically dispatch resource scouting, including a whole scout legion without an explicit subset. Mixed armies retain normal combat. Source and returning-legion checks require the same city field as well as the existing 90-unit home-position radius.

Only scouts physically inside the target provide counter-scouting. Count city garrisons, map garrisons, idle/still-staging native legions and stationed guild support that still belongs with this host. Exclude outgoing troops after departure, returning/in-flight reinforcements and troops at other fields. Reports aggregate all present roles, never troop locations elsewhere, queues, research, loyalty or hero equipment.

Special scouting attack/resistance are 35/20 per scout. Apply Peris's completed smithy multiplier `1 + .04 * total levels` and the scout owner's account attack/defense research; host walls use existing `wallDefenseBonus`. Exclude hero and tactical unit combat values. Peris's explicit casualty adaptation is `min(sent, round(sent * (defensePower / attackPower)^1.5))`, zero when there is no defending power. Defending scouts take no casualties. All eleven factions share these scouting strengths; their established recruitment and movement identity remains unchanged. Travian's complete proprietary casualty equation is not published in the cited support articles, so do not claim exact undocumented arithmetic parity.

If at least one attacker survives, publish arrival-time intel in the sender's existing Reports inbox. All-dead/invalid-target results record a mission-failed status without enemy counts or private data. The defender receives a detection report only if at least one attacking scout dies. Clean scouting reveals no mission record, battle, report or incoming activity to the defender or public viewport. The resolved receipt's defender owner is null; defender notices are separately owner-scoped report payloads. Both report payloads are snapshots and never refreshed from current enemy state.

Receipts use explicit battle mode `scouting`, are always resolved and food-settled, and cannot have formations. Defender notices show intercepted scouts only, without exposing whether other scouts escaped. The source does not receive enemy intel when nobody survived.

Travel uses the scout role's existing normalized world speed and account march research, without commander speed. Stage for the existing 30 real-second cancel window. Revalidate target ownership/living state at arrival; if it changed, abort intel and return. Return to the original owned source city or reroute to another living owned city if captured/ruined. Rejoin the original stopped legion when it is at that destination and has capacity; otherwise deliver to its city garrison. Defeat disbands detached scouts. Source city pays crop while detached; crop starvation can reduce scouts in flight. Cancellations, arrivals, reports and returns are idempotent.

The canonical settlement kernel connects both participants, stops at scout arrivals and processes returning detachments before observations at the same instant. Normal camp battle starts/finalizers flush earlier scout arrivals before mutating the camp. Keep up to 100 active missions per owner and 200 archived mission rows; reports retain their snapshots independently. Validate saved receipt lineage to reject references to unrelated active battles.

## Contract

New `World.scouting_version?:1` and `scouting_missions?:ScoutingMission[]`.

`ScoutingMode = 'resources' | 'defences'`.

`ScoutingMission`: `id`, `owner_id`, `source_settlement_id`, `source_army_id`, nullable `target_city_id`/`target_camp_id`, nullable `target_owner_id`, `target_name`, `faction`, `mode`, `initial_scouts`, `scouts`, `status: 'outbound'|'returning'|'completed'|'cancelled'`, `origin_x/y`, `target_x/y`, `sent_at`, `departure_at`, `arrival_at`, `cancel_until`, `march_path`, `march_distance`, optional nullable `report_battle_id`. Returning reuses departure/arrival/path; initial cancel token is immutable and ignored after outbound departure.

Commands: `{type:'scout';armyId;targetCityId?:number;campId?:number;quantity:number;mode:ScoutingMode;route?:[number,number][]}` and `{type:'cancelScouting';missionId:number;sentAt:string}`. Root types live in `features/scouting/domain/types.ts`; SQL JSON keys use the snake-case mission contract.

`BattleResult.scouting?:ScoutingResult` has `mission_id`, `mode`, `target:{kind:'city'|'camp';id;name;owner_id?:string|null;faction; x;y}`, `observed_at`, `scouts_sent`, `scouts_lost`, `scouts_survived`, `detected`, `success`, optional `reason`, optional `troops:ArmyTroops`, optional `resources:Resources`, optional `defences:{wall:number;main:number}`, optional `sender_name`. Failed and defender-notice payloads omit enemy intel. Normal BattleResult required counts refer only to sent scout casualties; defender counts are zero to prevent failed missions leaking troop numbers.

## Sources and verification

Official [mission guide](https://support.travian.com/en/articles/224-how-scout-missions-work), [scout strengths](https://support.travian.com/en/articles/186-more-troops-or-smithy-upgrades), [tribe scout guide](https://blog.travian.com/2024/07/game-secrets-every-tribes-eyes/). These establish the mission choices, relevant stationed forces, secrecy, wall/upgrade influence and scout-specific 35/20 values. Peris-specific calculation, detached-party lifecycle and Main/wall mapping are implementation choices.

Keep domain/browser/rendering boundaries, wrapped land routes, old saves and old-server capability gating. SQL belongs in modules, with generated focused upgrade and bundles; no deployment or push. Verify pure mechanics, troop conservation, starvation, owner changes, failed-report privacy, participant locks, offline worker and repeated installers at 1/10/100 speeds. Run required unit/tooling/assets/build/generation and isolated database suites, plus desktop/mobile UI tests and inspected screenshots.
