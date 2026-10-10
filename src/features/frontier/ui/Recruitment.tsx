import { useState } from 'react';
import { UNIT_TYPES, UNITS } from '../../army/domain/units';
import { recruitSeconds } from '../../army/domain/recruitment';
import { RESOURCES, multiply } from '../../../shared/model/resources';
import { Icon } from '../../../shared/ui/Icons';
import type { FrontierCommand, FrontierSnapshot } from '../domain/types';
import { duration, number, remaining, unitIcons, unitLabels } from './format';
import { Resources } from './Resources';

export function Recruitment({ state, now, locked, run }: {
    state: FrontierSnapshot; now: number; locked: boolean;
    run: (command: FrontierCommand, message: string) => void;
}) {
    const [counts, setCounts] = useState({ infantry: 10, archers: 10, cavalry: 5 });
    return <section className="fw-panel" aria-labelledby="fw-recruit-title">
        <div className="fw-section-heading"><div><span className="fw-eyebrow">01 / Prepare your army</span><h2 id="fw-recruit-title">Village garrison</h2></div><Icon name="shield" size={26} /></div>
        <p className="fw-muted">Recruit with village resources. Troops return to this garrison after a raid.</p>
        <div className="fw-recruit-grid">{UNIT_TYPES.map(unit => {
            const count = counts[unit], cost = multiply(UNITS[unit].cost, count);
            const affordable = RESOURCES.every(key => cost[key] <= state.village.resources[key]);
            return <article className="fw-unit" key={unit}>
                <div className={`fw-unit-art fw-unit-art-${unit}`} style={{ backgroundImage: `url(/art/battle/roster/${state.village.faction}.png)` }} aria-hidden="true" />
                <div className="fw-unit-heading"><h3><Icon name={unitIcons[unit]} size={17} />{unitLabels[unit]}</h3><strong>{number(state.village.troops[unit])}<small>ready</small></strong></div>
                <p className="fw-unit-role">{unit === 'infantry' ? 'Hold the line' : unit === 'archers' ? 'Ranged support' : 'Fast and high capacity'} · {state.config.carrying[unit]} carry each</p>
                <label className="fw-label">Number to recruit<input type="number" min={1} max={1000} step={1} value={count} onChange={event => setCounts(previous => ({ ...previous, [unit]: Number(event.target.value) }))} /></label>
                <div className="fw-cost"><span>Total cost</span><Resources values={cost} /></div>
                <button className="fw-button fw-button-secondary" disabled={locked || !Number.isInteger(count) || count < 1 || count > 1000 || !affordable} onClick={() => run({ type: 'recruit', unit, count }, `${count} ${unitLabels[unit].toLowerCase()} added to training.`)}>Recruit · {duration(recruitSeconds(unit, Math.max(1, count), 1) * 1000)}</button>
                {!affordable && <small className="fw-warm">More resources needed</small>}
            </article>;
        })}</div>
        {state.training.length > 0 && <div className="fw-training"><h3>Training queue <span>{state.training.length}</span></h3><p className="fw-muted">Orders train one after another.</p><ul>{state.training.map((order, index) => <li key={order.id}><span><Icon name={unitIcons[order.unit]} size={16} />{number(order.count)} {unitLabels[order.unit].toLowerCase()} {index > 0 && <small>· queued</small>}</span><time>{remaining(order.completesAt, now)}</time></li>)}</ul></div>}
    </section>;
}
