import {useEffect,useRef,useState,type KeyboardEvent} from 'react';
import type {GameEngine} from '../../../engine/contracts';
import {Icon} from '../../../shared/ui/Icons';
import {RANKING_CATEGORIES,type RankingCategory,type RankingEntry,type RankingPeriod} from '../domain/types';
import {RankingsError} from '../platform/client';
import {startRankingsRead,type RankingsState} from './reader';

const categories:Record<RankingCategory,{name:string;heading:string;icon:string;unit:string;description:string}>={
  attack:{name:'Attack',heading:'Attackers',icon:'army',unit:'Crop-weighted kills',description:'Enemy player troops killed while attacking, weighted by hourly crop upkeep.'},
  defense:{name:'Defense',heading:'Defenders',icon:'shield',unit:'Crop-weighted kills',description:'Attacking player troops killed. Shared defenses divide points among the committed defenders.'},
  robbers:{name:'Robbers',heading:'Robbers',icon:'gold',unit:'Resources stolen',description:'Wood, stone, food and gold taken in finalized raids, after carrying limits.'},
  camps:{name:'Camps',heading:'Camp raiders',icon:'flag',unit:'Crop-weighted kills',description:'NPC camp troops killed while attacking, weighted by hourly crop upkeep.'},
  growth:{name:'Growth',heading:'Population growth',icon:'people',unit:'Net population',description:'Net population gained across living cities, including founding, conquests and losses.'},
};
type RankingSelection='all'|RankingCategory;
const tabs:{id:RankingSelection;label:string}[]=[{id:'all',label:'Top 10'},...RANKING_CATEGORIES.map(id=>({id,label:categories[id].name}))];
const date=(value:string)=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value));
const score=(value:number)=>value.toLocaleString();
const initial:RankingsState={data:null,loading:true,error:null};

