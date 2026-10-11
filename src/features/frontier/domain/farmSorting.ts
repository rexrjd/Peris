import type { CampView, FarmStats, FarmTarget } from './types';

export const FARM_SORTS = { name: 'Target name', distance: 'Distance', result: 'Combat result', lastRaid: 'Last raid', loot: 'Last loot', totalLoot: 'Total loot', nextRaid: 'Next raid' } as const;
export type FarmSort = keyof typeof FARM_SORTS;
/** Missing results and paused schedules stay last in either direction. Stable tie-breaks avoid jumping rows. */
export function sortFarms(farms: FarmTarget[], camps: CampView[], stats: FarmStats[], by: FarmSort, descending: boolean): FarmTarget[] {
    const targets = new Map(camps.map(camp => [camp.id, camp]));
    const results = new Map(stats.map(result => [result.campId, result]));
    const value = (farm: FarmTarget): string | number | null => {
        const camp = targets.get(farm.campId), stat = results.get(farm.campId);
        switch (by) {
            case 'name': return camp?.name ?? farm.campId;
            case 'distance': return camp?.distance ?? null;
            case 'nextRaid': return farm.enabled ? farm.nextRunAt : null;
            case 'lastRaid': return stat?.lastRaidAt ?? null;
            case 'loot': return stat?.lastLoot ?? null;
            case 'totalLoot': return stat?.totalLoot ?? null;
            case 'result': return !stat ? null : stat.result === 'defender' ? 0 : stat.result === 'draw' ? 1 : stat.losses > 0 ? 2 : 3;
        }
    };
    return [...farms].sort((a, b) => {
        const av = value(a), bv = value(b);
        if (av === null || bv === null) return av === bv ? a.id.localeCompare(b.id) : av === null ? 1 : -1;
        const order = typeof av === 'string' ? av.localeCompare(String(bv), undefined, { numeric: true }) : av - Number(bv);
        return order * (descending ? -1 : 1) || a.id.localeCompare(b.id);
    });
}
