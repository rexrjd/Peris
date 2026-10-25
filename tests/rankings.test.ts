import test from 'node:test';
import assert from 'node:assert/strict';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {newBattle} from '../src/features/battle/domain/creation';
import {emptyRoster} from '../src/features/army/domain/roster';
import {validateRankings} from '../src/features/rankings/domain/validation';
import {validateSave} from '../src/platform/storage/saves';
import {settleLocal} from '../src/features/campaign/domain/settlement';
import {beginRaid} from '../src/features/campaign/domain/raids';
import {finishBattle} from '../src/features/battle/domain/resolution';
import {LocalEngine} from '../src/engine/local/LocalEngine';
import {utcWeekStart,ensureRankings,captureBattleRanking,finalizeRankedBattle,syncRankingsPopulation,rankingsResponse,splitDefensePoints} from '../src/features/rankings/domain/rankings';

const NOW=Date.parse('2026-10-25T23:59:59Z'), OWNER='solo-ruler';
function fixture(mode:'pve'|'pvp'|'practice'|'scouting'='pve'){
 const w=createSolo('Ruler');ensureRankings(w,NOW);
 const {battle:b,formations}=newBattle(101,OWNER,w.armies[0],{infantry:10,archers:4,cavalry:3},'plains','normal','Enemy',mode,1);
 if(mode==='pvp')b.defender_owner_id='rival';
 w.battles.push(b);w.formations.push(...formations);captureBattleRanking(w,b.id);
 return {w,b,formations};
}
function finish(f:ReturnType<typeof fixture>){
 for(const row of f.formations){row.soldiers=Math.max(0,row.initial_soldiers-(row.side==='defender'?2:1));}
 // The scoring boundary consumes the settled result rather than creating combat outcomes.
 f.b.status='resolved';f.b.phase='finished';
 f.b.result={attacker_initial:186,defender_initial:17,attacker_survivors:180,defender_survivors:11,attacker_losses:6,defender_losses:6,loot:{wood:5,stone:7,food:11,gold:13},duration:1,reason:'test'};
}
const score=(w:ReturnType<typeof createSolo>,category:string,now=NOW,period:'current'|'previous'='current')=>rankingsResponse(w,OWNER,period,now).boards.find(b=>b.category===category)!.self!.score;

