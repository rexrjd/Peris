import { useState } from 'react';
import type { Faction } from '../../factions/domain/factions';
import type { UnitRoster } from '../../army/domain/roster';
import { RECRUIT_UNITS, rosterTotal } from '../../army/domain/roster';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { factionTroopName } from '../../frontier/ui/roster';
import { Icon } from '../../../shared/ui/Icons';

export function MarchTroopPicker({faction,available,quantities,onChange}:{
    faction:Faction;available:UnitRoster;quantities:Record<keyof UnitRoster,string>;onChange:(values:Record<keyof UnitRoster,string>)=>void;
}){
    const [showAll,setShowAll]=useState(false);
    const fill=(all:boolean)=>onChange(Object.fromEntries(RECRUIT_UNITS.map(unit=>[unit,String(all?available[unit]:0)])) as typeof quantities);
    return <fieldset className="march-troops"><legend>Troops to send</legend>
        <div className="march-troop-tools"><span>{rosterTotal(available).toLocaleString()} available</span><div>
            <button type="button" aria-label="Use all legion troops" title="Use all legion troops" onClick={()=>fill(true)}><Icon name="check-all" size={17}/></button>
            <button type="button" aria-label="Clear troops" title="Clear selection" onClick={()=>fill(false)}><Icon name="minus" size={17}/></button>
            <button type="button" aria-label="Show unavailable troop types" title="Show all troop types" aria-pressed={showAll} onClick={()=>setShowAll(!showAll)}><Icon name="people" size={17}/></button>
        </div></div>
        <div className="march-troop-grid">{RECRUIT_UNITS.filter(unit=>showAll||available[unit]>0).map(unit=>{
            const name=factionTroopName(faction,unit), amount=Number(quantities[unit]);
            return <label key={unit} data-unit={unit} title={`${name}: ${available[unit]} available · ${Math.max(0,available[unit]-(Number.isSafeInteger(amount)?amount:0))} stay behind`} className={available[unit]?'':'is-empty'}>
                <TroopIcon faction={faction} unit={unit}/><span>{name}</span>
                <input aria-label={`${name} to send`} type="number" min={0} max={available[unit]} step={1} value={quantities[unit]} onChange={event=>onChange({...quantities,[unit]:event.target.value})}/>
                <small>/{available[unit].toLocaleString()}</small>
            </label>;
        })}</div>
    </fieldset>;
}
