import {useEffect,useMemo,useRef,useState} from 'react';
import type {World} from '../../../shared/model/world';
import type {Command} from '../../../shared/model/commands';
import {RESOURCES,emptyResources,type Resources} from '../../../shared/model/resources';
import {marketCapacity,resourceTotal,validCargo,CARAVAN_SPEED,type TradeTarget} from '../domain/trade';
import {liveResources} from '../domain/economy';
import {findMarchPath} from '../../map/domain/pathfinding';
import {homeArmyPosition} from '../../map/domain/garrisons';
import {clock} from '../../../shared/time/clock';
import {Icon} from '../../../shared/ui/Icons';

const names={wood:'Wood',stone:'Stone',food:'Food',gold:'Gold'} as const;
const cargoLabel=(bag:Resources)=>RESOURCES.filter(k=>bag[k]>0).map(k=>`${bag[k].toLocaleString()} ${k}`).join(' · ');
export function MarketPanel({world,owner,sid,now,busy,onSend}:{world:World;owner:string;sid:number;now:number;busy:boolean;onSend?:(command:Command)=>Promise<void>}){
 const source=world.settlements.find(s=>s.id===sid&&s.owner_id===owner)!;
 const online=owner!=='solo-ruler';
 const [guildTargets,setGuildTargets]=useState<TradeTarget[]>([]),[loading,setLoading]=useState(online),[loadError,setLoadError]=useState(''),[revision,setRevision]=useState(0);
 const [targetId,setTargetId]=useState(''),[amounts,setAmounts]=useState<Resources>(emptyResources),[error,setError]=useState(''),[notice,setNotice]=useState(''),[sending,setSending]=useState(false);
 const [review,setReview]=useState<{target:TradeTarget;resources:Resources;route:[number,number][];seconds:number}|null>(null),locked=useRef(false);
 const attempted=useRef<{targetId:number;resources:Resources;knownIds:Set<number>}|null>(null);
 useEffect(()=>{
  const attempt=attempted.current;if(!attempt)return;
  const accepted=world.trade_caravans?.some(c=>!attempt.knownIds.has(c.id)&&c.owner_id===owner&&c.source_settlement_id===sid&&c.target_settlement_id===attempt.targetId&&RESOURCES.every(k=>c.resources[k]===attempt.resources[k]));
  if(accepted){attempted.current=null;setReview(null);setAmounts(emptyResources());setError('');setNotice('Caravan dispatched. Track delivery and merchant return below.');}
 },[world.trade_caravans,owner,sid]);
 useEffect(()=>{
  if(!online)return;const controller=new AbortController();setLoading(true);setLoadError('');
  void import('../../social/platform/client').then(({socialRpc})=>socialRpc<TradeTarget[]>('peris_trade_targets',{},controller.signal)).then(t=>{if(!controller.signal.aborted)setGuildTargets(t.filter(c=>c.owner_id!==owner));}).catch(e=>{if(!controller.signal.aborted)setLoadError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[owner,online,revision]);
 const ownTargets=world.settlements.filter(s=>s.owner_id===owner&&s.id!==sid&&!s.ruined_at).map(s=>({id:s.id,name:s.name,owner_id:owner,owner_name:'You',x:s.x,y:s.y}));
 const targets=[...ownTargets,...guildTargets],target=targetId?targets.find(t=>t.id===Number(targetId)):targets[0];
 const capacity=marketCapacity(world,sid),available=liveResources(source,now),total=resourceTotal(amounts),rate=world.game_clock?.rate??1;
 const route=useMemo(()=>target?findMarchPath(homeArmyPosition(source),homeArmyPosition(target)):null,[source.x,source.y,target?.id,target?.x,target?.y]);
 const invalid=!validCargo(amounts)||total<1||total>capacity.available||RESOURCES.some(k=>amounts[k]>available[k]);
 const disabled=busy||sending,canReview=!disabled&&!!onSend&&!!target&&!!route&&capacity.total>0&&!invalid;
 const seconds=route?Math.max(2,route.distance/CARAVAN_SPEED):0;
 const max=(key:keyof Resources)=>Math.max(0,Math.min(available[key],capacity.available-RESOURCES.filter(k=>k!==key).reduce((n,k)=>n+(Number.isFinite(amounts[k])?amounts[k]:0),0)));
 const change=(key:keyof Resources,value:number)=>{setAmounts(a=>({...a,[key]:value}));setError('');setNotice('');};
 const confirm=async()=>{
  if(locked.current||disabled||!review||!onSend)return;locked.current=true;setSending(true);setError('');
  attempted.current={targetId:review.target.id,resources:{...review.resources},knownIds:new Set((world.trade_caravans??[]).map(c=>c.id))};
  try{await onSend({type:'sendResources',settlementId:sid,targetCityId:review.target.id,resources:{...review.resources},route:review.route});attempted.current=null;setReview(null);setAmounts(emptyResources());setNotice('Caravan dispatched. Track delivery and merchant return below.');}
  catch(e){setError(e instanceof Error?e.message:'Could not send this shipment.');}
  finally{locked.current=false;setSending(false);}
 };
 const caravans=(world.trade_caravans??[]).filter(c=>c.owner_id===owner&&(c.source_settlement_id===sid||c.return_settlement_id===sid)||c.recipient_id===owner&&c.target_settlement_id===sid).sort((a,b)=>Date.parse(b.departure_at)-Date.parse(a.departure_at)).slice(0,12);
 return <section className="market-panel" aria-label="Market trade">
  <div className="market-capacity"><Icon name="transfer" size={24}/><div><strong>{capacity.available.toLocaleString()} available</strong><span>{capacity.used.toLocaleString()} occupied</span></div><small>{capacity.total.toLocaleString()} total capacity</small></div>
  <p className="market-explainer">One resource uses one carrying space. Merchants hold that space until they return. Any goods that do not fit at delivery return with them.</p>
  {!capacity.total?<p className="market-note">Finish Market construction to send resources.</p>:review?<div className="market-review">
   <h3>Review shipment</h3><p><strong>{source.name}</strong><span aria-hidden="true"> → </span><strong>{review.target.name}</strong><small>{review.target.owner_name}</small></p>
   <dl>{RESOURCES.filter(k=>review.resources[k]>0).map(k=><div key={k}><dt>{names[k]}</dt><dd>{review.resources[k].toLocaleString()}</dd></div>)}</dl>
   <strong>{resourceTotal(review.resources).toLocaleString()} resource units</strong>
   <p>Delivery in {clock(review.seconds,rate)} · Merchants return in {clock(review.seconds*2,rate)}</p>
   <div className="market-actions"><button type="button" disabled={disabled} onClick={()=>{setReview(null);setError('');}}>Edit cargo</button><button type="button" className="building-inspector-primary" disabled={disabled||!onSend} onClick={()=>void confirm()}>{sending?'Sending…':'Confirm shipment'}</button></div>
  </div>:<form onSubmit={e=>{e.preventDefault();if(canReview&&target&&route){setError('');setNotice('');setReview({target:{...target},resources:{...amounts},route:route.path,seconds});}}}>
   <label className="market-destination">Destination city<select aria-label="Trade destination city" value={target?.id??''} disabled={disabled||!targets.length} onChange={e=>{setTargetId(e.target.value);setError('');}}>
    {!targets.length&&<option value="">No other eligible cities</option>}
    {!!ownTargets.length&&<optgroup label="My cities">{ownTargets.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
    {!!guildTargets.length&&<optgroup label="Guild cities">{guildTargets.map(t=><option key={t.id} value={t.id}>{t.owner_name} · {t.name}</option>)}</optgroup>}
   </select></label>
   {loading&&<p className="market-note">Finding guild cities…</p>}
   {loadError&&<p className="market-error" role="alert">Could not load guild cities. <button type="button" onClick={()=>setRevision(n=>n+1)}>Try again</button></p>}
   {!online&&<p className="market-note">Guild deliveries are available in the shared world.</p>}
   <div className="market-resources">{RESOURCES.map(k=><div key={k}><label htmlFor={`trade-${sid}-${k}`}><Icon name={k==='wood'?'wood':k} size={18}/><span>{names[k]}<small>{available[k].toLocaleString()} available</small></span></label><input id={`trade-${sid}-${k}`} aria-label={`${names[k]} to send`} type="number" inputMode="numeric" min={0} step={1} max={max(k)} value={Number.isNaN(amounts[k])?'':amounts[k]} disabled={disabled} onChange={e=>change(k,e.target.value===''?0:Number(e.target.value))}/><button type="button" disabled={disabled} aria-label={`Maximum ${k}`} onClick={()=>change(k,max(k))}>Max</button></div>)}</div>
   <div className="market-load"><strong>{Number.isFinite(total)?total.toLocaleString():'—'} / {capacity.available.toLocaleString()}</strong><span>resources selected</span></div>
   {total>0&&invalid&&<p className="market-error">Use available whole resources within your free carrying capacity.</p>}
   {target&&!route&&<p className="market-error">No connected land route to this city.</p>}
   {route&&<p className="market-eta"><Icon name="time" size={14}/>Delivery {clock(seconds,rate)} · Return {clock(seconds*2,rate)}</p>}
   <button type="submit" className="building-inspector-primary" disabled={!canReview}>Review shipment<Icon name="arrow" size={15}/></button>
  </form>}
  {error&&<p className="market-error" role="alert">{error}</p>}{notice&&<p className="market-success" role="status">{notice}</p>}
  <div className="market-caravans"><h3>Caravans</h3>{!caravans.length?<p className="market-note">Your deliveries and returning merchants will appear here.</p>:<ol>{caravans.map(c=>{
   const sent=c.owner_id===owner,phase=c.status==='outbound'?(sent?'Resources outbound':'Resources incoming'):c.status==='returning'?'Merchants returning':c.status==='waiting'?'Waiting to unload':c.status==='stranded'?'Caravan stranded':'Completed';
   return <li key={c.id}><strong>{phase}</strong><span>{c.source_city} → {c.target_city}</span><small>{cargoLabel(c.resources)}</small>{['outbound','returning'].includes(c.status)&&<time>{clock(Math.max(0,(Date.parse(c.status==='outbound'?c.arrival_at:c.return_at)-now)/1000),rate)}</time>}{sent&&c.status==='waiting'&&<small>Free space in your home stores to unload {cargoLabel(c.returning_resources??emptyResources())}.</small>}{sent&&c.status==='stranded'&&<small>No reachable home city. Your remaining cargo is preserved.</small>}</li>;
  })}</ol>}</div>
 </section>;
}
