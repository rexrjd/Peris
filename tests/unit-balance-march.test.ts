import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {emptyRoster,writeRoster} from '../src/features/army/domain/roster';
import {MarchDialog} from '../src/features/map/ui/MarchDialog';

(globalThis as any).React=React;

test('march review prices the selected party using its world balance version',()=>{
 const world=createSolo('March prices'),army=world.armies[0];
 const troops={...emptyRoster(),archers:10,scout:10,catapult:10};writeRoster(army,troops);
 const render=()=>renderToStaticMarkup(React.createElement(MarchDialog,{
  world,playerId:army.owner_id,now:Date.parse(world.server_now),busy:false,
  initialArmyId:army.id,initialTroops:troops,
  destination:{kind:'move',x:world.settlements[0].x,y:world.settlements[0].y,label:'Home'},run:()=>{},onClose:()=>{},
 }));
 const prices=(html:string)=>Object.fromEntries([...html.matchAll(/title="(wood|stone|food|gold): (\d+)"/g)].map(([,key,value])=>[key,Number(value)]));
 assert.deepEqual(prices(render()),{wood:340,stone:220,food:230,gold:80});
 delete world.unit_balance_version;
 assert.deepEqual(prices(render()),{wood:390,stone:270,food:320,gold:150});
});
