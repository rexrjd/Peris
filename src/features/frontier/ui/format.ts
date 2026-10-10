import type { Resources } from '../../../shared/model/resources';
import type { Troops } from '../domain/types';

export const unitLabels = { infantry: 'Infantry', archers: 'Archers', cavalry: 'Cavalry' } as const;
export const unitIcons = { infantry: 'shield', archers: 'bow', cavalry: 'horse' } as const;
export const number = (value: number) => Math.floor(value).toLocaleString();
export const totalResources = (resources: Resources) => resources.wood + resources.stone + resources.food + resources.gold;
export const totalTroops = (troops: Troops) => troops.infantry + troops.archers + troops.cavalry;
export function duration(ms: number) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export const remaining = (at: number, now: number) => at <= now ? 'Resolving…' : duration(at - now);
