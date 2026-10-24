import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { writeRoster } from '../src/features/army/domain/roster';
import { RallyArmyDetails } from '../src/features/army/ui/RallyArmyDetails';

(globalThis as any).React = React;

function fixture() {
    const world = createSolo('Rally presentation'), army = world.armies[0], owner = army.owner_id;
    army.faction = 'persian';
    writeRoster(army, { infantry: 5, spearmen: 4, archers: 3, elite: 2, cavalry: 1, scout: 6, heavyCavalry: 7, ram: 8, catapult: 9 });
    world.heroes = [{ id: 47, owner_id: owner, army_id: army.id, name: 'Saved commander', class: 'mage', experience: 300, attack: 0, defence: 0, power: 0, knowledge: 0 }];
    const render = (armyId = army.id) => renderToStaticMarkup(React.createElement(RallyArmyDetails, {
        world, playerId: owner, armyId, now: Date.parse(world.server_now), busy: false, onManage: () => {}, onOrders: () => {},
    }));
    return { world, army, owner, render };
}

test('Rally tray presents ten recruited identities and base totals from the saved legion', () => {
    const f = fixture(), before = JSON.stringify(f.world), html = f.render();
    assert.equal((html.match(/class="rp-unit-card(?: active)?"/g) ?? []).length, 10);
    assert.equal((html.match(/class="rp-unit-count"/g) ?? []).length, 10);
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 9]) assert.ok(html.includes(`<span class="rp-unit-count">${count}</span>`));
    assert.match(html, /Troops<\/span><strong>45<\/strong>/);
    assert.match(html, /Base carrying capacity<\/span><strong>580<\/strong>/);
    assert.match(html, /Slowest troop speed<\/span><strong>12<\/strong>/);
    assert.ok(html.includes('/art/battle/roster/persian.png'));
    assert.ok(html.includes('Saved commander'));
    assert.ok(html.includes('Level 3 Mage'));
    assert.ok(html.includes('art/heroes/portraits/persian/08.webp'));
    // Persian infantry doctrine .98 and the mage's 1.02 bonus yield 99.96 points.
    assert.match(html, /data-stat="attack" data-base="100" data-current="100"/);
    assert.equal(JSON.stringify(f.world), before);
});

test('Rally tray never renders a rival legion or a commander owned by someone else', () => {
    const f = fixture();
    f.world.armies.push({ ...f.army, id: 90, owner_id: 'rival', name: 'Private rival legion' });
    const rival = f.render(90);
    assert.ok(rival.includes('No legion selected'));
    assert.ok(!rival.includes('Private rival legion'));
    f.world.heroes![0].owner_id = 'rival';
    const own = f.render();
    assert.ok(own.includes('Unassigned commander'));
    assert.ok(!own.includes('Saved commander'));
});

test('Rally orders wait for this owned legion training while foreign queues do not block it', () => {
    const f = fixture();
    const order = { id: 8, owner_id: 'rival', army_id: f.army.id, settlement_id: 1, kind: 'recruit' as const, item: 'infantry', quantity: 10, started_at: f.world.server_now, finish_at: f.world.server_now };
    f.world.orders = [order];
    assert.match(f.render(), /class="button gold" title="Choose and confirm/);
    order.owner_id = f.owner;
    assert.match(f.render(), /class="button gold" disabled="" title="Training must finish/);
    assert.ok(f.render().includes('Training · At station'));
});
