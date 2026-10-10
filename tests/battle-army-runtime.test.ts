import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClip, Bone, Box3, BoxGeometry, BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshDepthMaterial, MeshStandardMaterial, Skeleton, SkinnedMesh, Texture, VectorKeyframeTrack, Vector3 } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ARMY_ROLES, armyIdleBounds, armyRole, createArmyFactory, loadArmy, loadBattleArmy, loadArmyRole, loadArmyRoles, overlayArmyRolePair, overlayArmyRolesPair, siegeShowcase, type ArmyRole } from '../src/features/battle/rendering/three/armyAssets';
import { disposeObject } from '../src/features/battle/rendering/three/dispose';
import { newBattle } from '../src/features/battle/domain/creation';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { BattleCamera } from '../src/features/battle/rendering/three/BattleCamera';

const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => new Response(JSON.stringify({ factions: Object.fromEntries(['roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'].map(id => [id, { near: { sha256: 'a'.repeat(64) }, far: { sha256: 'b'.repeat(64) } }])) })); });
after(() => { globalThis.fetch = originalFetch; });

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

test('a multi-role batch shares its import, replaces both details together and releases resources once', async () => {
    const original = GLTFLoader.prototype.loadAsync;
    const roles = ['spear_guard', 'elite', 'archer'] as const;
    try {
        for (const missingClip of [false, true]) {
            const sources = new Map<string, ReturnType<typeof fixture>>();
            GLTFLoader.prototype.loadAsync = async url => { url = url.split('?')[0];
                const source = fixture(url.startsWith('/batch') ? roles : ARMY_ROLES);
                if (missingClip && url === '/batch-far.glb') source.gltf.animations = source.gltf.animations.filter(clip => clip.name !== 'elite_attack');
                sources.set(url, source); return source.gltf;
            };
            const baseNear = await loadArmy('orc'), baseFar = await loadArmy('orc', 'far');
            const pair = await Promise.allSettled([loadArmyRoles('/batch-near.glb', roles), loadArmyRoles('/batch-far.glb', roles)]);
            const result = overlayArmyRolesPair(baseNear, baseFar, roles, pair);
            assert.equal(result.applied, !missingClip);
            assert.equal(sources.size, 4, 'Each three-role detail is imported once');
            for (const [detail, base, composed] of [['near', baseNear, result.near], ['far', baseFar, result.far]] as const) {
                assert.equal(composed.parts.get('line_infantry'), base.parts.get('line_infantry'));
                for (const role of roles) assert.equal((composed.parts.get(role)![0].mesh.material as MeshStandardMaterial).map,
                    sources.get(missingClip ? `/models/battle/orc-army${detail === 'far' ? '-lod' : ''}.glb` : `/batch-${detail}.glb`)!.texture);
            }
            result.near.dispose(); result.far.dispose(); result.near.dispose(); result.far.dispose();
            for (const source of sources.values()) for (const resource of source.resources) assert.equal(source.disposals.get(resource), 1);
        }
    } finally { GLTFLoader.prototype.loadAsync = original; }
});

test('battle graphics toggles reuse published rigs and the final lease frees them exactly once', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const original = GLTFLoader.prototype.loadAsync, source = fixture(); let imports = 0;
    try {
        GLTFLoader.prototype.loadAsync = async () => { imports++; return source.gltf; };
        const first = await loadBattleArmy('gnome', 'near', true);
        const second = await loadBattleArmy('gnome', 'near', true);
        assert.equal(imports, 1); assert.equal(first.parts, second.parts);
        first.dispose(); second.dispose(); first.dispose();
        t.mock.timers.tick(5000);
        const resumed = await loadBattleArmy('gnome', 'near', true);
        assert.equal(imports, 1, 'Returning to 3D keeps the same imported rig');
        t.mock.timers.tick(10000);
        for (const resource of source.resources) assert.equal(source.disposals.get(resource), 0);
        resumed.dispose(); t.mock.timers.tick(10000);
        for (const resource of source.resources) assert.equal(source.disposals.get(resource), 1);
    } finally { GLTFLoader.prototype.loadAsync = original; }
});

