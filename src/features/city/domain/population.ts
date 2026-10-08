import type {World} from '../../../shared/model/world';
import type {Settlement} from './types';
export const POPULATION_START=30,POPULATION_FLOOR=10,FOOD_PER_PERSON=.12;
export const WORKERS_PER_LEVEL={market:4,lumber:6,quarry:6,farm:5,fishery:4} as const;
export function populationPlan(w:World,sid:number){
 const level=(type:string)=>w.buildings.find(b=>b.settlement_id===sid&&b.building_type===type)?.level??0;
 const slots=w.city_slots?.filter(s=>s.settlement_id===sid)??[],sum=(type:string)=>slots.filter(s=>s.building_type===type).reduce((n,s)=>n+s.level,0);
 return {population_capacity:40+level('market')*10+sum('housing')*30,workers_required:level('market')*4+level('lumber')*6+level('quarry')*6+level('farm')*5+sum('fishery')*4,
 wood_bonus:level('lumber')*8,stone_bonus:level('quarry')*7,food_bonus:level('farm')*10+sum('fishery')*8,gold_bonus:level('market')*3};
}
export function populationRates(s:Settlement,p=s.population??POPULATION_START){
 const staffing=Math.min(1,p/Math.max(1,s.workers_required??0)),gross=18+(s.food_bonus??0)*staffing,upkeep=p*FOOD_PER_PERSON;
 return {wood_rate:14+(s.wood_bonus??0)*staffing,stone_rate:12+(s.stone_bonus??0)*staffing,food_rate:gross-upkeep,gold_rate:3+(s.gold_bonus??0)*staffing,food_gross_rate:gross,food_upkeep:upkeep};
}
const EPS=1e-9;
/** Earliest positive crossing of a resource boundary under a linear changing rate. */
function crossing(value:number,rate:number,slope:number,target:number){
 const c=value-target;if(Math.abs(slope)<EPS)return Math.abs(rate)>EPS?[(target-value)/rate].filter(t=>t>EPS):[];
 const discriminant=rate*rate-2*slope*c;if(discriminant<0)return [];
 const root=Math.sqrt(discriminant);return [(-rate-root)/slope,(-rate+root)/slope].filter(t=>Number.isFinite(t)&&t>EPS);
}
/** Integrate only at growth/food/staffing boundaries; frequent ticks and long absences agree. */
export function advancePopulationEconomy(s:Settlement,until:number){
 let remaining=Math.max(0,until-Date.parse(s.resources_updated_at))/60000;
 const cap=s.population_capacity??40,jobs=s.workers_required??0,foodCap=s.food_capacity??s.capacity;
 s.population=Math.max(POPULATION_FLOOR,Math.min(cap,s.population??POPULATION_START));
 for(let iteration=0;remaining>EPS&&iteration<64;iteration++){
  const p=s.population,r=populationRates(s,p),growth=s.food>EPS||r.food_rate>EPS?p<cap-EPS?1:0:r.food_rate< -EPS&&p>POPULATION_FLOOR+EPS?-1:0;
  const below=jobs>0&&(p<jobs-EPS||Math.abs(p-jobs)<EPS&&growth<0),factor=below?growth/jobs:0,foodSlope=(s.food_bonus??0)*factor-FOOD_PER_PERSON*growth;
  let dt=remaining;if(growth>0)dt=Math.min(dt,cap-p);if(growth<0)dt=Math.min(dt,p-POPULATION_FLOOR);
  if(growth&&((growth>0&&p<jobs-EPS)||(growth<0&&p>jobs+EPS)))dt=Math.min(dt,Math.abs(jobs-p));
  const freeze=s.food>=foodCap-EPS&&(r.food_rate>EPS||Math.abs(r.food_rate)<=EPS&&foodSlope>=0);
  if(!freeze)for(const target of [0,foodCap])for(const t of crossing(s.food,r.food_rate,foodSlope,target))dt=Math.min(dt,t);
  if(Math.abs(foodSlope)>EPS){const zero=-r.food_rate/foodSlope;if(zero>EPS)dt=Math.min(dt,zero);}
  if(dt<=EPS)break;
  for(const [key,bonus] of [['wood','wood_bonus'],['stone','stone_bonus'],['gold','gold_bonus']] as const){const rate=r[`${key}_rate`],slope=(s[bonus]??0)*factor;s[key]=Math.min(s.capacity,Math.max(0,s[key]+rate*dt+slope*dt*dt/2));}
  s.food=Math.max(0,Math.min(foodCap,freeze?foodCap:s.food+r.food_rate*dt+foodSlope*dt*dt/2));s.population=Math.max(POPULATION_FLOOR,Math.min(cap,p+growth*dt));remaining-=dt;
 }
 Object.assign(s,populationRates(s));s.resources_updated_at=new Date(Math.max(until,Date.parse(s.resources_updated_at))).toISOString();
}
export function populationGrowth(s:Settlement){
 if(s.food<=EPS&&s.food_rate< -EPS&&s.population!>POPULATION_FLOOR+EPS)return -1;
 return (s.food>EPS||s.food_rate>EPS)&&s.population!<s.population_capacity!-EPS?1:0;
}
