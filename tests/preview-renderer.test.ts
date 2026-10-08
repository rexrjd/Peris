import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { PreviewModels, PREVIEW_BUILDING_FOOTPRINT, PREVIEW_VILLAGE_FOOTPRINT } from '../src/features/map/preview/previewModels';
import { createPreviewLandscape, createPreviewTerrainGeometry } from '../src/features/map/preview/previewLandscape';
import { createPreviewState, getPreviewCell, getPreviewHydrology, PREVIEW_RACES, previewHeight, previewCellKey } from '../src/features/map/preview/model';
import { PREVIEW_PALETTE } from '../src/features/map/preview/previewLandscape';
import type { PreviewSceneState, PreviewState } from '../src/features/map/preview/types';
import { PreviewScene, previewMinimapBounds, previewMinimapTarget, previewMinimapFootprints } from '../src/features/map/preview/PreviewScene';
import { SceneCamera } from '../src/features/map/rendering/three/SceneCamera';
import { CELL_SIZE } from '../src/features/map/domain/dimensions';
import { PREVIEW_WORLD_SIZE, wrapPreviewCell, wrappedPreviewDelta } from '../src/features/map/preview/topology';
import { PreviewCamera } from '../src/features/map/preview/PreviewCamera';

test('larger race compounds remain inside one field and use distinct native geometry', () => {
    const models = new PreviewModels(), profiles = new Set<string>();
    for (const race of PREVIEW_RACES) {
        for (let seed = 0; seed < 12; seed++) for (const population of [80, 200, 400, 800, 1600]) {
            const village = models.createVillage(race.id, seed, seed === 0, population), bounds = new THREE.Box3().setFromObject(village), size = bounds.getSize(new THREE.Vector3());
            assert.ok(size.x > .65 && size.z > .65, `${race.id} village must be materially larger on the map`);
            assert.ok(size.x <= PREVIEW_VILLAGE_FOOTPRINT + .001 && size.z <= PREVIEW_VILLAGE_FOOTPRINT + .001, `${race.id} compound ${seed} exceeded its field clearing`);
            assert.ok(bounds.min.x >= -.5 && bounds.max.x <= .5 && bounds.min.z >= -.5 && bounds.max.z <= .5);
            assert.ok(size.y > .25 && size.y < .60, 'broader compounds must not become skyscrapers');
            if (seed === 0 && population === 80) profiles.add(village.children.map(child => (child as THREE.Mesh).geometry.getAttribute('position').count).join(':'));
        }
    }
    assert.equal(profiles.size, 5, 'race silhouettes should not reuse one generic settlement'); models.dispose();
});

function modelSignature(group: THREE.Group) {
    const hash = createHash('sha256');
    group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const array = object.geometry.getAttribute('position').array;
        hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    });
    return hash.digest('hex');
}

test('every completed upgrade changes geometry beyond level ten without growing the template cache', () => {
    const models = new PreviewModels(), cached = new Set<THREE.BufferGeometry>();
    for (const race of PREVIEW_RACES) for (const building of ['farm', 'lumber-mill', 'iron-mine', 'clay-pit'] as const) {
        assert.equal(models.createBuilding(building, 0, race.id).children.length, 0, 'an unfinished first building must have no model');
        let previous = '';
        for (let level = 1; level <= 24; level++) {
            const group = models.createBuilding(building, level, race.id), signature = modelSignature(group);
            assert.notEqual(signature, previous, `${race.id} ${building} upgrade ${level} must be visible`); previous = signature;
            const bounds = new THREE.Box3().setFromObject(group), size = bounds.getSize(new THREE.Vector3());
            assert.ok(size.x > .50 && size.z > .50, `${building} needs a broader map silhouette`);
            assert.ok(size.x <= PREVIEW_BUILDING_FOOTPRINT + .001 && size.z <= PREVIEW_BUILDING_FOOTPRINT + .001, `${building} level ${level} grew beyond its clearing`);
            assert.ok(bounds.min.x >= -.5 && bounds.max.x <= .5 && bounds.min.z >= -.5 && bounds.max.z <= .5);
            assert.equal(group.userData.level, level);
            group.traverse(object => { if (object instanceof THREE.Mesh) cached.add(object.geometry); });
        }
        previous = '';
        for (let level = 1_000_000; level < 1_000_020; level++) {
            const group = models.createBuilding(building, level, race.id), signature = modelSignature(group);
            assert.notEqual(signature, previous, `high-level ${building} upgrade must remain visible`); previous = signature;
            group.traverse(object => { if (object instanceof THREE.Mesh) assert.ok(cached.has(object.geometry), 'high levels must reuse bounded geometry'); });
        }
    }
    models.dispose();
});

test('population growth changes all five race compounds entirely within one compact clearing', () => {
    const models = new PreviewModels();
    for (const race of PREVIEW_RACES) {
        let previous = '';
        for (const population of [160, 200, 400, 800, 1600]) {
            const village = models.createVillage(race.id, 7, true, population), signature = modelSignature(village);
            assert.notEqual(signature, previous, `${race.id} population stage must alter its village`); previous = signature;
            const size = new THREE.Box3().setFromObject(village).getSize(new THREE.Vector3());
            assert.ok(size.x > .65 && size.z > .65 && size.x <= PREVIEW_VILLAGE_FOOTPRINT + .001 && size.z <= PREVIEW_VILLAGE_FOOTPRINT + .001);
        }
        const mature = models.createVillage(race.id, 7, true, 1600), huge = models.createVillage(race.id, 7, true, 1_000_000);
        assert.deepEqual(mature.children.map(c => (c as THREE.Mesh).geometry), huge.children.map(c => (c as THREE.Mesh).geometry), 'population must not create unbounded compound geometry');
    }
    models.dispose();
});

