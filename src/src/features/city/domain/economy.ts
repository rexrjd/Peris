import { RESOURCES, type Resources } from '../../../shared/model/resources';
import { type Settlement } from './types';
export function affordable(res: Resources, cost: Resources) { return RESOURCES.every(k => res[k] >= cost[k]); }
export function liveResources(s: Settlement, now = Date.now()): Resources {
    const minutes = Math.max(0, now - Date.parse(s.resources_updated_at)) / 60000;
    return Object.fromEntries(RESOURCES.map(k => [k, Math.min(s.capacity ?? 7500, Math.floor(s[k] + s[`${k}_rate`] * minutes))])) as Resources;
}
export function accrueResources(s: Settlement, until: number) {
    const minutes = Math.max(0, until - Date.parse(s.resources_updated_at)) / 60000;
    for (const key of RESOURCES)
        s[key] = Math.min(s.capacity, s[key] + s[`${key}_rate`] * minutes);
    s.resources_updated_at = new Date(Math.max(until, Date.parse(s.resources_updated_at))).toISOString();
}
