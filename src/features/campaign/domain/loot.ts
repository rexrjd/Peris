import type { World } from '../../../shared/model/world';
import type { Army } from '../../army/domain/types';
import { emptyResources, RESOURCES } from '../../../shared/model/resources';
/** Delivery credits the existing home-city stock once; capacity overflow is reported. */
export function deliverCampLoot(world: World, army: Army) {
    if (!army.carried_loot) return;
    const city = world.settlements.find(s => s.id === army.home_settlement_id && s.owner_id === army.owner_id);
    if (!city) throw new Error('The returning legion’s home city is missing.');
    const delivered = emptyResources(), overflow = emptyResources();
    for (const key of RESOURCES) {
        delivered[key] = Math.min(army.carried_loot[key], Math.max(0, (key === 'food' ? city.food_capacity ?? city.capacity : city.capacity) - city[key]));
        overflow[key] = army.carried_loot[key] - delivered[key]; city[key] += delivered[key];
    }
    const report = world.reports.find(r => r.owner_id === army.owner_id && r.battle_id === army.loot_report_id);
    if (report) { report.result.delivered = delivered; report.result.overflow = overflow; }
    army.carried_loot = null; army.loot_report_id = null;
}