function partialFixture(role: ArmyRole = 'line_infantry') {
    const source = fixture([role]), group = source.gltf.scene.children[0], body = group.children[0] as SkinnedMesh;
    body.name = `${role} body`; body.userData.asset_license = 'CC-BY-SA-3.0';
    const geometry = body.geometry.clone(), material = (body.material as MeshStandardMaterial).clone();
    material.normalMap = source.texture;
    const head = new SkinnedMesh(geometry, material); head.name = `${role} licensed-head`;
    head.userData = { asset_license: 'CC-BY-4.0', asset_author: 'Reference creator', source_file_sha256: 'retained-source-hash', runtime_approved: false };
    group.add(head); source.gltf.scene.updateMatrixWorld(true); head.bind(body.skeleton, body.bindMatrix);
    for (const resource of [geometry, material]) {
        source.resources.push(resource); source.disposals.set(resource, 0);
        resource.addEventListener('dispose', () => source.disposals.set(resource, source.disposals.get(resource)! + 1));
    }
    return source;
}

test('a copied light mount with a stale heavy ancestor does not enter the heavy formation', async () => {
    const original = GLTFLoader.prototype.loadAsync;
    const source = fixture(['light_cavalry', 'heavy_cavalry']);
    for (const group of source.gltf.scene.children) {
        for (const mesh of group.children) if ((mesh as SkinnedMesh).isSkinnedMesh) mesh.userData.peris_role = group.name;
    }
    source.gltf.scene.children[0].name = 'heavy_cavalry copied ancestor';
    // GLTFLoader puts extras on a Group for a node with multiple surfaces.
    const lightParent = source.gltf.scene.children[0], lightMesh = lightParent.children[0];
    lightMesh.userData = {};
    const surfaces = new Group(); surfaces.name = 'copied model surfaces'; surfaces.userData.peris_role = 'light_cavalry';
    surfaces.add(lightMesh); lightParent.add(surfaces);
    try {
        GLTFLoader.prototype.loadAsync = async () => source.gltf;
        const army = await loadArmyRoles('/copied-mount.glb', ['light_cavalry', 'heavy_cavalry']);
        assert.equal(army.parts.get('light_cavalry')!.length, 1);
        assert.equal(army.parts.get('heavy_cavalry')!.length, 1);
        assert.equal(army.parts.get('heavy_cavalry')![0].mesh.userData.peris_role, 'heavy_cavalry');
        army.dispose();
    } finally { GLTFLoader.prototype.loadAsync = original; }
});

function resourceDisposals(source: ReturnType<typeof fixture>, count: number) {
    for (const resource of source.resources) assert.equal(source.disposals.get(resource), count);
}

function shaderPalette(batch: InstancedMesh, depth = false) {
    const material = (depth ? batch.customDepthMaterial : batch.material) as MeshStandardMaterial;
    const program = { uniforms: {}, vertexShader: 'void main() {\n#include <begin_vertex>\n#include <beginnormal_vertex>\n}', fragmentShader: '#include <roughnessmap_fragment>' } as Parameters<MeshStandardMaterial['onBeforeCompile']>[0];
    material.onBeforeCompile(program, {} as Parameters<MeshStandardMaterial['onBeforeCompile']>[1]);
    assert.match(program.vertexShader, /armySkinMatrix/);
    return program.uniforms.armyBones.value;
}

test('battle palettes retain a brief ground correction between the former 24 Hz samples', async () => {
    const original = GLTFLoader.prototype.loadAsync, source = fixture(['line_infantry']);
    try {
        const walk = source.gltf.animations.find(clip => clip.name === 'line_infantry_walk')!;
        walk.tracks = [new VectorKeyframeTrack('line_infantry_bone_0.position',
            [0, 1 / 48, 1 / 24, 1], [0, 0, 0, 0, .125, 0, 0, 0, 0, 0, 0, 0])];
        GLTFLoader.prototype.loadAsync = async () => source.gltf;
        const army = await loadArmyRole('/contact-correction.glb', 'line_infantry');
        const palette = army.parts.get('line_infantry')![0].palette;
        const data = palette.image.data as Float32Array;
        assert.ok(Math.abs(data[(48 + 1) * 16 + 13] - .125) < .00001,
            'The half-frame support correction reaches the GPU animation palette');
        army.dispose();
    } finally { GLTFLoader.prototype.loadAsync = original; }
});