test('larger resource models fit their own fields and change as completed levels grow', () => {
    const models = new PreviewModels();
    for (const race of PREVIEW_RACES) for (const building of ['farm', 'lumber-mill', 'iron-mine', 'clay-pit'] as const) {
        const first = models.createBuilding(building, 1, race.id), mature = models.createBuilding(building, 6, race.id);
        for (const group of [first, mature]) {
            const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
            assert.ok(size.x > .50 && size.z > .50 && size.x <= PREVIEW_BUILDING_FOOTPRINT + .001 && size.z <= PREVIEW_BUILDING_FOOTPRINT + .001, `${race.id} ${building} must be larger while fitting its resource plot`);
        }
        const signature = (group: THREE.Group) => group.children.map(child => [...((child as THREE.Mesh).geometry.getAttribute('position').array)]).flat().join(',');
        assert.notEqual(signature(first), signature(mature), `${building} levels need a visible model change`);
    }
    models.dispose();
});

test('minimap uses one square projection for drawing and navigation at every display density', () => {
    for (const size of [103, 136, 173, 182]) {
        assert.deepEqual(previewMinimapBounds(size, size), { x: 0, y: 0, size });
        assert.deepEqual(previewMinimapTarget(size, size, size / 2, size / 2), { x: 0, z: 0 });
        assert.deepEqual(previewMinimapTarget(size, size, size / 4, size * .75), { x: -50, z: 50 });
        assert.deepEqual(previewMinimapTarget(size * 2, size * 2, size / 2, size * 1.5), { x: -50, z: 50 });
    }
    assert.deepEqual(previewMinimapBounds(300, 150), { x: 75, y: 0, size: 150 });
    assert.equal(previewMinimapTarget(300, 150, 30, 75), null, 'letterbox gutters must not move the world');
    assert.deepEqual(previewMinimapTarget(300, 150, 75, 0), { x: -100, z: -100 });
    assert.deepEqual(previewMinimapTarget(300, 150, 225, 150), { x: 100, z: 100 });
});

test('the actual minimap raster follows the captured realm seed and native water palette', () => {
    const raster = (seed: number) => {
        let output = new Uint8ClampedArray();
        const scene = Object.create(PreviewScene.prototype) as {
            seed: number; miniBase: { width: number; height: number; getContext: () => unknown }; makeMinimap: () => void;
        };
        scene.seed = seed;
        scene.miniBase = { width: 0, height: 0, getContext: () => ({
            createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
            putImageData: (image: { data: Uint8ClampedArray }) => { output = image.data; },
        }) };
        scene.makeMinimap(); assert.equal(scene.miniBase.width, 200); assert.equal(scene.miniBase.height, 200); return output;
    };
    const seed = 23456789, first = raster(seed);
    assert.deepEqual(first, raster(seed)); assert.notDeepEqual(first, raster(seed + 1));
    let checkedWater = 0;
    for (let row = -100; row < 100; row += 7) for (let col = -100; col < 100; col += 7) {
        if (getPreviewCell(col, row, seed).terrain !== 'water') continue;
        const color = new THREE.Color(PREVIEW_PALETTE.water).getHex(THREE.SRGBColorSpace), index = ((row + 100) * 200 + col + 100) * 4;
        assert.deepEqual([...first.slice(index, index + 4)], [color >> 16 & 255, color >> 8 & 255, color & 255, 255]); checkedWater++;
    }
    assert.ok(checkedWater > 20, 'water must exist in both the world domain and the minimap');
});

