import type { World } from '../../../shared/model/world';
import type { Army } from '../../army/domain/types';
import { emptyResources, RESOURCES } from '../../../shared/model/resources';
import { recordCampFarmDelivery } from './farmStats';
import { recordBattleEconomics } from './reportEconomics';
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
    const deliveredAt = Date.now();
    if (report) {
        report.result.delivered = delivered; report.result.overflow = overflow; report.result.delivered_at = new Date(deliveredAt).toISOString();
        recordBattleEconomics(report.result);
        const battle = world.battles.find(row => row.id === report.battle_id);
        if (battle?.result) { battle.result.delivered = { ...delivered }; battle.result.overflow = { ...overflow }; battle.result.delivered_at = report.result.delivered_at; recordBattleEconomics(battle.result); }
    }
    recordCampFarmDelivery(world, army, delivered, deliveredAt);
    army.carried_loot = null; army.loot_report_id = null;
}
