import type {World} from '../../../shared/model/world';
import {RANKING_CATEGORIES} from './types';

/** Save metadata is private but still untrusted imported JSON. */
export function validateRankings(world:World){
 const state=world.rankings;if(state===undefined)return;
 const invalid=()=>{throw new Error('This file contains invalid weekly rankings.');};
 const record=(value:unknown)=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const id=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=128;
 const finite=(value:unknown,min=0,max=1e12)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
 const stamp=(value:unknown)=>typeof value==='string'&&value.length<=32&&Number.isFinite(Date.parse(value));
 const battleId=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
 if(!record(state)||state.version!==1||!stamp(state.tracking_since)||!Array.isArray(state.weeks)||state.weeks.length<1||state.weeks.length>2||!Array.isArray(state.population)||state.population.length>1000||!Array.isArray(state.receipts)||state.receipts.length>15000||!Array.isArray(state.pending)||state.pending.length>15000)invalid();
 const starts=new Set<string>();
 for(const week of state.weeks){
  if(!record(week)||!stamp(week.week_start)||starts.has(week.week_start)||!Array.isArray(week.totals)||week.totals.length>1000)invalid();
  const date=new Date(week.week_start);if(date.getUTCDay()!==1||date.getUTCHours()||date.getUTCMinutes()||date.getUTCSeconds()||date.getUTCMilliseconds()||date.toISOString()!==week.week_start)invalid();
  starts.add(week.week_start);const players=new Set<string>();
  for(const row of week.totals){
   if(!record(row)||!id(row.player_id)||players.has(row.player_id))invalid();players.add(row.player_id);
   for(const category of RANKING_CATEGORIES)if(!finite(row[category],category==='growth'?-1e12:0)||category!=='growth'&&!Number.isSafeInteger(row[category]))invalid();
  }
 }
 if(starts.size===2&&Math.abs(Date.parse(state.weeks[0].week_start)-Date.parse(state.weeks[1].week_start))!==7*86400000)invalid();
 const owners=new Set<string>();for(const row of state.population){if(!record(row)||!id(row.player_id)||owners.has(row.player_id)||!finite(row.total))invalid();owners.add(row.player_id);}
 const receipts=new Set<number>();for(const value of state.receipts){if(!battleId(value)||receipts.has(value))invalid();receipts.add(value);}
 const pending=new Set<number>();
 for(const row of state.pending){
  if(!record(row)||!battleId(row.battle_id)||pending.has(row.battle_id)||receipts.has(row.battle_id)||!world.battles.some(b=>b.id===row.battle_id)||!Array.isArray(row.defenders)||row.defenders.length>1000)invalid();
  pending.add(row.battle_id);const defenders=new Set<string>();
  for(const defender of row.defenders){if(!record(defender)||!id(defender.player_id)||defenders.has(defender.player_id)||!finite(defender.weight,1)||!Number.isSafeInteger(defender.weight))invalid();defenders.add(defender.player_id);}
 }
}
