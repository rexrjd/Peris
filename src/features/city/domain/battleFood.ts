import type {World} from '../../../shared/model/world';
import type {Battle} from '../../battle/domain/types';
import {emptyRoster,RECRUIT_UNITS,readRoster,type UnitRoster} from '../../army/domain/roster';
import {unitRule,worldBalanceVersion} from '../../army/domain/unitBalance';
import {foodForceRows,refreshTroopUpkeep} from './troopSupply';

/** Commit irreversible battle deaths once. Ordinary combat wounds remain healable until here. */
export function settleBattleFood(w:World,b:Battle){
 if(w.troop_upkeep_version!==1||b.mode==='practice'||b.food_settled)return;
 const at=Date.parse(w.server_now),rows=foodForceRows(w,at),refunds=new Map<number,number>();
 for(const side of ['attacker','defender'] as const){
  const formations=w.formations.filter(f=>f.battle_id===b.id&&f.side===side);
  const initial=emptyRoster(),survivors=emptyRoster();
  for(const f of formations){const u=f.recruit_unit??f.unit_type;f.soldiers=Math.min(f.soldiers,f.initial_soldiers-(f.starvation_losses??0));initial[u]+=f.initial_soldiers;survivors[u]+=f.soldiers;}
  const sources=side==='attacker'?[{key:`army:${b.attacker_army_id}`,troops:initial}]:b.raid_city_id?(b.city_defenders??[]).map(p=>({key:p.army_id?`army:${p.army_id}`:p.city_garrison_id?`city:${p.city_garrison_id}`:`station:${b.defender_owner_id}:${p.col}:${p.row}`,troops:p.troops})):b.defender_army_id?[{key:`army:${b.defender_army_id}`,troops:initial}]:[];
  const bases=sources.map(p=>({key:p.key,troops:Object.fromEntries(RECRUIT_UNITS.map(u=>[u,Math.max(0,p.troops[u]-(b.starvation_sources?.[p.key]?.[u]??0))])) as UnitRoster}));
  const total=emptyRoster(),cumulative=emptyRoster();for(const p of bases)for(const u of RECRUIT_UNITS)total[u]+=p.troops[u];
  for(const p of bases){
   const source=rows.find(r=>r.key===p.key),loss=emptyRoster();
   for(const u of RECRUIT_UNITS){const lost=Math.max(0,total[u]-survivors[u]);loss[u]=total[u]?Math.floor(lost*(cumulative[u]+p.troops[u])/total[u])-Math.floor(lost*cumulative[u]/total[u]):0;cumulative[u]+=p.troops[u];}
   if(!source)continue;
   if(source.kind!=='guild'&&source.ownerId!==(side==='attacker'?b.attacker_owner_id:b.defender_owner_id))continue;
   const next=readRoster(source.roster);let crop=0;
   for(const u of RECRUIT_UNITS){const actual=Math.min(next[u],loss[u]);next[u]-=actual;crop+=actual*unitRule(u,worldBalanceVersion(w)).cost.food;}
   source.write(next);refunds.set(source.supplyingCityId,(refunds.get(source.supplyingCityId)??0)+crop);
  }
  if(b.result&&formations.some(f=>(f.starvation_losses??0)>0)){b.result[`${side}_survivors`]=RECRUIT_UNITS.reduce((n,u)=>n+survivors[u],0);b.result[`${side}_losses`]=RECRUIT_UNITS.reduce((n,u)=>n+initial[u]-survivors[u],0);}
 }
 for(const [id,crop] of refunds){const city=w.settlements.find(s=>s.id===id&&!s.ruined_at);if(city)city.food=Math.min(city.food_capacity??city.capacity,city.food+crop);}
 b.food_settled=true;refreshTroopUpkeep(w,at);
}
