import test from 'node:test';import assert from 'node:assert/strict';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {emptyRoster,readRoster,writeRoster} from '../src/features/army/domain/roster';
import {newBattle} from '../src/features/battle/domain/creation';
import {starveOne,refreshTroopUpkeep} from '../src/features/city/domain/troopSupply';
import {settleBattleFood} from '../src/features/city/domain/battleFood';
import {castSpell} from '../src/features/magic/domain/commands';
function fixture(){const w=createSolo('Famine');w.heroes=[];const a=w.armies[0],s=w.settlements[0];writeRoster(a,{...emptyRoster(),infantry:10});s.food=0;const instance=newBattle(99,a.owner_id,a,{infantry:10,archers:0,cavalry:0},'plains','normal','Enemy');instance.battle.phase='combat';w.battles=[instance.battle];w.formations=instance.formations;refreshTroopUpkeep(w,Date.parse(w.server_now));return {w,a,s,b:instance.battle,f:instance.formations.find(f=>f.side==='attacker')!};}
test('starvation permanently caps healing and battle finalization refunds remaining combat losses only once',()=>{
 const {w,a,s,b,f}=fixture();f.soldiers=8;
 assert.equal(starveOne(w,s,Date.parse(w.server_now)),6);assert.equal(readRoster(a).infantry,9);assert.equal(f.starvation_losses,1);assert.equal(f.soldiers,8);
 w.city_slots=[{settlement_id:1,slot_index:0,building_type:'mage_tower',level:10}];w.spell_research=[{settlement_id:1,spell_id:'resurrection',researched_at:w.server_now}];
 castSpell({world:w,playerId:a.owner_id,nextId:()=>999,active:b,now:w.server_now,paused:()=>{},finalize:()=>{}},{type:'castSpell',battleId:b.id,spell:'resurrection',target:f.id});assert.equal(f.soldiers,9);
 f.soldiers=7;writeRoster(a,{...emptyRoster(),infantry:12}); // three recruits after capture
 settleBattleFood(w,b);assert.equal(readRoster(a).infantry,10);assert.equal(s.food,12);assert.equal(b.food_settled,true);
 settleBattleFood(w,b);assert.equal(s.food,12);assert.equal(readRoster(a).infantry,10);
});
test('defender finalization distributes only non-starvation losses and preserves extra recruits',()=>{
 const {w,s,b}=fixture();const f=w.formations.find(f=>f.side==='defender')!;
 b.defender_owner_id=s.owner_id;b.defender_army_id=null;b.raid_city_id=s.id;
 b.city_defenders=[{city_garrison_id:1,troops:{...emptyRoster(),infantry:10}}];
 w.city_garrisons=[{owner_id:s.owner_id,settlement_id:s.id,...emptyRoster(),infantry:13}];
 b.starvation_sources={'city:1':{...emptyRoster(),infantry:2}};f.starvation_losses=2;f.soldiers=5;
 settleBattleFood(w,b);assert.equal(readRoster(w.city_garrisons[0]).infantry,10);assert.equal(s.food,18);
});
