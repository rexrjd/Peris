import type {World} from '../../../shared/model/world';
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
export function applyResearchFormations(w:World,owner:string,formations:Formation[]){const b=researchBonuses(w,owner);for(const f of formations){if(f.owner_id!==owner)continue;f.unit_attack=(f.unit_attack??1)*(1+(b.attack??0)+(b[f.unit_type+'_attack']??0));f.unit_defence=(f.unit_defence??1)*(1+(b.defence??0)+(b[f.unit_type+'_defence']??0));}}
export function researchUnitStatLimit(unit:RecruitUnit,key:'attack'|'defence'){
 const rule=RECRUIT_RULES[unit];const sum=(faction:string|null)=>TECHNOLOGIES.filter(t=>t.faction===faction).reduce((n,t)=>n+(t.effects[key]??0)+(t.effects[rule.combatClass+'_'+key]??0),0);
 return rule[key]*(1+Math.min(3,sum(null))+Math.max(...['roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'].map(sum)));
}
