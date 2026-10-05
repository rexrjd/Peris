import { clamp } from '../../../shared/math/geometry';
export type Particle = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    max: number;
    kind: 'arrow' | 'dust' | 'death' | 'charge';
    tx?: number;
    ty?: number;
    startx?: number;
    starty?: number;
    color: string;
};
export function drawParticles(c: CanvasRenderingContext2D, particles: Particle[], dt: number) {
    for (const p of particles) {
        p.life -= dt;
        c.globalAlpha = clamp(p.life / p.max, 0, 1);
        if (p.kind === 'arrow') {
            const progress = 1 - p.life / p.max, tx = p.startx! + (p.tx! - p.startx!) * progress, ty = p.starty! + (p.ty! - p.starty!) * progress - Math.sin(progress * Math.PI) * 20;
            c.strokeStyle = p.color;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(tx, ty);
            c.lineTo(tx - (p.tx! - p.startx!) * .025, ty - (p.ty! - p.starty!) * .025);
            c.stroke();
        }
        else {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            c.fillStyle = p.color;
            c.beginPath();
            c.arc(p.x, p.y, p.kind === 'charge' ? 3 : 2.5, 0, Math.PI * 2);
            c.fill();
        }
    }
    c.globalAlpha = 1;
    return particles.filter(p => p.life > 0);
}
