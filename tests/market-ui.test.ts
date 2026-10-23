import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BuildingChoices,buildingChoiceReason} from '../src/features/city/ui/BuildingPicker';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {mapActivity,filterEmpireActivity} from '../src/features/map/domain/activity';
(globalThis as unknown as {React:typeof React}).React=React;
test('Market picker explains uniqueness and disables an already occupied city Market',()=>{
 const html=renderToStaticMarkup(React.createElement(BuildingChoices,{slot:1,choice:'bazaar',onChange:()=>{},hasTower:false,hasBarracks:false,hasMarket:true}));
 assert.match(html,/Market/);assert.match(html,/Already built/);
 assert.equal(buildingChoiceReason('bazaar',{wood:9999,stone:9999,food:9999,gold:9999},false,false,false,false,true),'One Market per city');
});
test('trade events belong to both own-city endpoints without appearing for uninvolved players',()=>{
 const world=createSolo('Trade events'),s=world.settlements[0],now=Date.parse(world.server_now);
 world.settlements.push({...s,id:2,name:'Delivery city',x:s.x+128});
 world.trade_caravans=[{id:900,owner_id:s.owner_id,recipient_id:s.owner_id,source_settlement_id:s.id,target_settlement_id:2,source_city:s.name,target_city:'Delivery city',resources:{wood:40,stone:0,food:60,gold:0},returning_resources:{wood:0,stone:0,food:0,gold:0},delivered_resources:{wood:0,stone:0,food:0,gold:0},volume:100,march_path:[[s.x,s.y],[s.x+128,s.y]],departure_at:world.server_now,arrival_at:new Date(now+10000).toISOString(),return_at:new Date(now+20000).toISOString(),status:'outbound'}];
 const trade=mapActivity(world,s.owner_id,now).filter(e=>e.kind==='trade');assert.equal(trade.length,1);assert.match(trade[0].detail,/40 wood.*60 food/);assert.equal(filterEmpireActivity(trade,'all',2).length,1);assert.equal(filterEmpireActivity(trade,'all',s.id).length,1);
 assert.equal(mapActivity(world,'stranger',now).filter(e=>e.kind==='trade').length,0);
});
