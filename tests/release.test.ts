import assert from 'node:assert/strict'
import test from 'node:test'
import {createSolo} from '../src/lib/local'
import {validateSave} from '../src/lib/saves'
import {newBattle,applyOrder} from '../src/game/simulation'
import {conquered,nextCampaign,campaignRank} from '../src/game/campaign'

test('group marching preserves a battle line and right-drag can reform its facing',()=>{
 const w=createSolo('Rex'),{battle,formations}=newBattle(1,'solo-ruler',w.armies[0],w.camps[0],'plains','normal','Rebels')
 battle.phase='combat';const own=formations.filter(f=>f.owner_id==='solo-ruler'),before=own.map(f=>({x:f.x,y:f.y})),ids=own.map(f=>f.id)
 applyOrder(battle,formations,'solo-ruler',{kind:'move',ids,x:600,y:350})
 for(let i=1;i<own.length;i++){assert.equal(own[i].target_x-own[0].target_x,before[i].x-before[0].x);assert.equal(own[i].target_y-own[0].target_y,before[i].y-before[0].y)}
 applyOrder(battle,formations,'solo-ruler',{kind:'move',ids,x:550,y:350,facing:0,columns:7})
 assert.ok(own.every(f=>f.target_x===550&&f.target_facing===0));assert.ok(new Set(own.map(f=>f.target_y)).size===own.length)
})
test('save imports accept v6 campaigns without mutating the source and reject broken queues and geometry',()=>{
 const w=createSolo('Rex'),imported=validateSave(w);imported.armies[0].infantry=1;assert.equal(w.armies[0].infantry,120)
 const bad=structuredClone(w);bad.armies[0].target_x=NaN;assert.throws(()=>validateSave(bad));assert.throws(()=>validateSave({version:6}));assert.throws(()=>validateSave(null))
 bad.armies[0].target_x=195;bad.orders=[{id:1,owner_id:'solo-ruler',kind:'recruit',item:'unknown',quantity:20,started_at:w.server_now,finish_at:w.server_now}];assert.throws(()=>validateSave(bad))
 bad.orders=[];bad.buildings[0].level=-1;assert.throws(()=>validateSave(bad));bad.buildings[0].level=1;bad.armies[0].cavalry=1001;assert.throws(()=>validateSave(bad))
})
test('the campaign completes only when all six distinct personal standards are recovered',()=>{
 const w=createSolo('Rex');assert.equal(nextCampaign(w,'solo-ruler')?.id,1)
 w.progress=[{owner_id:'solo-ruler',camp_id:1,defeated:5,available_at:w.server_now},{owner_id:'other',camp_id:2,defeated:1,available_at:w.server_now}]
 assert.equal(conquered(w,'solo-ruler').size,1);assert.equal(nextCampaign(w,'solo-ruler')?.id,2)
 w.progress=w.camps.map(c=>({owner_id:'solo-ruler',camp_id:c.id,defeated:1,available_at:w.server_now}))
 assert.equal(nextCampaign(w,'solo-ruler'),undefined);assert.equal(campaignRank(conquered(w,'solo-ruler').size),'Restorer of Peris')
})
