import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import assert from 'node:assert/strict';
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try{
 const {ResultBody}=await server.ssrLoadModule('/src/features/campaign/ui/Chronicle.tsx');
 const base={attacker_initial:100,defender_initial:80,attacker_survivors:91,defender_survivors:0,attacker_losses:9,defender_losses:80,loot:{wood:180,stone:140,food:220,gold:60},duration:83,reason:'Army routed'};
 const reward={hero_id:20,hero_name:'Test commander',hero_class:'knight',faction:'dwarf',experience:0,experience_before:19000,experience_after:19000,level_before:20,level_after:20,artifacts:[],inventory_full:true};
 const render=(result,extra={})=>renderToStaticMarkup(React.createElement(ResultBody,{result,won:true,enemyName:'Bandit camp',...extra}));
 const full=render({...base,hero_reward:reward});assert.ok(full.includes('Maximum hero level reached'));assert.ok(full.includes('Backpack full (200 items)'));assert.ok(full.includes('+0'));assert.ok(!full.includes('NaN'));
 const old=render(base);assert.ok(!old.includes('Hero XP'));assert.ok(!old.includes('Equipment'));assert.ok(old.includes('Resource spoils'));
 const defeat=render({...base,hero_reward:{...reward,experience:20,experience_before:0,experience_after:20,level_before:1,level_after:1,inventory_full:false}}, {won:false});assert.ok(defeat.includes('Defeat'));assert.ok(defeat.includes('+20'));assert.ok(!defeat.includes('Equipment received'));assert.ok(!defeat.includes('Resource spoils'));
 const practice=render({...base,hero_reward:{...reward,artifacts:[{id:30,artifact_id:'iron_sword'}]}},{practice:true});assert.ok(practice.includes('Practice battle'));assert.ok(!practice.includes('Hero XP'));assert.ok(!practice.includes('Iron oath'));
 const maxGain=render({...base,hero_reward:{...reward,experience:100,experience_before:18900,level_before:19,inventory_full:false}});assert.ok(maxGain.includes('1 new skill point'));assert.ok(maxGain.includes('Level 19 → 20'));
 console.log('PASS · max XP/full backpack, legacy reports, defeat, practice and final-level skill points render truthfully');
}finally{await server.close();}