test('calendar weeks begin Monday UTC across Sunday and year boundaries',()=>{
 assert.equal(utcWeekStart(NOW),'2026-10-19T00:00:00.000Z');
 assert.equal(utcWeekStart(NOW+1000),'2026-10-26T00:00:00.000Z');
 assert.equal(utcWeekStart(Date.parse('2027-01-01T13:00:00Z')),'2026-12-28T00:00:00.000Z');
});
test('NPC casualties use crop weighting, exclude starvation, and finalized loot scores exactly once',()=>{
 const f=fixture();finish(f);
 const mounted=f.formations.find(row=>row.side==='defender'&&row.unit_type==='cavalry')!;mounted.starvation_losses=1;
 finalizeRankedBattle(f.w,f.b.id,NOW);assert.equal(score(f.w,'camps'),6);assert.equal(score(f.w,'attack'),0);assert.equal(score(f.w,'robbers'),36);
 f.w.reports=[];f.b.result!.loot.wood=999;finalizeRankedBattle(f.w,f.b.id,NOW);assert.equal(score(f.w,'robbers'),36);
});
test('practice and scouting cannot score and capture keeps resources out of robbery',()=>{
 for(const mode of ['practice','scouting'] as const){const f=fixture(mode);finish(f);finalizeRankedBattle(f.w,f.b.id,NOW);for(const board of rankingsResponse(f.w,OWNER,'current',NOW).boards)assert.equal(board.self!.score,0);}
 const f=fixture('pvp');finish(f);f.b.result!.conquest={captured:true} as never;finalizeRankedBattle(f.w,f.b.id,NOW);assert.equal(score(f.w,'robbers'),0);assert.equal(score(f.w,'attack'),8);
});
test('defense allocations conserve integer kills with deterministic remainder ties',()=>{
 assert.deepEqual(splitDefensePoints(5,[{player_id:'b',weight:1},{player_id:'a',weight:1},{player_id:'c',weight:1}]),[{player_id:'a',score:2},{player_id:'b',score:2},{player_id:'c',score:1}]);
 const f=fixture('pvp');finish(f);f.formations.find(row=>row.side==='attacker')!.soldiers-=2;const pending=f.w.rankings!.pending.find(p=>p.battle_id===f.b.id)!;
 pending.defenders=[{player_id:'rival',weight:1},{player_id:'ally',weight:2}];f.b.defender_owner_id='captured';
 finalizeRankedBattle(f.w,f.b.id,NOW);
 const board=rankingsResponse(f.w,OWNER,'current',NOW).boards.find(b=>b.category==='defense')!;
 assert.equal(board.entries.reduce((n,e)=>n+e.score,0),8);assert.deepEqual(board.entries.map(e=>[e.player_id,e.score]),[['ally',5],['rival',3]]);
});
test('captured party and guild owners survive pending save reload, pool deletion and city capture',()=>{
 const w=createSolo('Ruler'),host='rival',ally='ally',city={...w.settlements[0],id:2,owner_id:host,name:'Defended city'};
 w.settlements.push(city);
 const hostTroops={...emptyRoster(),infantry:2},guildTroops={...emptyRoster(),cavalry:2};
 w.city_garrisons=[{owner_id:host,settlement_id:city.id,...hostTroops}];
 w.guild_reinforcements=[{
  id:77,owner_id:ally,recipient_id:host,source_settlement_id:3,target_settlement_id:city.id,
  source_city:'Ally city',target_city:city.name,owner_name:'Ally',recipient_name:'Rival',
  target_x:city.x,target_y:city.y,faction:'roman',troops:guildTroops,status:'stationed',departure_at:w.server_now,arrival_at:w.server_now,
 }];
 ensureRankings(w,NOW);
 const {battle,formations}=newBattle(102,OWNER,w.armies[0],{infantry:2,archers:0,cavalry:2},'plains','normal',city.name,'pvp',null);
 battle.defender_owner_id=host;battle.raid_city_id=city.id;
 battle.city_defenders=[{owner_id:host,city_garrison_id:city.id,troops:hostTroops},{guild_reinforcement_id:77,troops:guildTroops}];
 w.battles.push(battle);w.formations.push(...formations);
 captureBattleRanking(w,battle.id);
 assert.deepEqual(w.rankings!.pending,[{battle_id:battle.id,defenders:[{player_id:ally,weight:4},{player_id:host,weight:2}]}]);

 // Exercise the same metadata validator used by campaign import, with a JSON round trip.
 const restored:ReturnType<typeof createSolo>=JSON.parse(JSON.stringify(w));
 validateRankings(restored);
 restored.city_garrisons=[];restored.guild_reinforcements=[];
 restored.settlements.find(c=>c.id===city.id)!.owner_id=OWNER;
 ensureRankings(restored,NOW);captureBattleRanking(restored,battle.id);
 const resumed=restored.battles.find(b=>b.id===battle.id)!,force=restored.formations.filter(f=>f.battle_id===battle.id);
 force.find(f=>f.side==='attacker'&&f.unit_type==='infantry')!.soldiers-=8;
 finishBattle(resumed,force,'defender','Attack repelled');
 finalizeRankedBattle(restored,battle.id,NOW);
 const defense=()=>rankingsResponse(restored,OWNER,'current',NOW).boards.find(board=>board.category==='defense')!;
 assert.deepEqual(defense().entries.map(row=>[row.player_id,row.score]),[[ally,5],[host,3]]);
 assert.equal(defense().entries.reduce((total,row)=>total+row.score,0),8);
 assert.equal(defense().self!.score,0);
 assert.equal(restored.rankings!.pending.length,0);
 assert.deepEqual(restored.rankings!.receipts,[battle.id]);
 restored.reports=[];finalizeRankedBattle(restored,battle.id,NOW);
 assert.deepEqual(defense().entries.map(row=>[row.player_id,row.score]),[[ally,5],[host,3]]);
 assert.deepEqual(restored.rankings!.receipts,[battle.id]);
});
test('living population counts fractional net changes, founded cities, transfers and ruins',()=>{
 const w=createSolo('Ruler');ensureRankings(w,NOW);assert.equal(score(w,'growth'),0);
 w.settlements[0].population!+=.6;syncRankingsPopulation(w,NOW);w.settlements[0].population!+=.6;syncRankingsPopulation(w,NOW);assert.equal(score(w,'growth'),1);
 w.settlements.push({...w.settlements[0],id:2,population:30});syncRankingsPopulation(w,NOW);assert.equal(score(w,'growth'),31);
 w.settlements[1].owner_id='rival';syncRankingsPopulation(w,NOW);assert.equal(score(w,'growth'),1);
 w.settlements[0].ruined_at=new Date(NOW).toISOString();syncRankingsPopulation(w,NOW);assert.equal(score(w,'growth'),-30);assert.equal(rankingsResponse(w,OWNER,'current',NOW).boards.find(b=>b.category==='growth')!.self!.rank,null);
});
test('rollover retains previous week and uses real processing time independent of world clock',()=>{
 const f=fixture();finish(f);f.w.game_clock={rate:100,server_now:'2050-01-01T00:00:00Z'} as never;
 finalizeRankedBattle(f.w,f.b.id,NOW);assert.equal(score(f.w,'robbers',NOW+1000,'previous'),36);assert.equal(score(f.w,'robbers',NOW+1000),0);
 assert.equal(rankingsResponse(f.w,OWNER,'current',NOW+1000).week_end,'2026-11-02T00:00:00.000Z');
 assert.equal(score(f.w,'robbers',NOW+15*86400000,'previous'),0);
});
test('positive ties share ranks, Top 10 is bounded and a negative/zero self remains visible',()=>{
 const w=createSolo('Ruler');ensureRankings(w,NOW);const totals=w.rankings!.weeks[0].totals;
 for(let i=0;i<12;i++)totals.push({player_id:'p'+String(i).padStart(2,'0'),attack:i<2?20:12-i,defense:0,robbers:0,camps:0,growth:0});
 totals.push({player_id:OWNER,attack:1,defense:0,robbers:0,camps:0,growth:-2.9});
 const boards=rankingsResponse(w,OWNER,'current',NOW).boards;
 assert.equal(boards[0].entries.length,10);assert.equal(boards[0].entries[0].rank,1);assert.equal(boards[0].entries[1].rank,1);assert.equal(boards[0].entries[2].rank,3);assert.equal(boards[0].self!.rank,12);
 assert.equal(boards[4].self!.score,-2);assert.equal(boards[4].self!.rank,null);assert.equal(boards[4].entries.length,0);
});
test('legacy activation baselines completed battles and existing population; save metadata is strict',()=>{
 const f=fixture();finish(f);delete f.w.rankings;ensureRankings(f.w,NOW);finalizeRankedBattle(f.w,f.b.id,NOW);assert.equal(score(f.w,'camps'),0);assert.equal(score(f.w,'growth'),0);
 const w=createSolo('Ruler');ensureRankings(w,NOW);w.settlements[0].population!+=2;syncRankingsPopulation(w,NOW);
 const saved=validateSave(JSON.parse(JSON.stringify(w)));assert.equal(score(saved,'growth'),2);
 for(const mutate of [(s:typeof saved)=>{s.rankings!.weeks[0].totals[0].growth=Infinity;},(s:typeof saved)=>{s.rankings!.receipts=[101,101];},(s:typeof saved)=>{s.rankings!.pending=[{battle_id:9,defenders:[{player_id:OWNER,weight:NaN}]}];}]){const bad=structuredClone(saved);mutate(bad);assert.throws(()=>validateSave(bad));}
});

