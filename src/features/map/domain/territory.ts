import type { World, Order } from '../../../shared/model/world';
import { RESOURCES, type Resources } from '../../../shared/model/resources';
import type { LocalCommandContext } from '../../../shared/model/commands';
import { accrueResources, affordable } from '../../city/domain/economy';
import { CELL_SIZE, wrapWorldCell, wrappedCellDistance } from './dimensions';
import { getCell, type FieldTerrain } from './worldGrid';
import type { Faction } from '../../factions/domain/factions';

export type FieldBuilding = 'lumber' | 'quarry' | 'farm' | 'market';
export type MapPlot = { col: number; row: number; settlement_id: number; owner_id: string; building_type: FieldBuilding | null; level: number; faction?: Faction };
export const TERRITORY_RULES = { startingClaims: 4, startingPopulation: 80, populationPerUpgrade: 10, firstUnlock: 120, unlockStep: 40, radius: 6, maxLevel: 5 } as const;
export const FIELD_BUILDINGS: Record<FieldBuilding, { name: string; resource: keyof Resources; baseRate: number; cost: Resources }> = {
    lumber: { name: 'Lumber mill', resource: 'wood', baseRate: 6, cost: { wood: 80, stone: 50, food: 30, gold: 10 } },
    quarry: { name: 'Quarry', resource: 'stone', baseRate: 5, cost: { wood: 70, stone: 60, food: 30, gold: 10 } },
    farm: { name: 'Farm', resource: 'food', baseRate: 8, cost: { wood: 60, stone: 40, food: 50, gold: 10 } },
    market: { name: 'Trading post', resource: 'gold', baseRate: 2, cost: { wood: 90, stone: 70, food: 40, gold: 20 } },
};
export const mapPlotKey = (col: number, row: number) => { const cell = wrapWorldCell(col, row); return `${cell.col},${cell.row}`; };
export function territoryPopulation(world: World, owner: string) {
    return TERRITORY_RULES.startingPopulation + TERRITORY_RULES.populationPerUpgrade * Math.max(0, world.players.find(p => p.id === owner)?.upgrades ?? 0);
}
export function territoryAllowance(population: number) {
    return TERRITORY_RULES.startingClaims + (population < TERRITORY_RULES.firstUnlock ? 0 : 1 + Math.floor((population - TERRITORY_RULES.firstUnlock) / TERRITORY_RULES.unlockStep));
}
export function fieldModifier(terrain: FieldTerrain, building: FieldBuilding) {
    if (building === 'farm') return terrain === 'mountain' ? .75 : terrain === 'grassland' || terrain === 'farmland' ? 1.1 : terrain === 'desert' || terrain === 'snow' ? .85 : 1;
    if (building === 'lumber') return terrain === 'forest' ? 1.25 : terrain === 'desert' || terrain === 'snow' ? .85 : 1;
    if (building === 'quarry') return terrain === 'mountain' ? 1.3 : terrain === 'marsh' ? .9 : 1;
    return terrain === 'coast' || terrain === 'river' ? 1.1 : terrain === 'snow' ? .9 : 1;
}
export function fieldRate(plot: MapPlot) {
    return plot.building_type && plot.level > 0 ? FIELD_BUILDINGS[plot.building_type].baseRate * Math.min(TERRITORY_RULES.maxLevel, plot.level) * fieldModifier(getCell(plot.col, plot.row).terrain, plot.building_type) : 0;
}
export function externalFieldRates(plots: readonly MapPlot[], settlement: number): Resources {
    const rates: Resources = { wood: 0, stone: 0, food: 0, gold: 0 };
    for (const plot of plots) if (plot.settlement_id === settlement && plot.building_type) rates[FIELD_BUILDINGS[plot.building_type].resource] += fieldRate(plot);
    return rates;
}
export function fieldCost(building: FieldBuilding, completedLevel: number): Resources {
    return Object.fromEntries(RESOURCES.map(key => [key, Math.ceil(FIELD_BUILDINGS[building].cost[key] * 1.55 ** completedLevel)])) as Resources;
}
export function fieldSeconds(level: number) { return 15 + level * 10; }
export function mapClaimReason(world: World, owner: string, col: number, row: number): string | null {
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return 'Choose whole field coordinates.';
    const cell = wrapWorldCell(col, row), home = world.settlements.find(s => s.owner_id === owner);
    if (!home) return 'Settlement not found.';
    const center = wrapWorldCell(Math.floor(home.x / CELL_SIZE), Math.floor(home.y / CELL_SIZE));
    const own = (world.map_plots ?? []).filter(p => p.settlement_id === home.id);
    if ((world.map_plots ?? []).some(p => p.col === cell.col && p.row === cell.row)) return 'This field is already owned.';
    if (world.settlements.some(s => wrappedCellDistance(cell, wrapWorldCell(Math.floor(s.x / CELL_SIZE), Math.floor(s.y / CELL_SIZE))) === 0)) return 'This field contains a settlement.';
    if (world.camps.some(c => wrappedCellDistance(cell, wrapWorldCell(Math.floor(c.x / CELL_SIZE), Math.floor(c.y / CELL_SIZE))) === 0)) return 'An ancient campaign site protects this field.';
    if (getCell(cell.col, cell.row).terrain === 'water') return 'Resource buildings need dry land.';
    if (world.settlements.some(s => s.id !== home.id && wrappedCellDistance(cell, wrapWorldCell(Math.floor(s.x / CELL_SIZE), Math.floor(s.y / CELL_SIZE))) <= 1)) return 'Another village protects its starting land.';
    const distance = wrappedCellDistance(center, cell);
    if (distance > TERRITORY_RULES.radius) return `Stay within ${TERRITORY_RULES.radius} fields of your village.`;
    if (own.length < TERRITORY_RULES.startingClaims && distance !== 1) return 'Choose your first four fields from the eight village neighbours.';
    if (own.length >= territoryAllowance(territoryPopulation(world, owner))) return 'More population is needed to claim another field.';
    if (distance !== 1 && !own.some(plot => wrappedCellDistance(plot, cell) === 1)) return 'Connect this field directly to your existing territory.';
    return null;
}
export function claimMapField(context: LocalCommandContext, col: number, row: number) {
    const reason = mapClaimReason(context.world, context.playerId, col, row); if (reason) throw new Error(reason);
    const home = context.world.settlements.find(s => s.owner_id === context.playerId)!, cell = wrapWorldCell(col, row);
    (context.world.map_plots ??= []).push({ ...cell, settlement_id: home.id, owner_id: context.playerId, building_type: null, level: 0 });
}
export function queueMapField(context: LocalCommandContext, col: number, row: number, building: FieldBuilding) {
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row) || !Object.hasOwn(FIELD_BUILDINGS, building)) throw new Error('Choose a valid resource building and field.');
    const world = context.world, key = mapPlotKey(col, row), plot = world.map_plots?.find(p => mapPlotKey(p.col, p.row) === key);
    if (!plot || plot.owner_id !== context.playerId) throw new Error('Claim this field before constructing a building.');
    if (plot.level >= TERRITORY_RULES.maxLevel) throw new Error('This field has reached its maximum level.');
    if (plot.building_type && plot.building_type !== building) throw new Error('Upgrade the existing resource building.');
    if (world.orders.some(o => o.owner_id === context.playerId && o.kind === 'field' && o.item.startsWith(`field:${plot.col}:${plot.row}:`))) throw new Error('Construction is already underway on this field.');
    const home = world.settlements.find(s => s.id === plot.settlement_id)!; accrueResources(home, Date.parse(context.now));
    const cost = fieldCost(building, plot.level); if (!affordable(home, cost)) throw new Error('More resources are needed.');
    for (const resource of RESOURCES) home[resource] -= cost[resource];
    plot.building_type = building;
    world.orders.push({ id: context.nextId(), owner_id: context.playerId, kind: 'field', item: `field:${plot.col}:${plot.row}:${building}`, quantity: 1, started_at: context.now, finish_at: new Date(Date.parse(context.now) + fieldSeconds(plot.level) * 1000).toISOString() });
}
export function completeMapField(world: World, owner: string, order: Order) {
    const [, col, row, building] = order.item.split(':');
    const plot = world.map_plots?.find(p => p.owner_id === owner && p.col === Number(col) && p.row === Number(row));
    if (!plot || plot.building_type !== building || plot.level >= TERRITORY_RULES.maxLevel) throw new Error('Queued external field no longer matches its owner or building.');
    plot.level++; world.players.find(p => p.id === owner)!.upgrades++;
}
