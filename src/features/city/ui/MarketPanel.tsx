import {useEffect,useId,useMemo,useRef,useState} from 'react';
import type {World} from '../../../shared/model/world';
import type {Command} from '../../../shared/model/commands';
import {RESOURCES,emptyResources,type Resources} from '../../../shared/model/resources';
import {marketCapacity,resourceTotal,validCargo,CARAVAN_SPEED,type TradeTarget} from '../domain/trade';
import type {TradeRoute} from '../domain/tradeRoutes';
import {liveResources} from '../domain/economy';
import {findMarchPath} from '../../map/domain/pathfinding';
import {homeArmyPosition} from '../../map/domain/garrisons';
import {clock} from '../../../shared/time/clock';
import {realTimeForGameDate} from '../../../shared/time/gameClock';
import {Icon} from '../../../shared/ui/Icons';

const names={wood:'Wood',stone:'Stone',food:'Food',gold:'Gold'} as const;
const cargoLabel=(bag:Resources)=>RESOURCES.filter(k=>bag[k]>0).map(k=>`${bag[k].toLocaleString()} ${k}`).join(' · ');
type Mode='send'|'automatic'|'routes';
type SaveRoute=Extract<Command,{type:'saveTradeRoute'}>;
type Review={target:TradeTarget;resources:Resources;route:[number,number][];seconds:number;schedule?:SaveRoute};
export function MarketPanel({world,owner,sid,now,busy,onSend,recipientId,initialMode='send'}:{
 world:World;owner:string;sid:number;now:number;busy:boolean;onSend?:(command:Command)=>Promise<void>;recipientId?:string;initialMode?:Mode;
}){
 const source=world.settlements.find(s=>s.id===sid&&s.owner_id===owner)!;
 const online=owner!=='solo-ruler',inputId=useId();
 const [guildTargets,setGuildTargets]=useState<TradeTarget[]>([]),[loading,setLoading]=useState(online),[loadError,setLoadError]=useState(''),[revision,setRevision]=useState(0);
 const [mode,setMode]=useState<Mode>(initialMode),[editing,setEditing]=useState<number>(),[deleting,setDeleting]=useState<number>();
 const [interval,setInterval]=useState(60),[deliveries,setDeliveries]=useState(1),[delay,setDelay]=useState(0),[timing,setTiming]=useState<'departure'|'arrival'>('departure');
 const [targetId,setTargetId]=useState(''),[amounts,setAmounts]=useState<Resources>(emptyResources),[error,setError]=useState(''),[notice,setNotice]=useState(''),[sending,setSending]=useState(false);
 const [review,setReview]=useState<Review|null>(null),locked=useRef(false);
 const attempted=useRef<{review:Review;knownIds:Set<number>;oldVersion?:string}|null>(null);
 const accepted=()=>{attempted.current=null;setReview(null);setAmounts(emptyResources());setError('');if(mode==='automatic'){setMode('routes');setEditing(undefined);setNotice('Automatic route saved.');}else setNotice('Caravan dispatched. Track delivery and merchant return below.');};
 useEffect(()=>{
  const attempt=attempted.current;if(!attempt)return;const r=attempt.review;
  const found=r.schedule?(world.trade_routes??[]).some(t=>t.owner_id===owner&&t.source_settlement_id===sid&&t.target_settlement_id===r.target.id&&RESOURCES.every(k=>t.resources[k]===r.resources[k])&&t.interval_seconds===r.schedule!.intervalSeconds&&t.deliveries===r.schedule!.deliveries&&(r.schedule!.id===undefined?!attempt.knownIds.has(t.id):t.id===r.schedule!.id&&t.updated_at!==attempt.oldVersion)):
   world.trade_caravans?.some(c=>!attempt.knownIds.has(c.id)&&c.owner_id===owner&&c.source_settlement_id===sid&&c.target_settlement_id===r.target.id&&RESOURCES.every(k=>c.resources[k]===r.resources[k]));
  if(found)accepted();
 },[world.trade_caravans,world.trade_routes,owner,sid]);
 useEffect(()=>{
  if(!online)return;const controller=new AbortController();setLoading(true);setLoadError('');
  void import('../../social/platform/client').then(({socialRpc})=>socialRpc<TradeTarget[]>('peris_trade_targets',{},controller.signal)).then(t=>{if(!controller.signal.aborted)setGuildTargets(t.filter(c=>c.owner_id!==owner&&(!recipientId||c.owner_id===recipientId)));}).catch(e=>{if(!controller.signal.aborted)setLoadError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[owner,online,revision,recipientId]);
 const ownTargets=recipientId?[]:world.settlements.filter(s=>s.owner_id===owner&&s.id!==sid&&!s.ruined_at).map(s=>({id:s.id,name:s.name,owner_id:owner,owner_name:'You',x:s.x,y:s.y}));
 const targets=[...ownTargets,...guildTargets],target=targetId?targets.find(t=>t.id===Number(targetId)):targets[0];
 const capacity=marketCapacity(world,sid),available=liveResources(source,now),total=resourceTotal(amounts),rate=world.game_clock?.rate??1;
 const route=useMemo(()=>target?findMarchPath(homeArmyPosition(source),homeArmyPosition(target)):null,[source.x,source.y,target?.id,target?.x,target?.y]);
 const automatic=mode==='automatic',limit=automatic?capacity.total:capacity.available;
 const invalid=!validCargo(amounts)||total<1||total>limit||!automatic&&RESOURCES.some(k=>amounts[k]>available[k]);
 const seconds=route?Math.max(2,route.distance/CARAVAN_SPEED):0;
 const scheduleInvalid=!Number.isSafeInteger(interval*60)||interval<5||interval>1440||!Number.isFinite(delay)||delay<0||delay>10080||timing==='arrival'&&delay*60<seconds;
 const disabled=busy||sending,canReview=!disabled&&!!onSend&&!!target&&!!route&&capacity.total>0&&!invalid&&(!automatic||!scheduleInvalid);
 const max=(key:keyof Resources)=>Math.max(0,Math.min(automatic?capacity.total:available[key],limit-RESOURCES.filter(k=>k!==key).reduce((n,k)=>n+(Number.isFinite(amounts[k])?amounts[k]:0),0)));
 const change=(key:keyof Resources,value:number)=>{setAmounts(a=>({...a,[key]:value}));setError('');setNotice('');};
 const confirm=async()=>{
  if(locked.current||disabled||!review||!onSend)return;locked.current=true;setSending(true);setError('');
  attempted.current={review,knownIds:new Set((review.schedule?world.trade_routes??[]:world.trade_caravans??[]).map(c=>c.id)),oldVersion:world.trade_routes?.find(r=>r.id===editing)?.updated_at};
  try{await onSend(review.schedule??{type:'sendResources',settlementId:sid,targetCityId:review.target.id,resources:{...review.resources},route:review.route});accepted();}
  catch(e){setError(e instanceof Error?e.message:'Could not confirm this order.');}
  finally{locked.current=false;setSending(false);}
 };
 const manage=async(command:Command)=>{if(locked.current||disabled||!onSend)return;locked.current=true;setSending(true);setError('');try{await onSend(command);setDeleting(undefined);}catch(e){setError(e instanceof Error?e.message:'Could not update this route.');}finally{locked.current=false;setSending(false);}};
 const edit=(r:TradeRoute)=>{setEditing(r.id);setTargetId(String(r.target_settlement_id));setAmounts({...r.resources});setInterval(r.interval_seconds/60);setDeliveries(r.deliveries);setDelay(Math.max(0,Math.ceil((Date.parse(r.next_run_at)-now)/60000)));setTiming('departure');setMode('automatic');setReview(null);setNotice('');setError('');};
 const switchMode=(next:Mode)=>{setMode(next);setReview(null);setEditing(undefined);setError('');setNotice('');};
 const routes=(world.trade_routes??[]).filter(r=>r.owner_id===owner&&r.source_settlement_id===sid&&(!recipientId||r.recipient_id===recipientId));
 const date=(at:string|number)=>new Date(realTimeForGameDate(world,at)).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
 const caravans=(world.trade_caravans??[]).filter(c=>c.owner_id===owner&&(c.source_settlement_id===sid||c.return_settlement_id===sid)||c.recipient_id===owner&&c.target_settlement_id===sid).sort((a,b)=>Date.parse(b.departure_at)-Date.parse(a.departure_at)).slice(0,12);
 return <section className="market-panel" aria-label="Market trade">
  <div className="market-capacity"><Icon name="transfer" size={24}/><div><strong>{capacity.available.toLocaleString()} available</strong><span>{capacity.used.toLocaleString()} occupied</span></div><small>{capacity.total.toLocaleString()} total capacity</small></div>
  <p className="market-explainer">One resource uses one carrying space. Merchants hold that space until they return. Any goods that do not fit at delivery return with them.</p>
  <nav className="market-modes" aria-label="Market actions">{([['send','Send caravan'],['automatic','Automatic route'],['routes',`Routes (${routes.length})`]] as const).map(([value,label])=><button key={value} type="button" aria-pressed={mode===value} disabled={disabled} onClick={()=>switchMode(value)}>{label}</button>)}</nav>
  {mode==='routes'?<div className="market-route-list"><h3>Automatic routes</h3><p className="market-note">Scheduled deliveries use the same merchants as manual caravans. Pausing or deleting a route leaves existing caravans travelling.</p>{!routes.length?<p className="market-note">No automatic routes from this Market yet.</p>:routes.map(r=><article key={r.id} aria-label={`Automatic route to ${r.target_city}`}>
   <div className="market-route-heading"><strong>{r.target_city}</strong><span>{r.enabled?'Active':'Paused'}</span></div><p>{cargoLabel(r.resources)}</p><p>Every {r.interval_seconds/60} game minutes{rate!==1?` (${clock(r.interval_seconds,rate)} real)`:null} · {r.deliveries} {r.deliveries===1?'delivery':'deliveries'} per run</p>
   {r.enabled&&<p>Next departure <time dateTime={new Date(realTimeForGameDate(world,r.next_run_at)).toISOString()}>{date(r.next_run_at)}</time></p>}
   <p className="market-route-status">{r.last_status}</p><small>{r.sent} sent · {r.skipped} skipped{r.deliveries_left?` · ${r.deliveries_left} left in this run`:''}</small>
   <div className="market-actions"><button disabled={disabled} onClick={()=>edit(r)}>Edit</button><button disabled={disabled} onClick={()=>void manage({type:'setTradeRouteEnabled',id:r.id,enabled:!r.enabled})}>{r.enabled?'Pause':'Resume'}</button>{deleting===r.id?<><button disabled={disabled} onClick={()=>setDeleting(undefined)}>Keep route</button><button disabled={disabled} onClick={()=>void manage({type:'deleteTradeRoute',id:r.id})}>Confirm delete</button></>:<button disabled={disabled} onClick={()=>setDeleting(r.id)}>Delete</button>}</div>
  </article>)}</div>:!capacity.total?<p className="market-note">Finish Market construction to send resources.</p>:review?<div className="market-review">
   <h3>{review.schedule?'Review automatic route':'Review shipment'}</h3><p><strong>{source.name}</strong><span aria-hidden="true"> → </span><strong>{review.target.name}</strong><small>{review.target.owner_name}</small></p>
   <dl>{RESOURCES.filter(k=>review.resources[k]>0).map(k=><div key={k}><dt>{names[k]}</dt><dd>{review.resources[k].toLocaleString()}</dd></div>)}</dl>
   <strong>{resourceTotal(review.resources).toLocaleString()} resource units</strong>
   {review.schedule?<><p>First departure {date(review.schedule.firstRunAt)}<br/>First arrival {date(Date.parse(review.schedule.firstRunAt)+review.seconds*1000)}</p><p>Every {review.schedule.intervalSeconds/60} game minutes{rate!==1?` (${clock(review.schedule.intervalSeconds,rate)} real)`:null} · {review.schedule.deliveries} {review.schedule.deliveries===1?'delivery':'deliveries'} per run</p><p className="market-note">Each extra delivery waits for the merchants to return. Shortages skip the rest of that run; missed runs do not build up.</p></>:<p>Delivery in {clock(review.seconds,rate)} · Merchants return in {clock(review.seconds*2,rate)}</p>}
   <div className="market-actions"><button type="button" disabled={disabled} onClick={()=>{setReview(null);setError('');}}>Edit cargo</button><button type="button" className="building-inspector-primary" disabled={disabled||!onSend} onClick={()=>void confirm()}>{sending?'Confirming…':review.schedule?'Save automatic route':'Confirm shipment'}</button></div>
  </div>:<form onSubmit={e=>{e.preventDefault();if(canReview&&target&&route){setError('');setNotice('');setReview({target:{...target},resources:{...amounts},route:route.path,seconds,...(automatic?{schedule:{type:'saveTradeRoute',id:editing,settlementId:sid,targetCityId:target.id,resources:{...amounts},route:route.path,intervalSeconds:interval*60,deliveries,firstRunAt:new Date(now+delay*60000-(timing==='arrival'?seconds*1000:0)).toISOString()}}:{})});}}}>
   {editing!==undefined&&<h3>Edit automatic route</h3>}
   <label className="market-destination">Destination city<select aria-label="Trade destination city" value={target?.id??''} disabled={disabled||!targets.length} onChange={e=>{setTargetId(e.target.value);setError('');}}>
    {!target&&<option value="">{targetId?'Choose an eligible city':'No other eligible cities'}</option>}
    {!!ownTargets.length&&<optgroup label="My cities">{ownTargets.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
    {!!guildTargets.length&&<optgroup label="Guild cities">{guildTargets.map(t=><option key={t.id} value={t.id}>{t.owner_name} · {t.name}</option>)}</optgroup>}
   </select></label>
   {loading&&<p className="market-note">Finding guild cities…</p>}
   {loadError&&<p className="market-error" role="alert">Could not load guild cities. <button type="button" onClick={()=>setRevision(n=>n+1)}>Try again</button></p>}
   {!loading&&!loadError&&recipientId&&!guildTargets.length&&<p className="market-note">This member has no eligible cities. They may have left the guild.</p>}
   {!online&&<p className="market-note">Guild deliveries are available in the shared world.</p>}
   <div className="market-resources">{RESOURCES.map(k=><div key={k}><label htmlFor={`${inputId}-${k}`}><Icon name={k==='wood'?'wood':k} size={18}/><span>{names[k]}<small>{available[k].toLocaleString()} available</small></span></label><input id={`${inputId}-${k}`} aria-label={`${names[k]} to send`} type="number" inputMode="numeric" min={0} step={1} max={max(k)} value={Number.isNaN(amounts[k])?'':amounts[k]} disabled={disabled} onChange={e=>change(k,e.target.value===''?0:Number(e.target.value))}/><button type="button" disabled={disabled} aria-label={`Maximum ${k}`} onClick={()=>change(k,max(k))}>Max</button></div>)}</div>
   <div className="market-load"><strong>{Number.isFinite(total)?total.toLocaleString():'—'} / {limit.toLocaleString()}</strong><span>resources per {automatic?'delivery':'caravan'}</span></div>
   {total>0&&invalid&&<p className="market-error">{automatic?'Use whole resources within total Market capacity.':'Use available whole resources within your free carrying capacity.'}</p>}
   {automatic&&<fieldset className="market-schedule"><legend>Repeating deliveries</legend><label>First delivery timing<select aria-label="First delivery timing" value={timing} disabled={disabled} onChange={e=>{const value=e.target.value as 'departure'|'arrival';setTiming(value);if(value==='arrival')setDelay(d=>Math.max(d,Math.ceil(seconds/60)));}}><option value="departure">Depart after delay</option><option value="arrival">Arrive after delay</option></select></label><label>First delivery delay (game minutes)<input aria-label="First delivery delay (game minutes)" type="number" min={0} max={10080} step={1} value={delay} disabled={disabled} onChange={e=>setDelay(Number(e.target.value))}/></label><label>Repeat every (game minutes)<input aria-label="Repeat every (game minutes)" type="number" min={5} max={1440} step={1} value={interval} disabled={disabled} onChange={e=>setInterval(Number(e.target.value))}/></label><label>Deliveries per run<select aria-label="Deliveries per run" value={deliveries} disabled={disabled} onChange={e=>setDeliveries(Number(e.target.value))}>{[1,2,3].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
    <p className="market-note">0 delay departs now. Each extra delivery waits for the merchants to return. Resources are checked at departure; shortages skip that run. Up to 20 routes per city.{rate!==1?` This world runs at ${rate}× game speed.`:''}</p>
    {scheduleInvalid&&<p className="market-error">Choose a repeat interval of 5–1,440 game minutes and a first delivery within seven game days. Arrival must allow enough travel time.</p>}
   </fieldset>}
   {target&&!route&&<p className="market-error">No connected land route to this city.</p>}
   {route&&<p className="market-eta"><Icon name="time" size={14}/>Delivery {clock(seconds,rate)} · Return {clock(seconds*2,rate)}</p>}
   <button type="submit" className="building-inspector-primary" disabled={!canReview}>{automatic?'Review automatic route':'Review shipment'}<Icon name="arrow" size={15}/></button>
  </form>}
  {error&&<p className="market-error" role="alert">{error}</p>}{notice&&<p className="market-success" role="status">{notice}</p>}
  <div className="market-caravans"><h3>Caravans</h3>{!caravans.length?<p className="market-note">Your deliveries and returning merchants will appear here.</p>:<ol>{caravans.map(c=>{
   const sent=c.owner_id===owner,phase=c.status==='outbound'?(sent?'Resources outbound':'Resources incoming'):c.status==='returning'?'Merchants returning':c.status==='waiting'?'Waiting to unload':c.status==='stranded'?'Caravan stranded':'Completed';
   return <li key={c.id}><strong>{phase}</strong><span>{c.source_city} → {c.target_city}</span><small>{cargoLabel(c.resources)}</small>{['outbound','returning'].includes(c.status)&&<time>{clock(Math.max(0,(Date.parse(c.status==='outbound'?c.arrival_at:c.return_at)-now)/1000),rate)}</time>}{sent&&c.status==='waiting'&&<small>Free space in your home stores to unload {cargoLabel(c.returning_resources??emptyResources())}.</small>}{sent&&c.status==='stranded'&&<small>No reachable home city. Your remaining cargo is preserved.</small>}</li>;
  })}</ol>}</div>
 </section>;
}
