import { campCooldown } from '../../map/domain/bandits';
import { awardHeroExperience } from '../../heroes/domain/heroes';
import { type World } from '../../../shared/model/world';
import { settleLocal } from './settlement';
import { type UnitType } from '../../army/domain/types';
import { lootFor } from './rewards';
import { RESOURCES } from '../../../shared/model/resources';
/** Apply permanent casualties, spoils, reports and home regrouping once per battle. */
export function settleBattle(w: World, id: number, owner: string, nextId: () => number) {
    const b = w.battles.find(b => b.id === id)!, result = b.result!, won = b.winner_side === 'attacker';
    settleLocal(w, owner);
    const a = w.armies.find(a=>a.id===b.attacker_army_id&&a.owner_id===owner)!, s = w.settlements.find(s=>s.id===a.home_settlement_id)!, p = w.players.find(p=>p.id===owner)!;
    if(w.reports.some(r=>r.battle_id===id&&r.owner_id===owner))return;
    awardHeroExperience(w,a.id,result.defender_losses*2+(won?50:20));
    for (const type of ['infantry', 'archers', 'cavalry'] as UnitType[])
        a[type] = w.formations.filter(f => f.battle_id === id && f.side === 'attacker' && f.unit_type === type).reduce((sum, f) => sum + f.soldiers, 0);
    if (won) {
        p.victories++;
        const camp = w.camps.find(c => c.id === b.camp_id)!, loot = lootFor(camp.tier);
        result.loot = loot;
        p.prestige += camp.tier * 25;
        for (const key of RESOURCES)
            s[key] = Math.min(key==='food' ? s.food_capacity ?? s.capacity : s.capacity, s[key] + loot[key]);
        const old = w.progress.find(c => c.camp_id === camp.id && c.owner_id===owner);
        if(!old&&(!camp.bandit||camp.id%7===0)&&(w.hero_artifacts?.length??0)<200){const drops=['iron_sword','chainmail','boots','circlet','runestaff','crown_seal'];(w.hero_artifacts??=[]).push({id:nextId(),owner_id:owner,artifact_id:drops[Math.min(5,Math.max(0,(camp.bandit?camp.tier:camp.id)-1))],hero_id:null});}
        if (old) {
            old.defeated++;
            old.available_at = new Date(Date.now() + campCooldown(camp)).toISOString();
        }
        else
            w.progress.push({ camp_id: camp.id, owner_id: owner, defeated: 1, available_at: new Date(Date.now() + campCooldown(camp)).toISOString() });
    }
    w.reports.unshift({ id: nextId(), owner_id: owner, battle_id: id, title: b.enemy_name, won, result: { ...result }, created_at: new Date().toISOString() });
    // The field army regroups at home. No troop restoration is hidden in this return.
    a.status = 'idle';
    a.raid_target_id = null;
    a.start_x = a.target_x = s.x + 40;
    a.start_y = a.target_y = s.y + 30;
}
