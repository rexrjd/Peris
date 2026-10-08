import { AnimationMixer, DataTexture, FloatType, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Material, Mesh, MeshDepthMaterial, MeshStandardMaterial, NearestFilter, Object3D, RGBAFormat, RGBADepthPacking, Skeleton, SkinnedMesh, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type Faction } from '../../../factions/domain/factions';
import { soldierSlots, type SoldierFrame, type SoldierVisualFactory } from './soldiers';
import type { Formation } from '../../domain/types';

export const ARMY_ROLES = ['line_infantry', 'spear_guard', 'archer', 'elite', 'scout', 'light_cavalry', 'heavy_cavalry', 'ram', 'catapult'] as const;
export type ArmyRole = typeof ARMY_ROLES[number];
const PROTOTYPE_ROLES: readonly ArmyRole[] = ['line_infantry', 'heavy_cavalry'];
type Part = { mesh: SkinnedMesh; palette: DataTexture; legacySurface: boolean };
type Army = { parts: Map<ArmyRole, Part[]>; dispose: () => void };
const FRAMES = 24;
const shader = `
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec2 instanceMotion;
uniform sampler2D armyBones;
uniform float armyClock;
uniform mat4 armyBind;
uniform mat4 armyBindInverse;
mat4 armyBone(float index) {
 float phase = fract(armyClock * (instanceMotion.y > 1.5 ? 1.3 : 1.0) + instanceMotion.x) * 24.0;
 int f = int(floor(phase)); int row = int(instanceMotion.y) * 24;
 int x = int(index) * 4;
 mat4 a = mat4(texelFetch(armyBones, ivec2(x,row+f),0), texelFetch(armyBones,ivec2(x+1,row+f),0),texelFetch(armyBones,ivec2(x+2,row+f),0),texelFetch(armyBones,ivec2(x+3,row+f),0));
 int next = row + ((f+1)%24);
 mat4 b = mat4(texelFetch(armyBones,ivec2(x,next),0),texelFetch(armyBones,ivec2(x+1,next),0),texelFetch(armyBones,ivec2(x+2,next),0),texelFetch(armyBones,ivec2(x+3,next),0));
 return a * (1.0-fract(phase)) + b * fract(phase);
}
mat4 armySkin() { return armyBindInverse * (armyBone(skinIndex.x)*skinWeight.x + armyBone(skinIndex.y)*skinWeight.y + armyBone(skinIndex.z)*skinWeight.z + armyBone(skinIndex.w)*skinWeight.w) * armyBind; }
`;

