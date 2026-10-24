import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {FACTIONS, type Faction} from '../src/features/factions/domain/factions';
import {TroopIcon} from '../src/features/frontier/ui/TroopIcon';
import {factionTroopName} from '../src/features/frontier/ui/roster';
import {MarchDialog} from '../src/features/map/ui/MarchDialog';
import {CityLoyalty} from '../src/features/city/ui/CityLoyalty';
import {ConquestSummary} from '../src/features/campaign/ui/ConquestSummary';
import {RecruitmentPanel} from '../src/features/army/ui/RecruitmentPanel';
import {readRoster} from '../src/features/army/domain/roster';
import {newBattle} from '../src/features/battle/domain/creation';
import {armyRole,createArmyFactory,type Army} from '../src/features/battle/rendering/three/armyAssets';
import {Box3,InstancedMesh,Vector3} from 'three';
import {battleArt,battlePresentation} from '../src/features/battle/ui/battlePresentation';

const html=(component:React.ReactElement)=>renderToStaticMarkup(component);
(globalThis as unknown as {React:typeof React}).React=React;
function fixture(){
 const world=createSolo('Capture UI'),owner=world.players[0].id,city=world.settlements[0],army=world.armies.find(a=>a.owner_id===owner)!;
 world.conquest_version=1;world.players[0].culture_points=10000;
 army.unit_roster={...readRoster(army),diplomat:30};
 const rival={...city,id:909,owner_id:'rival',name:'Rival Court',x:city.x+128,loyalty:13,loyalty_updated_at:world.server_now};
 world.settlements.push(rival);return {world,owner,city,army,rival,now:Date.parse(world.server_now)};
}
test('all eleven diplomats have their own readable original vector and faction name',()=>{
 const names=new Set<string>();
 for(const faction of Object.keys(FACTIONS) as Faction[]){
  const name=factionTroopName(faction,'diplomat');names.add(name);
  const output=html(React.createElement(TroopIcon,{faction,unit:'diplomat',portrait:true}));
  assert.match(output,/<svg/);assert.match(output,/data-diplomat-faction=/);assert.ok(output.includes(name));assert.doesNotMatch(output,/roster\/|background-position/);
 }
 assert.equal(names.size,11);
});

test('battle presentation names diplomats by faction without changing authoritative labels',()=>{
 const f=fixture(),created=newBattle(77,f.owner,f.army,f.world.camps[0],'plains','normal','Camp','pve',1,{version:2,attackerFaction:'persian',defenderFaction:'orc'});
 f.world.battles.push(created.battle);f.world.formations.push(...created.formations);
 const art=battleArt(f.world,created.battle,f.owner),shown=battlePresentation(f.world,created.battle,f.owner,art);
 assert.equal(shown.formations.find(row=>row.recruit_unit==='diplomat')!.label,'Shah’s Envoy');
 assert.equal(f.world.formations.find(row=>row.recruit_unit==='diplomat')!.label,'diplomat');
});
test('capture review hides rival loyalty, caps persuasion and uses the existing raid confirmation',()=>{
 const f=fixture(),output=html(React.createElement(MarchDialog,{world:f.world,playerId:f.owner,now:f.now,busy:false,initialArmyId:f.army.id,destination:{kind:'raidCity',cityId:f.rival.id,capture:true},run:()=>{},onClose:()=>{}}));
 assert.match(output,/Prepare city capture/);assert.match(output,/Loyalty is private/);assert.match(output,/25 per attack/);assert.match(output,/defeat the defenders/);assert.match(output,/Confirm capture/);assert.doesNotMatch(output,/13\s*\/\s*100/);
});
test('old servers retain nine roles and cannot open capture',()=>{
 const f=fixture();delete f.world.conquest_version;
 const output=html(React.createElement(MarchDialog,{world:f.world,playerId:f.owner,now:f.now,busy:false,initialArmyId:f.army.id,destination:{kind:'raidCity',cityId:f.rival.id,capture:true},run:()=>{},onClose:()=>{}}));
 assert.match(output,/does not support city capture/);assert.doesNotMatch(output,/data-unit="diplomat"/);
});
test('owned loyalty recovers with game time while rival loyalty is never rendered',()=>{
 const f=fixture();f.city.loyalty=50;f.city.loyalty_updated_at=f.world.server_now;
 const owned=html(React.createElement(CityLoyalty,{city:f.city,owner:f.owner,now:f.now+3600000}));
 assert.match(owned,/75/);assert.match(owned,/25.*game hour/);
 assert.equal(html(React.createElement(CityLoyalty,{city:f.rival,owner:f.owner,now:f.now})), '');
});
test('main-building recruitment exposes Diplomacy research and its level-two requirement',()=>{
 const f=fixture(),output=html(React.createElement(RecruitmentPanel,{world:f.world,army:f.army,city:f.city,now:f.now,busy:false,run:()=>{},buildingOnly:'main'}));
 assert.match(output,/Senator/);assert.match(output,/Unlock in Research/);assert.match(output,/Main building level 2/);
});
test('conquest receipt distinguishes capture, loyalty reduction and culture failure',()=>{
 const receipt={city_id:1,before:20,after:0,diplomats:25,reduction:20,captured:true,culture_cost:300,former_owner_id:'rival',new_owner_id:'solo-ruler'};
 const captured=html(React.createElement(ConquestSummary,{conquest:receipt}));
 assert.match(captured,/City captured/);assert.match(captured,/20.*0/);assert.match(captured,/300/);assert.match(captured,/establishes the new government/);
 const blocked=html(React.createElement(ConquestSummary,{conquest:{...receipt,after:20,reduction:0,captured:false,reason:'You need 300 culture points.'}}));
 assert.match(blocked,/You need 300 culture points/);assert.doesNotMatch(blocked,/Culture spent/);
});
test('diplomats use original instanced geometry without requesting an absent GLB role',()=>{
 const f=fixture(),created=newBattle(123,f.owner,f.army,f.world.camps[0],'plains','normal','Envoy review','pve',1);
 const formation=created.formations.find(row=>row.recruit_unit==='diplomat')!;assert.ok(formation);
 const empty:Army={parts:new Map(),dispose:()=>{}};
 const visual=createArmyFactory(empty,empty,f.owner,created.formations,undefined,undefined,'persian','demon')(formation);
 assert.equal(armyRole(formation,created.formations),'diplomat');assert.equal(visual.object.userData.faction,'persian');
 visual.update({formation,pose:{x:50,y:50,facing:0},time:0,dt:0,animate:false,height:()=>0});
 const parts:InstancedMesh[]=[];visual.object.traverse(node=>{if(node instanceof InstancedMesh)parts.push(node);});
 assert.ok(parts.length>=5);assert.ok(parts.every(part=>part.count===Math.min(120,formation.soldiers)));
 assert.ok(new Box3().setFromObject(visual.object).getSize(new Vector3()).y>8);
 let disposed=0;parts.forEach(part=>part.geometry.addEventListener('dispose',()=>disposed++));visual.dispose();assert.equal(disposed,parts.length);
});
