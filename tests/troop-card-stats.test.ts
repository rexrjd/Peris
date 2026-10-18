import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { beginRaid } from '../src/features/campaign/domain/raids';
import { emptyRoster, writeRoster } from '../src/features/army/domain/roster';
import { baseTroopStats, troopCardStats } from '../src/features/army/domain/troopCardStats';

test('recruitment base points include class damage rate and stay separate from army bonuses', () => {
    assert.deepEqual(baseTroopStats('infantry'), { attack: 100, defence: 100, speed: 40, carry: 20 });
    assert.equal(baseTroopStats('archers').attack, 60);
    assert.equal(baseTroopStats('cavalry').attack, 155);
    assert.equal(baseTroopStats('ram').carry, 0);
    const world = createSolo('Stat cards'), army = world.armies[0], city = world.settlements[0];
    world.heroes = [];
    world.city_slots = [{ settlement_id: city.id, slot_index: 0, building_type: 'smithy', level: 5 }];
    const before = structuredClone(world);
    const stats = troopCardStats(world, army, city, 'infantry', Date.parse(world.server_now));
    assert.equal(stats.attack.base, 100);
    assert.equal(stats.attack.current, 120);
    assert.equal(stats.defence.current, 100);
    assert.equal(stats.attack.sources?.[0].label, 'Home-city smithies');
    assert.ok(Math.abs(stats.attack.sources![0].amount - 20) < 1e-8);
    assert.deepEqual(world, before, 'reading cards cannot change recruitment or campaign state');
});

test('live cards use owned battle snapshots and show ranges when formations have different spells', () => {
    const world = createSolo('Battle cards'), army = world.armies[0], city = world.settlements[0];
    world.heroes = [];
    writeRoster(army, { ...emptyRoster(), infantry: 120 });
    beginRaid(world, army.owner_id, world.camps[0].id, () => 700, army.id);
    const formations = world.formations.filter(f => f.owner_id === army.owner_id);
    assert.equal(formations.length, 2);
    formations[0].unit_attack = 1;
    formations[0].attack_multiplier = 1.2;
    formations[0].magic_attack = .5;
    formations[1].unit_attack = 1;
    formations[1].attack_multiplier = 1.2;
    formations[1].magic_attack = 1.5;
    formations[0].defence_multiplier = 1.2;
    formations[0].magic_defence = .2;
    world.formations.filter(f => f.owner_id !== army.owner_id).forEach(f => { f.attack_multiplier = 99; f.magic_attack = 99; });
    const stats = troopCardStats(world, army, city, 'infantry', Date.parse(world.server_now));
    assert.equal(stats.source, 'battle');
    assert.equal(stats.attack.current, 60);
    assert.ok(Math.abs(stats.attack.maximum! - 180) < 1e-8);
    assert.ok(Math.abs(stats.defence.maximum! - 150) < 1e-8);
    assert.equal(stats.attack.sources?.find(source => source.label === 'Battle spells')?.amount, -60);
    assert.ok(Math.abs(stats.attack.sources!.reduce((sum, source) => sum + source.amount, 0) - (stats.attack.current - stats.attack.base)) < 1e-8);
    world.battles[0].attacker_army_id = 999;
    world.battles[0].defender_army_id = 998;
    world.battles[0].city_defenders = [{ army_id: army.id, troops: { ...emptyRoster(), infantry: 120 } }];
    assert.equal(troopCardStats(world, army, city, 'infantry', Date.parse(world.server_now)).source, 'battle', 'supporting city defenders use their recorded battle too');
    // Enemy and resolved formations must never contribute to an owned card.
    world.battles[0].status = 'resolved';
    assert.equal(troopCardStats(world, army, city, 'infantry', Date.parse(world.server_now)).source, 'army');
});

test('breakdown contributions add up after bonuses multiply rather than adding their percentages', () => {
    const world = createSolo('Compounded cards'), army = world.armies[0], city = world.settlements[0];
    Object.assign(world.heroes![0], { class: 'knight', attack: 0, defence: 0 });
    world.hero_artifacts = [];
    world.city_slots = [{ settlement_id: city.id, slot_index: 0, building_type: 'smithy', level: 5 }];
    const stats = troopCardStats(world, army, city, 'infantry', Date.parse(world.server_now));
    assert.ok(Math.abs(stats.attack.current - 127.2) < 1e-8);
    assert.ok(Math.abs(stats.attack.sources![0].amount - 20) < 1e-8);
    assert.ok(Math.abs(stats.attack.sources![1].amount - 7.2) < 1e-8);
});

test('a foreign commander attached to an owned army cannot supply its displayed bonus', () => {
    const world = createSolo('Owned stats'), army = world.armies[0], city = world.settlements[0];
    Object.assign(world.heroes![0], { owner_id: 'rival', attack: 100 });
    const stats = troopCardStats(world, army, city, 'infantry', Date.parse(world.server_now));
    assert.equal(stats.attack.current, 100);
    assert.ok(!stats.attack.sources!.some(row => row.label === 'Commander & equipment'));
});

test('stat rows show signed bonuses and penalties with distinct semantics and no false rounding penalty', async () => {
    const React = await import('react');
    (globalThis as any).React = React;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { TroopStatLine } = await import('../src/features/army/ui/TroopStatSummary');
    const render = (base: number, current: number) => renderToStaticMarkup(React.createElement(TroopStatLine, { label: 'Attack', stat: { base, current } }));
    const positive = render(50, 70), negative = render(40, 32), neutral = render(100, 99.99999999999);
    assert.ok(positive.includes('data-change="positive"'));
    assert.ok(positive.includes('>+20<'));
    assert.ok(negative.includes('data-change="negative"'));
    assert.ok(negative.includes('>−8<'));
    assert.ok(neutral.includes('data-change="neutral"'));
    assert.ok(!neutral.includes('>−0<'));
});