test('actual campaign settlement records population growth without awarding UI projections',t=>{
 t.mock.method(Date,'now',()=>NOW);
 const w=createSolo('Ruler'),start=Date.parse(w.server_now);ensureRankings(w,NOW);
 settleLocal(w,OWNER,start+60000);
 assert.equal(score(w,'growth'),1);
 assert.equal(w.rankings!.population[0].total,w.settlements[0].population);
 rankingsResponse(w,OWNER,'current',NOW);rankingsResponse(w,OWNER,'current',NOW);
 assert.equal(score(w,'growth'),1);
});

test('LocalEngine finalizes real campaign loot once and preserves receipts across save/resume',async t=>{
 t.mock.method(Date,'now',()=>NOW);
 const savedWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),savedStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 let serialized='';
 Object.defineProperty(globalThis,'window',{configurable:true,value:{setInterval:()=>1,clearInterval:()=>{}}});
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{setItem:(_key:string,value:string)=>{serialized=value;}}});
 let engine:LocalEngine|undefined,resumed:LocalEngine|undefined;
 try{
  const w=createSolo('Ruler');engine=new LocalEngine(w,true);
  let id=9000;beginRaid(w,OWNER,w.camps[0].id,()=>++id,w.armies[0].id);
  const battle=w.battles.find(b=>b.status==='active')!,formations=w.formations.filter(f=>f.battle_id===battle.id);
  for(const f of formations)if(f.side==='defender')f.soldiers=0;
  finishBattle(battle,formations,'attacker','Enemy defeated');
  (engine as unknown as {finalize:(id:number)=>void}).finalize(battle.id);
  const awarded=(await engine.rankings('current')).boards.find(b=>b.category==='robbers')!.self!.score;
  assert.ok(awarded>0);assert.equal(awarded,Object.values(battle.result!.loot).reduce((a,b)=>a+b,0));
  const campPoints=(await engine.rankings('current')).boards.find(b=>b.category==='camps')!.self!.score;assert.ok(campPoints>0);
  w.reports=[];
  (engine as unknown as {finalize:(id:number)=>void}).finalize(battle.id);
  assert.equal((await engine.rankings('current')).boards.find(b=>b.category==='robbers')!.self!.score,awarded);
  engine.destroy();engine=undefined;
  const restored=validateSave(JSON.parse(serialized));resumed=new LocalEngine(restored,true);
  (resumed as unknown as {finalize:(id:number)=>void}).finalize(battle.id);
  assert.equal((await resumed.rankings('current')).boards.find(b=>b.category==='robbers')!.self!.score,awarded);
  assert.equal((await resumed.rankings('current')).boards.find(b=>b.category==='camps')!.self!.score,campPoints);
 }finally{
  engine?.destroy();resumed?.destroy();
  if(savedWindow)Object.defineProperty(globalThis,'window',savedWindow);else Reflect.deleteProperty(globalThis,'window');
  if(savedStorage)Object.defineProperty(globalThis,'localStorage',savedStorage);else Reflect.deleteProperty(globalThis,'localStorage');
 }
});
