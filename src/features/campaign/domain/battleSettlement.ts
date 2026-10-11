import { accrueCamp } from './campStock';
import { recruitDelay } from '../../frontier/domain/camps';
import { DEFAULT_CONFIG } from '../../frontier/domain/balance';
import { carryingCapacity } from '../../frontier/domain/balance';
import { takeLoot } from '../../frontier/domain/economy';
import { readRoster } from '../../army/domain/roster';
import { emptyResources } from '../../../shared/model/resources';
import { deliverCampLoot } from './loot';
import { campCooldown } from '../../map/domain/bandits';
import { awardBattleHero } from '../../heroes/domain/battleRewards';
import { type World } from '../../../shared/model/world';
import { settleLocal } from './settlement';
import { emptyRoster, writeRoster } from '../../army/domain/roster';
import { lootFor } from './rewards';
import { RESOURCES } from '../../../shared/model/resources';
import { restoreRaidReserve, startRaidReturn } from '../../map/domain/commands';
import { homeArmyPosition } from '../../map/domain/garrisons';
/** Apply permanent casualties, spoils, reports and home regrouping once per battle. */
export function settleBattle(w: World, id: number, owner: string, nextId: () => number) {
    const b = w.battles.find(b => b.id === id)!, result = b.result!, won = b.winner_side === 'attacker';
    settleLocal(w, owner);
    const a = w.armies.find(a=>a.id===b.attacker_army_id&&a.owner_id===owner)!, s = w.settlements.find(s=>s.id===a.home_settlement_id)!, p = w.players.find(p=>p.id===owner)!;
    if(w.reports.some(r=>r.battle_id===id&&r.owner_id===owner))return;
    const camp = w.camps.find(c => c.id === b.camp_id);
    const reward = awardBattleHero(w, a, id, result.defender_losses * 2 + (won ? 50 : 20), won ? camp : undefined, nextId);
    if (reward) result.hero_reward = reward;
    const remaining = emptyRoster();
    for (const formation of w.formations.filter(f => f.battle_id === id && f.side === 'attacker')) remaining[formation.recruit_unit ?? formation.unit_type] += formation.soldiers;
    result.attacker_roster = emptyRoster();
    for (const formation of w.formations.filter(f => f.battle_id === id && f.side === 'attacker')) result.attacker_roster[formation.recruit_unit ?? formation.unit_type] += formation.initial_soldiers;
    result.attacker_survivor_roster = { ...remaining }; result.attacker_faction = a.faction ?? s.faction ?? 'roman';
    result.defender_roster = emptyRoster(); result.defender_survivor_roster = emptyRoster(); result.defender_faction = camp?.faction ?? b.defender_faction ?? 'orc';
    for (const formation of w.formations.filter(f => f.battle_id === id && f.side === 'defender')) { const unit = formation.recruit_unit ?? formation.unit_type; result.defender_roster[unit] += formation.initial_soldiers; result.defender_survivor_roster[unit] += formation.soldiers; }
    writeRoster(a, remaining);
    restoreRaidReserve(a);
    if (camp?.bandit) {
        accrueCamp(camp, Date.now(), true);
        const defenders = emptyRoster();
        for (const formation of w.formations.filter(f => f.battle_id === id && f.side === 'defender')) defenders[formation.recruit_unit ?? formation.unit_type] += formation.soldiers;
        writeRoster(camp, defenders);
        camp.next_recruit_at = new Date(Date.now() + recruitDelay(DEFAULT_CONFIG, String(camp.id), camp.recruit_sequence ?? 0)).toISOString();
        const loot = won ? takeLoot(camp.resources!, carryingCapacity(readRoster(a))) : emptyResources();
        for (const key of RESOURCES) camp.resources![key] -= loot[key];
        result.loot = loot; a.carried_loot = loot; a.loot_report_id = id;
        if (won) { p.victories++; p.prestige += camp.tier * 25; }
    }
    if (won && !camp?.bandit) {
        p.victories++;
        const camp = w.camps.find(c => c.id === b.camp_id)!, loot = lootFor(camp.tier);
        result.loot = loot; result.delivered = emptyResources(); result.overflow = emptyResources();
        p.prestige += camp.tier * 25;
        for (const key of RESOURCES) {
            const delivered = Math.min(loot[key], Math.max(0, (key === 'food' ? s.food_capacity ?? s.capacity : s.capacity) - s[key]));
            s[key] += delivered; result.delivered[key] = delivered; result.overflow[key] = loot[key] - delivered;
        }
        const old = w.progress.find(c => c.camp_id === camp.id && c.owner_id===owner);
        if (old) {
            old.defeated++;
            old.available_at = new Date(Date.now() + campCooldown(camp)).toISOString();
        }
        else
            w.progress.push({ camp_id: camp.id, owner_id: owner, defeated: 1, available_at: new Date(Date.now() + campCooldown(camp)).toISOString() });
    }
    w.reports.unshift({ id: nextId(), owner_id: owner, battle_id: id, camp_id: camp?.id, farm_list_id: a.farm_list_id, title: b.enemy_name, won, result: { ...result }, created_at: new Date().toISOString() });
    // Newly sent raids return along their validated route to their actual departure station.
    if (!startRaidReturn(w, a)) {
        // Imported battles that predate departure stations retain their home regrouping.
        a.status = 'idle';
        a.march_path = null; a.march_distance = null; a.march_returning = false;
        const home = homeArmyPosition(s);
        a.start_x = a.target_x = home.x; a.start_y = a.target_y = home.y;
        deliverCampLoot(w, a);
    }
}