test('a partial role preserves mixed source credits and shares its rig palette through near/far battle instancing', async () => {
    const original = GLTFLoader.prototype.loadAsync, sources = new Map<string, ReturnType<typeof fixture>>();
    try {
        GLTFLoader.prototype.loadAsync = async url => { url = url.split('?')[0];
            const source = url.includes('/pilot-') ? partialFixture() : fixture();
            sources.set(url, source); return source.gltf;
        };
        const baseNear = await loadArmy('orc'), baseFar = await loadArmy('orc', 'far');
        const enemyNear = await loadArmy('roman', 'near', true), enemyFar = await loadArmy('roman', 'far', true);
        const partials = await Promise.allSettled([loadArmyRole('/pilot-near.glb', 'line_infantry'), loadArmyRole('/pilot-far.glb', 'line_infantry')]);
        const applied = overlayArmyRolePair(baseNear, baseFar, 'line_infantry', partials);
        assert.equal(applied.applied, true); assert.notEqual(applied.near, baseNear); assert.notEqual(applied.far, baseFar);
        for (const [detail, army, base] of [['near', applied.near, baseNear], ['far', applied.far, baseFar]] as const) {
            assert.equal(army.parts.size, ARMY_ROLES.length);
            for (const role of ARMY_ROLES.filter(role => role !== 'line_infantry')) assert.equal(army.parts.get(role), base.parts.get(role));
            const parts = army.parts.get('line_infantry')!;
            assert.equal(parts.length, 2); assert.equal(parts[0].palette, parts[1].palette, 'Head and body share the same animation rig palette');
            assert.equal(parts[0].legacySurface, false); assert.equal(parts[1].legacySurface, false);
            assert.equal((parts[1].mesh.material as MeshStandardMaterial).color.r, .5);
            assert.deepEqual(parts[1].mesh.userData, { asset_license: 'CC-BY-4.0', asset_author: 'Reference creator', source_file_sha256: 'retained-source-hash', runtime_approved: false });
            assert.equal(parts[0].mesh.userData.asset_license, 'CC-BY-SA-3.0');
            assert.equal((parts[1].mesh.material as MeshStandardMaterial).normalMap, sources.get(`/pilot-${detail}.glb`)!.texture);
        }
        assert.deepEqual([...sources.keys()], ['/models/battle/orc-army.glb', '/models/battle/orc-army-lod.glb', '/models/battle/roman-roster.glb', '/models/battle/roman-roster-lod.glb', '/pilot-near.glb', '/pilot-far.glb']);
        const paletteDisposals = new Map<object, number>();
        for (const army of [baseNear, baseFar, enemyNear, enemyFar, applied.near, applied.far]) for (const parts of army.parts.values()) for (const { palette } of parts) {
            if (paletteDisposals.has(palette)) continue;
            paletteDisposals.set(palette, 0); palette.addEventListener('dispose', () => paletteDisposals.set(palette, paletteDisposals.get(palette)! + 1));
        }
        const world = createSolo('partial role'), armyData = { ...world.armies[0], infantry: 180, archers: 30, cavalry: 60 };
        const { formations } = newBattle(41, 'solo-ruler', armyData, armyData, 'plains', 'normal', 'partial role', 'practice');
        const factory = createArmyFactory(applied.near, enemyNear, 'solo-ruler', formations, applied.far, enemyFar);
        const ownLine = formations.find(f => f.owner_id && armyRole(f, formations) === 'line_infantry')!;
        const ownArcher = formations.find(f => f.owner_id && armyRole(f, formations) === 'archer')!;
        const enemyLine = formations.find(f => !f.owner_id && armyRole(f, formations) === 'line_infantry')!;
        const visuals = [factory(ownLine), factory(ownArcher), factory(enemyLine)];
        for (const detail of ['near', 'far'] as const) {
            const index = detail === 'near' ? 0 : 1, line = visuals[0], group = line.object.children[index];
            const parts = (detail === 'near' ? applied.near : applied.far).parts.get('line_infantry')!;
            for (const [status, state] of [['idle', 0], ['moving', 1], ['engaged', 2]] as const) {
                ownLine.status = status;
                line.update({ formation: ownLine, pose: { x: ownLine.x, y: ownLine.y, facing: ownLine.facing }, time: 1, dt: .016, animate: true, detail, height: () => 0 });
                assert.equal(group.visible, true); assert.equal(line.object.children[1 - index].visible, false);
                assert.equal(group.children.length, 2);
                for (const [partIndex, child] of group.children.entries()) {
                    const batch = child as InstancedMesh;
                    assert.equal(batch.count, ownLine.soldiers); assert.equal(batch.geometry.getAttribute('instanceMotion').getY(0), state);
                    assert.equal((batch.material as MeshStandardMaterial).map, sources.get(`/pilot-${detail}.glb`)!.texture);
                    assert.equal(shaderPalette(batch), parts[partIndex].palette);
                    assert.equal(shaderPalette(batch, true), parts[partIndex].palette, 'Shadow depth uses the same skin pose');
                }
                assert.equal((group.children[0] as InstancedMesh).geometry.getAttribute('instanceMotion'), (group.children[1] as InstancedMesh).geometry.getAttribute('instanceMotion'));
            }
            line.update({ formation: ownLine, pose: { x: ownLine.x, y: ownLine.y, facing: ownLine.facing }, time: 2, dt: 0, animate: false, detail, height: () => 0 });
            assert.equal((group.children[0] as InstancedMesh).geometry.getAttribute('instanceMotion').getY(0), 0, 'Paused pilot uses the idle pose');
            for (const [visualIndex, formation, url] of [[1, ownArcher, `/models/battle/orc-army${index ? '-lod' : ''}.glb`], [2, enemyLine, `/models/battle/roman-roster${index ? '-lod' : ''}.glb`]] as const) {
                const visual = visuals[visualIndex]; visual.update({ formation, pose: { x: formation.x, y: formation.y, facing: formation.facing }, time: 0, dt: 0, animate: false, detail, height: () => 0 });
                const unchanged = visual.object.children[index]; assert.equal(unchanged.children.length, 1);
                assert.equal(((unchanged.children[0] as InstancedMesh).material as MeshStandardMaterial).map, sources.get(url)!.texture);
            }
        }
        visuals.forEach(visual => { visual.dispose(); visual.dispose(); });
        for (const source of sources.values()) resourceDisposals(source, 0);
        for (const count of paletteDisposals.values()) assert.equal(count, 0, 'Visual cleanup does not free borrowed source palettes');
        for (const army of [applied.near, applied.far, enemyNear, enemyFar]) { army.dispose(); army.dispose(); }
        for (const source of sources.values()) resourceDisposals(source, 1);
        for (const count of paletteDisposals.values()) assert.equal(count, 1);
    } finally { GLTFLoader.prototype.loadAsync = original; }
});

