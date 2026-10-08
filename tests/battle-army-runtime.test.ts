import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClip, Bone, BoxGeometry, BufferAttribute, Group, InstancedMesh, Mesh, MeshStandardMaterial, Skeleton, SkinnedMesh, Texture, VectorKeyframeTrack, Vector3 } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ARMY_ROLES, armyRole, createArmyFactory, loadArmy, siegeShowcase, type ArmyRole } from '../src/features/battle/rendering/three/armyAssets';
import { disposeObject } from '../src/features/battle/rendering/three/dispose';
import { newBattle } from '../src/features/battle/domain/creation';
import { createSolo } from '../src/features/campaign/domain/newRealm';

function fixture(roles: readonly ArmyRole[] = ARMY_ROLES, separateRigs = false) {
    const scene = new Group(), animations: AnimationClip[] = [], texture = new Texture();
    const resources: { dispose(): void; addEventListener(type: 'dispose', listener: () => void): void }[] = [texture];
    const disposals = new Map<object, number>();
    for (const role of roles) {
        const group = new Group(); group.name = role; scene.add(group);
        const tracks: VectorKeyframeTrack[] = [];
        for (let rig = 0; rig < (separateRigs && role === 'heavy_cavalry' ? 2 : 1); rig++) {
            const geometry = new BoxGeometry(), count = geometry.attributes.position.count;
            geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(count * 4), 4));
            const weights = new Float32Array(count * 4); for (let index = 0; index < count; index++) weights[index * 4] = 1;
            geometry.setAttribute('skinWeight', new BufferAttribute(weights, 4));
            const material = new MeshStandardMaterial({ map: texture }); material.color.setRGB(.5, .5, .5);
            const mesh = new SkinnedMesh(geometry, material), bone = new Bone(); bone.name = `${role}_bone_${rig}`;
            const bones = [bone]; mesh.add(bone); group.add(mesh);
            if (rig) { const child = new Bone(); bone.add(child); bones.push(child); }
            scene.updateMatrixWorld(true); mesh.bind(new Skeleton(bones));
            tracks.push(new VectorKeyframeTrack(`${bone.name}.position`, [0, 1], [0, 0, 0, rig ? 7 : 1, 0, 0]));
            resources.push(geometry, material);
        }
        for (const name of ['idle', 'walk', 'attack']) animations.push(new AnimationClip(`${role}_${name}`, 1, tracks));
    }
    for (const resource of resources) { disposals.set(resource, 0); resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource)! + 1)); }
    return { gltf: { scene, animations } as GLTF, resources, disposals, texture };
}

