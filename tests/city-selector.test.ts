import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { citySelectorEntries, cityPreviewState } from '../src/features/city/domain/citySelector';
import { stationCell } from '../src/features/map/domain/garrisons';
import { createCityThumbnailModel } from '../src/features/city/rendering/cityThumbnail';
import { disposeCityObject } from '../src/features/city/rendering/three/modelKit';
import { cityLayout } from '../src/features/city/rendering/three/layout';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CitySceneWorkspace } from '../src/features/city/ui/CitySceneWorkspace';
import { emptyRoster } from '../src/features/army/domain/roster';

(globalThis as any).React = React;
test('3D identity presents shared preview and population and army instead of faction and level', () => {
    const world = createSolo('Preview'), town = world.settlements[0];
    const html = renderToStaticMarkup(React.createElement(CitySceneWorkspace, {
        world, owner: town.owner_id, sid: town.id, now: Date.parse(world.server_now), plots: [], scene: null, run: () => {}, busy: false, onSelect: () => {},
    }));
    assert.ok(html.includes('class="city-selector"'));
    assert.ok(html.includes('city-selector-preview'));
    assert.ok(html.includes('Population'));
    assert.ok(html.includes('aria-describedby='), 'city button exposes its visible population and army counts');
    assert.ok(html.includes('Open city economy report'));
    assert.ok(!html.includes('city-scene-name'));
});


test('3D city has a right-hand garrison card, not the old Defence launcher or fullscreen modal', () => {
    const world = createSolo('Guard'), town = world.settlements[0];
    world.city_garrisons = [{owner_id:town.owner_id, settlement_id:town.id, infantry:12, archers:8, cavalry:0,
        unit_roster:{...emptyRoster(), infantry:12, archers:8}}];
    const wall = world.buildings.find(row => row.settlement_id === town.id && row.building_type === 'wall');
    if (wall) wall.level = 5;
    const html = renderToStaticMarkup(React.createElement(CitySceneWorkspace, {
        world, owner:town.owner_id, sid:town.id, now:Date.parse(world.server_now),
        plots:[], scene:null, run:()=>{}, busy:false, onSelect:()=>{},
    }));
    assert.ok(html.includes('class="city-garrison-dock"'), 'a dedicated garrison surface is always visible');
    assert.ok(html.includes('class="city-garrison-card"'));
    assert.ok(html.includes('20</b> permanent'), 'shows real permanently stationed defenders');
    assert.ok(html.includes('Wall Lv. 5'));
    assert.ok(html.includes('+50%'));
    assert.ok(html.includes('Automatic defence'));
    assert.ok(html.includes('aria-expanded="false"'), 'the garrison editor is collapsed by default');
    assert.ok(!html.includes('city-garrison-launch'), 'obsolete Defence tab has been removed');
    assert.ok(!html.includes('city-garrison-overlay'), 'old full-screen modal has been removed');
    assert.ok(html.indexOf('class="city-selector"') < html.indexOf('class="city-garrison-dock"'),
        'city selector is on the left and garrison on the right');
});

test('selector lists only owned cities and counts residents and physically stationed troops', () => {
    const world = createSolo('Preview'), town = world.settlements[0], army = world.armies[0], now = Date.parse(world.server_now);
    town.population = 37;
    world.settlements.push({ ...town, id: 2, x: town.x + 512, name: 'Second' }, { ...town, id: 3, owner_id: 'rival', name: 'Private rival' });
    army.start_x = army.target_x = town.x; army.start_y = army.target_y = town.y;
    world.armies.push({ ...army, id: 2, status: 'moving', arrival_at: new Date(now + 60000).toISOString() });
    const entries = citySelectorEntries(world, town.owner_id, now);
    assert.deepEqual(entries.map(entry => entry.id), [town.id, 2]);
    assert.equal(entries[0].population, 37);
    assert.equal(entries[0].army, 186);
    assert.equal(entries[1].army, 0);
    world.garrisons = [{ owner_id: town.owner_id, ...stationCell(town), infantry: 7, archers: 2, cavalry: 1 }];
    assert.equal(citySelectorEntries(world, town.owner_id, now)[0].army, 196);
    world.armies[0].status = 'moving';
    assert.equal(citySelectorEntries(world, town.owner_id, now)[0].army, 10);
});

test('thumbnail uses actual city plots and releases its geometry without changing state', () => {
    const world = createSolo('Preview');
    world.buildings.forEach(building => building.level = 3);
    const state = cityPreviewState(world, world.settlements[0].id), before = JSON.stringify(state);
    const model = createCityThumbnailModel(state);
    for (const plot of cityLayout(state.levels, state.slots, state.environment)) {
        const object = model.getObjectByName(plot.key)!;
        assert.ok(object, `real plot ${plot.key}`);
        assert.equal(object.position.x, plot.x); assert.equal(object.position.z, plot.z);
    }
    assert.equal(JSON.stringify(state), before);
    let geometries = 0, disposed = 0;
    const seen = new Set();
    model.traverse((object: any) => {
        if (object.geometry && !seen.has(object.geometry)) {
            seen.add(object.geometry); geometries++;
            object.geometry.addEventListener('dispose', () => disposed++);
        }
    });
    disposeCityObject(model);
    assert.ok(geometries > 0); assert.equal(disposed, geometries);
});

test('preview identity follows architecture, seeded layout and development rather than live resource ticks', () => {
    const world = createSolo('Preview'), town = world.settlements[0];
    const initial = cityPreviewState(world, town.id);
    town.population = 50; town.wood += 1; town.name = 'Renamed'; world.armies[0].infantry += 10;
    assert.equal(cityPreviewState(world, town.id).key, initial.key);
    world.buildings.find(building => building.building_type === 'wall')!.level = 2;
    assert.notEqual(cityPreviewState(world, town.id).key, initial.key);
    const built = cityPreviewState(world, town.id);
    world.city_slots!.push({ settlement_id: town.id, slot_index: 0, building_type: 'housing', level: 1 });
    assert.notEqual(cityPreviewState(world, town.id).key, built.key);
    const housed = cityPreviewState(world, town.id);
    town.faction = 'persian';
    assert.notEqual(cityPreviewState(world, town.id).key, housed.key);
    const faction = cityPreviewState(world, town.id);
    town.x += 512;
    assert.notEqual(cityPreviewState(world, town.id).key, faction.key);
});

test('preserved inland fishery orders show the same river frontage as the live city', () => {
    const world = createSolo('Preview'), town = world.settlements[0];
    assert.equal(cityPreviewState(world, town.id).environment.water, 'none');
    world.orders.push({ id: 901, owner_id: town.owner_id, settlement_id: town.id, kind: 'upgrade', item: 'slot:16:fishery', quantity: 1, started_at: world.server_now, finish_at: world.server_now });
    assert.equal(cityPreviewState(world, town.id).environment.water, 'river');
});
