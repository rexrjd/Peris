import {useEffect,useRef,useState} from 'react';
import type {World} from '../../../shared/model/world';
import type {Command} from '../../../shared/model/commands';
import type {SocialPlayer} from '../domain/social';
import {MarketPanel} from '../../city/ui/MarketPanel';
import {marketCapacity} from '../../city/domain/trade';
import {Icon} from '../../../shared/ui/Icons';
import '../styles/reinforcements.css';
import '../../city/styles/market.css';

export function GuildTradeDialog({world,owner,member,mode,now,busy,pending,onSend,onRetry,onClose}:{
 world:World;owner:string;member:SocialPlayer;mode:'send'|'automatic';now:number;busy:boolean;pending:boolean;
 onSend:(command:Command)=>Promise<void>;onRetry:()=>Promise<void>;onClose:()=>void;
}){
 const dialog=useRef<HTMLDialogElement>(null);
 const sources=world.settlements.filter(s=>s.owner_id===owner&&!s.ruined_at&&marketCapacity(world,s.id).total>0);
 const [sourceId,setSourceId]=useState(sources[0]?.id),[error,setError]=useState(''),[retrying,setRetrying]=useState(false);
 const source=sources.find(s=>s.id===sourceId);
 useEffect(()=>{const el=dialog.current;if(el&&!el.open)el.showModal();return()=>{if(el?.open)el.close();};},[]);
 const retry=async()=>{if(busy||retrying)return;setRetrying(true);setError('');try{await onRetry();}catch(e){setError(e instanceof Error?e.message:'Order remains unconfirmed.');}finally{setRetrying(false);}};
 return <dialog ref={dialog} className="guild-reinforcement-dialog guild-trade-dialog" role="dialog" aria-modal="true" aria-labelledby="guild-trade-title" onCancel={e=>{e.preventDefault();if(!busy&&!retrying)onClose();}}>
  <header className="guild-support-heading"><span className="guild-support-emblem"><Icon name="transfer" size={23}/></span><div><span className="guild-support-eyebrow">SUPPORT YOUR GUILD</span><h2 id="guild-trade-title">{mode==='send'?'Send caravan':'Create automatic route'}</h2></div><button type="button" aria-label="Close caravan picker" disabled={busy||retrying} onClick={onClose}><Icon name="close" size={18}/></button></header>
  <div className="guild-trade-body"><div className="guild-support-recipient"><span className="guild-support-avatar">{member.name.slice(0,1).toUpperCase()}</span><div><small>Supporting</small><strong>{member.name}</strong></div><span>Guild member</span></div>
   <label className="guild-support-label">Send from Market<select aria-label="Caravan source city" value={source?.id??''} disabled={busy||pending||retrying||!sources.length} autoFocus onChange={e=>setSourceId(Number(e.target.value))}>
    {!source&&<option value="">{sources.length?'Choose an available Market':'No completed Markets'}</option>}{sources.map(s=><option key={s.id} value={s.id}>{s.name} · {marketCapacity(world,s.id).available.toLocaleString()} free</option>)}
   </select></label>
   {pending&&<div className="guild-support-note" role="status">An order is unconfirmed. Retry its saved selection before sending another. <button type="button" className="guild-support-send" disabled={busy||retrying} onClick={()=>void retry()}>{retrying?'Retrying…':'Retry order'}</button></div>}
   {error&&<p role="alert" className="guild-support-error">{error}</p>}
   {source?<MarketPanel key={source.id} world={world} owner={owner} sid={source.id} now={now} busy={busy||pending||retrying} onSend={onSend} recipientId={member.id} initialMode={mode}/>:<p className="guild-support-note">Complete a Market in one of your cities to send resources to this member.</p>}
  </div>
 </dialog>;
}
