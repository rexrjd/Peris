import { type Army } from '../../army/domain/types';
export function armyPosition(a: Army, now = Date.now()) {
    const t = a.status === 'moving' ? Math.max(0, Math.min(1, (now - Date.parse(a.departure_at)) / Math.max(1, Date.parse(a.arrival_at) - Date.parse(a.departure_at)))) : 1;
    return { x: a.start_x + (a.target_x - a.start_x) * t, y: a.start_y + (a.target_y - a.start_y) * t };
}
export function completeTravel(a: Army, now: number) {
    if (a.status === 'moving' && Date.parse(a.arrival_at) <= now) {
        a.status = 'idle';
        a.start_x = a.target_x;
        a.start_y = a.target_y;
    }
}
