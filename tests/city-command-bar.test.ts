import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { cityOverview } from '../src/features/city/domain/overview';
import { CityHeader } from '../src/features/city/ui/CityHeader';
import { CityReport } from '../src/features/city/ui/CityReport';
import type { CitySlot } from '../src/features/city/domain/slots';

(globalThis as any).React = React;
function fixture() {
    const world = createSolo('123'), town = world.settlements[0], owner = world.players[0].id, now = Date.parse(world.server_now);
    return { world, town, owner, now };
}

test('header shows available plots and separate residents, staffing and report controls', () => {
    const f = fixture();
    f.world.buildings.find(b => b.building_type === 'market')!.level = 5;
    f.town.faction = 'orc';
    f.world.city_slots = Array.from({ length: 15 }, (_, slot_index) => ({ settlement_id: f.town.id, slot_index, building_type: 'barracks', level: 1 } as CitySlot));
    const html = renderToStaticMarkup(React.createElement(CityHeader, { world: f.world, owner: f.owner, sid: f.town.id, now: f.now, onSelect: () => {} }));
    for (const text of ["123&#x27;s Keep", 'Orcs', '1 free plot', 'Residents', 'Staffing', 'City report']) assert.ok(html.includes(text), text);
    assert.ok(html.includes('Open residents and housing details.'));
    assert.ok(html.includes('Open production and worker details.'));
    assert.ok(!html.includes('<summary>'));
    assert.ok(!html.includes('15 / 16 plots'));
});

test('city switching remains labeled and lists every owned city, excluding rivals', () => {
    const f = fixture();
    f.world.settlements.push({ ...f.town, id: 2, name: 'Second home' }, { ...f.town, id: 3, owner_id: 'rival', name: 'Rival home' });
    const html = renderToStaticMarkup(React.createElement(CityHeader, { world: f.world, owner: f.owner, sid: 2, now: f.now, onCity: () => {}, onSelect: () => {} }));
    assert.ok(html.includes('aria-label="Current city"'));
    assert.ok(html.includes('value="2" selected=""'));
    assert.ok(html.includes('Second home'));
    assert.ok(!html.includes('Rival home'));
});

test('housing recommendations select an upgrade in this city or a genuinely free slot', () => {
    const f = fixture();
    f.world.city_slots = [{ settlement_id: f.town.id, slot_index: 0, building_type: 'housing', level: 0 }, { settlement_id: 999, slot_index: 1, building_type: 'housing', level: 1 }];
    let model = cityOverview(f.world, f.town.id, f.now);
    assert.equal(model.firstFreePlot, 1);
    assert.equal(model.housingTarget, 'slot:1');
    assert.equal(model.housingAction, 'Build housing');
    f.world.city_slots.push({ settlement_id: f.town.id, slot_index: 3, building_type: 'housing', level: 2 });
    model = cityOverview(f.world, f.town.id, f.now);
    assert.equal(model.housingTarget, 'slot:3');
    assert.equal(model.housingAction, 'Upgrade housing');
});

test('a full lower-level city offers expansion, without inventing an empty plot', () => {
    const f = fixture();
    f.world.city_slots = Array.from({ length: 6 }, (_, slot_index) => ({ settlement_id: f.town.id, slot_index, building_type: 'barracks', level: 1 } as CitySlot));
    const model = cityOverview(f.world, f.town.id, f.now);
    assert.equal(model.freePlots, 0);
    assert.equal(model.firstFreePlot, undefined);
    assert.equal(model.housingTarget, 'market');
    assert.equal(model.housingAction, 'Expand the city');
});

test('food depletion takes priority and the report offers a real farm destination', () => {
    const f = fixture();
    Object.assign(f.town, { population: 300, population_capacity: 400, food: 3, workers_required: 500 });
    const model = cityOverview(f.world, f.town.id, f.now);
    assert.equal(model.issues[0].kind, 'food');
    assert.equal(model.issues[0].target, 'farm');
    assert.ok(model.issues.some(issue => issue.kind === 'workers'));
    const html = renderToStaticMarkup(React.createElement(CityReport, { world: f.world, sid: f.town.id, now: f.now, onSelect: () => {}, onClose: () => {} }));
    assert.ok(html.includes('Improve food production'));
    assert.ok(html.includes('Reserves last about'));
});

test('report sections explain housing, net food and workforce without mutating saves', () => {
    const f = fixture(), before = structuredClone(f.world);
    const render = (initialTab: 'overview' | 'residents' | 'production') => renderToStaticMarkup(React.createElement(CityReport, { world: f.world, sid: f.town.id, now: f.now + 60000, initialTab, onSelect: () => {}, onClose: () => {} }));
    const residents = render('residents'), production = render('production');
    assert.ok(residents.includes('Each housing level adds 30 places'));
    assert.ok(residents.includes('Build housing'));
    assert.ok(production.includes('FOOD BALANCE'));
    assert.ok(production.includes('Workers and production details'));
    assert.equal((production.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.deepEqual(f.world, before);
});
