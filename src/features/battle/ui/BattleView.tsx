import { useEffect, useMemo, useRef, useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Battle, Formation } from '../domain/types';
import type { GameEngine } from '../../../engine/contracts';
import type { Command } from '../../../shared/model/commands';
import { mySide } from '../domain/ownership';
import { LocalEngine } from '../../../engine/local/LocalEngine';
import { playerName } from '../../campaign/domain/players';
import { UNITS } from '../../army/domain/units';
import { clock } from '../../../shared/time/clock';
import { Icon, UnitPortrait } from '../../../shared/ui/Icons';
import { GameCanvas } from '../../../engine/rendering/GameCanvas';
import { Battle3DCanvas, type BattleArt } from '../rendering/Battle3DCanvas';
import { battleArt, battlePresentation } from './battlePresentation';
import { ARMY_ROLES, armyRole, type ArmyRole } from '../rendering/three/armyAssets';
import { terrainAt } from '../domain/terrain';
import { Modal } from '../../../shared/ui/Shared';

type FieldEvent={id:number;text:string;friendly:boolean};
export function BattleView({world:sourceWorld,battle,engine,run,onHelp,onSettings,art:suppliedArt,initialRenderMode='3d'}:{world:World;battle:Battle;engine:GameEngine;run:(c:Command,message?:string)=>Promise<void>;onHelp:()=>void;onSettings:()=>void;art?:BattleArt;initialRenderMode?:'2d'|'3d'}){
 const art=useMemo(()=>suppliedArt??battleArt(sourceWorld,battle,engine.playerId),[suppliedArt,sourceWorld.settlements,sourceWorld.armies,battle.id,engine.playerId]);
 const world=useMemo(()=>battlePresentation(sourceWorld,battle,engine.playerId,art),[sourceWorld,battle,engine.playerId,art]);
 const [renderMode,setRenderMode]=useState<'2d'|'3d'>(initialRenderMode),[graphicsUnavailable,setGraphicsUnavailable]=useState(false),[inspecting,setInspecting]=useState(false),[inspectedRole,setInspectedRole]=useState<ArmyRole>();
 const BattlefieldCanvas=renderMode==='3d'?Battle3DCanvas:GameCanvas;
 const [selected,setSelected]=useState<number[]>([]),[paused,setPaused]=useState(false),[speed,setSpeed]=useState(1),[menu,setMenu]=useState(false),[withdraw,setWithdraw]=useState(false),[events,setEvents]=useState<FieldEvent[]>([]);
 const previous=useRef(new Map<number,string>()),lastSpell=useRef(''),serial=useRef(0),wasPaused=useRef(false);
 const fs=world.formations.filter(f=>f.battle_id===battle.id),side=mySide(battle,engine.playerId),own=fs.filter(f=>f.side===side),enemy=fs.filter(f=>f.side!==side),local=engine instanceof LocalEngine;
 const valid=selected.filter(id=>fs.some(f=>f.id===id)),unit=fs.find(f=>f.id===valid[0]);
 const portrait=(f:Formation)=>({atlas:`/art/battle/roster/${f.side===side?art.faction:art.enemy}.png`,tile:ARMY_ROLES.indexOf(armyRole(f,fs))});
 const total=(list:Formation[])=>list.reduce((n,f)=>n+f.soldiers,0),initial=(list:Formation[])=>list.reduce((n,f)=>n+f.initial_soldiers,0),power=total(own)/Math.max(1,total(own)+total(enemy))*100;
 const enemyName=battle.mode==='pvp'?playerName(world.players,side==='attacker'?battle.defender_owner_id:battle.attacker_owner_id):battle.enemy_name;
 const mana=(side==='attacker'?battle.mana_attacker:battle.mana_defender)??0;
 const pause=()=>{if(local){engine.paused=!engine.paused;setPaused(engine.paused);}};
 const openMenu=()=>{wasPaused.current=local&&engine.paused;if(local){engine.paused=true;setPaused(true);}setMenu(true);};
 const resume=()=>{if(local&&!wasPaused.current){engine.paused=false;setPaused(false);}};
 const closeMenu=()=>{setMenu(false);resume();};
 const closeWithdraw=()=>{setWithdraw(false);resume();};
 useEffect(()=>{setSelected(own[0]?[own[0].id]:[]);setPaused(local&&engine.paused);setSpeed(local?engine.speed:1);previous.current.clear();lastSpell.current='';setEvents([{id:++serial.current,text:'Both commanders take control. The battle begins automatically.',friendly:true}]);},[battle.id]);
 useEffect(()=>{
  const additions:FieldEvent[]=[];
  for(const f of fs){const before=previous.current.get(f.id);if(before&&before!==f.status&&f.status==='routed')additions.push({id:++serial.current,text:`${f.side===side?'Our':'Enemy'} ${UNITS[f.unit_type].name} ${f.soldiers?'are routing':'have fallen'}.`,friendly:f.side!==side});previous.current.set(f.id,f.status);}
  if(battle.last_spell){const s=battle.last_spell,key=`${s.owner_id}:${s.id}:${s.at}`;if(lastSpell.current!==key){lastSpell.current=key;additions.push({id:++serial.current,text:`${s.owner_id===engine.playerId?'Our':'Enemy'} commander casts ${s.name}.`,friendly:s.owner_id===engine.playerId});}}
  if(additions.length)setEvents(old=>[...old,...additions].slice(-4));
 },[world]);
 return <main className={`tactical-shell automatic-battle ${inspecting&&renderMode==='3d'?'model-inspection':''}`}>
  <header className="battle-header"><div className="battle-heading"><span className="eyebrow">AUTOMATIC BATTLE · {battle.terrain.toUpperCase()}</span><h1>{enemyName}</h1></div><div className="balance-wrap"><div className="balance-labels"><span>Your army <b>{total(own)}</b></span><span><b>{total(enemy)}</b>Enemy army</span></div><div className="balance-track"><i style={{width:`${power}%`}}/></div><small>{initial(own)-total(own)} friendly losses · {initial(enemy)-total(enemy)} enemy losses</small></div><div className="battle-time"><span>{paused?'PAUSED':'AI VS AI'}</span><strong>{clock(battle.elapsed)}</strong><button aria-label="Open battle menu" onClick={openMenu}><Icon name="settings"/></button></div></header>
  <section className="tactical-body"><div className="tactical-field">
   {paused&&<div className="pause-banner"><span className="eyebrow">SPECTATOR PAUSE</span><strong>The battlefield is paused.</strong><button onClick={pause}>Resume <kbd>Space</kbd></button></div>}
   <BattlefieldCanvas art={art} onInspectionChange={(value,role)=>{setInspecting(value);setInspectedRole(role);}} onUnavailable={()=>{setGraphicsUnavailable(true);setRenderMode('2d');}} state={{world,playerId:engine.playerId,mode:'battle',battle,selectedIds:valid,touchOrder:'select',paused}} actions={{selectMap:()=>{},moveArmy:()=>{},selectUnits:setSelected,order:()=>{},pause,rally:()=>{},menu:openMenu}}/>
   <div className="battle-events" aria-live="polite">{events.map(e=><div key={e.id} className={e.friendly?'friendly':'hostile'}><Icon name="flag" size={13}/><span>{e.text}</span></div>)}</div>
   <div className="battle-field-footer"><span>Both armies fight automatically · Click a formation to inspect · Drag to pan</span><button onClick={onHelp}><Icon name="book" size={13}/>Game rules</button></div>
  </div><aside className="commander-panel"><div className="battle-render-controls" role="group" aria-label="Battle graphics"><span>Battle view</span><button aria-pressed={renderMode==='2d'} onClick={()=>setRenderMode('2d')}>2D</button><button aria-pressed={renderMode==='3d'} onClick={()=>{setGraphicsUnavailable(false);setRenderMode('3d');}}>3D units</button></div>{graphicsUnavailable&&<p className="battle-render-notice" role="status">3D graphics unavailable. Your battle continues in 2D.</p>}{inspecting&&(inspectedRole==='ram'||inspectedRole==='catapult')&&<section className="siege-study"><span className="eyebrow">SIEGE STUDY</span><h2>{art.roles?.find(r=>r.id===inspectedRole)?.name??inspectedRole}</h2><p>Visual prototype. Workshop production and siege combat are planned.</p></section>}<div className="command-title"><span className="eyebrow">BATTLE OBSERVER</span><span className="command-selection">AI CONTROL</span></div><h2>{unit?unit.label:'Watch the battle'}</h2><p>{unit?`${unit.side===side?'Your':'Enemy'} formation · ${UNITS[unit.unit_type].name}`:'Inspect either army to see casualties, morale and its current target.'}</p>
   {!(inspecting&&(inspectedRole==='ram'||inspectedRole==='catapult'))&&unit&&<><div className="command-unit-art"><UnitPortrait type={unit.unit_type} {...portrait(unit)}/><div><b>{unit.soldiers}</b><span>of {unit.initial_soldiers} soldiers</span><small>{unit.kills} enemy kills</small></div></div><div className="command-meters"><label>Morale <b>{Math.round(unit.morale)}%</b></label><div className="progress-track"><i style={{width:`${unit.morale}%`}}/></div><label>Stamina <b>{Math.round(unit.stamina)}%</b></label><div className="progress-track stamina"><i style={{width:`${unit.stamina}%`}}/></div></div><div className="terrain-note"><Icon name="world" size={16}/>{terrainAt(battle.terrain,unit.x,unit.y).kind} · {unit.status}</div><p className="command-tip">{unit.target_formation_id?`Target: ${fs.find(f=>f.id===unit.target_formation_id)?.label??'Repositioning'}`:'Regrouping'}{unit.charge_ready?' · Charge prepared':''}</p></>}
   <label className="field-label">AUTOMATIC COMMAND</label><p className="command-tip">Infantry holds the front. Archers keep their distance. Cavalry looks for an opening. Commanders choose spells and rally their army when needed.</p><div className="terrain-note"><Icon name="flag" size={16}/>{mana} mana remaining · spells cast by AI</div>
   {local&&<div className="time-controls"><button onClick={pause}>{paused?'▶ Resume':'Ⅱ Pause'}</button>{[1,2,3].map(n=><button key={n} className={speed===n?'selected':''} onClick={()=>{engine.speed=n;setSpeed(n);}}>{n}×</button>)}</div>}
   {!local&&<p className="command-tip">The server controls the battle clock. Watching does not change either army’s strength.</p>}
   <button className="withdraw-button" onClick={()=>{wasPaused.current=local&&engine.paused;if(local){engine.paused=true;setPaused(true);}setWithdraw(true);}}>Concede battle</button>
  </aside></section>
  <footer className="unit-tray"><div className="unit-tray-label"><Icon name="army"/><span>YOUR ARMY<small>{total(own)} soldiers</small></span></div><div className="unit-cards">{own.map((f,i)=><button key={f.id} aria-label={`Inspect ${f.label}`} className={`unit-card ${valid.includes(f.id)?'selected':''} ${f.status==='routed'?'routed':''}`} onClick={()=>setSelected([f.id])}><span className="unit-hotkey">{i<9?i+1:''}</span><UnitPortrait type={f.unit_type} {...portrait(f)}/><div className="unit-card-meta"><strong>{f.soldiers}</strong><span>{f.label}</span></div><div className="unit-morale"><i style={{width:`${f.morale}%`}}/></div><small>{f.soldiers===0?'FALLEN':f.status.toUpperCase()}</small></button>)}</div></footer>
  {menu&&<Modal title="Automatic battle" className="battle-menu" onClose={closeMenu}><p>Your army composition, hero, equipment, research and home-city smithies determine its strength. Both armies use the same AI decision rules.</p><button className="button gold" onClick={closeMenu}>Return to battle</button><button className="settings-action" onClick={()=>{closeMenu();onSettings();}}><Icon name="settings"/>Settings</button></Modal>}
  {withdraw&&<Modal title="Concede the field?" className="withdraw-modal" onClose={closeWithdraw}><p>{battle.mode==='practice'?'This practice battle will end. Your campaign is unaffected.':'Your surviving soldiers return home. Soldiers already lost remain lost.'}</p><div className="modal-actions"><button className="button outline" onClick={closeWithdraw}>Keep watching</button><button className="button gold" onClick={()=>{setWithdraw(false);if(local){engine.paused=false;setPaused(false);}void run({type:'retreat',battleId:battle.id});}}>Concede battle</button></div></Modal>}
 </main>;
}
