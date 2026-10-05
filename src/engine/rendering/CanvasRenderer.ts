import { RenderContext } from '../../shared/rendering/RenderContext';
import { MapRenderer } from '../../features/map/rendering/MapRenderer';
import { BattleRenderer } from '../../features/battle/rendering/BattleRenderer';
import { InputController } from './InputController';
import { CanvasOverlays } from '../../shared/rendering/overlays';
import { type RenderActions, type RenderState } from '../../shared/rendering/contracts';
import { gameImage } from '../../shared/rendering/assets';
import { makeTerrain } from './terrain';
import { clamp } from '../../shared/math/geometry';
import { preferences } from '../../platform/preferences/preferences';
import { CELL_SIZE, WORLD_MIN_X, WORLD_MIN_Y, WORLD_MAX_X, WORLD_MAX_Y } from '../../features/map/domain/dimensions';
import { mapArtReady, mapOverviewReady } from '../../features/map/rendering/mapArt';
/** Canvas lifecycle adapter. Scenes own drawing; InputController owns gestures. */
export class GameRenderer {
    private ctx: RenderContext;
    private map: MapRenderer;
    private battle: BattleRenderer;
    private input: InputController;
    private overlays: CanvasOverlays;
    private resize: ResizeObserver;
    private frame = 0;
    private running = true;
    private terrainKey = '';
    private lastSelection = '';
    private last = 0;
    private lastTouchOrder = 'select';
    private lastMapFocus: number | undefined;
    private lastViewport = '';
    constructor(canvas: HTMLCanvasElement, state: () => RenderState, actions: () => RenderActions) {
        this.ctx = new RenderContext(canvas, state, actions);
        this.map = new MapRenderer(this.ctx);
        this.battle = new BattleRenderer(this.ctx);
        this.overlays = new CanvasOverlays(this.ctx);
        this.input = new InputController(this.ctx, this.map, this.battle);
        this.resize = new ResizeObserver(() => this.ctx.setSize());
        this.resize.observe(canvas.parentElement!);
        this.ctx.setSize();
        this.frame = requestAnimationFrame(t => this.loop(t));
    }
    private loop(time: number) {
        if (!this.running)
            return;
        const dt = Math.min(.1, (time - (this.last || time)) / 1000);
        this.last = time;
        const s = this.ctx.state(), c = this.ctx.c, key = s.mode === 'world' ? `world:fields:${mapArtReady()}:${mapOverviewReady()}` : `${s.mode}:${s.battle?.id ?? ''}:${s.battle?.terrain ?? 'plains'}:${gameImage('ground').complete}:${gameImage('props').complete}`;
        if (key !== this.terrainKey) {
            if (!this.terrainKey && s.mode === 'battle')
                this.ctx.camera.zoom = 1.15;
            this.terrainKey = key;
            this.ctx.terrain = makeTerrain(s.mode === 'world' ? 'world' : 'battle', s.battle?.terrain);
            this.battle.reset();
            this.ctx.setSize();
        }
        if (s.mode === 'world' && s.mapFocus && s.mapFocus.key !== this.lastMapFocus) {
            this.lastMapFocus = s.mapFocus.key;
            this.ctx.camera.x = s.mapFocus.x;
            this.ctx.camera.y = s.mapFocus.y;
            this.ctx.camera.zoom = clamp(s.mapFocus.zoom === 0 ? this.ctx.mapMinZoom : s.mapFocus.zoom ?? (this.ctx.w < 600 ? 3.2 : 1.8), this.ctx.mapMinZoom, 5);
        }
        if (s.mode === 'battle' && this.ctx.w < 600) {
            const key = s.selectedIds.join(',');
            if (key !== this.lastSelection) {
                this.lastSelection = key;
                this.ctx.focus('own');
            }
            if (s.touchOrder !== this.lastTouchOrder) {
                this.lastTouchOrder = s.touchOrder ?? 'select';
                if (s.touchOrder === 'attack')
                    this.ctx.focus('enemy');
            }
        }
        const scale = this.ctx.zoomBase * this.ctx.camera.zoom, pan = 260 * dt / this.ctx.camera.zoom;
        if (this.ctx.keys.has('arrowleft') || this.ctx.keys.has('j'))
            this.ctx.camera.x -= pan;
        if (this.ctx.keys.has('arrowright') || this.ctx.keys.has('l'))
            this.ctx.camera.x += pan;
        if (this.ctx.keys.has('arrowup') || this.ctx.keys.has('i'))
            this.ctx.camera.y -= pan;
        if (this.ctx.keys.has('arrowdown') || this.ctx.keys.has('k'))
            this.ctx.camera.y += pan;
        if (s.mode === 'world') this.ctx.constrainMapCamera();
        else {
            this.ctx.camera.x = clamp(this.ctx.camera.x, 0, 1200);
            this.ctx.camera.y = clamp(this.ctx.camera.y, 0, 700);
        }
        if (s.mode === 'world') {
            const margin = CELL_SIZE * 4;
            const bounds = {
                minX: Math.max(WORLD_MIN_X, Math.floor((this.ctx.camera.x - this.ctx.w / scale / 2 - margin) / CELL_SIZE) * CELL_SIZE),
                minY: Math.max(WORLD_MIN_Y, Math.floor((this.ctx.camera.y - this.ctx.h / scale / 2 - margin) / CELL_SIZE) * CELL_SIZE),
                maxX: Math.min(WORLD_MAX_X, Math.ceil((this.ctx.camera.x + this.ctx.w / scale / 2 + margin) / CELL_SIZE) * CELL_SIZE),
                maxY: Math.min(WORLD_MAX_Y, Math.ceil((this.ctx.camera.y + this.ctx.h / scale / 2 + margin) / CELL_SIZE) * CELL_SIZE),
            };
            const viewport = `${bounds.minX}:${bounds.minY}:${bounds.maxX}:${bounds.maxY}`;
            if (viewport !== this.lastViewport) { this.lastViewport = viewport; this.ctx.actions().mapViewport?.(bounds); }
        }
        c.setTransform(this.ctx.dpr, 0, 0, this.ctx.dpr, 0, 0);
        c.fillStyle = '#30362b';
        c.fillRect(0, 0, this.ctx.w, this.ctx.h);
        c.save();
        c.translate(this.ctx.w / 2, this.ctx.h / 2);
        c.scale(scale, scale);
        c.translate(-this.ctx.camera.x, -this.ctx.camera.y);
        if (s.mode === 'world') this.map.drawTerrain();
        else { c.drawImage(this.ctx.terrain!, 0, 0); this.overlays.water(preferences().reducedMotion ? 0 : time); }
        if (s.mode === 'world')
            this.map.draw(preferences().reducedMotion || !preferences().effects ? 0 : time);
        else
            this.battle.draw(s.battle!.elapsed * 1000, s.paused ? 0 : dt);
        c.restore();
        if (this.ctx.down && s.mode === 'battle') {
            if (this.ctx.down.button === 0 && Math.hypot(this.ctx.pointer.x - this.ctx.down.x, this.ctx.pointer.y - this.ctx.down.y) > 8) {
                c.fillStyle = '#f1d79712';
                c.strokeStyle = '#f4d896';
                c.lineWidth = 1;
                c.fillRect(this.ctx.down.x, this.ctx.down.y, this.ctx.pointer.x - this.ctx.down.x, this.ctx.pointer.y - this.ctx.down.y);
                c.strokeRect(this.ctx.down.x, this.ctx.down.y, this.ctx.pointer.x - this.ctx.down.x, this.ctx.pointer.y - this.ctx.down.y);
            }
            else if (this.ctx.down.button === 2) {
                c.strokeStyle = '#f1dfad';
                c.lineWidth = 3;
                c.beginPath();
                c.moveTo(this.ctx.down.x, this.ctx.down.y);
                c.lineTo(this.ctx.pointer.x, this.ctx.pointer.y);
                c.stroke();
            }
        }
        this.overlays.minimap();
        if (s.mode === 'world') this.map.drawHUD();
        this.battle.hover();
        this.frame = requestAnimationFrame(t => this.loop(t));
    }
    zoom(delta: number) { this.ctx.zoom(delta); }
    focus(side: 'own' | 'enemy') { this.ctx.focus(side); }
    focusMap(target: 'home' | 'army') { this.ctx.focusMap(target); }
    center(x?: number, y?: number) { this.ctx.center(x, y); }
    destroy() { this.running = false; cancelAnimationFrame(this.frame); this.resize.disconnect(); this.input.destroy(); }
}
