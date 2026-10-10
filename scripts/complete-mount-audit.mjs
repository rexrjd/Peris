// Complete observed export metadata without changing any geometry or animation.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
const edition = 'mount-metadata-audit-v1';
const output = `assets/source/battle/${edition}`;
const reportPath = 'public/models/battle/faction-rosters.json';
const manifestPath = 'assets/manifest.json';
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (existsSync(`${output}/completion.json`)) throw new Error('Preserve the completed audit edition');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hip = [-0.8020753135792554, -0.000024883576231926607, 6.183496217044585];
const oldTarget = [-0.8020753860473633, -0.00002524895899114199, 7.626467704772949];
const rootDelta = 4.594415807723999 - 6.037387371063232;
const target = [oldTarget[0], oldTarget[1], oldTarget[2] + rootDelta];
const error = Math.hypot(...hip.map((value, index) => value - target[index]));
if (!Number.isFinite(error) || error > .005) throw new Error('Independent measured scout fitting failed');
const sources = {
    elf: 'assets/source/battle/elf-portrait-quality-full-v13/exports/elf-roster.glb',
    gnome: 'assets/source/battle/gnome-portrait-roster-v20/exports/gnome-roster-runtime.glb',
};
const pending = [];
function complete(file, faction) {
    const bytes = readFileSync(file), chunks = [];
    if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid source');
    for (let offset = 12; offset < bytes.length;) {
        const size = bytes.readUInt32LE(offset), kind = bytes.readUInt32LE(offset + 4);
        chunks.push({ kind, data: bytes.subarray(offset + 8, offset + 8 + size) }); offset += 8 + size;
    }
    const gltf = JSON.parse(chunks[0].data.toString('utf8')), before = structuredClone(gltf);
    let changed = 0;
    for (const node of gltf.nodes) {
        if (faction === 'elf' && node.extras?.peris_role === 'scout' && /mounted_rider|licensed_elf_head|reference_archer_anatomy_rig/.test(node.name)) {
            Object.assign(node.extras, { peris_seat_hip_world: hip, peris_seat_target_world: target, peris_seat_fit_error: error,
                peris_seat_reference: 'Actual final idle pelvis, independently compared with the measured V8 animal-back target transformed by the recorded V10 root-floor correction.' });
            changed++;
        }
        if (faction === 'gnome' && node.extras?.peris_role === 'heavy_cavalry' && node.mesh !== undefined && node.skin !== undefined) {
            const horse = gltf.skins[node.skin].joints.some(index => /Horse_(Spine|Hoof|Hand|Foot)/.test(gltf.nodes[index].name));
            if (horse) { node.extras.peris_mount_species = 'armored pony; licensed horse anatomy derivative'; changed++; }
        }
    }
    if (!changed) throw new Error(`No genuine ${faction} audit targets`);
    const stripped = structuredClone(gltf);
    for (let index = 0; index < stripped.nodes.length; index++) stripped.nodes[index].extras = before.nodes[index].extras;
    if (JSON.stringify(stripped) !== JSON.stringify(before)) throw new Error('Audit changed more than node extras');
    const json = Buffer.from(JSON.stringify(gltf)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
    const parts = chunks.map((chunk, index) => { const data = index === 0 ? padded : chunk.data, header = Buffer.alloc(8); header.writeUInt32LE(data.length, 0); header.writeUInt32LE(chunk.kind, 4); return Buffer.concat([header, data]); });
    const header = Buffer.alloc(12); header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + parts.reduce((sum, part) => sum + part.length, 0), 8);
    const result = Buffer.concat([header, ...parts]);
    return { bytes: result, verification: { changedNodes: changed, beforeSha256: hash(bytes), afterSha256: hash(result), binaryChunksUnchanged: true, geometryUvMaterialsBindAndAnimationJsonUnchanged: true } };
}
for (const faction of ['elf', 'gnome']) {
    const raw = complete(sources[faction], faction), rawPath = `${output}/${faction}/exports/${faction}-roster.glb`;
    pending.push({ file: rawPath, ...raw });
    const pack = report.factions[faction];
    for (const detail of ['near', 'far']) {
        const file = `public/models/battle/${faction}-roster${detail === 'far' ? '-lod' : ''}.glb`, completed = complete(file, faction);
        const asset = manifest.assets.find(item => item.file === file);
        if (!asset || completed.bytes.length > asset.maxBytes) throw new Error('Preserved runtime byte budget exceeded');
        pending.push({ file, ...completed });
        pack[detail].bytes = completed.bytes.length; pack[detail].sha256 = hash(completed.bytes);
        asset.sha256 = hash(completed.bytes);
    }
    pack.exportMetadataCompletion = { edition, raw: rawPath, originalRawSha256: pack.rawSha256, verification: raw.verification, artistNativeUnchanged: true };
    pack.rawSha256 = hash(raw.bytes);
}
const backup = `artifacts/battle-preview/${edition}/previous-runtime`; mkdirSync(backup, { recursive: true });
copyFileSync(reportPath, `${backup}/faction-rosters.json`); copyFileSync(manifestPath, `${backup}/manifest.json`);
for (const item of pending) {
    if (item.file.startsWith('public/')) copyFileSync(item.file, `${backup}/${item.file.split('/').at(-1)}`);
    mkdirSync(dirname(item.file), { recursive: true }); writeFileSync(item.file, item.bytes);
}
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(`${output}/completion.json`, JSON.stringify({ edition, scope: 'Export metadata only; immutable artist natives retained', scout: { hip, originalMeasuredBackTarget: oldTarget, independentlyRecordedRootDelta: rootDelta, target, error }, files: pending.map(({ file, verification }) => ({ file, ...verification })), runtimeApproved: false, finishedUnitApproved: false }, null, 2) + '\n');
console.log(JSON.stringify({ completed: edition, sourceGeometryAndAllBinaryDataUnchanged: true, scoutError: error }));
