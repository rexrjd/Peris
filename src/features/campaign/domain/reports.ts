import type { World } from '../../../shared/model/world';

import { visibleReports } from './reportEconomics';

export const reportHistory = visibleReports;

export function unreadReportCount(world: World, owner: string, includeHistorical = false) {
    return includeHistorical && world.unread_report_count !== undefined ? world.unread_report_count : reportHistory(world, owner).filter(report => !report.read_at).length;
}

export function markAllReportsRead(world: World, owner: string, now: string) {
    for (const report of world.reports) if (report.owner_id === owner) report.read_at ??= now;
    if (world.unread_report_count !== undefined) world.unread_report_count = 0;
}

export function markReportsRead(world: World, owner: string, ids: number[], now: string) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => !Number.isSafeInteger(id) || id <= 0))
        throw new Error('Choose valid reports.');
    const reports = ids.map(id => world.reports.find(report => report.id === id && report.owner_id === owner));
    if (reports.some(report => !report)) throw new Error('These reports are not available to this ruler.');
    for (const report of reports) report!.read_at ??= now;
    if (world.unread_report_count !== undefined) world.unread_report_count = reportHistory(world, owner).filter(report => !report.read_at).length;
}
