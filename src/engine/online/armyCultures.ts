import type { World } from '../../shared/model/world';
import { isFaction, type Faction } from '../../features/factions/domain/factions';

export type PublicArmyHome = { id: number; owner_id: string; home_settlement_id: number };
export type PublicCityCulture = { id: number; faction: string };
export type CultureReader = {
    armies: (ids: number[]) => Promise<PublicArmyHome[]>;
    cities: (ids: number[]) => Promise<PublicCityCulture[]>;
};

/** Bounded cosmetic lookup for armies whose home is outside the map viewport.
 * Only army identity/home and city identity/faction are requested, never economy. */
export async function readArmyCultures(world: World, reader: CultureReader): Promise<Map<number, Faction>> {
    const active = world.battles.filter(battle => battle.status === 'active');
    const battleIds = active.flatMap(battle => [battle.attacker_army_id, battle.defender_army_id]).filter((id): id is number => id !== null);
    const ids = [...new Set([...battleIds, ...world.armies.map(army => army.id)])].slice(0, 600);
    const known = world.armies.filter(army => ids.includes(army.id));
    const missing = ids.filter(id => !known.some(army => army.id === id));
    const homes: PublicArmyHome[] = [...known, ...missing.length ? await reader.armies(missing) : []];
    const cities = await reader.cities([...new Set(homes.map(army => army.home_settlement_id))]);
    const factions = new Map(cities.filter(city => isFaction(city.faction)).map(city => [city.id, city.faction as Faction]));
    return new Map(homes.filter(home => factions.has(home.home_settlement_id)).map(home => [home.id, factions.get(home.home_settlement_id)!]));
}