test('territory edges follow actual owners and suppress seams inside a connected claim', () => {
    const initial = createPreviewState(0, 23456789), home = { ...initial.villages[0], col: 0, row: 0, player: true };
    const neighbor = { ...initial.villages[1], col: 5, row: 0, player: false };
    const state: PreviewState = { ...initial, playerVillageId: home.id, villages: [home, neighbor], plots: {
        '1,0': { col: 1, row: 0, villageId: home.id, building: null, level: 0, queue: null },
    } };
    const scene = Object.create(PreviewScene.prototype) as { seed: number; view: PreviewCamera; overlays: THREE.Group; getState: () => PreviewSceneState; addTerritoryEdges: () => void };
    scene.seed = state.seed; scene.view = new PreviewCamera(() => 0); scene.overlays = new THREE.Group(); scene.getState = () => ({ state, selection: null, grid: false, claimMode: false });
    scene.addTerritoryEdges(); assert.equal(scene.overlays.children.length, 2);
    const own = scene.overlays.children[0] as THREE.LineSegments, position = own.geometry.getAttribute('position');
    assert.equal(position.count, 48, 'two adjacent same-owner cells have six outer edges, not eight');
    for (let i = 0; i < position.count; i += 2) {
        assert.ok(Number.isFinite(position.getY(i)), 'every border must drape on the seeded heightfield');
        assert.ok(!(position.getX(i) === 1 && position.getX(i + 1) === 1), 'no boundary may split the shared claim');
    }
    assert.ok((own.material as THREE.LineBasicMaterial).opacity > ((scene.overlays.children[1] as THREE.LineSegments).material as THREE.LineBasicMaterial).opacity);
    scene.overlays.traverse(object => { if (object instanceof THREE.LineSegments) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
});

test('ownership boundaries remain one connected claim across the displayed world seam', () => {
    const initial = createPreviewState(0), home = { ...initial.villages[0], col: 99, row: 0 };
    const state: PreviewState = { ...initial, villages: [home], plots: { '-100,0': { col: -100, row: 0, villageId: home.id, building: null, level: 0, queue: null } } };
    const scene = Object.create(PreviewScene.prototype) as { seed: number; view: PreviewCamera; overlays: THREE.Group; getState: () => PreviewSceneState; addTerritoryEdges: () => void; clearOverlay: (group: THREE.Group) => void };
    Object.assign(scene, { seed: state.seed, view: new PreviewCamera(() => 0), overlays: new THREE.Group(), getState: () => ({ state, selection: null, grid: false, claimMode: false }) });
    for (const [target, min, max, seam] of [[99.5, 99, 101, 100], [-99.5, -101, -99, -100]]) {
        scene.view.target.set(target, 0, .5); scene.view.update(); scene.addTerritoryEdges();
        const position = (scene.overlays.children[0] as THREE.LineSegments).geometry.getAttribute('position'); assert.equal(position.count, 48);
        const x: number[] = [];
        for (let i = 0; i < position.count; i += 2) {
            x.push(position.getX(i), position.getX(i + 1));
            assert.ok(!(position.getX(i) === seam && position.getX(i + 1) === seam), 'the periodic join must not split one owner into separate claims');
        }
        assert.equal(Math.min(...x), min); assert.equal(Math.max(...x), max); scene.clearOverlay(scene.overlays);
    }
});

test('minimap edge footprints split into four small corner pieces without a line across the realm', () => {
    const corners = [{ x: 99, y: 99 }, { x: 101, y: 99 }, { x: 101, y: 101 }, { x: 99, y: 101 }], footprints = previewMinimapFootprints(corners);
    assert.equal(footprints.length, 9);
    const visible = footprints.map(points => ({ minX: Math.max(-100, Math.min(...points.map(p => p.x))), maxX: Math.min(100, Math.max(...points.map(p => p.x))), minY: Math.max(-100, Math.min(...points.map(p => p.y))), maxY: Math.min(100, Math.max(...points.map(p => p.y))) }))
        .filter(rect => rect.maxX > rect.minX && rect.maxY > rect.minY);
    assert.equal(visible.length, 4); assert.equal(visible.reduce((sum, rect) => sum + (rect.maxX - rect.minX) * (rect.maxY - rect.minY), 0), 4);
    for (const rect of visible) assert.ok(rect.maxX - rect.minX <= 1 && rect.maxY - rect.minY <= 1, 'a seam crossing must not produce a giant minimap rectangle');
    assert.deepEqual(previewMinimapFootprints(corners, true), [corners]);
});

test('explicit field focus accepts periodic aliases and leaves invalid requests alone', () => {
    const scene = Object.create(PreviewScene.prototype) as { view: PreviewCamera; focusCell: (col: number, row: number) => void };
    scene.view = new PreviewCamera(() => 0); scene.view.setSize(1200, 800); scene.view.overview();
    scene.focusCell(100, 200); assert.equal(scene.view.isOverview, false); assert.equal(scene.view.target.x, -99.5); assert.equal(scene.view.target.z, .5); assert.ok(scene.view.span <= 8);
    const target = scene.view.target.clone(); scene.focusCell(Infinity, 0); scene.focusCell(0.5, 0); assert.deepEqual(scene.view.target, target);
});

test('queued first construction retains natural scenery and rebuilds only on completion', () => {
    const initial = createPreviewState(0), home = initial.villages[0];
    let state: PreviewState = { ...initial, villages: [home], plots: {
        '0,0': { col: 0, row: 0, villageId: home.id, building: 'lumber-mill', level: 0, queue: { targetLevel: 1, endsAt: 1000 } },
    } };
    let clearings = new Set<string>();
    const models = new PreviewModels(), scene = Object.create(PreviewScene.prototype) as {
        seed: number; scene: THREE.Scene; models: PreviewModels; villages: Map<string, unknown>; buildings: Map<string, THREE.Group>;
        structureKey: string; getState: () => PreviewSceneState; landscape: { setConstructionCells: (next: Set<string>) => void }; syncStructures: () => void;
    };
    Object.assign(scene, { seed: state.seed, scene: new THREE.Scene(), models, villages: new Map(), buildings: new Map(), structureKey: '',
        getState: () => ({ state, selection: null, grid: false, claimMode: false }), landscape: { setConstructionCells: (next: Set<string>) => { clearings = next; } } });
    scene.syncStructures(); assert.equal(scene.buildings.size, 0); assert.equal(clearings.size, 0);
    state = { ...state, plots: { '0,0': { ...state.plots['0,0'], level: 1, queue: null } } };
    scene.syncStructures(); const first = scene.buildings.get('0,0'); assert.ok(first); assert.deepEqual([...clearings], ['0,0']);
    state = { ...state, plots: { '0,0': { ...state.plots['0,0'], queue: { targetLevel: 2, endsAt: 2000 } } } };
    scene.syncStructures(); assert.equal(scene.buildings.get('0,0'), first, 'a queued upgrade must retain its completed model');
    state = { ...state, plots: { '0,0': { ...state.plots['0,0'], level: 2, queue: null } } };
    scene.syncStructures(); assert.notEqual(scene.buildings.get('0,0'), first); models.dispose();
});

test('ending a pinch resumes a drag and releases every captured pointer without a click', () => {
    const captured = new Set([1, 2]);
    const scene = Object.create(PreviewScene.prototype) as {
        canvas: { hasPointerCapture: (id: number) => boolean; releasePointerCapture: (id: number) => void };
        touches: Map<number, { x: number; y: number }>; pinch: unknown; down: { moved: boolean; pointerId: number } | null;
        finishCanvasPointer: (id: number) => void;
    };
    scene.canvas = { hasPointerCapture: id => captured.has(id), releasePointerCapture: id => { captured.delete(id); } };
    scene.touches = new Map([[1, { x: 10, y: 20 }], [2, { x: 40, y: 20 }]]); scene.pinch = { distance: 30, x: 25, y: 20 }; scene.down = null;
    scene.finishCanvasPointer(1);
    assert.equal(scene.pinch, null); assert.equal(scene.down?.pointerId, 2); assert.equal(scene.down?.moved, true);
    scene.finishCanvasPointer(2);
    assert.equal(scene.down, null); assert.equal(scene.touches.size, 0); assert.equal(captured.size, 0);
});

test('graphics interruption stops rendering, reports a recoverable error, and resumes after restoration', () => {
    const cancelDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame'), requestDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
    const messages: string[] = [], labels: string[] = [], cancelled: number[] = []; let cleared = false, requested = false;
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: (id: number) => { cancelled.push(id); } });
    Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => { requested = true; return 44; } });
    try {
        const scene = Object.create(PreviewScene.prototype) as {
            active: boolean; frame: number; lastTime: number; shadowKey: string; canvasLabel: string;
            clearInput: () => void; canvas: { setAttribute: (name: string, value: string) => void };
            actions: { error: (message: string) => void }; renderer: { shadowMap: { needsUpdate: boolean } };
            graphicsLost: (event: Event) => void; graphicsRestored: () => void;
        };
        scene.active = true; scene.frame = 33; scene.lastTime = 900; scene.shadowKey = 'old'; scene.canvasLabel = '3D world map';
        scene.clearInput = () => { cleared = true; }; scene.canvas = { setAttribute: (_, value) => { labels.push(value); } };
        scene.actions = { error: message => { messages.push(message); } }; scene.renderer = { shadowMap: { needsUpdate: false } };
        const event = new Event('webglcontextlost', { cancelable: true }); scene.graphicsLost(event);
        assert.equal(event.defaultPrevented, true); assert.equal(scene.active, false); assert.deepEqual(cancelled, [33]); assert.equal(cleared, true);
        assert.match(messages[0], /Try again/); assert.equal(labels[0], messages[0]);
        scene.graphicsRestored();
        assert.equal(scene.active, true); assert.equal(scene.lastTime, 0); assert.equal(scene.shadowKey, ''); assert.equal(scene.renderer.shadowMap.needsUpdate, true);
        assert.equal(requested, true); assert.equal(scene.frame, 44); assert.equal(messages[1], ''); assert.equal(labels[1], '3D world map');
    } finally {
        if (cancelDescriptor) Object.defineProperty(globalThis, 'cancelAnimationFrame', cancelDescriptor); else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
        if (requestDescriptor) Object.defineProperty(globalThis, 'requestAnimationFrame', requestDescriptor); else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    }
});

