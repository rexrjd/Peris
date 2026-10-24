import type { Faction } from '../../factions/domain/factions';
import { FRONTIER_UNITS, type FrontierUnitType } from '../domain/units';
import { factionTroopName } from './roster';
import {DiplomatPortrait} from '../../army/ui/diplomatPresentation';

// All eleven existing faction atlases share this nine-cell layout. One cached
// sheet serves small icons and large portraits without duplicating artwork.
const cells = ['line_infantry', 'spear_guard', 'archer', 'elite', 'scout', 'light_cavalry', 'heavy_cavalry', 'ram', 'catapult'];
export function TroopIcon({ faction, unit, portrait = false }: { faction: Faction; unit: FrontierUnitType; portrait?: boolean }) {
    const cell = cells.indexOf(FRONTIER_UNITS[unit].role), name = factionTroopName(faction, unit);
    const rule = FRONTIER_UNITS[unit];
    const help = `${name} · ${rule.building}\nBase carry: ${rule.carry} resources per survivor. ${unit==='diplomat'?'Surviving diplomats persuade a defeated enemy city, up to 25 loyalty per attack.':rule.carry === 0 ? 'Siege units carry no loot.' : 'Combat movement uses this unit’s speed; world travel follows the legion’s commander.'}\nRecruit cost: ${rule.cost.wood} wood, ${rule.cost.stone} stone, ${rule.cost.food} food, ${rule.cost.gold} gold.\n${rule.researchSeconds ? 'Research required once before recruitment.' : 'Available without research.'}`;
    if(unit==='diplomat')return <span className={`fw-troop-icon${portrait?' fw-troop-portrait':''}`} role="img" aria-label={name} title={help}><DiplomatPortrait faction={faction}/></span>;
    return <span className={`fw-troop-icon${portrait ? ' fw-troop-portrait' : ''}`} role="img" aria-label={name} title={help} style={{ backgroundImage: `url(/art/battle/roster/${faction}.png)`, backgroundPosition: `${cell % 3 * 50}% ${Math.floor(cell / 3) * 50}%` }} />;
}
