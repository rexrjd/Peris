import {factionOf, type Faction} from '../../factions/domain/factions';
import type { ArmyTroops } from '../domain/types';
import { RECRUIT_UNITS } from '../domain/roster';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { factionTroopName } from '../../frontier/ui/roster';
export function TroopSummary({troops,faction: suppliedFaction}:{troops:ArmyTroops;faction?:Faction|null}) {
 const faction = factionOf(suppliedFaction);
 return <span className="game-troop-summary">{RECRUIT_UNITS.filter(unit=>(troops[unit]??0)>0).map(unit=><span key={unit} title={`${troops[unit]} ${factionTroopName(faction,unit)}`}><TroopIcon unit={unit} faction={faction}/>{troops[unit]}</span>)}</span>;
}
