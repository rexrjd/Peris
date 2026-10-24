import {advancePopulationEconomy} from './population';
import { RESOURCES, type Resources } from '../../../shared/model/resources';
import { type Settlement } from './types';
import type {World} from '../../../shared/model/world';
import {starveOne} from './troopSupply';
import {advanceLoyalty} from './loyalty';
export function affordable(res: Resources, cost: Resources) { return RESOURCES.every(k => res[k] >= cost[k]); }
export function projectSettlement(s:Settlement,now=Date.now()):Settlement {const projected={...s};accrueResources(projected,now);return projected;}
export function liveResources(s: Settlement, now = Date.now()): Resources {const projected=projectSettlement(s,now);return Object.fromEntries(RESOURCES.map(k=>[k,Math.floor(projected[k])])) as Resources;}
export function accrueResources(s: Settlement, until: number, world?:World) {
    if(s.loyalty!==undefined)advanceLoyalty(s,until);
    if(s.population!==undefined&&s.population_capacity!==undefined){advancePopulationEconomy(s,until,world?.troop_upkeep_version===1?at=>{
        // Returned merchants can unload as consumption opens room, even without browser polls.
        const waiting=world.trade_caravans?.filter(c=>c.status==='waiting'&&c.owner_id===s.owner_id&&(c.return_settlement_id??c.source_settlement_id)===s.id&&c.returning_resources.food>0).sort((a,b)=>a.id-b.id)[0];
        if(waiting){const crop=Math.min(s.food_capacity??s.capacity,waiting.returning_resources.food);waiting.returning_resources.food-=crop;if(RESOURCES.every(k=>waiting.returning_resources[k]===0))waiting.status='completed';return crop;}
        return starveOne(world,s,at);
    }:undefined);return;}
    const minutes = Math.max(0, until - Date.parse(s.resources_updated_at)) / 60000;
    for (const key of RESOURCES)
        s[key] = Math.max(0,Math.min(key==='food' ? s.food_capacity ?? s.capacity : s.capacity, s[key] + s[`${key}_rate`] * minutes));
    s.resources_updated_at = new Date(Math.max(until, Date.parse(s.resources_updated_at))).toISOString();
}
