import { type Particle, drawParticles } from './effects';
import { RenderContext } from '../../../shared/rendering/RenderContext';
import { type Formation } from '../domain/types';
import { formationSize } from '../domain/formations';
import { seeded } from '../../../shared/math/random';
import { angleDiff, clamp, dist } from '../../../shared/math/geometry';
import { preferences } from '../../../platform/preferences/preferences';
import { tone } from '../../../platform/audio/audio';
import { drawSoldier } from './soldiers';
export class BattleRenderer {
    positions = new Map<number, {
        x: number;
        y: number;
        facing: number;
        soldiers: number;
    }>();
    private particles: Particle[] = [];
    private deaths: {
        x: number;
        y: number;
        side: string;
        angle: number;
    }[] = [];
    private previousStatus = new Map<number, string>();
    private lastVolley = 0;
    constructor(private ctx: RenderContext) { }
    reset() { this.positions.clear(); this.deaths = []; this.particles = []; this.previousStatus.clear(); this.lastVolley = 0; }
    hit(x: number, y: number, fs: Formation[]) {
        return fs.filter(f => f.soldiers > 0).find(f => {
            const pos = this.positions.get(f.id) ?? f, angle = -pos.facing * Math.PI / 180, dx = x - pos.x, dy = y - pos.y;
            const lx = dx * Math.cos(angle) - dy * Math.sin(angle), ly = dx * Math.sin(angle) + dy * Math.cos(angle), size = formationSize(f);
            return Math.abs(lx) < size.depth / 2 + 12 && Math.abs(ly) < size.width / 2 + 8;
        });
    }
    draw(time: number, dt: number) {
        const c = this.ctx.c, s = this.ctx.state(), b = s.battle!, fs = s.world.formations.filter(f => f.battle_id === b.id), rng = seeded(Math.floor(time / 100));
        if (b.phase === 'deployment') {
            c.fillStyle = '#b7633523';
            c.fillRect(25, 30, 340, 640);
            c.strokeStyle = '#e4c67c55';
            c.lineWidth = 2;
            c.strokeRect(25, 30, 340, 640);
            c.fillStyle = '#57748d23';
            c.fillRect(835, 30, 340, 640);
            c.strokeStyle = '#7b9dba55';
            c.strokeRect(835, 30, 340, 640);
            c.font = '18px Georgia';
            c.fillStyle = '#f3d6a577';
            c.textAlign = 'center';
            c.fillText('DEPLOYMENT', 195, 65);
            c.fillStyle = '#c4d3d877';
            c.fillText('DEPLOYMENT', 1005, 65);
        }
        for (const d of this.deaths) {
            c.save();
            c.translate(d.x, d.y);
            c.rotate(d.angle);
            c.fillStyle = d.side === 'attacker' ? '#804e3690' : '#46565a90';
            c.fillRect(-3, -1, 6, 3);
            c.fillStyle = '#b5ad8970';
            c.fillRect(2, -1, 2, 2);
            c.restore();
        }
        const volley = Math.floor(b.elapsed * 2), newVolley = volley !== this.lastVolley;
        this.lastVolley = volley;
        for (const f of fs) {
            const own = f.owner_id === s.playerId, selected = s.selectedIds.includes(f.id), size = formationSize(f);
            let pos = this.positions.get(f.id);
            if (!pos) {
                pos = { x: f.x, y: f.y, facing: f.facing, soldiers: f.soldiers };
                this.positions.set(f.id, pos);
            }
            if (pos.soldiers > f.soldiers) {
                for (let i = 0; i < Math.min(5, pos.soldiers - f.soldiers); i++) {
                    this.deaths.push({ x: pos.x + (rng() - .5) * size.depth, y: pos.y + (rng() - .5) * size.width, side: f.side, angle: rng() * 6.28 });
                }
                pos.soldiers = f.soldiers;
                if (this.deaths.length > 700)
                    this.deaths.splice(0, this.deaths.length - 700);
            }
            const amount = 1 - Math.exp(-dt * (s.world.version === 6 ? 7 : 8));
            pos.x += (f.x - pos.x) * amount;
            pos.y += (f.y - pos.y) * amount;
            pos.facing += angleDiff(f.facing, pos.facing) * amount;
            if (f.soldiers <= 0)
                continue;
            if (own && selected && (f.target_formation_id || f.status === 'moving') && b.phase === 'combat') {
                const target = fs.find(t => t.id === f.target_formation_id), tx = target?.x ?? f.target_x, ty = target?.y ?? f.target_y;
                c.strokeStyle = target ? '#d9876999' : '#eed49888';
                c.lineWidth = 1.2;
                c.setLineDash([4, 6]);
                c.beginPath();
                c.moveTo(pos.x, pos.y);
                c.lineTo(tx, ty);
                c.stroke();
                c.setLineDash([]);
                c.strokeStyle = target ? '#d98769' : '#eed498';
                c.beginPath();
                c.arc(tx, ty, 6, 0, Math.PI * 2);
                c.stroke();
            }
            if (selected && f.unit_type === 'archers') {
                c.fillStyle = '#ecd39008';
                c.strokeStyle = '#ead09744';
                c.lineWidth = 1;
                c.beginPath();
                c.arc(pos.x, pos.y, 220, 0, Math.PI * 2);
                c.fill();
                c.stroke();
            }
            if (preferences().effects && newVolley && b.phase === 'combat' && f.unit_type === 'archers' && f.target_formation_id && f.status === 'engaged') {
                const target = fs.find(t => t.id === f.target_formation_id);
                if (target && dist(f, target) > 65 && dist(f, target) < 224) {
                    tone('arrow');
                    for (let i = 0; i < 7; i++)
                        this.particles.push({ kind: 'arrow', x: pos.x, y: pos.y, startx: pos.x + (rng() - .5) * 25, starty: pos.y + (rng() - .5) * 25, tx: target.x + (rng() - .5) * 25, ty: target.y + (rng() - .5) * 25, vx: 0, vy: 0, life: .65, max: .65, color: '#f0deac' });
                }
            }
            c.save();
            c.translate(pos.x, pos.y);
            c.rotate(pos.facing * Math.PI / 180);
            if (selected) {
                c.strokeStyle = '#ffe3a0';
                c.lineWidth = 1.8;
                c.fillStyle = '#f7dd960d';
                c.fillRect(-size.depth / 2 - 6, -size.width / 2 - 6, size.depth + 12, size.width + 12);
                c.strokeRect(-size.depth / 2 - 6, -size.width / 2 - 6, size.depth + 12, size.width + 12);
            }
            if (f.status === 'routed')
                c.globalAlpha = .55;
            const count = Math.min(120, f.soldiers), cols = Math.min(f.columns, count), rows = Math.ceil(count / cols);
            for (let i = 0; i < count; i++) {
                const col = i % cols, row = Math.floor(i / cols), sx = (row - (rows - 1) / 2) * 8, sy = (col - (cols - 1) / 2) * 8;
                drawSoldier(this.ctx, sx, sy, f, i, time);
            }
            c.restore();
            // A small raised standard identifies a formation without covering its soldiers.
            const bx = pos.x, by = pos.y - size.width / 2 - 21;
            c.strokeStyle = '#635742';
            c.lineWidth = 1.6;
            c.beginPath();
            c.moveTo(bx, by + 12);
            c.lineTo(bx, by - 13);
            c.stroke();
            c.fillStyle = own ? '#962f2b' : '#355563';
            c.fillRect(bx - 1, by - 13, 15, 18);
            c.strokeStyle = selected ? '#ffe2a0' : '#c4b481';
            c.lineWidth = 1;
            c.strokeRect(bx - 1, by - 13, 15, 18);
            c.font = '9px Georgia';
            c.fillStyle = '#e9d69c';
            c.textAlign = 'center';
            c.fillText(String(fs.filter(q => q.owner_id === f.owner_id).indexOf(f) + 1), bx + 6, by - 1);
            this.ctx.label(pos.x, pos.y + size.width / 2 + 16, `${f.soldiers} ${f.status === 'routed' ? '· ROUTING' : f.charge_ready ? '· CHARGE' : ''}`, own ? '#f5dba2' : '#d3e2e8', true);
            c.fillStyle = '#273124';
            c.fillRect(pos.x - 20, pos.y + size.width / 2 + 27, 40, 3);
            c.fillStyle = f.morale < 30 ? '#b5583f' : own ? '#cab071' : '#779ca6';
            c.fillRect(pos.x - 20, pos.y + size.width / 2 + 27, 40 * f.morale / 100, 3);
            const previous = this.previousStatus.get(f.id);
            if (previous !== f.status && f.status === 'routed' && f.soldiers > 0)
                tone('route');
            if (preferences().effects && previous !== f.status && f.status === 'engaged' && f.unit_type === 'cavalry') {
                tone('charge');
                for (let i = 0; i < 12; i++)
                    this.particles.push({ kind: 'charge', x: pos.x + (rng() - .5) * 30, y: pos.y + (rng() - .5) * 30, vx: (rng() - .5) * 50, vy: (rng() - .5) * 50, life: .65, max: .65, color: '#dcbe80' });
            }
            this.previousStatus.set(f.id, f.status);
            if (preferences().effects && f.status === 'moving' && rng() > .85)
                this.particles.push({ kind: 'dust', x: pos.x, y: pos.y, vx: -6, vy: 5, life: .6, max: .6, color: '#d3c28a' });
        }
        this.particles = drawParticles(c, this.particles, dt);
    }
    hover() {
        const s = this.ctx.state();
        if (s.mode !== 'battle' || this.ctx.down || this.ctx.w < 600)
            return;
        const wp = this.ctx.worldPoint(this.ctx.pointer.x, this.ctx.pointer.y), f = this.hit(wp.x, wp.y, s.world.formations.filter(f => f.battle_id === s.battle?.id));
        if (!f)
            return;
        const c = this.ctx.c, x = clamp(this.ctx.pointer.x + 18, 8, this.ctx.w - 236), y = clamp(this.ctx.pointer.y + 18, 8, this.ctx.h - 90), own = f.owner_id === s.playerId;
        c.fillStyle = '#17231ef5';
        c.beginPath();
        c.roundRect(x, y, 226, 78, 4);
        c.fill();
        c.strokeStyle = own ? '#c7b38388' : '#ac716488';
        c.lineWidth = 1;
        c.stroke();
        c.textAlign = 'left';
        c.fillStyle = '#eddfbb';
        c.font = '15px Georgia';
        c.fillText(f.label, x + 12, y + 23);
        c.fillStyle = '#b9be9d';
        c.font = '11px Open Sans,Arial';
        c.fillText(`${f.soldiers} soldiers  ·  ${Math.round(f.morale)}% morale`, x + 12, y + 44);
        c.fillStyle = '#d1b981';
        c.font = '10px Open Sans,Arial';
        c.fillText(own ? 'Click to select · Shift to add' : s.selectedIds.length ? 'Click to attack this formation' : 'Enemy formation', x + 12, y + 64);
    }
}
