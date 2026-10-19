import type { World } from '../../../shared/model/world';
import { factionOf } from '../../factions/domain/factions';
import { rosterTotal } from '../../army/domain/roster';
import { cityEnvironment } from './environment';
import { citySlots } from './slots';
import { cityOverview } from './overview';
import { cityMilitaryOverview } from './militaryOverview';

/** Appearance contains no private army state, resource balances or wall-clock values. */
export function cityPreviewState(world: World, sid: number) {
    const town = world.settlements.find(city => city.id === sid)!;
    const slots = citySlots(world, sid).slice().sort((a, b) => a.slot_index - b.slot_index);
    const levels = Object.fromEntries(world.buildings.filter(building => building.settlement_id === sid)
        .map(building => [building.building_type, building.level]).sort(([a], [b]) => String(a).localeCompare(String(b))));
    // Match the live City's compatibility frontage for preserved fishery queues.
    const fishing = slots.some(slot => slot.slot_index === 16) || world.orders.some(order =>
        order.owner_id === town.owner_id && (order.settlement_id ?? world.settlements[0].id) === sid && order.kind === 'upgrade' && order.item === 'slot:16:fishery');
    const environment = cityEnvironment(town, fishing);
    const faction = factionOf(town.faction);
    const key = JSON.stringify([faction, environment, levels, slots.map(slot => [slot.slot_index, slot.building_type, slot.level])]);
    return { key, faction, environment, levels: levels as Record<string, number>, slots };
}

export function citySelectorEntries(world: World, owner: string, now: number) {
    return world.settlements.filter(city => city.owner_id === owner).map(city => ({
        id: city.id, name: city.name,
        population: Math.floor(cityOverview(world, city.id, now).population),
        army: rosterTotal(cityMilitaryOverview(world, city.id, owner, now).totals),
    }));
}

export type CityPreviewState = ReturnType<typeof cityPreviewState>;