export function RankingsView({engine}:{engine:GameEngine}) {
  const [period,setPeriod]=useState<RankingPeriod>('current');
  const [result,setResult]=useState<{engine:GameEngine;owner:string;period:RankingPeriod;state:RankingsState}|null>(null);
  const session=useRef<ReturnType<typeof startRankingsRead>|null>(null);
  useEffect(()=>{
    const owner=engine.playerId;
    const reader=startRankingsRead(p=>engine.rankings?engine.rankings(p):Promise.reject(new RankingsError('Weekly Rankings are not available in this world yet.','unavailable')),period,state=>setResult({engine,owner,period,state}));
    session.current=reader;
    // Automatic reads only run while this screen is mounted and visible.
    let lastAutomatic=0;
    const visible=()=>{const now=Date.now();if(document.visibilityState==='visible'&&now-lastAutomatic>=60_000){lastAutomatic=now;void reader.refresh();}};
    visible();
    const timer=window.setInterval(visible,60_000);
    document.addEventListener('visibilitychange',visible);
    return()=>{reader.stop();if(session.current===reader)session.current=null;window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[engine,engine.playerId,period]);
  const state=result?.engine===engine&&result.owner===engine.playerId&&result.period===period?result.state:initial;
  return <RankingsContent state={state} period={period} solo={engine.mode!=='online'} onPeriod={setPeriod} onRetry={()=>void session.current?.refresh()}/>;
}

export function RankingsContent({state,period,solo,onPeriod,onRetry}:{state:RankingsState;period:RankingPeriod;solo:boolean;onPeriod:(period:RankingPeriod)=>void;onRetry:()=>void}) {
  const {data,loading,error}=state;
  const [category,setCategory]=useState<RankingSelection>('all');
  const tabButtons=useRef<(HTMLButtonElement|null)[]>([]);
  const partial=!!data&&Date.parse(data.tracking_since)>Date.parse(data.week_start);
  const changeTab=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
    const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
    if(next===null)return;
    event.preventDefault();setCategory(tabs[next].id);tabButtons.current[next]?.focus();
  };
  return <section className="rankings-page" aria-labelledby="rankings-title">
    <header className="rankings-heading"><div><h1 id="rankings-title">Rankings</h1><p>{solo?'Solo campaign standings':'Shared world'}</p></div>
      <div className="rankings-period" role="group" aria-label="Ranking week"><button aria-pressed={period==='current'} onClick={()=>onPeriod('current')}>This week</button><button aria-pressed={period==='previous'} onClick={()=>onPeriod('previous')}>Last week</button></div>
    </header>
    <div className="rankings-toolbar">
    <div className="rankings-tabs" role="tablist" aria-label="Ranking category">
      {tabs.map((tab,index)=><button key={tab.id} ref={node=>{tabButtons.current[index]=node;}} id={`rankings-tab-${tab.id}`} role="tab" aria-selected={category===tab.id} aria-controls="rankings-panel" tabIndex={category===tab.id?0:-1} onClick={()=>setCategory(tab.id)} onKeyDown={event=>changeTab(event,index)}>{tab.label}</button>)}
    </div>
    <p className="rankings-week">{data?`${date(data.week_start)} – ${date(new Date(Date.parse(data.week_end)-1).toISOString())}`:'Weekly standings'}</p>
    </div>
    <div id="rankings-panel" role="tabpanel" aria-labelledby={`rankings-tab-${category}`} tabIndex={0} className="rankings-panel">
    {error&&<div className="rankings-feedback" role="alert"><Icon name="world" size={18}/><div><strong>{error instanceof RankingsError&&error.kind==='unavailable'?'Rankings are not available in this world yet':'Standings could not be refreshed'}</strong><p>{error.message}</p></div><button className="rankings-retry" onClick={onRetry} disabled={loading}>Retry</button></div>}
    {loading&&<p className="rankings-loading" role="status">{data?'Refreshing standings…':'Loading standings…'}</p>}
    {data&&<div className={`rankings-grid${category!=='all'?' rankings-grid-single':''}`}>{RANKING_CATEGORIES.filter(id=>category==='all'||id===category).map(id=>{
      const board=data.boards.find(board=>board.category===id)!;const info=categories[id];
      const outside=board.self&&!board.entries.some(row=>row.player_id===board.self!.player_id);
      return <article key={id} className={`ranking-board ranking-${id}`} aria-labelledby={`ranking-${id}`}>
        <header><h2 id={`ranking-${id}`}><Icon name={info.icon} size={13}/>{info.heading}</h2><span>{board.total_players.toLocaleString()} ranked</span></header>
        <table><caption className="rankings-sr-only">{info.name} weekly Top 10, {info.unit.toLowerCase()}</caption><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Guild</th><th scope="col">{id==='growth'?'People':id==='robbers'?'Resources':'Points'}</th></tr></thead>
          <tbody>{board.entries.map(row=><RankingRow key={row.player_id} entry={row}/>)}{!board.entries.length&&!board.self&&<tr><td colSpan={4} className="ranking-empty">No ranked players yet.</td></tr>}</tbody>
          {outside&&<tbody className="ranking-personal" aria-label={`Your rank: ${board.self!.rank??'Unranked'}`}><RankingRow entry={board.self!}/></tbody>}
        </table>
      </article>;
    })}</div>}
    </div>
    <footer className="rankings-bottom">
      <details className="rankings-help"><summary>Scoring &amp; weekly reset{partial&&<span>Partial week</span>}</summary>
        <div><dl>{RANKING_CATEGORIES.map(id=><div key={id}><dt>{categories[id].name} <small>{categories[id].unit}</small></dt><dd>{categories[id].description}</dd></div>)}</dl>
          <p>Equal scores share a rank. Only positive scores enter the Top 10; your own net losses remain visible. Practice, scouting and starvation do not earn combat points.</p>
          <p>Weeks begin Monday 00:00 UTC and last seven real days, independent of game speed.</p>
          {data&&<p>Tracking since {date(data.tracking_since)} (UTC).{partial&&(Date.parse(data.tracking_since)>=Date.parse(data.week_end)?' Tracking began after this week. No earlier activity is included.':' Tracking began during this week. Only activity since tracking started is included.')}</p>}
        </div>
      </details>
      <span className="rankings-reset">Weeks reset Monday 00:00 UTC</span>
      {data&&<p className="rankings-updated">Updated {new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(new Date(data.server_now))} UTC{loading?' · Refreshing…':''}</p>}
    </footer>
  </section>;
}

function RankingRow({entry}:{entry:RankingEntry}) {
  return <tr className={entry.is_you?'is-you':undefined}><td className={entry.rank!==null&&entry.rank<=3?'ranking-podium':undefined} aria-label={entry.rank===null?'Unranked':undefined} title={entry.rank===null?'Unranked':undefined}>{entry.rank??'—'}</td><th scope="row"><span className="ranking-ruler">{entry.display_name}{entry.is_you&&<small>You</small>}</span></th><td className="ranking-guild">{entry.guild_tag?`[${entry.guild_tag}]`:'—'}</td><td className="ranking-score">{score(entry.score)}</td></tr>;
}
