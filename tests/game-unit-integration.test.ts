import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { startPractice, PRACTICE_HOSTS } from '../src/features/battle/domain/practice';
import { battleArt, battlePresentation } from '../src/features/battle/ui/battlePresentation';
import { armyFaction } from '../src/features/army/domain/faction';
import { armyRole } from '../src/features/battle/rendering/three/armyAssets';
import { readArmyCultures } from '../src/engine/online/armyCultures';
import { FACTIONS, type Faction } from '../src/features/factions/domain/factions';

test('every faction and doctrine offers all seven troop looks without altering campaign assets', () => {
    for (const faction of Object.keys(FACTIONS) as Faction[]) for (const doctrine of Object.keys(PRACTICE_HOSTS) as (keyof typeof PRACTICE_HOSTS)[]) {
        const world = createSolo('Roster QA'), before = JSON.stringify([world.armies, world.settlements, world.heroes]);
        startPractice(world, 'solo-ruler', () => 99, 'plains', 'normal', doctrine, faction, 'demon');
        const art = battleArt(world, world.battles[0], 'solo-ruler');
        assert.equal(art.faction, faction); assert.equal(art.enemy, 'demon'); assert.equal(art.prototypes, true);
        const own = world.formations.filter(f => f.owner_id === 'solo-ruler');
        assert.equal(own.length, 7);
        assert.deepEqual(new Set(own.map(f => armyRole(f, world.formations))), new Set(['line_infantry', 'spear_guard', 'elite', 'archer', 'scout', 'light_cavalry', 'heavy_cavalry']));
        for (const type of ['infantry', 'archers', 'cavalry'] as const) assert.equal(own.filter(f => f.unit_type === type).reduce((n, f) => n + f.soldiers, 0), PRACTICE_HOSTS[doctrine][type]);
        assert.equal(JSON.stringify([world.armies, world.settlements, world.heroes]), before);
    }
});

test('campaign and PvP visuals follow the army home, swap sides for defenders, and never rewrite saves', () => {
    const world = createSolo('Campaign QA'), city = world.settlements[0]; city.faction = 'elf';
    world.settlements.push({ ...city, id: 90, faction: 'dwarf' }); world.armies[0].home_settlement_id = 90;
    startPractice(world, 'solo-ruler', () => 9, 'woods', 'normal');
    const battle = world.battles[0]; delete battle.attacker_faction; delete battle.defender_faction; battle.mode = 'pve';
    const art = battleArt(world, battle, 'solo-ruler'); assert.equal(art.faction, 'dwarf'); assert.equal(art.enemy, 'roman');
    const saved = JSON.stringify(world), shown = battlePresentation(world, battle, 'solo-ruler', art);
    assert.notEqual(shown.formations[0].label, world.formations[0].label); assert.equal(JSON.stringify(world), saved);
    assert.equal(shown.formations[0].id, world.formations[0].id); assert.equal(shown.formations[0].soldiers, world.formations[0].soldiers);
    world.armies.push({ ...world.armies[0], id: 20, owner_id: 'rival', home_settlement_id: 91, faction: 'undead' });
    battle.mode = 'pvp'; battle.defender_owner_id = 'rival'; battle.defender_army_id = 20;
    assert.equal(armyFaction(world, world.armies[1]), 'undead', 'remote home culture survives outside viewport');
    const defending = battleArt(world, battle, 'rival'); assert.equal(defending.faction, 'undead'); assert.equal(defending.enemy, 'dwarf');
});

test('multiplayer cosmetic lookup resolves missing opponent armies and remote homes with bounded public fields', async () => {
    const world = createSolo('Online QA'); startPractice(world, 'solo-ruler', () => 7, 'plains', 'normal');
    world.battles[0].mode = 'pvp'; world.battles[0].defender_army_id = 42;
    const calls: unknown[] = [];
    const cultures = await readArmyCultures(world, {
        armies: async ids => { calls.push(ids); return [{ id: 42, owner_id: 'rival', home_settlement_id: 71 }]; },
        cities: async ids => { calls.push(ids); return [{ id: world.armies[0].home_settlement_id, faction: 'elf' }, { id: 71, faction: 'demon' }]; },
    });
    assert.deepEqual(calls[0], [42]); assert.equal(cultures.get(42), 'demon'); assert.equal(cultures.get(world.armies[0].id), 'elf');
    assert.ok((calls[1] as number[]).includes(71));
});
