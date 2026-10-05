import { type World } from '../../shared/model/world';
export const SAVE_KEY = 'peris-campaign-v6';
export function readSolo(): World | null {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw)
            return null;
        const w = JSON.parse(raw);
        if (w.version !== 6 || !w.players?.length || !w.settlements?.length || !w.armies?.length)
            return null;
        return w as World;
    }
    catch {
        return null;
    }
}
