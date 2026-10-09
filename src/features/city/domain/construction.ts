import type { World, Order } from '../../../shared/model/world';
import type { Settlement } from './types';
import type { Player } from '../../campaign/domain/types';
import { type BuildingType } from './types';
import { multiply } from '../../../shared/model/resources';
import { BUILDINGS } from './buildings';
import { refreshCityEconomy, slotMaxLevel } from './slots';

export const MAX_BUILDING_LEVEL = 5;

export function buildingCost(type: BuildingType, level: number) {
    return multiply(BUILDINGS[type].cost, 1.55 ** Math.max(0, level));
}

export function upgradeSeconds(level: number) {
    return 15 + Math.max(0, level) * 10;
}

export function completeUpgrade(w: World, s: Settlement, p: Player, o: Order) {
    s.development_points=(s.development_points??0)+1;
    if (o.item.startsWith('slot:')) {
        const index=Number(o.item.split(':')[1]);
        const slot=w.city_slots?.find(slot=>slot.settlement_id===s.id && slot.slot_index===index);
        if (!slot) throw new Error('Queued building plot is missing.');
        slot.level=Math.min(slotMaxLevel(slot.building_type),slot.level+1);p.upgrades++;refreshCityEconomy(w,s.id,s.population!==undefined);return;
    }
    const building = w.buildings.find(b => b.settlement_id === s.id && b.building_type === o.item)!;
    building.level = Math.min(MAX_BUILDING_LEVEL, building.level + 1);
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
    if (w.city_slots) refreshCityEconomy(w,s.id,s.population!==undefined);
}