/** Each source owns its imported geometry, materials, textures and baked palettes. Visuals only own their clones. */
async function loadArmySource(url: string, roles: readonly ArmyRole[], legacySurface: boolean): Promise<Army> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene, parts = new Map<ArmyRole, Part[]>(), mixer = new AnimationMixer(root);
    const meshes: SkinnedMesh[] = [], geometries = new Set<Mesh['geometry']>(), materials = new Set<Material>();
    const textures = new Set<Texture>(), palettes = new Set<DataTexture>(), skeletons = new Set<Skeleton>();
    root.traverse(node => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        geometries.add(mesh.geometry);
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            if (materials.has(material)) continue;
            materials.add(material);
            for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
            // Original procedural exports used untagged palette values. Imported glTF PBR colors are already linear.
            if (legacySurface && material instanceof MeshStandardMaterial && !material.map) material.color.convertSRGBToLinear();
        }
        if ((mesh as SkinnedMesh).isSkinnedMesh) { meshes.push(mesh as SkinnedMesh); skeletons.add((mesh as SkinnedMesh).skeleton); }
    });
    let disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        mixer.stopAllAction(); mixer.uncacheRoot(root);
        geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
        const bitmaps = new Set<ImageBitmap>();
        for (const texture of textures) {
            if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) bitmaps.add(texture.image);
            texture.dispose();
        }
        // Texture disposal releases GPU storage, while glTF ImageBitmaps need
        // their own close. Several textures can share the same decoded image.
        bitmaps.forEach(image => image.close());
        palettes.forEach(item => item.dispose()); skeletons.forEach(item => item.dispose());
    };
    try {
        root.updateMatrixWorld(true);
        for (const role of roles) {
            const group = meshes.filter(mesh => {
                let node: Object3D | null = mesh;
                while (node) { if (node.name.startsWith(role)) return true; node = node.parent; }
                return false;
            });
            if (!group.length) throw new Error(`Missing ${role} geometry in ${url}`);
            const rigs = new Map<Skeleton, DataTexture>();
            for (const skeleton of new Set(group.map(mesh => mesh.skeleton))) {
                const bones = skeleton.bones.length, data = new Float32Array(bones * 16 * FRAMES * 3);
                for (const [index, name] of ['idle', 'walk', 'attack'].entries()) {
                    const clip = gltf.animations.find(clip => clip.name === `${role}_${name}`)
                        ?? gltf.animations.find(clip => clip.name.includes(role) && clip.name.includes(name));
                    if (!clip) throw new Error(`Missing ${role} ${name} rig clip in ${url}`);
                    mixer.stopAllAction(); mixer.clipAction(clip).reset().play();
                    for (let frame = 0; frame < FRAMES; frame++) {
                        mixer.setTime(frame / FRAMES * clip.duration); root.updateMatrixWorld(true); skeleton.update();
                        data.set(skeleton.boneMatrices!, (index * FRAMES + frame) * bones * 16);
                    }
                }
                mixer.stopAllAction();
                const palette = new DataTexture(data, bones * 4, FRAMES * 3, RGBAFormat, FloatType);
                palette.minFilter = palette.magFilter = NearestFilter; palette.needsUpdate = true;
                palettes.add(palette); rigs.set(skeleton, palette);
            }
            parts.set(role, group.map(mesh => ({ mesh, palette: rigs.get(mesh.skeleton)!, legacySurface })));
        }
        mixer.stopAllAction(); root.updateMatrixWorld(true);
        return { parts, dispose };
    } catch (error) { dispose(); throw error; }
}

/** Bake each distinct rig once per role. Horse and rider retain separate palettes in the same formation. */
export async function loadArmy(faction: Faction, detail: 'near' | 'far' = 'near', usePrototypes = false): Promise<Army> {
    const suffix = detail === 'far' ? '-lod' : '';
    const base = await loadArmySource(`/models/battle/${faction}-army${suffix}.glb`, ARMY_ROLES, true);
    if (!usePrototypes || faction !== 'roman') return base;
    try {
        const prototype = await loadArmySource(`/models/battle/reference-prototypes${suffix}.glb`, PROTOTYPE_ROLES, false);
        const parts = new Map(base.parts);
        for (const role of PROTOTYPE_ROLES) parts.set(role, prototype.parts.get(role)!);
        return { parts, dispose() { prototype.dispose(); base.dispose(); } };
    } catch (error) { base.dispose(); throw error; }
}

export function armyRole(f: Formation, formations: readonly Formation[]): ArmyRole {
    const peers = formations.filter(other => other.owner_id === f.owner_id && other.unit_type === f.unit_type && other.battle_id === f.battle_id).sort((a, b) => a.id - b.id);
    const index = peers.findIndex(other => other.id === f.id);
    return f.unit_type === 'archers' ? 'archer' : f.unit_type === 'cavalry' ? (['scout','light_cavalry','heavy_cavalry'] as const)[Math.max(0,index)%3] : (['line_infantry','spear_guard','elite'] as const)[Math.max(0,index)%3];
}

export function createArmyFactory(own: Army, enemy: Army, playerId: string, formations: readonly Formation[], ownFar?: Army, enemyFar?: Army): SoldierVisualFactory {
    return formation => {
        const role=armyRole(formation, formations), ours=formation.owner_id===playerId;
        const near=createArmyVisual((ours ? own : enemy).parts.get(role)!);
        const source=ours ? ownFar : enemyFar;
        if(!source)return near;
        const far=createArmyVisual(source.parts.get(role)!);const object=new Group();object.add(near.object,far.object);
        return {object,update(frame:SoldierFrame){const detailed=frame.detail!=='far';near.object.visible=detailed;far.object.visible=!detailed;(detailed?near:far).update(frame);},dispose(){near.dispose();far.dispose();object.clear();}};
    };
}

