import { useMemo, useRef, useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Report } from '../domain/types';
import { filterInbox, inboxReceipt, type InboxQuery, type ReportFilter } from '../domain/reportInbox';
import { visibleReports } from '../domain/reportEconomics';
import { Icon } from '../../../shared/ui/Icons';
import { ReportDetails } from './ReportDetails';
import '../styles/report-inbox.css';

const filters: {id: ReportFilter; title: string}[] = [{id:'all',title:'All'},{id:'unread',title:'Unread'},{id:'losses',title:'Losses'},{id:'equipment',title:'Equipment'}];
export function ReportInbox({world, playerId, unreadCount, onRead, onReadAll, loadReports, onLocate}: {
    world: World; playerId: string; unreadCount: number;
    onRead?: (battleId: number, reportId?: number) => Promise<boolean> | void;
    onReadAll?: () => Promise<boolean>;
    loadReports?: (beforeId: number) => Promise<Report[]>;
    onLocate?: (camp: World['camps'][number]) => void;
}) {
    const [query,setQuery]=useState<InboxQuery>({filter:'all',search:'',outcome:'all',order:'newest'});
    const [older,setOlder]=useState<Report[]>([]), [acknowledged,setAcknowledged]=useState(new Set<number>());
    const [selected,setSelected]=useState<number|null>(null), [readingAll,setReadingAll]=useState(false);
    const [loading,setLoading]=useState(false), [historyEnd,setHistoryEnd]=useState(false), [loadError,setLoadError]=useState('');
    const listRef=useRef<HTMLDivElement>(null), detailRef=useRef<HTMLElement>(null);
    const combined=useMemo(()=>{
        const records=new Map(older.map(report=>[report.id,report]));
        world.reports.forEach(report=>records.set(report.id,report));
        return {...world,reports:[...records.values()].filter(report=>report.owner_id===playerId).map(report=>(acknowledged.has(report.id)||world.unread_report_count===0)&&!report.read_at?{...report,read_at:world.server_now}:report)};
    },[world,older,acknowledged,playerId]);
    const all=visibleReports(combined,playerId), rows=filterInbox(combined,playerId,query);
    const report=all.find(row=>row.id===selected), index=rows.findIndex(row=>row.id===selected);
    const total=Math.max(all.length,world.report_count??all.length), hasOlder=!!loadReports&&!historyEnd&&all.length<total;
    const open=(receipt:Report)=>{
        setSelected(receipt.id);
        void Promise.resolve(onRead?.(receipt.battle_id,receipt.id)).then(success=>{
            if(success)setAcknowledged(current=>new Set([...current,receipt.id]));
        });
        requestAnimationFrame(()=>{detailRef.current?.focus();detailRef.current?.scrollTo(0,0);});
    };
    const back=()=>{
        const id=selected;setSelected(null);
        requestAnimationFrame(()=>listRef.current?.querySelector<HTMLButtonElement>(`[data-report-id="${id}"]`)?.focus());
    };
    const readAll=async()=>{
        if(!onReadAll||readingAll)return;
        const ids=all.map(row=>row.id);setReadingAll(true);
        try{if(await onReadAll())setAcknowledged(current=>new Set([...current,...ids]));}
        finally{setReadingAll(false);}
    };
    const loadOlder=async()=>{
        if(!loadReports||loading||!all.length)return;
        setLoading(true);setLoadError('');
        try{
            const page=await loadReports(Math.min(...all.map(row=>row.id)));
            setOlder(current=>[...current,...page.filter(row=>row.owner_id===playerId)]);
            if(!page.length)setHistoryEnd(true);
        }catch{setLoadError('Could not load older reports. Try again.');}
        finally{setLoading(false);}
    };
    return <div className={`report-inbox ${report?'has-selection':''}`}>
        <div className="report-inbox-toolbar"><div className="report-inbox-filters" role="group" aria-label="Filter reports">{filters.map(filter=><button key={filter.id} aria-pressed={query.filter===filter.id} onClick={()=>setQuery({...query,filter:filter.id})}>{filter.title}{filter.id==='unread'&&unreadCount>0&&<span>{unreadCount}</span>}</button>)}</div><button className="report-read-all" disabled={!onReadAll||!unreadCount||readingAll} onClick={()=>void readAll()} title="Mark every report in your history as read"><Icon name="check" size={15}/>{readingAll?'Saving…':'Read all'}</button></div>
        <div className="report-inbox-searchbar"><label><Icon name="focus" size={15}/><input aria-label="Search reports" placeholder="Search camps, battles or heroes" value={query.search} onChange={event=>setQuery({...query,search:event.target.value})}/>{query.search&&<button aria-label="Clear report search" onClick={()=>setQuery({...query,search:''})}>×</button>}</label><select aria-label="Report outcome" value={query.outcome} onChange={event=>setQuery({...query,outcome:event.target.value as InboxQuery['outcome']})}><option value="all">All outcomes</option><option value="victory">Victories</option><option value="defeat">Defeats</option><option value="draw">Stalemates</option></select><select aria-label="Report order" value={query.order} onChange={event=>setQuery({...query,order:event.target.value as InboxQuery['order']})}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></div>
        <div className="report-inbox-workspace"><div ref={listRef} className="report-inbox-list" aria-label="Report inbox"><div className="report-list-caption"><span>{rows.length} {rows.length===1?'report':'reports'}</span><span>{unreadCount?`${unreadCount} unread`:'All caught up'}</span></div>{rows.map(row=>{
            const receipt=inboxReceipt(combined,row,playerId), time=new Date(row.created_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
            return <button key={row.id} data-report-id={row.id} aria-label={`${row.title}, ${receipt.title}, ${receipt.outcome}${!row.read_at?', unread':''}`} className={`report-row ${!row.read_at?'is-unread':''} ${selected===row.id?'is-selected':''}`} aria-pressed={selected===row.id} onClick={()=>open(row)}>
                <span className={`report-row-outcome outcome-${receipt.outcome}`} title={receipt.outcome}><Icon name={receipt.outcome==='victory'?'check':receipt.outcome==='draw'?'time':'shield'} size={15}/></span><span className="report-row-content"><strong>{receipt.title}{!row.read_at&&<i aria-label="Unread report"/>}</strong><small>{time} · {receipt.side==='defender'?'Defence':receipt.side==='attacker'?'Attack':'Battle'}</small><span className="report-row-meta"><span className={receipt.losses?'has-losses':''}>{receipt.losses===null?'Side unrecorded':`${receipt.losses} lost`}</span>{receipt.equipment>0&&<span><Icon name="sparkles" size={11}/>{receipt.equipment} {receipt.equipment===1?'item':'items'}</span>}{receipt.experience>0&&<span>+{receipt.experience} XP</span>}</span></span><span className="report-row-net" title="Net resources after actual delivery and casualty replacement cost">{receipt.net!==null?<><b className={receipt.net<0?'has-losses':''}>{receipt.net>0?'+':''}{receipt.net.toLocaleString()}</b><small>net</small></>:<><b>{receipt.outcome==='victory'?'Victory':receipt.outcome==='draw'?'Draw':'Defeat'}</b><small>{receipt.loot>0?'loot recorded':'no spoils'}</small></>}</span>
            </button>;
        })}{!rows.length&&<div className="report-list-empty"><Icon name="report" size={28}/><h3>{!all.length?'No reports yet':query.filter==='unread'&&!query.search?'All caught up':'No matching reports'}</h3><p>{!all.length?'Your completed battles will appear here.':'Try another filter or search.'}</p>{(query.search||query.filter!=='all'||query.outcome!=='all')&&<button onClick={()=>setQuery({...query,filter:'all',outcome:'all',search:''})}>Show all reports</button>}</div>}{hasOlder&&<div className="report-history-more"><p>{all.length} of {total} reports loaded. Search covers this history.</p><button disabled={loading} onClick={()=>void loadOlder()}>{loading?'Loading…':'Load older reports'}<Icon name="chevron" size={13}/></button></div>}{loadError&&<p className="report-load-error" role="alert">{loadError}</p>}</div>
        <section ref={detailRef} className="report-inbox-detail" aria-label="Report details" tabIndex={-1}>{report?<><div className="report-detail-nav"><button onClick={back}><span className="report-back-arrow" aria-hidden="true">←</span>Back to reports</button><div><button aria-label="Previous report" disabled={index<=0} onClick={()=>open(rows[index-1])}>←</button><button aria-label="Next report" disabled={index<0||index>=rows.length-1} onClick={()=>open(rows[index+1])}>→</button></div></div><ReportDetails world={combined} playerId={playerId} report={report} onLocate={onLocate}/></>:<div className="report-detail-empty"><Icon name="report" size={34}/><h2>Your battle inbox</h2><p>Choose a report to see losses, delivered resources and hero rewards.</p><span>Browsing keeps reports unread.</span></div>}</section></div>
    </div>;
}