test('heightfield vertices follow the authoritative seeded world reproducibly', () => {
    const seed = 23456789, geometry = createPreviewTerrainGeometry(64, seed), position = geometry.getAttribute('position'), colors = geometry.getAttribute('color');
    for (let i = 0; i < position.count; i += 17) {
        assert.ok(Math.abs(position.getY(i) - previewHeight(position.getX(i), position.getZ(i), seed)) < .000001);
        assert.ok(Number.isFinite(colors.getX(i)) && Number.isFinite(colors.getY(i)) && Number.isFinite(colors.getZ(i)));
    }
    const repeated = createPreviewTerrainGeometry(64, seed), other = createPreviewTerrainGeometry(64, seed + 1);
    assert.deepEqual(position.array, repeated.getAttribute('position').array);
    assert.deepEqual(colors.array, repeated.getAttribute('color').array);
    assert.notDeepEqual(position.array, other.getAttribute('position').array, 'changing the realm seed must change native terrain');
    const normal = geometry.getAttribute('normal'), stride = 65;
    for (let i = 0; i < stride; i++) for (const [a, b] of [[i * stride, i * stride + 64], [i, 64 * stride + i]]) {
        assert.equal(position.getY(a), position.getY(b), 'opposite terrain edges must close at exactly the same height');
        for (const attribute of [colors, normal]) assert.deepEqual([attribute.getX(a), attribute.getY(a), attribute.getZ(a)], [attribute.getX(b), attribute.getY(b), attribute.getZ(b)], 'edge color and lighting must join without a seam');
    }
    assert.equal(position.count, 65 * 65); geometry.dispose(); repeated.dispose(); other.dispose();
});

