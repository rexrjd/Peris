import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {GameNavigation} from '../src/shared/ui/GameNavigation';
import {RankingsContent} from '../src/features/rankings/ui/RankingsView';
import {readRankings, RankingsError, validateRankingsResponse} from '../src/features/rankings/platform/client';
import {startRankingsRead} from '../src/features/rankings/ui/reader';
import type {RankingsResponse} from '../src/features/rankings/domain/types';
(globalThis as unknown as {React:typeof React}).React=React;
const fixture=():RankingsResponse=>({version:1,period:'current',week_start:'2026-10-19T00:00:00Z',week_end:'2026-10-26T00:00:00Z',server_now:'2026-10-25T12:00:00Z',tracking_since:'2026-10-22T10:00:00Z',boards:['attack','defense','robbers','camps','growth'].map(category=>({category:category as 'attack',entries:[{rank:1,player_id:'rival',display_name:'Rival',guild_tag:'SUN',score:50,is_you:false}],self:{rank:12,player_id:'me',display_name:'Your ruler',guild_tag:null,score:12,is_you:true},total_players:12}))});
test('navigation includes Rankings and keeps Reports as an unread dialog action',()=>{
 const html=renderToStaticMarkup(React.createElement(GameNavigation,{view:'rankings',unreadReports:2,onNavigate:()=>{}}));
 assert.equal((html.match(/<button /g)??[]).length,7);assert.match(html,/aria-label="Rankings" aria-current="page"/);assert.match(html,/aria-label="Reports, 2 unread" aria-haspopup="dialog"/);assert.match(html,/src="\/art\/ui\/low-poly-v1\/rankings\.webp"/);
});
test('five boards expose units, outside Top 10 own rows, negative growth and partial solo scope',()=>{
 const data=fixture();data.boards[0].self!.rank=null;data.boards[0].self!.score=0;data.boards[4].self!.score=-3;data.boards[4].self!.rank=null;
 const html=renderToStaticMarkup(React.createElement(RankingsContent,{state:{data,loading:false,error:null},period:'current',solo:true,onPeriod:()=>{},onRetry:()=>{}}));
 assert.equal((html.match(/<table/g)??[]).length,5);
 for(const label of ['Attack','Defense','Robbers','Camps','Growth','Resources stolen','Net population','Crop-weighted kills','Your rank','Unranked','Partial week','Solo campaign','Monday 00:00 UTC','This week','Last week'])assert.ok(html.includes(label),label);
 assert.match(html,/>12<\/td>/);assert.match(html,/-3/);assert.match(html,/Tracking since/);
});
test('weekly overview has accessible category navigation and a distinct guild column in every table',()=>{
 const html=renderToStaticMarkup(React.createElement(RankingsContent,{state:{data:fixture(),loading:false,error:null},period:'current',solo:false,onPeriod:()=>{},onRetry:()=>{}}));
 assert.match(html,/role="tablist" aria-label="Ranking category"/);
 assert.equal((html.match(/role="tab"/g)??[]).length,6);
 assert.match(html,/aria-selected="true"[^>]*>Top 10/);
 assert.equal((html.match(/<th scope="col">Guild<\/th>/g)??[]).length,5);
 assert.match(html,/<td class="ranking-guild">\[SUN\]<\/td>/);
 assert.match(html,/<details class="rankings-help"/);
});
test('loading, older worlds and connection failures have helpful recoverable states',()=>{
 const render=(error:Error|null,loading=false)=>renderToStaticMarkup(React.createElement(RankingsContent,{state:{data:null,loading,error},period:'current',solo:false,onPeriod:()=>{},onRetry:()=>{}}));
 assert.match(render(null,true),/Loading standings/);
 assert.match(render(new RankingsError('World update required','unavailable')),/not available in this world yet/);
 assert.match(render(new Error('Connection interrupted')),/Retry/);
});
test('adapter sends one bounded authenticated read and strips unknown private fields',async()=>{
 let sent:unknown;
 const data=await readRankings('current',async(fn,args)=>{sent=[fn,args];return {data:{...fixture(),private_armies:[1]},error:null};});
 assert.deepEqual(sent,['peris_rankings',{p_period:'current'}]);assert.equal(data.boards.length,5);assert.equal('private_armies' in data,false);
 await assert.rejects(readRankings('previous',async()=>({data:fixture(),error:null})),/invalid/i);
 for(const code of ['PGRST202','42883'])await assert.rejects(readRankings('current',async()=>({data:null,error:{code,message:'missing'}})),(e:unknown)=>e instanceof RankingsError&&e.kind==='unavailable');
 await assert.rejects(readRankings('current',async()=>({data:null,error:{message:'offline'}})),/offline/);
});
test('malformed, unbounded and inconsistent standings are rejected',()=>{
 for(const mutate of [(d:any)=>d.boards.push(d.boards[0]),(d:any)=>d.boards[0].entries=Array(11).fill(d.boards[0].entries[0]),(d:any)=>d.boards[0].entries[0].score=Infinity,(d:any)=>d.boards[1].category='attack',(d:any)=>d.week_end='2026-10-27T00:00:00Z',(d:any)=>d.boards[0].entries[0].score=-2,(d:any)=>d.boards[0].self.is_you=false,(d:any)=>d.boards[0].self={...d.boards[0].entries[0],is_you:true},(d:any)=>d.boards[0].entries.push({...d.boards[0].entries[0],rank:2,player_id:'second'})]){
  const data=fixture();mutate(data);assert.throws(()=>validateRankingsResponse(data,'current'),/invalid/i);
 }
});
test('adapter rejects a correctly shaped response claiming the wrong calendar week',()=>{
 const data=fixture();data.week_start='2026-10-12T00:00:00Z';data.week_end='2026-10-19T00:00:00Z';
 assert.throws(()=>validateRankingsResponse(data,'current'),/invalid/i);
});
test('stopped reads never publish and overlapping refreshes stay bounded',async()=>{
 let finish!:(data:RankingsResponse)=>void,calls=0;const states:unknown[]=[];
 const reader=startRankingsRead(()=>{calls++;return new Promise(resolve=>{finish=resolve;});},'current',s=>states.push(s));
 const first=reader.refresh();await reader.refresh();assert.equal(calls,1);reader.stop();const count=states.length;finish(fixture());await first;assert.equal(states.length,count);await reader.refresh();assert.equal(calls,1);
});
test('reader rejects wrong-week responses and explicit retry can recover',async()=>{
 let attempt=0;const states:any[]=[];
 const reader=startRankingsRead(async()=>{if(++attempt===1)return {...fixture(),period:'previous'};return fixture();},'current',s=>states.push(s));
 await reader.refresh();assert.match(states.at(-1).error.message,/week/i);await reader.refresh();assert.equal(states.at(-1).data.period,'current');assert.equal(states.at(-1).error,null);reader.stop();
});
