/** Presentation metadata; geography never changes travel rules. */
export type SiteKind = 'crossroads' | 'grove' | 'watch' | 'citadel' | 'gate' | 'capital';
export const REALM_STORY = 'The Hollow Crown has fallen. Across the Silverrun, forest sanctuaries, mountain keeps and the ash-scarred frontier wait for a new sovereign.';
export const REGIONS = [
    { id: 'westfold', name: 'Westfold', subtitle: 'Fields of the old kingdom', color: '#c9ae6e', label: { x: 247, y: 551, angle: -.09 } },
    { id: 'oakwood', name: 'Oakwood', subtitle: 'The elder forest', color: '#789476', label: { x: 272, y: 115, angle: -.11 } },
    { id: 'crownspine', name: 'Crownspine', subtitle: 'Keeps above the clouds', color: '#a4adb0', label: { x: 917, y: 92, angle: .05 } },
    { id: 'river', name: 'Silverrun', subtitle: 'The contested crossings', color: '#76abb3', label: { x: 594, y: 629, angle: -1.45 } },
    { id: 'ashen', name: 'Ashen Marches', subtitle: 'Beyond the last watchfire', color: '#bc8665', label: { x: 962, y: 684, angle: -.04 } },
    { id: 'crown', name: 'Hollow Crown', subtitle: 'Where the first kings fell', color: '#af9d85', label: { x: 685, y: 354, angle: -.05 } },
] as const;
type RegionId = typeof REGIONS[number]['id'];
export interface AtlasSite { region: RegionId; title: string; kind: SiteKind; lore: string; significance: string }
export const SITES: Record<number, AtlasSite> = {
    1: { region: 'westfold', title: 'Old Crossroads', kind: 'crossroads', lore: 'Grain caravans once met beneath the bells of this roadside hold.', significance: 'A foothold in the fertile western fields.' },
    2: { region: 'oakwood', title: 'Oakwood Sanctuary', kind: 'grove', lore: 'An elder oak guards a sanctuary older than the fallen kingdom.', significance: 'A refuge deep within the forest realms.' },
    3: { region: 'river', title: 'Riverwatch', kind: 'watch', lore: 'Its lantern tower watches the stone bridge over the Silverrun.', significance: 'Command the crossing between the western and eastern realms.' },
    4: { region: 'crownspine', title: 'Crownspine Keep', kind: 'citadel', lore: 'The northern wardens raised this keep beneath the white peaks.', significance: 'An enduring stronghold of the mountain frontier.' },
    5: { region: 'ashen', title: 'Ashen Gate', kind: 'gate', lore: 'Twin towers stand where the king’s road disappears into red earth.', significance: 'The last defended passage into the Ashen Marches.' },
    6: { region: 'crown', title: 'Fallen Capital', kind: 'capital', lore: 'Broken arches and an empty throne mark the heart of the Hollow Crown.', significance: 'Reclaim the seat of the ancient kingdom.' },
};
export function silverrunX(y: number): number {
    // The old capital was built on the eastern bank. A localized westward bend
    // keeps its original gameplay coordinate dry; both bridge positions stay fixed.
    const bend = y > 255 && y < 325 ? Math.sin((y - 255) / 70 * Math.PI) ** 2 * 26 : 0;
    return 565 + Math.sin(y / 115) * 35 - bend;
}
export function siteFor(id: number): AtlasSite { return SITES[id] ?? SITES[1]; }
export function regionFor(id: number) { return REGIONS.find(region => region.id === siteFor(id).region) ?? REGIONS[0]; }
