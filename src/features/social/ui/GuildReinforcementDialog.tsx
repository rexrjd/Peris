import {useEffect,useMemo,useRef,useState} from 'react';
import type {World} from '../../../shared/model/world';
import type {Command} from '../../../shared/model/commands';
import {Icon} from '../../../shared/ui/Icons';
import {clock} from '../../../shared/time/clock';
import {socialRpc} from '../platform/client';
import {guildReinforcementSources,type GuildReinforcementTarget} from '../domain/reinforcements';
import type {SocialPlayer} from '../domain/social';
import {findMarchPath} from '../../map/domain/pathfinding';
import {homeArmyPosition} from '../../map/domain/garrisons';
import {reinforcementSpeed} from '../../city/domain/cityReinforcements';
import {emptyRoster,RECRUIT_UNITS,rosterTotal,type RecruitUnit} from '../../army/domain/roster';
import {TroopIcon} from '../../frontier/ui/TroopIcon';
import {factionTroopName} from '../../frontier/ui/roster';
import '../styles/reinforcements.css';

export function GuildReinforcementDialog({world,owner,member,busy,pending,onSend,onRetry,onClose}:{
 world:World;owner:string;member:SocialPlayer;busy:boolean;pending:boolean;
 onSend:(command:Command)=>Promise<void>;onRetry:()=>Promise<void>;onClose:()=>void;
}){
 const dialog=useRef<HTMLDialogElement>(null),locked=useRef(false);
 const [targets,setTargets]=useState<GuildReinforcementTarget[]>([]),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[loadRevision,setLoadRevision]=useState(0);
 const [sourceKey,setSourceKey]=useState(()=>guildReinforcementSources(world,owner)[0]?.key??''),[targetId,setTargetId]=useState<number|null>(null),[amounts,setAmounts]=useState<Partial<Record<RecruitUnit,number>>>({}),[sending,setSending]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const el=dialog.current;if(el&&!el.open)el.showModal();return()=>{if(el?.open)el.close();};},[]);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setLoadError('');
  void socialRpc<GuildReinforcementTarget[]>('peris_guild_reinforcement_targets',{},controller.signal).then(data=>{if(!controller.signal.aborted)setTargets(data.filter(c=>c.owner_id===member.id));}).catch(e=>{if(!controller.signal.aborted)setLoadError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[member.id,owner,loadRevision]);
 const sources=guildReinforcementSources(world,owner);
 // Never silently substitute a different troop store when stock disappears.
 const source=sources.find(s=>s.key===sourceKey);
 const target=targetId?targets.find(t=>t.id===targetId):targets[0];
 const available=source?.troops??emptyRoster(),selected={...emptyRoster(),...amounts},count=rosterTotal(selected);
 const invalid=RECRUIT_UNITS.some(u=>!Number.isSafeInteger(selected[u])||selected[u]<0||selected[u]>(available[u]??0))||count>1000;
 const battle=world.battles.some(b=>b.status==='active'&&(b.attacker_owner_id===owner||b.defender_owner_id===owner));
 const route=useMemo(()=>source&&target?findMarchPath(source.origin,homeArmyPosition(target)):null,[source?.origin.x,source?.origin.y,target?.x,target?.y]);
 const disabled=busy||sending||pending;
 const canSend=!disabled&&!loading&&!loadError&&!battle&&!!source&&!!target&&!!route&&!invalid&&count>0;
 const setUnit=(unit:RecruitUnit,value:number)=>setAmounts(a=>({...a,[unit]:value}));
 const chooseAll=()=>{let left=1000;const next:Partial<Record<RecruitUnit,number>>={};for(const u of RECRUIT_UNITS){next[u]=Math.min(available[u]??0,left);left-=next[u]!;}setAmounts(next);};
 const send=async()=>{if(locked.current||(!pending&&!canSend))return;locked.current=true;setSending(true);setError('');
  try{if(pending)await onRetry();else if(source&&target&&route)await onSend({type:'reinforceGuild',settlementId:source.cityId,armyId:source.armyId,targetCityId:target.id,troops:selected,route:route.path});onClose();}
  catch(e){setError(e instanceof Error?e.message:'Could not send reinforcements.');}
  finally{locked.current=false;setSending(false);}
 };
 return <dialog ref={dialog} className="guild-reinforcement-dialog" role="dialog" aria-modal="true" aria-labelledby="guild-reinforcement-title"
  onCancel={e=>{e.preventDefault();if(!sending)onClose();}} onClick={e=>{if(e.target!==e.currentTarget||sending)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}>
  <header className="guild-support-heading"><span className="guild-support-emblem"><Icon name="shield-check" size={23}/></span><div><span className="guild-support-eyebrow">STAND TOGETHER</span><h2 id="guild-reinforcement-title">Send reinforcements</h2></div><button type="button" aria-label="Close reinforcement picker" disabled={sending} onClick={onClose}><Icon name="close" size={18}/></button></header>
  <form onSubmit={e=>{e.preventDefault();void send();}}>
   <div className="guild-support-body">
    <div className="guild-support-recipient"><span className="guild-support-avatar">{member.name.slice(0,1).toUpperCase()}</span><div><small>Supporting</small><strong>{member.name}</strong></div><span>Guild member</span></div>
    {loading?<p role="status" className="guild-support-note">Finding member cities…</p>:loadError?<div className="guild-support-error" role="alert">{loadError}<button type="button" onClick={()=>setLoadRevision(n=>n+1)}>Try again</button></div>:!targets.length?<p className="guild-support-note">This member has no available cities. They may have left the guild.</p>:targets.length>1?<label className="guild-support-label">Destination city<select aria-label="Reinforcement destination city" disabled={disabled} value={target?.id??''} onChange={e=>setTargetId(Number(e.target.value))}>{targets.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>:<p className="guild-support-destination"><Icon name="town" size={15}/>{target?.name}</p>}
    <label className="guild-support-label">Send from<select aria-label="Reinforcement troop source" value={source?.key??''} disabled={disabled||!sources.length} onChange={e=>{setSourceKey(e.target.value);setAmounts({});setError('');}} autoFocus>
     {!source&&<option value="">{sources.length?'Choose an available source':'No troops available'}</option>}
     {sources.map(s=><option key={s.key} value={s.key}>{s.label} · {rosterTotal(s.troops).toLocaleString()}</option>)}
    </select></label>
    {source?<><div className="guild-support-roster-heading"><span>Troops <small>{rosterTotal(available).toLocaleString()} available</small></span><button type="button" disabled={disabled||battle} onClick={chooseAll}>Select all</button><button type="button" disabled={disabled||!count} onClick={()=>setAmounts({})}>Clear</button></div>
     <div className="guild-support-units">{RECRUIT_UNITS.filter(u=>(available[u]??0)>0).map(u=>{const max=Math.min(available[u]??0,Math.max(0,1000-count+selected[u]));return <div className="guild-support-unit" key={u}><TroopIcon faction={source.faction} unit={u}/><label htmlFor={'guild-support-'+u}><strong>{factionTroopName(source.faction,u)}</strong><small>{(available[u]??0).toLocaleString()} available</small></label><input id={'guild-support-'+u} aria-label={`${u} reinforcements`} type="number" inputMode="numeric" min={0} max={max} step={1} value={amounts[u]??0} disabled={disabled||battle} onChange={e=>setUnit(u,e.target.value===''?0:Number(e.target.value))}/><button type="button" disabled={disabled||battle} onClick={()=>setUnit(u,max)}>Max</button></div>;})}</div>
    </>:<p className="guild-support-note">Station troops in a city garrison, or bring an idle army to one of your cities. Armies still training are unavailable.</p>}
    {battle&&<p className="guild-support-note">Finish your current battle before sending reinforcements.</p>}
    {invalid&&<p className="guild-support-error" role="alert">Choose available whole soldiers, up to 1,000 per march.</p>}
    {pending&&<p className="guild-support-note">An order is unconfirmed. Retry it with its original selection before sending another.</p>}
    {error&&<p className="guild-support-error" role="alert">{error}</p>}
    <div className="guild-support-eta"><Icon name="time" size={15}/>{source&&target&&!route?'No connected land route':count>0&&!invalid&&route?`Arrives in ${clock(Math.max(2,route.distance/reinforcementSpeed(selected)),world.game_clock?.rate??1)}`:'Choose troops to see arrival time'}</div>
   </div>
   <footer className="guild-support-footer"><div><strong>{count.toLocaleString()}</strong><span> / 1,000 troops</span></div><button type="button" className="guild-support-cancel" disabled={sending} onClick={onClose}>Cancel</button><button type="submit" className="guild-support-send" disabled={pending?busy||sending:!canSend}>{sending?'Sending…':pending?'Retry order':'Send reinforcements'}<Icon name="arrow" size={15}/></button></footer>
  </form>
 </dialog>;
}
