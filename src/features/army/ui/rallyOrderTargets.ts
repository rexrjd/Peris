import type { World } from '../../../shared/model/world';
import { wrappedWorldDelta, wrapWorldPoint } from '../../map/domain/dimensions';
import { findMarchPath } from '../../map/domain/pathfinding';

export const RALLY_TARGET_LIMIT = 28;
export const RALLY_ROUTE_CACHE_LIMIT = 128;
type Point = { x: number; y: number };
type Target = { camp: World['camps'][number]; routeDistance: number | null };

/** Static terrain routes depend on endpoints, never camp stock or snapshot identity.
 * Keep only distances for a bounded shortlist; MarchDialog reviews the full route. */
export function createRallyTargetPicker(route: typeof findMarchPath = findMarchPath) {
    const distances = new Map<string, number | null>();
    let cachedOrigin = '';
    return (camps: World['camps'], origin: Point | undefined, query: string): Target[] => {
        if (!origin) return [];
        const start = wrapWorldPoint(origin), originKey = `${start.x},${start.y}`;
        if (originKey !== cachedOrigin) { distances.clear(); cachedOrigin = originKey; }
        const search = query.trim().toLocaleLowerCase();
        const shortlist = camps.filter(camp => camp.name.toLocaleLowerCase().includes(search))
            .map(camp => ({ camp, distance: Math.hypot(wrappedWorldDelta(start.x, camp.x), wrappedWorldDelta(start.y, camp.y)) }))
            .sort((a, b) => a.distance - b.distance || a.camp.id - b.camp.id).slice(0, RALLY_TARGET_LIMIT);
        return shortlist.map(({ camp }) => {
            const target = wrapWorldPoint(camp), key = `${target.x},${target.y}`;
            const cached = distances.has(key), distance = cached ? distances.get(key)! : route(start, target)?.distance ?? null;
            // Refresh recency so snapshots and repeated searches preserve the visible shortlist.
            distances.delete(key); distances.set(key, distance);
            if (distances.size > RALLY_ROUTE_CACHE_LIMIT) distances.delete(distances.keys().next().value!);
            return { camp, routeDistance: distance };
        });
    };
}
