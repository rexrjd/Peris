import type { World } from '../../../shared/model/world';
import type { Army } from './types';
import { factionOf, type Faction } from '../../factions/domain/factions';

/** Use an army's home, including when its ruler owns cities of several cultures. */
export function armyFaction(world: World, army: Pick<Army, 'home_settlement_id' | 'owner_id' | 'faction'> | undefined): Faction {
    const home = army && world.settlements.find(town => town.id === army.home_settlement_id);
    return factionOf(home?.faction ?? army?.faction ?? (army && world.map_plots?.find(plot => plot.settlement_id === army.home_settlement_id)?.faction) ?? (army && world.settlements.find(town => town.owner_id === army.owner_id)?.faction));
}
