import type { World } from '../../../shared/model/world';
import type { Settlement } from '../../city/domain/types';
import type { Faction } from '../../factions/domain/factions';
import type { Army } from './types';
import { addRosters, emptyRoster, readRoster, type UnitRoster } from './roster';
import { CELL_SIZE, wrapWorldCell, wrapWorldPoint } from '../../map/domain/dimensions';
import { armyPosition } from '../../map/domain/movement';
import { canCancelMarch, MARCH_CANCEL_MS } from '../../map/domain/commands';

export type RallyPlace = {
    kind: 'village' | 'field' | 'camp';
    name: string;
    col: number;
    row: number;
    point: { x: number; y: number };
    cityId?: number;
    campId?: number;
};
export type RallyStationLegion = { armyId: number; name: string; troops: UnitRoster; faction?: Faction };
export type RallyStation = RallyPlace & {
    kind: 'village' | 'field';
    troops: UnitRoster;
    legions: RallyStationLegion[];
    garrison: UnitRoster;
};
export type RallyMovement = {
    armyId: number;
    armyName: string;
    homeCityId: number;
    kind: 'raid' | 'march' | 'return' | 'scouting';
    missionId?: number; scoutReturning?: boolean;
    scoutCancel?: {missionId:number;sentAt:string;until:number};
    from: RallyPlace;
    to: RallyPlace;
    troops: UnitRoster;
    startedAt: number | null;
    endsAt: number | null;
    cancel?: { armyId: number; sentAt: string; until: number };
    selection: { kind: 'army'; id: number };
    point: { x: number; y: number };
};
export type RallyPointState = {
    city: Settlement | null;
    stations: RallyStation[];
    stationedTroops: UnitRoster;
    incoming: RallyMovement[];
    outgoing: RallyMovement[];
};

const timestamp = (value?: string | null) => {
    const result = value ? Date.parse(value) : NaN;
    return Number.isFinite(result) ? result : null;
};
const cellAt = (point: { x: number; y: number }) => {
    const wrapped = wrapWorldPoint(point);
    return wrapWorldCell(Math.floor(wrapped.x / CELL_SIZE), Math.floor(wrapped.y / CELL_SIZE));
};
const key = (cell: { col: number; row: number }) => {
    const wrapped = wrapWorldCell(cell.col, cell.row);
    return wrapped.col + ',' + wrapped.row;
};
const fieldName = (cell: { col: number; row: number }) => 'Field (' + cell.col + ' | ' + cell.row + ')';

/** Names and coordinates are public; troop values are read only from owned rows. */
function place(world: World, point: { x: number; y: number }): RallyPlace {
    const wrapped = wrapWorldPoint(point), cell = cellAt(wrapped), fieldKey = key(cell);
    const village = world.settlements.find(row => key(cellAt(row)) === fieldKey);
    if (village) return { kind: 'village', name: village.name, cityId: village.id, ...cell, point: wrapped };
    const camp = world.camps.find(row => key(cellAt(row)) === fieldKey);
    if (camp) return { kind: 'camp', name: camp.name, campId: camp.id, ...cell, point: wrapped };
    const plot = world.map_plots?.find(row => key(row) === fieldKey);
    return { kind: 'field', name: fieldName(cell), ...(plot ? { cityId: plot.settlement_id } : {}), ...cell, point: wrapped };
}

function movement(world: World, army: Army, now: number): RallyMovement {
    const returning = !!army.march_returning;
    const origin = !returning && army.march_origin ? army.march_origin : { x: army.start_x, y: army.start_y };
    const destination = { x: army.target_x, y: army.target_y };
    const from = place(world, origin), to = place(world, destination);
    const camp = !returning && army.raid_target_id !== null ? world.camps.find(row => row.id === army.raid_target_id) : undefined;
    const sentAt = timestamp(army.march_sent_at), storedUntil = timestamp(army.march_cancel_until);
    const until = sentAt !== null && storedUntil !== null ? Math.min(storedUntil, sentAt + MARCH_CANCEL_MS) : null;
    const cancellable = !returning && canCancelMarch(army, now) && until !== null && now < until;
    const startedAt = timestamp(army.departure_at), endsAt = timestamp(army.arrival_at);
    return {
        armyId: army.id, armyName: army.name, homeCityId: army.home_settlement_id,
        kind: returning ? 'return' : army.raid_target_id !== null||army.raid_city_id!=null ? 'raid' : 'march',
        from, to: camp ? { ...to, kind: 'camp', name: camp.name, campId: camp.id } : to,
        troops: readRoster(army), startedAt, endsAt,
        ...(cancellable ? { cancel: { armyId: army.id, sentAt: army.march_sent_at!, until: until! } } : {}),
        selection: { kind: 'army', id: army.id },
        point: startedAt !== null && endsAt !== null ? wrapWorldPoint(armyPosition(army, now)) : wrapWorldPoint(origin),
    };
}

