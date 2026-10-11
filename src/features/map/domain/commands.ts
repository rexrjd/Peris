import { commandArmy } from '../../empire/domain/context';
import { heroBonuses } from '../../heroes/domain/heroes';
import { type Command, type LocalCommandContext } from '../../../shared/model/commands';
import { soldierTotal } from '../../army/domain/units';
import { armyPosition } from './movement';
import { CELL_SIZE, WORLD_MAP_VERSION, wrapWorldPoint } from './dimensions';
import { findMarchPath } from './pathfinding';
import { isWalkable } from './worldGrid';
import type { Army } from '../../army/domain/types';
import { addStationGarrison, mergeStationGarrison, ownedStation, stationCell } from './garrisons';
export const MARCH_CANCEL_MS = 30_000;
export function canCancelMarch(army: Army, now = Date.now()) {
    return army.status === 'moving' && !!army.march_sent_at && !!army.march_cancel_until &&
        now >= Date.parse(army.march_sent_at) && now < Date.parse(army.march_cancel_until);
}
/** Reserved troops were never sent or exposed to battle losses. Consume the reserve once. */
export function restoreRaidReserve(army: Army) {
    if (!army.raid_reserve) return;
    for (const type of ['infantry', 'archers', 'cavalry'] as const) army[type] += army.raid_reserve[type];
    army.raid_reserve = null;
}
/** A raid's return is an existing journey, without another cancellation window. */
export function startRaidReturn(world: LocalCommandContext['world'], army: Army, clock = Date.now()) {
    if (army.march_returning) return true;
    const origin = army.march_origin, path = army.march_path, distance = army.march_distance;
    army.raid_target_id = null; army.march_sent_at = null; army.march_cancel_until = null;
    if (!origin || !path || distance == null) return false;
    army.start_x = army.target_x; army.start_y = army.target_y;
    army.target_x = origin.x; army.target_y = origin.y;
    army.march_path = path.slice().reverse(); army.march_returning = true; army.status = 'moving';
    army.departure_at = new Date(clock).toISOString();
    army.arrival_at = new Date(clock + Math.max(2, distance / (22 * heroBonuses(world, army).speed)) * 1000).toISOString();
    army.updated_at = army.departure_at;
    return true;
}
export function cancelMarch(context: LocalCommandContext, cmd: Extract<Command, { type: 'cancelMarch' }>) {
    const army = commandArmy({ ...context, armyId: cmd.armyId });
    if (army.march_sent_at !== cmd.sentAt) throw new Error('This march is no longer the same order.');
    if (!canCancelMarch(army, Date.parse(context.now))) throw new Error('Marches can only be cancelled during the first 30 seconds.');
    restoreRaidReserve(army);
    army.status = 'idle'; army.raid_target_id = null;
    army.target_x = army.start_x; army.target_y = army.start_y;
    mergeStationGarrison(context.world, army);
    army.departure_at = context.now; army.arrival_at = context.now;
    army.march_path = null; army.march_distance = null;
    army.march_sent_at = null; army.march_cancel_until = null;
    army.march_origin = null; army.march_returning = false;
    army.updated_at = context.now;
}
export function marchArmy(context: LocalCommandContext, cmd: Extract<Command, {
    type: 'move' | 'raid';
}>) {
    const w = context.world, a = commandArmy(context), now = context.now, clock = Date.parse(now);
    if (w.orders.some(o => o.kind === 'recruit' && (o.army_id ?? w.armies[0].id) === a.id))
        throw new Error('Let the training queue finish before marching.');
    let x: number, y: number, raidTargetId: number | null = null;
    if (cmd.type === 'raid') {
        const c = w.camps.find(c => c.id === cmd.campId);
        if (!c)
            throw new Error('Camp not found.');
        if (w.progress.some(t => t.owner_id === context.playerId && t.camp_id === c.id && Date.parse(t.available_at) > clock))
            throw new Error('The camp is still regrouping.');
        if (!soldierTotal(a))
            throw new Error('Recruit soldiers before starting a raid.');
        x = c.x;
        y = c.y;
        raidTargetId = c.id;
    }
    else {
        if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y))
            throw new Error('Choose a destination.');
        const target = wrapWorldPoint(cmd); x = target.x; y = target.y;
    }
    if (a.status !== 'idle' || a.raid_target_id !== null || a.raid_reserve)
        throw new Error('This legion already has a march or raid. Cancel within 30 seconds or wait for its return.');
    const troops = cmd.type === 'raid' ? cmd.troops : undefined;
    if (cmd.type === 'raid' && cmd.troops !== undefined && (!troops || typeof troops !== 'object' || Array.isArray(troops)))
        throw new Error('Choose troops currently available in this legion.');
    if (troops && (['infantry', 'archers', 'cavalry'] as const).some(type => !Number.isSafeInteger(troops[type]) || troops[type] < 0 || troops[type] > a[type]))
        throw new Error('Choose troops currently available in this legion.');
    if (troops && !soldierTotal(troops)) throw new Error('Send at least one soldier.');
    if (!isWalkable(Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE))) throw new Error('Land armies cannot march across the sea.');
    const pos = wrapWorldPoint(armyPosition(a, clock));
    // Legacy saves may already have an army resting on neutral land. Let it
    // travel back to an owned station, without allowing a new raid from there.
    if (cmd.type === 'raid' && !ownedStation(w, context.playerId, pos)) throw new Error('Depart from one of your own villages or claimed fields.');
    if (cmd.type === 'move' && !ownedStation(w, context.playerId, { x, y })) throw new Error('Troops can only station in your own villages and fields.');
    const route = findMarchPath(pos, { x, y });
    if (!route) throw new Error('No connected land route reaches this destination.');
    const seconds = Math.max(2, route.distance / (22 * heroBonuses(w, a).speed));
    // Every guard and route calculation succeeds before the existing army changes.
    a.raid_target_id = raidTargetId;
    if (troops) {
        addStationGarrison(w, context.playerId, pos, { infantry: a.infantry - troops.infantry, archers: a.archers - troops.archers, cavalry: a.cavalry - troops.cavalry });
        for (const type of ['infantry', 'archers', 'cavalry'] as const) a[type] = troops[type];
    }
    a.march_origin = { ...stationCell(pos), ...pos }; a.march_returning = false;
    a.march_path = route.path;
    a.march_distance = route.distance;
    a.march_map_version = WORLD_MAP_VERSION;
    a.start_x = pos.x;
    a.start_y = pos.y;
    a.target_x = x;
    a.target_y = y;
    a.march_sent_at = now;
    a.march_cancel_until = new Date(clock + MARCH_CANCEL_MS).toISOString();
    a.departure_at = a.march_cancel_until;
    a.arrival_at = new Date(clock + MARCH_CANCEL_MS + seconds * 1000).toISOString();
    a.updated_at = now;
    a.status = 'moving';
}
