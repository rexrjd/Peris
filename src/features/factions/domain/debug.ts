import { commandCity } from '../../empire/domain/context';
import type {LocalCommandContext,Command} from '../../../shared/model/commands';
import {isFaction} from './factions';
import {refreshCityEconomy,slotCount,slotMaxLevel,citySlots} from '../../city/domain/slots';
import {completeUpgrade} from '../../city/domain/construction';
import {RESOURCES} from '../../../shared/model/resources';
export function changeFaction(ctx:LocalCommandContext,cmd:Extract<Command,{type:'setFaction'}>){
 if(!isFaction(cmd.faction))throw new Error('Unknown faction.');
 const town=commandCity(ctx);if(!town)throw new Error('Settlement missing.');town.faction=cmd.faction;
}
/** Explicit debug actions only touch the current ruler's settlement. */
export function debugCity(ctx:LocalCommandContext,cmd:Extract<Command,{type:'debugCity'}>){
 const {world:w}=ctx,town=commandCity(ctx);if(!town)throw new Error('Settlement missing.');
 if(w.debug_enabled===false)throw new Error('Debug tools are disabled.');if(ctx.active)throw new Error('Finish the current battle first.');
 w.city_slots??=citySlots(w,town.id);
 const player=w.players.find(p=>p.id===ctx.playerId)!;
 if(cmd.action==='resources'){
  if(cmd.value!==0&&cmd.value!==1000)throw new Error('Choose fill storage or +1,000 supplies.');
  for(const key of RESOURCES){const cap=key==='food'?town.food_capacity??town.capacity:town.capacity;town[key]=cmd.value===0?cap:Math.min(cap,town[key]+1000);}town.resources_updated_at=ctx.now;return;
 }
 if(cmd.action==='culture'){if(cmd.value!==1000)throw new Error('Choose +1,000 culture.');player.culture_points=(player.culture_points??0)+1000;return;}
 if(cmd.action==='population'){if(cmd.value!==0&&cmd.value!==10)throw new Error('Choose fill housing or +10 residents.');town.population=cmd.value===0?town.population_capacity??40:Math.min(town.population_capacity??40,(town.population??30)+10);refreshCityEconomy(w,town.id);return;}
 if(cmd.action==='finish'){
  for(const o of w.orders.filter(o=>o.owner_id===ctx.playerId&&(o.settlement_id??w.settlements[0].id)===town.id&&o.kind==='upgrade')){o.finish_at=ctx.now;completeUpgrade(w,town,player,o);}
  w.orders=w.orders.filter(o=>o.owner_id!==ctx.playerId||(o.settlement_id??w.settlements[0].id)!==town.id||o.kind!=='upgrade');return;
 }
 const match=/^slot:(\d+)$/.exec(cmd.target??''),slot=match?w.city_slots.find(s=>s.settlement_id===town.id&&s.slot_index===Number(match[1])):undefined;
 const building=match?undefined:w.buildings.find(b=>b.settlement_id===town.id&&b.building_type===cmd.target);
 if(!slot&&!building)throw new Error('Select a built building.');
 const max=slot?slotMaxLevel(slot.building_type):5,level=cmd.action==='demolish'?0:cmd.value;
 if(!['demolish','level'].includes(cmd.action)||level==null||!Number.isInteger(level)||level<0||level>max)throw new Error('Invalid building level.');
 const cancelled=new Set<string>();let lostMagic=false;
 if(slot){cancelled.add(`slot:${slot.slot_index}:${slot.building_type}`);slot.level=level;if(!level){lostMagic=slot.building_type==='mage_tower';w.city_slots=w.city_slots.filter(s=>s!==slot);}}
 if(building){building.level=level;building.updated_at=ctx.now;cancelled.add(building.building_type);
  if(building.building_type==='market'){
   const count=slotCount(level);for(const s of w.city_slots.filter(s=>s.settlement_id===town.id&&s.slot_index!==16&&s.slot_index>=count)){cancelled.add(`slot:${s.slot_index}:${s.building_type}`);lostMagic||=s.building_type==='mage_tower';}
   w.city_slots=w.city_slots.filter(s=>s.settlement_id!==town.id||s.slot_index===16||s.slot_index<count);
  }
 }
 w.orders=w.orders.filter(o=>o.owner_id!==ctx.playerId||(o.settlement_id??w.settlements[0].id)!==town.id||o.kind!=='upgrade'||!cancelled.has(o.item));
 if(lostMagic)w.spell_research=w.spell_research?.filter(r=>r.settlement_id!==town.id);
 refreshCityEconomy(w,town.id);for(const key of RESOURCES)town[key]=Math.min(town[key],key==='food'?town.food_capacity??town.capacity:town.capacity);
}
