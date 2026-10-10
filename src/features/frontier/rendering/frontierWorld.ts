import type { Army } from '../../army/domain/types';
import { battleTerrainAtWorld } from '../../battle/domain/terrain';
import { WORLD_COLS, WORLD_MAP_SEED, WORLD_MAP_VERSION, WORLD_ROWS, CELL_SIZE, wrapWorldCell } from '../../map/domain/dimensions';
import { cellCenter } from '../../map/domain/worldGrid';
import type { World } from '../../../shared/model/world';
import { FRONTIER_UNITS, FRONTIER_UNIT_TYPES } from '../domain/units';
import type { CampView, Raid, Troops, Village } from '../domain/types';

export const FRONTIER_MAP_SETTLEMENT_ID = 1;

/** Camp tiles are unique in the authority. Using the canonical tile also makes
 * presentation IDs independent of viewport page order and avoids hash collisions. */
export function frontierMapCampId(camp: { col: number; row: number }): number {
    const { col, row } = wrapWorldCell(camp.col, camp.row);
    return 100_000 + (row + WORLD_ROWS / 2) * WORLD_COLS + col + WORLD_COLS / 2;
}

function classes(troops: Troops) {
    const result = { infantry: 0, archers: 0, cavalry: 0 };
    for (const unit of FRONTIER_UNIT_TYPES) result[FRONTIER_UNITS[unit].combatClass] += troops[unit] ?? 0;
    return result;
}

export type FrontierMapProjection = {
    world: World;
    playerId: string;
    campIds: Map<number, string>;
};

/** A presentation adapter, not a campaign or a second simulation. Every position,
 * troop count and travel timestamp comes from the Frontier authority. Renderers
 * never receive a campaign engine, save writer or gameplay command through it. */
export function projectFrontierWorld({ village, camps, raids = [], now = village.producedAt, raidIds = new Map() }: {
    village: Village;
    camps: CampView[];
    raids?: Raid[];
    now?: number;
    raidIds?: Map<string, number>;
}): FrontierMapProjection {
    const date = new Date(now).toISOString(), playerId = `frontier:${village.id}`, home = cellCenter(village.col, village.row);
    const campIds = new Map(camps.map(camp => [frontierMapCampId(camp), camp.id]));
    const armies: Army[] = [];
    for (const raid of raids) {
        if (raid.status === 'complete' || raid.path.length < 2) continue;
        const returning = raid.status === 'returning', troops = classes(returning ? raid.survivors : raid.troops);
        if (!troops.infantry && !troops.archers && !troops.cavalry) continue;
        let id = raidIds.get(raid.id);
        if (id === undefined) { id = raidIds.size + 1; raidIds.set(raid.id, id); }
        // Clone points before reversing: the authoritative outbound route stays intact.
        const path = raid.path.map(([x, y]): [number, number] => [x, y]);
        if (returning) path.reverse();
        const start = path[0], end = path[path.length - 1];
        const camp = camps.find(target => target.id === raid.campId);
        armies.push({
            id, owner_id: playerId, home_settlement_id: FRONTIER_MAP_SETTLEMENT_ID, faction: village.faction,
            name: `${returning ? 'Returning from' : 'Raid to'} ${raid.campName}`, ...troops,
            start_x: start[0], start_y: start[1], target_x: end[0], target_y: end[1],
            departure_at: new Date(returning ? raid.arrivesAt : raid.departedAt).toISOString(),
            arrival_at: new Date(returning ? raid.returnsAt : raid.arrivesAt).toISOString(),
            updated_at: date, status: 'moving', raid_target_id: camp ? frontierMapCampId(camp) : null,
            march_path: path, march_distance: raid.distance, march_map_version: WORLD_MAP_VERSION,
        });
    }
    return {
        playerId, campIds,
        world: {
            version: 6, server_now: date,
            players: [{ id: playerId, display_name: village.name, created_at: date, prestige: 0, victories: 0, recruits: 0, upgrades: 0 }],
            settlements: [{
                id: FRONTIER_MAP_SETTLEMENT_ID, owner_id: playerId, name: village.name, ...home, faction: village.faction,
                ...village.resources, resources_updated_at: new Date(village.producedAt).toISOString(), created_at: date,
                // Economy is presented by VillageOverview from the real snapshot;
                // these campaign-only fields are unused by this map's renderer.
                wood_rate: 0, stone_rate: 0, food_rate: 0, gold_rate: 0, capacity: 0, map_development: 1,
            }],
            camps: camps.map(camp => {
                const point = cellCenter(camp.col, camp.row);
                return {
                    id: frontierMapCampId(camp), bandit: true, faction: camp.faction,
                    name: `${camp.name} (${camp.col} | ${camp.row})`, ...point,
                    tier: camp.tier === 'low' ? 1 : camp.tier === 'medium' ? 2 : 3,
                    terrain: battleTerrainAtWorld(point.x, point.y), ...classes(camp.defenders),
                    description: `${camp.tier} resource-producing mercenary camp`,
                };
            }),
            armies, buildings: [], orders: [], battles: [], formations: [], reports: [], progress: [], claims: [], challenges: [],
            map: { version: WORLD_MAP_VERSION, cols: WORLD_COLS, rows: WORLD_ROWS, cell_size: CELL_SIZE, seed: WORLD_MAP_SEED, total_players: 1, total_settlements: 1 },
        },
    };
}
