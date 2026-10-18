import test from 'node:test';
import assert from 'node:assert/strict';
import { unitRule, unitStats, rulesForVersion } from '../src/features/army/domain/unitBalance';
import { FACTIONS, type Faction } from '../src/features/factions/domain/factions';

test('versioned stats expose comparable pressure without losing ranged class rates', () => {
    assert.equal(unitStats('infantry', {version:2,faction:'roman'}).attackPoints, 100);
    assert.equal(unitStats('cavalry', {version:2,faction:'roman'}).attackPoints, 155);
    assert.equal(unitStats('archers', {version:2,faction:'roman'}).attackPoints, 75);
    assert.equal(unitStats('archers', {version:2,faction:'roman'}).protectionPoints, 90);
    assert.equal(unitStats('archers', {version:2,faction:'persian'}).attackPoints, 78);
});

test('new recruitment is cheaper where utility was overpriced and legacy receipts retain old prices', () => {
    assert.deepEqual(unitRule('scout',1).cost, {wood:3,stone:5,food:9,gold:3});
    assert.deepEqual(unitRule('scout',2).cost, {wood:3,stone:2,food:4,gold:1});
    assert.deepEqual(unitRule('elite',1).cost, {wood:8,stone:6,food:12,gold:3});
    assert.deepEqual(unitRule('elite',2).cost, {wood:7,stone:5,food:10,gold:1});
    assert.equal(unitRule('archers',1).attack, 1);
    assert.equal(unitRule('elite',1).defence, 1.35);
    assert.equal(unitRule('archers',2).trainSeconds, 3);
});

test('all faction doctrines share recruitment economics and cannot mutate the catalog', () => {
    for (const faction of Object.keys(FACTIONS) as Faction[]) for (const unit of Object.keys(rulesForVersion(2)) as (keyof ReturnType<typeof rulesForVersion>)[]) {
        const stats=unitStats(unit,{version:2,faction}), reference=unitStats(unit,{version:2,faction:'roman'});
        assert.deepEqual(stats.cost, reference.cost);
        assert.equal(stats.trainSeconds, reference.trainSeconds);
        assert.ok(stats.attackMultiplier/reference.attackMultiplier >= .94-1e-9);
        assert.ok(stats.attackMultiplier/reference.attackMultiplier <= 1.06+1e-9);
        assert.equal(unitStats(unit,{version:1,faction}).attackMultiplier, unitRule(unit,1).attack);
    }
    assert.throws(()=>{unitRule('infantry',2).cost.gold=999;},TypeError);
    assert.equal(unitRule('infantry',2).cost.gold,1);
    assert.throws(()=>unitRule('infantry',3 as 2),/version/i);
    assert.throws(()=>unitStats('infantry',{version:2,faction:'unknown' as Faction}),/faction/i);
});
