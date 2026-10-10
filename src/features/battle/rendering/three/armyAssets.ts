import { AnimationMixer, Box3, DataTexture, FloatType, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Material, Mesh, MeshDepthMaterial, MeshStandardMaterial, NearestFilter, Object3D, RGBAFormat, RGBADepthPacking, Skeleton, SkinnedMesh, Texture, Vector3, Vector4 } from 'three';
import { publishedArmyUrl } from './publication';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type Faction } from '../../../factions/domain/factions';
import { soldierSlots, strikeAnimation, type SoldierFrame, type SoldierVisualFactory } from './soldiers';
import type { Formation } from '../../domain/types';

export const ARMY_ROLES = ['line_infantry', 'spear_guard', 'archer', 'elite', 'scout', 'light_cavalry', 'heavy_cavalry', 'ram', 'catapult'] as const;
export type ArmyRole = typeof ARMY_ROLES[number];

/** Explicit mesh ownership wins over stale metadata on a copied mount rig. */
export function armyMeshMatchesRole(mesh: Object3D, role: ArmyRole) {
    let node: Object3D | null = mesh;
    // A multi-surface glTF node becomes a Group whose child meshes can lack
    // extras. Its nearest explicit owner still owns all those surfaces.
    while (node) {
        if (node.userData.peris_role) return node.userData.peris_role === role;
        node = node.parent;
    }
    node = mesh;
    while (node) {
        const namedRole = ARMY_ROLES.find(item => node!.name.startsWith(item));
        if (namedRole) return namedRole === role;
        node = node.parent;
    }
    return false;
}
type Part = { mesh: SkinnedMesh; palette: DataTexture; legacySurface: boolean };
export type Army = { parts: Map<ArmyRole, Part[]>; dispose: () => void };
type CachedArmy = { source: Promise<Army>; users: number; timer?: ReturnType<typeof setTimeout> };
const battleSources = new Map<string, CachedArmy>();

/** Keep an imported rig briefly across graphics toggles/quality changes.
 * Every canvas owns a lease; the final lease releases the source after 10s. */