test('army sources retain separate mount rigs and own shared GPU resources through success and load failures', async t => {
    const original = GLTFLoader.prototype.loadAsync;
    try {
        await t.test('two rig palettes keep different bone counts and animation transforms', async () => {
            const base = fixture(), prototype = fixture(['line_infantry', 'heavy_cavalry'], true), requested: string[] = [];
            GLTFLoader.prototype.loadAsync = async url => { requested.push(url); return url.includes('reference-prototypes') ? prototype.gltf : base.gltf; };
            const army = await loadArmy('roman', 'far', true), cavalry = army.parts.get('heavy_cavalry')!;
            assert.deepEqual(requested, ['/models/battle/roman-army-lod.glb', '/models/battle/reference-prototypes-lod.glb']);
            assert.equal(cavalry.length, 2); assert.notEqual(cavalry[0].palette, cavalry[1].palette);
            assert.equal(cavalry[0].palette.image.width, 4); assert.equal(cavalry[1].palette.image.width, 8);
            const first = cavalry[0].palette.image.data as Float32Array, second = cavalry[1].palette.image.data as Float32Array;
            assert.ok(Math.abs(first[36 * 16 + 12] - .5) < .001);
            assert.ok(Math.abs(second[36 * 32 + 12] - 3.5) < .001);
            assert.equal((cavalry[0].mesh.material as MeshStandardMaterial).color.r, .5, 'Imported PBR factors retain glTF linear values');
            const world = createSolo('rig test'), armyData = { ...world.armies[0], infantry: 180, archers: 30, cavalry: 60 };
            const { formations } = newBattle(17, 'solo-ruler', armyData, armyData, 'plains', 'normal', 'rig test', 'practice');
            const f = formations.find(f => f.owner_id && armyRole(f, formations) === 'heavy_cavalry')!;
            const factory = createArmyFactory(army, army, 'solo-ruler', formations);
            const one = factory(f), two = factory(f), batch = one.object.children[0] as InstancedMesh;
            assert.notEqual(batch.geometry, cavalry[0].mesh.geometry);
            const sourceMaterial = cavalry[0].mesh.material as MeshStandardMaterial, clonedMaterial = batch.material as MeshStandardMaterial;
            assert.notEqual(clonedMaterial, sourceMaterial); assert.equal(clonedMaterial.map, sourceMaterial.map);
            one.dispose(); one.dispose(); two.dispose();
            for (const resource of [...base.resources, ...prototype.resources]) assert.equal((base.disposals.get(resource) ?? prototype.disposals.get(resource)), 0);
            const showcase = siegeShowcase(army, 'ram', new Vector3()); disposeObject(showcase);
            for (const resource of base.resources) assert.equal(base.disposals.get(resource), 0, 'Scene does not dispose borrowed siege assets');
            army.dispose(); army.dispose();
            for (const resource of [...base.resources, ...prototype.resources]) assert.equal((base.disposals.get(resource) ?? prototype.disposals.get(resource)), 1);
        });
        await t.test('non-Roman armies retain their normal models even when the opt-in is set', async () => {
            const base = fixture(), requested: string[] = [];
            GLTFLoader.prototype.loadAsync = async url => { requested.push(url); return base.gltf; };
            const army = await loadArmy('orc', 'near', true); army.dispose();
            assert.deepEqual(requested, ['/models/battle/orc-army.glb']);
        });
        await t.test('failed prototype baking releases the base and every partially loaded source resource', async () => {
            const base = fixture(), prototype = fixture(['line_infantry', 'heavy_cavalry'], true);
            prototype.gltf.animations = prototype.gltf.animations.filter(clip => clip.name !== 'heavy_cavalry_attack');
            GLTFLoader.prototype.loadAsync = async url => url.includes('reference-prototypes') ? prototype.gltf : base.gltf;
            await assert.rejects(loadArmy('roman', 'near', true), /Missing heavy_cavalry attack/);
            for (const resource of [...base.resources, ...prototype.resources]) assert.equal((base.disposals.get(resource) ?? prototype.disposals.get(resource)), 1);
        });
    } finally { GLTFLoader.prototype.loadAsync = original; }
});

test('scene cleanup disposes a shared terrain map and bump map once', () => {
    const texture = new Texture(), material = new MeshStandardMaterial({ map: texture, bumpMap: texture }), root = new Group();
    root.add(new Mesh(new BoxGeometry(), material), new Mesh(new BoxGeometry(), material));
    let disposed = 0; texture.addEventListener('dispose', () => disposed++);
    disposeObject(root); assert.equal(disposed, 1);
});

test('army source cleanup closes shared ImageBitmaps once on success and baking failure', async () => {
    const originalLoader = GLTFLoader.prototype.loadAsync;
    const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'ImageBitmap');
    class TestImageBitmap { closes = 0; close() { this.closes++; } }
    Object.defineProperty(globalThis, 'ImageBitmap', { configurable: true, writable: true, value: TestImageBitmap });
    try {
        for (const fails of [false, true]) {
            const source = fixture(), image = new TestImageBitmap();
            source.texture.image = image;
            // Two distinct glTF textures can refer to one decoded bitmap.
            const normal = new Texture(image);
            const mesh = source.gltf.scene.children[0].children[0] as SkinnedMesh;
            (mesh.material as MeshStandardMaterial).normalMap = normal;
            let textureDisposals = 0; normal.addEventListener('dispose', () => textureDisposals++);
            if (fails) source.gltf.animations = source.gltf.animations.filter(clip => clip.name !== 'line_infantry_attack');
            GLTFLoader.prototype.loadAsync = async () => source.gltf;
            if (fails) await assert.rejects(loadArmy('orc'), /Missing line_infantry attack/);
            else {
                const army = await loadArmy('orc');
                assert.equal(image.closes, 0, 'Bitmap remains available while the source is live');
                army.dispose(); army.dispose();
            }
            assert.equal(image.closes, 1, 'Decoded image is closed exactly once');
            assert.equal(textureDisposals, 1);
            for (const resource of source.resources) assert.equal(source.disposals.get(resource), 1);
        }
    } finally {
        GLTFLoader.prototype.loadAsync = originalLoader;
        if (originalBitmap) Object.defineProperty(globalThis, 'ImageBitmap', originalBitmap);
        else Reflect.deleteProperty(globalThis, 'ImageBitmap');
    }
});
