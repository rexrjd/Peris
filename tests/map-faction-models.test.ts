import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { FACTIONS, type Faction } from '../src/features/factions/domain/factions';
import { disposeCityObject } from '../src/features/city/rendering/three/modelKit';
import { createFactionField, createFactionSettlement, MapSettlementModels, MAP_FIELD_BUILDINGS, MAP_FIELD_FOOTPRINT, MAP_SETTLEMENT_FOOTPRINT } from '../src/features/map/rendering/three/factionSettlement';

const factions = Object.keys(FACTIONS) as Faction[];
function signature(group: THREE.Group, hall = false) {
    const hash = createHash('sha256'); let count = 0;
    for (const mesh of group.children as THREE.Mesh[]) {
        const p = mesh.geometry.getAttribute('position').array as Float32Array;
        const vertices = hall ? mesh.userData.hallVertexCount as number : p.length / 3;
        if (!vertices) continue;
        hash.update(new Uint8Array(p.buffer, p.byteOffset, vertices * 3 * 4)); count += vertices;
    }
    assert.ok(count > 0); return hash.digest('hex');
}
function bounds(group: THREE.Group, footprint: number, maxHeight: number) {
    const box = new THREE.Box3().setFromObject(group), size = box.getSize(new THREE.Vector3());
    assert.ok(size.x <= footprint + 1e-6 && size.z <= footprint + 1e-6);
    assert.ok(Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) <= footprint / 2 + 1e-6);
    assert.ok(box.min.y >= -1e-6 && box.max.y <= maxHeight + 1e-6);
    assert.ok(group.children.length <= 16, 'equivalent city materials must become a small palette of batches');
    for (const mesh of group.children as THREE.Mesh[]) {
        assert.equal(mesh.geometry.index, null); assert.deepEqual(Object.keys(mesh.geometry.attributes).sort(), ['normal', 'position']);
        for (const value of mesh.geometry.getAttribute('position').array) assert.ok(Number.isFinite(value));
    }
    return box.max.y;
}

test('all eleven faction villages advance their actual central hall inside one fixed map field', () => {
    const models = new MapSettlementModels(), mature = new Set<string>();
    try {
        assert.equal(factions.length, 11);
        for (const faction of factions) {
            let oldHall = '', oldModel = '', oldHeight = 0;
            for (let level = 1; level <= 5; level++) {
                const group = models.get(faction, level), hall = signature(group, true), whole = signature(group);
                assert.notEqual(hall, oldHall, `${faction} level ${level} must upgrade its city-derived main hall`);
                assert.notEqual(whole, oldModel); assert.equal(group.userData.development, level); assert.equal(group.userData.houseCount, level + 1);
                const height = bounds(group, MAP_SETTLEMENT_FOOTPRINT, .6); assert.ok(height + 1e-6 >= oldHeight);
                oldHall = hall; oldModel = whole; oldHeight = height;
            }
            const group = models.get(faction, 5); mature.add(signature(group));
            assert.ok((group.children as THREE.Mesh[]).some(mesh => (mesh.material as THREE.MeshStandardMaterial).color.getHex() === FACTIONS[faction].roof));
        }
        assert.equal(mature.size, factions.length, 'faction-specific city silhouettes must survive map batching');
    } finally { models.dispose(); }
});

test('canonical resource fields are empty at zero and evolve through all five city building stages', () => {
    const models = new MapSettlementModels();
    try {
        for (const faction of factions) for (const type of MAP_FIELD_BUILDINGS) {
            assert.equal(models.getField(type, 0, faction).children.length, 0); let old = '', height = 0;
            for (let level = 1; level <= 5; level++) {
                const group = models.getField(type, level, faction), current = signature(group);
                assert.notEqual(current, old, `${faction} ${type} must use its new completed city architecture`);
                assert.equal(group.userData.building, type); assert.equal(group.userData.level, level);
                const next = bounds(group, MAP_FIELD_FOOTPRINT, .35); assert.ok(next + 1e-6 >= height); height = next; old = current;
            }
        }
    } finally { models.dispose(); }
});

test('cached instances share immutable assets, preserve independent transforms and cap every raw level', () => {
    const models = new MapSettlementModels(), geometries = new Set<THREE.BufferGeometry>(), surfaces = new Set<THREE.Material>();
    for (const faction of factions) for (let level = 1; level <= 5; level++) {
        for (const group of [models.get(faction, level), ...MAP_FIELD_BUILDINGS.map(type => models.getField(type, level, faction))]) {
            for (const mesh of group.children as THREE.Mesh[]) { geometries.add(mesh.geometry); surfaces.add(mesh.material as THREE.Material); assert.equal(mesh.userData.sharedMapSettlementAsset, true); }
        }
    }
    const first = models.get('elf', 3), second = models.create('elf', 3); assert.notEqual(first, second); assert.notEqual(first.children[0], second.children[0]);
    first.position.set(3, 4, 5); first.children[0].visible = false; assert.deepEqual(second.position.toArray(), [0, 0, 0]); assert.equal(second.children[0].visible, true);
    for (let i = 0; i < first.children.length; i++) { assert.equal((first.children[i] as THREE.Mesh).geometry, (second.children[i] as THREE.Mesh).geometry); assert.equal((first.children[i] as THREE.Mesh).material, (second.children[i] as THREE.Mesh).material); }
    for (const faction of factions) for (const value of [0, .5, 2.9, 6, 100, Number.MAX_SAFE_INTEGER, NaN, Infinity]) {
        for (const group of [models.get(faction, value), ...MAP_FIELD_BUILDINGS.map(type => models.getField(type, value, faction))]) for (const mesh of group.children as THREE.Mesh[]) { assert.ok(geometries.has(mesh.geometry)); assert.ok(surfaces.has(mesh.material as THREE.Material)); }
    }
    const shapeDisposals = new Map([...geometries].map(g => [g, 0])), materialDisposals = new Map([...surfaces].map(m => [m, 0]));
    geometries.forEach(g => g.addEventListener('dispose', () => shapeDisposals.set(g, shapeDisposals.get(g)! + 1)));
    surfaces.forEach(m => m.addEventListener('dispose', () => materialDisposals.set(m, materialDisposals.get(m)! + 1)));
    first.clear(); assert.ok([...shapeDisposals.values()].every(count => count === 0), 'removing one village cannot dispose another instance');
    models.dispose(); models.dispose(); assert.ok([...shapeDisposals.values()].every(count => count === 1)); assert.ok([...materialDisposals.values()].every(count => count === 1));
    assert.throws(() => models.get('roman'), /disposed/); assert.throws(() => models.getField('farm', 0), /disposed/);
});

test('standalone one-argument callers retain exclusive asset ownership', () => {
    const a = createFactionSettlement('roman'), b = createFactionSettlement('roman'), field = createFactionField('farm', 2, 'roman');
    assert.equal(a.userData.development, 1); assert.notEqual((a.children[0] as THREE.Mesh).geometry, (b.children[0] as THREE.Mesh).geometry);
    assert.notEqual((a.children[0] as THREE.Mesh).material, (b.children[0] as THREE.Mesh).material);
    assert.equal(a.userData.sharedMapSettlementAsset, undefined); bounds(a, MAP_SETTLEMENT_FOOTPRINT, .6); bounds(field, MAP_FIELD_FOOTPRINT, .35);
    disposeCityObject(a); disposeCityObject(b); disposeCityObject(field);
});
