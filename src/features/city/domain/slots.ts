import type { World } from '../../../shared/model/world';
import type { Resources } from '../../../shared/model/resources';
import { multiply } from '../../../shared/model/resources';

export type SlotType = 'barracks' | 'stables' | 'smithy' | 'warehouse' | 'granary' | 'fishery';
export type CitySlot = { settlement_id: number; slot_index: number; building_type: SlotType; level: number };
export const SLOT_BUILDINGS: Record<SlotType, { name: string; description: string; effect: string; cost: Resources }> = {
    barracks: { name: 'Barracks', description: 'Train infantry and archers.', effect: 'Each level improves training speed.', cost: { wood:180, stone:160, food:100, gold:30 } },
    stables: { name: 'Stables', description: 'Raise cavalry.', effect: 'Each level improves cavalry training speed.', cost: { wood:200, stone:120, food:180, gold:45 } },
    smithy: { name: 'Smithy', description: 'Forge stronger weapons for your soldiers.', effect: '+4% army damage per level, up to +60% across smithies.', cost: { wood:180, stone:220, food:80, gold:60 } },
    warehouse: { name: 'Warehouse', description: 'Store timber, stone and gold.', effect: '+2,500 capacity per level. Warehouses stack.', cost: { wood:200, stone:150, food:90, gold:20 } },
    granary: { name: 'Granary', description: 'Keep your food supplies safe.', effect: '+2,500 food capacity per level. Granaries stack.', cost: { wood:160, stone:120, food:100, gold:15 } },
    fishery: { name: 'Fishery', description: 'A riverside dock that supplies fresh fish.', effect: '+8 food / minute per level. Built at the river site outside the wall.', cost: { wood:160, stone:80, food:100, gold:20 } },
};
export const mainLevel = (w: World, sid: number) => w.buildings.find(b=>b.settlement_id===sid && b.building_type==='market')?.level ?? 0;
export const slotCount = (level: number) => 6 + Math.max(0,Math.min(5,level)) * 2;
export const cityGrowth = (level: number) => 1 + level * .1;
export const riversideSlot = (index: number) => index === 16;
export function citySlots(w: World, sid: number): CitySlot[] {
    if (w.city_slots) return w.city_slots.filter(s=>s.settlement_id===sid);
    const migrated = (['barracks','stables','storehouse'] as const).flatMap((type,index)=>{
        const level=w.buildings.find(b=>b.settlement_id===sid && b.building_type===type)?.level ?? 0;
        return level || w.orders.some(o=>o.kind==='upgrade' && o.item===type) ? [{settlement_id:sid,slot_index:index,building_type:(type==='storehouse'?'warehouse':type) as SlotType,level}] : [];
    });
    const storage=w.buildings.find(b=>b.settlement_id===sid && b.building_type==='storehouse')?.level??0;
    if(storage) migrated.push({settlement_id:sid,slot_index:3,building_type:'granary' as SlotType,level:storage});
    return migrated;
}
export const slotLevels = (w: World, sid: number, type: SlotType) => citySlots(w,sid).filter(s=>s.building_type===type).reduce((sum,s)=>sum+s.level,0);
export const armyAttack = (w: World, sid: number) => 1 + Math.min(.6,slotLevels(w,sid,'smithy') * .04);
export const slotCost = (type: SlotType, level: number) => multiply(SLOT_BUILDINGS[type].cost,1.55 ** level);
export function refreshCityEconomy(w: World, sid: number) {
    const town=w.settlements.find(s=>s.id===sid)!;
    const level=(type:string)=>w.buildings.find(b=>b.settlement_id===sid && b.building_type===type)?.level ?? 0;
    town.wood_rate=14+level('lumber')*8;town.stone_rate=12+level('quarry')*7;
    town.food_rate=18+level('farm')*10+slotLevels(w,sid,'fishery')*8;
    town.gold_rate=3+level('market')*3;
    town.capacity=5000+slotLevels(w,sid,'warehouse')*2500;
    town.food_capacity=5000+slotLevels(w,sid,'granary')*2500;
}
