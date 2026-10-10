import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, renameSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PropertyBinding } from 'three';

const factions = ['roman', 'spartan', 'persian', 'egyptian', 'orc', 'elf', 'dwarf', 'gnome', 'pandaren', 'undead', 'demon'];
const roles = ['line_infantry', 'spear_guard', 'archer', 'elite', 'scout', 'light_cavalry', 'heavy_cavalry', 'ram', 'catapult'];
const [faction, sourceArgument, nativeArgument, edition, ...options] = process.argv.slice(2);
let stageOnly = false, verifyContact = false, farSourceArgument, farNativeArgument, nearTextureSize, farTextureSize, nearSimplifyRatio, farSimplifyRatio, catapultBaseBones;
const usage = 'Usage: faction raw.glb editable.blend edition [--stage-only] [--verify-contact] [--catapult-base-bones onagermain] [--far-source far.glb far.blend] [--near-texture-size 512|768|1024|1440|1536|2048] [--far-texture-size 128|256|512|768|1024] [--near-simplify .1|.18|.25|.35|.5|.65] [--far-simplify .05|.075|.1|.18|.25|.35|.5]';
for (let index = 0; index < options.length; index++) {
    if (options[index] === '--stage-only' && !stageOnly) stageOnly = true;
    else if (options[index] === '--verify-contact' && !verifyContact) verifyContact = true;
    else if (options[index] === '--catapult-base-bones' && !catapultBaseBones && /^[A-Za-z0-9_,]+$/.test(options[index + 1] || '')) catapultBaseBones = options[++index];
    else if (options[index] === '--far-source' && !farSourceArgument && options[index + 1] && options[index + 2]) {
        farSourceArgument = options[++index]; farNativeArgument = options[++index];
    } else if (options[index] === '--near-texture-size' && !nearTextureSize && /^(512|768|1024|1440|1536|2048)$/.test(options[index + 1] || '')) {
        nearTextureSize = options[++index];
    } else if (options[index] === '--far-texture-size' && !farTextureSize && /^(128|256|512|768|1024)$/.test(options[index + 1] || '')) {
        farTextureSize = options[++index];
    } else if (options[index] === '--near-simplify' && !nearSimplifyRatio && /^\.(1|18|25|35|5|65)$/.test(options[index + 1] || '')) {
        nearSimplifyRatio = options[++index];
    } else if (options[index] === '--far-simplify' && !farSimplifyRatio && /^\.(05|075|1|18|25|35|5)$/.test(options[index + 1] || '')) {
        farSimplifyRatio = options[++index];
    } else throw new Error(usage);
}
if (!factions.includes(faction) || !sourceArgument || !nativeArgument || !/^[a-z0-9-]+$/.test(edition || '')) throw new Error(usage);
if (stageOnly && (faction !== 'orc' || !/^orc-prototype-deadline-v[1-9][0-9]*$/.test(edition))) throw new Error('Local full-pack staging expects a named Orc prototype edition');
const root = resolve('.'), source = resolve(sourceArgument), native = resolve(nativeArgument);
const farSource = farSourceArgument ? resolve(farSourceArgument) : source, farNative = farNativeArgument ? resolve(farNativeArgument) : native;
for (const path of [source, native, farSource, farNative]) {
    if (!path.startsWith(resolve('assets/source/battle') + '\\') && !path.startsWith(resolve('assets/source/battle') + '/')) throw new Error('Expected project source edition.');
    if (!existsSync(path)) throw new Error('Source or native missing.');
}
const outputRoot = stageOnly ? `artifacts/battle-preview/orc-quality-pilot-20261009/staged/${edition}` : `artifacts/battle-preview/prototype-deadline-20261009/published/${edition}/${faction}`;
if (existsSync(`${outputRoot}/publication.json`)) throw new Error('Publication edition exists; preserve it.');
mkdirSync(outputRoot, { recursive: true });
const hash = data => createHash('sha256').update(data).digest('hex');
function inspect(path, maxBytes) {
    const data = readFileSync(path);
    if (data.length > maxBytes || data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length) throw new Error(`Invalid GLB or byte budget: ${path}`);
    const gltf = JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12))), binary = 28 + data.readUInt32LE(12);
    if (gltf.buffers.some(buffer => buffer.uri) || !gltf.images?.length || gltf.images.some(image => image.uri || image.bufferView === undefined) || gltf.extensionsRequired?.some(name => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(name))) throw new Error('Expected embedded textures and decoder-free geometry.');
    if (gltf.animations?.length !== 27) throw new Error('Expected nine roles and 27 actions.');
    if (verifyContact) {
        const names = gltf.nodes.map(node => node.name).filter(Boolean).map(name => PropertyBinding.sanitizeNodeName(name));
        if (new Set(names).size !== names.length) throw new Error('Ambiguous runtime node names can bind animation to the wrong skeleton.');
    }
    const clipTiming = gltf.animations.map(clip => {
        let minimum = Infinity, maximum = -Infinity;
        for (const sampler of clip.samplers) {
            const accessor = gltf.accessors[sampler.input], view = gltf.bufferViews[accessor.bufferView];
            if (accessor.componentType !== 5126 || accessor.type !== 'SCALAR' || accessor.sparse) throw new Error('Unsupported time accessor.');
            const offset = binary + (view.byteOffset || 0) + (accessor.byteOffset || 0), stride = view.byteStride || 4;
            for (let index = 0; index < accessor.count; index++) { const time = data.readFloatLE(offset + stride * index); if (!Number.isFinite(time)) throw new Error('Invalid animation time.'); minimum = Math.min(minimum, time); maximum = Math.max(maximum, time); }
        }
        if (Math.abs(minimum) > 1e-6 || Math.abs(maximum - 1) > 1e-6) throw new Error(`Expected corrected 0..1 timing: ${clip.name}`);
        return { name: clip.name, minimumSeconds: minimum, maximumSeconds: maximum };
    });
    const parts = [];
    for (const role of roles) {
        const roleParts = gltf.nodes.filter(node => node.name?.startsWith(role) && node.mesh !== undefined);
        if (!roleParts.length || roleParts.some(node => node.skin === undefined)) throw new Error(`Missing bound ${role}`);
        for (const node of roleParts) {
            if (!['CC-BY-SA-3.0', 'CC-BY-4.0'].includes(node.extras?.asset_license)) throw new Error(`Missing ${role} component attribution`);
            if (node.extras.asset_license === 'CC-BY-4.0' && (!node.extras.source_url || !node.extras.source_file_sha256 || !node.extras.peris_component_credit)) throw new Error('Missing licensed head provenance.');
            if (node.extras.asset_license === 'CC-BY-4.0') {
                const credit = JSON.parse(node.extras.peris_component_credit);
                if (credit.license !== node.extras.asset_license || credit.sourceUrl !== node.extras.source_url || credit.sourceFileSha256 !== node.extras.source_file_sha256) throw new Error(`Component credit must match its source URL, license and exact file hash: ${node.name}`);
            }
            for (const primitive of gltf.meshes[node.mesh].primitives) {
                const material = gltf.materials[primitive.material];
                if (primitive.attributes.JOINTS_0 === undefined || primitive.attributes.WEIGHTS_0 === undefined || !material?.pbrMetallicRoughness?.baseColorTexture) throw new Error(`Missing ${role} textured deformation attributes`);
                if (!material.normalTexture || !material.pbrMetallicRoughness.metallicRoughnessTexture) throw new Error(`Missing authored ${role} normal or metal/roughness surface: ${material.name}`);
            }
        }
        for (const state of ['idle', 'walk', 'attack']) {
            const clip = gltf.animations.find(item => item.name === `${role}_${state}`), targets = new Set(clip?.channels.map(channel => channel.target.node));
            if (!clip?.channels.length || roleParts.some(node => !gltf.skins[node.skin].joints.some(joint => targets.has(joint)))) throw new Error(`Incomplete ${role} ${state} rig`);
        }
        parts.push(...roleParts);
    }
    let vertices = 0, triangles = 0;
    for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) { vertices += gltf.accessors[primitive.attributes.POSITION].count; triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3; }
    const specularMaterials = gltf.materials.flatMap(material => {
        const specular = material.extensions?.KHR_materials_specular; if (!specular) return [];
        for (const key of ['specularTexture', 'specularColorTexture']) if (specular[key] && gltf.textures?.[specular[key].index]?.source === undefined) throw new Error('Missing embedded authored specular texture.');
        return [{ name: material.name, factor: specular.specularFactor ?? 1, color: specular.specularColorFactor ?? [1, 1, 1], factorTexture: !!specular.specularTexture, colorTexture: !!specular.specularColorTexture }];
    });
    return { path: relative(root, path).replaceAll('\\', '/'), bytes: data.length, sha256: hash(data), vertices, triangles, skins: gltf.skins.length, meshes: gltf.meshes.length, meshParts: parts.length, materials: gltf.materials.length, embeddedImages: gltf.images.length, clips: gltf.animations.map(clip => clip.name), clipTiming, componentLicenses: [...new Set(parts.map(node => node.extras.asset_license))], componentCredits: parts.map(node => ({ name: node.name, license: node.extras.asset_license, source: node.extras.source_url, hash: node.extras.source_file_sha256, credit: node.extras.peris_component_credit })), specularMaterials };
}
const raw = inspect(source, 160 * 1024 * 1024), nativeHash = hash(readFileSync(native));
const licensedComponents = [...new Map(raw.componentCredits.filter(component => component.license === 'CC-BY-4.0').map(component => {
    const credit = typeof component.credit === 'string' ? JSON.parse(component.credit) : component.credit;
    const author = credit.author || credit.creator || credit.sourceAuthor;
    if (typeof author !== 'string' || !author.trim()) throw new Error(`Missing credited component author: ${component.name}`);
    return [component.source + ':' + component.hash, { author, source: component.source, hash: component.hash, license: component.license, changes: credit.changes || 'See embedded component credit.' }];
})).values()];
const attribution = 'Body, rig and Peris anatomy/equipment: Wildfire Games / Peris, CC BY-SA 3.0, https://creativecommons.org/licenses/by-sa/3.0/.' +
    licensedComponents.map(component => ` Separate adapted component: ${component.author}, CC BY 4.0, ${component.source}.`).join('') +
    ' Component source hashes and changes remain embedded in the GLB.';
