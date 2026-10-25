import type {World} from '../../../shared/model/world';
import type {Battle} from '../../battle/domain/types';
import {troopFoodPerHour, UNIT_CROP_PER_HOUR} from '../../city/domain/troopSupply';
import {RANKING_CATEGORIES, type DefenderContribution, type RankingCategory, type RankingEntry, type RankingPeriod, type RankingTotals, type RankingsResponse} from './types';

const WEEK_MS=7*86400000;
const compareIds=(a:string,b:string)=>a<b?-1:a>b?1:0;
export function utcWeekStart(now:number):string {
 const date=new Date(now);date.setUTCHours(0,0,0,0);date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
 return date.toISOString();
}
function livingPopulation(world:World){
 const totals=new Map<string,number>();
 for(const city of world.settlements)if(!city.ruined_at)totals.set(city.owner_id,(totals.get(city.owner_id)??0)+(city.population??0));
 return totals;
}
function rotate(world:World,now:number){
 const state=world.rankings!, start=utcWeekStart(now), previous=new Date(Date.parse(start)-WEEK_MS).toISOString();
 state.weeks=state.weeks.filter(week=>week.week_start===start||week.week_start===previous);
 if(!state.weeks.some(week=>week.week_start===start))state.weeks.unshift({week_start:start,totals:[]});
 state.weeks.sort((a,b)=>b.week_start.localeCompare(a.week_start));
}
/** Activation baselines old population and completed outcomes without historical awards. */
export function ensureRankings(world:World,now:number){
 if(!world.rankings){
  world.rankings={version:1,tracking_since:new Date(now).toISOString(),weeks:[],population:[...livingPopulation(world)].map(([player_id,total])=>({player_id,total})),receipts:world.battles.filter(b=>b.status==='resolved').map(b=>b.id),pending:[]};
 }
 rotate(world,now);
 for(const battle of world.battles)if(battle.status==='active')captureBattleRanking(world,battle.id);
 return world.rankings;
}
function add(world:World,playerId:string,category:RankingCategory,score:number,now:number){
 if(!score)return;
 rotate(world,now);
 const totals=world.rankings!.weeks.find(week=>week.week_start===utcWeekStart(now))!.totals;
 let row=totals.find(row=>row.player_id===playerId);
 if(!row){row={player_id:playerId,attack:0,defense:0,robbers:0,camps:0,growth:0};totals.push(row);}
 row[category]+=score;
}
/** Snapshot actual committed owners while stores still exist, before capture/recall/deletion. */
export function captureBattleRanking(world:World,id:number){
 const state=world.rankings,battle=world.battles.find(row=>row.id===id);
 if(!state||!battle||state.receipts.includes(id)||state.pending.some(row=>row.battle_id===id)||battle.mode!=='pvp')return;
 const weights=new Map<string,number>();
 const append=(owner:string|null|undefined,weight:number)=>{if(owner&&owner!==battle.attacker_owner_id&&weight>0)weights.set(owner,(weights.get(owner)??0)+weight);};
 if(battle.city_defenders?.length){
  for(const party of battle.city_defenders){
   const owner=party.owner_id??(party.army_id?world.armies.find(a=>a.id===party.army_id)?.owner_id:party.guild_reinforcement_id?world.guild_reinforcements?.find(row=>row.id===party.guild_reinforcement_id)?.owner_id:undefined)??battle.defender_owner_id;
   append(owner,troopFoodPerHour(party.troops));
  }
 }else{
  for(const formation of world.formations.filter(row=>row.battle_id===id&&row.side==='defender'))append(formation.owner_id??battle.defender_owner_id,formation.initial_soldiers*UNIT_CROP_PER_HOUR[formation.recruit_unit??formation.unit_type]);
 }
 // Empty cities can still defeat attackers; their actual defending ruler receives the kills.
 if(!weights.size&&battle.defender_owner_id)append(battle.defender_owner_id,1);
 state.pending.push({battle_id:id,defenders:[...weights].map(([player_id,weight])=>({player_id,weight})).sort((a,b)=>compareIds(a.player_id,b.player_id))});
}
/** Largest remainder allocation conserves every point, with stable owner-ID tie breaking. */
export function splitDefensePoints(points:number,contributions:DefenderContribution[]){
 const weights=new Map<string,number>();for(const row of contributions)if(row.weight>0)weights.set(row.player_id,(weights.get(row.player_id)??0)+row.weight);
 const total=[...weights.values()].reduce((a,b)=>a+b,0);if(!total)return [];
 const rows=[...weights].map(([player_id,weight])=>{const exact=points*weight/total;return {player_id,score:Math.floor(exact),remainder:exact-Math.floor(exact)};});
 let remaining=points-rows.reduce((sum,row)=>sum+row.score,0);
 rows.sort((a,b)=>b.remainder-a.remainder||compareIds(a.player_id,b.player_id));
 for(const row of rows){if(remaining<=0)break;row.score++;remaining--;}
 return rows.sort((a,b)=>compareIds(a.player_id,b.player_id)).map(({player_id,score})=>({player_id,score}));
}
function kills(world:World,battle:Battle,side:'attacker'|'defender'){
 return world.formations.filter(row=>row.battle_id===battle.id&&row.side===side).reduce((sum,row)=>sum+Math.max(0,row.initial_soldiers-row.soldiers-(row.starvation_losses??0))*UNIT_CROP_PER_HOUR[row.recruit_unit??row.unit_type],0);
}
/** Call only after authoritative loot and conquest handling have finalized the result. */
export function finalizeRankedBattle(world:World,id:number,now:number){
 const state=world.rankings,battle=world.battles.find(row=>row.id===id);
 if(!state||!battle||battle.status!=='resolved'||!battle.result||state.receipts.includes(id))return;
 captureBattleRanking(world,id);
 const pending=state.pending.find(row=>row.battle_id===id);
 state.receipts.push(id);state.pending=state.pending.filter(row=>row.battle_id!==id);
 if(battle.mode==='practice'||battle.mode==='scouting')return;
 if(battle.mode==='pve'&&battle.camp_id!==null)add(world,battle.attacker_owner_id,'camps',kills(world,battle,'defender'),now);
 if(battle.mode==='pvp'&&battle.defender_owner_id&&battle.defender_owner_id!==battle.attacker_owner_id){
  add(world,battle.attacker_owner_id,'attack',kills(world,battle,'defender'),now);
  for(const share of splitDefensePoints(kills(world,battle,'attacker'),pending?.defenders??[]))add(world,share.player_id,'defense',share.score,now);
 }
 if(!battle.result.conquest?.captured&&(battle.raid_city_id||battle.camp_id!==null))add(world,battle.attacker_owner_id,'robbers',['wood','stone','food','gold'].reduce((n,key)=>n+battle.result!.loot[key as keyof typeof battle.result.loot],0),now);
}
/** Actual mutations only: projections and ranking reads never advance growth. */
export function syncRankingsPopulation(world:World,now:number){
 const state=world.rankings;if(!state)return;
 const current=livingPopulation(world),previous=new Map(state.population.map(row=>[row.player_id,row.total]));
 for(const player of new Set([...current.keys(),...previous.keys()]))add(world,player,'growth',(current.get(player)??0)-(previous.get(player)??0),now);
 state.population=[...current].map(([player_id,total])=>({player_id,total}));
 rotate(world,now);
}
function whole(value:number){const score=Math.trunc(value);return score===0?0:score;}
export function rankingsResponse(world:World,playerId:string,period:RankingPeriod,now:number):RankingsResponse {
 if(period!=='current'&&period!=='previous')throw new Error('Choose current or previous rankings.');
 const state=ensureRankings(world,now),start=new Date(Date.parse(utcWeekStart(now))-(period==='previous'?WEEK_MS:0)).toISOString();
 const totals=state.weeks.find(week=>week.week_start===start)?.totals??[];
 const entry=(row:RankingTotals,category:RankingCategory,rank:number|null):RankingEntry=>({rank,player_id:row.player_id,display_name:world.players.find(p=>p.id===row.player_id)?.display_name??row.player_id,guild_tag:null,score:whole(row[category]),is_you:row.player_id===playerId});
 const boards=RANKING_CATEGORIES.map(category=>{
  const ranked=totals.filter(row=>whole(row[category])>0).sort((a,b)=>whole(b[category])-whole(a[category])||compareIds(a.player_id,b.player_id));
  let rank=0;const rows=ranked.map((row,index)=>{if(index===0||whole(ranked[index-1][category])!==whole(row[category]))rank=index+1;return entry(row,category,rank);});
  const own=totals.find(row=>row.player_id===playerId)??{player_id:playerId,attack:0,defense:0,robbers:0,camps:0,growth:0};
  return {category,entries:rows.slice(0,10),self:rows.find(row=>row.is_you)??entry(own,category,null),total_players:rows.length};
 });
 return {version:1,period,week_start:start,week_end:new Date(Date.parse(start)+WEEK_MS).toISOString(),server_now:new Date(now).toISOString(),tracking_since:state.tracking_since,boards};
}
