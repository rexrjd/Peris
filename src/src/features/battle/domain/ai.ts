import { type Battle, type Formation } from './types';
import { clamp, dist } from '../../../shared/math/geometry';
export function chooseAI(b: Battle, fs: Formation[]) {
    for (const f of fs.filter(f => f.owner_id === null && f.soldiers > 0 && f.status !== 'routed')) {
        const enemies = fs.filter(e => e.side !== f.side && e.soldiers > 0 && e.status !== 'routed');
        if (!enemies.length)
            continue;
        const closest = [...enemies].sort((a, c) => dist(f, a) - dist(f, c))[0];
        const target = f.unit_type === 'cavalry' && b.difficulty !== 'easy' ? (enemies.filter(e => e.unit_type === 'archers').sort((a, c) => dist(f, a) - dist(f, c))[0] ?? closest) : closest;
        if (f.unit_type === 'archers' && dist(f, closest) < 80 && b.difficulty !== 'easy') {
            f.target_formation_id = null;
            f.target_x = clamp(f.x + (f.x - closest.x) * 1.2, 50, 1150);
            f.target_y = clamp(f.y + (f.y - closest.y) * 1.2, 50, 650);
            f.status = 'moving';
            continue;
        }
        if (f.target_formation_id === target.id)
            continue;
        if (f.unit_type === 'cavalry' && b.difficulty === 'hard' && dist(f, target) > 250 && Math.abs(f.y - target.y) < 65) {
            f.target_formation_id = null;
            f.target_x = target.x - 85;
            f.target_y = target.y < 350 ? 85 : 615;
            f.running = true;
            continue;
        }
        f.charge_ready = f.unit_type === 'cavalry' && dist(f, target) > 140 && f.stamina > 35;
        f.target_formation_id = target.id;
        f.status = 'moving';
        f.running = f.unit_type === 'cavalry';
    }
}