test('scenery is batched, water faces upward, and resource clearings retain surrounding woodland', () => {
    const seed = 23456789, landscape = createPreviewLandscape(createPreviewState(0, seed).villages, seed), instances: THREE.InstancedMesh[] = [], meshes: THREE.Mesh[] = [];
    const primary = landscape.group.children.filter(object => !object.userData.wrapTile);
    primary.forEach(root => root.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); if (object instanceof THREE.InstancedMesh) instances.push(object); }));
    const wrapTiles = landscape.group.children.filter(object => object.userData.wrapTile), allInstances: THREE.InstancedMesh[] = [];
    landscape.group.traverse(object => { if (object instanceof THREE.InstancedMesh) allInstances.push(object); });
    assert.equal(wrapTiles.length, 8); assert.equal(allInstances.length, instances.length * 9);
    const offsets = new Set(wrapTiles.map(tile => `${tile.position.x},${tile.position.z}`));
    assert.deepEqual(offsets, new Set([-PREVIEW_WORLD_SIZE, 0, PREVIEW_WORLD_SIZE].flatMap(x => [-PREVIEW_WORLD_SIZE, 0, PREVIEW_WORLD_SIZE].filter(z => x !== 0 || z !== 0).map(z => `${x},${z}`))));
    for (const tile of wrapTiles) {
        const copies: THREE.Mesh[] = []; tile.traverse(object => { if (object instanceof THREE.Mesh) copies.push(object); }); assert.equal(copies.length, meshes.length);
        copies.forEach((copy, index) => {
            assert.equal(copy.geometry, meshes[index].geometry, 'periodic images must reuse native geometry'); assert.equal(copy.material, meshes[index].material, 'periodic images must reuse materials');
            if (copy instanceof THREE.InstancedMesh) {
                const source = meshes[index] as THREE.InstancedMesh;
                assert.equal(copy.instanceMatrix, source.instanceMatrix, 'all tile images must share one actual instance matrix attribute'); assert.equal(copy.instanceColor, source.instanceColor);
                assert.equal(copy.boundingSphere, source.boundingSphere); assert.equal(copy.frustumCulled, true, 'each repeated chunk must still cull normally');
            }
        });
    }
    landscape.setWrapVisible(false); for (const tile of wrapTiles) assert.equal(tile.visible, false);
    assert.ok(primary.every(object => object.visible), 'overview must preserve the original tile');
    landscape.setWrapVisible(true); for (const tile of wrapTiles) assert.equal(tile.visible, true);
    assert.ok(instances.length <= 100 * 10 && meshes.length < 1100, 'ten fixed scenery families per chunk must not become a mesh per field');
    assert.ok(instances.reduce((total, mesh) => total + mesh.count, 0) > 15_000, 'the rendered mainland should have substantial native scenery');
    for (const mesh of meshes.filter(mesh => !mesh.isInstancedMesh && (mesh.material as THREE.MeshStandardMaterial).metalness > 0)) {
        const normal = mesh.geometry.getAttribute('normal'); for (let i = 0; i < normal.count; i++) assert.ok(normal.getY(i) > .99, 'native river ribbons must face the camera above the land');
    }
    const hydrology = getPreviewHydrology(seed), water = landscape.group.children.filter(object => object instanceof THREE.Mesh && object.renderOrder === 2) as THREE.Mesh[];
    const details = new Set(instances.map(mesh => mesh.userData.detail));
    for (const detail of ['shrub', 'scrub', 'palm', 'ruin', 'rune']) assert.ok(details.has(detail), `${detail} must contribute native geometry to the seeded realm`);
    landscape.setView(80);
    for (const mesh of allInstances) assert.equal(mesh.visible, !mesh.userData.near, 'small foliage should hide before full forest canopies');
    landscape.setView(120);
    for (const mesh of allInstances) assert.equal(mesh.visible, !mesh.userData.near && !mesh.userData.isForest, 'wider overview keeps landforms while hiding detailed foliage');
    landscape.setView(32); for (const mesh of allInstances) assert.equal(mesh.visible, true);
    assert.equal(water.length, hydrology.rivers.length + hydrology.oases.length);
    for (const mesh of water) {
        const position = mesh.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i++) assert.ok(position.getX(i) >= -100 && position.getX(i) <= 100 && position.getZ(i) >= -100 && position.getZ(i) <= 100, 'water skirts must clip once at each canonical tile edge');
    }
    type Tree = { mesh: THREE.InstancedMesh; index: number; original: THREE.Matrix4 };
    const pairs = new Map<string, { central?: Tree; outer?: Tree }>();
    let central: Tree | undefined, outer: Tree | undefined, key = '';
    for (const mesh of instances.filter(mesh => mesh.userData.isForest)) {
        const vertices = mesh.geometry.getAttribute('position');
        let canopyRadius = 0;
        for (let i = 0; i < vertices.count; i++) canopyRadius = Math.max(canopyRadius, Math.hypot(vertices.getX(i), vertices.getZ(i)));
        if (canopyRadius < .05) continue; // Inspect crowns, rather than narrow trunks which share their clearing.
        for (let i = 0; i < mesh.count; i++) {
            const original = new THREE.Matrix4(); mesh.getMatrixAt(i, original);
            const point = new THREE.Vector3().setFromMatrixPosition(original), cell = previewCellKey(Math.floor(point.x), Math.floor(point.z));
            const distance = Math.hypot(point.x - Math.floor(point.x) - .5, point.z - Math.floor(point.z) - .5);
            const scale = new THREE.Vector3().setFromMatrixScale(original), crown = canopyRadius * Math.max(scale.x, scale.z);
            const edgeDistance = Math.max(Math.abs(point.x - Math.floor(point.x) - .5), Math.abs(point.z - Math.floor(point.z) - .5));
            const pair = pairs.get(cell) ?? {}; pairs.set(cell, pair);
            if (distance < .2) pair.central ??= { mesh, index: i, original };
            if (edgeDistance - crown > PREVIEW_BUILDING_FOOTPRINT / 2 + .025) pair.outer ??= { mesh, index: i, original };
            if (pair.central && pair.outer) { central = pair.central; outer = pair.outer; key = cell; break; }
        }
        if (central) break;
    }
    assert.ok(central && outer, 'forest should contain a crown overlapping the larger compound and another crown safely beyond it on the same field');
    const changed = new THREE.Matrix4();
    landscape.setConstructionCells(new Set([key]));
    central.mesh.getMatrixAt(central.index, changed); assert.equal(new THREE.Vector3().setFromMatrixScale(changed).length(), 0, 'trees intersecting the building clearing should be removed');
    outer.mesh.getMatrixAt(outer.index, changed); assert.deepEqual(changed.elements, outer.original.elements, 'crowns outside the larger compound and its margin must remain on the same tile');
    for (const instance of allInstances.filter(instance => instance.instanceMatrix === central.mesh.instanceMatrix)) {
        instance.getMatrixAt(central.index, changed); assert.equal(new THREE.Vector3().setFromMatrixScale(changed).length(), 0, 'completed construction must clear the same crown in every periodic image');
    }
    landscape.setConstructionCells(new Set());
    central.mesh.getMatrixAt(central.index, changed); assert.deepEqual(changed.elements, central.original.elements);
    const models = new PreviewModels(), towns = new Map<string, THREE.Box3>();
    for (const village of createPreviewState(0, seed).villages) {
        const model = models.createVillage(village.race, 0, village.player, village.population); model.position.set(village.col + .5, previewHeight(village.col + .5, village.row + .5, seed), village.row + .5);
        towns.set(previewCellKey(village.col, village.row), new THREE.Box3().setFromObject(model));
    }
    for (const mesh of instances.filter(mesh => mesh.userData.isForest)) {
        mesh.geometry.computeBoundingBox();
        for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, changed); const point = new THREE.Vector3().setFromMatrixPosition(changed), canopy = mesh.geometry.boundingBox!.clone().applyMatrix4(changed);
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
                const cell = wrapPreviewCell(Math.floor(point.x) + dx, Math.floor(point.z) + dz), town = towns.get(previewCellKey(cell.col, cell.row));
                if (town) assert.ok(canopy.max.x <= town.min.x || canopy.min.x >= town.max.x || canopy.max.z <= town.min.z || canopy.min.z >= town.max.z, 'tree crowns from this or a neighboring field must not cover the enlarged village');
            }
        }
    }
    models.dispose();
    const geometryDisposals = new Map<THREE.BufferGeometry, number>(), materialDisposals = new Map<THREE.Material, number>(); let instanceDisposals = 0;
    for (const mesh of meshes) {
        if (!geometryDisposals.has(mesh.geometry)) { geometryDisposals.set(mesh.geometry, 0); mesh.geometry.addEventListener('dispose', () => geometryDisposals.set(mesh.geometry, geometryDisposals.get(mesh.geometry)! + 1)); }
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (!materialDisposals.has(material)) { materialDisposals.set(material, 0); material.addEventListener('dispose', () => materialDisposals.set(material, materialDisposals.get(material)! + 1)); }
    }
    for (const instance of allInstances) instance.addEventListener('dispose', () => { instanceDisposals++; });
    landscape.dispose();
    assert.equal(instanceDisposals, allInstances.length); assert.ok([...geometryDisposals.values()].every(count => count === 1)); assert.ok([...materialDisposals.values()].every(count => count === 1)); assert.equal(landscape.group.children.length, 0);
});

