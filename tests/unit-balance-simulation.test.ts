import test from 'node:test';
import assert from 'node:assert/strict';
import {runScenario,budgetRoster,productionRoster} from '../scripts/check-unit-balance.mts';
test('calibration uses real fixed-step battles with reproducible casualty conservation',()=>{
 const scenario={attacker:'roman' as const,defender:'orc' as const,terrain:'plains' as const,roster:{infantry:60,archers:30,cavalry:12}};
 const first=runScenario(scenario),second=runScenario(scenario);
 assert.deepEqual(second,first);assert.equal(first.timedOut,false);
 assert.equal(first.attacker.survivors+first.attacker.losses,102);
 assert.equal(first.defender.survivors+first.defender.losses,102);
 assert.deepEqual(first.attacker.spend,{wood:480,stone:252,food:630,gold:126});
});
test('four-resource and independent-building production constraints bound scenario rosters',()=>{
 const recipe={infantry:60,archers:30,cavalry:12},budget={wood:560,stone:480,food:720,gold:120};
 const force=budgetRoster(recipe,budget);
 assert.ok(force.infantry<60,'gold limits this basket before infantry count 60');
 const time=productionRoster({infantry:10,cavalry:10},100);
 assert.equal(time.infantry,20);assert.equal(time.cavalry,20);
});
test('resource-limited elites trade soldier capacity for production and heavy cavalry retain a counter role',()=>{
 const budget={wood:560,stone:480,food:720,gold:120};
 const infantry=budgetRoster({infantry:1},budget),elites=budgetRoster({elite:1},budget);
 assert.equal(infantry.infantry,120);assert.equal(elites.elite,72);
 const light=budgetRoster({cavalry:1},budget),heavy=budgetRoster({heavyCavalry:1},budget);
 assert.equal(light.cavalry,40);assert.equal(heavy.heavyCavalry,30);
 for(const reversed of [false,true]){
  const i=runScenario({attacker:'roman',defender:'roman',terrain:'plains',roster:reversed?elites:infantry,defenderRoster:reversed?infantry:elites});
  assert.equal(i.winner,reversed?'defender':'attacker','elite capacity efficiency must not also beat the larger baseline army at this budget');
  const c=runScenario({attacker:'roman',defender:'roman',terrain:'plains',roster:reversed?light:heavy,defenderRoster:reversed?heavy:light});
  assert.equal(c.winner,reversed?'defender':'attacker');
 }
});