export async function loadBattleArmy(faction: Faction, detail: 'near' | 'far' = 'near', published = false): Promise<Army> {
    if (!published) return loadArmy(faction, detail, false);
    const url = await publishedArmyUrl(faction, detail);
    let entry = battleSources.get(url);
    if (!entry) {
        entry = { source: loadArmySource(url, ARMY_ROLES, false), users: 0 };
        battleSources.set(url, entry);
        void entry.source.catch(() => { if (battleSources.get(url) === entry) battleSources.delete(url); });
    }
    const record = entry; clearTimeout(record.timer); record.users++;
    let source: Army;
    try { source = await record.source; } catch (error) { record.users--; throw error; }
    let released = false;
    return { parts: source.parts, dispose: () => {
        if (released) return; released = true;
        if (--record.users === 0) record.timer = setTimeout(() => {
            if (record.users !== 0) return;
            if (battleSources.get(url) === record) battleSources.delete(url);
            source.dispose();
        }, 10000);
    } };
}
type RenderFootprint = { depthScale: number; widthScale: number };
const roleBounds = new WeakMap<Army,Map<ArmyRole,Box3>>();
const FRAMES = 48;
const shader = `
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec2 instanceMotion;
uniform sampler2D armyBones;
uniform float armyClock;
uniform mat4 armyBind;
uniform mat4 armyBindInverse;
mat4 armyBone(float index) {
 float phase = fract(armyClock * (instanceMotion.y > 1.5 ? 1.3 : 1.0) + instanceMotion.x) * ${FRAMES}.0;
 int f = int(floor(phase)); int row = int(instanceMotion.y) * ${FRAMES};
 int x = int(index) * 4;
 mat4 a = mat4(texelFetch(armyBones, ivec2(x,row+f),0), texelFetch(armyBones,ivec2(x+1,row+f),0),texelFetch(armyBones,ivec2(x+2,row+f),0),texelFetch(armyBones,ivec2(x+3,row+f),0));
 int next = row + ((f+1)%${FRAMES});
 mat4 b = mat4(texelFetch(armyBones,ivec2(x,next),0),texelFetch(armyBones,ivec2(x+1,next),0),texelFetch(armyBones,ivec2(x+2,next),0),texelFetch(armyBones,ivec2(x+3,next),0));
 return a * (1.0-fract(phase)) + b * fract(phase);
}
mat4 armySkin() {
 // Rigid equipment and most body vertices have only one or two influences.
 // Avoid fetching eight palette texels for each unused influence.
 mat4 skin = mat4(0.0);
 if (skinWeight.x > 0.0) skin += armyBone(skinIndex.x) * skinWeight.x;
 if (skinWeight.y > 0.0) skin += armyBone(skinIndex.y) * skinWeight.y;
 if (skinWeight.z > 0.0) skin += armyBone(skinIndex.z) * skinWeight.z;
 if (skinWeight.w > 0.0) skin += armyBone(skinIndex.w) * skinWeight.w;
 return armyBindInverse * skin * armyBind;
}
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
                return armyMeshMatchesRole(mesh, role);
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
    // The complete textured pack owns all nine roles, including each mount's
    // independent skeleton. Earlier procedural sources remain available.
    return loadArmySource(usePrototypes ? await publishedArmyUrl(faction, detail) : `/models/battle/${faction}-army${suffix}.glb`, ARMY_ROLES, !usePrototypes);
}

/** Load an explicitly selected imported role without claiming a complete faction pack. */
export function loadArmyRole(url: string, role: ArmyRole): Promise<Army> {
    return loadArmyRoles(url, [role]);
}

/** Load a batch once so its roles share imported textures and rig resources. */
export function loadArmyRoles(url: string, roles: readonly ArmyRole[]): Promise<Army> {
    if (!roles.length || new Set(roles).size !== roles.length || roles.some(role => !ARMY_ROLES.includes(role))) throw new Error('Expected distinct army roles');
    return loadArmySource(url, roles, false);
}

/**
 * Apply both detail overrides together. Success transfers base and override ownership
 * to the returned armies; failure releases overrides and returns the untouched bases.
 * Shared sources stay live until both returned detail owners have released them.
 */
export function overlayArmyRolePair(baseNear: Army, baseFar: Army, role: ArmyRole, partials: readonly [PromiseSettledResult<Army>, PromiseSettledResult<Army>]): { near: Army; far: Army; applied: boolean } {
    return overlayArmyRolesPair(baseNear, baseFar, [role], partials);
}

/** Apply a whole role batch only when both detail sources contain every role. */
export function overlayArmyRolesPair(baseNear: Army, baseFar: Army, roles: readonly ArmyRole[], partials: readonly [PromiseSettledResult<Army>, PromiseSettledResult<Army>]): { near: Army; far: Army; applied: boolean } {
    const isRoleSource = (result: PromiseSettledResult<Army>): result is PromiseFulfilledResult<Army> =>
        result.status === 'fulfilled' && roles.length > 0 && new Set(roles).size === roles.length && result.value.parts.size === roles.length && roles.every(role => !!result.value.parts.get(role)?.length);
    if (!isRoleSource(partials[0]) || !isRoleSource(partials[1])) {
        const released = new Set<Army>();
        for (const result of partials) if (result.status === 'fulfilled' && result.value !== baseNear && result.value !== baseFar && !released.has(result.value)) {
            released.add(result.value); result.value.dispose();
        }
        return { near: baseNear, far: baseFar, applied: false };
    }
    const owners = new Map<Army, number>();
    const sources = [[baseNear, partials[0].value], [baseFar, partials[1].value]];
    for (const pair of sources) for (const source of new Set(pair)) owners.set(source, (owners.get(source) ?? 0) + 1);
    const compose = (base: Army, override: Army): Army => {
        const parts = new Map(base.parts); for (const role of roles) parts.set(role, override.parts.get(role)!);
        let disposed = false;
        return { parts, dispose() {
            if (disposed) return;
            disposed = true;
            for (const source of new Set([base, override])) {
                const remaining = owners.get(source)! - 1; owners.set(source, remaining);
                if (!remaining) source.dispose();
            }
        } };
    };
    return { near: compose(baseNear, partials[0].value), far: compose(baseFar, partials[1].value), applied: true };
}

export function armyRole(f: Formation, formations: readonly Formation[]): ArmyRole {
    const peers = formations.filter(other => other.owner_id === f.owner_id && other.unit_type === f.unit_type && other.battle_id === f.battle_id).sort((a, b) => a.id - b.id);
    const index = peers.findIndex(other => other.id === f.id);
    return f.unit_type === 'archers' ? 'archer' : f.unit_type === 'cavalry' ? (['scout','light_cavalry','heavy_cavalry'] as const)[Math.max(0,index)%3] : (['line_infantry','spear_guard','elite'] as const)[Math.max(0,index)%3];
}

export function createArmyFactory(own: Army, enemy: Army, playerId: string, formations: readonly Formation[], ownFar?: Army, enemyFar?: Army): SoldierVisualFactory {
    return formation => {
        const role=armyRole(formation, formations), ours=formation.owner_id===playerId;
        const army=ours ? own : enemy,parts=army.parts.get(role)!;
        // Oversized fantasy mounts need room for their actual anatomy. These
        // offsets are presentation only; logical formations keep their rules.
        const customMount=parts.some(part=>typeof part.mesh.userData.peris_mount_species==='string');
        let bounds:Box3|undefined;
        if(customMount){
            let cached=roleBounds.get(army);if(!cached){cached=new Map();roleBounds.set(army,cached);}
            bounds=cached.get(role);if(!bounds){bounds=armyIdleBounds(army,role);cached.set(role,bounds);}
        }
        const near=createArmyVisual(parts,bounds);
        const source=ours ? ownFar : enemyFar;
        if(!source)return near;
        const far=createArmyVisual(source.parts.get(role)!,bounds);const object=new Group();object.add(near.object,far.object);
        if(bounds){object.userData.renderFootprint=near.object.userData.renderFootprint;object.userData.inspectionBounds=new Box3();}
        return {object,update(frame:SoldierFrame){const detailed=frame.detail!=='far';near.object.visible=detailed;far.object.visible=!detailed;const active=detailed?near:far;active.update(frame);if(bounds)object.userData.inspectionBounds.copy(active.object.userData.inspectionBounds);},dispose(){near.dispose();far.dispose();object.clear();}};
    };
}

function createArmyVisual(parts: Part[], bounds?: Box3) {
    const object = new Group(), clock = { value: 0 }, dummy = new Object3D(), local = new Matrix4(), instance = new Matrix4();
    const footprint:RenderFootprint={depthScale:1,widthScale:1},unitBounds=new Box3();
    if(bounds){
        const size=bounds.getSize(new Vector3());
        // Leave a small clearance for animation and per-soldier scale variation.
        footprint.depthScale=Math.max(1,(size.x*1.08+1)/8);footprint.widthScale=Math.max(1,(size.z*1.08+1)/8);
        object.userData.renderFootprint=footprint;object.userData.inspectionBounds=new Box3();
    }
    const meshes: InstancedMesh[] = [], disposables: { dispose(): void }[] = [];
    const motion = new InstancedBufferAttribute(new Float32Array(120 * 2), 2);
    for (const { mesh, palette, legacySurface } of parts) {
        const geometry = mesh.geometry.clone(); geometry.setAttribute('instanceMotion', motion);
        const uniforms = { armyBones: { value: palette }, armyClock: clock, armyBind: { value: mesh.bindMatrix }, armyBindInverse: { value: mesh.bindMatrixInverse } };
        const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => material.clone());
        const surface = materials.find(material => material instanceof MeshStandardMaterial) as MeshStandardMaterial | undefined;
        const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: surface?.side, map: surface?.map, alphaMap: surface?.alphaMap, alphaTest: surface?.alphaTest });
        for (const m of [...materials, depth]) {
            m.customProgramCacheKey = () => `peris-instanced-rig-v4-${legacySurface && m !== depth ? 'wear' : 'pbr'}`;
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
    let placement: { id: number; soldiers: number; columns: number; x: number; y: number; facing: number } | undefined;
    let lastMotion = -1;
    return { object, update(frame: SoldierFrame) {
        const { formation: f, pose } = frame, angle = pose.facing * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
        clock.value = frame.animate ? frame.time : clock.value;
        const moved = !placement || placement.id !== f.id || placement.soldiers !== f.soldiers || placement.columns !== f.columns || placement.x !== pose.x || placement.y !== pose.y || placement.facing !== pose.facing;
        const animation = frame.animate ? f.status === 'moving' || f.status === 'routed' ? 1 : strikeAnimation(f, frame.battleTime) ? 2 : 0 : 0;
        if (moved) {
            // Battlefield height is fixed for this scene. Animation is in the
            // bone palette, so a stationary formation needs no matrix uploads.
            const slots = soldierSlots(f);
            if(bounds)object.userData.inspectionBounds.makeEmpty();
            for (const [i, slot] of slots.entries()) {
                const sx=slot.x*footprint.depthScale,sz=slot.y*footprint.widthScale;
                const x = pose.x + sx * cos - sz * sin, z = pose.y + sx * sin + sz * cos;
                dummy.position.set(x, frame.height(x,z), z); dummy.rotation.set(0,-angle,0);
                dummy.scale.setScalar(1 + Math.sin(i*37+f.id)*.035); dummy.updateMatrix(); local.copy(dummy.matrix);
                if(bounds)object.userData.inspectionBounds.union(unitBounds.copy(bounds).applyMatrix4(local));
                for (const batch of meshes) { instance.multiplyMatrices(local, batch.userData.templateMatrix as Matrix4); batch.setMatrixAt(i,instance); }
            }
            for (const batch of meshes) { batch.count = slots.length; batch.instanceMatrix.needsUpdate = true; batch.computeBoundingSphere(); if(batch.boundingSphere) batch.boundingSphere.radius+=3; }
            placement = { id: f.id, soldiers: f.soldiers, columns: f.columns, x: pose.x, y: pose.y, facing: pose.facing };
        }
        if (moved || lastMotion !== animation) {
            for (let i = 0; i < Math.max(0,Math.min(120,f.soldiers)); i++) motion.setXY(i, (i*.618033+f.id*.13)%1, animation);
            motion.needsUpdate = true; lastMotion = animation;
        }
    }, dispose() { if (disposed) return; disposed = true; disposables.forEach(item => item.dispose()); object.clear(); } };
}

/** Siege remains an inspectable visual prototype; it does not invent combat or research rules. */
export function armyIdleBounds(army: Army, role: ArmyRole) {
    const bounds = new Box3(), point = new Vector3(), input = new Vector4(), transformed = new Vector4(), weighted = new Vector4();
    const indices = new Vector4(), weights = new Vector4(), bone = new Matrix4();
    for (const {mesh,palette} of army.parts.get(role)!) {
        const position=mesh.geometry.getAttribute('position'), skinIndex=mesh.geometry.getAttribute('skinIndex'), skinWeight=mesh.geometry.getAttribute('skinWeight');
        const data=palette.image.data as Float32Array;
        for (let vertex=0;vertex<position.count;vertex++) {
            input.set(position.getX(vertex),position.getY(vertex),position.getZ(vertex),1).applyMatrix4(mesh.bindMatrix);
            indices.set(skinIndex.getX(vertex),skinIndex.getY(vertex),skinIndex.getZ(vertex),skinIndex.getW(vertex));
            weights.set(skinWeight.getX(vertex),skinWeight.getY(vertex),skinWeight.getZ(vertex),skinWeight.getW(vertex)); weighted.set(0,0,0,0);
            for (let influence=0;influence<4;influence++) {
                const weight=weights.getComponent(influence);
                if(weight>0)weighted.add(transformed.copy(input).applyMatrix4(bone.fromArray(data,indices.getComponent(influence)*16)).multiplyScalar(weight));
            }
            weighted.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
            if(weighted.w)bounds.expandByPoint(point.set(weighted.x/weighted.w,weighted.y/weighted.w,weighted.z/weighted.w));
        }
    }
    return bounds;
}

export function siegeShowcase(army: Army, role: 'ram' | 'catapult', position: Vector3) {
    // Use the same baked skin pose as the troops. A plain Mesh would display
    // an undeformed rest mesh when a siege beast has articulated limbs.
    const visual = createArmyVisual(army.parts.get(role)!), group = visual.object;
    visual.update({ formation: { id: 0, soldiers: 1, columns: 1, status: 'idle' } as Formation, pose: { x: 0, y: 0, facing: 0 }, time: 0, dt: 0, animate: false, height: () => 0 });
    group.position.copy(position);
    group.userData.inspectionBounds = armyIdleBounds(army,role);
    group.userData.disposeShowcase = () => visual.dispose();
    // Source textures are released by Army, after visual materials/geometry.
    group.traverse(node => { node.userData.armySourceOwned = true; });
    return group;
}