test('native camera picking preserves signed tile coordinates after rotation and zoom', () => {
    const view = new SceneCamera(previewHeight); view.setSize(1200, 800); view.target.set(-11.5, 0, 36.5); view.span = 12; view.azimuth = .34; view.update();
    const scene = Object.create(PreviewScene.prototype) as { view: SceneCamera; pickingRay: THREE.Raycaster; villages: Map<string, unknown>; buildings: Map<string, THREE.Group>; hit: (x: number, y: number) => { col: number; row: number } | null };
    scene.view = view; scene.pickingRay = new THREE.Raycaster(); scene.villages = new Map(); scene.buildings = new Map();
    for (const [col, row] of [[-12, 36], [-13, 35], [-11, 35], [-10, 38]]) {
        const p = view.project((col + .5) * CELL_SIZE, (row + .5) * CELL_SIZE, 0);
        assert.deepEqual(scene.hit(p.x, p.y), { col, row });
    }
});

test('the isolated native camera pans and keeps zoom anchors across rotated world edges', () => {
    const seed = 23456789, view = new PreviewCamera((x, z) => previewHeight(x, z, seed));
    view.setSize(1200, 800); view.target.set(99.75, 0, 99.75); view.span = 12; view.azimuth = .34; view.update();
    const before = view.ground(600, 400); assert.ok(before); const revision = view.wrapRevision;
    view.pan(-300, -180);
    assert.ok(view.wrapRevision > revision, 'dragging through the edge must wrap the canonical camera instead of stopping');
    assert.ok(view.target.x >= -100 && view.target.x < 100 && view.target.z >= -100 && view.target.z < 100);
    const dragged = view.ground(300, 220); assert.ok(dragged);
    assert.ok(Math.abs(wrappedPreviewDelta(before.x / CELL_SIZE, dragged.x / CELL_SIZE)) < .01);
    assert.ok(Math.abs(wrappedPreviewDelta(before.y / CELL_SIZE, dragged.y / CELL_SIZE)) < .01);
    const anchor = { x: 950, y: 500 }, ground = view.ground(anchor.x, anchor.y); assert.ok(ground);
    view.zoom(1.7, anchor); const after = view.ground(anchor.x, anchor.y); assert.ok(after);
    assert.ok(Math.abs(wrappedPreviewDelta(ground.x / CELL_SIZE, after.x / CELL_SIZE)) < .01, 'zoom should preserve the same wrapped ground under the pointer');
    assert.ok(Math.abs(wrappedPreviewDelta(ground.y / CELL_SIZE, after.y / CELL_SIZE)) < .01);
    view.overview(); assert.equal(view.isOverview, true); assert.equal(view.span, view.maxSpan);
    view.zoom(1.25); assert.equal(view.isOverview, false); assert.ok(view.span <= 180, 'leaving overview must keep the repeated-world viewport bounded');
});