test('a rejected partial detail keeps both base details and frees fulfilled or failed-bake resources once', async t => {
    const originalLoader = GLTFLoader.prototype.loadAsync, originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'ImageBitmap');
    class TestImageBitmap { closes = 0; close() { this.closes++; } }
    Object.defineProperty(globalThis, 'ImageBitmap', { configurable: true, writable: true, value: TestImageBitmap });
    try {
        for (const failedDetail of ['near', 'far']) for (const failure of ['network', 'missing-clip']) await t.test(`${failedDetail} ${failure}`, async () => {
            const sources = new Map<string, ReturnType<typeof fixture>>();
            GLTFLoader.prototype.loadAsync = async url => { url = url.split('?')[0];
                const failing = url === `/pilot-${failedDetail}.glb`;
                if (failing && failure === 'network') throw new Error('404 pilot');
                const source = url.includes('/pilot-') ? partialFixture() : fixture();
                source.texture.image = new TestImageBitmap(); sources.set(url, source);
                if (failing) source.gltf.animations = source.gltf.animations.filter(clip => clip.name !== 'line_infantry_attack');
                return source.gltf;
            };
            const near = await loadArmy('orc'), far = await loadArmy('orc', 'far');
            const partials = await Promise.allSettled([loadArmyRole('/pilot-near.glb', 'line_infantry'), loadArmyRole('/pilot-far.glb', 'line_infantry')]);
            assert.equal(partials[failedDetail === 'near' ? 0 : 1].status, 'rejected');
            const result = overlayArmyRolePair(near, far, 'line_infantry', partials);
            assert.equal(result.applied, false); assert.equal(result.near, near); assert.equal(result.far, far);
            for (const [url, source] of sources) {
                const count = url.includes('/pilot-') ? 1 : 0;
                resourceDisposals(source, count); assert.equal((source.texture.image as TestImageBitmap).closes, count);
            }
            result.near.dispose(); result.far.dispose(); result.near.dispose(); result.far.dispose();
            for (const source of sources.values()) { resourceDisposals(source, 1); assert.equal((source.texture.image as TestImageBitmap).closes, 1); }
        });
    } finally {
        GLTFLoader.prototype.loadAsync = originalLoader;
        if (originalBitmap) Object.defineProperty(globalThis, 'ImageBitmap', originalBitmap);
        else Reflect.deleteProperty(globalThis, 'ImageBitmap');
    }
});

