import type { World } from '../../../shared/model/world';
import type { Resources } from '../../../shared/model/resources';
import type { Army } from '../../army/domain/types';
import type { CampaignFarmStats, CampaignFarmTarget, Report } from './types';
import { armyPosition } from '../../map/domain/movement';
import { wrappedWorldDelta } from '../../map/domain/dimensions';

const total = (resources: Resources) => Object.values(resources).reduce((sum, amount) => sum + Math.max(0, amount), 0);
function receipt(world: World, report: Report, delivered: Resources, at: string): CampaignFarmStats {
    const battle = world.battles.find(b => b.id === report.battle_id);
    return { owner_id: report.owner_id, camp_id: (report.camp_id ?? battle?.camp_id)!, raids: 1, last_raid_at: at,
        last_loot: total(delivered), total_loot: total(delivered), last_result: battle?.winner_side ?? (report.won ? 'attacker' : 'defender'), last_losses: report.result.attacker_losses };
}
function add(stats: CampaignFarmStats[], row: CampaignFarmStats) {
    const prior = stats.find(s => s.owner_id === row.owner_id && s.camp_id === row.camp_id);
    if (!prior) { stats.push(row); return; }
    const raids = prior.raids + row.raids, totalLoot = prior.total_loot + row.total_loot;
    if (Date.parse(row.last_raid_at) >= Date.parse(prior.last_raid_at)) Object.assign(prior, row);
    prior.raids = raids; prior.total_loot = totalLoot;
}
/** Legacy solo saves seed only completed deliveries; server snapshots supply their own all-time aggregate. */
export function ensureCampaignFarmStats(world: World, excludeBattleId?: number) {
    if (world.campaign_farm_stats !== undefined) return world.campaign_farm_stats;
    const stats: CampaignFarmStats[] = [], seen = new Set<string>();
    for (const report of world.reports) {
        const campId = report.camp_id ?? world.battles.find(b => b.id === report.battle_id)?.camp_id, key = `${report.owner_id}:${report.battle_id}`;
        if (report.battle_id === excludeBattleId || !report.result.delivered || seen.has(key) || !world.camps.some(c => c.id === campId && c.bandit)) continue;
        seen.add(key); add(stats, receipt(world, report, report.result.delivered, report.result.delivered_at ?? report.created_at));
    }
    world.campaign_farm_stats = stats; return stats;
}
/** Called once by the same delivery transaction that consumes carried_loot. */
export function recordCampFarmDelivery(world: World, army: Army, delivered: Resources, now = Date.now()) {
    const report = world.reports.find(r => r.owner_id === army.owner_id && r.battle_id === army.loot_report_id);
    const campId = report?.camp_id ?? world.battles.find(b => b.id === army.loot_report_id)?.camp_id;
    if (!report || !world.camps.some(c => c.id === campId && c.bandit)) return;
    add(ensureCampaignFarmStats(world, report.battle_id), receipt(world, report, delivered, new Date(now).toISOString()));
}
export const CAMPAIGN_FARM_SORTS = { name: 'Name', distance: 'Distance', result: 'Combat result', lastRaid: 'Last raid', bounty: 'Last delivered bounty', totalBounty: 'Total delivered bounty', nextAttack: 'Next attack' } as const;
export type CampaignFarmSort = keyof typeof CAMPAIGN_FARM_SORTS;
/** Missing history and paused schedules remain last in both directions. */
export function sortCampaignFarms(world: World, owner: string, farms: CampaignFarmTarget[], by: CampaignFarmSort, descending: boolean, now: number) {
    const stats = world.campaign_farm_stats ?? [];
    const value = (farm: CampaignFarmTarget): number | string | null => {
        const stat = stats.find(s => s.owner_id === owner && s.camp_id === farm.camp_id), camp = world.camps.find(c => c.id === farm.camp_id), army = world.armies.find(a => a.id === farm.army_id && a.owner_id === owner);
        if (by === 'name') return camp?.name ?? '';
        if (by === 'distance') { const pos = army && armyPosition(army, now); return camp && pos ? Math.hypot(wrappedWorldDelta(pos.x, camp.x), wrappedWorldDelta(pos.y, camp.y)) : null; }
        if (by === 'nextAttack') return farm.enabled && farm.next_at ? Date.parse(farm.next_at) : null;
        if (!stat) return null;
        if (by === 'lastRaid') return Date.parse(stat.last_raid_at);
        if (by === 'bounty') return stat.last_loot;
        if (by === 'totalBounty') return stat.total_loot;
        return stat.last_result === 'defender' ? 0 : stat.last_result === 'draw' ? 1 : stat.last_losses > 0 ? 2 : 3;
    };
    const values = new Map(farms.map(f => [f.id, value(f)]));
    return farms.slice().sort((a, b) => { const av = values.get(a.id)!, bv = values.get(b.id)!;
        if (av === null || bv === null) return av === bv ? a.id - b.id : av === null ? 1 : -1;
        return (typeof av === 'string' ? av.localeCompare(String(bv), undefined, { numeric: true }) : av - Number(bv)) * (descending ? -1 : 1) || a.id - b.id;
    });
}
