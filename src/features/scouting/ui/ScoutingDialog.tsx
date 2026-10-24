import {useMemo,useState} from 'react';
import type {World} from '../../../shared/model/world';
import type {Command} from '../../../shared/model/commands';
import type {ScoutingMode} from '../domain/types';
import {scoutMissionReason,scoutingSpeed} from '../domain/scouting';
import {readRoster} from '../../army/domain/roster';
import {armyFaction} from '../../army/domain/faction';
import {TroopIcon} from '../../frontier/ui/TroopIcon';
import {factionTroopName} from '../../frontier/ui/roster';
import {Modal} from '../../../shared/ui/Shared';
import {Icon} from '../../../shared/ui/Icons';
import {clock} from '../../../shared/time/clock';
import {armyPosition} from '../../map/domain/movement';
import {findMarchPath} from '../../map/domain/pathfinding';
import {homeArmyPosition,stationCell} from '../../map/domain/garrisons';
import {CELL_SIZE,wrappedWorldDelta} from '../../map/domain/dimensions';

export type ScoutingTarget={cityId:number;campId?:never}|{campId:number;cityId?:never};
export function ScoutingDialog({world,playerId,now,busy,initialArmyId,target,run,onClose}:{
 world:World;playerId:string;now:number;busy:boolean;initialArmyId:number;target:ScoutingTarget;
 run:(command:Command,message?:string)=>void;onClose:()=>void;
}){
 const armies=world.armies.filter(army=>army.owner_id===playerId),[armyId,setArmyId]=useState(initialArmyId),[quantity,setQuantity]=useState(()=>{const initial=armies.find(army=>army.id===initialArmyId)??armies[0];return String(Math.max(1,Math.min(1000,initial?readRoster(initial).scout:0)));}),[mode,setMode]=useState<ScoutingMode>('resources');
 const army=armies.find(army=>army.id===armyId),faction=armyFaction(world,army),available=army?readRoster(army).scout:0;
 const destination=target.cityId===undefined?world.camps.find(camp=>camp.id===target.campId):world.settlements.find(city=>city.id===target.cityId);
 const position=army?armyPosition(army,now):undefined;
 const source=position?world.settlements.find(city=>{const home=homeArmyPosition(city),at=stationCell(position),field=stationCell(city);return city.owner_id===playerId&&!city.ruined_at&&at.col===field.col&&at.row===field.row&&Math.hypot(wrappedWorldDelta(position.x,home.x),wrappedWorldDelta(position.y,home.y))<=90;}):undefined;
 const route=useMemo(()=>position&&destination?findMarchPath(position,destination):null,[armyId,position?.x,position?.y,destination?.x,destination?.y]);
 const count=Number(quantity),reason=world.scouting_version!==1?'This server does not support scouting.':!quantity.trim()?'Choose a whole number of scouts.':scoutMissionReason(world,playerId,armyId,target,count,mode,now);
 const travel=route?Math.max(2,route.distance/scoutingSpeed(world,playerId)):null;
 return <Modal title="Prepare scouting mission" heading={false} className="scouting-dialog" onClose={onClose}>
  <header className="scouting-heading"><Icon name="focus" size={23}/><div><span className="eyebrow">SCOUTING MISSION</span><h2>{destination?.name??'Unavailable target'}</h2>{destination&&<p>Field ({Math.floor(destination.x/CELL_SIZE)} | {Math.floor(destination.y/CELL_SIZE)})</p>}</div></header>
  <form onSubmit={event=>{event.preventDefault();if(reason||busy||!army)return;run({type:'scout',armyId,...(target.cityId===undefined?{campId:target.campId}:{targetCityId:target.cityId}),quantity:count,mode,route:route?.path},'Scouts preparing to depart. You can cancel for 30 seconds.');onClose();}}>
   <div className="scouting-body">
    <label className="scouting-legion">Legion<select aria-label="Scouting legion" value={armyId} onChange={event=>{const id=Number(event.target.value);setArmyId(id);setQuantity(String(Math.max(1,Math.min(1000,readRoster(armies.find(army=>army.id===id)!).scout))));}}>{armies.map(army=><option key={army.id} value={army.id}>{army.name} · {readRoster(army).scout} scouts{army.status!=='idle'?' · Moving':''}</option>)}</select></label>
    <div className="scouting-party"><TroopIcon faction={faction} unit="scout" portrait/><div><strong>{factionTroopName(faction,'scout')}</strong><small>{available.toLocaleString()} available</small><label>Scouts to send<input aria-label="Scouts to send" type="number" min="1" max={Math.min(1000,available)} step="1" inputMode="numeric" value={quantity} onChange={event=>setQuantity(event.target.value)}/></label></div></div>
    <fieldset className="scouting-modes"><legend>Intelligence to gather</legend><label><input type="radio" name="scouting-mode" value="resources" checked={mode==='resources'} onChange={()=>setMode('resources')}/><span><strong>Resources and troops</strong><small>Stored resources and all troops present.</small></span></label><label><input type="radio" name="scouting-mode" value="defences" checked={mode==='defences'} onChange={()=>setMode('defences')}/><span><strong>Defences and troops</strong><small>{target.campId===undefined?'Wall, Main building and all troops present.':'Camp troops; camps have no wall or Main building.'}</small></span></label></fieldset>
    <dl className="scouting-review"><div><dt>Source city</dt><dd>{source?.name??'Bring an idle legion to your city'}</dd></div><div><dt>One-way travel</dt><dd>{travel===null?'No route':clock(travel,world.game_clock?.rate??1)}</dd></div><div><dt>Land route</dt><dd>{route?`${(route.distance/CELL_SIZE).toFixed(2)} fields`:'Unavailable'}</dd></div></dl>
    <p className="scouting-help">Commander and other troops remain with the legion. Only scouts leave. Counter-scouts can detect and kill them. Survivors return; the source city supplies their food.</p>
    {reason&&<p className="scouting-error" role="status">{reason}</p>}
   </div>
   <footer className="scouting-footer"><small>Cancel within 30s of sending</small><div><button type="button" className="button outline" onClick={onClose}>Back</button><button type="submit" className="button gold" disabled={busy||!!reason}>{busy?'Sending…':'Confirm scouting'}<Icon name="arrow" size={15}/></button></div></footer>
  </form>
 </Modal>;
}
