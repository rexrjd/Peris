import { useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Modal, Cost } from '../../../shared/ui/Shared';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { liveResources, affordable } from '../../city/domain/economy';
import { mainLevel } from '../../city/domain/slots';
import { COLONY_COST, SETTLER_COST, MAX_CITIES, cultureCost, cultureRate, expansionCount, foundingReason, liveCulture } from '../domain/expansion';

export function EmpirePanel({ world, owner, cityId, onCity, onClose, run, now, busy, target }: {
    world: World; owner: string; cityId: number; onCity: (id: number) => void; onClose: () => void;
    run: (cmd: Command, message?: string) => void; now: number; busy: boolean; target?: { col: number; row: number };
}) {
    const cities = world.settlements.filter(s => s.owner_id === owner), city = cities.find(s => s.id === cityId) ?? cities[0];
    const [name, setName] = useState('New frontier'), [col, setCol] = useState(String(target?.col ?? Math.floor(city.x / 128) + 6)), [row, setRow] = useState(String(target?.row ?? Math.floor(city.y / 128)));
    const [quantity, setQuantity] = useState(3);
    const count = expansionCount(world, owner), points = liveCulture(world, owner, now), cost = cultureCost(count);
    const resources = liveResources(city, now), settlers = city.settlers ?? 0, level = mainLevel(world, city.id);
    const training = world.orders.find(o => o.kind === 'settler' && o.settlement_id === city.id);
    const reason = !col.trim() || !row.trim() ? 'Choose field coordinates.' : foundingReason(world, owner, Number(col), Number(row));
    const trainCost = { wood: SETTLER_COST.wood * quantity, stone: SETTLER_COST.stone * quantity, food: SETTLER_COST.food * quantity, gold: SETTLER_COST.gold * quantity };
    const expeditions = (world.settler_expeditions ?? []).filter(e => e.owner_id === owner && e.status === 'travelling');
    const travellingSettlers = expeditions.filter(e => e.origin_settlement_id === city.id).length * 3;
    return <Modal title="Your empire" className="empire-modal" onClose={onClose}>
        <div className="empire-summary"><div><span className="eyebrow">CITIES</span><strong>{cities.length}<small> / {MAX_CITIES}</small></strong></div><div><span className="eyebrow">CULTURE</span><strong>{Math.floor(points).toLocaleString()}<small> +{cultureRate(world, owner)}/min</small></strong></div><div><span className="eyebrow">NEXT CITY</span><strong>{cost.toLocaleString()}<small> culture</small></strong></div></div>
        <div className="progress-track"><i style={{ width: `${Math.min(100, points / cost * 100)}%` }}/></div>
        <p className="empire-intro">Every city’s buildings generate culture. Prepare three settlers, choose open land, and send them to establish a new city. Culture and supplies are committed when they leave.</p>
        <div className="empire-cities" aria-label="Your cities">{cities.map(s => <button key={s.id} aria-pressed={s.id === city.id} onClick={() => onCity(s.id)}><Icon name="town" size={20}/><span><strong>{s.name}</strong><small>{Math.floor(s.population ?? 30)} residents · {s.settlers ?? 0} settlers · X {Math.floor(s.x / 128)}, Y {Math.floor(s.y / 128)}</small></span><Icon name="arrow" size={14}/></button>)}</div>
        <div className="empire-expansion-grid"><section className="gameplay-card"><span className="eyebrow">PREPARE IN {city.name.toUpperCase()}</span><h3>Settlers</h3><p>{settlers} ready · three needed for a new city. Main building level 2 unlocks training.</p><label>Settlers to train<select aria-label="Settlers to train" value={quantity} onChange={event => setQuantity(Number(event.target.value))}>{[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}</select></label><Cost cost={trainCost} resources={resources}/><button className="button gold" disabled={busy || !!training || level < 2 || settlers + travellingSettlers + quantity > 6 || !affordable(resources, trainCost)} onClick={() => run({ type: 'trainSettlers', settlementId: city.id, quantity }, 'Settler training started')}>{training ? `Training · ${clock(Math.max(0, (Date.parse(training.finish_at) - now) / 1000))}` : level < 2 ? 'Main building level 2 required' : `Train ${quantity} settlers`}</button></section>
        <section className="gameplay-card"><span className="eyebrow">FOUND A CITY</span><h3>A new frontier</h3><form onSubmit={event => { event.preventDefault(); run({ type: 'foundCity', settlementId: city.id, col: Number(col), row: Number(row), name }, `${name.trim()} · settlers are on their way`); }}><label>City name<input value={name} minLength={2} maxLength={32} required onChange={event => setName(event.target.value)}/></label><div className="gameplay-coordinates"><label>X<input type="number" step={1} required value={col} onChange={event => setCol(event.target.value)}/></label><label>Y<input type="number" step={1} required value={row} onChange={event => setRow(event.target.value)}/></label></div><Cost cost={COLONY_COST} resources={resources}/><small className="gameplay-requirement">{reason ?? (count >= MAX_CITIES ? 'Your empire is at the city limit.' : settlers < 3 ? 'Train three settlers first.' : points < cost ? `${Math.ceil(cost - points).toLocaleString()} more culture needed.` : 'Site available. Settlers follow connected land.')}</small><button type="submit" className="button gold" disabled={busy || !!reason || count >= MAX_CITIES || settlers < 3 || points < cost || !affordable(resources, COLONY_COST) || name.trim().length < 2}>Send settlers <Icon name="arrow" size={15}/></button></form></section></div>
        {!!expeditions.length && <section className="empire-expeditions"><span className="eyebrow">SETTLERS ON THE ROAD</span>{expeditions.map(e => <div key={e.id}><Icon name="flag" size={18}/><span><strong>{e.name}</strong><small>X {e.col}, Y {e.row} · three settlers</small></span><b>{clock(Math.max(0, (Date.parse(e.arrival_at) - now) / 1000))}</b></div>)}</section>}
        {world.debug_enabled !== false && <details className="gameplay-debug"><summary>Expansion debug</summary><button className="button outline" disabled={busy} onClick={() => run({ type: 'debugCity', action: 'culture', value: 1000, settlementId: city.id }, 'Added 1,000 culture points')}>+1,000 culture</button><small>City settings still contain resource and building-level tools.</small></details>}
    </Modal>;
}
