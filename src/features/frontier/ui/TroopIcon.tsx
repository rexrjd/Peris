import type { Faction } from '../../factions/domain/factions';
import { FRONTIER_UNITS, type FrontierUnitType } from '../domain/units';
import { factionTroopName } from './roster';

// All eleven existing faction atlases share this nine-cell layout. One cached
// sheet serves small icons and large portraits without duplicating artwork.
const cells = ['line_infantry', 'spear_guard', 'archer', 'elite', 'scout', 'light_cavalry', 'heavy_cavalry', 'ram', 'catapult'];
export function TroopIcon({ faction, unit, portrait = false }: { faction: Faction; unit: FrontierUnitType; portrait?: boolean }) {
    const cell = cells.indexOf(FRONTIER_UNITS[unit].role), name = factionTroopName(faction, unit);
    const rule = FRONTIER_UNITS[unit];
    const help = `${name} · ${rule.building}\nBase carry: ${rule.carry} resources per survivor. ${rule.carry === 0 ? 'Siege units carry no loot.' : 'The slowest unit determines the party’s travel time.'}\nRecruit cost: ${rule.cost.wood} wood, ${rule.cost.stone} stone, ${rule.cost.food} food, ${rule.cost.gold} gold.\n${rule.researchSeconds ? 'Research required once before recruitment.' : 'Available without research.'}`;
    return <span className={`fw-troop-icon${portrait ? ' fw-troop-portrait' : ''}`} role="img" aria-label={name} title={help} style={{ backgroundImage: `url(/art/battle/roster/${faction}.png)`, backgroundPosition: `${cell % 3 * 50}% ${Math.floor(cell / 3) * 50}%` }} />;
}
