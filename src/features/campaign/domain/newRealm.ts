import { type World } from '../../../shared/model/world';
import { type BuildingType } from '../../city/domain/types';
import { CAMPS } from '../../map/domain/camps';
export function createSolo(name: string): World {
    const now = new Date().toISOString(), owner = 'solo-ruler';
    return { version: 6, server_now: now, players: [{ id: owner, display_name: name, created_at: now, prestige: 0, victories: 0, recruits: 0, upgrades: 0 }], settlements: [{ id: 1, owner_id: owner, name: `${name}'s Keep`, x: 155, y: 285, wood: 1250, stone: 1000, food: 1500, gold: 500, wood_rate: 14, stone_rate: 12, food_rate: 18, gold_rate: 3, resources_updated_at: now, created_at: now, capacity: 5000 }], buildings: (['lumber', 'quarry', 'farm', 'market', 'barracks', 'stables', 'wall', 'storehouse'] as BuildingType[]).map((t, i) => ({ id: i + 1, settlement_id: 1, building_type: t, level: 0, updated_at: now })), armies: [{ id: 1, owner_id: owner, home_settlement_id: 1, name: 'Legio I · The Dawn', infantry: 120, archers: 50, cavalry: 16, start_x: 195, start_y: 315, target_x: 195, target_y: 315, departure_at: now, arrival_at: now, status: 'idle', updated_at: now, raid_target_id: null }], camps: CAMPS.map(c => ({ ...c })), orders: [], battles: [], formations: [], reports: [], progress: [], claims: [], challenges: [] };
}
