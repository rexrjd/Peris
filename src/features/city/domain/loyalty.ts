import type {Settlement} from './types';
export const LOYALTY_MAX=100,LOYALTY_PER_HOUR=25;
export function loyaltyAt(city:Settlement,at:number){
 const since=Date.parse(city.loyalty_updated_at??city.resources_updated_at);
 return Math.min(LOYALTY_MAX,Math.max(0,city.loyalty??LOYALTY_MAX)+Math.max(0,at-since)/3600000*LOYALTY_PER_HOUR);
}
export function advanceLoyalty(city:Settlement,at:number){
 city.loyalty=loyaltyAt(city,at);city.loyalty_updated_at=new Date(Math.max(at,Date.parse(city.loyalty_updated_at??city.resources_updated_at))).toISOString();
}
