import { type Army } from '../../army/domain/types';
import { type Battle, type Difficulty, type Formation, type Terrain } from './types';
import { makeFormations } from './formations';
export function newBattle(id: number, owner: string, army: Army, enemy: Pick<Army, 'infantry' | 'archers' | 'cavalry'>, terrain: Terrain, difficulty: Difficulty, enemyName: string, mode: Battle['mode'] = 'pve', campId: number | null = null): {
    battle: Battle;
    formations: Formation[];
} {
    const now = new Date().toISOString();
    return { battle: { id, attacker_owner_id: owner, defender_owner_id: null, attacker_army_id: army.id, defender_army_id: null, status: 'active', phase: 'combat', attacker_ready: true, defender_ready: true, mode, camp_id: campId, terrain, difficulty, enemy_name: enemyName, winner_owner_id: null, winner_side: null, started_at: now, ended_at: null, last_tick_at: now, elapsed: 0, result: null, rally_attacker: false, rally_defender: false }, formations: [...makeFormations(id, army, owner, 'attacker'), ...makeFormations(id, enemy, null, 'defender', difficulty === 'hard' ? 100 : difficulty === 'easy' ? 78 : 90)] };
}
