import { RESOURCES } from '../../../shared/model/resources';
import { Icon } from '../../../shared/ui/Icons';
import { FRONTIER_UNITS, FRONTIER_UNIT_TYPES } from '../domain/units';
import type { FrontierSnapshot } from '../domain/types';
import { number, remaining, totalTroops } from './format';
import { TroopIcon } from './TroopIcon';
import { factionTroopName } from './roster';
import { Help } from './Help';

export function VillageOverview({ state, now, onRecruit }: { state: FrontierSnapshot; now: number; onRecruit: (building: 'barracks' | 'stables' | 'workshop') => void }) {
    const outbound = state.raids.filter(raid => raid.status === 'outbound');
    const returning = state.raids.filter(raid => raid.status === 'returning');
    const present = FRONTIER_UNIT_TYPES.filter(unit => (state.village.troops[unit] ?? 0) > 0);
    return <section className="fw-village-overview" aria-label="Village overview">
        <article className="fw-overview-card"><h3>Army movements <Help text="Outgoing troops are reserved while preparing or travelling. Orders can be cancelled during their first 30 seconds. Returning survivors become available, and deliver loot, only when they reach home. These are your own armies, not incoming enemy attacks." /></h3>
            <a href="#fw-marches-title" className="fw-movement-overview" title="Open preparing raids, cancellation windows and exact arrival times"><Icon name="attack" size={19} /><span><strong>{outbound.length} outgoing raids</strong><small>{number(outbound.reduce((sum, raid) => sum + totalTroops(raid.troops), 0))} troops reserved or travelling</small></span><time>{outbound.length ? 'Next ' + remaining(Math.min(...outbound.map(raid => raid.arrivesAt)), now) : '—'}</time></a>
            <a href="#fw-marches-title" className="fw-movement-overview" title="Open returning armies and the resources they carry"><Icon name="transfer" size={19} /><span><strong>{returning.length} returning armies</strong><small>{number(returning.reduce((sum, raid) => sum + totalTroops(raid.survivors), 0))} survivors coming home</small></span><time>{returning.length ? 'Next ' + remaining(Math.min(...returning.map(raid => raid.returnsAt)), now) : '—'}</time></a>
            <p className="fw-small-note">Your returning armies are shown separately from outgoing raids.</p>
        </article>
        <article className="fw-overview-card"><h3>Production per hour <Help text="Hourly rates are 60 times the server’s per-minute production. Storage stops increasing at capacity. Loot is separate from production and is credited when a raid returns. Timers continue while the local server runs." /></h3>
            <dl className="fw-production-overview">{RESOURCES.map(key => {
                const space = Math.max(0, state.config.villageCapacity[key] - state.village.resources[key]);
                const rate = state.config.villageRates[key];
                const detail = space === 0 ? 'Storage full' : rate > 0 ? 'Full in ' + remaining(now + space / rate * 60_000, now) + ' at current production' : 'No passive production';
                return <div key={key} title={number(state.village.resources[key]) + ' / ' + number(state.config.villageCapacity[key]) + ' stored. ' + detail + '. Returning loot can fill storage sooner.'}><dt><Icon name={key} size={16} />{key}</dt><dd><strong>+{number(rate * 60)}</strong><small>{detail}</small></dd></div>;
            })}</dl>
        </article>
        <article className="fw-overview-card"><h3>Troops at home <span className="fw-count">{number(totalTroops(state.village.troops))}</span> <Help text="Only troops currently in your village are available to send. This excludes troops still training or travelling. Select a troop row to open its recruitment building; hover its icon for carrying capacity and recruitment costs." /></h3>
            {present.length ? <ul className="fw-garrison-overview">{present.map(unit => <li key={unit}><button onClick={() => onRecruit(FRONTIER_UNITS[unit].building)} title={'Recruit more ' + factionTroopName(state.village.faction, unit) + ' at the ' + FRONTIER_UNITS[unit].building}><TroopIcon faction={state.village.faction} unit={unit} /><strong>{number(state.village.troops[unit] ?? 0)}</strong><span>{factionTroopName(state.village.faction, unit)}</span></button></li>)}</ul> : <p className="fw-empty">No troops at home. Recruit an army below.</p>}
            <p className="fw-small-note">{number(state.training.reduce((sum, order) => sum + order.count, 0))} in training · Select a unit to open its building.</p>
        </article>
    </section>;
}