type HitScene = { view: PreviewCamera; pickingRay: THREE.Raycaster; villages: Map<string, { group: THREE.Group; detailed: boolean }>; buildings: Map<string, THREE.Group>; height: (x: number, z: number) => number; hit: (x: number, y: number) => { col: number; row: number } | null };
function pickingScene(elevation: (x: number, z: number) => number = () => 0): HitScene {
    const view = new PreviewCamera(elevation); view.setSize(1200, 800); view.target.set(-11.5, 0, 36.5); view.span = 3; view.azimuth = .28; view.update();
    return Object.assign(Object.create(PreviewScene.prototype), { view, pickingRay: new THREE.Raycaster(), villages: new Map(), buildings: new Map(), height: elevation });
}
function projectedPoint(view: SceneCamera | PreviewCamera, point: THREE.Vector3) {
    const projected = point.clone().project(view.camera); return { x: (projected.x + 1) * view.width / 2, y: (1 - projected.y) * view.height / 2 };
}

test('picking repeated village silhouettes returns canonical ownership cells at either edge', () => {
    const models = new PreviewModels(), village = models.createVillage('human', 0, true, 400), scene = pickingScene();
    village.userData.cell = { col: -100, row: 0 }; scene.villages.set('edge', { group: village, detailed: true });
    for (const [target, image] of [[99.5, 100.5], [-99.5, -99.5]]) {
        scene.view.target.set(target, 0, .5); scene.view.span = 4; scene.view.azimuth = .48; scene.view.update(); village.position.set(image, 0, .5); village.updateWorldMatrix(true, true);
        const point = new THREE.Box3().setFromObject(village).getCenter(new THREE.Vector3()), pixel = projectedPoint(scene.view, point);
        assert.deepEqual(scene.hit(pixel.x, pixel.y), { col: -100, row: 0 }, 'the displayed periodic image must pick the original owned village');
        village.visible = false;
        const ground = scene.view.ground(pixel.x, pixel.y); assert.ok(ground);
        assert.deepEqual(scene.hit(pixel.x, pixel.y), wrapPreviewCell(Math.floor(ground.x / CELL_SIZE), Math.floor(ground.y / CELL_SIZE)));
        village.visible = true;
    }
    models.dispose();
});

