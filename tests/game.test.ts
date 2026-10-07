import test from 'node:test'
import assert from 'node:assert/strict'
import { createSolo } from '../src/features/campaign/domain/newRealm'
import { settleLocal } from '../src/features/campaign/domain/settlement'
import { applyOrder } from '../src/features/battle/domain/orders'
import { finishBattle } from '../src/features/battle/domain/resolution'
import { makeFormations } from '../src/features/battle/domain/formations'
import { newBattle } from '../src/features/battle/domain/creation'
import { stepBattle } from '../src/features/battle/domain/simulation'
import { armyPosition } from '../src/features/map/domain/movement'
import { buildingCost } from '../src/features/city/domain/construction'
import { terrainAt } from '../src/features/battle/domain/terrain'

test('offline production changes at the actual upgrade completion time',()=>{
 const w=createSolo('Rex'),s=w.settlements[0],start=Date.parse('2026-01-01T00:00:00Z')
 s.wood=0;s.resources_updated_at=new Date(start).toISOString();s.wood_rate=14
 w.orders=[{id:1,owner_id:w.players[0].id,kind:'upgrade',item:'lumber',quantity:1,started_at:new Date(start).toISOString(),finish_at:new Date(start+60000).toISOString()}]
 settleLocal(w,w.players[0].id,start+120000)
 assert.equal(s.wood,14+22);assert.equal(s.wood_rate,22);assert.equal(w.players[0].upgrades,1)
 settleLocal(w,w.players[0].id,start+120000);assert.equal(s.wood,36);assert.equal(w.players[0].upgrades,1)
})
test('frequent settlement updates do not lose fractional resource income',()=>{
 const w=createSolo('Rex'),s=w.settlements[0],start=Date.parse(s.resources_updated_at);s.gold=0
 for(let i=1;i<=600;i++)settleLocal(w,w.players[0].id,start+i*100)
 assert.ok(Math.abs(s.gold-3)<1e-8)
})
test('production stops at resource capacity and army travel interpolates offline',()=>{
 const w=createSolo('Rex'),s=w.settlements[0],a=w.armies[0],start=Date.parse(s.resources_updated_at)
 s.wood=s.capacity-1;settleLocal(w,w.players[0].id,start+120000);assert.equal(s.wood,s.capacity)
 a.status='moving';a.start_x=0;a.start_y=0;a.target_x=100;a.target_y=200;a.departure_at=new Date(start).toISOString();a.arrival_at=new Date(start+10000).toISOString()
 assert.deepEqual(armyPosition(a,start+5000),{x:50,y:100});assert.deepEqual(armyPosition(a,start+20000),{x:100,y:200})
})
test('formations conserve troop numbers when splitting large armies',()=>{
 const fs=makeFormations(1,{infantry:541,archers:241,cavalry:103},'own','attacker')
 for(const [type,n]of Object.entries({infantry:541,archers:241,cavalry:103}))assert.equal(fs.filter(f=>f.unit_type===type).reduce((n,f)=>n+f.soldiers,0),n)
 assert.ok(fs.every(f=>f.initial_soldiers>0))
})
test('formation ownership and deployment limits are enforced atomically',()=>{
 const w=createSolo('Rex'),{battle:b,formations:fs}=newBattle(1,'own',w.armies[0],{infantry:80,archers:30,cavalry:10},'plains','normal','Enemy')
 assert.throws(()=>applyOrder(b,fs,'other',{kind:'move',ids:[fs[0].id],x:250,y:150}))
 const own=fs.filter(f=>f.owner_id==='own'),before=own.map(f=>({x:f.x,y:f.y}))
 assert.throws(()=>applyOrder(b,fs,'own',{kind:'move',ids:own.map(f=>f.id),x:360,y:200}))
 assert.deepEqual(own.map(f=>({x:f.x,y:f.y})),before)
 assert.throws(()=>applyOrder(b,fs,'own',{kind:'attack',ids:[own[0].id],target:fs.at(-1)!.id}))
})
test('deployment never inflicts casualties; combat resolves and preserves survivors',()=>{
 const w=createSolo('Rex'),{battle:b,formations:fs}=newBattle(1,'own',w.armies[0],{infantry:30,archers:0,cavalry:0},'plains','easy','Enemy')
 stepBattle(b,fs,.1);assert.equal(b.elapsed,0);assert.equal(fs.at(-1)!.soldiers,30)
 b.phase='combat';const enemy=fs.find(f=>f.owner_id===null)!
 for(const f of fs.filter(f=>f.owner_id==='own')){f.x=enemy.x-35;f.y=enemy.y;f.target_formation_id=enemy.id}
 for(let i=0;i<5000&&b.status==='active';i++)stepBattle(b,fs,.1)
 assert.equal(b.status,'resolved');assert.equal(b.winner_side,'attacker');assert.ok(b.result!.attacker_survivors>0)
 const result=JSON.stringify(b.result);finishBattle(b,fs,'defender','duplicate');assert.equal(JSON.stringify(b.result),result)
})
test('terrain changes cover, height and crossing speed',()=>{
 assert.equal(terrainAt('woods',525,185).cover,.6);assert.equal(terrainAt('highlands',650,285).height,1)
 assert.equal(terrainAt('river',600,345).speed,1);assert.equal(terrainAt('river',600,10).speed,.42)
 assert.equal(terrainAt('plains',600,10).cover,1)
})
test('rear charges shock morale, while braced infantry mitigates frontal cavalry damage',()=>{
 const run=(rear:boolean,guard:boolean)=>{
  const w=createSolo('Rex'),{battle:b,formations:fs}=newBattle(1,'own',{...w.armies[0],infantry:0,archers:0,cavalry:24},{infantry:60,archers:0,cavalry:0},'plains','normal','Enemy')
  b.phase='combat';const f=fs[0],t=fs[1];t.facing=180;t.stance=guard?'guard':'balanced';t.x=600;t.y=350
  f.x=rear?635:565;f.y=350;f.target_formation_id=t.id;f.charge_ready=true;stepBattle(b,fs,.1)
  return {morale:t.morale,soldiers:t.soldiers}
 }
 const rear=run(true,false),front=run(false,false),brace=run(false,true)
 assert.ok(rear.soldiers<front.soldiers);assert.ok(rear.morale<front.morale);assert.ok(brace.soldiers>=front.soldiers)
})
test('cost scaling agrees with the database progression curve',()=>{
 assert.deepEqual(buildingCost('lumber',0),{wood:150,stone:90,food:70,gold:10})
 assert.deepEqual(buildingCost('lumber',1),{wood:233,stone:140,food:109,gold:16})
})
