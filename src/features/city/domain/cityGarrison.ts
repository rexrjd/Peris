import type { World } from '../../../shared/model/world';
import type { ArmyTroops } from '../../army/domain/types';
import { addRosters, emptyRoster, readRoster, rosterTotal, validateRoster, writeRoster } from '../../army/domain/roster';
import { armyPosition } from '../../map/domain/movement';
import { stationCell } from '../../map/domain/garrisons';
import type { LocalCommandContext, Command } from '../../../shared/model/commands';

/** Permanent city defenders are deliberately distinct from temporary station pools.
 * Returning legions may collect station pools automatically; they never collect these. */
export type CityGarrison = ArmyTroops & {
    owner_id: string;
    settlement_id: number;
    unit_roster?: ArmyTroops | null;
};

/** A wall is a passive battle modifier, not a gate or tactical obstacle. */
export function wallDefenseBonus(level: number) {
    return Math.min(0.5, Math.max(0, Math.min(5, Number.isFinite(level) ? Math.floor(level) : 0) * 0.1));
}
export function cityGarrisonAt(world: World, cityId: number, owner: string) {
    return world.city_garrisons?.find(g => g.settlement_id === cityId && g.owner_id === owner);
}

/** Transfer *real* units between an idle legion and the city's persistent defence.
 * Both online RPC and solo commands use the same ownership, position and capacity rules. */
export function manageCityGarrison(context: LocalCommandContext, cmd: Extract<Command, { type: 'manageCityGarrison' }>) {
    const world = context.world, owner = context.playerId;
    const city = world.settlements.find(row => row.id === cmd.settlementId && row.owner_id === owner && !row.ruined_at);
    const army = world.armies.find(row => row.id === cmd.armyId && row.owner_id === owner);
    if (!city || !army) throw new Error('Choose your city and an owned legion.');
    const cell = stationCell(city), position = stationCell(armyPosition(army, Date.parse(context.now)));
    if (cell.col !== position.col || cell.row !== position.row || army.status !== 'idle' || army.raid_target_id != null || army.raid_city_id != null || army.raid_reserve) {
        throw new Error('Bring an idle legion into this city before transferring defenders.');
    }
    if (world.battles.some(b => b.status === 'active' && (b.attacker_owner_id === owner || b.defender_owner_id === owner))) throw new Error('Finish the current battle first.');
    if (world.orders.some(o => o.kind === 'recruit' && o.owner_id === owner && (o.army_id ?? world.armies.find(a => a.owner_id === owner)?.id) === army.id)) {
        throw new Error('Finish this legion\'s recruitment before transferring defenders.');
    }
    if (cmd.action !== 'station' && cmd.action !== 'withdraw') throw new Error('Choose a valid garrison action.');
    if (!validateRoster(cmd.troops, 1000, false)) throw new Error('Choose 1 to 1,000 whole soldiers.');
    const selected = readRoster(cmd.troops), legion = readRoster(army);
    const garrison = cityGarrisonAt(world, city.id, owner);
    const stationed = garrison ? readRoster(garrison) : emptyRoster();
    const source = cmd.action === 'station' ? legion : stationed;
    for (const unit of Object.keys(selected) as (keyof typeof selected)[]) {
        if (selected[unit] > source[unit]) throw new Error('Choose troops actually available in this location.');
    }
    if (cmd.action === 'withdraw' && rosterTotal(legion) + rosterTotal(selected) > 1000) {
        throw new Error('A legion cannot carry more than 1,000 soldiers.');
    }
    // Validate everything before mutating either troop store.
    if (cmd.action === 'station') {
        if (garrison) writeRoster(garrison, addRosters(stationed, selected));
        else {
            const fresh: CityGarrison = { owner_id: owner, settlement_id: city.id, infantry: 0, archers: 0, cavalry: 0 };
            writeRoster(fresh, selected);
            (world.city_garrisons ??= []).push(fresh);
        }
        writeRoster(army, addRosters(legion, selected, -1));
    } else {
        if (!garrison) throw new Error('No defenders are stationed in this city.');
        writeRoster(garrison, addRosters(stationed, selected, -1));
        writeRoster(army, addRosters(legion, selected));
        if (!rosterTotal(readRoster(garrison))) world.city_garrisons = world.city_garrisons?.filter(row => row !== garrison);
    }
    army.updated_at = context.now;
}
