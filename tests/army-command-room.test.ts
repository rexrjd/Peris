import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { armyOverview, recruitmentPlan, rebaseReason, trainingOrders, transferReason } from '../src/features/army/domain/commandRoom';
import { ArmyView, type CommandTab } from '../src/features/army/ui/ArmyView';
import { ArmyMapPicker } from '../src/features/army/ui/ArmyMapPicker';
import { HireArmyDialog } from '../src/features/heroes/ui/HireArmyDialog';
import { HeroPortrait } from '../src/features/heroes/ui/HeroPortrait';
import { FACTIONS, type Faction } from '../src/features/factions/domain/factions';
import { heroForArmy } from '../src/features/heroes/domain/heroes';
import { soldierTotal } from '../src/features/army/domain/units';
import type { Order } from '../src/shared/model/world';

(globalThis as any).React = React;
function fixture() {
    const world = createSolo('Command'), army = world.armies[0], city = world.settlements[0], owner = army.owner_id, now = Date.parse(world.server_now);
    Object.assign(city, { wood: 5000, stone: 5000, food: 5000, gold: 5000 });
    world.city_slots = [{ settlement_id: city.id, slot_index: 0, building_type: 'barracks', level: 2 }, { settlement_id: city.id, slot_index: 1, building_type: 'stables', level: 1 }];
    const other = { ...army, id: 999, name: 'Astra’s army', infantry: 10, archers: 5, cavalry: 0 };
    world.armies.push(other);
    world.heroes!.push({ id: 998, owner_id: owner, army_id: other.id, name: 'Astra', class: 'mage', experience: 300, attack: 0, defence: 0, power: 0, knowledge: 0 });
    const order = (armyId: number, quantity = 20): Order => ({ id: 888 + world.orders.length, owner_id: owner, army_id: armyId, settlement_id: city.id, kind: 'recruit', item: 'infantry', quantity, started_at: world.server_now, finish_at: new Date(now + 60000).toISOString() });
    const render = (tab: CommandTab = 'army', armyId = army.id) => renderToStaticMarkup(React.createElement(ArmyView, { world, playerId: owner, now, armyId, cityId: city.id, run: () => {}, busy: false, initialTab: tab, onArmy: () => {}, onCity: () => {}, onMap: () => {} }));
    return { world, army, other, city, owner, now, order, render };
}

test('command room has a horizontal owned army roster and one focused management view', () => {
    const f = fixture();
    f.world.armies.push({ ...f.other, id: 777, owner_id: 'rival', name: 'Enemy banner' });
    for (const tab of ['army', 'commander', 'equipment', 'logistics'] as CommandTab[]) {
        const html = f.render(tab, f.other.id);
        assert.ok(html.includes('command-army-roster'));
        assert.ok(html.includes('Astra'));
        assert.ok(!html.includes('Enemy banner'));
        assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
        assert.ok(!html.includes('hero-workspace'));
        assert.ok(!html.includes('Raise another army'));
    }
    assert.ok(f.render().includes('Recruit infantry'));
    assert.ok(!f.render().includes('Four paths. Your choice.'));
    assert.ok(f.render('logistics').includes('Receiver after'));
    f.other.target_x += 500;
    assert.ok(f.render('logistics').includes('March to meet Astra'));
});

test('recruitment plans keep each army queue and city supplies independent', () => {
    const f = fixture();
    f.world.orders.push(f.order(f.other.id, 100));
    assert.equal(trainingOrders(f.world, f.army).length, 0);
    assert.equal(armyOverview(f.world, f.other, f.now).queued, 100);
    assert.equal(armyOverview(f.world, f.other, f.now).state, 'Training');
    const plan = recruitmentPlan(f.world, f.army, f.city, 'infantry', 20, f.now);
    assert.equal(plan.reason, null);
    assert.equal(plan.seconds, 34);
    const second = { ...f.city, id: 333, name: 'Northwatch', gold: 0, x: f.city.x + 500 };
    f.world.settlements.push(second);
    assert.match(recruitmentPlan(f.world, f.army, second, 'infantry', 20, f.now).reason!, /Northwatch/);
    assert.equal(recruitmentPlan(f.world, f.army, second, 'infantry', 20, f.now).resources.gold, 0);
});

