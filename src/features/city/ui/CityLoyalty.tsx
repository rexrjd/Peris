import {useId,useState} from 'react';
import type {Settlement} from '../domain/types';
import {loyaltyAt} from '../domain/conquest';
import {Icon} from '../../../shared/ui/Icons';
export function CityLoyalty({city,owner,now,compact=false,id}:{city:Settlement;owner:string;now:number;compact?:boolean;id?:string}){
 const autoId=useId(),[help,setHelp]=useState(false),helpId=`${id??autoId}-help`;
 if(city.owner_id!==owner||city.ruined_at)return null;
 const loyalty=loyaltyAt(city,now);
 return <div id={id} className={`city-loyalty${compact?' is-compact':''}`} role="region" aria-label="City loyalty" aria-describedby={compact?helpId:undefined} tabIndex={compact?0:undefined} title={compact?undefined:'Enemy diplomats can lower loyalty after winning a city battle. Loyalty recovers by 25 points per game hour, up to 100.'} onMouseEnter={()=>compact&&setHelp(true)} onMouseLeave={event=>{if(!event.currentTarget.contains(document.activeElement))setHelp(false);}} onFocus={()=>compact&&setHelp(true)} onBlur={()=>setHelp(false)} onKeyDown={event=>{if(compact&&event.key==='Escape'){event.stopPropagation();setHelp(false);}}}><Icon name="crown" size={compact?13:16}/><span>Loyalty <strong>{loyalty.toLocaleString(undefined,{maximumFractionDigits:1})} / 100</strong><small id={helpId} role={compact?'tooltip':undefined} hidden={compact&&!help}>+25 / game hour{loyalty>=100?' · Full loyalty':''}{compact&&'. Loyalty recovers up to 100. Enemy diplomats can lower it after winning a city battle.'}</small></span></div>;
}
