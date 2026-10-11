import type { Faction } from '../../factions/domain/factions';
import type { BuildingType } from '../domain/types';
import type { SlotType } from '../domain/slots';

/** Only publish an atlas here after its style, alpha and twelve cells are reviewed. */
export const APPROVED_VILLAGE_ATLASES: readonly Faction[] = ['roman', 'spartan', 'persian', 'egyptian', 'orc', 'elf', 'dwarf', 'gnome', 'pandaren', 'undead', 'demon'];
/** Cell width / cell height, measured from the published atlas rather than the prompt. */
export const VILLAGE_ATLAS_ASPECTS: Partial<Record<Faction, number>> = Object.fromEntries(APPROVED_VILLAGE_ATLASES.map(faction => [faction, 1]));
export const VILLAGE_ATLAS_CELLS = ['market', 'lumber', 'quarry', 'farm', 'barracks', 'stables', 'smithy', 'warehouse', 'granary', 'fishery', 'mage_tower', 'housing'] as const;
const CULTURE_REVISIONS: Partial<Record<Faction, number>> = { spartan: 2, persian: 2, egyptian: 2 };

export function villageAtlasCell(type: BuildingType | SlotType) {
    const role = type === 'storehouse' ? 'granary' : type === 'workshop' ? 'smithy' : type;
    const index = VILLAGE_ATLAS_CELLS.findIndex(cell => cell === role);
    if (index < 0) return null;
    return {
        position: `${index % 3 * 50}% ${Math.floor(index / 3) * 100 / 3}%`,
        index,
    };
}

export function villageArtwork(type: BuildingType | SlotType, faction: Faction) {
    const cell = villageAtlasCell(type);
    if (!cell || !APPROVED_VILLAGE_ATLASES.includes(faction)) return null;
    const revision = CULTURE_REVISIONS[faction];
    return { url: `/art/city/village-v1/${faction}-atlas${revision ? `-v${revision}` : ''}.webp`, aspectRatio: VILLAGE_ATLAS_ASPECTS[faction] ?? 1, ...cell };
}

const loaded = new Map<string, Promise<boolean>>();
/** All plots in a village share one decoded atlas instead of separate images. */
export function loadVillageAtlas(url: string): Promise<boolean> {
    const existing = loaded.get(url);
    if (existing) return existing;
    const promise = new Promise<boolean>(resolve => {
        const image = new Image();
        image.onload = () => resolve(true);
        image.onerror = () => { loaded.delete(url); resolve(false); };
        image.src = url;
    });
    loaded.set(url, promise);
    return promise;
}