test('recruitment max respects city resources, pending troops, capacity and batch limit', () => {
    const f = fixture();
    Object.assign(f.army, { infantry: 950, archers: 0, cavalry: 0 });
    f.world.orders.push(f.order(f.army.id, 30));
    f.city.gold = 12;
    const before = structuredClone(f.world), plan = recruitmentPlan(f.world, f.army, f.city, 'infantry', 25, f.now);
    assert.equal(plan.max, 12); assert.equal(plan.free, 20);
    assert.match(plan.reason!, /20 spaces/);
    assert.ok(plan.finishSeconds > plan.seconds);
    assert.deepEqual(f.world, before);
    Object.assign(f.army, { infantry: 970 });
    assert.match(recruitmentPlan(f.world, f.army, f.city, 'infantry', 1, f.now).reason!, /no room/);
});

test('recruitment clearly blocks marching, missing buildings and full queues', () => {
    const f = fixture();
    f.army.status = 'moving';
    assert.match(recruitmentPlan(f.world, f.army, f.city, 'infantry', 10, f.now).reason!, /Stop/);
    f.army.status = 'idle'; f.world.city_slots = [];
    assert.match(recruitmentPlan(f.world, f.army, f.city, 'cavalry', 10, f.now).reason!, /stables/);
    f.world.city_slots.push({ settlement_id: f.city.id, slot_index: 0, building_type: 'barracks', level: 1 });
    f.world.orders.push(f.order(f.army.id), f.order(f.army.id), f.order(f.army.id));
    assert.match(recruitmentPlan(f.world, f.army, f.city, 'infantry', 10, f.now).reason!, /three training slots/);
});

test('transfer preview rejects movement, distance, queues, enemy receivers and overflow', () => {
    const f = fixture(), troops = { infantry: 5, archers: 0, cavalry: 0 };
    assert.equal(transferReason(f.world, f.army, f.other, troops, f.now), null);
    f.other.status = 'moving'; assert.match(transferReason(f.world, f.army, f.other, troops, f.now)!, /stopped/);
    f.other.status = 'idle'; f.other.target_x += 500;
    assert.match(transferReason(f.world, f.army, f.other, troops, f.now)!, /together/);
    f.other.target_x = f.army.target_x; f.world.orders.push(f.order(f.other.id));
    assert.match(transferReason(f.world, f.army, f.other, troops, f.now)!, /training queues/);
    f.world.orders = []; f.other.infantry = 995;
    assert.match(transferReason(f.world, f.army, f.other, troops, f.now)!, /room for 0/);
    f.other.owner_id = 'enemy'; assert.match(transferReason(f.world, f.army, f.other, troops, f.now)!, /your roster/);
});

test('transfer uses wrapped world distance and previews without mutating armies', () => {
    const f = fixture(), troops = { infantry: 5, archers: 0, cavalry: 0 };
    f.army.target_x = 12790; f.other.target_x = -12790;
    const before = structuredClone(f.world);
    assert.equal(transferReason(f.world, f.army, f.other, troops, f.now), null);
    assert.deepEqual(f.world, before);
    assert.match(transferReason(f.world, f.army, f.other, { ...troops, infantry: f.army.infantry + 1 }, f.now)!, /available/);
});

test('changing home is blocked during training and enables only at another owned city', () => {
    const f = fixture(), city = { ...f.city, id: 333, name: 'Southgate' };
    f.world.settlements.push(city);
    assert.match(rebaseReason(f.world, f.army, f.city, f.now)!, /already/);
    assert.equal(rebaseReason(f.world, f.army, city, f.now), null);
    f.world.orders.push(f.order(f.army.id));
    assert.match(rebaseReason(f.world, f.army, city, f.now)!, /Finish training/);
    f.world.orders = []; city.x += 400;
    assert.match(rebaseReason(f.world, f.army, city, f.now)!, /Southgate/);
});