test('role pair overlay rejects mismatched partial roles without disposing its base armies', async () => {
    const original = GLTFLoader.prototype.loadAsync, sources: ReturnType<typeof fixture>[] = [];
    try {
        GLTFLoader.prototype.loadAsync = async url => { url = url.split('?')[0];
            const source = url === '/scout.glb' ? partialFixture('scout') : url === '/line.glb' ? partialFixture() : fixture();
            sources.push(source); return source.gltf;
        };
        const near = await loadArmy('orc'), far = await loadArmy('orc', 'far');
        const partials = await Promise.allSettled([loadArmyRole('/scout.glb', 'scout'), loadArmyRole('/line.glb', 'line_infantry')]);
        const result = overlayArmyRolePair(near, far, 'line_infantry', partials);
        assert.equal(result.applied, false); assert.equal(result.near, near); assert.equal(result.far, far);
        resourceDisposals(sources[0], 0); resourceDisposals(sources[1], 0); resourceDisposals(sources[2], 1); resourceDisposals(sources[3], 1);
        result.near.dispose(); result.far.dispose();
    } finally { GLTFLoader.prototype.loadAsync = original; }
});

test('shared near/far sources survive the first composite disposal and release exactly once after both owners', async () => {
    const original = GLTFLoader.prototype.loadAsync, baseSource = fixture(), partialSource = partialFixture();
    try {
        GLTFLoader.prototype.loadAsync = async url => url === '/shared-pilot.glb' ? partialSource.gltf : baseSource.gltf;
        const base = await loadArmy('orc'), partial = await loadArmyRole('/shared-pilot.glb', 'line_infantry');
        const fulfilled = { status: 'fulfilled', value: partial } as const;
        const result = overlayArmyRolePair(base, base, 'line_infantry', [fulfilled, fulfilled]);
        let baseReleases = 0, partialReleases = 0;
        const disposeBase = base.dispose, disposePartial = partial.dispose;
        base.dispose = () => { baseReleases++; disposeBase(); }; partial.dispose = () => { partialReleases++; disposePartial(); };
        result.near.dispose(); result.near.dispose();
        resourceDisposals(baseSource, 0); resourceDisposals(partialSource, 0);
        assert.equal(baseReleases, 0); assert.equal(partialReleases, 0);
        result.far.dispose(); result.far.dispose();
        resourceDisposals(baseSource, 1); resourceDisposals(partialSource, 1);
        assert.equal(baseReleases, 1); assert.equal(partialReleases, 1);
    } finally { GLTFLoader.prototype.loadAsync = original; }
});

