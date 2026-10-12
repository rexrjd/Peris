import type { Faction } from '../../factions/domain/factions';
import { rallyFactionArt } from './rallyFactionTheme';

const prepared = new Map<Faction, Promise<void>>();

/** Decode border and material images before applying a different appearance. */
export function prepareRallyFactionArt(faction: Faction): Promise<void> {
    const existing = prepared.get(faction);
    if (existing) return existing;
    const pending = Promise.all((['background', 'frame', 'texture'] as const).map(material => new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            if (typeof image.decode === 'function') void image.decode().then(resolve, reject);
            else resolve();
        };
        image.onerror = () => reject(new Error('Could not load the Rally Point appearance.'));
        image.src = rallyFactionArt(faction, material);
    }))).then(() => undefined).catch(error => {
        prepared.delete(faction);
        throw error;
    });
    prepared.set(faction, pending);
    return pending;
}
