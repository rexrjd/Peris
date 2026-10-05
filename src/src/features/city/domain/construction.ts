import type { World, Order } from '../../../shared/model/world';
import type { Settlement } from './types';
import type { Player } from '../../campaign/domain/types';
import { type BuildingType } from './types';
import { multiply } from '../../../shared/model/resources';
import { BUILDINGS } from './buildings';
export function buildingCost(type: BuildingType, level: number) { return multiply(BUILDINGS[type].cost, 1.55 ** (level - 1)); }
export function upgradeSeconds(level: number) { return 15 + level * 10; }
export function completeUpgrade(w: World, s: Settlement, p: Player, o: Order) {
    const building = w.buildings.find(b => b.settlement_id === s.id && b.building_type === o.item)!;
    building.level++;
    building.updated_at = o.finish_at;
    p.upgrades++;
    const l = building.level;
    if (o.item === 'lumber')
        s.wood_rate = 14 + l * 8;
    if (o.item === 'quarry')
        s.stone_rate = 12 + l * 7;
    if (o.item === 'farm')
        s.food_rate = 18 + l * 10;
    if (o.item === 'market')
        s.gold_rate = 3 + l * 3;
    if (o.item === 'storehouse')
        s.capacity = 5000 + l * 2500;
}
