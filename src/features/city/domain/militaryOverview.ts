import type { World } from '../../../shared/model/world';
import { soldierTotal } from '../../army/domain/units';
import { RECRUIT_UNITS, emptyRoster, readRoster, rosterTotal, type UnitRoster } from '../../army/domain/roster';
import { armyFaction } from '../../army/domain/faction';
import { factionOf, type Faction } from '../../factions/domain/factions';
import { cityGarrisonAt } from './cityGarrison';
import { garrisonAt, stationCell } from '../../map/domain/garrisons';
import { armyPosition } from '../../map/domain/movement';

export function sameCityStation(a: { x: number; y: number }, b: { x: number; y: number }) {
    const first = stationCell(a), second = stationCell(b);
    return first.col === second.col && first.row === second.row;
}

/** Shared, read-only selection for both city presentations. Travelling troops are excluded. */
export function cityMilitaryOverview(world: World, sid: number, owner: string, now: number) {
    const town = world.settlements.find(s => s.id === sid)!, faction = factionOf(town.faction);
    const own = world.armies.filter(army => army.owner_id === owner);
    const activeBattle = new Set(world.battles.filter(battle => battle.status === 'active').flatMap(battle => [battle.attacker_army_id, battle.defender_army_id]));
    const stationed = own.filter(army => army.status === 'idle' && army.raid_target_id === null && !army.raid_reserve && !activeBattle.has(army.id) && sameCityStation(armyPosition(army, now), town));
    const pool = garrisonAt(world, owner, town), troopsByFaction = new Map<Faction, UnitRoster>();
    if (pool && soldierTotal(pool) > 0) troopsByFaction.set(faction, readRoster(pool));
    const cityDefenders = cityGarrisonAt(world, sid, owner);
    if (cityDefenders) {
        const current = troopsByFaction.get(faction) ?? emptyRoster(), defenders = readRoster(cityDefenders);
        for (const type of RECRUIT_UNITS) current[type] += defenders[type];
        troopsByFaction.set(faction, current);
    }
    for (const army of stationed) {
        const culture = armyFaction(world, army), troops = troopsByFaction.get(culture) ?? emptyRoster();
        for (const type of RECRUIT_UNITS) troops[type] += readRoster(army)[type];
        troopsByFaction.set(culture, troops);
    }
    if (!troopsByFaction.size) troopsByFaction.set(faction, emptyRoster());
    const totals = emptyRoster();
    for (const troops of troopsByFaction.values()) for (const type of RECRUIT_UNITS) totals[type] += troops[type];
    const legacyReserves = own.filter(army => army.raid_reserve && sameCityStation(army.march_origin ?? { x: army.start_x, y: army.start_y }, town));
    const reserved = legacyReserves.reduce((sum, army) => sum + rosterTotal(army.raid_reserve!), 0);
    const training = world.orders.filter(order => order.kind === 'recruit' && order.owner_id === owner && (order.settlement_id ?? world.settlements[0].id) === sid).sort((a, b) => Date.parse(a.finish_at) - Date.parse(b.finish_at));
    const movements = own.filter(army => army.status === 'moving' && (sameCityStation({ x: army.start_x, y: army.start_y }, town) || sameCityStation({ x: army.target_x, y: army.target_y }, town))).sort((a, b) => Date.parse(a.arrival_at) - Date.parse(b.arrival_at));
    return { town, own, stationed, pool, cityDefenders, troopsByFaction, totals, reserved, training, movements };
}
