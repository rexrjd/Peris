import { RenderContext } from './RenderContext';
import { FIELD_H, FIELD_W } from '../../features/battle/domain/dimensions';
import { WORLD_H, WORLD_W, WORLD_MIN_X, WORLD_MIN_Y } from '../../features/map/domain/dimensions';
import { preferences } from '../../platform/preferences/preferences';
import { armyPosition } from '../../features/map/domain/movement';
import { silverrunX } from '../../features/map/domain/geography';
export class CanvasOverlays {
    constructor(private ctx: RenderContext) { }
    minimap() {
        const c = this.ctx.c, s = this.ctx.state(), { w, h, x, y } = this.ctx.miniBounds(), worldW = s.mode === 'battle' ? FIELD_W : WORLD_W, worldH = s.mode === 'battle' ? FIELD_H : WORLD_H;
        c.fillStyle = '#17251de0';
        c.fillRect(x - 4, y - 4, w + 8, h + 8);
        c.drawImage(this.ctx.terrain!, x, y, w, h);
        c.strokeStyle = '#d3c38d70';
        c.lineWidth = 1;
        c.strokeRect(x, y, w, h);
        if (s.mode === 'battle')
            for (const f of s.world.formations.filter(f => f.battle_id === s.battle?.id && f.soldiers > 0)) {
                c.fillStyle = f.owner_id === s.playerId ? '#f0bd75' : '#8bb5d0';
                c.fillRect(x + f.x / worldW * w - 2, y + f.y / worldH * h - 2, 4, 4);
            }
        else {
            for (const camp of s.world.camps) {
                const cleared = s.world.progress.some(p => p.owner_id === s.playerId && p.camp_id === camp.id && p.defeated > 0);
                c.fillStyle = cleared ? '#8fbb78' : '#d08659';
                c.beginPath(); c.arc(x + (camp.x - WORLD_MIN_X) / worldW * w, y + (camp.y - WORLD_MIN_Y) / worldH * h, 2.5, 0, Math.PI * 2); c.fill();
            }
            for (const town of s.world.settlements) {
                c.fillStyle = town.owner_id === s.playerId ? '#f4cf7f' : '#8ab3c4';
                c.fillRect(x + (town.x - WORLD_MIN_X) / worldW * w - 2, y + (town.y - WORLD_MIN_Y) / worldH * h - 2, 4, 4);
            }
            for (const army of s.world.armies) {
                const pos = armyPosition(army, Date.now() + (s.clockOffset ?? 0)), ax = x + (pos.x - WORLD_MIN_X) / worldW * w, ay = y + (pos.y - WORLD_MIN_Y) / worldH * h;
                c.fillStyle = army.owner_id === s.playerId ? '#ffe3a1' : '#9dc2dc';
                c.beginPath(); c.moveTo(ax, ay - 3); c.lineTo(ax + 3, ay); c.lineTo(ax, ay + 3); c.lineTo(ax - 3, ay); c.closePath(); c.fill();
            }
        }
        const scale = this.ctx.zoomBase * this.ctx.camera.zoom, viewW = this.ctx.w / scale, viewH = this.ctx.h / scale;
        c.strokeStyle = '#f0e0bdaa';
        c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
        c.strokeRect(x + (this.ctx.camera.x - viewW / 2 - (s.mode === 'world' ? WORLD_MIN_X : 0)) / worldW * w, y + (this.ctx.camera.y - viewH / 2 - (s.mode === 'world' ? WORLD_MIN_Y : 0)) / worldH * h, viewW / worldW * w, viewH / worldH * h);
        c.restore();
        c.font = '8px Open Sans,Arial';
        c.fillStyle = '#d6ccaa';
        c.textAlign = 'right';
        c.fillText('CLICK TO REPOSITION', x + w, y + h + 12);
    }
    water(time: number) {
        const s = this.ctx.state(), c = this.ctx.c;
        if (!preferences().effects || (s.mode === 'battle' && s.battle?.terrain !== 'river'))
            return;
        c.strokeStyle = '#d8e2cc50';
        c.lineWidth = .7;
        for (let i = 0; i < 26; i++) {
            const y = (i * 33 + time / 90) % (s.mode === 'world' ? 770 : 700);
            if (s.mode === 'battle' && y > 300 && y < 400 || s.mode === 'world' && (Math.abs(y - 250) < 17 || Math.abs(y - 485) < 17))
                continue;
            const x = s.mode === 'world' ? silverrunX(y) : 600 + Math.sin(y / 110) * 32;
            c.beginPath();
            c.moveTo(x - 12, y);
            c.quadraticCurveTo(x, y + 2, x + 12, y);
            c.stroke();
        }
    }
}
