import {RANKING_CATEGORIES, type RankingEntry, type RankingPeriod, type RankingsResponse} from '../domain/types';

export class RankingsError extends Error {
  constructor(message:string, readonly kind:'unavailable'|'invalid'|'connection'='connection') { super(message); }
}
type Rpc = (fn:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string;message:string}|null}>;
const invalid=():never=>{throw new RankingsError('The world returned invalid standings. Please retry.','invalid');};
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:invalid();
const text=(value:unknown,max:number):string=>typeof value==='string'&&value.length>0&&value.length<=max?value:invalid();
const integer=(value:unknown,min=0):number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min?value:invalid();
const timestamp=(value:unknown):string=>{const result=text(value,40);return Number.isFinite(Date.parse(result))&&/(?:Z|\+00:00)$/.test(result)?result:invalid();};
function entry(value:unknown,growth:boolean,self=false):RankingEntry {
  const row=record(value),score=integer(row.score,growth?-Number.MAX_SAFE_INTEGER:0);
  const rank=row.rank===null?null:integer(row.rank,1);
  if(typeof row.is_you!=='boolean'||self&&!row.is_you||rank===null&&score>0||rank!==null&&score<=0)invalid();
  return {rank,player_id:text(row.player_id,128),display_name:text(row.display_name,128),guild_tag:row.guild_tag===null?null:text(row.guild_tag,32),score,is_you:row.is_you as boolean};
}
/** Rebuild the public DTO: no unknown server fields enter the view or core state. */
export function validateRankingsResponse(value:unknown,period:RankingPeriod):RankingsResponse {
  const data=record(value);
  if(data.version!==1||data.period!==period||!Array.isArray(data.boards)||data.boards.length!==5)invalid();
  const week_start=timestamp(data.week_start),week_end=timestamp(data.week_end),server_now=timestamp(data.server_now),tracking_since=timestamp(data.tracking_since);
  const start=new Date(week_start);
  if(start.getUTCDay()!==1||start.getUTCHours()||start.getUTCMinutes()||start.getUTCSeconds()||start.getUTCMilliseconds()||Date.parse(week_end)-start.getTime()!==7*86400000)invalid();
  const clock=new Date(server_now);
  clock.setUTCHours(0,0,0,0);clock.setUTCDate(clock.getUTCDate()-(clock.getUTCDay()+6)%7-(period==='previous'?7:0));
  if(start.getTime()!==clock.getTime())invalid();
  const seen=new Set<string>();
  const boards=(data.boards as unknown[]).map(raw=>{
    const board=record(raw),category=board.category as typeof RANKING_CATEGORIES[number];
    if(!RANKING_CATEGORIES.includes(category)||seen.has(category)||!Array.isArray(board.entries)||board.entries.length>10)invalid();
    seen.add(category);
    const total_players=integer(board.total_players),entries=(board.entries as unknown[]).map(row=>entry(row,category==='growth'));
    const self=board.self===null?null:entry(board.self,category==='growth',true),ids=new Set<string>();
    if(entries.length>total_players)invalid();
    for(let i=0;i<entries.length;i++){
      const row=entries[i];
      if(row.rank===null||row.rank>total_players||row.score<=0||ids.has(row.player_id)||i>0&&(row.score>entries[i-1].score||row.rank!<entries[i-1].rank!))invalid();
      if(row.rank!==(i>0&&row.score===entries[i-1].score?entries[i-1].rank:i+1))invalid();
      if(self?.player_id===row.player_id&&!row.is_you)invalid();
      if(row.is_you&&(!self||self.player_id!==row.player_id||self.score!==row.score||self.rank!==row.rank))invalid();
      ids.add(row.player_id);
    }
    if(self?.rank!==null&&self?.rank!==undefined&&self.rank>total_players)invalid();
    return {category,entries,self,total_players};
  });
  return {version:1,period,week_start,week_end,server_now,tracking_since,boards};
}
export async function readRankings(period:RankingPeriod,rpc:Rpc):Promise<RankingsResponse> {
  if(period!=='current'&&period!=='previous')invalid();
  const result=await rpc('peris_rankings',{p_period:period});
  if(result.error){
    const unavailable=['PGRST202','42883'].includes(result.error.code??'');
    throw new RankingsError(unavailable?'Weekly Rankings are not available in this world yet. Please try again after the world update.':result.error.message,unavailable?'unavailable':'connection');
  }
  return validateRankingsResponse(result.data,period);
}
