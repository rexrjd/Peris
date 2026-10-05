import { RenderContext } from './RenderContext';
import { FIELD_H, FIELD_W } from '../../features/battle/domain/dimensions';
import { WORLD_H, WORLD_W } from '../../features/map/domain/dimensions';
import { preferences } from '../../platform/preferences/preferences';
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
            for (const town of s.world.settlements) {
                c.fillStyle = town.owner_id === s.playerId ? '#f4cf7f' : '#8ab3c4';
                c.fillRect(x + town.x / worldW * w - 2, y + town.y / worldH * h - 2, 4, 4);
            }
        }
        const scale = this.ctx.zoomBase * this.ctx.camera.zoom, viewW = this.ctx.w / scale, viewH = this.ctx.h / scale;
        c.strokeStyle = '#f0e0bdaa';
        c.strokeRect(x + (this.ctx.camera.x - viewW / 2) / worldW * w, y + (this.ctx.camera.y - viewH / 2) / worldH * h, viewW / worldW * w, viewH / worldH * h);
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
            if (s.mode === 'battle' && y > 300 && y < 400 || s.mode === 'world' && y > 415 && y < 448)
                continue;
            const x = (s.mode === 'world' ? 565 : 600) + Math.sin(y / (s.mode === 'world' ? 115 : 110)) * 32;
            c.beginPath();
            c.moveTo(x - 12, y);
            c.quadraticCurveTo(x, y + 2, x + 12, y);
            c.stroke();
        }
    }
}
