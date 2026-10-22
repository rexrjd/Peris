import assert from 'node:assert/strict';
import test from 'node:test';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {statePollInterval,PollBackoff} from '../src/platform/backend/polling';

test('idle and hidden accounts use fewer polls; active battles retain 850ms ticks',()=>{
 const world=createSolo('Poller'),owner=world.players[0].id;
 assert.equal(statePollInterval(world,owner,false),10000);
 assert.equal(statePollInterval(world,owner,true),30000);
 world.battles.push({status:'active'} as typeof world.battles[number]);
 assert.equal(statePollInterval(world,owner,false),850);
 assert.equal(statePollInterval(world,owner,true),850);
});

test('construction, travel, raids, expeditions and research retain the existing 2550ms checks',()=>{
 const fixture=()=>{const world=createSolo('Poller');return {world,owner:world.players[0].id};};
 const cases=[
  ({world,owner}:ReturnType<typeof fixture>)=>world.orders.push({owner_id:owner} as typeof world.orders[number]),
  ({world}:ReturnType<typeof fixture>)=>{world.armies[0].status='moving';},
  ({world}:ReturnType<typeof fixture>)=>{world.armies[0].raid_target_id=1;},
  ({world}:ReturnType<typeof fixture>)=>{world.armies[0].raid_city_id=5;},
  ({world,owner}:ReturnType<typeof fixture>)=>{world.settler_expeditions=[{owner_id:owner,status:'travelling'} as NonNullable<typeof world.settler_expeditions>[number]];},
  ({world,owner}:ReturnType<typeof fixture>)=>{world.account_science=[{owner_id:owner,active_id:'technology'} as NonNullable<typeof world.account_science>[number]];},
  ({world}:ReturnType<typeof fixture>)=>{world.unit_research=[{settlement_id:world.settlements[0].id,unit:'spearmen',completes_at:new Date(Date.parse(world.server_now)+30000).toISOString()}];},
 ];
 for(const mutate of cases){const state=fixture();mutate(state);assert.equal(statePollInterval(state.world,state.owner,false),2550);assert.equal(statePollInterval(state.world,state.owner,true),2550);}
});

test('old completed research and another ruler\'s queued work do not force fast polling',()=>{
 const world=createSolo('Poller'),owner=world.players[0].id;
 world.orders.push({owner_id:'another-owner'} as typeof world.orders[number]);
 world.unit_research=[{settlement_id:world.settlements[0].id,unit:'spearmen',completes_at:world.server_now}];
 assert.equal(statePollInterval(world,owner,false),10000);
});

test('overload retries grow from five seconds to a bounded minute and reset on success',()=>{
 const backoff=new PollBackoff();assert.equal(backoff.ready(0),true);
 for(const delay of [5000,10000,20000,40000,60000,60000]){
  backoff.fail(100000);assert.equal(backoff.ready(100000+delay-1),false);assert.equal(backoff.ready(100000+delay),true);
 }
 backoff.reset();assert.equal(backoff.ready(0),true);
 backoff.fail(0);assert.equal(backoff.ready(5000),true);
});

test('owned evacuation and new city shipment journeys retain timely state checks',()=>{
 for(const key of ['ruin_evacuations','city_reinforcements'] as const){
  const world=createSolo('Poller'),owner=world.players[0].id;
  Object.assign(world,{[key]:[{owner_id:owner}]});
  assert.equal(statePollInterval(world,owner,false),2550,key);
 }
});
