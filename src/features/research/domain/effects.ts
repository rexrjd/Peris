import type {World} from '../../../shared/model/world';
import {unitStats,unitRule,worldBalanceVersion,type UnitBalanceContext,type UnitBalanceVersion} from '../../army/domain/unitBalance';
import type {RecruitUnit} from '../../army/domain/roster';
import type {Formation} from '../../battle/domain/types';
import {RECRUIT_RULES} from '../../army/domain/roster';
import {TECHNOLOGY_BY_ID,TECHNOLOGIES} from './catalog';
export const accountFaction=(w:World,owner:string)=>w.settlements.filter(s=>s.owner_id===owner).sort((a,b)=>a.id-b.id)[0]?.faction??'roman';
export function researchBonuses(w:World,owner:string){
 const bonus:Record<string,number>={},faction=accountFaction(w,owner);
 for(const row of w.research_progress??[]){if(row.owner_id!==owner||!row.completed_at)continue;const t=TECHNOLOGY_BY_ID.get(row.technology_id);if(!t||t.faction&&t.faction!==faction)continue;for(const [key,value]of Object.entries(t.effects))bonus[key]=Math.min(3,(bonus[key]??0)+value);}
 return bonus;
}
export const researchFactor=(w:World,owner:string,key:string)=>1+(researchBonuses(w,owner)[key]??0);
export function unitUnlocked(w:World,owner:string,sid:number,unit:RecruitUnit,now=Date.now()){
 return !RECRUIT_RULES[unit].researchSeconds||(researchBonuses(w,owner)['unlock_'+unit]??0)>0||!!w.unit_research?.some(r=>r.settlement_id===sid&&r.unit===unit&&Date.parse(r.completes_at)<=now);
}
export const unitTechnology=(unit:RecruitUnit)=>TECHNOLOGIES.find(t=>t.effects['unlock_'+unit]);
export const trainingBoost=(w:World,owner:string)=>researchFactor(w,owner,'training');
export function applyResearchFormations(w:World,owner:string,formations:Formation[],context?:UnitBalanceContext){
 const bonus=researchBonuses(w,owner);
 for(const f of formations){
  if(f.owner_id!==owner)continue;
  const battle=w.battles.find(b=>b.id===f.battle_id);
  const captured=context??{version:battle?.balance_version??worldBalanceVersion(w),faction:(f.side==='attacker'?battle?.attacker_faction:battle?.defender_faction)??'roman'};
  const base=unitStats(f.recruit_unit??f.unit_type,captured);
  f.unit_attack=base.attackMultiplier*(1+(bonus.attack??0)+(bonus[f.unit_type+'_attack']??0));
  f.unit_defence=base.defenceMultiplier*(1+(bonus.defence??0)+(bonus[f.unit_type+'_defence']??0));
 }
}
export function researchUnitStatLimit(unit:RecruitUnit,key:'attack'|'defence',version:UnitBalanceVersion=1){
 const rule=unitRule(unit,version);const sum=(faction:string|null)=>TECHNOLOGIES.filter(t=>t.faction===faction).reduce((n,t)=>n+(t.effects[key]??0)+(t.effects[rule.combatClass+'_'+key]??0),0);
 return rule[key]*(1+Math.min(3,sum(null))+Math.max(...['roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'].map(sum)));
}
