import type { World } from '../../../shared/model/world';
import type { LocalCommandContext } from '../../../shared/model/commands';
import type { BuildingType } from '../../city/domain/types';
import { RESOURCES } from '../../../shared/model/resources';
import { affordable } from '../../city/domain/economy';
import { mainLevel, refreshCityEconomy } from '../../city/domain/slots';
import { CELL_SIZE, wrapWorldCell, wrappedCellDistance } from '../../map/domain/dimensions';
import { cellCenter, isWalkable } from '../../map/domain/worldGrid';
import { findMarchPath } from '../../map/domain/pathfinding';
import { commandCity } from './context';

export type SettlerExpedition = {
    id: number; owner_id: string; origin_settlement_id: number; col: number; row: number; name: string;
    departure_at: string; arrival_at: string; culture_cost: number;
    march_path: [number, number][]; status: 'travelling' | 'founded' | 'returned'; settlement_id?: number | null;
};
export const MAX_CITIES = 10;
export const SETTLERS_REQUIRED = 3;
export const SETTLER_COST = { wood: 350, stone: 250, food: 450, gold: 100 };
export const COLONY_COST = { wood: 500, stone: 400, food: 600, gold: 150 };
export const cultureCost = (existingCities: number) => 300 * existingCities ** 2;
export function cityCultureRate(world: World, sid: number) {
    return 5 + world.buildings.filter(b => b.settlement_id === sid).reduce((sum, b) => sum + b.level * 2, 0)
        + (world.city_slots ?? []).filter(s => s.settlement_id === sid).reduce((sum, s) => sum + s.level * 3, 0);
}
export const cultureRate = (world: World, owner: string) => world.settlements.filter(s => s.owner_id === owner).reduce((sum, s) => sum + cityCultureRate(world, s.id), 0);
export function liveCulture(world: World, owner: string, now = Date.now()) {
    const player = world.players.find(p => p.id === owner)!;
    return Math.min(1e9, (player.culture_points ?? 0) + Math.max(0, now - Date.parse(player.culture_updated_at ?? world.server_now)) / 60000 * cultureRate(world, owner));
}
export function accrueCulture(world: World, owner: string, now: number) {
    const player = world.players.find(p => p.id === owner);
    if (!player || now <= Date.parse(player.culture_updated_at ?? world.server_now)) return;
    player.culture_points = liveCulture(world, owner, now); player.culture_updated_at = new Date(now).toISOString();
}
export const expansionCount = (world: World, owner: string) => world.settlements.filter(s => s.owner_id === owner).length + (world.settler_expeditions ?? []).filter(e => e.owner_id === owner && e.status === 'travelling').length;
export function foundingReason(world: World, owner: string, col: number, row: number): string | null {
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return 'Choose whole field coordinates.';
    const cell = wrapWorldCell(col, row);
    if (!isWalkable(cell.col, cell.row)) return 'A city needs dry land.';
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (!isWalkable(cell.col + dx, cell.row + dy)) return 'Choose a site with dry neighbouring fields for your city.';
    if (world.settlements.some(s => wrappedCellDistance(cell, { col: Math.floor(s.x / CELL_SIZE), row: Math.floor(s.y / CELL_SIZE) }) < 4)) return 'Stay at least four fields away from another city.';
    if (world.camps.some(c => wrappedCellDistance(cell, { col: Math.floor(c.x / CELL_SIZE), row: Math.floor(c.y / CELL_SIZE) }) <= 1)) return 'A campaign landmark protects this land.';
    if ((world.map_plots ?? []).some(p => wrappedCellDistance(cell, p) <= 1)) return 'Choose unclaimed land with free neighbouring fields.';
    if ((world.settler_expeditions ?? []).some(e => e.status === 'travelling' && wrappedCellDistance(cell, e) < 4)) return 'Another settler expedition has reserved a nearby site.';
    return null;
}
export function trainSettlers(ctx: LocalCommandContext, quantity: number) {
    const city = commandCity(ctx), world = ctx.world;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 3) throw new Error('Train between one and three settlers.');
    if (mainLevel(world, city.id) < 2) throw new Error('Upgrade the main building to level 2 to train settlers.');
    if (world.orders.some(o => o.settlement_id === city.id && o.kind === 'settler')) throw new Error('Settlers are already training in this city.');
    const travelling = (world.settler_expeditions ?? []).filter(e => e.origin_settlement_id === city.id && e.status === 'travelling').length * SETTLERS_REQUIRED;
    if ((city.settlers ?? 0) + travelling + quantity > 6) throw new Error('A city can prepare up to six settlers.');
    const cost = { ...SETTLER_COST }; for (const key of RESOURCES) cost[key] *= quantity;
    if (!affordable(city, cost)) throw new Error('More supplies are needed to train settlers.');
    for (const key of RESOURCES) city[key] -= cost[key];
    world.orders.push({ id: ctx.nextId(), owner_id: ctx.playerId, settlement_id: city.id, kind: 'settler', item: 'settlers', quantity, started_at: ctx.now, finish_at: new Date(Date.parse(ctx.now) + Math.ceil(40 * quantity / (1 + mainLevel(world, city.id) * .15)) * 1000).toISOString() });
}
export function sendSettlers(ctx: LocalCommandContext, col: number, row: number, name: string) {
    const city = commandCity(ctx), world = ctx.world, player = world.players.find(p => p.id === ctx.playerId)!;
    const reason = foundingReason(world, ctx.playerId, col, row); if (reason) throw new Error(reason);
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 32) throw new Error('Use a city name of 2–32 characters.');
    const count = expansionCount(world, ctx.playerId), cost = cultureCost(count);
    if (count >= MAX_CITIES) throw new Error('Your empire can hold up to ten cities.');
    if ((city.settlers ?? 0) < SETTLERS_REQUIRED) throw new Error('Prepare three settlers in this city first.');
    if ((player.culture_points ?? 0) < cost) throw new Error(`You need ${cost.toLocaleString()} culture points to found the next city.`);
    if (!affordable(city, COLONY_COST)) throw new Error('More supplies are needed for this colony.');
    const target = wrapWorldCell(col, row), route = findMarchPath(city, cellCenter(target.col, target.row));
    if (!route) throw new Error('There is no connected land route to this site.');
    city.settlers! -= SETTLERS_REQUIRED; player.culture_points! -= cost;
    for (const key of RESOURCES) city[key] -= COLONY_COST[key];
    (world.settler_expeditions ??= []).push({ id: ctx.nextId(), owner_id: ctx.playerId, origin_settlement_id: city.id, ...target, name: name.trim(), culture_cost: cost, departure_at: ctx.now, arrival_at: new Date(Date.parse(ctx.now) + Math.max(5, route.distance / 18) * 1000).toISOString(), march_path: route.path, status: 'travelling' });
}
export function nextEntityId(world: World) {
    return Math.max(0, ...[world.settlements, world.buildings, world.armies, world.orders, world.battles, world.formations, world.reports, world.heroes ?? [], world.hero_artifacts ?? [], world.settler_expeditions ?? []].flatMap(rows => rows.map(r => r.id))) + 1;
}
export function completeExpedition(world: World, expedition: SettlerExpedition) {
    if (expedition.status !== 'travelling') return;
    // Exclude this reservation when rechecking the site at arrival.
    const check = { ...world, settler_expeditions: world.settler_expeditions?.filter(e => e !== expedition) };
    if (foundingReason(check, expedition.owner_id, expedition.col, expedition.row)) {
        expedition.status = 'returned';
        const source = world.settlements.find(s => s.id === expedition.origin_settlement_id)!;
        source.settlers = Math.min(6, (source.settlers ?? 0) + SETTLERS_REQUIRED);
        const player = world.players.find(p => p.id === expedition.owner_id)!;
        player.culture_points = Math.min(1e9, (player.culture_points ?? 0) + expedition.culture_cost);
        for (const key of RESOURCES) source[key] = Math.min(key === 'food' ? source.food_capacity ?? source.capacity : source.capacity, source[key] + COLONY_COST[key]);
        return;
    }
    const id = nextEntityId(world), point = cellCenter(expedition.col, expedition.row), source = world.settlements.find(s => s.id === expedition.origin_settlement_id)!;
    world.settlements.push({ id, owner_id: expedition.owner_id, name: expedition.name, ...point, faction: source.faction, settlers: 0, wood: 750, stone: 600, food: 800, gold: 250, capacity: 5000, food_capacity: 5000, wood_rate: 14, stone_rate: 12, food_rate: 18, gold_rate: 3, resources_updated_at: expedition.arrival_at, created_at: expedition.arrival_at });
    const types: BuildingType[] = ['lumber', 'quarry', 'farm', 'market', 'barracks', 'stables', 'wall', 'storehouse'];
    world.buildings.push(...types.map((type, index) => ({ id: id + index + 1, settlement_id: id, building_type: type, level: 0, updated_at: expedition.arrival_at })));
    refreshCityEconomy(world, id); expedition.status = 'founded'; expedition.settlement_id = id;
}
