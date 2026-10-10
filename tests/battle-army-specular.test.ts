import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClip, Bone, BoxGeometry, BufferAttribute, DataTexture, Group, InstancedMesh, MeshPhysicalMaterial, RGBAFormat, Skeleton, SkinnedMesh, Texture, VectorKeyframeTrack } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createArmyFactory, loadArmyRole } from '../src/features/battle/rendering/three/armyAssets';
import { newBattle } from '../src/features/battle/domain/creation';
import { createSolo } from '../src/features/campaign/domain/newRealm';

test('authored glTF specular material and alpha atlas survive battle instancing and source cleanup', async () => {
    const loader = new GLTFLoader();
    const parsed = await loader.parseAsync(JSON.stringify({ asset: { version: '2.0' }, extensionsUsed: ['KHR_materials_specular'], scene: 0, scenes: [{}], materials: [{ extensions: { KHR_materials_specular: { specularFactor: .09 } } }] }), '');
    const material = await parsed.parser.getDependency('material', 0) as MeshPhysicalMaterial;
    assert.equal(material.isMeshPhysicalMaterial, true, 'The installed loader recognizes the authored extension');
    assert.equal(material.specularIntensity, .09);
    const specular = new DataTexture(new Uint8Array([255, 255, 255, 23]), 1, 1, RGBAFormat), color = new Texture();
    material.specularIntensityMap = specular; material.map = color;
    const geometry = new BoxGeometry(), count = geometry.attributes.position.count;
    geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(count * 4), 4));
    const weights = new Float32Array(count * 4); for (let index = 0; index < count; index++) weights[index * 4] = 1;
    geometry.setAttribute('skinWeight', new BufferAttribute(weights, 4));
    const scene = new Group(), mesh = new SkinnedMesh(geometry, material), bone = new Bone();
    mesh.name = 'line_infantry body'; bone.name = 'pilot_bone'; mesh.add(bone); scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(new Skeleton([bone]));
    const animations = ['idle', 'walk', 'attack'].map(state => new AnimationClip(`line_infantry_${state}`, 1, [new VectorKeyframeTrack('pilot_bone.position', [0, 1], [0, 0, 0, 0, 0, 0])]));
    const released = new Map<object, number>();
    for (const resource of [geometry, material, color, specular]) { released.set(resource, 0); resource.addEventListener('dispose', () => released.set(resource, released.get(resource)! + 1)); }
    const original = GLTFLoader.prototype.loadAsync;
    let army: Awaited<ReturnType<typeof loadArmyRole>> | undefined;
    try {
        GLTFLoader.prototype.loadAsync = async () => ({ scene, animations } as GLTF);
        army = await loadArmyRole('/local-pilot.glb', 'line_infantry');
        const world = createSolo('specular atlas'), data = { ...world.armies[0], infantry: 60, archers: 0, cavalry: 0 };
        const { formations } = newBattle(71, 'solo-ruler', data, data, 'plains', 'normal', 'specular atlas', 'practice');
        const formation = formations.find(item => item.owner_id)!;
        const visual = createArmyFactory(army, army, 'solo-ruler', formations)(formation);
        const batch = visual.object.children[0] as InstancedMesh, cloned = batch.material as MeshPhysicalMaterial;
        assert.notEqual(cloned, material); assert.equal(cloned.isMeshPhysicalMaterial, true);
        assert.equal(cloned.specularIntensity, .09); assert.equal(cloned.specularIntensityMap, specular);
        assert.equal(cloned.map, color);
        const program = { uniforms: {}, vertexShader: 'void main() {\n#include <begin_vertex>\n#include <beginnormal_vertex>\n}', fragmentShader: '#include <roughnessmap_fragment>\n#include <lights_physical_fragment>' } as Parameters<MeshPhysicalMaterial['onBeforeCompile']>[0];
        cloned.onBeforeCompile(program, {} as Parameters<MeshPhysicalMaterial['onBeforeCompile']>[1]);
        assert.match(program.vertexShader, /armySkinMatrix/); assert.match(program.fragmentShader, /lights_physical_fragment/);
        visual.dispose(); visual.dispose();
        for (const count of released.values()) assert.equal(count, 0, 'Visuals retain borrowed source textures');
        army.dispose(); army.dispose();
        for (const count of released.values()) assert.equal(count, 1, 'The added specular atlas is released exactly once');
    } finally { GLTFLoader.prototype.loadAsync = original; army?.dispose(); }
});
