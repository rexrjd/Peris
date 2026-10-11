import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { CityConstructionQueue, constructionName, constructionTarget } from '../src/features/city/ui/CityConstructionQueue';
import { CityArmySummary, CityEconomySummary } from '../src/features/city/ui/CitySummary';
import { stationCell } from '../src/features/map/domain/garrisons';
import { factionTroopName } from '../src/features/frontier/ui/roster';

(globalThis as any).React = React;

test('riverside construction uses the fishery map key and completed level', () => {
    const world = createSolo('Fisher'), now = Date.parse(world.server_now);
    world.city_slots = [{ settlement_id: 1, slot_index: 16, building_type: 'fishery', level: 2 }];
    const order = { id: 123, owner_id: world.players[0].id, settlement_id: 1, kind: 'upgrade' as const, item: 'slot:16:fishery', quantity: 1, started_at: world.server_now, finish_at: new Date(now + 60000).toISOString() };
    world.orders = [order];
    assert.equal(constructionTarget(order), 'fishery');
    assert.equal(constructionName(order), 'Fishery');
    assert.equal(constructionTarget({ ...order, item: 'slot:4:stables' }), 'slot:4');
    assert.equal(constructionTarget({ ...order, item: 'market' }), 'market');
    const html = renderToStaticMarkup(React.createElement(CityEconomySummary, { world, sid: 1, owner: world.players[0].id, now, onSelect: () => {} }));
    assert.ok(html.includes('Fishery<span> → 3</span>'));
    const queue = renderToStaticMarkup(React.createElement(CityConstructionQueue, { order, level: 2, now: now + 30000, onSelect: () => {} }));
    assert.ok(queue.includes('aria-valuenow="50"'));
    assert.ok(queue.includes('0:30'));
    assert.ok(!queue.includes('role="status"'));
});

test('home ledger excludes foreign armies and legacy reserves locked to a busy legion', () => {
    const world = createSolo('Governor'), army = world.armies[0];
    world.armies.push({ ...army, id: 2, owner_id: 'foreign-ruler', infantry: 900, archers: 0, cavalry: 0 });
    world.armies.push({ ...army, id: 3, infantry: 5, archers: 0, cavalry: 0, status: 'moving', raid_target_id: world.camps[0].id, raid_reserve: { infantry: 70, archers: 20, cavalry: 10 }, departure_at: world.server_now, arrival_at: new Date(Date.parse(world.server_now) + 60000).toISOString() });
    const html = renderToStaticMarkup(React.createElement(CityArmySummary, { world, sid: 1, owner: world.players[0].id, now: Date.parse(world.server_now), onSelect: () => {} }));
    assert.ok(html.includes('data-troop="infantry">120</strong>'));
    assert.ok(html.includes('data-troop="archers">50</strong>'));
    assert.ok(html.includes('data-troop="cavalry">16</strong>'));
    assert.ok(html.includes('100 troops reserved until their legion returns'));
    assert.ok(!html.includes('foreign-ruler'));
});

test('home ledger preserves visiting legion cultures and attributes generic garrisons to the station', () => {
    const world = createSolo('Mixed cultures'), army = world.armies[0], town = world.settlements[0];
    town.faction = 'roman';
    world.settlements.push({ ...town, id: 2, name: 'Elven home', faction: 'elf', x: town.x + 256 });
    world.armies.push({ ...army, id: 2, home_settlement_id: 2, infantry: 13, archers: 7, cavalry: 3 });
    world.armies.push({ ...army, id: 3, home_settlement_id: 2, infantry: 30, archers: 30, cavalry: 30, status: 'moving', departure_at: world.server_now, arrival_at: new Date(Date.parse(world.server_now) + 60000).toISOString() });
    world.garrisons = [{ owner_id: army.owner_id, ...stationCell(town), infantry: 5, archers: 2, cavalry: 1 }];
    const html = renderToStaticMarkup(React.createElement(CityArmySummary, { world, sid: town.id, owner: army.owner_id, now: Date.parse(world.server_now), onSelect: () => {} }));
    const rows = [...html.matchAll(/<button data-faction="(roman|elf)"[^>]*>(.*?)<\/button>/g)].map(match => ({ faction: match[1], html: match[2] }));
    assert.equal(rows.length, 6);
    for (const [faction, expected] of [['roman', [125, 52, 17]], ['elf', [13, 7, 3]]] as const) {
        const culture = rows.filter(row => row.faction === faction);
        assert.equal(culture.length, 3);
        for (const [index, unit] of ['infantry', 'archers', 'cavalry'].entries()) {
            assert.ok(culture[index].html.includes(factionTroopName(faction, unit as 'infantry' | 'archers' | 'cavalry')));
            assert.ok(culture[index].html.includes(`/art/battle/roster/${faction}.png`));
            assert.ok(culture[index].html.includes(`data-troop="${unit}">${expected[index]}</strong>`));
        }
    }
    assert.ok(html.includes('Army at home <b>217</b>'));
    assert.ok(html.includes('8 troops awaiting a legion'));
});
