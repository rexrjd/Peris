import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {ReportDetails} from '../src/features/campaign/ui/ReportDetails';
import {mapActivity} from '../src/features/map/domain/activity';
import {rallyPointState} from '../src/features/army/domain/rallyPoint';
import type {Report} from '../src/features/campaign/domain/types';
import {writeRoster} from '../src/features/army/domain/roster';
import {MarchDialog} from '../src/features/map/ui/MarchDialog';

(globalThis as any).React=React;
function fixture(){
 const world=createSolo('Scout reader'),owner=world.players[0].id,city=world.settlements[0],army=world.armies[0],camp=world.camps[0],now=Date.parse(world.server_now);
 const scouting={mission_id:77,mode:'resources',target:{kind:'camp',id:camp.id,name:'Recorded watch',faction:'persian',x:camp.x,y:camp.y},observed_at:world.server_now,scouts_sent:12,scouts_lost:2,scouts_survived:10,detected:true,success:true,troops:{infantry:7,archers:3,cavalry:2,scout:4},resources:{wood:4321,stone:3210,food:2109,gold:1098}};
 const report={id:88,battle_id:89,owner_id:owner,title:'Scouting: Recorded watch',won:true,created_at:world.server_now,result:{attacker_initial:12,attacker_survivors:10,attacker_losses:2,defender_initial:0,defender_survivors:0,defender_losses:0,loot:{wood:0,stone:0,food:0,gold:0},duration:0,reason:'Scouting',report_side:'attacker',scouting}} as unknown as Report;
 const mission={id:77,owner_id:owner,source_settlement_id:city.id,source_army_id:army.id,target_camp_id:camp.id,target_city_id:null,target_owner_id:null,target_name:camp.name,faction:'roman',mode:'resources',initial_scouts:12,scouts:12,status:'outbound',origin_x:city.x,origin_y:city.y,target_x:camp.x,target_y:camp.y,sent_at:world.server_now,departure_at:new Date(now+30000).toISOString(),arrival_at:new Date(now+120000).toISOString(),cancel_until:new Date(now+30000).toISOString(),march_path:[[city.x,city.y],[camp.x,camp.y]],march_distance:100};
 return {world,owner,city,army,camp,now,report,scouting,mission};
}
const render=(f:ReturnType<typeof fixture>)=>renderToStaticMarkup(React.createElement(ReportDetails,{world:f.world,playerId:f.owner,report:f.report}));
test('scouting receipts show the recorded role and resource snapshot without combat rewards',()=>{
 const f=fixture(),html=render(f);
 assert.match(html,/Scouting successful/);assert.match(html,/Recorded watch/);assert.match(html,/Observed at/);assert.match(html,/4,321/);assert.match(html,/Observed troops/);assert.match(html,/Persian/);
 for(const absent of ['Hero XP','Recorded spoils','Resource delivery','Battle details','Equipment received'])assert.ok(!html.includes(absent),absent);
});
test('defence scouting shows only the recorded Main and wall levels, while failed and detection receipts never render intel',()=>{
 const f=fixture();Object.assign((f.report.result as any).scouting,{target:{...f.scouting.target,kind:'city'},mode:'defences',resources:undefined,defences:{wall:4,main:3}});
 let html=render(f);assert.match(html,/Wall/);assert.match(html,/Main building/);assert.ok(!html.includes('Observed resources'));
 for(const side of ['attacker','defender']){
  Object.assign(f.report.result,{report_side:side,scouting:{...f.scouting,success:false,reason:'All scouts lost'}});
  html=render(f);assert.match(html,side==='defender'?/Scouts detected/:/Scouting failed/);assert.ok(!html.includes('4,321'));assert.ok(!html.includes('Observed troops'));assert.ok(!html.includes('Main building'));
  if(side==='defender'){assert.match(html,/Scouts intercepted/);assert.ok(!html.includes('Survived'));}
 }
});
test('camp scouting never presents administrative defence levels even if an older receipt supplies zeros',()=>{
 const f=fixture();Object.assign((f.report.result as any).scouting,{mode:'defences',resources:undefined,defences:{wall:0,main:0}});
 const html=render(f);assert.match(html,/Camps have no wall or Main building/);assert.ok(!html.includes('Observed defences'));assert.ok(!html.includes('Level 0'));
});
test('Events and Rally expose only owned scout parties with one cancellation token and retain overdue deadlines',()=>{
 const f=fixture();(f.world as any).scouting_missions=[f.mission,{...f.mission,id:78,owner_id:'rival',target_city_id:f.city.id},{...f.mission,id:79,status:'completed'}];
 const before=JSON.stringify(f.world),events=mapActivity(f.world,f.owner,f.now).filter(e=>e.kind===('scouting' as any));
 assert.equal(events.length,1);assert.equal(events[0].troops,12);assert.deepEqual((events[0] as any).scoutCancel,{missionId:77,sentAt:f.world.server_now,until:f.now+30000});
 const rally=rallyPointState(f.world,f.owner,f.city.id,f.now);assert.equal(rally.outgoing.length,1);assert.equal((rally.outgoing[0] as any).missionId,77);assert.equal(rally.outgoing[0].troops.scout,12);assert.equal(rally.incoming.length,0);
 assert.equal(mapActivity(f.world,f.owner,f.now+130000).find(e=>e.id==='scouting:77')?.endsAt,f.now+120000);
 assert.equal((mapActivity(f.world,f.owner,f.now+30000).find(e=>e.id==='scouting:77') as any)?.scoutCancel,undefined);
 assert.equal(JSON.stringify(f.world),before);
});
test('returning scouts enter their destination Rally without retaining a cancellation or being conflated with their idle legion',()=>{
 const f=fixture();(f.world as any).scouting_missions=[{...f.mission,status:'returning',scouts:10,target_x:f.city.x,target_y:f.city.y,march_path:[[f.camp.x,f.camp.y],[f.city.x,f.city.y]]}];
 const state=rallyPointState(f.world,f.owner,f.city.id,f.now);assert.equal(state.incoming.length,1);assert.equal(state.incoming[0].troops.scout,10);assert.equal(state.outgoing.length,0);assert.equal((state.incoming[0] as any).scoutCancel,undefined);
});
test('scouting review offers both intel choices and a faction scout allocation while blocking old servers',async()=>{
 const {ScoutingDialog}=await import('../src/features/scouting/ui/ScoutingDialog');
 const f=fixture();f.world.scouting_version=1;writeRoster(f.army,{infantry:120,archers:50,cavalry:16,scout:25});
 const html=()=>renderToStaticMarkup(React.createElement(ScoutingDialog,{world:f.world,playerId:f.owner,now:f.now,busy:false,initialArmyId:f.army.id,target:{campId:f.camp.id},run:()=>{},onClose:()=>{}}));
 let view=html();assert.match(view,/Resources and troops/);assert.match(view,/Defences and troops/);assert.match(view,/Scouts to send/);assert.match(view,/25 available/);assert.match(view,/Commander and other troops remain/);assert.match(view,/Source city/);assert.ok(!/disabled=""[^>]*>Confirm scouting/.test(view));
 delete f.world.scouting_version;view=html();assert.match(view,/does not support scouting/);assert.match(view,/disabled=""[^>]*>Confirm scouting/);
});
test('a standard raid review identifies an all-scout party as resources reconnaissance rather than a combat raid',()=>{
 const f=fixture();f.world.scouting_version=1;writeRoster(f.army,{infantry:120,archers:50,cavalry:16,scout:25});
 const html=renderToStaticMarkup(React.createElement(MarchDialog,{world:f.world,playerId:f.owner,now:f.now,busy:false,initialArmyId:f.army.id,initialTroops:{infantry:0,archers:0,cavalry:0,scout:8},destination:{kind:'raid',campId:f.camp.id},run:()=>{},onClose:()=>{}}));
 assert.match(html,/Scouting mission/);assert.match(html,/Resources and troops/);assert.match(html,/Commander and other troops remain/);assert.ok(!html.includes('Confirm raid'));assert.match(html,/Confirm scouting/);
});
test('scout review does not name a neighbouring owned field as its source city',async()=>{
 const {ScoutingDialog}=await import('../src/features/scouting/ui/ScoutingDialog');const f=fixture();f.world.scouting_version=1;writeRoster(f.army,{infantry:120,archers:50,cavalry:16,scout:25});
 // Only 61 units from the village marker, but already inside the next field.
 Object.assign(f.army,{start_x:256,target_x:256,start_y:315,target_y:315});
 const html=renderToStaticMarkup(React.createElement(ScoutingDialog,{world:f.world,playerId:f.owner,now:f.now,busy:false,initialArmyId:f.army.id,target:{campId:f.camp.id},run:()=>{},onClose:()=>{}}));
 assert.match(html,/<dt>Source city<\/dt><dd>Bring an idle legion to your city<\/dd>/);assert.match(html,/disabled=""[^>]*>Confirm scouting/);
});