test('army sources retain separate mount rigs and own shared GPU resources through success and load failures', async t => {
    const original = GLTFLoader.prototype.loadAsync;
    try {
        await t.test('two rig palettes keep different bone counts and animation transforms', async () => {
            const prototype = fixture(ARMY_ROLES, true), requested: string[] = [];
            const cutout = prototype.gltf.scene.children.find(group=>group.name==='heavy_cavalry')!.children[0] as SkinnedMesh;
            (cutout.material as MeshStandardMaterial).alphaTest=.5;
            GLTFLoader.prototype.loadAsync = async url => { url = url.split('?')[0]; requested.push(url); return prototype.gltf; };
            const army = await loadArmy('roman', 'far', true), cavalry = army.parts.get('heavy_cavalry')!;
            assert.deepEqual(requested, ['/models/battle/roman-roster-lod.glb']);
            assert.equal(army.parts.size,9,'The textured roster supplies every role');
            assert.equal(cavalry.length, 2); assert.notEqual(cavalry[0].palette, cavalry[1].palette);
            assert.equal(cavalry[0].palette.image.width, 4); assert.equal(cavalry[1].palette.image.width, 8);
            const first = cavalry[0].palette.image.data as Float32Array, second = cavalry[1].palette.image.data as Float32Array;
            assert.equal(cavalry[0].palette.image.height, 144);
            assert.ok(Math.abs(first[72 * 16 + 12] - .5) < .001);
            assert.ok(Math.abs(second[72 * 32 + 12] - 3.5) < .001);
            assert.equal((cavalry[0].mesh.material as MeshStandardMaterial).color.r, .5, 'Imported PBR factors retain glTF linear values');
            const world = createSolo('rig test'), armyData = { ...world.armies[0], infantry: 180, archers: 30, cavalry: 60 };
            const { formations } = newBattle(17, 'solo-ruler', armyData, armyData, 'plains', 'normal', 'rig test', 'practice');
            const f = formations.find(f => f.owner_id && armyRole(f, formations) === 'heavy_cavalry')!;
            const factory = createArmyFactory(army, army, 'solo-ruler', formations);
            const one = factory(f), two = factory(f), batch = one.object.children[0] as InstancedMesh;
            assert.notEqual(batch.geometry, cavalry[0].mesh.geometry);
            const sourceMaterial = cavalry[0].mesh.material as MeshStandardMaterial, clonedMaterial = batch.material as MeshStandardMaterial;
            assert.notEqual(clonedMaterial, sourceMaterial); assert.equal(clonedMaterial.map, sourceMaterial.map);
            const depth=batch.customDepthMaterial as MeshDepthMaterial;
            assert.equal(depth.map,sourceMaterial.map);assert.equal(depth.alphaTest,.5,'Shadow masks must preserve the mount mane and helmet crest cutouts');
            one.dispose(); one.dispose(); two.dispose();
            for (const resource of prototype.resources) assert.equal(prototype.disposals.get(resource), 0);
            const showcase = siegeShowcase(army, 'ram', new Vector3()), prop = showcase.children[0] as InstancedMesh;
            assert.equal(prop.count,1,'Siege studies use one correctly skinned instance');
            assert.notEqual(prop.geometry,army.parts.get('ram')![0].mesh.geometry);
            let visualDisposals=0; prop.geometry.addEventListener('dispose',()=>visualDisposals++);
            showcase.userData.disposeShowcase(); disposeObject(showcase);
            assert.equal(visualDisposals,1,'Showcase cleanup releases its cloned geometry');
            for (const resource of prototype.resources) assert.equal(prototype.disposals.get(resource), 0, 'Scene does not dispose borrowed siege source assets');
            army.dispose(); army.dispose();
            for (const resource of prototype.resources) assert.equal(prototype.disposals.get(resource), 1);
        });
        await t.test('all factions use their own textured pack while the earlier pack stays explicitly available', async () => {
            for (const faction of ['orc','elf','dwarf','gnome','pandaren','undead','demon','spartan','persian','egyptian'] as const) {
                const source = fixture(ARMY_ROLES,true), requested: string[] = [];
                GLTFLoader.prototype.loadAsync = async url => { url = url.split('?')[0]; requested.push(url); return source.gltf; };
                const army = await loadArmy(faction, 'near', true);
                assert.deepEqual(requested, [`/models/battle/${faction}-roster.glb`]);
                for(const part of [...army.parts.values()].flat())assert.equal(part.legacySurface,false);
                army.dispose();
            }
            const source=fixture(),requested:string[]=[];
            GLTFLoader.prototype.loadAsync=async url=>{url=url.split('?')[0];requested.push(url);return source.gltf;};
            const earlier=await loadArmy('roman','far',false);earlier.dispose();
            assert.deepEqual(requested,['/models/battle/roman-army-lod.glb']);
        });
        await t.test('failed roster baking releases every partially loaded source resource', async () => {
            const prototype = fixture(ARMY_ROLES, true);
            prototype.gltf.animations = prototype.gltf.animations.filter(clip => clip.name !== 'heavy_cavalry_attack');
            GLTFLoader.prototype.loadAsync = async () => prototype.gltf;
            await assert.rejects(loadArmy('roman', 'near', true), /Missing heavy_cavalry attack/);
            for (const resource of prototype.resources) assert.equal(prototype.disposals.get(resource), 1);
        });
    } finally { GLTFLoader.prototype.loadAsync = original; }
});

test('stationary skinned formations animate without repeating matrix uploads, and pose, frontage, casualties and motion still invalidate',async()=>{
    const original=GLTFLoader.prototype.loadAsync,source=fixture(ARMY_ROLES,true);
    try {
        GLTFLoader.prototype.loadAsync=async()=>source.gltf;
        const army=await loadArmy('orc','near',true),world=createSolo('buffer test'),armyData={...world.armies[0],infantry:180,archers:30,cavalry:60};
        const {formations}=newBattle(19,'solo-ruler',armyData,armyData,'plains','normal','buffer test','practice');
        const formation=formations.find(f=>f.owner_id&&f.unit_type==='cavalry')!;
        const visual=createArmyFactory(army,army,'solo-ruler',formations)(formation),batch=visual.object.children[0] as InstancedMesh;
        const frame={formation,pose:{x:formation.x,y:formation.y,facing:formation.facing},time:0,dt:.016,animate:true,height:()=>4};
        visual.update(frame);
        const matrixVersion=batch.instanceMatrix.version,motion=batch.geometry.getAttribute('instanceMotion'),motionVersion=motion.version;
        for(let time=1;time<10;time++)visual.update({...frame,time});
        assert.equal(batch.instanceMatrix.version,matrixVersion,'Idle animation must not upload unchanged placement');
        assert.equal(motion.version,motionVersion,'Idle animation must not upload unchanged motion phases');
        visual.update({...frame,pose:{...frame.pose,x:frame.pose.x+5}});
        assert.ok(batch.instanceMatrix.version>matrixVersion,'Camera-independent movement updates world matrices');
        const movedVersion=batch.instanceMatrix.version;
        formation.columns+=1;visual.update(frame);
        assert.ok(batch.instanceMatrix.version>movedVersion,'Frontage changes update soldier slots');
        const widthVersion=batch.instanceMatrix.version;
        formation.soldiers-=1;visual.update(frame);
        assert.ok(batch.instanceMatrix.version>widthVersion);assert.equal(batch.count,formation.soldiers);
        const casualtyVersion=batch.instanceMatrix.version,statusVersion=motion.version;
        formation.status='engaged';visual.update(frame);
        assert.equal(batch.instanceMatrix.version,casualtyVersion,'Motion-only changes reuse placement');
        assert.ok(motion.version>statusVersion);assert.equal(motion.getY(0),2);
        visual.update({...frame,animate:false});assert.equal(motion.getY(0),0,'Pause/reduced motion selects the idle pose');
        visual.dispose();army.dispose();
    } finally {GLTFLoader.prototype.loadAsync=original;}
});