function createArmyVisual(parts: Part[]) {
    const object = new Group(), clock = { value: 0 }, dummy = new Object3D(), local = new Matrix4(), instance = new Matrix4();
    const meshes: InstancedMesh[] = [], disposables: { dispose(): void }[] = [];
    const motion = new InstancedBufferAttribute(new Float32Array(120 * 2), 2);
    for (const { mesh, palette, legacySurface } of parts) {
        const geometry = mesh.geometry.clone(); geometry.setAttribute('instanceMotion', motion);
        const uniforms = { armyBones: { value: palette }, armyClock: clock, armyBind: { value: mesh.bindMatrix }, armyBindInverse: { value: mesh.bindMatrixInverse } };
        const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => material.clone());
        const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
        for (const m of [...materials, depth]) {
            m.customProgramCacheKey = () => `peris-instanced-rig-v3-${legacySurface && m !== depth ? 'wear' : 'pbr'}`;
            m.onBeforeCompile = program => {
                Object.assign(program.uniforms, uniforms);
                program.vertexShader = 'varying vec3 armySurface;\n' + shader + program.vertexShader;
                program.vertexShader = program.vertexShader.replace('void main() {', 'void main() {\nmat4 armySkinMatrix = armySkin();');
                program.vertexShader = program.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = (armySkinMatrix * vec4(position,1.0)).xyz; armySurface=position;');
                program.vertexShader = program.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = mat3(armySkinMatrix) * objectNormal;\n#ifdef USE_TANGENT\nobjectTangent = mat3(armySkinMatrix) * objectTangent;\n#endif');
                if(legacySurface && m!==depth) {
                    program.fragmentShader='varying vec3 armySurface;\n'+program.fragmentShader;
                    program.fragmentShader=program.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nfloat wear=fract(sin(dot(floor(armySurface*45.0),vec3(12.9898,78.233,47.11)))*43758.5453); roughnessFactor=clamp(roughnessFactor+(wear-.5)*.15,.12,1.0); diffuseColor.rgb*=.88+wear*.2;');
                }
            };
        }
        const batch = new InstancedMesh(geometry, Array.isArray(mesh.material) ? materials : materials[0], 120); batch.customDepthMaterial = depth;
        batch.castShadow = true; batch.receiveShadow = true; batch.frustumCulled = true;
        batch.userData.templateMatrix = mesh.matrixWorld.clone(); object.add(batch); meshes.push(batch);
        disposables.push(geometry, ...materials, depth, batch);
    }
    let disposed = false;
    return { object, update(frame: SoldierFrame) {
        const { formation: f, pose } = frame, angle = pose.facing * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
        const slots = soldierSlots(f); clock.value = frame.animate ? frame.time : clock.value;
        for (const [i, slot] of slots.entries()) {
            const x = pose.x + slot.x * cos - slot.y * sin, z = pose.y + slot.x * sin + slot.y * cos;
            dummy.position.set(x, frame.height(x,z), z); dummy.rotation.set(0,-angle,0);
            dummy.scale.setScalar(1 + Math.sin(i*37+f.id)*.035); dummy.updateMatrix(); local.copy(dummy.matrix);
            motion.setXY(i, (i*.618033+f.id*.13)%1, frame.animate ? f.status === 'moving' || f.status === 'routed' ? 1 : f.status === 'engaged' ? 2 : 0 : 0);
            for (const batch of meshes) { instance.multiplyMatrices(local, batch.userData.templateMatrix as Matrix4); batch.setMatrixAt(i,instance); }
        }
        motion.needsUpdate = true;
        for (const batch of meshes) { batch.count = slots.length; batch.instanceMatrix.needsUpdate = true; batch.computeBoundingSphere(); if(batch.boundingSphere) batch.boundingSphere.radius+=3; }
    }, dispose() { if (disposed) return; disposed = true; disposables.forEach(item => item.dispose()); object.clear(); } };
}

/** Siege remains an inspectable visual prototype; it does not invent combat or research rules. */
export function siegeShowcase(army: Army, role: 'ram' | 'catapult', position: Vector3) {
    const group = new Group(); group.position.copy(position);
    for (const { mesh } of army.parts.get(role)!) { const prop = new Mesh(mesh.geometry,mesh.material); prop.userData.armySourceOwned = true; prop.applyMatrix4(mesh.matrixWorld); prop.castShadow = prop.receiveShadow = true; group.add(prop); }
    return group;
}
