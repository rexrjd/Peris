import { type Battle, type BattleOrder, type Formation } from './types';
import { angleDiff, clamp, dist } from '../../../shared/math/geometry';
import { UNITS } from '../../army/domain/units';
import { terrainAt } from './terrain';
export function moveTargets(selected: Formation[], order: BattleOrder) {
    const cx = selected.reduce((n, f) => n + f.x, 0) / selected.length, cy = selected.reduce((n, f) => n + f.y, 0) / selected.length;
    const spacing = Math.min(620 / Math.max(1, selected.length - 1), (order.columns ?? 10) * 8 + 24), angle = (order.facing ?? 0) * Math.PI / 180;
    return selected.map((f, i) => ({ id: f.id, x: clamp((order.x ?? cx) + (order.facing === undefined ? f.x - cx : -Math.sin(angle) * (i - (selected.length - 1) / 2) * spacing), 35, 1165), y: clamp((order.y ?? cy) + (order.facing === undefined ? f.y - cy : Math.cos(angle) * (i - (selected.length - 1) / 2) * spacing), 40, 660) }));
}
export function moveFormations(b: Battle, fs: Formation[], byId: Map<number, Formation>, dt: number) {
    for (const f of fs) {
        if (f.soldiers <= 0)
            continue;
        if (f.status === 'routed') {
            f.x = clamp(f.x + (f.side === 'attacker' ? -1 : 1) * 64 * dt, 12, 1188);
            continue;
        }
        const t = f.target_formation_id ? byId.get(f.target_formation_id) : null;
        if (t && (t.soldiers <= 0 || t.status === 'routed')) {
            f.target_formation_id = null;
            f.target_x = f.x;
            f.target_y = f.y;
            f.charge_ready = false;
        }
        // Automatic self-defence and ranged fire; guard formations never pursue.
        if (!f.target_formation_id) {
            const auto = fs.filter(e => e.side !== f.side && e.status !== 'routed' && e.soldiers > 0 && dist(f, e) < (f.unit_type === 'archers' && f.fire_at_will ? UNITS.archers.range : UNITS[f.unit_type].range)).sort((a, c) => dist(f, a) - dist(f, c))[0];
            if (auto && (f.unit_type !== 'archers' || f.fire_at_will)) {
                f.target_formation_id = auto.id;
                f.charge_ready = false;
            }
        }
        const enemy = f.target_formation_id ? byId.get(f.target_formation_id) : null;
        if (enemy) {
            f.target_x = enemy.x;
            f.target_y = enemy.y;
        }
        const distance = dist(f, { x: f.target_x, y: f.target_y });
        const range = enemy ? UNITS[f.unit_type].range : 0;
        const ground = terrainAt(b.terrain, f.x, f.y);
        const canMove = distance > range + 2 && !(enemy && f.stance === 'guard');
        if (canMove) {
            const dx = f.target_x - f.x, dy = f.target_y - f.y;
            const desired = Math.atan2(dy, dx) * 180 / Math.PI;
            f.facing += clamp(angleDiff(desired, f.facing), -150 * dt, 150 * dt);
            const speed = UNITS[f.unit_type].speed * ground.speed * (f.unit_type === 'cavalry' && ground.kind === 'Forest' ? .65 : 1) * (f.running && f.stamina > 8 ? 1.45 : 1) * (f.stamina < 15 ? .75 : 1);
            const step = Math.min(speed * dt, distance - range);
            f.x = clamp(f.x + dx / distance * step, 25, 1175);
            f.y = clamp(f.y + dy / distance * step, 30, 670);
            f.status = 'moving';
            f.stamina = clamp(f.stamina - (f.running ? 1.9 : .12) * dt, 0, 100);
        }
        else {
            f.status = enemy ? 'engaged' : 'idle';
            f.stamina = clamp(f.stamina + (enemy ? -.4 : 2) * dt, 0, 100);
            if (!enemy && f.target_facing !== null)
                f.facing += clamp(angleDiff(f.target_facing, f.facing), -150 * dt, 150 * dt);
            if (!enemy && f.morale < 90)
                f.morale = clamp(f.morale + .7 * dt, 0, 100);
        }
    }
}
