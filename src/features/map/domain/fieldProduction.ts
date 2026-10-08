import {RESOURCES,type Resources} from '../../../shared/model/resources';
import {getCell,type FieldTerrain} from './worldGrid';
import type {FieldBuilding,MapPlot} from './territory';

export const FIELD_MAX_LEVEL = 5;
export const FIELD_BUILDINGS: Record<FieldBuilding, { name: string; resource: keyof Resources; baseRate: number; cost: Resources }> = {
    lumber: { name: 'Lumber mill', resource: 'wood', baseRate: 6, cost: { wood: 80, stone: 50, food: 30, gold: 10 } },
    quarry: { name: 'Quarry', resource: 'stone', baseRate: 5, cost: { wood: 70, stone: 60, food: 30, gold: 10 } },
    farm: { name: 'Farm', resource: 'food', baseRate: 8, cost: { wood: 60, stone: 40, food: 50, gold: 10 } },
    market: { name: 'Trading post', resource: 'gold', baseRate: 2, cost: { wood: 90, stone: 70, food: 40, gold: 20 } },
};
export function fieldModifier(terrain: FieldTerrain, building: FieldBuilding) {
    if (building === 'farm') return terrain === 'mountain' ? .75 : terrain === 'grassland' || terrain === 'farmland' ? 1.1 : terrain === 'desert' || terrain === 'snow' ? .85 : 1;
    if (building === 'lumber') return terrain === 'forest' ? 1.25 : terrain === 'desert' || terrain === 'snow' ? .85 : 1;
    if (building === 'quarry') return terrain === 'mountain' ? 1.3 : terrain === 'marsh' ? .9 : 1;
    return terrain === 'coast' || terrain === 'river' ? 1.1 : terrain === 'snow' ? .9 : 1;
}
export function fieldRate(plot: MapPlot) {
    return plot.building_type && plot.level > 0 ? FIELD_BUILDINGS[plot.building_type].baseRate * Math.min(FIELD_MAX_LEVEL, plot.level) * fieldModifier(getCell(plot.col, plot.row).terrain, plot.building_type) : 0;
}
export function externalFieldRates(plots: readonly MapPlot[], settlement: number): Resources {
    const rates: Resources = { wood: 0, stone: 0, food: 0, gold: 0 };
    for (const plot of plots) if (plot.settlement_id === settlement && plot.building_type) rates[FIELD_BUILDINGS[plot.building_type].resource] += fieldRate(plot);
    return rates;
}
export function fieldCost(building: FieldBuilding, completedLevel: number): Resources {
    return Object.fromEntries(RESOURCES.map(key => [key, Math.ceil(FIELD_BUILDINGS[building].cost[key] * 1.55 ** completedLevel)])) as Resources;
}
