import type { World } from '../../../shared/model/world';
import type { ArmyTroops } from '../../army/domain/types';
import type { Army } from '../../army/domain/types';
import { readRoster, writeRoster, emptyRoster } from '../../army/domain/roster';
import { homeArmyPosition, stationCell, addStationGarrison, ownedStation } from '../../map/domain/garrisons';
import { armyPosition } from '../../map/domain/movement';
import { findMarchPath } from '../../map/domain/pathfinding';
import { wrappedWorldDelta } from '../../map/domain/dimensions';

export type RuinEvacuation = {
    id: number; owner_id: string; origin_settlement_id: number; target_settlement_id: number;
    troops: ArmyTroops; departure_at: string; arrival_at: string;
};
export const livingCities = (world: World, owner: string) => world.settlements.filter(city => city.owner_id === owner && !city.ruined_at);
export const isDefeated = (world: World, owner: string) => !!world.players.find(player => player.id === owner)?.defeated_at;
export function isRuin(world: World, cityId: number) { return !!world.settlements.find(city => city.id === cityId)?.ruined_at; }

const distance = (from: {x:number;y:number}, to: {x:number;y:number}) => Math.hypot(wrappedWorldDelta(from.x, to.x), wrappedWorldDelta(from.y, to.y));
function nearestReachable(world: World, owner: string, start: {x:number;y:number}) {
    return livingCities(world, owner)
        .map(city => ({ city, target: homeArmyPosition(city) }))
        .sort((a,b) => distance(start,a.city) - distance(start,b.city) || a.city.id-b.city.id)
        .map(entry => ({ ...entry, route: findMarchPath(start, entry.target) }))
        .find(entry => entry.route !== null);
}
function disband(army: Army, now: number) {
    writeRoster(army, emptyRoster());
    army.raid_target_id = null; army.raid_city_id = null; army.raid_reserve = null;
    army.status = 'idle'; army.march_path = null; army.march_distance = null;
    army.march_origin = null; army.march_returning = false;
    army.march_sent_at = null; army.march_cancel_until = null;
    army.carried_loot = null; army.updated_at = new Date(now).toISOString();
}
/** Retreat the existing legion. No new hero or army ID is created. */
export function redirectFromLostStation(world: World, army: Army, now: number) {
    const owner = army.owner_id;
    if (isDefeated(world, owner)) { disband(army, now); return false; }
    // Raid outbound journeys are still allowed to resolve. Their return path is
    // checked in startRaidReturn; changing their target would fake a siege win.
    if (army.raid_target_id != null || army.raid_city_id != null) return false;
    if (army.status === 'moving' && ownedStation(world, owner, {x:army.target_x,y:army.target_y})) return false;
    if (army.status === 'idle' && ownedStation(world, owner, armyPosition(army, now))) return false;
    const origin = armyPosition(army, now), destination = nearestReachable(world, owner, origin);
    if (!destination) { disband(army, now); return false; }
    const {route,target,city}=destination;
    const timestamp=new Date(now).toISOString();
    army.home_settlement_id=city.id;
    army.start_x=origin.x; army.start_y=origin.y;
    army.target_x=target.x; army.target_y=target.y;
    army.march_path=route!.path; army.march_distance=route!.distance;
    army.status='moving'; army.raid_target_id=null; army.raid_city_id=null;
    army.march_origin=null; army.march_returning=true;
    army.march_sent_at=null; army.march_cancel_until=null;
    army.departure_at=timestamp;
    army.arrival_at=new Date(now+Math.max(2, route!.distance/22)*1000).toISOString();
    army.updated_at=timestamp;
    return true;
}

/** Advance evacuees without assigning their soldiers a free commander. */
export function settleRuinEvacuations(world: World, owner: string, now: number) {
    const transports=world.ruin_evacuations ?? [];
    for(const entry of transports.filter(item=>item.owner_id===owner&&Date.parse(item.arrival_at)<=now)) {
        const destination=world.settlements.find(city=>city.id===entry.target_settlement_id&&!city.ruined_at);
        if (destination) addStationGarrison(world, owner, destination, entry.troops);
        else {
            const previous=world.settlements.find(city=>city.id===entry.origin_settlement_id);
            const start=previous ?? {x:0,y:0};
            const alternate=nearestReachable(world,owner,start);
            if(alternate) {
                entry.target_settlement_id=alternate.city.id;
                entry.departure_at=new Date(now).toISOString();
                entry.arrival_at=new Date(now+Math.max(2,alternate.route!.distance/22)*1000).toISOString();
                continue;
            }
        }
        world.ruin_evacuations=world.ruin_evacuations?.filter(item=>item!==entry);
    }
}