test('siege inspection bounds follow the baked idle pose instead of the undeformed rest mesh',async()=>{
    const original=GLTFLoader.prototype.loadAsync,source=fixture();
    const idle=source.gltf.animations.find(clip=>clip.name==='ram_idle')!;
    idle.tracks[0].values[1]=24;idle.tracks[0].values[4]=24;
    try {
        GLTFLoader.prototype.loadAsync=async()=>source.gltf;
        const army=await loadArmy('roman','near',true),bounds=armyIdleBounds(army,'ram');
        assert.ok(Math.abs(bounds.min.y-23.5)<.001);assert.ok(Math.abs(bounds.max.y-24.5)<.001);
        const prop=siegeShowcase(army,'ram',new Vector3(75,4,290));
        assert.deepEqual(prop.userData.inspectionBounds,bounds,'The camera receives the visible skin pose bounds');
        prop.userData.disposeShowcase();army.dispose();
    } finally {GLTFLoader.prototype.loadAsync=original;}
});

test('native normalized 16-bit weights retain blended skin bounds and independent bind transforms',async()=>{
    const original=GLTFLoader.prototype.loadAsync,source=fixture(ARMY_ROLES,true);
    const mesh=source.gltf.scene.children.find(group=>group.name==='heavy_cavalry')!.children[1] as SkinnedMesh,count=mesh.geometry.getAttribute('position').count;
    const indices=new Uint16Array(count*4),weights=new Uint16Array(count*4);
    for(let index=0;index<count;index++){indices[index*4+1]=1;weights[index*4]=16384;weights[index*4+1]=49151;}
    mesh.geometry.setAttribute('skinIndex',new BufferAttribute(indices,4));mesh.geometry.setAttribute('skinWeight',new BufferAttribute(weights,4,true));
    mesh.skeleton.bones[1].position.y=10;
    try {
        GLTFLoader.prototype.loadAsync=async()=>source.gltf;
        const army=await loadArmy('undead','near',true),part=army.parts.get('heavy_cavalry')![1];
        const bounds=armyIdleBounds({...army,parts:new Map([['heavy_cavalry',[part]]])},'heavy_cavalry');
        const expected=10*49151/65535;
        assert.ok(Math.abs(bounds.min.y-(expected-.5))<.0001);assert.ok(Math.abs(bounds.max.y-(expected+.5))<.0001);
        assert.equal(part.mesh.geometry.getAttribute('skinWeight').normalized,true);
        army.dispose();
    } finally {GLTFLoader.prototype.loadAsync=original;}
});

