import type { Army } from '../../army/domain/types';
import { UNIT_TYPES } from '../../army/domain/units';
import { newBattle } from '../../battle/domain/creation';
import { stepBattle } from '../../battle/domain/simulation';
import { battleTerrainAtWorld } from '../../battle/domain/terrain';
import { cellCenter } from '../../map/domain/worldGrid';
import { emptyTroops } from './balance';
import type { CampTier, Position, Troops } from './types';

/** Frontier's first slice has composition and terrain, with no hero or research bonuses. */
export function resolveRaidCombat(troops: Troops, defenders: Troops, position: Position, tier: CampTier): {
    survivors: Troops; defenders: Troops; winner: 'attacker' | 'defender' | 'draw'; battleSeconds: number; reason: string;
} {
    for (const force of [troops, defenders]) for (const unit of UNIT_TYPES)
        if (!Number.isSafeInteger(force[unit]) || force[unit] < 0) throw new Error('Combat troop counts must be nonnegative whole numbers.');
    if (!Number.isSafeInteger(position.col) || !Number.isSafeInteger(position.row)) throw new Error('Combat needs whole field coordinates.');
    if (!['low', 'medium', 'hard'].includes(tier)) throw new Error('Unknown camp tier.');
    const date = '1970-01-01T00:00:00.000Z';
    const army: Army = { ...troops, id: 1, owner_id: 'frontier-attacker', home_settlement_id: 1, name: 'Raid', status: 'idle',
        start_x: 0, start_y: 0, target_x: 0, target_y: 0, departure_at: date, arrival_at: date, updated_at: date, raid_target_id: null };
    const point = cellCenter(position.col, position.row);
    const { battle, formations } = newBattle(1, army.owner_id, army, defenders, battleTerrainAtWorld(point.x, point.y), tier === 'low' ? 'easy' : tier === 'hard' ? 'hard' : 'normal', 'Camp');
    // Dates in the existing constructors are metadata only; no wall clock feeds a step or result.
    battle.started_at = battle.last_tick_at = date;
    formations.forEach(formation => { formation.updated_at = date; });
    for (let step = 0; battle.status === 'active' && step < 9002; step++) stepBattle(battle, formations, .1);
    if (battle.status !== 'resolved' || !battle.result || !battle.winner_side) throw new Error('Automatic battle exceeded its simulation limit.');
    const survivors = emptyTroops(), remainingDefenders = emptyTroops();
    for (const formation of formations) {
        // A routed formation has fled, not died. Its living soldiers regroup for the next raid.
        const remaining = formation.side === 'attacker' ? survivors : remainingDefenders;
        remaining[formation.unit_type] += formation.soldiers;
    }
    return { survivors, defenders: remainingDefenders, winner: battle.winner_side, battleSeconds: battle.result.duration, reason: battle.result.reason };
}
