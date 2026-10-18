import test from 'node:test';
import assert from 'node:assert/strict';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {newBattle} from '../src/features/battle/domain/creation';
import {validateSave} from '../src/platform/storage/saves';
import {emptyRoster,writeRoster} from '../src/features/army/domain/roster';
import {reportEconomics} from '../src/features/campaign/domain/reportEconomics';
import {emptyResources} from '../src/shared/model/resources';
import type {BattleResult} from '../src/features/battle/domain/types';

for(const version of [1,2] as const)test(`v${version} active formations survive save loading without recalculation`,()=>{
    const w=createSolo('Versioned save'),a=w.armies[0];
    writeRoster(a,{...emptyRoster(),elite:12,archers:12});
    const {battle,formations}=newBattle(900,a.owner_id,a,{infantry:12,archers:0,cavalry:0},'plains','normal','Old battle','pve',w.camps[0].id,{version,attackerFaction:'orc',defenderFaction:'elf'});
    w.battles=[battle];w.formations=formations;
    if(version===1){delete battle.balance_version;delete w.unit_balance_version;}
    const copy=JSON.parse(JSON.stringify(w)),before=structuredClone(copy.formations);
    const loaded=validateSave(copy);
    assert.deepEqual(loaded.formations,before);
    assert.equal(loaded.battles[0].balance_version,version);
    assert.equal(loaded.unit_balance_version,2);
});
test('unknown balance metadata and values outside a captured doctrine are rejected',()=>{
    const w=createSolo('Invalid balance');(w as any).unit_balance_version=3;
    assert.throws(()=>validateSave(w),/valid Peris/i);
    const good=createSolo('Invalid formation'),a=good.armies[0];
    const instance=newBattle(900,a.owner_id,a,{infantry:12,archers:0,cavalry:0},'plains','normal','Bad','pve',good.camps[0].id,{version:2,attackerFaction:'roman',defenderFaction:'elf'});
    good.battles=[instance.battle];good.formations=instance.formations;
    good.formations[0].unit_attack=.5;
    assert.throws(()=>validateSave(good),/valid Peris/i);
});
test('pruned historical report fallbacks retain v1 prices while new reports use v2',()=>{
    const r:BattleResult={attacker_initial:2,attacker_survivors:0,attacker_losses:2,defender_initial:1,defender_survivors:0,defender_losses:1,loot:emptyResources(),duration:1,reason:'Test',attacker_roster:{...emptyRoster(),scout:1,catapult:1},attacker_survivor_roster:emptyRoster()};
    assert.deepEqual(reportEconomics(r).replacementCost,{wood:33,stone:25,food:27,gold:13});
    r.balance_version=2;
    assert.deepEqual(reportEconomics(r).replacementCost,{wood:28,stone:20,food:18,gold:7});
    r.replacement_cost={wood:999,stone:0,food:0,gold:0};
    assert.equal(reportEconomics(r).replacementCost!.wood,999);
});
