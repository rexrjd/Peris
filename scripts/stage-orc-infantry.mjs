import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const edition = process.argv[2], select = process.argv.includes('--select-for-review');
if (!/^orc-infantry-batch-v[1-9][0-9]*$/.test(edition || '') || process.argv.slice(3).some(arg => arg !== '--select-for-review')) throw new Error('Provide an Orc infantry batch edition and optional --select-for-review.');
const roles = ['spear_guard', 'elite', 'archer'];
const source = `assets/source/battle/${edition}/exports/orc-roster-normalized.glb`, native = `assets/source/battle/${edition}/peris-orc-army.blend`;
const base = 'artifacts/battle-preview/orc-quality-pilot-20261009/staged', out = `${base}/${edition}`;
if (!existsSync(source) || !existsSync(native)) throw new Error('Missing normalized source or editable native.');
if (existsSync(out)) throw new Error('Preserve existing staging editions.');
const baseline = JSON.parse(readFileSync(`${base}/orc-quality-pilot-v19/stage-record.json`, 'utf8'));
function inspect(path, maxBytes) {
    const data = readFileSync(path);
    if (data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length || data.length > maxBytes) throw new Error(`Invalid GLB or byte budget: ${path}`);
    const gltf = JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12))), binary = 28 + data.readUInt32LE(12);
    if (gltf.extensionsRequired?.some(name => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(name)) || gltf.buffers.some(buffer => buffer.uri) || !gltf.images?.length || gltf.images.some(image => image.uri || image.bufferView === undefined)) throw new Error('Expected self-contained, decoder-free export.');
    if (gltf.animations?.length !== 9) throw new Error('Expected nine clips.');
    const clipTiming = gltf.animations.map(clip => {
        let minimum = Infinity, maximum = -Infinity;
        for (const sampler of clip.samplers) {
            const accessor = gltf.accessors[sampler.input], view = gltf.bufferViews[accessor.bufferView];
            if (accessor.componentType !== 5126 || accessor.type !== 'SCALAR' || accessor.sparse) throw new Error('Unsupported time accessor.');
            const offset = binary + (view.byteOffset || 0) + (accessor.byteOffset || 0), stride = view.byteStride || 4;
            for (let i = 0; i < accessor.count; i++) { const time = data.readFloatLE(offset + stride * i); if (!Number.isFinite(time)) throw new Error('Invalid clip time.'); minimum = Math.min(minimum, time); maximum = Math.max(maximum, time); }
        }
        if (Math.abs(minimum) > 1e-6 || Math.abs(maximum - 1) > 1e-6) throw new Error(`Expected 0..1 second timing: ${clip.name}`);
        return { name: clip.name, minimumSeconds: minimum, maximumSeconds: maximum };
    });
    const parts = gltf.nodes.filter(node => roles.some(role => node.name?.startsWith(role)) && node.mesh !== undefined);
    if (parts.length !== 6 || parts.some(node => node.skin === undefined)) throw new Error('Expected six skinned component meshes.');
    for (const role of roles) {
        const roleParts = parts.filter(node => node.name.startsWith(role)), licenses = new Set(roleParts.map(node => node.extras?.asset_license));
        if (roleParts.length !== 2 || !licenses.has('CC-BY-4.0') || !licenses.has('CC-BY-SA-3.0')) throw new Error(`Missing component attribution: ${role}`);
        for (const node of roleParts) {
            if (node.extras.asset_license === 'CC-BY-4.0' && (!node.extras.source_url || !node.extras.source_file_sha256 || !node.extras.peris_component_credit)) throw new Error('Missing head provenance.');
            for (const primitive of gltf.meshes[node.mesh].primitives) if (primitive.attributes.JOINTS_0 === undefined || primitive.attributes.WEIGHTS_0 === undefined || !gltf.materials[primitive.material]?.pbrMetallicRoughness?.baseColorTexture) throw new Error('Missing bound PBR geometry.');
        }
        for (const state of ['idle', 'walk', 'attack']) {
            const clip = gltf.animations.find(item => item.name === `${role}_${state}`), targets = new Set(clip?.channels.map(channel => channel.target.node));
            if (!clip?.channels.length || roleParts.some(node => !gltf.skins[node.skin].joints.some(joint => targets.has(joint)))) throw new Error(`Incomplete ${role} ${state}`);
        }
    }
    let triangles = 0; for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
    return { path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), triangles, meshParts: parts.length, skins: gltf.skins.length, clips: gltf.animations.map(clip => clip.name), clipTiming, componentLicenses: [...new Set(parts.map(node => node.extras.asset_license))], sceneCredits: gltf.scenes?.map(scene => scene.extras?.peris_source_credits).filter(Boolean) };
}
const raw = inspect(source, 64 * 1024 * 1024); mkdirSync(out, { recursive: true });
const cli = resolve('node_modules/@gltf-transform/cli/bin/cli.js'), details = {};
function run(label, args) { const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 }); writeFileSync(`${out}/${label}.log`, (result.stdout || '') + (result.stderr || '')); if (result.status !== 0) throw new Error(`${label} failed; inspect its saved log.`); }
for (const detail of ['near', 'far']) {
    const output = `${out}/orc-infantry-${detail}.glb`;
    run(`optimize-${detail}`, ['optimize', source, output, '--compress', 'false', '--palette', 'false', '--prune', 'false', '--flatten', 'false', '--join', 'false', '--instance', 'false', '--simplify', 'true', '--simplify-ratio', detail === 'near' ? '.35' : '.18', '--simplify-error', detail === 'near' ? '.002' : '.003', '--simplify-lock-border', 'false', '--texture-size', detail === 'near' ? '2048' : '1024', '--texture-compress', 'auto']);
    run(`validate-${detail}`, ['validate', output]); details[detail] = inspect(output, roles.length * (detail === 'near' ? 12 : 5) * 1024 * 1024);
    if (JSON.stringify(details[detail].sceneCredits) !== JSON.stringify(raw.sceneCredits)) throw new Error('Scene credits changed during optimization.');
    details[detail].url = '/' + output;
}
if (createHash('sha256').update(readFileSync(source)).digest('hex') !== raw.sha256) throw new Error('Source changed during staging.');
const record = { edition, roles, raw, native, baseline, near: details.near, far: details.far, localDevelopmentOnly: true, finishedUnitApproved: false, battleRendererApproved: false, credits: baseline.credits, optimizationSettings: { near: { ratio: .35, error: .002, textureSize: 2048 }, far: { ratio: .18, error: .003, textureSize: 1024 }, decoderCompression: false, retainComponentCredits: true } };
writeFileSync(`${out}/stage-record.json`, JSON.stringify(record, null, 2) + '\n');
if (select) writeFileSync(`${base}/latest.json`, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ edition, near: details.near, far: details.far }));
