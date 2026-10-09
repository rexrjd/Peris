import type { World } from '../../../shared/model/world';
import { BUILDINGS } from './buildings';
import { projectSettlement } from './economy';
import { populationGrowth, WORKERS_PER_LEVEL } from './population';
import { citySlots, mainLevel, slotCount } from './slots';

export type CityIssue = { kind: 'food' | 'workers' | 'housing'; title: string; detail: string; action: string; target: string };
export const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
export const signed = (value: number) => `${value >= 0 ? '+' : ''}${number(value)}`;
export const duration = (minutes: number) => minutes < 1 ? 'under 1 min' : minutes < 60 ? `${Math.ceil(minutes)} min` : `${number(minutes / 60)} hr`;

/** Read-only city projection and useful destinations for the header and report. */
export function cityOverview(world: World, sid: number, now: number) {
    const source = world.settlements.find(s => s.id === sid);
    if (!source) throw new Error('City not found.');
    const town = projectSettlement(source, now), slots = citySlots(world, sid);
    const population = town.population ?? 30, capacity = town.population_capacity ?? 40, jobs = town.workers_required ?? 0;
    const staffing = Math.min(1, population / Math.max(1, jobs)), growth = populationGrowth(town);
    const main = mainLevel(world, sid), totalPlots = slotCount(main);
    const free = Array.from({ length: totalPlots }, (_, i) => i).filter(i => !slots.some(s => s.slot_index === i));
    const housing = slots.filter(s => s.building_type === 'housing');
    const upgradeHousing = housing.filter(s => s.level > 0 && s.level < 5).sort((a, b) => a.level - b.level || a.slot_index - b.slot_index)[0];
    const housingTarget = upgradeHousing ? `slot:${upgradeHousing.slot_index}` : free.length ? `slot:${free[0]}` : main < 5 ? 'market' : housing.length ? `slot:${housing[0].slot_index}` : 'market';
    const housingAction = upgradeHousing ? 'Upgrade housing' : free.length ? 'Build housing' : main < 5 ? 'Expand the city' : housing.length ? 'Manage housing' : 'Review city capacity';
    const issues: CityIssue[] = [];
    if (town.food_rate < 0) issues.push({ kind: 'food', title: town.food <= .001 ? 'Food shortage' : 'Food is declining', detail: town.food > .001 ? `Reserves last about ${duration(town.food / -town.food_rate)} at the current balance.` : 'Food reserves are empty. Residents may leave.', action: 'Improve food production', target: 'farm' });
    if (staffing < 1) issues.push({ kind: 'workers', title: `${Math.ceil(jobs - population)} workers needed`, detail: 'Production bonuses are reduced until more residents arrive. Keep food and housing available.', action: housingAction, target: housingTarget });
    if (population >= capacity - .001) issues.push({ kind: 'housing', title: 'Housing is full', detail: 'Make room for more residents by developing housing or expanding the main building.', action: housingAction, target: housingTarget });
    const workforce = Object.entries(WORKERS_PER_LEVEL).flatMap(([type, workers]) => {
        const level = type === 'fishery' ? slots.filter(s => s.building_type === type).reduce((sum, s) => sum + s.level, 0) : world.buildings.find(b => b.settlement_id === sid && b.building_type === type)?.level ?? 0;
        return level ? [{ type, name: type === 'fishery' ? 'Fishery' : BUILDINGS[type as keyof typeof BUILDINGS].name, workers: workers * level }] : [];
    });
    return { town, population, capacity, jobs, staffing, growth, freePlots: free.length, firstFreePlot: free[0], totalPlots, main, housing, housingTarget, housingAction, issues, workforce };
}
