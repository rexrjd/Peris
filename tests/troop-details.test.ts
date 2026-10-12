import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { beginRaid } from '../src/features/campaign/domain/raids';
import { RECRUIT_UNITS, RECRUIT_RULES, emptyRoster, writeRoster } from '../src/features/army/domain/roster';
import { troopDetails } from '../src/features/army/domain/troopDetails';
import { recruitmentPlan } from '../src/features/army/domain/commandRoom';
import { UNITS } from '../src/features/army/domain/units';
import { TECHNOLOGIES } from '../src/features/research/domain/catalog';
import { researchFactor, unitTechnology } from '../src/features/research/domain/effects';

test('troop inspector agrees with raid formations for every role and does not mutate the save', () => {
    const world = createSolo('Troop inspector'), army = world.armies[0], city = world.settlements[0], now = Date.parse(world.server_now);
    writeRoster(army, Object.fromEntries(RECRUIT_UNITS.map(unit => [unit, 10])) as ReturnType<typeof emptyRoster>);
    world.city_slots = [{ settlement_id: city.id, slot_index: 0, building_type: 'smithy', level: 3 }, { settlement_id: city.id, slot_index: 1, building_type: 'barracks', level: 4 }];
    world.hero_artifacts = [{ id: 901, owner_id: army.owner_id, artifact_id: 'iron_sword', hero_id: world.heroes![0].id }];
    const technologies = TECHNOLOGIES.filter(t => !t.faction && Object.keys(t.effects).some(key => /attack|defence|carry|training/.test(key))).slice(0, 12);
    world.research_progress = technologies.map(t => ({ owner_id: army.owner_id, technology_id: t.id, seconds: t.seconds, completed_at: world.server_now }));
    const before = structuredClone(world), inspected = RECRUIT_UNITS.map(unit => troopDetails(world, army, city, unit, now));
    assert.deepEqual(world, before, 'inspecting units must not spend resources, add formations or normalize the save');
    beginRaid(world, army.owner_id, world.camps[0].id, () => 900, army.id);
    for (const [index, unit] of RECRUIT_UNITS.entries()) {
        const formation = world.formations.find(row => row.owner_id === army.owner_id && row.recruit_unit === unit)!;
        assert.ok(formation, `${unit} must keep its actual identity`);
        const stats = inspected[index];
        assert.equal(stats.attack, (formation.unit_attack ?? 1) * (formation.attack_multiplier ?? 1), `${unit} attack`);
        assert.equal(stats.defence, (formation.unit_defence ?? 1) * (formation.defence_multiplier ?? 1), `${unit} defence`);
        assert.equal(stats.speed, UNITS[formation.unit_type].speed * (formation.unit_speed ?? 1), `${unit} movement`);
        assert.equal(stats.count, 10);
        assert.equal(stats.carry, RECRUIT_RULES[unit].carry * researchFactor(world, army.owner_id, 'carry'));
        assert.equal(stats.trainTenSeconds, recruitmentPlan(world, army, city, unit, 10, now).seconds);
    }
});

test('zero-count and locked units expose their stats, unlocks and correct batch training minimum', () => {
    const world = createSolo('Empty army'), army = world.armies[0], city = world.settlements[0], now = Date.parse(world.server_now);
    writeRoster(army, emptyRoster());
    const catapult = troopDetails(world, army, city, 'catapult', now);
    assert.equal(catapult.count, 0); assert.equal(catapult.unlocked, false);
    assert.equal(catapult.technology?.id, unitTechnology('catapult')?.id);
    assert.equal(catapult.range, UNITS.archers.range); assert.equal(catapult.rule.building, 'workshop');
    assert.equal(catapult.carry, 0); assert.equal(catapult.trainTenSeconds, 180);
    const infantry = troopDetails(world, army, city, 'infantry', now);
    assert.equal(infantry.unlocked, true); assert.equal(infantry.range, 0);
    assert.equal(infantry.plan.seconds, 5); assert.equal(infantry.trainTenSeconds, 20);
    world.unit_research = [{ settlement_id: city.id, unit: 'catapult', completes_at: world.server_now }];
    assert.equal(troopDetails(world, army, city, 'catapult', now).unlocked, true);
});
