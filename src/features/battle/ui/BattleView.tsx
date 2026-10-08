import { useEffect } from 'react';
import { useRef } from 'react';
import { useState } from 'react';
import { type World } from '../../../shared/model/world';
import { type Battle, type BattleOrder, type Formation } from '../domain/types';
import { type GameEngine } from '../../../engine/contracts';
import { type Command } from '../../../shared/model/commands';
import { mySide } from '../domain/ownership';
import { LocalEngine } from '../../../engine/local/LocalEngine';
import { playerName } from '../../campaign/domain/players';
import { clamp } from '../../../shared/math/geometry';
import { UNITS } from '../../army/domain/units';
import { clock } from '../../../shared/time/clock';
import { Icon, UnitPortrait } from '../../../shared/ui/Icons';
import { GameCanvas } from '../../../engine/rendering/GameCanvas';
import { Battle3DCanvas } from '../rendering/Battle3DCanvas';
import { terrainAt } from '../domain/terrain';
import { Modal } from '../../../shared/ui/Shared';
import { BRIEFINGS } from '../../campaign/domain/progression';
import {BattleSpellbook} from '../../magic/ui/BattleSpellbook';
type FieldEvent = {
    id: number;
    text: string;
    friendly: boolean;
    icon: string;
};
export function BattleView({ world, battle, engine, run, onHelp, onSettings }: {
    world: World;
    battle: Battle;
    engine: GameEngine;
    run: (c: Command, message?: string) => Promise<void>;
    onHelp: () => void;
    onSettings: () => void;
}) {
    const [renderMode, setRenderMode] = useState<'2d' | '3d'>('2d'), [graphicsUnavailable, setGraphicsUnavailable] = useState(false);
    const BattlefieldCanvas = renderMode === '3d' ? Battle3DCanvas : GameCanvas;
    const [selected, setSelected] = useState<number[]>([]), [touchOrder, setTouchOrder] = useState<'select' | 'move' | 'attack'>('select'), [paused, setPaused] = useState(false), [speed, setSpeed] = useState(1), [menu, setMenu] = useState(false), [withdraw, setWithdraw] = useState(false), [arranging, setArranging] = useState(false), [events, setEvents] = useState<FieldEvent[]>([]);
    const lastSpell=useRef('');
    const previous = useRef(new Map<number, {
        status: string;
        charge: boolean;
        soldiers: number;
    }>()), previousPhase = useRef(''), wasPaused = useRef(false), serial = useRef(0);
    const fs = world.formations.filter(f => f.battle_id === battle.id), own = fs.filter(f => f.owner_id === engine.playerId), enemy = fs.filter(f => f.owner_id !== engine.playerId), side = mySide(battle, engine.playerId), ready = side === 'attacker' ? battle.attacker_ready : battle.defender_ready;
    const valid = selected.filter(id => own.some(f => f.id === id && f.soldiers > 0 && f.status !== 'routed')), unit = own.find(f => f.id === valid[0]), local = engine instanceof LocalEngine;
    const total = (list: Formation[]) => list.reduce((sum, f) => sum + f.soldiers, 0), initial = (list: Formation[]) => list.reduce((sum, f) => sum + f.initial_soldiers, 0), power = total(own) / Math.max(1, total(own) + total(enemy)) * 100;
    const rallied = side === 'attacker' ? battle.rally_attacker : battle.rally_defender, enemyName = battle.mode === 'pvp' ? playerName(world.players, side === 'attacker' ? battle.defender_owner_id : battle.attacker_owner_id) : battle.enemy_name;
    const select = (ids: number[]) => { setSelected(ids); setTouchOrder('select'); };
    const issue = async (o: BattleOrder) => {
        if (!o.ids.length)
            return;
        if (o.kind === 'move' && o.facing === undefined) {
            const group = own.filter(f => o.ids.includes(f.id)), cx = group.reduce((n, f) => n + f.x, 0) / group.length, cy = group.reduce((n, f) => n + f.y, 0) / group.length;
            const left = battle.phase === 'deployment' ? (side === 'attacker' ? 35 : 835) : 35, right = battle.phase === 'deployment' ? (side === 'attacker' ? 365 : 1165) : 1165;
            o = { ...o, x: clamp(o.x ?? cx, left + cx - Math.min(...group.map(f => f.x)), right + cx - Math.max(...group.map(f => f.x))), y: clamp(o.y ?? cy, 40 + cy - Math.min(...group.map(f => f.y)), 660 + cy - Math.max(...group.map(f => f.y))) };
        }
        await run({ type: 'order', battleId: battle.id, order: o });
        setTouchOrder('select');
    };
    const pause = () => { if (local) {
        engine.paused = !engine.paused;
        setPaused(engine.paused);
    } };
    const openMenu = () => { wasPaused.current = local && engine.paused; if (local) {
        engine.paused = true;
        setPaused(true);
    } setMenu(true); };
    const closeMenu = () => { setMenu(false); if (local && !wasPaused.current) {
        engine.paused = false;
        setPaused(false);
    } };
    const openWithdraw = () => { wasPaused.current = local && engine.paused; if (local) {
        engine.paused = true;
        setPaused(true);
    } setWithdraw(true); };
    const closeWithdraw = () => { setWithdraw(false); if (local && !wasPaused.current) {
        engine.paused = false;
        setPaused(false);
    } };
    useEffect(() => { select(own[0] ? [own[0].id] : []); setPaused(local && engine.paused); setSpeed(local ? engine.speed : 1); previous.current.clear(); previousPhase.current = ''; lastSpell.current=''; setEvents([]); }, [battle.id]);
    useEffect(() => {
        if (!local)
            return;
        const timer = window.setInterval(() => setPaused(engine.paused), 150);
        const visibility = () => { if (document.hidden && battle.phase === 'combat') {
            engine.paused = true;
            setPaused(true);
        } };
        document.addEventListener('visibilitychange', visibility);
        return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
    }, [engine, battle.phase, local]);
    useEffect(() => {
        const additions: FieldEvent[] = [];
        const add = (text: string, friendly: boolean, icon: string) => additions.push({ id: ++serial.current, text, friendly, icon });
        if (previousPhase.current !== battle.phase) {
            previousPhase.current = battle.phase;
            add(battle.phase === 'deployment' ? 'The host awaits your deployment.' : 'The standards are raised. Take the field.', true, 'flag');
        }
        if(battle.last_spell){
            const spell=battle.last_spell,key=`${spell.owner_id}:${spell.id}:${spell.at}`;
            if(lastSpell.current!==key){lastSpell.current=key;const ours=spell.owner_id===engine.playerId;add(`${ours?'Our mage':'Enemy mage'} casts ${spell.name}.`,ours,'flag');}
        }
        for (const f of fs) {
            const old = previous.current.get(f.id), ours = f.owner_id === engine.playerId;
            if (old && old.status !== f.status && f.status === 'routed')
                add(`${ours ? 'Our' : 'Their'} ${UNITS[f.unit_type].name} ${f.soldiers > 0 ? 'are routing' : 'have fallen'}.`, !ours, 'flag');
            if (old && old.charge && !f.charge_ready && f.status === 'engaged')
                add(`${ours ? 'Our' : 'Their'} cavalry charge strikes home.`, ours, 'horse');
            previous.current.set(f.id, { status: f.status, charge: f.charge_ready, soldiers: f.soldiers });
        }
        if (additions.length)
            setEvents(prev => [...prev, ...additions].slice(-4));
    }, [world]);
    const arrange = async (style: 'balanced' | 'guard') => {
        setArranging(true);
        try {
            for (const type of ['infantry', 'archers', 'cavalry'] as const) {
                const group = own.filter(f => f.unit_type === type);
                for (let i = 0; i < group.length; i++) {
                    const f = group[i], x = (side === 'attacker' ? 1 : -1) * (type === 'infantry' ? 285 : 175) + (side === 'attacker' ? 0 : 1200), y = type === 'cavalry' ? (i % 2 === 0 ? 85 + (i / 2) * 45 : 615 - Math.floor(i / 2) * 45) : 350 + (i - (group.length - 1) / 2) * Math.min(100, 500 / Math.max(1, group.length - 1));
                    await run({ type: 'order', battleId: battle.id, order: { kind: 'move', ids: [f.id], x, y, facing: side === 'attacker' ? 0 : 180, columns: type === 'cavalry' ? 6 : 10 } });
                }
                if (group.length)
                    await run({ type: 'order', battleId: battle.id, order: { kind: 'stance', ids: group.map(f => f.id), stance: type === 'infantry' ? style : 'balanced' } });
            }
        }
        finally {
            setArranging(false);
        }
    };
    const averageMorale = own.filter(f => f.soldiers > 0).reduce((n, f) => n + f.morale, 0) / Math.max(1, own.filter(f => f.soldiers > 0).length);
    return <main className={`tactical-shell ${battle.phase === 'deployment' ? 'deploying' : ''}`}>
  <header className="battle-header"><div className="battle-heading"><span className="eyebrow">{battle.mode === 'practice' ? 'QUICK BATTLE' : battle.mode === 'pvp' ? 'LIVE DUEL' : `CAMPAIGN ${battle.camp_id} OF 6`} · {battle.terrain === 'woods' ? 'WOODLAND' : battle.terrain === 'river' ? 'RIVER CROSSING' : battle.terrain === 'highlands' ? 'HIGH COUNTRY' : 'OPEN COUNTRY'}</span><h1>{enemyName}</h1></div><div className="balance-wrap"><div className="balance-labels"><span>Your host <b>{total(own)}</b></span><span><b>{total(enemy)}</b>Enemy host</span></div><div className="balance-track"><i style={{ width: `${power}%` }}/></div><small>{initial(own) - total(own)} friendly losses · {initial(enemy) - total(enemy)} enemy losses</small></div><div className="battle-time"><span>{battle.phase === 'deployment' ? 'DEPLOYMENT' : paused ? 'TACTICAL PAUSE' : 'THE BATTLE'}</span><strong>{clock(battle.elapsed)}</strong><button aria-label="Open battle menu" title="Battle menu · Esc" onClick={openMenu}><Icon name="settings"/></button></div></header>
  <section className="tactical-body"><div className="tactical-field">
   {battle.phase === 'deployment' && <div className="deployment-banner"><div><Icon name="flag"/><span><strong>Raise your battle line</strong><small>Select troops, then click inside your shaded zone. Right-drag to set a line.</small></span></div><button className="button gold" disabled={ready || arranging} onClick={() => void run({ type: 'ready', battleId: battle.id }, battle.mode === 'pvp' ? 'Deployment ready' : 'The battle has begun')}>{ready ? 'Waiting for your rival…' : 'Begin battle'}<Icon name="arrow" size={16}/></button></div>}
   {paused && battle.phase === 'combat' && <div className="pause-banner"><span className="eyebrow">TACTICAL PAUSE</span><strong>Time to think. Your orders still stand.</strong><button onClick={pause}>Resume the battle <kbd>Space</kbd></button></div>}
   <BattlefieldCanvas onUnavailable={() => { setGraphicsUnavailable(true); setRenderMode('2d'); }} state={{ world, playerId: engine.playerId, mode: 'battle', battle, selectedIds: valid, touchOrder, paused }} actions={{ selectMap: () => { }, moveArmy: () => { }, selectUnits: select, order: o => void issue(o), pause, rally: () => { if (!rallied && battle.phase === 'combat')
            void run({ type: 'rally', battleId: battle.id }, 'Your general rallies the host'); }, menu: openMenu }}/>
   <div className="battle-events" aria-live="polite">{events.map(e => <div key={e.id} className={e.friendly ? 'friendly' : 'hostile'}><Icon name={e.icon} size={13}/><span>{e.text}</span></div>)}</div>
   {touchOrder !== 'select' && <div className="field-order-hint"><Icon name={touchOrder === 'move' ? 'flag' : 'army'}/>{touchOrder === 'move' ? 'Choose a destination on the field.' : 'Choose an enemy formation.'}<button onClick={() => setTouchOrder('select')}>Cancel</button></div>}
   <div className="battle-field-footer"><span><kbd>Click</kbd> Select & command <kbd>Drag</kbd> Select a group <kbd>Right drag</kbd> Draw a battle line {renderMode === '3d' && <><kbd>Arrows</kbd> Pan <kbd>Q/E</kbd> Rotate</>}</span><button onClick={onHelp}><Icon name="book" size={13}/>The General's Codex</button></div>
  </div>
  <aside className="commander-panel"><div className="battle-render-controls" role="group" aria-label="Battle graphics"><span>Battle view</span><button aria-pressed={renderMode === '2d'} onClick={() => setRenderMode('2d')}>2D</button><button aria-pressed={renderMode === '3d'} onClick={() => { setGraphicsUnavailable(false); setRenderMode('3d'); }}>3D prototype</button></div>{graphicsUnavailable && <p className="battle-render-notice" role="status">3D graphics unavailable. Your battle continues in 2D.</p>}<div className="command-title"><span className="eyebrow">YOUR COMMAND</span><span className="command-selection">{valid.length || 0} selected</span></div><h2>{unit ? UNITS[unit.unit_type].name : 'The legion awaits'}</h2><p>{valid.length > 1 ? 'Orders apply to every selected formation.' : unit ? unit.label : 'Choose a formation on the field or a unit card.'}</p>
   {unit ? <><div className="command-unit-art"><UnitPortrait type={unit.unit_type}/><div><b>{unit.soldiers}</b><span>of {unit.initial_soldiers} soldiers</span><small>{unit.kills} enemy kills</small></div></div><div className="command-meters"><label>Morale <b>{Math.round(unit.morale)}%</b></label><div className="progress-track"><i style={{ width: `${unit.morale}%` }}/></div><label>Stamina <b>{Math.round(unit.stamina)}%</b></label><div className="progress-track stamina"><i style={{ width: `${unit.stamina}%` }}/></div></div><div className="terrain-note"><Icon name={terrainAt(battle.terrain, unit.x, unit.y).kind === 'Forest' ? 'wood' : 'world'} size={16}/>{terrainAt(battle.terrain, unit.x, unit.y).kind} · {unit.status === 'engaged' ? 'Engaging the enemy' : unit.status === 'moving' ? 'Moving' : unit.status === 'routed' ? 'Routing' : 'Holding position'}</div></> : <div className="command-empty"><Icon name="army" size={36}/><span>{Math.round(averageMorale)}% average morale</span></div>}
   <div className="command-actions"><button className={touchOrder === 'move' ? 'selected' : ''} disabled={!valid.length} onClick={() => setTouchOrder('move')}><Icon name="arrow" size={16}/>Move</button><button className={touchOrder === 'attack' ? 'selected' : ''} disabled={!valid.length || battle.phase !== 'combat'} onClick={() => setTouchOrder('attack')}><Icon name="army" size={16}/>Attack</button><button disabled={!valid.length} onClick={() => void issue({ kind: 'halt', ids: valid })}><Icon name="shield" size={16}/>Halt <kbd>H</kbd></button><button onClick={() => select(own.filter(f => f.status !== 'routed' && f.soldiers > 0).map(f => f.id))}>Select all <kbd>A</kbd></button></div>
   <label className="field-label">FORMATION STANCE</label><div className="stance-tabs">{(['guard', 'balanced', 'aggressive'] as const).map(stance => <button key={stance} className={unit?.stance === stance ? 'selected' : ''} disabled={!valid.length} onClick={() => void issue({ kind: 'stance', ids: valid, stance })}>{stance === 'balanced' ? 'Line' : stance === 'guard' ? 'Guard' : 'Attack'}</button>)}</div><p className="command-tip">{unit?.stance === 'guard' ? 'Hold position and brace against frontal cavalry charges.' : unit?.stance === 'aggressive' ? 'Strike harder. Your formation accepts greater losses.' : 'Keep a balanced line. Infantry protects your bowmen.'}</p>
   {battle.phase === 'deployment' ? <><label className="field-label">DEPLOYMENT PRESETS</label><div className="deployment-presets"><button disabled={ready || arranging} onClick={() => void arrange('balanced')}><Icon name="army" size={15}/>Battle line</button><button disabled={ready || arranging} onClick={() => void arrange('guard')}><Icon name="shield" size={15}/>Defensive line</button></div><p className="command-tip">Infantry forward, archers behind, cavalry on the wings. You can adjust every formation afterward.</p></> :
            <><label className="field-label" htmlFor="formation-width">FRONTAGE <b>{unit?.columns ?? 10} wide</b></label><input id="formation-width" type="range" min="4" max="20" value={unit?.columns ?? 10} disabled={!valid.length} onChange={e => void issue({ kind: 'width', ids: valid, columns: Number(e.target.value) })}/><div className="command-toggles"><label className="toggle-row"><input type="checkbox" checked={unit?.running ?? false} disabled={!valid.length} onChange={e => void issue({ kind: 'run', ids: valid, enabled: e.target.checked })}/><span>Run <small>Uses stamina</small></span></label><label className="toggle-row"><input type="checkbox" checked={unit?.fire_at_will ?? true} disabled={!valid.length} onChange={e => void issue({ kind: 'fire', ids: valid, enabled: e.target.checked })}/><span>Fire at will</span></label></div></>}
   <button className="button rally" disabled={rallied || battle.phase !== 'combat'} onClick={() => void run({ type: 'rally', battleId: battle.id }, 'The host regains its courage')}><Icon name="flag" size={16}/>{rallied ? 'The rally has been used' : 'Rally the host'}<kbd>R</kbd></button>
   {local && <div className="time-controls"><button onClick={pause}>{paused ? '▶ Resume' : 'Ⅱ Pause'}</button>{[1, 2, 3].map(n => <button key={n} className={speed === n ? 'selected' : ''} onClick={() => { engine.speed = n; setSpeed(n); }}>{n}×</button>)}</div>}
   <button className="withdraw-button" onClick={openWithdraw}>Withdraw from battle</button>
  <BattleSpellbook world={world} battle={battle} owner={engine.playerId} run={run}/></aside></section>
  <footer className="unit-tray"><div className="unit-tray-label"><Icon name="army"/><span>YOUR HOST<small>{total(own)} soldiers</small></span><div className="group-select">{(['infantry', 'archers', 'cavalry'] as const).map(t => <button key={t} title={`Select ${t}`} aria-label={`Select ${t}`} disabled={!own.some(f => f.unit_type === t && f.soldiers > 0 && f.status !== 'routed')} onClick={() => select(own.filter(f => f.unit_type === t && f.soldiers > 0 && f.status !== 'routed').map(f => f.id))}><Icon name={t === 'infantry' ? 'shield' : t === 'archers' ? 'bow' : 'horse'} size={15}/></button>)}</div></div><div className="unit-cards">{own.map((f, i) => <button key={f.id} title={`${f.label} · ${Math.round(f.morale)}% morale · ${f.kills} kills`} aria-label={`${f.label}, ${f.soldiers} soldiers`} className={`unit-card ${valid.includes(f.id) ? 'selected' : ''} ${f.status === 'routed' ? 'routed' : ''}`} disabled={f.soldiers <= 0 || f.status === 'routed'} onClick={e => select(e.shiftKey ? valid.includes(f.id) ? valid.filter(id => id !== f.id) : [...valid, f.id] : [f.id])}><span className="unit-hotkey">{i < 9 ? i + 1 : ''}</span><UnitPortrait type={f.unit_type}/><div className="unit-card-meta"><strong>{f.soldiers}</strong><span>{f.unit_type === 'infantry' ? 'Legionaries' : f.unit_type === 'archers' ? 'Archers' : 'Cavalry'}</span></div><div className="unit-morale"><i style={{ width: `${f.morale}%` }}/></div><small>{f.soldiers === 0 ? 'FALLEN' : f.status === 'routed' ? 'ROUTING' : f.charge_ready ? 'CHARGE READY' : f.stance === 'guard' ? 'GUARD' : f.status === 'engaged' ? 'IN COMBAT' : f.status === 'moving' ? 'MOVING' : 'HOLDING'}</small></button>)}</div></footer>
  {menu && <Modal title="The battle is yours to command" className="battle-menu" onClose={closeMenu}><span className="eyebrow">{local ? 'THE FIELD IS PAUSED' : 'LIVE DUEL · THE CLOCK CONTINUES'}</span><p>{battle.mode === 'pve' && battle.camp_id ? BRIEFINGS[battle.camp_id].tactic : 'Protect the bowmen. Hold your infantry line. Let cavalry find an opening.'}</p><button className="button gold" onClick={closeMenu}>Return to the field <Icon name="arrow"/></button><button className="settings-action" onClick={() => { closeMenu(); onHelp(); }}><Icon name="book"/><span>The General's Codex</span></button><button className="settings-action" onClick={() => { closeMenu(); onSettings(); }}><Icon name="settings"/><span>Settings</span></button><button className="button text" onClick={() => { setMenu(false); openWithdraw(); }}>Withdraw from battle</button></Modal>}
  {withdraw && <Modal title="Concede the field?" className="withdraw-modal" onClose={closeWithdraw}><p>{battle.mode === 'practice' ? 'This quick battle will end. Your campaign is unaffected.' : 'Your surviving soldiers will return to the keep. Troops already lost in this battle remain lost.'}</p><div className="modal-actions"><button className="button outline" onClick={closeWithdraw}>Keep fighting</button><button className="button gold" onClick={() => { setWithdraw(false); void run({ type: 'retreat', battleId: battle.id }); }}>Withdraw the host</button></div></Modal>}
 </main>;
}
