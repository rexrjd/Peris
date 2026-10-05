import { useState } from 'react'
import type { Difficulty, Terrain } from '../types/game'
import { Crest, Icon } from './Icons'
import { readSolo } from '../lib/local'

export function Login({onSolo,onOnline,onPractice,busy,error}:{onSolo:(name:string,resume:boolean)=>void;onOnline:(name:string)=>void;onPractice:(terrain:Terrain,difficulty:Difficulty)=>void;busy:boolean;error:string|null}){
 const [mode,setMode]=useState<'solo'|'online'>('solo'),[name,setName]=useState('Rex'),[setup,setSetup]=useState(false),[terrain,setTerrain]=useState<Terrain>('plains'),[difficulty,setDifficulty]=useState<Difficulty>('normal')
 const saved=readSolo(),standalone=location.protocol==='file:'
 return <main className="launcher">
  <div className="launcher-art"/><div className="launcher-shade"/>
  <div className="launcher-top"><span>AN AGE OF AMBITION</span><span>PLAYABLE PROTOTYPE · V0.6</span></div>
  <section className="launcher-panel"><Crest/><div className="eyebrow">BUILD A REALM. COMMAND A LEGION.</div><h1>PERIS</h1><div className="title-rule"/><p className="launcher-intro">An empire begins with a single settlement.<br/>What will yours become?</p>
   <div className="mode-tabs"><button className={mode==='solo'?'active':''} onClick={()=>setMode('solo')}>Solo campaign</button><button className={mode==='online'?'active':''} disabled={standalone} title={standalone?'Use the deployed project for multiplayer':undefined} onClick={()=>setMode('online')}>Multiplayer</button></div>
   <form onSubmit={e=>{e.preventDefault();mode==='solo'?onSolo(name,false):onOnline(name)}}>
    <label className="field-label" htmlFor="ruler-name">YOUR RULER NAME</label><input id="ruler-name" value={name} onChange={e=>setName(e.target.value)} maxLength={20} autoComplete="off" placeholder="Choose a name" disabled={busy}/>
    <button className="button gold launch-cta" disabled={busy}>{busy?'Opening the gates…':mode==='solo'?'Found a new realm':'Enter the shared world'}<Icon name="arrow"/></button>
   </form>
   {mode==='solo'&&saved&&<button className="button outline continue-button" onClick={()=>onSolo('',true)} disabled={busy}>Continue {saved.players[0].display_name}'s realm <Icon name="arrow" size={16}/></button>}
   <p className="mode-description">{mode==='solo'?'A persistent campaign against rebel hosts. Saves automatically in this browser.':'Name-only accounts. Your friends share the same province. Your existing realm is kept.'}</p>
   <button className="quick-battle-link" onClick={()=>setSetup(true)} disabled={busy}><Icon name="army"/> QUICK BATTLE <span>Skip straight to command</span></button>
   {error&&<div className="alert error" role="alert">{error}</div>}
  </section>
  <div className="launcher-bottom"><span>ECONOMY · CAMPAIGN · REAL-TIME TACTICS</span><span>Original world & artwork · inspired by classical strategy</span></div>
  {setup&&<div className="modal-backdrop"><section className="modal quick-setup"><button className="modal-close" aria-label="Close" onClick={()=>setSetup(false)}>×</button><span className="eyebrow">NO ACCOUNT REQUIRED</span><h2>Take the field</h2><p>Command nine formations against an AI host. Practice deployment, ranged combat, and cavalry charges.</p><label className="field-label">BATTLEFIELD</label><div className="terrain-options">{(['plains','woods','highlands','river']as Terrain[]).map(t=><button key={t} className={terrain===t?'selected':''} onClick={()=>setTerrain(t)}><Icon name={t==='river'?'world':t==='woods'?'wood':t==='highlands'?'stone':'food'}/><span>{t}</span></button>)}</div><label className="field-label" htmlFor="difficulty">ENEMY COMMANDER</label><select id="difficulty" value={difficulty} onChange={e=>setDifficulty(e.target.value as Difficulty)}><option value="easy">Recruit · smaller host</option><option value="normal">Veteran · balanced battle</option><option value="hard">General · larger host</option></select><button className="button gold" onClick={()=>onPractice(terrain,difficulty)}>Deploy your army <Icon name="arrow"/></button></section></div>}
 </main>
}
