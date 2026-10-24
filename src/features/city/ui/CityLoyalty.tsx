import type {Settlement} from '../domain/types';
import {loyaltyAt} from '../domain/conquest';
import {Icon} from '../../../shared/ui/Icons';
export function CityLoyalty({city,owner,now}:{city:Settlement;owner:string;now:number}){
 if(city.owner_id!==owner||city.ruined_at)return null;
 const loyalty=loyaltyAt(city,now);
 return <div className="city-loyalty" role="region" aria-label="City loyalty" title="Enemy diplomats can lower loyalty after winning a city battle. Loyalty recovers by 25 points per game hour, up to 100."><Icon name="crown" size={16}/><span>Loyalty <strong>{loyalty.toLocaleString(undefined,{maximumFractionDigits:1})} / 100</strong><small>+25 / game hour{loyalty>=100?' · Full loyalty':''}</small></span></div>;
}
