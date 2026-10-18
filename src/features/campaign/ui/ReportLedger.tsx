import { useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Report } from '../domain/types';
import { groupReports, reportCampId, reportIsReturning, reportSide, visibleReports } from '../domain/reportEconomics';
import { Cost } from '../../../shared/ui/Shared';
import { Icon } from '../../../shared/ui/Icons';
import { ReportEconomics } from './ReportEconomics';
import '../styles/report-ledger.css';

export function ReportLedger({ world, playerId, onOpen, onLocateCamp, filterable = false }: {
    world: World; playerId: string; onOpen: (report: Report) => void; onLocateCamp?: (camp: World['camps'][number]) => void;
    filterable?: boolean;
}) {
    const [campKey, setCampKey] = useState('all');
    const reports = visibleReports(world, playerId), groups = groupReports(world, reports);
    const selectedKey = groups.some(group => group.key === campKey) ? campKey : 'all';
    const shownGroups = filterable && selectedKey !== 'all' ? groups.filter(group => group.key === selectedKey) : groups;
    const total = Math.max(reports.length, world.report_count ?? reports.length);
    const hidden = world.hidden_report_count ?? world.reports.filter(report => report.owner_id === playerId).length - reports.length;
    const notes = <><p className="report-ledger-note">Grouped by camp. Net resources use actual home delivery after storage overflow, minus troop replacement cost.</p><p className="report-ledger-note">Showing {reports.length} of {total} visible reports.{hidden > 0 && ` ${hidden} quiet ${hidden === 1 ? 'report is' : 'reports are'} hidden by losses-only preferences.`}</p></>;
    return <div className="report-ledger" aria-label="Battle report ledger">
        {!filterable && notes}
        {filterable && reports.length > 0 && <div className="report-ledger-toolbar"><label><select aria-label="Filter reports by camp" value={selectedKey} onChange={event => setCampKey(event.target.value)}><option value="all">All camps</option>{groups.map(group => <option key={group.key} value={group.key}>{group.title}</option>)}</select></label><span>{shownGroups.reduce((sum, group) => sum + group.reports.length, 0)} reports</span></div>}
        {!reports.length && <div className="report-ledger-empty"><Icon name="report" size={30}/><h3>No visible reports</h3><p>Completed battles appear here with losses and earned resources.</p></div>}
        {shownGroups.map(group => {
            const camp = world.camps.find(row => row.id === group.campId);
            return <section className="report-ledger-group" key={group.key} aria-label={`Reports: ${group.title}`}>
                <header><h3>{group.title}</h3><span>{group.reports.length} {group.reports.length === 1 ? 'report' : 'reports'}</span>{camp && onLocateCamp && <button className="report-ledger-locate" title="Center the world map on this camp" onClick={() => onLocateCamp(camp)}><Icon name="focus" size={14}/>Locate</button>}</header>
                {group.reports.map(report => {
                    const side = reportSide(world, report, playerId), battle = world.battles.find(row => row.id === report.battle_id), returning = reportIsReturning(world, report);
                    const accounting = side === 'attacker' && reportCampId(world, report) !== undefined ? <div className="report-ledger-accounting"><div className="report-ledger-delivery"><span>{report.result.delivered ? 'Delivered home' : returning ? 'Returning spoils' : 'Recorded spoils'}</span><Cost cost={report.result.delivered ?? report.result.loot} compact showZero/></div><ReportEconomics result={report.result} side={side} returning={returning} compact/></div> : null;
                    return <article key={report.id} className={!report.read_at ? 'is-unread' : undefined}>
                        <button className="report-ledger-open" title="Open the complete saved battle receipt" onClick={() => onOpen(report)}>
                            <span className={`report-ledger-seal ${report.won ? 'won' : ''}`}><Icon name={report.won ? 'check' : 'shield'} size={19}/></span>
                            <div><strong>{report.title}{!report.read_at && <i className="report-unread-dot" aria-label="Unread report"/>}</strong><small>{new Date(report.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></div>
                            <span><b>{battle?.winner_side === 'draw' ? 'Stalemate' : report.won ? 'Victory' : 'No victory'}</b><small>{side ? `${report.result[`${side}_losses`]} lost` : `${report.result.attacker_losses} attacking · ${report.result.defender_losses} defending lost`}</small></span><Icon name="arrow" size={15}/>
                        </button>
                        {!filterable && accounting}
                    </article>;
                })}
            </section>;
        })}
        {filterable && notes}
    </div>;
}
