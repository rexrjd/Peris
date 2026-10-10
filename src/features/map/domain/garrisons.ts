import type { Army, ArmyTroops } from '../../army/domain/types';
import type { Command, LocalCommandContext } from '../../../shared/model/commands';
import type { World } from '../../../shared/model/world';
import { CELL_SIZE, wrapWorldPoint } from './dimensions';
import { armyPosition } from './movement';

export type Garrison = ArmyTroops & { owner_id: string; col: number; row: number };
export function stationCell(point: { x: number; y: number }) {
    const wrapped = wrapWorldPoint(point);
    return { col: Math.floor(wrapped.x / CELL_SIZE), row: Math.floor(wrapped.y / CELL_SIZE) };
}
/** Keep the familiar army marker offset inside its village's owned field. */
export function homeArmyPosition(city: { x: number; y: number }) {
    const point = wrapWorldPoint(city), cell = stationCell(point);
    return { x: Math.min(point.x + 40, (cell.col + 1) * CELL_SIZE - 1), y: Math.min(point.y + 30, (cell.row + 1) * CELL_SIZE - 1) };
}
/** Troops may stop only at a village or field owned by their ruler. Routes may cross other land. */
export function ownedStation(world: World, owner: string, point: { x: number; y: number }) {
    const { col, row } = stationCell(point);
    return world.settlements.some(city => city.owner_id === owner && stationCell(city).col === col && stationCell(city).row === row) ||
        !!world.map_plots?.some(plot => plot.owner_id === owner && plot.col === col && plot.row === row);
}
export function garrisonAt(world: World, owner: string, point: { x: number; y: number }) {
    const { col, row } = stationCell(point);
    return world.garrisons?.find(garrison => garrison.owner_id === owner && garrison.col === col && garrison.row === row);
}
export function addStationGarrison(world: World, owner: string, point: { x: number; y: number }, troops: ArmyTroops) {
    if (!ownedStation(world, owner, point)) throw new Error('Troops can only station in your own villages and fields.');
    if (!troops.infantry && !troops.archers && !troops.cavalry) return;
    let garrison = garrisonAt(world, owner, point);
    if (!garrison) { garrison = { owner_id: owner, ...stationCell(point), infantry: 0, archers: 0, cavalry: 0 }; (world.garrisons ??= []).push(garrison); }
    for (const type of ['infantry', 'archers', 'cavalry'] as const) garrison[type] += troops[type];
}
/** Merge up to the legion capacity; an overflowing station keeps its remaining troops. */
export function mergeStationGarrison(world: World, army: Army, troops?: ArmyTroops) {
    const point = { x: army.target_x, y: army.target_y };
    if (!ownedStation(world, army.owner_id, point)) return;
    const garrison = garrisonAt(world, army.owner_id, point);
    if (!garrison) {
        if (troops && troops.infantry + troops.archers + troops.cavalry > 0) throw new Error('No stationed troops are available here.');
        return;
    }
    const types = ['infantry', 'archers', 'cavalry'] as const;
    let capacity = Math.max(0, 1000 - army.infantry - army.archers - army.cavalry);
    if (troops && (types.some(type => !Number.isSafeInteger(troops[type]) || troops[type] < 0 || troops[type] > garrison[type]) ||
        troops.infantry + troops.archers + troops.cavalry > capacity)) throw new Error('Choose available stationed troops within the legion capacity.');
    for (const type of types) {
        const quantity = troops ? troops[type] : Math.min(capacity, garrison[type]);
        army[type] += quantity; garrison[type] -= quantity; capacity -= quantity;
    }
    if (!garrison.infantry && !garrison.archers && !garrison.cavalry) world.garrisons = world.garrisons?.filter(row => row !== garrison);
}
export function collectGarrison(context: LocalCommandContext, cmd: Extract<Command, { type: 'collectGarrison' }>) {
    const army = context.world.armies.find(row => row.id === cmd.armyId && row.owner_id === context.playerId);
    if (!army) throw new Error('Choose one of your armies.');
    if (context.world.orders.some(order => order.kind === 'recruit' && (order.army_id ?? context.world.armies[0].id) === army.id))
        throw new Error('Finish training before collecting stationed troops.');
    if (cmd.troops !== undefined && (!cmd.troops || typeof cmd.troops !== 'object' || Array.isArray(cmd.troops)))
        throw new Error('Choose whole stationed troop counts.');
    if (army.status !== 'idle' || army.raid_target_id !== null || context.world.battles.some(b => b.status === 'active' && [b.attacker_army_id, b.defender_army_id].includes(army.id)))
        throw new Error('Bring an idle legion to this station before collecting troops.');
    if (!ownedStation(context.world, context.playerId, armyPosition(army, Date.parse(context.now))))
        throw new Error('Troops can only station in your own villages and fields.');
    mergeStationGarrison(context.world, army, cmd.troops);
    army.updated_at = context.now;
}
