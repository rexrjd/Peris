import type { ArmyRole } from '../rendering/three/armyAssets';

/** Staged local art review is opt-in and cannot fetch arbitrary model URLs. */
export type PilotRolePack = { name: string; roles: readonly ArmyRole[]; near: string; far: string };
export type PilotReview = { edition: string; name: string; near: string; far: string; credits: string; packs: readonly PilotRolePack[] };
const stagedRoot = '/artifacts/battle-preview/orc-quality-pilot-20261009/staged/';
export const PILOT_REVIEW_MANIFEST = stagedRoot + 'latest.json';
export function parsePilotReview(input: unknown): PilotReview {
    if (!input || typeof input !== 'object') throw new Error('Pilot staging record is missing');
    const record = input as Record<string, unknown>;
    if (typeof record.edition !== 'string') throw new Error('Pilot edition is invalid');
    const batch = /^orc-infantry-batch-v[1-9][0-9]*$/.test(record.edition);
    const full = /^orc-prototype-deadline-v[1-9][0-9]*$/.test(record.edition);
    if (!batch && !full && !/^orc-quality-pilot-v[1-9][0-9]*$/.test(record.edition)) throw new Error('Pilot edition is invalid');
    if (record.localDevelopmentOnly !== true || record.finishedUnitApproved !== false || record.battleRendererApproved !== false) throw new Error('Expected an explicit local work-in-progress Orc review');
    const roles: readonly ArmyRole[] = full ? ['line_infantry', 'spear_guard', 'archer', 'elite', 'scout', 'light_cavalry', 'heavy_cavalry', 'ram', 'catapult'] : batch ? ['spear_guard', 'elite', 'archer'] : ['line_infantry'];
    if (batch || full ? JSON.stringify(record.roles) !== JSON.stringify(roles) : record.role !== 'line_infantry') throw new Error('Pilot roles are invalid');
    const baselineRecord = record.baseline as Record<string, unknown> | undefined;
    if (batch && (!baselineRecord || typeof baselineRecord.edition !== 'string' || !/^orc-quality-pilot-v[1-9][0-9]*$/.test(baselineRecord.edition))) throw new Error('Expected a single accepted-baseline review');
    const baseline = batch ? parsePilotReview(baselineRecord) : undefined;
    const paths: string[] = [];
    for (const detail of ['near', 'far'] as const) {
        const pack = record[detail] as Record<string, unknown> | undefined;
        const expected = `${stagedRoot}${record.edition}/${full ? 'orc-roster' : batch ? 'orc-infantry' : 'orc-axe-warrior'}-${detail}.glb`;
        const maxBytes = (full ? detail === 'near' ? 32 : 20 : roles.length * (detail === 'near' ? 12 : 5)) * 1024 * 1024;
        if (!pack || pack.url !== expected || typeof pack.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pack.sha256) || typeof pack.bytes !== 'number' || !Number.isInteger(pack.bytes) || pack.bytes <= 0 || pack.bytes > maxBytes) throw new Error('Pilot pack path, fingerprint or budget is invalid');
        const completeParts = full ? pack.meshParts === 19 || pack.meshParts === 20 : pack.meshParts === roles.length * 2;
        if (!completeParts || !Array.isArray(pack.componentLicenses) || !pack.componentLicenses.includes('CC-BY-SA-3.0') || !pack.componentLicenses.includes('CC-BY-4.0') || !Array.isArray(pack.clips) || !roles.every(role => ['idle', 'walk', 'attack'].every(state => (pack.clips as unknown[]).includes(`${role}_${state}`)))) throw new Error('Pilot components or actions are incomplete');
        paths.push(expected);
    }
    const name = full ? 'Orc faction prototypes' : batch ? 'Orc infantry' : 'Orc Axe Warrior';
    return { edition: record.edition, name, near: baseline?.near ?? paths[0], far: baseline?.far ?? paths[1], credits: 'Body and rig: Wildfire Games; Peris adaptation and kit (CC BY-SA 3.0). Head: Crazyon520; Peris adaptation (CC BY 4.0).', packs: [...(baseline?.packs ?? []), { name, roles, near: paths[0], far: paths[1] }] };
}