test('commander view explains skill points, attribute sources and empire-wide magic', () => {
    const f = fixture(), hero = heroForArmy(f.world, f.other.id)!;
    f.world.hero_artifacts = [{ id: 901, owner_id: f.owner, hero_id: hero.id, artifact_id: 'runestaff' }];
    const city = { ...f.city, id: 333, name: 'Academy' }; f.world.settlements.push(city);
    f.world.city_slots!.push({ settlement_id: city.id, slot_index: 0, building_type: 'mage_tower', level: 2 });
    f.world.spell_research = [{ settlement_id: city.id, spell_id: 'spark', researched_at: f.world.server_now }];
    const html = f.render('commander', f.other.id);
    assert.ok(html.includes('2 skill points to spend'));
    assert.ok(html.includes('3 class + 0 trained + 4 equipment'));
    assert.ok(html.includes('60 battle mana'));
    assert.ok(html.includes('Spark'));
    assert.ok(html.includes('Command effects'));
});

test('equipment is a visual loadout and shared inventory with equipped items identified', () => {
    const f = fixture(), hero = heroForArmy(f.world, f.army.id)!;
    f.world.hero_artifacts = [{ id: 901, owner_id: f.owner, hero_id: hero.id, artifact_id: 'iron_sword' }, { id: 902, owner_id: f.owner, hero_id: null, artifact_id: 'warblade' }, { id: 903, owner_id: 'enemy', hero_id: null, artifact_id: 'oak_staff' }];
    const html = f.render('equipment');
    assert.ok(html.includes('Iron oath')); assert.ok(html.includes('Dawnblade'));
    assert.ok(html.includes('Return to backpack')); assert.ok(html.includes('Shared backpack · 2 artifacts'));
    assert.ok(!html.includes('Staff of embers')); assert.ok(!html.includes('<select'));
    f.world.hero_artifacts = [{ id: 904, owner_id: f.owner, hero_id: heroForArmy(f.world, f.other.id)!.id, artifact_id: 'runestaff' }];
    const shared = f.render('equipment');
    assert.ok(shared.includes('Astra is carrying this artifact'));
    assert.ok(shared.includes('View hero')); assert.ok(!shared.includes('Equip Staff'));
});

test('raising an army presents three classes and a city context without submitting early', () => {
    const f = fixture();
    const html = renderToStaticMarkup(React.createElement(HireArmyDialog, { world: f.world, owner: f.owner, cityId: f.city.id, now: f.now, run: () => {}, busy: false, onClose: () => {}, onCreated: () => {} }));
    assert.ok(html.includes('Choose your commander.')); assert.ok(html.includes('Knight')); assert.ok(html.includes('Ranger')); assert.ok(html.includes('Mage'));
    assert.ok(html.includes('Raise army · 500 gold')); assert.ok(html.includes('Found another city'));
    assert.ok(html.includes('City for new army')); assert.ok(html.includes('starts with no soldiers'));
});

test('army map picker switches owned commanders and exposes their status', () => {
    const f = fixture(); f.world.orders.push(f.order(f.other.id));
    const html = renderToStaticMarkup(React.createElement(ArmyMapPicker, { world: f.world, army: f.army, now: f.now, onChoose: () => {} }));
    assert.ok(html.includes('Choose army')); assert.ok(html.includes('Astra')); assert.ok(html.includes('Training'));
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
});

test('stale selections and old saves without heroes still open safely', () => {
    const f = fixture();
    assert.ok(f.render('army', -999).includes(f.army.name));
    f.world.heroes = [];
    assert.ok(f.render('commander').includes('No commander assigned'));
    assert.ok(f.render('equipment').includes('A hero is needed'));
    f.world.armies = [];
    assert.ok(f.render().includes('Your first banner awaits.'));
});

test('native hero portraits cover every faction and all three commander classes', () => {
    for (const faction of Object.keys(FACTIONS) as Faction[]) for (const heroClass of ['knight', 'ranger', 'mage'] as const) {
        const html = renderToStaticMarkup(React.createElement(HeroPortrait, { faction, heroClass }));
        assert.ok(html.includes('command-portrait')); assert.ok(html.includes('linearGradient'));
        assert.ok(!html.includes('NaN'));
    }
});