/** A city's Rally Point follows the real station, even after a legion changes home.
 * Moving rows remain visible past their deadline until authoritative settlement.
 * Rival snapshots never establish incoming attacks or private stationed troops. */
export function rallyPointState(world: World, owner: string, cityId: number, now: number): RallyPointState {
    const city = world.settlements.find(row => row.id === cityId && row.owner_id === owner) ?? null;
    const result: RallyPointState = { city, stations: [], stationedTroops: emptyRoster(), incoming: [], outgoing: [] };
    if (!city) return result;

    const villageCell = cellAt(city), stations = new Map<string, RallyStation>();
    stations.set(key(villageCell), { kind: 'village', name: city.name, cityId: city.id, ...villageCell,
        point: wrapWorldPoint(city), troops: emptyRoster(), legions: [], garrison: emptyRoster() });
    for (const plot of world.map_plots ?? []) {
        if (plot.owner_id !== owner || plot.settlement_id !== city.id || stations.has(key(plot))) continue;
        const cell = wrapWorldCell(plot.col, plot.row);
        stations.set(key(cell), { kind: 'field', name: fieldName(cell), cityId: city.id, ...cell,
            point: { x: (cell.col + .5) * CELL_SIZE, y: (cell.row + .5) * CELL_SIZE },
            troops: emptyRoster(), legions: [], garrison: emptyRoster() });
    }
    const fighting = new Set(world.battles.filter(battle => battle.status === 'active')
        .flatMap(battle => [battle.attacker_army_id, battle.defender_army_id]));
    for(const mission of world.scouting_missions??[]){
        if(mission.owner_id!==owner||!['outbound','returning'].includes(mission.status))continue;
        const returning=mission.status==='returning',first=mission.march_path[0],last=mission.march_path.at(-1);
        const from=place(world,first?{x:first[0],y:first[1]}:{x:mission.origin_x,y:mission.origin_y}),to=place(world,last?{x:last[0],y:last[1]}:{x:mission.target_x,y:mission.target_y});
        const sent=timestamp(mission.sent_at),stored=timestamp(mission.cancel_until),departure=timestamp(mission.departure_at);
        const until=sent!==null&&stored!==null&&departure!==null?Math.min(stored,sent+30000*(world.game_clock?.rate??1),departure):null;
        const event:RallyMovement={armyId:mission.source_army_id,armyName:mission.scouts.toLocaleString()+' scouts',homeCityId:mission.source_settlement_id,kind:'scouting',missionId:mission.id,scoutReturning:returning,
            from,to:!returning?{...to,name:mission.target_name}:to,troops:{...emptyRoster(),scout:mission.scouts},startedAt:departure,endsAt:timestamp(mission.arrival_at),selection:{kind:'army',id:mission.source_army_id},point:to.point,
            ...(!returning&&sent!==null&&until!==null&&now>=sent&&now<until?{scoutCancel:{missionId:mission.id,sentAt:mission.sent_at,until}}:{})};
        if(!returning&&stations.has(key(event.from)))result.outgoing.push(event);
        if(returning&&stations.has(key(event.to)))result.incoming.push(event);
    }
    for (const army of world.armies) {
        if (army.owner_id !== owner || fighting.has(army.id)) continue;
        if (army.status === 'idle') {
            const station = stations.get(key(cellAt(armyPosition(army, now))));
            if (!station) continue;
            const troops = readRoster(army);
            station.legions.push({ armyId: army.id, name: army.name, troops, faction: army.faction });
            station.troops = addRosters(station.troops, troops);
        } else if (army.status === 'moving') {
            const event = movement(world, army, now);
            if (!army.march_returning && stations.has(key(event.from))) result.outgoing.push(event);
            if (stations.has(key(event.to))) result.incoming.push(event);
        }
    }
    for (const row of world.garrisons ?? []) {
        if (row.owner_id !== owner) continue;
        const station = stations.get(key(row));
        if (!station) continue;
        const troops = readRoster(row);
        station.garrison = addRosters(station.garrison, troops);
        station.troops = addRosters(station.troops, troops);
    }
    result.stations = [...stations.values()];
    result.stationedTroops = result.stations.reduce((troops, station) => addRosters(troops, station.troops), emptyRoster());
    const arrivals = (a: RallyMovement, b: RallyMovement) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity) || a.armyId - b.armyId;
    result.incoming.sort(arrivals); result.outgoing.sort(arrivals);
    return result;
}
