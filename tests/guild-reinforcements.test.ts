import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {guildReinforcementSources} from '../src/features/social/domain/reinforcements';
import {mapActivity,filterEmpireActivity} from '../src/features/map/domain/activity';

test('guild source picker excludes marching, training, foreign and misplaced armies',()=>{
 const w=createSolo('Support'),owner=w.players[0].id,city=w.settlements[0],army=w.armies[0];
 w.city_garrisons=[{owner_id:owner,settlement_id:city.id,infantry:20,archers:0,cavalry:0}];
 assert.equal(guildReinforcementSources(w,owner).length,2);
 army.status='moving';assert.deepEqual(guildReinforcementSources(w,owner).map(s=>s.key),['garrison:'+city.id]);
 army.status='idle';w.orders.push({id:999,owner_id:owner,settlement_id:city.id,army_id:army.id,kind:'recruit',item:'infantry',quantity:1,started_at:w.server_now,finish_at:w.server_now});
 assert.equal(guildReinforcementSources(w,owner).length,1);
 w.orders=[];army.target_x+=128;army.start_x+=128;assert.equal(guildReinforcementSources(w,owner).length,1);
 army.owner_id='other';assert.equal(guildReinforcementSources(w,owner).length,1);
});

test('guild support appears for both participants, filters at owned endpoints and hides from outsiders',()=>{
 const w=createSolo('Support'),owner=w.players[0].id,city=w.settlements[0];
 w.guild_reinforcements=[{id:1,owner_id:owner,recipient_id:'ally',source_settlement_id:city.id,target_settlement_id:99,source_city:city.name,target_city:'Dawnwatch',owner_name:'Support',recipient_name:'Ally',target_x:192,target_y:64,faction:'persian',troops:{infantry:12,archers:3,cavalry:0},status:'outbound',departure_at:w.server_now,arrival_at:new Date(Date.parse(w.server_now)+60000).toISOString()}];
 const events=mapActivity(w,owner,Date.parse(w.server_now)).filter(e=>e.guildReinforcementId);
 assert.equal(events.length,1);assert.equal(events[0].troops,15);assert.equal(events[0].destination,'Dawnwatch');
 assert.deepEqual(events[0].selection,{kind:'cell',col:1,row:0},'offscreen guild cities retain a coordinate selection for City-to-Map navigation');
 assert.equal(filterEmpireActivity(events,'armies',city.id).length,1);
 assert.equal(mapActivity(w,'ally',0).filter(e=>e.guildReinforcementId).length,1);
 assert.equal(mapActivity(w,'outsider',0).length,0);
 w.guild_reinforcements[0].status='stationed';w.guild_reinforcements[0].arrival_at=null;
 assert.equal(mapActivity(w,owner,0).find(e=>e.guildReinforcementId)?.supportStatus,'stationed');
 w.settlements.push({...city,id:99,owner_id:'ally',name:'Dawnwatch'});
 Object.assign(w.guild_reinforcements[0],{status:'returning',recipient_city_id:99,recipient_city:'Dawnwatch',target_settlement_id:city.id,target_city:city.name});
 const incoming=mapActivity(w,'ally',0).filter(e=>e.guildReinforcementId);
 assert.equal(filterEmpireActivity(incoming,'armies',99).length,1,'returning support stays associated with the originally supported city');
});
