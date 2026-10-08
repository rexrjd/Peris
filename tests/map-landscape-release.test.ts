import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLandscape, sampleHeight } from '../src/features/map/rendering/three/landscape';
import { getCell } from '../src/features/map/domain/worldGrid';

test('live scenery shares bounded chunk assets, clears real towns, restores nature and disposes once', () => {
    const samples = [[0, 0], [12.25, -34.8], [-72.5, 67.5], [305 / 128, 405 / 128]];
    const heights = samples.map(([x, z]) => sampleHeight(x, z));
    const fields = samples.map(([x, z]) => getCell(Math.floor(x), Math.floor(z)).terrain);
    const landscape = createLandscape(), batches: THREE.InstancedMesh[] = [];
    landscape.group.traverse(object => {
        let parent = object.parent, repeated = false;
        while (parent) { repeated ||= !!parent.userData.wrapTile; parent = parent.parent; }
        if (object instanceof THREE.InstancedMesh && !repeated) batches.push(object);
    });
    assert.ok(batches.length > 20 && batches.length < 1100, 'scenery must be chunked rather than creating a mesh per field');
    const geometries = new Set(batches.map(batch => batch.geometry)), materials = new Set(batches.flatMap(batch => Array.isArray(batch.material) ? batch.material : [batch.material]));
    assert.ok(geometries.size <= 10 && materials.size <= 5, 'chunks must reuse bounded family resources');
    const trees = batches.filter(batch => batch.name === 'Oak crowns' || batch.name === 'Pine canopy 1');
    const chosen = trees.find(batch => batch.count > 2)!;
    assert.ok(chosen, 'the authoritative forest must have native crowns');
    const first = new THREE.Matrix4(); chosen.getMatrixAt(0, first);
    const center = { x: first.elements[12], z: first.elements[14] };
    const original = new Float32Array(chosen.instanceMatrix.array), attribute = chosen.instanceMatrix;
    const ground = landscape.terrain.geometry.getAttribute('position').array;
    landscape.setSettlementCells([center]);
    const cleared = new THREE.Matrix4(); chosen.getMatrixAt(0, cleared);
    assert.equal(cleared.determinant(), 0, 'a completed settlement must clear the tree at its center');
    assert.equal(chosen.instanceMatrix, attribute, 'clearing updates existing buffers');
    assert.equal(landscape.terrain.geometry.getAttribute('position').array, ground, 'clearing must not modify terrain');
    const unchanged = Array.from(original).some((value, index) => value !== 0 && chosen.instanceMatrix.array[index] === value);
    assert.ok(unchanged, 'town clearings must retain surrounding scenery');
    const version = attribute.version; landscape.setSettlementCells([center]); assert.equal(attribute.version, version, 'unchanged town locations must not upload scenery again');
    landscape.setSettlementCells([]); assert.deepEqual(chosen.instanceMatrix.array, original, 'removing a settlement restores its original seeded scenery');
    landscape.setView(80);
    assert.ok(batches.filter(batch => batch.userData.maxSpan === 70).every(batch => !batch.visible));
    assert.ok(trees.every(batch => batch.visible), 'coarse forest silhouettes remain at the middle view');
    landscape.setView(120); assert.ok(trees.every(batch => !batch.visible));
    assert.ok(batches.filter(batch => batch.name === 'Scattered boulders').every(batch => batch.visible));
    landscape.setView(10); assert.ok(batches.every(batch => batch.visible));
    assert.deepEqual(samples.map(([x, z]) => sampleHeight(x, z)), heights);
    assert.deepEqual(samples.map(([x, z]) => getCell(Math.floor(x), Math.floor(z)).terrain), fields);
    const ownedGeometry = new Set<THREE.BufferGeometry>(), ownedMaterial = new Set<THREE.Material>();
    landscape.group.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
            ownedGeometry.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) ownedMaterial.add(material);
        }
    });
    const allBatches: THREE.InstancedMesh[] = []; landscape.group.traverse(object => { if (object instanceof THREE.InstancedMesh) allBatches.push(object); });
    assert.equal(allBatches.length, batches.length * 9, 'periodic scenery must reuse canonical batches');
    assert.ok(allBatches.every(batch => geometries.has(batch.geometry)), 'periodic tiles must borrow shared geometries');
    const disposal = new Map<object, number>();
    for (const object of [...ownedGeometry, ...ownedMaterial, ...allBatches]) object.addEventListener('dispose', () => disposal.set(object, (disposal.get(object) ?? 0) + 1));
    landscape.dispose(); landscape.dispose();
    for (const object of [...ownedGeometry, ...ownedMaterial, ...allBatches]) assert.equal(disposal.get(object), 1, 'every owned GPU resource must be released exactly once');
    assert.equal(landscape.group.children.length, 0);
});
