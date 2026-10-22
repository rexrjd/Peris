import {researchFactor} from '../../research/domain/effects';
import type { World } from '../../../shared/model/world';
import type { ArmyTroops } from '../../army/domain/types';
import { refreshCityEconomy } from './slots';

import { ruinCity } from './ruins';
export const SIEGE_TARGETS = {
    auto:'Automatic', market:'Main building', academy:'Academy', barracks:'Barracks', stables:'Stables', workshop:'Workshop',
    smithy:'Smithy', warehouse:'Warehouse', granary:'Granary', housing:'Housing',
    mage_tower:'Mage tower', fishery:'Fishery', lumber:'Lumber mill', quarry:'Quarry', farm:'Farm', storehouse:'Storehouse', trading_post:'Trading post',
} as const;
export type SiegeTarget = keyof typeof SIEGE_TARGETS;
export type SiegeDamage = { building_type:string; name:string; slot_index?:number; col?:number;row?:number; before:number; after:number; weapon:'ram'|'catapult' };

/** One assault can remove at most two levels; higher levels require more engines. */
export function siegeReduction(engines:number, level:number, weapon:'ram'|'catapult') {
    let remaining=Math.max(0,Math.floor(engines)), after=Math.max(0,level);
    for(let hits=0;hits<2&&after>0;hits++){
        const needed=weapon==='ram'?6+after*4:4+after*3;
        if(remaining<needed)break;
        remaining-=needed;after--;
    }
    return level-after;
}

export function damageCity(world:World, cityId:number, troops:ArmyTroops, target:SiegeTarget='auto', now=new Date().toISOString(),attackerOwner?:string):SiegeDamage[] {
    if (world.settlements.find(city=>city.id===cityId)?.ruined_at) return [];
    const damage:SiegeDamage[]=[];const boost=attackerOwner?researchFactor(world,attackerOwner,'siege'):1;
    const wall=world.buildings.find(row=>row.settlement_id===cityId&&row.building_type==='wall');
    if(wall){
        const loss=siegeReduction(Math.floor((troops.ram??0)*boost),wall.level,'ram');
        if(loss){damage.push({building_type:'wall',name:'Walls',before:wall.level,after:wall.level-loss,weapon:'ram'});wall.level-=loss;wall.updated_at=now;}
    }
    const candidates=[
        ...(world.city_slots??[]).filter(row=>row.settlement_id===cityId).map(row=>({row,type:row.building_type,slot:row.slot_index,col:undefined,fieldRow:undefined})),
        ...world.buildings.filter(row=>row.settlement_id===cityId&&row.building_type!=='wall').map(row=>({row,type:row.building_type,slot:undefined,col:undefined,fieldRow:undefined})),
        ...(world.map_plots??[]).filter(row=>row.settlement_id===cityId&&row.building_type!==null).map(row=>({row,type:row.building_type==='market'?'trading_post':row.building_type!,slot:undefined,col:row.col,fieldRow:row.row})),
    ].filter(item=>item.row.level>0&&(target==='auto'||item.type===target))
        .sort((a,b)=>b.row.level-a.row.level||a.type.localeCompare(b.type)|| (a.slot??999)-(b.slot??999)||(a.col??999)-(b.col??999)||(a.fieldRow??999)-(b.fieldRow??999));
    const chosen=candidates[0];
    if(chosen){
        const loss=siegeReduction(Math.floor((troops.catapult??0)*boost),chosen.row.level,'catapult');
        if(loss){damage.push({building_type:chosen.type,name:SIEGE_TARGETS[chosen.type as SiegeTarget]??chosen.type,slot_index:chosen.slot,col:chosen.col,row:chosen.fieldRow,before:chosen.row.level,after:chosen.row.level-loss,weapon:'catapult'});chosen.row.level-=loss;}
    }
    if(damage.length)refreshCityEconomy(world,cityId);
    if((troops.catapult??0)>0||(troops.ram??0)>0)ruinCity(world,cityId,Date.parse(now));
    return damage;
}