test('oversized mounts have distinct render slots and fitted inspection bounds without mutating battle formations',async()=>{
    const original=GLTFLoader.prototype.loadAsync,source=fixture(ARMY_ROLES,true);
    const mount=source.gltf.scene.children.find(group=>group.name==='heavy_cavalry')!;
    for(const child of mount.children){const mesh=child as SkinnedMesh;mesh.geometry.scale(24,20,16);mesh.userData.peris_mount_species='test mammoth';}
    try {
        GLTFLoader.prototype.loadAsync=async()=>source.gltf;
        const army=await loadArmy('orc','near',true),world=createSolo('mount footprint'),armyData={...world.armies[0],infantry:180,archers:30,cavalry:60};
        const {formations}=newBattle(29,'solo-ruler',armyData,armyData,'plains','normal','mount footprint','practice');
        const formation=formations.find(f=>f.owner_id&&armyRole(f,formations)==='heavy_cavalry')!;
        formation.columns=4;const before=JSON.stringify(formations);
        const visual=createArmyFactory(army,army,'solo-ruler',formations,army,army)(formation),unit=armyIdleBounds(army,'heavy_cavalry');
        const frame={formation,pose:{x:200,y:300,facing:0},time:0,dt:0,animate:false,height:()=>4};
        for(const detail of ['near','far'] as const){
            visual.update({...frame,detail});
            const batch=visual.object.children[detail==='near'?0:1].children[0] as InstancedMesh,boxes:Box3[]=[];
            for(let index=0;index<batch.count;index++){
                const matrix=new Matrix4();batch.getMatrixAt(index,matrix);
                const box=unit.clone().applyMatrix4(matrix);
                for(const earlier of boxes)assert.equal(box.intersectsBox(earlier),false,'Anatomy bounds have clear space between rendered mounts');
                boxes.push(box);
            }
            const bounds=visual.object.userData.inspectionBounds as Box3;
            // GPU instance matrices use float32 while the fitted CPU box uses
            // double precision; allow only their small storage rounding error.
            for(const box of boxes)assert.equal(bounds.clone().expandByScalar(.0001).containsBox(box),true,'Inspection covers every rendered mount');
            for(const [width,height] of [[1200,620],[390,400]]){
                const camera=new BattleCamera(()=>4);camera.setSize(width,height);camera.inspectBounds(bounds);
                for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
                    const point=new Vector3(x,y,z).project(camera.camera);
                    assert.ok(Math.abs(point.x)<.8&&Math.abs(point.y)<.8,'The whole mounted formation fits in desktop and portrait inspection');
                }
            }
        }
        assert.equal(JSON.stringify(formations),before,'Presentation offsets never change logical positions, frontage, soldier counts or combat state');
        visual.dispose();army.dispose();
    } finally {GLTFLoader.prototype.loadAsync=original;}
});

test('a finished army and an earlier opponent keep independent model packs, PBR treatment and near/far sources',async()=>{
    const original=GLTFLoader.prototype.loadAsync,sources=new Map<string,ReturnType<typeof fixture>>();
    try {
        GLTFLoader.prototype.loadAsync=async url=>{url=url.split('?')[0];const source=fixture(ARMY_ROLES,true);sources.set(url,source);return source.gltf;};
        const own=await loadArmy('roman','near',true),enemy=await loadArmy('orc','near',false),ownFar=await loadArmy('roman','far',true),enemyFar=await loadArmy('orc','far',false);
        assert.deepEqual([...sources.keys()],['/models/battle/roman-roster.glb','/models/battle/orc-army.glb','/models/battle/roman-roster-lod.glb','/models/battle/orc-army-lod.glb']);
        assert.equal(own.parts.get('line_infantry')![0].legacySurface,false);assert.equal(enemy.parts.get('line_infantry')![0].legacySurface,true);
        const world=createSolo('mixed preview'),armyData={...world.armies[0],infantry:180,archers:30,cavalry:60};
        const {formations}=newBattle(23,'solo-ruler',armyData,armyData,'plains','normal','mixed preview','practice');
        const factory=createArmyFactory(own,enemy,'solo-ruler',formations,ownFar,enemyFar),friendly=formations.find(f=>f.owner_id)!,hostile=formations.find(f=>!f.owner_id)!;
        const visuals=[factory(friendly),factory(hostile)];
        for(const [index,formation] of [friendly,hostile].entries())for(const detail of ['near','far'] as const){
            const visual=visuals[index];visual.update({formation,pose:{x:formation.x,y:formation.y,facing:formation.facing},time:0,dt:0,animate:false,detail,height:()=>0});
            const group=visual.object.children[detail==='near'?0:1],batch=group.children[0] as InstancedMesh;
            const faction=index?'orc':'roman',pack=index?'army':'roster',suffix=detail==='near'?'':'-lod';
            assert.equal(group.visible,true);
            assert.equal((batch.material as MeshStandardMaterial).map,sources.get(`/models/battle/${faction}-${pack}${suffix}.glb`)!.texture);
        }
        visuals.forEach(visual=>visual.dispose());[own,enemy,ownFar,enemyFar].forEach(army=>army.dispose());
        for(const source of sources.values())for(const resource of source.resources)assert.equal(source.disposals.get(resource),1);
    } finally {GLTFLoader.prototype.loadAsync=original;}
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
