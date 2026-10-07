import {useState} from 'react';
import type {World} from '../../../shared/model/world';
import type {Battle} from '../../battle/domain/types';
import type {Command} from '../../../shared/model/commands';
import {Modal} from '../../../shared/ui/Shared';
import {SPELLS,knowsSpell,towerLevel,maximumMana} from '../domain/spells';
export function BattleSpellbook({world,battle,owner,run}:{world:World;battle:Battle;owner:string;run:(c:Command,message?:string)=>Promise<void>}){
 const [open,setOpen]=useState(false),[spellId,setSpell]=useState(''),[target,setTarget]=useState<number|null>(null),[casting,setCasting]=useState(false);
 const sid=world.settlements.find(s=>s.owner_id===owner)?.id,level=sid===undefined?0:towerLevel(world,sid);
 const learned=SPELLS.filter(s=>sid!==undefined&&knowsSpell(world,sid,s.id)),side=owner===battle.attacker_owner_id?'attacker':'defender';
 const mana=(side==='attacker'?battle.mana_attacker:battle.mana_defender)??maximumMana(level),ready=(side==='attacker'?battle.spell_ready_attacker:battle.spell_ready_defender)??0,cooldown=Math.max(0,Math.ceil(ready-battle.elapsed));
 const spell=learned.find(s=>s.id===spellId)??learned[0],friendly=spell?.target==='ally'||spell?.target==='allies',single=spell?.target==='ally'||spell?.target==='enemy';
 const candidates=world.formations.filter(f=>f.battle_id===battle.id&&(friendly?f.side===side:f.side!==side)&&(spell?.revive||f.soldiers>0&&f.status!=='routed'));
 const chosen=candidates.find(f=>f.id===target)?.id??candidates[0]?.id;
 const cast=async()=>{if(!spell||casting)return;setCasting(true);try{await run({type:'castSpell',battleId:battle.id,spell:spell.id,target:single?chosen:undefined},`${spell.name} cast`);}finally{setCasting(false);}};
 if(!level||!learned.length)return null;
 return <><button className="button magic-cast-open" disabled={battle.phase!=='combat'} onClick={()=>setOpen(true)}>✦ Spellbook <small>{mana} / {maximumMana(level)} mana</small></button>{open&&<Modal title="Battle spellbook" className="mage-spellbook" onClose={()=>setOpen(false)}><p className="magic-intro">{mana} / {maximumMana(level)} mana · {cooldown?`Mage recovering: ${cooldown}s`:'Mage ready'} · Mana resets each battle.</p><div className="battle-magic-layout"><div className="battle-spell-list">{learned.map(s=><button key={s.id} className={spell?.id===s.id?'selected':''} onClick={()=>{setSpell(s.id);setTarget(null);}}><strong>{s.name}</strong><small>Level {s.level} · {s.mana} mana</small></button>)}</div>{spell&&<section className="magic-card"><span className="magic-sigil">✦</span><h3>{spell.name}</h3><p>{spell.description}</p>{single&&<label className="magic-target">{friendly?'Friendly':'Enemy'} formation<select value={chosen??''} onChange={e=>setTarget(Number(e.target.value))}>{candidates.map(f=><option key={f.id} value={f.id}>{f.label} · {f.soldiers} soldiers{f.status==='routed'?' · Routed':''}</option>)}</select></label>}<button className="button gold" disabled={casting||!!cooldown||mana<spell.mana||!candidates.length||battle.status!=='active'||battle.phase!=='combat'} onClick={()=>void cast()}>{cooldown?`Recovering · ${cooldown}s`:mana<spell.mana?'Not enough mana':`Cast ${spell.name}`}</button></section>}</div></Modal>}</>;
}
