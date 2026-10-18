import type { Army } from '../../army/domain/types';
import { UNIT_TYPES as BASE_TYPES, UNITS } from '../../army/domain/units';
import { FRONTIER_UNITS, FRONTIER_UNIT_TYPES, isBaseUnit, type FrontierUnitType } from './units';
import { newBattle } from '../../battle/domain/creation';
import { stepBattle } from '../../battle/domain/simulation';
import { battleTerrainAtWorld } from '../../battle/domain/terrain';
import { cellCenter } from '../../map/domain/worldGrid';
import { emptyTroops } from './balance';
import { makeFormations } from '../../battle/domain/formations';
import { FIELD_H } from '../../battle/domain/dimensions';
import type { Formation } from '../../battle/domain/types';
import type { CampTier, Position, Troops } from './types';

/** Each advanced unit keeps its own formations and survivors. Existing AI,
 * terrain, morale and simultaneous damage rules still own the battle outcome. */
export function resolveRaidCombat(troops: Troops, defenders: Troops, position: Position, tier: CampTier): {
    survivors: Troops; defenders: Troops; winner: 'attacker' | 'defender' | 'draw'; battleSeconds: number; reason: string;
} {
    for (const force of [troops, defenders]) for (const unit of FRONTIER_UNIT_TYPES)
        if (!Number.isSafeInteger(force[unit] ?? 0) || (force[unit] ?? 0) < 0) throw new Error('Combat troop counts must be nonnegative whole numbers.');
    if (!Number.isSafeInteger(position.col) || !Number.isSafeInteger(position.row)) throw new Error('Combat needs whole field coordinates.');
    if (!['low', 'medium', 'hard'].includes(tier)) throw new Error('Unknown camp tier.');
    const date = '1970-01-01T00:00:00.000Z';
    const army: Army = { ...troops, id: 1, owner_id: 'frontier-attacker', home_settlement_id: 1, name: 'Raid', status: 'idle',
        start_x: 0, start_y: 0, target_x: 0, target_y: 0, departure_at: date, arrival_at: date, updated_at: date, raid_target_id: null };
    const point = cellCenter(position.col, position.row);
    const { battle, formations } = newBattle(1, army.owner_id, army, defenders, battleTerrainAtWorld(point.x, point.y), tier === 'low' ? 'easy' : tier === 'hard' ? 'hard' : 'normal', 'Camp','pve',null,{version:1,attackerFaction:'roman',defenderFaction:'roman'});
    const unitByFormation = new Map<number, FrontierUnitType>();
    for (const side of ['attacker', 'defender'] as const) {
        const force = side === 'attacker' ? troops : defenders;
        if (!FRONTIER_UNIT_TYPES.some(unit => !isBaseUnit(unit) && (force[unit] ?? 0) > 0)) continue;
        const replacements: Formation[] = [];
        for (const unit of FRONTIER_UNIT_TYPES) {
            const soldiers = force[unit] ?? 0;
            if (!soldiers) continue;
            const rule = FRONTIER_UNITS[unit];
            const classes = { infantry: 0, archers: 0, cavalry: 0, [rule.combatClass]: soldiers };
            for (const formation of makeFormations(1, classes, side === 'attacker' ? army.owner_id : null, side, side === 'attacker' ? 90 : tier === 'low' ? 78 : tier === 'hard' ? 100 : 90,undefined,{version:1,faction:'roman'})) {
                formation.id = (side === 'attacker' ? 1000 : 2000) + replacements.length;
                formation.attack_multiplier = rule.attack;
                formation.defence_multiplier = rule.defence;
                formation.magic_speed = rule.speed / UNITS[rule.combatClass].speed;
                unitByFormation.set(formation.id, unit);
                replacements.push(formation);
            }
        }
        for (const type of BASE_TYPES) {
            const peers = replacements.filter(formation => formation.unit_type === type);
            peers.forEach((formation, index) => { formation.y = formation.target_y = FIELD_H / 2 + (index - (peers.length - 1) / 2) * Math.min(105, 490 / Math.max(1, peers.length - 1)); });
        }
        for (let index = formations.length - 1; index >= 0; index--) if (formations[index].side === side) formations.splice(index, 1);
        formations.push(...replacements);
    }
    // Dates in the existing constructors are metadata only; no wall clock feeds a step or result.
    battle.started_at = battle.last_tick_at = date;
    formations.forEach(formation => { formation.updated_at = date; });
    for (let step = 0; battle.status === 'active' && step < 9002; step++) stepBattle(battle, formations, .1);
    if (battle.status !== 'resolved' || !battle.result || !battle.winner_side) throw new Error('Automatic battle exceeded its simulation limit.');
    const survivors = emptyTroops(), remainingDefenders = emptyTroops();
    for (const formation of formations) {
        // A routed formation has fled, not died. Its living soldiers regroup for the next raid.
        const remaining = formation.side === 'attacker' ? survivors : remainingDefenders;
        const unit = unitByFormation.get(formation.id) ?? formation.unit_type;
        remaining[unit] = (remaining[unit] ?? 0) + formation.soldiers;
    }
    return { survivors, defenders: remainingDefenders, winner: battle.winner_side, battleSeconds: battle.result.duration, reason: battle.result.reason };
}
