// Read-only geometry/animation validation of the exact exported runtime GLBs.
// Textures are deliberately not decoded: this is a CPU contact check, separate
// from the real WebGL screenshots and rendering tests.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { AnimationMixer, LoopOnce, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const [file, out, ...supportOptions] = process.argv.slice(2);
if (!file || !out) throw new Error('Usage: node scripts/check-roster-contact.mjs runtime.glb report.json [--wheel-bones=explicit,bone,names]');
const wheelOption = supportOptions.find(option => option.startsWith('--wheel-bones='));
const wheelBones = wheelOption ? wheelOption.slice('--wheel-bones='.length).split(',').filter(Boolean) : [];
const catapultOption = supportOptions.find(option => option.startsWith('--catapult-base-bones='));
const catapultBaseBones = catapultOption ? catapultOption.slice('--catapult-base-bones='.length).split(',').filter(Boolean) : [];
if (wheelBones.some(name => !/^[A-Za-z0-9_]+$/.test(name))) throw new Error('Explicit wheel bone names must be source identifiers');
const bytes = readFileSync(file), sha256 = createHash('sha256').update(bytes).digest('hex');
const loader = new GLTFLoader();
loader.register(() => ({ name: 'PERIS_GEOMETRY_CONTACT_QA', loadTexture: () => Promise.resolve(new Texture()) }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const initial = new Map();
gltf.scene.traverse(node => initial.set(node, [node.position.clone(), node.quaternion.clone(), node.scale.clone()]));
const mixer = new AnimationMixer(gltf.scene), roles = ['line_infantry', 'spear_guard', 'elite', 'archer', 'scout', 'light_cavalry', 'heavy_cavalry', 'catapult'];
if (wheelBones.length) roles.push('ram');
const feet = ['foot_L', 'foot_R', 'Foot_L', 'Foot_R', 'foot_front_L', 'foot_front_R', 'foot_back_L', 'foot_back_R', 'Deer01_L_Hand', 'Deer01_R_Hand', 'Deer01_L_Finger0', 'Deer01_R_Finger0', 'Deer01_L_Foot', 'Deer01_R_Foot', 'Deer01_L_Toe0', 'Deer01_R_Toe0', 'Elephantidae_Foot_L', 'Elephantidae_Foot_R', 'Elephantidae_Hand_L', 'Elephantidae_Hand_R', 'Horse_Hoof_L', 'Horse_Hoof_R', 'Horse_Hoof_back_L', 'Horse_Hoof_back_R', 'Horse_Hand_L', 'Horse_Hand_R', 'Horse_Foot_L', 'Horse_Foot_R', 'Boar_Back_Foot_Left', 'Boar_Back_Foot_Right', 'Boar_Front_Foot_Left', 'Boar_Front_Foot_Right'];
// Export clones prefix joints with a unique rig name. Legacy packs retain
// GLTFLoader's numerical suffixes, so both formats remain inspectable.
feet.push('FrontLeg3_L', 'FrontLeg3_R', 'FrontToe_L', 'FrontToe_R', 'BackLeg3_L', 'BackLeg3_R', 'BackToe_L', 'BackToe_R');
const mountedRoles = new Set(['scout', 'light_cavalry', 'heavy_cavalry']);
const riderFeet = new Set(['foot_L', 'foot_R', 'Foot_L', 'Foot_R']);
const supportBone = (name, role) => {
    const sourceName = name.split('__').at(-1);
    const candidates = role === 'ram' ? wheelBones : role === 'catapult' && catapultBaseBones.length ? catapultBaseBones : mountedRoles.has(role) ? feet.filter(foot => !riderFeet.has(foot)) : feet;
    return candidates.some(foot => sourceName === foot || new RegExp('^' + foot + '(?:_?\\d+)+$').test(sourceName));
};
function roleMesh(mesh, role) {
    for (let node = mesh; node; node = node.parent) if (node.name.startsWith(role)) return true;
    return false;
}
const records = [], point = new Vector3();
for (const role of roles) {
    const supports = [];
    gltf.scene.traverse(mesh => {
        if (!mesh.isSkinnedMesh || !roleMesh(mesh, role)) return;
        const joints = new Set(mesh.skeleton.bones.flatMap((bone, index) => supportBone(bone.name, role) ? [index] : []));
        const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight'), vertices = [];
        for (let i = 0; i < weights.count; i++) {
            let total = 0;
            for (let component = 0; component < 4; component++) if (joints.has(indices.getComponent(i, component))) total += weights.getComponent(i, component);
            if (total > .5) vertices.push(i);
        }
        if (vertices.length) supports.push({ mesh, vertices, bones: [...joints].map(index => mesh.skeleton.bones[index].name) });
    });
    if (!supports.length) {
        const bones = [];
        gltf.scene.traverse(mesh => { if (mesh.isSkinnedMesh && roleMesh(mesh, role)) bones.push(...mesh.skeleton.bones.map(bone => bone.name).filter(name => /foot|hoof|hand/i.test(name))); });
        throw new Error(`No explicit support vertices in ${role}: ${JSON.stringify([...new Set(bones)])}`);
    }
    const samples = [];
    for (const state of ['idle', 'walk', 'attack']) {
        const clip = gltf.animations.find(clip => clip.name === `${role}_${state}`);
        if (!clip) throw new Error(`Missing ${role}_${state}`);
        for (let frame = 0; frame <= 48; frame++) {
            mixer.stopAllAction();
            for (const [node, values] of initial) { node.position.copy(values[0]); node.quaternion.copy(values[1]); node.scale.copy(values[2]); }
            const action = mixer.clipAction(clip).reset().setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
            const seconds = clip.duration * frame / 48; mixer.setTime(seconds); gltf.scene.updateMatrixWorld(true);
            let minimumY = Infinity, argmin;
            for (const { mesh, vertices } of supports) {
                mesh.skeleton.update();
                for (const vertex of vertices) {
                    point.fromBufferAttribute(mesh.geometry.getAttribute('position'), vertex);
                    mesh.applyBoneTransform(vertex, point); point.applyMatrix4(mesh.matrixWorld);
                    if (point.y < minimumY) { minimumY = point.y; argmin = { mesh: mesh.name, vertex, pointWorld: point.toArray() }; }
                }
            }
            if (!Number.isFinite(minimumY)) throw new Error(`Nonfinite support at ${role}_${state}`);
            samples.push({ state, exportedSeconds: seconds, nativeFrameEquivalent: 1 + frame / 2, minimumWorldY: minimumY, argmin });
        }
    }
    records.push({ role, supportVertices: supports.reduce((n, item) => n + item.vertices.length, 0), supportMeshesAndBones: supports.map(({ mesh, bones }) => ({ mesh: mesh.name, bones })), riderFeetExcluded: mountedRoles.has(role), minimumWorldY: Math.min(...samples.map(row => row.minimumWorldY)), negativeSupportSamples: samples.filter(row => row.minimumWorldY < -.002), samples });
}
const report = { file: resolve(file), sha256, checkedAtUTC: new Date().toISOString(), method: 'Three.js GLTFLoader + original optimized skin weights/inverse binds + AnimationMixer; 49 samples per role clip. World Y is the exported floor axis. No texture decoding or GPU rendering.', roles: records, allSamplesGroundSafe: records.every(row => !row.negativeSupportSamples.length), explicitWheelBones: wheelBones, explicitCatapultBaseBones: catapultBaseBones, excludedRoles: wheelBones.length ? [] : [{ role: 'ram', reason: 'Siege chassis/wheel support needs its own explicit selector; foot bones are not applicable.' }], runtimeVisualApproved: false };
mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ file, sha256, allSamplesGroundSafe: report.allSamplesGroundSafe, roles: records.map(({ role, minimumWorldY, negativeSupportSamples }) => ({ role, minimumWorldY, negativeSamples: negativeSupportSamples.length })) }));
if (!report.allSamplesGroundSafe) process.exitCode = 1;
