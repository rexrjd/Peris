import type { World } from '../../../shared/model/world';
import type { ArmyTroops } from '../../army/domain/types';
import { addRosters, emptyRoster, readRoster, RECRUIT_RULES, RECRUIT_UNITS, rosterTotal, validateRoster, writeRoster } from '../../army/domain/roster';
import { homeArmyPosition } from '../../map/domain/garrisons';
import { findMarchPath } from '../../map/domain/pathfinding';
import { wrappedWorldDelta } from '../../map/domain/dimensions';
import type { Command, LocalCommandContext } from '../../../shared/model/commands';
import { cityGarrisonAt, type CityGarrison } from './cityGarrison';

/** Commanded garrison transports, not armies or free commanders. Travel and
 * delivery are advanced by the authoritative tick, even with no clients. */
export type CityReinforcement = {
    id: number; owner_id: string; source_settlement_id: number; target_settlement_id: number;
    troops: ArmyTroops; march_path: [number, number][];
    departure_at: string; arrival_at: string;
};

export function reinforcementSpeed(troops: ArmyTroops) {
    const pace = Math.min(...RECRUIT_UNITS.filter(unit => (troops[unit] ?? 0) > 0).map(unit => RECRUIT_RULES[unit].speed));
    return 22 * (Number.isFinite(pace) ? pace : RECRUIT_RULES.infantry.speed) / RECRUIT_RULES.infantry.speed;
}
export function cityReinforcementRoute(world: World, sourceId: number, targetId: number) {
    const source = world.settlements.find(city => city.id === sourceId && !city.ruined_at);
    const target = world.settlements.find(city => city.id === targetId && !city.ruined_at && city.owner_id === source?.owner_id);
    if (!source || !target || source.id === target.id) return null;
    return findMarchPath(homeArmyPosition(source), homeArmyPosition(target));
}

export function sendCityReinforcements(context: LocalCommandContext, cmd: Extract<Command, { type: 'reinforceCity' }>) {
    const world = context.world, owner = context.playerId;
    const source = world.settlements.find(city => city.id === cmd.settlementId && city.owner_id === owner && !city.ruined_at);
    const target = world.settlements.find(city => city.id === cmd.targetCityId && city.owner_id === owner && !city.ruined_at);
    if (!source || !target || source.id === target.id) throw new Error('Select two different living cities you own.');
    if (world.players.find(player => player.id === owner)?.defeated_at) throw new Error('This ruler has been defeated.');
    if (world.battles.some(battle => battle.status === 'active' && (battle.attacker_owner_id === owner || battle.defender_owner_id === owner))) throw new Error('Finish the current battle first.');
    if (!validateRoster(cmd.troops, 1000, false)) throw new Error('Select 1 to 1,000 whole soldiers to reinforce.');
    const selected = readRoster(cmd.troops);
    const garrison = cityGarrisonAt(world, source.id, owner);
    if (!garrison) throw new Error('There are no permanent garrison soldiers to dispatch.');
    const current = readRoster(garrison);
    if (RECRUIT_UNITS.some(unit => selected[unit] > current[unit])) throw new Error('Select soldiers present in the source garrison.');
    const route = cityReinforcementRoute(world, source.id, target.id);
    if (!route || route.path.length < 2) throw new Error('There is no connected land route between these cities.');
    if (cmd.route && JSON.stringify(cmd.route) !== JSON.stringify(route.path)) throw new Error('The route has changed; review the reinforcement order.');
    const next = addRosters(current, selected, -1);
    // All guards succeed before the irreversible troop debit.
    writeRoster(garrison, next);
    if (!rosterTotal(next)) world.city_garrisons = world.city_garrisons?.filter(row => row !== garrison);
    (world.city_reinforcements ??= []).push({
        id: context.nextId(), owner_id: owner, source_settlement_id: source.id, target_settlement_id: target.id,
        troops: selected, march_path: route.path,
        departure_at: context.now,
        arrival_at: new Date(Date.parse(context.now) + Math.max(2, route.distance / reinforcementSpeed(selected)) * 1000).toISOString(),
    });
}

/** One-time delivery. A destroyed destination triggers a second real march to a
 * reachable city, not an instant transfer or a loss/duplication of the party. */
export function settleCityReinforcements(world: World, owner: string, now: number) {
    for (const party of [...(world.city_reinforcements ?? [])].filter(p => p.owner_id === owner && Date.parse(p.arrival_at) <= now)) {
        const destination = world.settlements.find(city => city.id === party.target_settlement_id && city.owner_id === owner && !city.ruined_at);
        if (!destination) {
            const ruined = world.settlements.find(city => city.id === party.target_settlement_id);
            const from = ruined && homeArmyPosition(ruined);
            const alternative = from && world.settlements.filter(city => city.owner_id === owner && !city.ruined_at).map(city => ({
                city, route: findMarchPath(from, homeArmyPosition(city)),
            })).filter(entry => entry.route !== null).sort((a, b) => {
                const da = Math.hypot(wrappedWorldDelta(from.x, a.city.x), wrappedWorldDelta(from.y, a.city.y));
                const db = Math.hypot(wrappedWorldDelta(from.x, b.city.x), wrappedWorldDelta(from.y, b.city.y));
                return da - db || a.city.id - b.city.id;
            })[0];
            if (alternative?.route) {
                party.target_settlement_id = alternative.city.id;
                party.march_path = alternative.route.path;
                party.departure_at = new Date(now).toISOString();
                party.arrival_at = new Date(now + Math.max(2, alternative.route.distance / reinforcementSpeed(party.troops)) * 1000).toISOString();
                continue;
            }
        } else {
            const garrison = cityGarrisonAt(world, destination.id, owner);
            if (garrison) writeRoster(garrison, addRosters(readRoster(garrison), party.troops));
            else {
                const fresh: CityGarrison = { owner_id: owner, settlement_id: destination.id, ...emptyRoster() };
                writeRoster(fresh, party.troops);
                (world.city_garrisons ??= []).push(fresh);
            }
        }
        world.city_reinforcements = world.city_reinforcements?.filter(p => p !== party);
    }
}
