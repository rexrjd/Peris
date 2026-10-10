import { factionOf, type Faction } from '../../factions/domain/factions';
import type { HeroClass } from './heroes';

export const PORTRAITS_PER_FACTION = 20;
/** Identity follows the saved hero ID; renaming, levelling and reloading keep the same face. */
export function heroPortraitIndex(heroId?: number, heroClass: HeroClass = 'knight') {
    const preview = heroClass === 'ranger' ? 6 : heroClass === 'mage' ? 12 : 0;
    return heroId === undefined || !Number.isSafeInteger(heroId) ? preview : Math.abs(heroId) % PORTRAITS_PER_FACTION;
}
export function heroPortraitUrl(faction?: Faction, heroClass?: HeroClass, heroId?: number) {
    const index = String(heroPortraitIndex(heroId, heroClass) + 1).padStart(2, '0');
    return `art/heroes/portraits/${factionOf(faction)}/${index}.webp`;
}
