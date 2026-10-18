import type { World } from '../../../shared/model/world';
import { emptyResources, RESOURCES, type Resources } from '../../../shared/model/resources';
import type { BattleResult } from '../../battle/domain/types';
import type { Report } from './types';
import { emptyRoster, RECRUIT_UNITS, type UnitRoster } from '../../army/domain/roster';
import { carryingCapacity, troopCost } from '../../frontier/domain/balance';

export type ReportSide = 'attacker' | 'defender';
export const resourceTotal = (bag: Partial<Resources> | null | undefined) => RESOURCES.reduce((sum, key) => sum + (bag?.[key] ?? 0), 0);
export const resourceDifference = (received: Resources, spent: Resources): Resources =>
    Object.fromEntries(RESOURCES.map(key => [key, received[key] - spent[key]])) as Resources;

/** Missing troop identities cannot justify guessing the price of aggregate losses. */
export function reportLossRoster(result: BattleResult, side: ReportSide = 'attacker'): UnitRoster | null {
    const initial = result[`${side}_roster`], survivors = result[`${side}_survivor_roster`];
    if (!initial || !survivors) return result[`${side}_losses`] === 0 ? emptyRoster() : null;
    return Object.fromEntries(RECRUIT_UNITS.map(unit => [unit, Math.max(0, initial[unit] - survivors[unit])])) as UnitRoster;
}

export function reportEconomics(result: BattleResult, side: ReportSide = 'attacker') {
    const losses = reportLossRoster(result, side);
    const replacementCost = side === 'attacker' && result.replacement_cost ? result.replacement_cost : losses ? troopCost(losses,result.balance_version??1) : null;
    const delivered = side === 'attacker' ? result.delivered ?? (result.loot && resourceTotal(result.loot) === 0 ? emptyResources() : null) : emptyResources();
    const spent=side==='defender'&&result.raid_city&&replacementCost?Object.fromEntries(RESOURCES.map(key=>[key,replacementCost[key]+result.loot[key]])) as Resources:replacementCost;
    const profit = spent && delivered ? resourceDifference(delivered, spent) : null;
    const survivorRoster = result[`${side}_survivor_roster`];
    const capacity = side === 'attacker' && result.carrying_capacity !== undefined ? result.carrying_capacity : survivorRoster ? carryingCapacity(survivorRoster) : null;
    return { replacementCost, delivered, profit, capacity, deliveryUnrecorded: side === 'attacker' && resourceTotal(result.loot) > 0 && !result.delivered };
}

/** Store the casualty price at battle time, before future catalog changes. */
export function recordBattleEconomics(result: BattleResult) {
    const economics = reportEconomics(result);
    if (economics.replacementCost) result.replacement_cost = { ...economics.replacementCost };
    if (economics.capacity !== null) result.carrying_capacity = economics.capacity;
    if (economics.profit) result.estimated_profit = { ...economics.profit }; else delete result.estimated_profit;
}

export function reportSide(world: World, report: Report, owner: string): ReportSide | null {
    if (report.owner_id !== owner) return null;
    if(report.result.report_side)return report.result.report_side;
    const battle = world.battles.find(row => row.id === report.battle_id);
    if (battle?.attacker_owner_id === owner) return 'attacker';
    if (battle?.defender_owner_id === owner) return 'defender';
    // Only an actual camp receipt guarantees that its owner attacked the NPC.
    return report.camp_id != null ? 'attacker' : null;
}

export function visibleReports(world: World, owner: string, campId?: number): Report[] {
    return world.reports.filter(report => report.owner_id === owner &&
        (campId === undefined || report.camp_id === campId || world.battles.some(battle => battle.id === report.battle_id && battle.camp_id === campId)) &&
        (report.result.attacker_losses > 0 || !world.campaign_farm_lists?.some(list => list.owner_id === owner && list.id === report.farm_list_id && list.casualties_only)))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
}

export function reportCampId(world: World, report: Report): number | undefined {
    return report.camp_id ?? world.battles.find(battle => battle.id === report.battle_id)?.camp_id ?? undefined;
}

/** A receipt may outlive a battle. Preserve uncertainty about pruned PvP sides. */
export function reportIsReturning(world: World, report: Report): boolean {
    return world.armies.some(army => army.owner_id === report.owner_id && army.loot_report_id === report.battle_id && !!army.carried_loot);
}

export function groupReports(world: World, reports: Report[]) {
    const groups = new Map<string, { key: string; title: string; campId?: number; reports: Report[] }>();
    for (const report of reports) {
        const campId = reportCampId(world, report), camp = world.camps.find(row => row.id === campId);
        const key = campId !== undefined ? `camp:${campId}` : 'other';
        const group = groups.get(key) ?? { key, campId, title: camp?.name ?? (campId !== undefined ? report.title : 'Other battles'), reports: [] };
        group.reports.push(report); groups.set(key, group);
    }
    return [...groups.values()];
}
