import { type RenderActions, type RenderState } from './contracts';
import { FIELD_H, FIELD_W } from '../../features/battle/domain/dimensions';
import { WORLD_H, WORLD_W } from '../../features/map/domain/dimensions';
import { clamp } from '../math/geometry';
export class RenderContext {
    w = 1;
    h = 1;
    dpr = 1;
    terrain: HTMLCanvasElement | null = null;
    camera = { x: 600, y: 350, zoom: 1 };
    zoomBase = 1;
    down: {
        x: number;
        y: number;
        wx: number;
        wy: number;
        button: number;
        shift: boolean;
    } | null = null;
    pointer = { x: 0, y: 0 };
    keys = new Set<string>();
    minimapDrag = false;
    readonly c: CanvasRenderingContext2D;
    constructor(readonly canvas: HTMLCanvasElement, readonly state: () => RenderState, readonly actions: () => RenderActions) { this.c = canvas.getContext('2d')!; }
    setSize() {
        const rect = this.canvas.parentElement!.getBoundingClientRect();
        this.w = Math.max(1, rect.width);
        this.h = Math.max(1, rect.height);
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.canvas.width = this.w * this.dpr;
        this.canvas.height = this.h * this.dpr;
        this.canvas.style.width = `${this.w}px`;
        this.canvas.style.height = `${this.h}px`;
        const s = this.state();
        this.zoomBase = (this.w < 600 ? Math.max : Math.min)(this.w / (s.mode === 'battle' ? FIELD_W : WORLD_W), this.h / (s.mode === 'battle' ? FIELD_H : WORLD_H));
        if (s.mode === 'world')
            this.camera.y = WORLD_H / 2;
    }
    worldPoint(x: number, y: number) { const scale = this.zoomBase * this.camera.zoom; return { x: (x - this.w / 2) / scale + this.camera.x, y: (y - this.h / 2) / scale + this.camera.y }; }
    miniBounds() { const mode = this.state().mode, w = this.w < 600 ? 112 : 154, h = mode === 'battle' ? w * .584 : w * .642; return { x: this.w - w - 16, y: 16, w, h }; }
    panMinimap(p: {
        x: number;
        y: number;
    }) { const m = this.miniBounds(), s = this.state(); this.camera.x = clamp((p.x - m.x) / m.w, 0, 1) * WORLD_W; this.camera.y = clamp((p.y - m.y) / m.h, 0, 1) * (s.mode === 'battle' ? FIELD_H : WORLD_H); }
    label(x: number, y: number, text: string, color = '#efe3bd', small = false) {
        const c = this.c;
        c.font = `${small ? '10' : '12'}px ${small ? 'Arial' : 'Georgia'}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const width = c.measureText(text).width + 16;
        c.fillStyle = '#222b27df';
        c.fillRect(x - width / 2, y - 9, width, 18);
        c.fillStyle = color;
        c.fillText(text, x, y);
    }
    zoom(delta: number) { this.camera.zoom = clamp(this.camera.zoom * delta, .3, 3.2); }
    focus(side: 'own' | 'enemy') {
        const s = this.state(), fs = s.world.formations.filter(f => f.battle_id === s.battle?.id && f.soldiers > 0 && (side === 'own' ? f.owner_id === s.playerId : f.owner_id !== s.playerId));
        const selected = side === 'own' ? fs.filter(f => s.selectedIds.includes(f.id)) : [];
        const targets = selected.length ? selected : fs;
        if (targets.length) {
            this.camera.x = targets.reduce((n, f) => n + f.x, 0) / targets.length;
            this.camera.y = this.w < 600 ? 350 : targets.reduce((n, f) => n + f.y, 0) / targets.length;
        }
    }
    center(x = 600, y = this.state().mode === 'world' ? 385 : 350) { this.camera.x = x; this.camera.y = y; this.camera.zoom = this.w < 600 ? Math.min(this.w / 1200, this.h / (this.state().mode === 'world' ? 770 : 700)) / this.zoomBase : this.state().mode === 'battle' ? 1.15 : 1; }
}
