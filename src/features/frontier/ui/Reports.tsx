import { UNIT_TYPES } from '../../army/domain/units';
import { Icon } from '../../../shared/ui/Icons';
import type { Raid, Troops } from '../domain/types';
import { number, remaining, totalResources, totalTroops, unitLabels } from './format';
import { Resources } from './Resources';

export function TroopSummary({ troops }: { troops: Troops }) {
    return <span className="fw-troop-summary">{UNIT_TYPES.map(unit => <span key={unit}>{number(troops[unit])} {unitLabels[unit].toLowerCase()}</span>)}</span>;
}

export function Marches({ raids, now }: { raids: Raid[]; now: number }) {
    return <section className="fw-panel" aria-labelledby="fw-marches-title">
        <div className="fw-section-heading"><div><span className="fw-eyebrow">03 / Out and home again</span><h2 id="fw-marches-title">Army movements <span className="fw-count">{raids.length}</span></h2></div><Icon name="transfer" size={25} /></div>
        {raids.length === 0 ? <p className="fw-empty">Your roads are quiet. Choose a camp to send your first raid.</p> : <div className="fw-marches">{raids.map(raid => {
            const returning = raid.status === 'returning';
            const start = returning ? raid.arrivesAt : raid.departedAt;
            const end = returning ? raid.returnsAt : raid.arrivesAt;
            const progress = Math.max(0, Math.min(100, (now - start) / Math.max(1, end - start) * 100));
            return <article key={raid.id} className="fw-march">
                <div className="fw-row"><strong>{raid.campName}</strong><span className={`fw-tag ${returning ? 'fw-tag-home' : ''}`}>{returning ? 'Returning' : 'Outbound'}</span></div>
                <TroopSummary troops={returning ? raid.survivors : raid.troops} />
                <div className="fw-progress" role="progressbar" aria-label={`${raid.campName} ${returning ? 'return journey' : 'outbound journey'}`} aria-valuenow={Math.floor(progress)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div>
                <div className="fw-row fw-muted"><span>{returning ? 'Home in' : 'Arrival in'}</span><time>{remaining(end, now)}</time></div>
                {returning && raid.report && <div className="fw-march-loot"><span>Carrying home</span><Resources values={raid.report.loot} /><small>{number(totalTroops(raid.report.losses))} troops lost · report ready on return</small></div>}
            </article>;
        })}</div>}
    </section>;
}

export function Reports({ reports, total }: { reports: Raid[]; total: number }) {
    const groups = new Map<string, Raid[]>();
    for (const raid of reports) groups.set(raid.campId, [...(groups.get(raid.campId) ?? []), raid]);
    return <section className="fw-panel" aria-labelledby="fw-reports-title">
        <div className="fw-section-heading"><div><span className="fw-eyebrow">The campaign ledger</span><h2 id="fw-reports-title">Raid reports <span className="fw-count">{number(total)}</span></h2></div><Icon name="report" size={25} /></div>
        <p className="fw-muted">Completed raids are grouped by camp. Profit is delivered resources minus troop replacement cost; it excludes travel and training time.</p>
        {reports.length === 0 ? <p className="fw-empty">Reports will arrive when your raids return home.</p> : <div className="fw-report-groups">{[...groups.entries()].map(([campId, raids]) => {
            const loot = raids.reduce((sum, raid) => sum + (raid.report ? totalResources(raid.report.delivered ?? raid.report.loot) : 0), 0);
            const losses = raids.reduce((sum, raid) => sum + (raid.report ? totalTroops(raid.report.losses) : 0), 0);
            return <details className="fw-report-group" key={campId}>
                <summary><span><strong>{raids[0].campName}</strong><small>{raids.length} completed {raids.length === 1 ? 'raid' : 'raids'}</small></span><span className="fw-report-total">{number(loot)} delivered<small>{number(losses)} troops lost</small></span></summary>
                {raids.map(raid => raid.report && <article className="fw-report" key={raid.id}>
                    <div className="fw-row"><strong>{raid.report.winner === 'attacker' ? 'Camp defeated' : raid.report.winner === 'defender' ? 'Raid repelled' : 'Battle drawn'}</strong><time dateTime={new Date(raid.returnsAt).toISOString()}>{new Date(raid.returnsAt).toLocaleString()}</time></div>
                    <p className="fw-muted">{raid.report.reason}</p>
                    <dl className="fw-report-ledger">
                        <div><dt>Loot taken</dt><dd><Resources values={raid.report.loot} /></dd></div>
                        <div><dt>Delivered home</dt><dd><Resources values={raid.report.delivered ?? raid.report.loot} /></dd></div>
                        <div><dt>Your losses</dt><dd><TroopSummary troops={raid.report.losses} /></dd></div>
                        <div><dt>Defender losses</dt><dd><TroopSummary troops={raid.report.defenderLosses} /></dd></div>
                        <div><dt>Replacement cost</dt><dd><Resources values={raid.report.replacementCost} /></dd></div>
                        <div className="fw-profit"><dt>Estimated profit</dt><dd><Resources values={raid.report.estimatedProfit} signed /></dd></div>
                    </dl>
                    {raid.report.overflow && totalResources(raid.report.overflow) > 0 && <p className="fw-warm">Storage overflow: <Resources values={raid.report.overflow} /> could not be stored.</p>}
                </article>)}
            </details>;
        })}</div>}
        {total > reports.length && <p className="fw-muted">Showing the latest {reports.length} of {number(total)} reports.</p>}
    </section>;
}
