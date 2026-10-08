import {advancePopulationEconomy} from './population';
import { RESOURCES, type Resources } from '../../../shared/model/resources';
import { type Settlement } from './types';
export function affordable(res: Resources, cost: Resources) { return RESOURCES.every(k => res[k] >= cost[k]); }
export function projectSettlement(s:Settlement,now=Date.now()):Settlement {const projected={...s};accrueResources(projected,now);return projected;}
export function liveResources(s: Settlement, now = Date.now()): Resources {const projected=projectSettlement(s,now);return Object.fromEntries(RESOURCES.map(k=>[k,Math.floor(projected[k])])) as Resources;}
export function accrueResources(s: Settlement, until: number) {
    if(s.population!==undefined&&s.population_capacity!==undefined){advancePopulationEconomy(s,until);return;}
    const minutes = Math.max(0, until - Date.parse(s.resources_updated_at)) / 60000;
    for (const key of RESOURCES)
        s[key] = Math.max(0,Math.min(key==='food' ? s.food_capacity ?? s.capacity : s.capacity, s[key] + s[`${key}_rate`] * minutes));
    s.resources_updated_at = new Date(Math.max(until, Date.parse(s.resources_updated_at))).toISOString();
}
