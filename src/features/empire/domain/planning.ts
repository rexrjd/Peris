import type { World } from '../../../shared/model/world';
import type { Settlement } from '../../city/domain/types';
import { affordable, liveResources } from '../../city/domain/economy';
import { CELL_SIZE, wrapWorldCell, wrappedCellDistance } from '../../map/domain/dimensions';
import { cellCenter, getCell } from '../../map/domain/worldGrid';
import { findMarchPath } from '../../map/domain/pathfinding';
import { COLONY_COST, MAX_CITIES, SETTLERS_REQUIRED, cultureCost, expansionCount, foundingReason, liveCulture } from './expansion';

export type ColonySite = { col: number; row: number };

/** Shared with the launch command: canonical fields, land routes and travel speed. */
export function inspectColonySite(world: World, owner: string, city: Settlement, target: ColonySite) {
    const reason = foundingReason(world, owner, target.col, target.row);
    if (!Number.isSafeInteger(target.col) || !Number.isSafeInteger(target.row)) return { reason, route: null, seconds: 0 };
    const site = wrapWorldCell(target.col, target.row);
    const route = reason ? null : findMarchPath(city, cellCenter(site.col, site.row));
    return { reason: reason ?? (route ? null : 'There is no connected land route to this site.'), route, seconds: route ? Math.max(5, route.distance / 18) : 0 };
}

export function colonyLaunchReason(world: World, owner: string, city: Settlement, now: number, name: string, site: ColonySite | null, siteReason: string | null) {
    if (expansionCount(world, owner) >= MAX_CITIES) return 'Your empire has reached its ten-city limit.';
    if (!site) return 'Choose a site on the map to begin.';
    if (siteReason) return siteReason;
    if (name.trim().length < 2 || name.trim().length > 32) return 'Give your new city a name of 2–32 characters.';
    if ((city.settlers ?? 0) < SETTLERS_REQUIRED) return 'Prepare three settlers in your departure city.';
    if (liveCulture(world, owner, now) < cultureCost(expansionCount(world, owner))) return 'Your empire needs more culture. Develop your cities to earn it.';
    if (!affordable(liveResources(city, now), COLONY_COST)) return 'Your departure city needs more colony supplies.';
    return null;
}

/** Suggestions are real available fields, never fabricated resource bonuses. */
export function scoutColonySites(world: World, owner: string, city: Settlement): ColonySite[] {
    const origin = { col: Math.floor(city.x / CELL_SIZE), row: Math.floor(city.y / CELL_SIZE) };
    const candidates: (ColonySite & { score: number })[] = [];
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) continue;
        const site = wrapWorldCell(origin.col + dx, origin.row + dy);
        if (foundingReason(world, owner, site.col, site.row)) continue;
        candidates.push({ ...site, score: Math.hypot(dx, dy) + (getCell(site.col, site.row).terrain === 'farmland' ? -.4 : 0) });
    }
    candidates.sort((a, b) => a.score - b.score || a.col - b.col || a.row - b.row);
    const results: ColonySite[] = [];
    for (const candidate of candidates) {
        if (results.some(site => wrappedCellDistance(site, candidate) < 3)) continue;
        if (!findMarchPath(city, cellCenter(candidate.col, candidate.row))) continue;
        results.push({ col: candidate.col, row: candidate.row });
        if (results.length === 3) break;
    }
    return results;
}

export function journeyProgress(departure: string, arrival: string, now: number) {
    const start = Date.parse(departure), end = Date.parse(arrival);
    return Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start)));
}
