import { commandArmy } from '../../empire/domain/context';
import { isDefeated, livingCities } from '../../city/domain/ruins';
import { SIEGE_TARGETS } from '../../city/domain/siege';
import { heroBonuses } from '../../heroes/domain/heroes';
import { type Command, type LocalCommandContext } from '../../../shared/model/commands';
import { soldierTotal } from '../../army/domain/units';
import { armyPosition } from './movement';
import { CELL_SIZE, WORLD_MAP_VERSION, wrapWorldPoint } from './dimensions';
import { findMarchPath } from './pathfinding';
import { isWalkable } from './worldGrid';
import type { Army, ArmyTroops } from '../../army/domain/types';
import { addStationGarrison, mergeStationGarrison, ownedStation, stationCell, homeArmyPosition } from './garrisons';
import { readRoster, writeRoster, addRosters, RECRUIT_UNITS, RECRUIT_RULES, rosterTotal, validateRoster } from '../../army/domain/roster';
export const MARCH_CANCEL_MS = 30_000;
/** A party travels together at its slowest recruited role; infantry retains the original 22-unit pace. */
export function marchSpeed(world: LocalCommandContext['world'], army: Army, troops: ArmyTroops = readRoster(army)) {
    const present = RECRUIT_UNITS.filter(unit => (troops[unit] ?? 0) > 0);
    const pace = present.length ? Math.min(...present.map(unit => RECRUIT_RULES[unit].speed)) : RECRUIT_RULES.infantry.speed;
    return 22 * pace / RECRUIT_RULES.infantry.speed * heroBonuses(world, army).speed;
}
export function canCancelMarch(army: Army, now = Date.now()) {
    return army.status === 'moving' && !!army.march_sent_at && !!army.march_cancel_until &&
        now >= Date.parse(army.march_sent_at) && now < Date.parse(army.march_cancel_until);
}
/** Reserved troops were never sent or exposed to battle losses. Consume the reserve once. */
export function restoreRaidReserve(army: Army) {
    if (!army.raid_reserve) return;
    writeRoster(army, addRosters(readRoster(army), army.raid_reserve));
    army.raid_reserve = null;
}
/** A raid's return is an existing journey, without another cancellation window. */
export function startRaidReturn(world: LocalCommandContext['world'], army: Army, clock = Date.now()) {
    if (army.march_returning) return true;
    const origin = army.march_origin, path = army.march_path, distance = army.march_distance;
    army.raid_target_id = null; army.march_sent_at = null; army.march_cancel_until = null;
    army.raid_city_id=null;army.siege_target='auto';
    const home = world.settlements.find(city=>city.id===army.home_settlement_id && !city.ruined_at);
    if (isDefeated(world,army.owner_id)) return false;
    if (!origin || !ownedStation(world,army.owner_id,origin)) {
        const alternate = home ?? livingCities(world,army.owner_id)[0];
        if (!alternate) return false;
        const start = {x:army.target_x,y:army.target_y};
        const safe=homeArmyPosition(alternate),route=findMarchPath(start,safe);
        if(!route)return false;
        army.home_settlement_id=alternate.id;
        army.start_x=start.x;army.start_y=start.y;army.target_x=safe.x;army.target_y=safe.y;
        army.march_path=route.path;army.march_distance=route.distance;
        army.status='moving';army.march_returning=true;army.raid_city_id=null;army.raid_target_id=null;
        army.departure_at=new Date(clock).toISOString();
        army.arrival_at=new Date(clock+Math.max(2,route.distance/marchSpeed(world,army))*1000).toISOString();
        return true;
    }
    if (!path || distance == null) return false;
    army.start_x = army.target_x; army.start_y = army.target_y;
    army.target_x = origin.x; army.target_y = origin.y;
    army.march_path = path.slice().reverse(); army.march_returning = true; army.status = 'moving';
    army.departure_at = new Date(clock).toISOString();
    army.arrival_at = new Date(clock + Math.max(2, distance / marchSpeed(world, army)) * 1000).toISOString();
    army.updated_at = army.departure_at;
    return true;
}
export function cancelMarch(context: LocalCommandContext, cmd: Extract<Command, { type: 'cancelMarch' }>) {
    const army = commandArmy({ ...context, armyId: cmd.armyId });
    if (army.march_sent_at !== cmd.sentAt) throw new Error('This march is no longer the same order.');
    if (!canCancelMarch(army, Date.parse(context.now))) throw new Error('Marches can only be cancelled during the first 30 seconds.');
    restoreRaidReserve(army);
    army.status = 'idle'; army.raid_target_id = null;
    army.raid_city_id=null;army.siege_target='auto';
    army.target_x = army.start_x; army.target_y = army.start_y;
    mergeStationGarrison(context.world, army);
    army.departure_at = context.now; army.arrival_at = context.now;
    army.march_path = null; army.march_distance = null;
    army.march_sent_at = null; army.march_cancel_until = null;
    army.march_origin = null; army.march_returning = false; army.farm_list_id = null;
    army.updated_at = context.now;
}
export function marchArmy(context: LocalCommandContext, cmd: Extract<Command, {
    type: 'move' | 'raid' | 'raidCity';
}>) {
    const w = context.world, a = commandArmy(context), now = context.now, clock = Date.parse(now);
    if(isDefeated(w,context.playerId))throw new Error('This ruler has been defeated.');
    if (w.battles.some(battle => battle.status === 'active' && (battle.attacker_owner_id === context.playerId || battle.defender_owner_id === context.playerId))) throw new Error('Finish the current battle first.');
    if (w.orders.some(o => o.kind === 'recruit' && o.recruit_destination !== 'garrison' && (o.army_id ?? w.armies[0].id) === a.id))
        throw new Error('Let the training queue finish before marching.');
    let x: number, y: number, raidTargetId: number | null = null;
    if (cmd.type === 'raid') {
        const c = w.camps.find(c => c.id === cmd.campId);
        if (!c)
            throw new Error('Camp not found.');
        if (!c.bandit && w.progress.some(t => t.owner_id === context.playerId && t.camp_id === c.id && Date.parse(t.available_at) > clock))
            throw new Error('The camp is still regrouping.');
        if (!soldierTotal(a))
            throw new Error('Recruit soldiers before starting a raid.');
        x = c.x;
        y = c.y;
        raidTargetId = c.id;
    }
    else if(cmd.type==='raidCity'){
        const city=w.settlements.find(row=>row.id===cmd.targetCityId);
        if(!city||city.owner_id===context.playerId||city.ruined_at)throw new Error('Choose another player’s living city.');
        if(cmd.siegeTarget!==undefined&&!Object.hasOwn(SIEGE_TARGETS,cmd.siegeTarget))throw new Error('Choose a valid catapult target.');
        if(!soldierTotal(a))throw new Error('Recruit soldiers before starting a raid.');
        x=city.x;y=city.y;
    } else {
        if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y))
            throw new Error('Choose a destination.');
        const target = wrapWorldPoint(cmd); x = target.x; y = target.y;
    }
    if (a.status !== 'idle' || a.raid_target_id !== null || a.raid_city_id!=null || a.raid_reserve)
        throw new Error('This legion already has a march or raid. Cancel within 30 seconds or wait for its return.');
    const available = readRoster(a);
    const troops = cmd.troops;
    if (cmd.troops !== undefined && (!troops || typeof troops !== 'object' || Array.isArray(troops)))
        throw new Error('Choose troops currently available in this legion.');
    if (troops && (!validateRoster(troops) || RECRUIT_UNITS.some(unit => (troops[unit] ?? 0) > available[unit])))
        throw new Error('Choose troops currently available in this legion.');
    if (troops && !rosterTotal(troops)) throw new Error('Send at least one soldier.');
    if (!isWalkable(Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE))) throw new Error('Land armies cannot march across the sea.');
    const pos = wrapWorldPoint(armyPosition(a, clock));
    // Legacy saves may already have an army resting on neutral land. Let it
    // travel back to an owned station, without allowing a new raid from there.
    if (cmd.type !== 'move' && !ownedStation(w, context.playerId, pos)) throw new Error('Depart from one of your own villages or claimed fields.');
    if (troops && rosterTotal(troops) < rosterTotal(available) && !ownedStation(w, context.playerId, pos)) throw new Error('Leave reinforcements only at your own village or field.');
    if (cmd.type === 'move' && !ownedStation(w, context.playerId, { x, y })) throw new Error('Troops can only station in your own villages and fields.');
    const route = findMarchPath(pos, { x, y });
    if (!route) throw new Error('No connected land route reaches this destination.');
    const seconds = Math.max(2, route.distance / marchSpeed(w, a, troops ?? available));
    // Every guard and route calculation succeeds before the existing army changes.
    a.raid_target_id = raidTargetId;
    a.raid_city_id=cmd.type==='raidCity'?cmd.targetCityId:null;
    a.siege_target=cmd.type==='raidCity'?cmd.siegeTarget??'auto':'auto';
    if (troops) {
        const leftBehind = addRosters(available, troops, -1);
        if (rosterTotal(leftBehind)) addStationGarrison(w, context.playerId, pos, leftBehind);
        writeRoster(a, troops);
    }
    a.march_origin = { ...stationCell(pos), ...pos }; a.march_returning = false; a.farm_list_id = null;
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
