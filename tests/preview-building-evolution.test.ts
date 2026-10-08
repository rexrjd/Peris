import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { PreviewModels, PREVIEW_ARCHITECTURE_LEVELS, PREVIEW_ARCHITECTURE_NAMES, PREVIEW_BUILDING_FOOTPRINT } from '../src/features/map/preview/previewModels';
import type { PreviewBuilding, PreviewRace } from '../src/features/map/preview/types';

const races: PreviewRace[] = ['human', 'elf', 'dwarf', 'orc', 'peri'];
const buildings: PreviewBuilding[] = ['farm', 'lumber-mill', 'iron-mine', 'clay-pit'];

/** Hash only the actual main-structure vertex ranges, excluding crops and stockpiles. */
function structureSignature(group: THREE.Group, finishes?: string[]) {
    const hash = createHash('sha256'); let vertices = 0;
    for (const object of group.children) {
        const mesh = object as THREE.Mesh, count = mesh.userData.mainStructureVertexCount as number;
        if (!count || finishes && !finishes.includes(mesh.userData.finish)) continue;
        const position = mesh.geometry.getAttribute('position').array as Float32Array;
        assert.ok(count <= position.length / 3 && count % 3 === 0);
        hash.update(mesh.userData.finish); hash.update(new Uint8Array(position.buffer, position.byteOffset, count * 3 * 4)); vertices += count;
    }
    assert.ok(vertices > 0, 'main structure must include actual rendered geometry');
    return hash.digest('hex');
}

test('every low-level upgrade changes real roof and wall geometry, independently of stockpiles', () => {
    const models = new PreviewModels();
    try {
        for (const race of races) for (const building of buildings) {
            let wall = '', roof = '', height = 0;
            for (let level = 1; level <= 20; level++) {
                const group = models.createBuilding(building, level, race);
                const nextWall = structureSignature(group, ['stone', 'wood']), nextRoof = structureSignature(group, ['roof']);
                assert.notEqual(nextWall, wall, `${race} ${building} level ${level} must change its constructed walls/supports`);
                assert.notEqual(nextRoof, roof, `${race} ${building} level ${level} must change its roof`);
                assert.ok(group.userData.mainStructure.height + 1e-6 >= height, `${race} ${building} must not shrink to a primitive silhouette`);
                wall = nextWall; roof = nextRoof; height = group.userData.mainStructure.height;
                const bounds = new THREE.Box3().setFromObject(group), size = bounds.getSize(new THREE.Vector3());
                assert.ok(size.x <= PREVIEW_BUILDING_FOOTPRINT + .001 && size.z <= PREVIEW_BUILDING_FOOTPRINT + .001);
                assert.ok(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x), Math.abs(bounds.min.z), Math.abs(bounds.max.z)) <= .137 * 2 + 1e-6, 'architecture must preserve its original .274 local clearing');
                assert.ok(bounds.max.y <= .21 * 1.65 + .001, 'machinery stays within the enlarged map icon height');
                assert.ok(group.children.length <= 9, 'architecture and details share their existing material batches');
                for (const mesh of group.children as THREE.Mesh[]) {
                    assert.equal(mesh.geometry.index, null); assert.deepEqual(Object.keys(mesh.geometry.attributes).sort(), ['normal', 'position']);
                }
            }
        }
    } finally { models.dispose(); }
});

test('architecture milestones add production geometry and retain distinct racial construction', () => {
    const models = new PreviewModels(), raceProfiles = new Set<string>();
    try {
        for (const race of races) for (const building of buildings) {
            const signatures = new Set<string>(), first = models.createBuilding(building, 1, race);
            for (let i = 0; i < PREVIEW_ARCHITECTURE_LEVELS.length; i++) {
                const group = models.createBuilding(building, PREVIEW_ARCHITECTURE_LEVELS[i], race);
                assert.equal(group.userData.architectureName, PREVIEW_ARCHITECTURE_NAMES[i]); signatures.add(structureSignature(group));
            }
            const mature = models.createBuilding(building, 20, race);
            assert.equal(signatures.size, PREVIEW_ARCHITECTURE_LEVELS.length);
            assert.ok(mature.userData.mainStructure.triangles > first.userData.mainStructure.triangles * 2, 'maturity adds real halls and machinery');
            if (building === 'lumber-mill') raceProfiles.add(structureSignature(mature));
        }
        assert.equal(raceProfiles.size, races.length, 'five races must retain different main architecture');
    } finally { models.dispose(); }
});

test('mature architecture stays unchanged after twenty and all huge levels reuse the 1–24 template family', () => {
    const models = new PreviewModels();
    try {
        for (const race of races) for (const building of buildings) {
            assert.equal(models.createBuilding(building, 0, race).children.length, 0);
            const cached = new Set<THREE.BufferGeometry>();
            for (let level = 1; level <= 24; level++) for (const mesh of models.createBuilding(building, level, race).children as THREE.Mesh[]) cached.add(mesh.geometry);
            const mature = structureSignature(models.createBuilding(building, 20, race));
            for (const level of [21, 24, 25, 100, 1_000_001, Number.MAX_SAFE_INTEGER]) {
                const group = models.createBuilding(building, level, race);
                assert.equal(group.userData.architecturalLevel, 20); assert.equal(structureSignature(group), mature);
                for (const mesh of group.children as THREE.Mesh[]) assert.ok(cached.has(mesh.geometry), 'raw levels cannot grow the geometry cache');
            }
        }
    } finally { models.dispose(); }
});

test('population upgrades the central village hall itself and preserves its final mature form', () => {
    const models = new PreviewModels();
    try {
        for (const race of races) {
            let previous = '', previousHeight = 0;
            for (const population of [80, 200, 400, 800, 1600]) {
                const group = models.createVillage(race, 3, false, population), signature = structureSignature(group);
                assert.notEqual(signature, previous, 'the hall must evolve independently of the surrounding house count');
                assert.ok(group.userData.mainStructure.height > previousHeight); previous = signature; previousHeight = group.userData.mainStructure.height;
            }
            assert.equal(structureSignature(models.createVillage(race, 3, false, 1_000_000)), previous);
        }
    } finally { models.dispose(); }
});
