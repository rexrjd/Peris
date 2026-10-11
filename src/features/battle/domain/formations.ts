import { type Formation } from './types';
import { type Army } from '../../army/domain/types';
import { FIELD_W, FIELD_H } from './dimensions';
import { RECRUIT_UNITS, RECRUIT_RULES, readRoster } from '../../army/domain/roster';
import { UNITS, UNIT_TYPES } from '../../army/domain/units';
export function formationSize(f: Formation) { const cols = Math.min(f.columns, Math.max(1, f.soldiers)); return { width: cols * 8 + 12, depth: Math.ceil(Math.min(f.soldiers, 120) / cols) * 8 + 12 }; }
export function makeFormations(battleId: number, army: Pick<Army, 'infantry' | 'archers' | 'cavalry' | 'unit_roster'>, owner: string | null, side: 'attacker' | 'defender', morale = 90, counts?: Partial<Record<'infantry' | 'archers' | 'cavalry', number>>): Formation[] {
    const roster = readRoster(army);
    if (army.unit_roster && RECRUIT_UNITS.some(unit => !UNIT_TYPES.includes(unit as typeof UNIT_TYPES[number]) && roster[unit] > 0)) {
        const result: Formation[] = [];
        for (const unit of RECRUIT_UNITS) {
            const rule = RECRUIT_RULES[unit]; if (!roster[unit]) continue;
            const force = { infantry: 0, archers: 0, cavalry: 0, [rule.combatClass]: roster[unit] };
            for (const f of makeFormations(battleId, force, owner, side, morale)) {
                f.id = battleId * 1000 + (side === 'attacker' ? 0 : 500) + result.length + 1;
                f.recruit_unit = unit; f.label = unit; f.unit_attack = rule.attack; f.unit_defence = rule.defence;
                f.unit_speed = rule.speed / UNITS[rule.combatClass].speed; result.push(f);
            }
        }
        for (const type of UNIT_TYPES) { const peers = result.filter(f => f.unit_type === type); peers.forEach((f, i) => { f.y = f.target_y = FIELD_H / 2 + (i - (peers.length - 1) / 2) * Math.min(105, 490 / Math.max(1, peers.length - 1)); }); }
        return result;
    }
    let index = 0;
    const result: Formation[] = [];
    for (const type of UNIT_TYPES) {
        const max = type === 'infantry' ? 60 : type === 'archers' ? 40 : 24;
        const n = counts?.[type] === undefined ? Math.min(6, Math.ceil(army[type] / max)) : Math.min(army[type], Math.max(1, Math.min(6, Math.floor(counts[type]!))));
        for (let i = 0; i < n; i++) {
            const soldiers = Math.floor(army[type] / n) + (i < army[type] % n ? 1 : 0);
            const left = side === 'attacker';
            const baseX=type==='infantry'?285:type==='cavalry'?205:175;
            const x=FIELD_W/2+(left?baseX-600:600-baseX);
            const y=FIELD_H/2-350+(type==='cavalry'?(i%2===0?75+Math.floor(i/2)*65:625-Math.floor(i/2)*65):350+(i-(n-1)/2)*Math.min(105,490/Math.max(1,n-1)));
            result.push({ id: battleId * 100 + (left ? 0 : 40) + (++index), battle_id: battleId, owner_id: owner, side, unit_type: type, label: `${UNITS[type].name} ${i + 1}`, initial_soldiers: soldiers, soldiers, kills: 0, morale, stamina: 100, facing: left ? 0 : 180, charge_ready: false, x, y, target_x: x, target_y: y, target_facing: null, target_formation_id: null, status: 'idle', damage_pool: 0, columns: type === 'cavalry' ? 6 : 10, stance: 'balanced', running: false, fire_at_will: true, updated_at: new Date().toISOString() });
        }
    }
    return result;
}
