import { commandCity } from '../../empire/domain/context';
import type { Command, LocalCommandContext } from '../../../shared/model/commands';
import { RESOURCES } from '../../../shared/model/resources';
import { affordable } from './economy';
import { citySlots, mainLevel, slotCount, riversideSlot, slotCost, SLOT_BUILDINGS, slotMaxLevel } from './slots';
import { upgradeSeconds } from './construction';

export function queueSlot(context: LocalCommandContext, cmd: Extract<Command,{type:'buildSlot'|'upgradeSlot'}>) {
    const w=context.world, town=commandCity(context);
    if (!Number.isInteger(cmd.slot) || cmd.slot<0 || cmd.slot!==16 && cmd.slot>=slotCount(mainLevel(w,town.id))) throw new Error('Upgrade the main building to unlock this plot.');
    if (w.orders.some(o=>o.owner_id===context.playerId && (o.settlement_id??w.settlements[0].id)===town.id && o.kind==='upgrade')) throw new Error('Your builders are already working.');
    w.city_slots ??= citySlots(w,town.id);
    let slot=w.city_slots.find(s=>s.settlement_id===town.id && s.slot_index===cmd.slot);
    if (cmd.type==='buildSlot') {
        if (slot) throw new Error('This plot is already occupied.');
        if (!Object.hasOwn(SLOT_BUILDINGS,cmd.item)) throw new Error('Unknown building.');
        if(cmd.item==='mage_tower'&&w.city_slots.some(s=>s.settlement_id===town.id&&s.building_type==='mage_tower'))throw new Error('Only one mage tower can be built in your city.');
        if ((cmd.item==='fishery') !== riversideSlot(cmd.slot)) throw new Error('A fishery needs a riverside plot.');
        slot={settlement_id:town.id,slot_index:cmd.slot,building_type:cmd.item,level:0};
    } else if (!slot || slot.level===0) throw new Error('This building is not ready.');
    if (slot.level>=slotMaxLevel(slot.building_type)) throw new Error('Maximum building level reached.');
    const cost=slotCost(slot.building_type,slot.level);
    if (!affordable(town,cost)) throw new Error('Your stores cannot cover this cost.');
    for (const resource of RESOURCES) town[resource]-=cost[resource];
    if (cmd.type==='buildSlot') w.city_slots.push(slot);
    w.orders.push({id:context.nextId(),owner_id:context.playerId,settlement_id:town.id,kind:'upgrade',item:`slot:${cmd.slot}:${slot.building_type}`,quantity:1,started_at:context.now,finish_at:new Date(Date.parse(context.now)+upgradeSeconds(slot.level)*1000).toISOString()});
}
