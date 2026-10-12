import test from 'node:test';
import assert from 'node:assert/strict';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {TECHNOLOGIES,TECHNOLOGY_BY_ID} from '../src/features/research/domain/catalog';
import {ensureScience,scienceRate,advanceResearch,startResearch,pauseResearch,researchSeconds,researchDeadline,debugResearch,validateResearch,scienceSources} from '../src/features/research/domain/science';
import {researchBonuses,unitUnlocked,applyResearchFormations} from '../src/features/research/domain/effects';
import {settleLocal} from '../src/features/campaign/domain/settlement';
import {refreshCityEconomy} from '../src/features/city/domain/slots';
import {validateSave} from '../src/platform/storage/saves';
import {newBattle} from '../src/features/battle/domain/creation';
import {createAcademy} from '../src/features/city/rendering/three/academy';
import {disposeCityObject} from '../src/features/city/rendering/three/modelKit';
import {FACTIONS,type Faction} from '../src/features/factions/domain/factions';
const owner='solo-ruler';
const fixture=()=>{const w=createSolo('Scholars'),now=Date.parse(w.server_now);ensureScience(w,owner,now);return {w,now};};
test('all 210 distinct technologies form reachable shared and faction branches',()=>{
 assert.equal(TECHNOLOGIES.length,210);assert.equal(TECHNOLOGIES.filter(t=>!t.faction).length,100);
 for(const f of Object.keys(FACTIONS)){assert.equal(TECHNOLOGIES.filter(t=>t.faction===f).length,10);const done=new Set<string>(),nodes=TECHNOLOGIES.filter(t=>!t.faction||t.faction===f);for(let i=0;i<210;i++)for(const n of nodes)if(n.requires.every(id=>done.has(id)))done.add(n.id);assert.equal(done.size,110);}
});
test('idle science pools repeatable Academies across cities and ignores rivals',()=>{
 const {w,now}=fixture(),s=w.settlements[0];w.city_slots!.push({settlement_id:s.id,slot_index:4,building_type:'academy',level:1},{settlement_id:s.id,slot_index:5,building_type:'academy',level:5});w.settlements.push({...s,id:100,name:'Second City'});w.city_slots!.push({settlement_id:100,slot_index:1,building_type:'academy',level:3});w.settlements.push({...s,id:200,owner_id:'rival'});w.city_slots!.push({settlement_id:200,slot_index:1,building_type:'academy',level:5});
 assert.equal(scienceRate(w,owner),166);assert.equal(scienceSources(w,owner).length,2);advanceResearch(w,owner,now+60000);assert.equal(w.account_science![0].points,241);
});
test('switching and pausing keep exact progress and charge science once',()=>{
 const {w,now}=fixture();startResearch(w,owner,'drill-grounds',now);assert.equal(w.account_science![0].points,40);startResearch(w,owner,'writing',now+15000);assert.equal(w.research_progress!.find(p=>p.technology_id==='drill-grounds')!.seconds,15);const before=w.account_science![0].points;pauseResearch(w,owner,now+20000);assert.equal(researchSeconds(w,owner,'writing',now+100000),5);startResearch(w,owner,'drill-grounds',now+20000);assert.equal(w.account_science![0].points,before+.5);assert.equal(researchDeadline(w,owner),now+35000);advanceResearch(w,owner,now+35000);assert.ok(w.research_progress!.find(p=>p.technology_id==='drill-grounds')?.completed_at);assert.equal(w.account_science![0].active_id,null);
});
test('prerequisites, faction ownership and one active project are enforced',()=>{
 const {w,now}=fixture();assert.throws(()=>startResearch(w,owner,'spear-formations',now),/prerequisites/);assert.throws(()=>startResearch(w,owner,'elf-living-groves',now),/another faction/);startResearch(w,owner,'writing',now);assert.equal(w.account_science![0].active_id,'writing');assert.throws(()=>debugResearch({...w,debug_enabled:false},owner,'complete',now),/disabled/);
});
test('offline completion changes science rate at the deadline',()=>{
 const {w,now}=fixture();startResearch(w,owner,'writing',now);advanceResearch(w,owner,now+60000);assert.ok(Math.abs(scienceRate(w,owner)-6.3)<1e-8);assert.ok(Math.abs(w.account_science![0].points-46.15)<1e-8);assert.equal(w.research_progress![0].completed_at,new Date(now+30000).toISOString());
});
test('new Academy income starts at completed construction, not when ordered',()=>{
 const {w,now}=fixture(),sid=w.settlements[0].id;w.city_slots!.push({settlement_id:sid,slot_index:4,building_type:'academy',level:0});w.orders.push({id:901,owner_id:owner,settlement_id:sid,kind:'upgrade',item:'slot:4:academy',quantity:1,started_at:w.server_now,finish_at:new Date(now+15000).toISOString()});settleLocal(w,owner,now+30000);assert.equal(scienceRate(w,owner),18);assert.equal(w.account_science![0].points,81);
});
test('completed research affects cities, shared troop unlocks and frozen combat attributes',()=>{
 const {w,now}=fixture();for(const t of TECHNOLOGIES.filter(t=>!t.faction))w.research_progress!.push({owner_id:owner,technology_id:t.id,seconds:t.seconds,completed_at:new Date(now).toISOString()});refreshCityEconomy(w,w.settlements[0].id);assert.ok(w.settlements[0].capacity>5000);assert.ok(researchBonuses(w,owner).food>0);assert.ok(unitUnlocked(w,owner,w.settlements[0].id,'catapult',now));const battle=newBattle(902,owner,w.armies[0],w.camps[0],'plains','normal','Camp','pve',1);const first=battle.formations.find(f=>f.owner_id===owner)!;const before=first.unit_attack??1;applyResearchFormations(w,owner,battle.formations);assert.ok(first.unit_attack!>before);w.battles.push(battle.battle);w.formations.push(...battle.formations);assert.doesNotThrow(()=>validateSave(w));first.unit_attack=999;assert.throws(()=>validateSave(w));
});
test('science saves preserve progress and reject malformed or forged studies',()=>{
 const {w,now}=fixture();startResearch(w,owner,'writing',now);pauseResearch(w,owner,now+5000);const round=validateSave(JSON.parse(JSON.stringify(w)));assert.equal(round.research_progress![0].seconds,5);assert.doesNotThrow(()=>validateResearch(round));assert.throws(()=>validateResearch({...w,research_progress:[null as never]}));assert.throws(()=>validateResearch({...w,account_science:[{...w.account_science![0],points:-1}]}));const t=TECHNOLOGY_BY_ID.get('spear-formations')!;assert.throws(()=>validateResearch({...w,research_progress:[{owner_id:owner,technology_id:t.id,seconds:t.seconds,completed_at:w.server_now}]}));
});
test('all eleven factions have five distinct Academy geometry stages',()=>{for(const faction of Object.keys(FACTIONS)as Faction[]){const signatures=new Set();for(let level=1;level<=5;level++){const model=createAcademy(level,faction);let count=0;model.traverse((o:any)=>{if(o.isMesh)count+=o.geometry.attributes.position.count;});signatures.add(count);assert.ok(model.children.length<20);disposeCityObject(model);}assert.equal(signatures.size,5);}});
