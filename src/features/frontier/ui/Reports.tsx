import { useState } from 'react';
import { FRONTIER_UNIT_TYPES as UNIT_TYPES } from '../domain/units';
import type { Faction } from '../../factions/domain/factions';
import { Icon } from '../../../shared/ui/Icons';
import type { FrontierRun, Raid, Troops } from '../domain/types';
import { number, remaining, totalResources, totalTroops, unitLabels } from './format';
import { Resources } from './Resources';
import { factionTroopName } from './roster';
import { TroopIcon } from './TroopIcon';

export function TroopSummary({ troops, faction }: { troops: Troops; faction?: Faction }) {
    const visible = UNIT_TYPES.filter(unit => (troops[unit] ?? 0) > 0);
    return <span className="fw-troop-summary">{visible.length ? visible.map(unit => <span key={unit}>{faction && <TroopIcon faction={faction} unit={unit} />}{number(troops[unit] ?? 0)} {faction ? `× ${factionTroopName(faction, unit)}` : unitLabels[unit].toLowerCase()}</span>) : <span>None</span>}</span>;
}

export function Marches({ raids, now, faction, locked, run }: { raids: Raid[]; now: number; faction: Faction; locked: boolean; run: FrontierRun }) {
    const [filter, setFilter] = useState<'all' | 'outbound' | 'returning'>('all');
    const visible = raids.filter(raid => filter === 'all' || raid.status === filter);
    return <section className="fw-panel" aria-labelledby="fw-marches-title">
        <div className="fw-section-heading"><div><span className="fw-eyebrow">03 / Out and home again</span><h2 id="fw-marches-title" tabIndex={-1}>Army movements <span className="fw-count">{raids.length}</span></h2></div><Icon name="transfer" size={25} /></div>
        <div className="fw-filters" aria-label="Army movement direction">{(['all', 'outbound', 'returning'] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All movements' : value} <span>{raids.filter(raid => value === 'all' || raid.status === value).length}</span></button>)}</div>
        {visible.length === 0 ? <p className="fw-empty">{raids.length === 0 ? 'Your roads are quiet. Choose a camp to send your first raid.' : `No ${filter} raids right now.`}</p> : <div className="fw-marches">{visible.map(raid => {
            const returning = raid.status === 'returning';
            const preparing = !returning && now < raid.departedAt;
            const cancellable = raid.status === 'outbound' && raid.cancelUntil !== undefined && now < raid.cancelUntil;
            const start = returning ? raid.arrivesAt : raid.departedAt;
            const end = returning ? raid.returnsAt : raid.arrivesAt;
            const progress = Math.max(0, Math.min(100, (now - start) / Math.max(1, end - start) * 100));
            return <article key={raid.id} className={`fw-march ${preparing ? 'fw-march-preparing' : ''}`}>
                <div className="fw-row"><strong>{raid.campName}</strong><span className={`fw-tag ${returning ? 'fw-tag-home' : preparing ? 'fw-tag-preparing' : ''}`}>{returning ? 'Returning' : preparing ? 'Preparing' : 'Outbound'}</span></div>
                <TroopSummary troops={returning ? raid.survivors : raid.troops} faction={faction} />
                {preparing && <p className="fw-small-note" title="These troops are reserved for this raid and cannot be recruited into another party. Cancel before the deadline to make them available again.">Troops reserved · departs in {remaining(raid.departedAt, now)}</p>}
                <div className="fw-progress" role="progressbar" aria-label={`${raid.campName} ${returning ? 'return journey' : 'outbound journey'}`} aria-valuenow={Math.floor(progress)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div>
                <div className="fw-row fw-muted"><span>{returning ? 'Home in' : 'Arrival in'}</span><time>{remaining(end, now)}</time></div>
                <div className="fw-row fw-muted"><span>{returning ? 'Home at' : 'Arrives at'}</span><time dateTime={new Date(end).toISOString()}>{new Date(end).toLocaleTimeString()}</time></div>
                {cancellable && <div className="fw-cancel-raid"><button className="fw-button fw-button-secondary" disabled={locked} title="Cancel this raid before its thirty-second deadline and restore its reserved troops. A farm target will keep its repeat schedule." onClick={() => void run({ type: 'cancelRaid', id: raid.id }, `Raid to ${raid.campName} canceled. Troops are available at home.`)}>Cancel raid</button><span title={`Cancellation closes at ${new Date(raid.cancelUntil!).toLocaleTimeString()}. The server checks this original deadline.`}>Cancel within <time>{remaining(raid.cancelUntil!, now)}</time></span></div>}
                {!returning && !cancellable && raid.cancelUntil !== undefined && <p className="fw-small-note">Cancellation window closed.</p>}
                {returning && raid.report && <div className="fw-march-loot"><span>Carrying home</span><Resources values={raid.report.loot} /><small>{number(totalResources(raid.report.loot))} / {number(raid.report.capacity)} capacity · {number(totalTroops(raid.report.losses))} troops lost · report saved on return</small></div>}
            </article>;
        })}</div>}
    </section>;
}

export function Reports({ reports, total, hidden, faction }: { reports: Raid[]; total: number; hidden: number; faction: Faction }) {
    const groups = new Map<string, Raid[]>();
    for (const raid of reports) groups.set(raid.campId, [...(groups.get(raid.campId) ?? []), raid]);
    return <section className="fw-panel" aria-labelledby="fw-reports-title">
        <div className="fw-section-heading"><div><span className="fw-eyebrow">The campaign ledger</span><h2 id="fw-reports-title" tabIndex={-1}>Raid reports <span className="fw-count">{number(total)}</span></h2></div><Icon name="report" size={25} /></div>
        <p className="fw-muted">Completed raids are grouped by camp. Profit is delivered resources minus troop replacement cost; it excludes travel and training time.</p>
        {hidden > 0 && <p className="fw-muted">{number(hidden)} casualty-free {hidden === 1 ? 'report hidden' : 'reports hidden'} by farm preferences. <a href="#fw-farms-title">Change report preferences</a></p>}
        {reports.length === 0 ? <p className="fw-empty">{hidden > 0 ? 'No completed raids match your report preferences.' : 'Reports will arrive when your raids return home.'}</p> : <div className="fw-report-groups">{[...groups.entries()].map(([campId, raids]) => {
            const loot = raids.reduce((sum, raid) => sum + (raid.report ? totalResources(raid.report.delivered ?? raid.report.loot) : 0), 0);
            const losses = raids.reduce((sum, raid) => sum + (raid.report ? totalTroops(raid.report.losses) : 0), 0);
            return <details className="fw-report-group" key={campId}>
                <summary><span><strong>{raids[0].campName}</strong><small>{raids.length} completed {raids.length === 1 ? 'raid' : 'raids'}</small></span><span className="fw-report-total">{number(loot)} delivered<small>{number(losses)} troops lost</small></span></summary>
                {raids.map(raid => raid.report && <details className="fw-report" key={raid.id}>
                    <summary><span><Icon name={totalTroops(raid.report.losses) > 0 ? 'shield' : 'check'} size={16} /> {raid.report.winner === 'attacker' ? 'Victory' : raid.report.winner === 'defender' ? 'Defeat' : 'Draw'} · {number(totalTroops(raid.report.losses))} lost</span><span>{number(totalResources(raid.report.delivered ?? raid.report.loot))} loot · {new Date(raid.returnsAt).toLocaleTimeString()}</span></summary>
                    <div className="fw-row"><strong>{raid.report.winner === 'attacker' ? 'Camp defeated' : raid.report.winner === 'defender' ? 'Raid repelled' : 'Battle drawn'}</strong><time dateTime={new Date(raid.returnsAt).toISOString()}>{new Date(raid.returnsAt).toLocaleString()}</time></div>
                    <p className="fw-muted">{raid.report.reason}</p>
                    <dl className="fw-report-ledger">
                        <div><dt>Loot taken</dt><dd><Resources values={raid.report.loot} /></dd></div>
                        <div><dt>Delivered home</dt><dd><Resources values={raid.report.delivered ?? raid.report.loot} /></dd></div>
                        <div><dt>Troops sent</dt><dd><TroopSummary troops={raid.troops} faction={faction} /></dd></div>
                        <div><dt>Survivors returned</dt><dd><TroopSummary troops={raid.survivors} faction={faction} /></dd></div>
                        <div><dt>Your losses</dt><dd><TroopSummary troops={raid.report.losses} faction={faction} /></dd></div>
                        <div><dt>Defender losses</dt><dd><TroopSummary troops={raid.report.defenderLosses} faction={raid.campFaction} /></dd></div>
                        <div><dt>Replacement cost</dt><dd><Resources values={raid.report.replacementCost} /></dd></div>
                        <div className="fw-profit"><dt>Estimated profit</dt><dd><Resources values={raid.report.estimatedProfit} signed /></dd></div>
                    </dl>
                    {raid.report.overflow && totalResources(raid.report.overflow) > 0 && <p className="fw-warm">Storage overflow: <Resources values={raid.report.overflow} /> could not be stored.</p>}
                </details>)}
            </details>;
        })}</div>}
        {total > reports.length && <p className="fw-muted">Showing the latest {reports.length} of {number(total)} reports.</p>}
    </section>;
}
