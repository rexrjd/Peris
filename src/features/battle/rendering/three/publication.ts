import type { Faction } from '../../../factions/domain/factions';

type Publication = { withheld?: Record<string, unknown>; factions: Record<string, { near?: { sha256?: string }; far?: { sha256?: string } }> };
let publication: Promise<Publication> | undefined;
/** Both strategic and tactical views load the same reviewed, cache-versioned packs. */
export async function publishedArmyUrl(faction: Faction, detail: 'near' | 'far'): Promise<string> {
    if (!publication) publication = fetch('/models/battle/faction-rosters.json', { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error('Unit publication manifest unavailable');
        return response.json() as Promise<Publication>;
    }).catch(error => { publication = undefined; throw error; });
    const report = await publication;
    const pack = report.factions[faction];
    if (report.withheld?.[faction] || !pack?.near || !pack.far) throw new Error(`${faction} units await publication`);
    const fingerprint = pack[detail]?.sha256;
    if (!fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error(`Invalid ${faction} unit publication`);
    return `/models/battle/${faction}-roster${detail === 'far' ? '-lod' : ''}.glb?v=${fingerprint}`;
}