/** Permanent once-only state change, after a victorious siege. Resource fields do
 * not have to be individually destroyed: all abandoned holdings are forfeited. */
export function ruinCity(world: World, cityId: number, now = Date.now()): boolean {
    const city=world.settlements.find(row=>row.id===cityId);
    if(!city||city.ruined_at) return false;
    if(world.buildings.some(row=>row.settlement_id===cityId&&row.level>0)||
       world.city_slots?.some(row=>row.settlement_id===cityId&&row.level>0)) return false;
    const stamp=new Date(now).toISOString(), owner=city.owner_id;
    const lostFields=(world.map_plots??[]).filter(field=>field.settlement_id===cityId);
    const affected=new Set(lostFields.map(field=>`${field.col}:${field.row}`));
    const place=stationCell(city); affected.add(`${place.col}:${place.row}`);
    city.ruined_at=stamp;
    city.wood=city.stone=city.food=city.gold=0;
    city.wood_rate=city.stone_rate=city.food_rate=city.gold_rate=0;
    city.settlers=0; city.population=0;
    world.map_plots=world.map_plots?.filter(field=>field.settlement_id!==cityId);
    world.orders=world.orders.filter(order=>order.settlement_id!==cityId);
    world.settler_expeditions=world.settler_expeditions?.filter(entry=>entry.origin_settlement_id!==cityId||entry.status!=='travelling');
    world.unit_research=world.unit_research?.filter(item=>item.settlement_id!==cityId);
    world.spell_research=world.spell_research?.filter(item=>item.settlement_id!==cityId);
    const garrisons=(world.garrisons??[]).filter(g=>g.owner_id===owner&&affected.has(`${g.col}:${g.row}`));
    world.garrisons=world.garrisons?.filter(g=>!garrisons.includes(g));
    for(const garrison of garrisons) {
        const source={x:garrison.col*128+64,y:garrison.row*128+64};
        const target=nearestReachable(world,owner,source);
        if(!target) continue;
        (world.ruin_evacuations??=[]).push({
            id:Math.max(0,...(world.ruin_evacuations??[]).map(entry=>entry.id))+1,
            owner_id:owner, origin_settlement_id:cityId,target_settlement_id:target.city.id,
            troops:readRoster(garrison),departure_at:stamp,
            arrival_at:new Date(now+Math.max(2,target.route!.distance/22)*1000).toISOString(),
        });
    }
    // Every existing legion whose home has fallen must adopt a living home,
    // whether it is stationed here or currently campaigning elsewhere.
    for(const army of world.armies.filter(a=>a.owner_id===owner)) {
        if(army.home_settlement_id===cityId) {
            const target=nearestReachable(world,owner,armyPosition(army,now));
            if(target) army.home_settlement_id=target.city.id;
        }
        if(affected.has(`${stationCell(armyPosition(army,now)).col}:${stationCell(armyPosition(army,now)).row}`)
          ||affected.has(`${stationCell({x:army.target_x,y:army.target_y}).col}:${stationCell({x:army.target_x,y:army.target_y}).row}`))
            redirectFromLostStation(world,army,now);
    }
    if (!livingCities(world,owner).length) {
        const player=world.players.find(p=>p.id===owner);
        if(player) player.defeated_at??=stamp;
        world.orders=world.orders.filter(order=>order.owner_id!==owner);
        world.garrisons=world.garrisons?.filter(row=>row.owner_id!==owner);
        world.ruin_evacuations=world.ruin_evacuations?.filter(row=>row.owner_id!==owner);
        for(const army of world.armies.filter(row=>row.owner_id===owner)) disband(army,now);
    }
    return true;
}
