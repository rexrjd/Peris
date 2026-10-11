import rosters from '../../../../assets/concepts/faction-sheets-v1/expanded-rosters.json';
import type { Faction } from '../../factions/domain/factions';
import { FRONTIER_UNITS, type FrontierUnitType } from '../domain/units';

export function factionTroopName(faction: Faction, unit: FrontierUnitType): string {
    const profile = rosters.roster.find(profile => profile.id === faction)!;
    return [...profile.troops, ...profile.siege].find(troop => troop.id === FRONTIER_UNITS[unit].role)!.name;
}
