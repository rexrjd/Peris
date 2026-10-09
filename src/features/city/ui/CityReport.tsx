import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { World } from '../../../shared/model/world';
import { RESOURCES } from '../../../shared/model/resources';
import { Modal } from '../../../shared/ui/Shared';
import { Icon } from '../../../shared/ui/Icons';
import { cityOverview, duration, number, signed } from '../domain/overview';

export type CityReportTab = 'overview' | 'residents' | 'production';

export function CityReport({ world, sid, now, initialTab = 'overview', onSelect, onClose }: {
    world: World; sid: number; now: number; initialTab?: CityReportTab; onSelect: (key: string) => void; onClose: () => void;
}) {
    const [tab, setTab] = useState(initialTab), model = cityOverview(world, sid, now);
    const { town, population, capacity, staffing, jobs, growth, issues } = model;
    const nextSteps = issues.filter((issue, i) => issues.findIndex(other => other.target === issue.target) === i);
    const primary = issues[0], choose = (key: string) => { onClose(); onSelect(key); };
    const growthText = growth > 0 ? '+1 resident / minute' : growth < 0 ? '−1 resident / minute' : population >= capacity - .001 ? 'Growth paused · housing full' : town.food <= .001 ? 'Growth paused · no food' : 'Population stable';
    const dialog = <Modal title={`${town.name} · city report`} className="city-report" heading={false} onClose={onClose}>
        <header className="city-report-heading"><span>CITY REPORT</span><h2>{town.name}</h2><p>People, production, and room to grow.</p></header>
        <nav className="city-report-tabs" aria-label="City report sections">{([['overview', 'Overview'], ['residents', 'Residents'], ['production', 'Production']] as const).map(([id, title]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{title}</button>)}</nav>
        <div className="city-report-body">
            {tab === 'overview' && <>
                <section className={`city-health ${primary?.kind === 'food' ? 'needs-attention' : ''}`}><Icon name={primary ? 'shield' : 'check'} size={21}/><div><h3>{primary?.title ?? (growth > 0 ? 'Your city is growing' : 'Your city is stable')}</h3><p>{primary?.detail ?? 'Production sites are fully staffed. Keep developing the city at your own pace.'}</p></div></section>
                <div className="city-report-summary"><button onClick={() => setTab('residents')}><span>Residents</span><strong>{Math.floor(population).toLocaleString()}<small> / {capacity.toLocaleString()}</small></strong><em>{growthText}</em><Icon name="arrow" size={14}/></button><button onClick={() => setTab('production')}><span>Staffing</span><strong>{Math.round(staffing * 100)}<small>%</small></strong><em>{Math.min(Math.floor(population), jobs)} / {jobs} workers assigned</em><Icon name="arrow" size={14}/></button><button onClick={() => setTab('production')}><span>Food balance</span><strong className={town.food_rate < 0 ? 'negative' : ''}>{signed(town.food_rate)}<small> / min</small></strong><em>{number(town.food_gross_rate ?? 18)} produced − {number(town.food_upkeep ?? 0)} consumed</em><Icon name="arrow" size={14}/></button></div>
                <section className="city-report-next"><h3>{issues.length ? 'Next steps' : 'Develop the city'}</h3>{issues.length ? nextSteps.map(issue => <div key={issue.kind}><span><strong>{issue.title}</strong><small>{issue.detail}</small></span><button onClick={() => choose(issue.target)}>{issue.action}<Icon name="arrow" size={13}/></button></div>) : <div><span><strong>{model.freePlots ? `${model.freePlots} plots available` : 'All plots are occupied'}</strong><small>{model.freePlots ? 'Choose an empty plot to add a building.' : 'Manage the main building and your city’s development.'}</small></span><button onClick={() => choose(model.firstFreePlot !== undefined ? `slot:${model.firstFreePlot}` : 'market')}>{model.freePlots ? 'Choose a plot' : 'Main building'}<Icon name="arrow" size={13}/></button></div>}</section>
            </>}
            {tab === 'residents' && <>
                <section className="city-resident-total"><div><span>RESIDENTS / ROOM</span><strong>{Math.floor(population).toLocaleString()}<small> / {capacity.toLocaleString()}</small></strong><p>{growthText}</p></div><div className="city-resident-meter" role="img" aria-label={`${Math.round(population / Math.max(1, capacity) * 100)}% of housing occupied`} style={{ '--occupied': `${Math.max(0, Math.min(100, population / Math.max(1, capacity) * 100))}%` } as React.CSSProperties}><Icon name="people" size={28}/></div></section>
                <dl className="city-resident-facts"><div><dt>Free places</dt><dd>{Math.max(0, Math.floor(capacity - population))}</dd></div><div><dt>Housing buildings</dt><dd>{model.housing.filter(s => s.level > 0).length}</dd></div><div><dt>Available workers</dt><dd>{Math.max(0, Math.floor(population) - jobs)}</dd></div><div><dt>Food consumed / min</dt><dd>{number(town.food_upkeep ?? 0)}</dd></div></dl>
                <section className="city-report-note"><h3>Make room for more people</h3><p>Each housing level adds 30 places. Residents arrive while there is room and food. Each resident consumes 0.12 food per minute.</p><button className="city-report-action" onClick={() => choose(model.housingTarget)}>{model.housingAction}<Icon name="arrow" size={15}/></button></section>
                {town.food_rate < 0 && <section className="city-report-warning"><Icon name="food" size={18}/><span>{town.food > 0 ? `Food reserves last about ${duration(town.food / -town.food_rate)} at the current balance.` : 'Food reserves are empty.'}</span><button onClick={() => choose('farm')}>Improve farm<Icon name="arrow" size={12}/></button></section>}
            </>}
            {tab === 'production' && <>
                <div className="city-production-heading"><h3>Income &amp; storage</h3><span>Per minute · after resident upkeep</span></div>
                <div className="city-production-table-wrap"><table className="city-production-table"><thead><tr><th>Resource</th><th>Stored / capacity</th><th>Net income</th><th>Develop</th></tr></thead><tbody>{RESOURCES.map(resource => {
                    const limit = resource === 'food' ? town.food_capacity ?? town.capacity : town.capacity, stock = town[resource], income = town[`${resource}_rate`];
                    return <tr key={resource}><th scope="row"><Icon name={resource} size={17}/>{resource === 'wood' ? 'Timber' : resource[0].toUpperCase() + resource.slice(1)}</th><td><span>{Math.floor(stock).toLocaleString()} <small>/ {limit.toLocaleString()}</small></span><i className="city-storage-meter"><b style={{ width: `${Math.max(0, Math.min(100, stock / Math.max(1, limit) * 100))}%` }}/></i></td><td className={income < 0 ? 'negative' : ''}>{signed(income)}</td><td><button aria-label={`Develop ${resource === 'wood' ? 'timber yard' : resource === 'stone' ? 'quarry' : resource === 'food' ? 'farm' : 'main building'}`} onClick={() => choose(({ wood: 'lumber', stone: 'quarry', food: 'farm', gold: 'market' } as const)[resource])}><Icon name="arrow" size={15}/></button></td></tr>;
                })}</tbody></table></div>
                <section className="city-food-ledger"><span>FOOD BALANCE</span><div><span>Produced<strong>{number(town.food_gross_rate ?? 18)}</strong></span><span>Resident upkeep<strong>−{number(town.food_upkeep ?? 0)}</strong></span><span>Net / min<strong className={town.food_rate < 0 ? 'negative' : ''}>{signed(town.food_rate)}</strong></span></div></section>
                <section className="city-workforce-ledger"><div className="city-production-heading"><h3>Workers and production details</h3><span className={staffing < 1 ? 'negative' : ''}>{Math.round(staffing * 100)}% staffed</span></div><p>Workers are assigned automatically. Staffing scales building bonuses; basic gathering continues without workers.</p>{model.workforce.length ? <table><thead><tr><th>Production site</th><th>Assigned / needed</th></tr></thead><tbody>{model.workforce.map(row => <tr key={row.type}><td>{row.name}</td><td>{number(row.workers * staffing)} / {row.workers}</td></tr>)}</tbody></table> : <p>No production buildings need workers yet.</p>}</section>
            </>}
        </div>
        <footer className="city-report-footer"><span>{model.freePlots} free building {model.freePlots === 1 ? 'plot' : 'plots'} · Main building {model.main}</span><button onClick={onClose}>Back to city<Icon name="arrow" size={13}/></button></footer>
    </Modal>;
    return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
