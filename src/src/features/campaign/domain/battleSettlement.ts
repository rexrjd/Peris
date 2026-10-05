import { type World } from '../../../shared/model/world';
import { settleLocal } from './settlement';
import { type UnitType } from '../../army/domain/types';
import { lootFor } from './rewards';
import { RESOURCES } from '../../../shared/model/resources';
/** Apply permanent casualties, spoils, reports and home regrouping once per battle. */
export function settleBattle(w: World, id: number, owner: string, nextId: () => number) {
    const b = w.battles.find(b => b.id === id)!, result = b.result!, won = b.winner_side === 'attacker';
    settleLocal(w, owner);
    const a = w.armies[0], s = w.settlements[0], p = w.players[0];
    for (const type of ['infantry', 'archers', 'cavalry'] as UnitType[])
        a[type] = w.formations.filter(f => f.battle_id === id && f.side === 'attacker' && f.unit_type === type).reduce((sum, f) => sum + f.soldiers, 0);
    if (won) {
        p.victories++;
        const camp = w.camps.find(c => c.id === b.camp_id)!, loot = lootFor(camp.tier);
        result.loot = loot;
        p.prestige += camp.tier * 25;
        for (const key of RESOURCES)
            s[key] = Math.min(s.capacity, s[key] + loot[key]);
        const old = w.progress.find(c => c.camp_id === camp.id);
        if (old) {
            old.defeated++;
            old.available_at = new Date(Date.now() + 120000).toISOString();
        }
        else
            w.progress.push({ camp_id: camp.id, owner_id: owner, defeated: 1, available_at: new Date(Date.now() + 120000).toISOString() });
    }
    w.reports.unshift({ id: nextId(), owner_id: owner, battle_id: id, title: b.enemy_name, won, result: { ...result }, created_at: new Date().toISOString() });
    // The field army regroups at home. No troop restoration is hidden in this return.
    a.status = 'idle';
    a.raid_target_id = null;
    a.start_x = a.target_x = s.x + 40;
    a.start_y = a.target_y = s.y + 30;
}
