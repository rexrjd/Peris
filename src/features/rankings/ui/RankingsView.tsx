import {useEffect,useRef,useState} from 'react';
import type {GameEngine} from '../../../engine/contracts';
import {Icon} from '../../../shared/ui/Icons';
import {RANKING_CATEGORIES,type RankingCategory,type RankingEntry,type RankingPeriod} from '../domain/types';
import {RankingsError} from '../platform/client';
import {startRankingsRead,type RankingsState} from './reader';

const categories:Record<RankingCategory,{name:string;icon:string;unit:string;description:string}>={
  attack:{name:'Attack',icon:'army',unit:'Crop-weighted kills',description:'Enemy player troops killed while attacking, weighted by hourly crop upkeep.'},
  defense:{name:'Defense',icon:'shield',unit:'Crop-weighted kills',description:'Attacking player troops killed. Shared defenses divide points among the committed defenders.'},
  robbers:{name:'Robbers',icon:'gold',unit:'Resources stolen',description:'Wood, stone, food and gold taken in finalized raids, after carrying limits.'},
  camps:{name:'Camps',icon:'flag',unit:'Crop-weighted kills',description:'NPC camp troops killed while attacking, weighted by hourly crop upkeep.'},
  growth:{name:'Growth',icon:'people',unit:'Net population',description:'Net population gained across living cities, including founding, conquests and losses.'},
};
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
  const partial=!!data&&Date.parse(data.tracking_since)>Date.parse(data.week_start);
  return <section className="rankings-page" aria-labelledby="rankings-title">
    <header className="rankings-heading"><div className="rankings-title"><span className="rankings-seal"><Icon name="crown" size={30}/></span><div><p className="rankings-eyebrow">The weekly ledger</p><h1 id="rankings-title">Rankings</h1><p>{solo?'Solo campaign standings · Your campaign only':'The shared world · Rulers of the realm'}</p></div></div>
      <div className="rankings-period" role="group" aria-label="Ranking week"><button aria-pressed={period==='current'} onClick={()=>onPeriod('current')}>This week</button><button aria-pressed={period==='previous'} onClick={()=>onPeriod('previous')}>Last week</button></div>
    </header>
    <div className="rankings-week"><div><strong>{data?`${date(data.week_start)} – ${date(new Date(Date.parse(data.week_end)-1).toISOString())}`:'Weekly standings'}</strong><span>Weeks reset Monday 00:00 UTC · Real calendar time</span></div>{data&&<p>Tracking since {date(data.tracking_since)} (UTC){partial&&<span className="rankings-partial">Partial week</span>}</p>}</div>
    {partial&&<p className="rankings-tracking">{Date.parse(data!.tracking_since)>=Date.parse(data!.week_end)?'Tracking began after this week. No earlier activity is included.':'Tracking began during this week. Only activity since tracking started is included.'}</p>}
    {error&&<div className="rankings-feedback rankings-error" role="alert"><Icon name="world"/><div><strong>{error instanceof RankingsError&&error.kind==='unavailable'?'Rankings are not available in this world yet':'Standings could not be refreshed'}</strong><p>{error.message}</p></div><button className="button outline" onClick={onRetry} disabled={loading}>Retry</button></div>}
    {loading&&<p className="rankings-loading" role="status">{data?'Refreshing standings…':'Loading standings…'}</p>}
    {data&&<><div className="rankings-grid">{RANKING_CATEGORIES.map(category=>{
      const board=data.boards.find(board=>board.category===category)!;const info=categories[category];
      const outside=board.self&&!board.entries.some(row=>row.player_id===board.self!.player_id);
      return <article key={category} className={`ranking-board ranking-${category}`} aria-labelledby={`ranking-${category}`}>
        <header><span className="ranking-category-icon"><Icon name={info.icon} size={23}/></span><div><h2 id={`ranking-${category}`}>{info.name}</h2><p>{info.unit}</p></div><span className="ranking-top">Top 10</span></header>
        <p className="ranking-description" id={`ranking-description-${category}`}>{info.description}</p>
        <table aria-describedby={`ranking-description-${category}`}><caption className="rankings-sr-only">{info.name} weekly Top 10, {info.unit.toLowerCase()}</caption><thead><tr><th scope="col">Rank</th><th scope="col">Ruler</th><th scope="col">{category==='growth'?'People':category==='robbers'?'Resources':'Points'}</th></tr></thead>
          <tbody>{board.entries.map(row=><RankingRow key={row.player_id} entry={row}/>)}{!board.entries.length&&<tr><td colSpan={3} className="ranking-empty">{period==='previous'?'No ranked activity this week.':'No leaders yet. The week is yours to shape.'}</td></tr>}</tbody>
          {outside&&<tbody className="ranking-personal"><RankingRow entry={board.self!}/></tbody>}
        </table>
        <footer><span>Your rank <strong>{board.self?.rank??'Unranked'}</strong></span><span>{board.total_players.toLocaleString()} ranked</span></footer>
      </article>;
    })}</div><p className="rankings-notes">Equal scores share a rank. Only positive scores enter the Top 10; your own net losses remain visible. Practice, scouting and starvation do not earn combat points.</p><p className="rankings-updated">Updated {new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(new Date(data.server_now))} UTC{loading?' · Refreshing…':''}</p></>}
  </section>;
}

function RankingRow({entry}:{entry:RankingEntry}) {
  return <tr className={entry.is_you?'is-you':undefined}><td className={entry.rank!==null&&entry.rank<=3?'ranking-podium':undefined}>{entry.rank??'—'}</td><th scope="row"><span className="ranking-ruler">{entry.display_name}{entry.is_you&&<small>You</small>}</span>{entry.guild_tag&&<span className="ranking-guild">[{entry.guild_tag}]</span>}</th><td className="ranking-score">{score(entry.score)}</td></tr>;
}