test('periodic structure copies share model assets and canonical metadata, then hide and detach cleanly', () => {
    const models = new PreviewModels(), village = models.createVillage('human', 0, true, 400);
    const scene = Object.assign(pickingScene(), { scene: new THREE.Scene(), structureCopies: new Map<THREE.Group, THREE.Group[]>() }) as HitScene & {
        scene: THREE.Scene; structureCopies: Map<THREE.Group, THREE.Group[]>;
        placeStructure: (group: THREE.Group, images: { x: number; z: number }[], detailed: boolean) => void;
        removeCopies: (group: THREE.Group) => void;
    };
    village.userData.cell = { col: -100, row: 0 }; scene.villages.set('village', { group: village, detailed: true }); scene.scene.add(village);
    scene.view.target.set(99.5, 0, .5); scene.view.span = 4; scene.view.update();
    scene.placeStructure(village, [{ x: -99.5, z: .5 }, { x: 100.5, z: .5 }], true);
    const copy = scene.structureCopies.get(village)![0]; assert.ok(copy); assert.equal(copy.visible, true); assert.deepEqual(copy.userData.cell, { col: -100, row: 0 });
    const sourceMeshes: THREE.Mesh[] = [], copyMeshes: THREE.Mesh[] = [];
    village.traverse(object => { if (object instanceof THREE.Mesh) sourceMeshes.push(object); }); copy.traverse(object => { if (object instanceof THREE.Mesh) copyMeshes.push(object); });
    assert.equal(copyMeshes.length, sourceMeshes.length);
    copyMeshes.forEach((mesh, index) => { assert.equal(mesh.geometry, sourceMeshes[index].geometry); assert.equal(mesh.material, sourceMeshes[index].material); });
    const pixel = projectedPoint(scene.view, new THREE.Box3().setFromObject(copy).getCenter(new THREE.Vector3()));
    assert.deepEqual(scene.hit(pixel.x, pixel.y), { col: -100, row: 0 });
    scene.view.overview(); scene.placeStructure(village, [{ x: -99.5, z: .5 }], false);
    assert.equal(copy.visible, false); assert.equal(village.visible, false, 'overview must not leave detailed image roofs showing through markers');
    let disposed = false; sourceMeshes[0].geometry.addEventListener('dispose', () => { disposed = true; });
    scene.removeCopies(village); assert.equal(scene.structureCopies.size, 0); assert.equal(copy.parent, null); assert.equal(disposed, false, 'removing a repeated transform must not dispose shared native model geometry');
    models.dispose();
});

test('enlarged raised village silhouettes pick their own field after rotation, while hidden models do not steal field clicks', () => {
    const models = new PreviewModels(), village = models.createVillage('human', 0, true, 400), scene = pickingScene();
    village.position.set(-11.5, 0, 36.5); village.userData.cell = { col: -12, row: 36 }; village.updateWorldMatrix(true, true);
    scene.villages.set('village', { group: village, detailed: true });
    let crossing: { x: number; y: number; ground: { col: number; row: number } } | undefined;
    // Sample real triangle interiors rather than relying on the placement of one particular roof or flag.
    village.traverse(object => {
        if (crossing || !(object instanceof THREE.Mesh)) return;
        const position = object.geometry.getAttribute('position');
        for (let i = 0; i + 2 < position.count; i += 3) {
            const center = new THREE.Vector3();
            for (let j = 0; j < 3; j++) center.add(new THREE.Vector3().fromBufferAttribute(position, i + j));
            center.multiplyScalar(1 / 3).applyMatrix4(object.matrixWorld); if (center.y < .30) continue;
            const pixel = projectedPoint(scene.view, center), ground = scene.view.ground(pixel.x, pixel.y); if (!ground) continue;
            const cell = { col: Math.floor(ground.x / CELL_SIZE), row: Math.floor(ground.y / CELL_SIZE) };
            if (cell.col === -12 && cell.row === 36) continue;
            if (scene.hit(pixel.x, pixel.y)?.col === -12 && scene.hit(pixel.x, pixel.y)?.row === 36) { crossing = { ...pixel, ground: cell }; break; }
        }
    });
    assert.ok(crossing, 'the enlarged roof or flag should visibly project over a neighboring ground field');
    assert.deepEqual(scene.hit(crossing.x, crossing.y), { col: -12, row: 36 });
    village.visible = false; assert.deepEqual(scene.hit(crossing.x, crossing.y), crossing.ground, 'a culled village must not intercept its neighbor');
    village.visible = true; scene.villages.get('village')!.detailed = false;
    assert.deepEqual(scene.hit(crossing.x, crossing.y), crossing.ground, 'a marker-only village must not keep an invisible roof hit target');
    models.dispose();
});

test('native building picking rejects models concealed behind foreground terrain', () => {
    const models = new PreviewModels(), building = models.createBuilding('lumber-mill', 10), scene = pickingScene();
    building.position.set(-11.5, 0, 36.5); building.userData.cell = { col: -12, row: 36 }; scene.buildings.set('building', building);
    const roof = new THREE.Box3().setFromObject(building).getCenter(new THREE.Vector3()); roof.y += .08;
    const pixel = projectedPoint(scene.view, roof); assert.deepEqual(scene.hit(pixel.x, pixel.y), { col: -12, row: 36 });
    const ridge = (x: number, z: number) => x > -16 && x < -7 && z >= 37 && z <= 38 ? 3 : 0;
    const occluded = pickingScene(ridge); occluded.buildings.set('building', building);
    const behind = projectedPoint(occluded.view, roof), foreground = occluded.view.ground(behind.x, behind.y); assert.ok(foreground);
    const field = { col: Math.floor(foreground.x / CELL_SIZE), row: Math.floor(foreground.y / CELL_SIZE) };
    assert.notDeepEqual(field, { col: -12, row: 36 }, 'the ridge must actually lie in front of this building');
    assert.deepEqual(occluded.hit(behind.x, behind.y), field, 'hidden buildings must not be selected through foreground terrain');
    building.visible = false; assert.deepEqual(occluded.hit(behind.x, behind.y), field); models.dispose();
});
