import type { SiegeDamage } from '../../city/domain/siege';
import { Icon } from '../../../shared/ui/Icons';

export function SiegeSummary({damage}:{damage:SiegeDamage[]|undefined}){
    if(!damage?.length)return null;
    return <section className="report-siege-damage" aria-label="Siege damage"><h3>City damage</h3>{damage.map((row,index)=><div key={index}><Icon name={row.weapon==='ram'?'shield':'town'} size={16}/><span>{row.name}{row.slot_index!==undefined?<small> · Plot {row.slot_index+1}</small>:row.col!==undefined&&<small> · {row.col} | {row.row}</small>}</span><b>Lv. {row.before} <span>→</span> {row.after}</b></div>)}</section>;
}
