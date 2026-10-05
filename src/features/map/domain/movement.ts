import { type Army } from '../../army/domain/types';
type Point = [number, number];
type RouteMetric = { points: Point[]; cumulative: Float64Array; distance: number };
const routeMetrics = new WeakMap<Point[], RouteMetric | null>();
function routeMetric(a: Army): RouteMetric | null {
    const points = a.march_path;
    if (!points || points.length < 2 || points.length > 2000) return null;
    if (routeMetrics.has(points)) return routeMetrics.get(points)!;
    if (points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) { routeMetrics.set(points, null); return null; }
    const cumulative = new Float64Array(points.length);
    for (let i = 1; i < points.length; i++) cumulative[i] = cumulative[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    const metric = { points, cumulative, distance: cumulative[cumulative.length - 1] };
    routeMetrics.set(points, metric); return metric;
}
function progress(a: Army, now: number) { return a.status === 'moving' ? Math.max(0, Math.min(1, (now - Date.parse(a.departure_at)) / Math.max(1, Date.parse(a.arrival_at) - Date.parse(a.departure_at)))) : 1; }
function segmentAt(metric: RouteMetric, traveled: number) {
    let lo = 1, hi = metric.points.length - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (metric.cumulative[mid] < traveled) lo = mid + 1; else hi = mid; }
    return lo;
}
export function armyPosition(a: Army, now = Date.now()) {
    const t = progress(a, now), metric = routeMetric(a);
    if (a.status === 'idle' || t >= 1) return { x: a.target_x, y: a.target_y };
    if (metric && metric.distance > 0) {
        const traveled = t * metric.distance, index = segmentAt(metric, traveled), before = metric.cumulative[index - 1];
        const fraction = (traveled - before) / Math.max(.000001, metric.cumulative[index] - before);
        const from = metric.points[index - 1], to = metric.points[index];
        return { x: from[0] + (to[0] - from[0]) * fraction, y: from[1] + (to[1] - from[1]) * fraction };
    }
    return { x: a.start_x + (a.target_x - a.start_x) * t, y: a.start_y + (a.target_y - a.start_y) * t };
}
/** Renderer path starts at the same arc-length position used by simulation. */
export function armyRouteRemaining(a: Army, now = Date.now()): Point[] {
    const pos = armyPosition(a, now), first: Point = [pos.x, pos.y], metric = routeMetric(a), t = progress(a, now);
    if (t >= 1 || a.status === 'idle') return [first];
    if (!metric || !metric.distance) return [first, [a.target_x, a.target_y]];
    const index = segmentAt(metric, t * metric.distance);
    return [first, ...metric.points.slice(index).filter(point => point[0] !== first[0] || point[1] !== first[1])];
}
export function completeTravel(a: Army, now: number) {
    if (a.status === 'moving' && Date.parse(a.arrival_at) <= now) {
        a.status = 'idle';
        a.start_x = a.target_x;
        a.start_y = a.target_y;
        a.march_path = null;
        a.march_distance = null;
    }
}
