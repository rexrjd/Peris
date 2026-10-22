import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapOperations } from '../src/features/map/ui/MapOperations';
import { createSolo } from '../src/features/campaign/domain/newRealm';
(globalThis as any).React = React;
test('activity countdowns convert accelerated deadlines to real seconds only once', () => {
 const world=createSolo('Clock UI'),owner=world.players[0].id,now=Date.parse(world.server_now);
 world.game_clock={version:1,rate:100,profile_id:'accelerated-test-v1',real_now:world.server_now,game_now:world.server_now};
 world.orders.push({id:900,owner_id:owner,settlement_id:world.settlements[0].id,kind:'upgrade',item:'lumber',quantity:1,started_at:world.server_now,finish_at:new Date(now+3_000_000).toISOString()});
 const html=renderToStaticMarkup(React.createElement(MapOperations,{world,playerId:owner,now,busy:false,run:()=>{},open:true,onToggle:()=>{},onLocate:()=>{},selectionKey:'test',preview:'city'}));
 assert.match(html,/class="ops-event-time">0:30</,'3000 game seconds are thirty real seconds at100x');
});
