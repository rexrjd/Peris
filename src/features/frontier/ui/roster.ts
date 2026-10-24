import rosters from '../../../../assets/concepts/faction-sheets-v1/expanded-rosters.json';
import type { Faction } from '../../factions/domain/factions';
import { FRONTIER_UNITS, type FrontierUnitType } from '../domain/units';
import {DIPLOMAT_NAMES} from '../../army/ui/diplomatPresentation';

export function factionTroopName(faction: Faction, unit: FrontierUnitType): string {
    if(unit==='diplomat')return DIPLOMAT_NAMES[faction]??'Diplomat';
    const profile = rosters.roster.find(profile => profile.id === faction);
    return profile&&[...profile.troops, ...profile.siege].find(troop => troop.id === FRONTIER_UNITS[unit].role)?.name || unit;
}
