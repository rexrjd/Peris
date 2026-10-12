import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CityCamera } from '../src/features/city/rendering/three/CityCamera';
import { createBuildingModel } from '../src/features/city/rendering/three/buildingModels';
import { createSlotModel } from '../src/features/city/rendering/three/slotModels';
import { createCityActivities } from '../src/features/city/rendering/three/cityActivities';
import { cityLayout } from '../src/features/city/rendering/three/layout';
import { disposeCityObject } from '../src/features/city/rendering/three/modelKit';
import { FACTIONS, type Faction } from '../src/features/factions/domain/factions';

test('city camera preserves the cursor ground point and zoom/rotation through resize and expansion', () => {
    const view = new CityCamera(); view.resize(1440, 700, 2);
    const anchor = new THREE.Vector2(.15, -.1), before = view.ground(anchor)!;
    view.zoom(1.5, anchor);
    assert.ok(before.distanceTo(view.ground(anchor)!) < 1e-8);
    view.rotate(Math.PI / 2, true); view.resize(500, 700, 5);
    assert.equal(view.rotation, Math.PI / 2); assert.equal(view.camera.zoom, 1.5);
    view.zoom(100); assert.equal(view.camera.zoom, 3);
    view.zoom(.0001); assert.equal(view.camera.zoom, .7);
    view.reset(); assert.equal(view.rotation, 0); assert.equal(view.camera.zoom, 1);
    assert.equal(view.target.x, 0);
});

test('camera remains finite after invalid inputs and smooth rotation finishes at its requested angle', () => {
    const view = new CityCamera(); view.resize(0, 0, 0);
    view.zoom(NaN); view.zoom(-1); view.rotate(Infinity);
    assert.equal(view.camera.zoom, 1); assert.equal(view.rotation, 0);
    view.rotate(Math.PI / 8); assert.ok(view.moving);
    for (let i = 0; i < 100; i++) view.step(1 / 30, false);
    assert.equal(view.rotation, Math.PI / 8); assert.equal(view.moving, false);
    view.rotate(-Math.PI / 4); view.step(0, true);
    assert.equal(view.rotation, -Math.PI / 8);
});

test('all factions keep static map models and opt into separate working city parts', () => {
    for (const faction of Object.keys(FACTIONS) as Faction[]) {
        const staticModel = createBuildingModel('farm', 5, faction);
        let staticMotion = 0; staticModel.traverse(object => { if (object.userData.cityMotion) staticMotion++; });
        assert.equal(staticMotion, 0);
        const working = createBuildingModel('farm', 5, faction, true);
        let blades = 0; working.traverse(object => { if (object.userData.cityMotion === 'spinSlow') blades++; });
        assert.equal(blades, 2);
        const activities = createCityActivities(), plots = cityLayout({ farm: 5 }, []);
        activities.setModels(new Map([['farm', { model: working }]]), plots, faction);
        const blade = working.children.find(object => object.userData.cityMotion === 'spinSlow')!;
        const original = blade.rotation.z;
        activities.animate(4); assert.notEqual(blade.rotation.z, original);
        // Economy updates reuse existing models; their rest transforms must not drift.
        activities.setModels(new Map([['farm', { model: working }]]), plots, faction);
        activities.animate(0, true); assert.equal(blade.rotation.z, original);
        disposeCityObject(staticModel); disposeCityObject(working); disposeCityObject(activities.group);
    }
});

test('smoke and mage effects are batched, disappear for reduced motion, and clear after demolition', () => {
    const smithy = createSlotModel('smithy', 5, 'roman', true), mage = createSlotModel('mage_tower', 10, 'roman', true);
    const plots = cityLayout({}, [{ settlement_id: 1, slot_index: 0, building_type: 'smithy', level: 5 }, { settlement_id: 1, slot_index: 1, building_type: 'mage_tower', level: 10 }]);
    smithy.position.set(plots[6].x, 0, plots[6].z); mage.position.set(plots[7].x, 0, plots[7].z);
    const activities = createCityActivities(); activities.setModels(new Map([['slot:0', { model: smithy }], ['slot:1', { model: mage }]]), plots, 'roman');
    const [smoke, motes] = activities.group.children as THREE.InstancedMesh[];
    assert.equal(smoke.count, 6); assert.equal(motes.count, 12);
    activities.animate(2); assert.ok(smoke.visible && motes.visible);
    activities.animate(2, true); assert.ok(!smoke.visible && !motes.visible);
    activities.setModels(new Map(), [], 'roman'); assert.equal(smoke.count + motes.count, 0);
    disposeCityObject(smithy); disposeCityObject(mage); disposeCityObject(activities.group);
});
