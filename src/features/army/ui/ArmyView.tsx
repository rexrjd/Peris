import { HeroPanel } from '../../heroes/ui/HeroPanel';
import { useState } from 'react';
import { type World } from '../../../shared/model/world';
import { type Command } from '../../../shared/model/commands';
import { type UnitType } from '../domain/types';
import { affordable, liveResources } from '../../city/domain/economy';
import { dist } from '../../../shared/math/geometry';
import { armyPosition } from '../../map/domain/movement';
import { UNITS, UNIT_TYPES, soldierTotal } from '../domain/units';
import { Icon, UnitPortrait } from '../../../shared/ui/Icons';
import { multiply } from '../../../shared/model/resources';
import { Cost } from '../../../shared/ui/Shared';
import { clock } from '../../../shared/time/clock';
import { recruitSeconds } from '../domain/recruitment';
import { slotLevels, armyAttack } from '../../city/domain/slots';
export function ArmyView({ world, playerId, run, busy, now, cityId, armyId, onCity, onArmy }: {
    world: World;
    cityId?: number; armyId?: number; onCity?: (id:number)=>void; onArmy?: (id:number)=>void;
    playerId: string;
    run: (c: Command, message?: string) => void;
    busy: boolean;
    now: number;
}) {
    const [quantity, setQuantity] = useState<Record<UnitType, number>>({ infantry: 20, archers: 10, cavalry: 4 });
    const a = world.armies.find(a => a.owner_id === playerId && (armyId===undefined||a.id===armyId))!, s = world.settlements.find(s => s.owner_id === playerId && (cityId===undefined||s.id===cityId))!, res = liveResources(s, now), orders = world.orders.filter(o => o.kind === 'recruit' && o.owner_id === playerId && (o.army_id??world.armies[0].id)===a.id), home = a.status !== 'moving' && dist(armyPosition(a, now), { x: s.x + 40, y: s.y + 30 }) <= 90;
    return <section className="army-view"><div className="army-context-switch"><label>Army<select aria-label="Selected army" value={a.id} onChange={event=>onArmy?.(Number(event.target.value))}>{world.armies.filter(a=>a.owner_id===playerId).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Training city<select aria-label="Training city" value={s.id} onChange={event=>onCity?.(Number(event.target.value))}>{world.settlements.filter(s=>s.owner_id===playerId).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div><div className="view-heading"><div><span className="eyebrow">THE MILITARY</span><h1>{a.name}</h1><p>A disciplined line. Smithy bonus: +{Math.round((armyAttack(world,a.home_settlement_id)-1)*100)}% damage.</p></div><span className="tag">{soldierTotal(a)} / 1,000 soldiers</span></div>
 <HeroPanel world={world} owner={playerId} army={a} cityId={s.id} onArmy={onArmy} run={run} busy={busy} now={now}/>
 {!home && <div className="alert"><Icon name="flag"/>Bring this army to {s.name} to recruit using that city’s buildings and supplies.<button onClick={() => run({ type: 'move', x: s.x + 40, y: s.y + 30 }, 'The legion is returning home')}>March to city →</button></div>}
 <div className="recruitment-grid">{UNIT_TYPES.map(type => {
            const meta = UNITS[type], cost = multiply(meta.cost, quantity[type]), level = slotLevels(world,s.id,type === 'cavalry' ? 'stables' : 'barracks');
            return <article className="recruitment-card" key={type}><div className="recruitment-art"><UnitPortrait type={type}/><span>{a[type]}<small>IN YOUR HOST</small></span></div><div className="recruitment-body"><span className="eyebrow">{type === 'infantry' ? 'HEAVY INFANTRY' : type === 'archers' ? 'MISSILE INFANTRY' : 'SHOCK CAVALRY'}</span><h2>{meta.name}</h2><p>{meta.role}</p><div className="unit-facts"><span>Mobility <b>{type === 'cavalry' ? 'Fast' : type === 'infantry' ? 'Steady' : 'Moderate'}</b></span><span>Best used for <b>{type === 'archers' ? 'Covering fire' : type === 'cavalry' ? 'Flank charges' : 'Holding a line'}</b></span><span>Training <b>Lv. {level}</b></span></div><label className="field-label" htmlFor={`quantity-${type}`}>SOLDIERS TO TRAIN</label><div className="quantity-input"><button aria-label={`Fewer ${meta.name}`} onClick={() => setQuantity(q => ({ ...q, [type]: Math.max(1, q[type] - (type === 'cavalry' ? 2 : 5)) }))}>−</button><input id={`quantity-${type}`} type="number" min="1" max="200" value={quantity[type]} onChange={e => setQuantity(q => ({ ...q, [type]: Math.max(1, Math.min(200, Math.floor(Number(e.target.value) || 1))) }))}/><button aria-label={`More ${meta.name}`} onClick={() => setQuantity(q => ({ ...q, [type]: Math.min(200, q[type] + (type === 'cavalry' ? 2 : 5)) }))}>+</button></div><Cost cost={cost} resources={res}/><button className="button gold" disabled={busy || !level || !home || orders.length >= 3 || !affordable(res, cost) || soldierTotal(a) + orders.reduce((n, o) => n + o.quantity, 0) + quantity[type] > 1000} onClick={() => run({ type: 'recruit', item: type, quantity: quantity[type] }, `${quantity[type]} ${meta.name} added to training`)}>{!level ? `Build ${type==='cavalry'?'stables':'barracks'} first` : !home ? 'Return to the keep' : orders.length >= 3 ? 'Training queue full' : !affordable(res, cost) ? 'More supplies needed' : `Train ${quantity[type]}`} <small>{clock(recruitSeconds(type, quantity[type], level))}</small></button></div></article>;
        })}</div><div className="training-queue"><div><span className="eyebrow">TRAINING QUEUE</span><h3>{orders.length} of 3 slots occupied</h3></div>{orders.length === 0 ? <p className="muted">Your training grounds are ready. Raise more troops before challenging the eastern hosts.</p> : orders.map(o => <div className="training-order" key={o.id}><Icon name="army"/><div><strong>{o.quantity} {UNITS[o.item as UnitType].name}</strong><small>{now < Date.parse(o.started_at) ? 'Waiting for the previous batch' : `Training · ${clock((Date.parse(o.finish_at) - now) / 1000)} remaining`}</small></div><div className="progress-track"><i style={{ width: `${Math.min(100, Math.max(0, (now - Date.parse(o.started_at)) / (Date.parse(o.finish_at) - Date.parse(o.started_at)) * 100))}%` }}/></div></div>)}</div></section>;
}
