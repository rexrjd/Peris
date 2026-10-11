import type { World } from '../../../shared/model/world';
import type { Report } from './types';
import { reportCampId, reportEconomics, reportSide, resourceTotal, visibleReports } from './reportEconomics';

export type ReportFilter = 'all' | 'unread' | 'losses' | 'equipment';
export type ReportOutcome = 'victory' | 'defeat' | 'draw';
export type InboxQuery = { filter: ReportFilter; search: string; outcome: 'all' | ReportOutcome; order: 'newest' | 'oldest' };

export function inboxReceipt(world: World, report: Report, owner: string) {
    const camp = world.camps.find(row => row.id === reportCampId(world, report));
    const side = reportSide(world, report, owner);
    const outcome: ReportOutcome = world.battles.find(row => row.id === report.battle_id)?.winner_side === 'draw' ? 'draw' : report.won ? 'victory' : 'defeat';
    const economics = side ? reportEconomics(report.result, side) : null;
    return {
        camp, side, outcome, title: camp?.name ?? report.title,
        losses: side ? report.result[`${side}_losses`] : null,
        net: economics?.profit ? resourceTotal(economics.profit) : null,
        loot: resourceTotal(report.result.delivered ?? report.result.loot),
        equipment: report.result.hero_reward?.artifacts.length ?? 0,
        experience: report.result.hero_reward?.experience ?? 0,
    };
}

/** Filters never infer the owner's side when an old PvP battle has been pruned. */
export function filterInbox(world: World, owner: string, query: InboxQuery): Report[] {
    const search = query.search.trim().toLocaleLowerCase();
    return visibleReports(world, owner).filter(report => {
        const receipt = inboxReceipt(world, report, owner);
        if (query.filter === 'unread' && report.read_at) return false;
        if (query.filter === 'losses' && !(receipt.losses !== null && receipt.losses > 0)) return false;
        if (query.filter === 'equipment' && receipt.equipment === 0) return false;
        if (query.outcome !== 'all' && receipt.outcome !== query.outcome) return false;
        return !search || [report.title, receipt.title, report.result.hero_reward?.hero_name ?? ''].some(value => value.toLocaleLowerCase().includes(search));
    }).sort((a, b) => (Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id) * (query.order === 'oldest' ? -1 : 1));
}