const farRaw = farSource === source ? raw : inspect(farSource, 160 * 1024 * 1024), farNativeHash = farNative === native ? nativeHash : hash(readFileSync(farNative));
if (JSON.stringify(farRaw.componentCredits) !== JSON.stringify(raw.componentCredits)) throw new Error('Near and structural distance sources must retain the same component attribution.');
const farSourceRecord = farSource === source ? undefined : { raw: farRaw, native: relative(root, farNative).replaceAll('\\', '/'), nativeHash: farNativeHash };
const cli = resolve('node_modules/@gltf-transform/cli/bin/cli.js'), details = {};
function run(label, args) { const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); writeFileSync(`${outputRoot}/${label}.log`, (result.stdout || '') + (result.stderr || '')); if (result.status !== 0) throw new Error(`${label} failed; inspect saved log.`); }
for (const detail of ['near', 'far']) {
    const output = `${outputRoot}/${faction}-roster-${detail}.glb`;
    const input = detail === 'far' ? farSource : source, baseline = detail === 'far' ? farRaw : raw;
    const simplify = detail === 'far' && farSource !== source ? false : faction === 'orc' || detail === 'far' || !!nearSimplifyRatio;
    const ratio = detail === 'near' ? nearSimplifyRatio || (faction === 'orc' ? '.35' : '.5') : farSimplifyRatio || (faction === 'orc' ? '.18' : '.5');
    const error = detail === 'near' && nearSimplifyRatio ? '.002' : faction === 'orc' ? detail === 'near' ? '.002' : '.003' : '.01';
    run(`optimize-${detail}`, ['optimize', input, output, '--compress', 'false', '--palette', 'false', '--prune', 'false', '--flatten', 'false', '--join', 'false', '--instance', 'false', '--simplify', String(simplify), '--simplify-ratio', ratio, '--simplify-error', error, '--simplify-lock-border', 'false', '--texture-size', detail === 'near' ? nearTextureSize || (faction === 'orc' ? '1440' : '2048') : farTextureSize || (faction === 'orc' ? '768' : '1024'), '--texture-compress', 'auto']);
    run(`validate-${detail}`, ['validate', output]);
    details[detail] = inspect(output, (faction === 'orc' ? detail === 'near' ? 32 : 20 : detail === 'near' ? 16 : 8) * 1024 * 1024);
    if (JSON.stringify(details[detail].componentCredits) !== JSON.stringify(baseline.componentCredits) || JSON.stringify(details[detail].specularMaterials) !== JSON.stringify(baseline.specularMaterials)) throw new Error('Component provenance or authored specular settings changed during optimization.');
    if (verifyContact) {
        const supportName = catapultBaseBones || (faction === 'gnome' ? 'onagermain' : undefined);
        const baseSupport = supportName ? [`--catapult-base-bones=${supportName}`] : [];
        const contact = spawnSync(process.execPath, ['scripts/check-roster-contact.mjs', output,
            `${outputRoot}/contact-${detail}.json`, '--wheel-bones=l_mid,l_front,l_back,r_mid,r_front,r_back', ...baseSupport], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        writeFileSync(`${outputRoot}/contact-${detail}.log`, (contact.stdout || '') + (contact.stderr || ''));
        if (contact.status !== 0) throw new Error(`Exported ${detail} animation contact failed; runtime publication remains unchanged.`);
    }
}
if (hash(readFileSync(source)) !== raw.sha256 || hash(readFileSync(native)) !== nativeHash || hash(readFileSync(farSource)) !== farRaw.sha256 || hash(readFileSync(farNative)) !== farNativeHash) throw new Error('Editable source or raw export changed.');
if (stageOnly) {
    const record = { edition, roles, raw, native: relative(root, native).replaceAll('\\', '/'), nativeHash, structuralFarSource: farSourceRecord, near: { ...details.near, url: '/' + details.near.path }, far: { ...details.far, url: '/' + details.far.path }, localDevelopmentOnly: true, finishedUnitApproved: false, battleRendererApproved: false, credits: 'Wildfire Games / Peris body and equipment: CC BY-SA 3.0; adapted Crazyon520 heads: CC BY 4.0.' };
    writeFileSync(`${outputRoot}/stage-record.json`, JSON.stringify(record, null, 2) + '\n');
    writeFileSync('artifacts/battle-preview/orc-quality-pilot-20261009/staged/latest.json', JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify({ stagedOnly: true, edition, near: { bytes: details.near.bytes, triangles: details.near.triangles }, far: { bytes: details.far.bytes, triangles: details.far.triangles } }));
    process.exit(0);
}
// Prepare both detail files before replacing either runtime output. The exact
// previous report and files remain available locally for recovery and comparison.
const reportPath = 'public/models/battle/faction-rosters.json', report = JSON.parse(readFileSync(reportPath, 'utf8'));
const manifest = JSON.parse(readFileSync('assets/manifest.json', 'utf8')), backup = `${outputRoot}/previous-runtime`;
mkdirSync(backup, { recursive: true }); copyFileSync(reportPath, `${backup}/faction-rosters.json`); copyFileSync('assets/manifest.json', `${backup}/manifest.json`);
const credit = attribution;
for (const detail of ['near', 'far']) {
    const suffix = detail === 'far' ? '-lod' : '', file = `public/models/battle/${faction}-roster${suffix}.glb`, id = `battle-${faction}-roster${suffix}`;
    if (existsSync(file)) copyFileSync(file, `${backup}/${faction}-roster${suffix}.glb`);
    copyFileSync(details[detail].path, `${file}.next`); renameSync(`${file}.next`, file);
    manifest.assets = manifest.assets.filter(asset => asset.id !== id);
    manifest.assets.push({ id, file, license: licensedComponents.length ? 'licensed' : 'CC-BY-SA-3.0', source: 'https://github.com/0ad/0ad/tree/61a3b9507d974084e6badb88a0826bd89a6d5b8b/binaries/data/mods/public/art', editableSource: relative(root, detail === 'far' ? farNative : native).replaceAll('\\', '/'), attribution: credit, maxBytes: (faction === 'orc' ? detail === 'near' ? 32 : 20 : detail === 'near' ? 16 : 8) * 1024 * 1024, sha256: details[detail].sha256, description: `Nine ${faction} visual prototype roles, 27 combined clips at 0..1 seconds. ${detail} detail. Seven troop looks use existing combat; two siege models are studies. Prototype publication is separate from final art approval.` });
}
report.factions[faction] = { sourceEdition: edition, rawSha256: raw.sha256, nativeSha256: nativeHash, structuralFarSource: farSourceRecord, prototypeAvailable: true, finishedUnitApproved: false, componentAttribution: licensedComponents, credit, near: details.near, far: details.far };
if (report.withheld) delete report.withheld[faction];
report.status = 'Visual prototypes; seven combat looks and two siege studies per faction. Final art review remains open.';
writeFileSync('assets/manifest.json', JSON.stringify(manifest, null, 2) + '\n'); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
const licensePath = 'public/licenses/peris-faction-rosters.txt', componentMarker = '\nAdditional active component credits:\n';
const licenseBase = readFileSync(licensePath, 'utf8').split(componentMarker)[0];
const activeComponents = [...new Map(Object.values(report.factions).flatMap(pack => pack.componentAttribution || []).map(component => [component.source + ':' + component.hash, component])).values()];
writeFileSync(licensePath, licenseBase + (activeComponents.length ? componentMarker + activeComponents.map(component => `${component.author}\n${component.source}\nCC BY 4.0: https://creativecommons.org/licenses/by/4.0/\nSource SHA256: ${component.hash}\nAdaptation: ${component.changes}\n`).join('\n') : ''));
const publication = { faction, edition, raw, native: relative(root, native).replaceAll('\\', '/'), nativeHash, structuralFarSource: farSourceRecord, near: details.near, far: details.far, previousRuntime: backup, prototypeAvailable: true, finishedUnitApproved: false, visualReviewPending: true, credit };
writeFileSync(`${outputRoot}/publication.json`, JSON.stringify(publication, null, 2) + '\n');
console.log(JSON.stringify({ faction, edition, near: { bytes: details.near.bytes, triangles: details.near.triangles }, far: { bytes: details.far.bytes, triangles: details.far.triangles } }));
