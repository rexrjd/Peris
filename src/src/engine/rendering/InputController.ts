import { RenderContext } from '../../shared/rendering/RenderContext';
import { MapRenderer } from '../../features/map/rendering/MapRenderer';
import { BattleRenderer } from '../../features/battle/rendering/BattleRenderer';
import { clamp } from '../../shared/math/geometry';
import { tone } from '../../platform/audio/audio';
import { preferences } from '../../platform/preferences/preferences';
export class InputController {
    private cleanup: (() => void)[] = [];
    constructor(private ctx: RenderContext, private map: MapRenderer, private battle: BattleRenderer) { this.bind(); }
    private on(target: EventTarget, event: string, fn: EventListener, options?: AddEventListenerOptions) { target.addEventListener(event, fn, options); this.cleanup.push(() => target.removeEventListener(event, fn, options)); }
    private coords(e: PointerEvent) { const r = this.ctx.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    bind() {
        this.on(this.ctx.canvas, 'contextmenu', e => e.preventDefault());
        this.on(this.ctx.canvas, 'pointerdown', ((e: PointerEvent) => {
            e.preventDefault();
            this.ctx.canvas.focus();
            this.ctx.canvas.setPointerCapture(e.pointerId);
            const p = this.coords(e), wp = this.ctx.worldPoint(p.x, p.y);
            this.ctx.pointer = p;
            this.ctx.down = { ...p, wx: wp.x, wy: wp.y, button: e.button, shift: e.shiftKey };
            const mini = this.ctx.miniBounds();
            if (p.x >= mini.x && p.x <= mini.x + mini.w && p.y >= mini.y && p.y <= mini.y + mini.h) {
                this.ctx.minimapDrag = true;
                this.ctx.panMinimap(p);
            }
        }) as EventListener);
        this.on(this.ctx.canvas, 'pointermove', ((e: PointerEvent) => {
            const p = this.coords(e), s = this.ctx.state();
            if (this.ctx.minimapDrag) {
                this.ctx.panMinimap(p);
                this.ctx.pointer = p;
                return;
            }
            if (this.ctx.down && (this.ctx.down.button === 1 || (s.mode === 'world' && !s.moveMode && this.ctx.down.button === 0))) {
                const scale = this.ctx.zoomBase * this.ctx.camera.zoom;
                this.ctx.camera.x -= (p.x - this.ctx.pointer.x) / scale;
                this.ctx.camera.y -= (p.y - this.ctx.pointer.y) / scale;
            }
            this.ctx.pointer = p;
        }) as EventListener);
        this.on(this.ctx.canvas, 'pointerup', ((e: PointerEvent) => {
            if (!this.ctx.down)
                return;
            const down = this.ctx.down;
            this.ctx.down = null;
            const p = this.coords(e), wp = this.ctx.worldPoint(p.x, p.y), s = this.ctx.state(), a = this.ctx.actions(), drag = Math.hypot(p.x - down.x, p.y - down.y);
            if (this.ctx.minimapDrag) {
                this.ctx.minimapDrag = false;
                return;
            }
            if (s.mode === 'world') {
                if (s.moveMode && (e.button === 0 || e.button === 2)) {
                    a.moveArmy(wp.x, wp.y);
                    return;
                }
                if (drag > 7 || e.button === 1)
                    return;
                const target = this.map.hit(wp.x, wp.y);
                a.selectMap(target);
                return;
            }
            const formations = s.world.formations.filter(f => f.battle_id === s.battle?.id);
            const hit = this.battle.hit(wp.x, wp.y, formations);
            if (e.button === 2 || s.touchOrder === 'move' || s.touchOrder === 'attack') {
                if (!s.selectedIds.length)
                    return;
                if (hit && hit.owner_id !== s.playerId && s.battle?.phase === 'combat') {
                    a.order({ kind: 'attack', ids: s.selectedIds, target: hit.id });
                    return;
                }
                if (s.touchOrder === 'attack')
                    return;
                if (drag > 18 && e.button === 2) {
                    const start = this.ctx.worldPoint(down.x, down.y), dx = wp.x - start.x, dy = wp.y - start.y;
                    a.order({ kind: 'move', ids: s.selectedIds, x: (wp.x + start.x) / 2, y: (wp.y + start.y) / 2, facing: Math.atan2(dy, dx) * 180 / Math.PI - 90, columns: clamp(Math.round(Math.hypot(dx, dy) / Math.max(1, s.selectedIds.length) / 8), 4, 20) });
                }
                else
                    a.order({ kind: 'move', ids: s.selectedIds, x: wp.x, y: wp.y });
                return;
            }
            if (e.button !== 0)
                return;
            if (drag > 8) {
                const start = this.ctx.worldPoint(down.x, down.y), x1 = Math.min(start.x, wp.x), x2 = Math.max(start.x, wp.x), y1 = Math.min(start.y, wp.y), y2 = Math.max(start.y, wp.y);
                const ids = formations.filter(f => f.owner_id === s.playerId && f.soldiers > 0 && f.status !== 'routed' && f.x >= x1 && f.x <= x2 && f.y >= y1 && f.y <= y2).map(f => f.id);
                a.selectUnits(down.shift ? [...new Set([...s.selectedIds, ...ids])] : ids);
            }
            else if (hit?.owner_id === s.playerId) {
                a.selectUnits(down.shift ? (s.selectedIds.includes(hit.id) ? s.selectedIds.filter(id => id !== hit.id) : [...s.selectedIds, hit.id]) : [hit.id]);
                tone('select');
            }
            else if (preferences().simpleOrders && s.selectedIds.length && !down.shift) {
                if (hit && s.battle?.phase === 'combat')
                    a.order({ kind: 'attack', ids: s.selectedIds, target: hit.id });
                else if (!hit)
                    a.order({ kind: 'move', ids: s.selectedIds, x: wp.x, y: wp.y });
            }
            else
                a.selectUnits([]);
        }) as EventListener);
        this.on(this.ctx.canvas, 'pointercancel', () => { this.ctx.down = null; this.ctx.minimapDrag = false; });
        this.on(this.ctx.canvas, 'wheel', ((e: WheelEvent) => {
            e.preventDefault();
            const before = this.ctx.worldPoint(this.ctx.pointer.x, this.ctx.pointer.y);
            this.ctx.camera.zoom = clamp(this.ctx.camera.zoom * Math.exp(-e.deltaY * .001), .3, 3.2);
            const after = this.ctx.worldPoint(this.ctx.pointer.x, this.ctx.pointer.y);
            this.ctx.camera.x += before.x - after.x;
            this.ctx.camera.y += before.y - after.y;
        }) as EventListener, { passive: false });
        this.on(window, 'keydown', ((e: KeyboardEvent) => {
            if ((e.target as HTMLElement)?.closest('input,select,textarea') || e.ctrlKey || e.metaKey)
                return;
            if (document.querySelector('[role="dialog"]'))
                return;
            const k = e.key.toLowerCase();
            this.ctx.keys.add(k);
            const s = this.ctx.state(), a = this.ctx.actions();
            if (s.mode !== 'battle')
                return;
            if ([' ', 'a', 'h', 'g', 'r', 'f'].includes(k))
                e.preventDefault();
            const own = s.world.formations.filter(f => f.battle_id === s.battle?.id && f.owner_id === s.playerId && f.soldiers > 0 && f.status !== 'routed');
            if (k === 'a')
                a.selectUnits(own.map(f => f.id));
            if (k === 'h')
                a.order({ kind: 'halt', ids: s.selectedIds });
            if (k === 'g')
                a.order({ kind: 'stance', ids: s.selectedIds, stance: 'guard' });
            if (k === 'r')
                a.rally();
            if (k === ' ')
                a.pause();
            if (k === 'escape') {
                a.menu?.();
                a.selectUnits([]);
            }
            if (/^[1-9]$/.test(k)) {
                const f = own[Number(k) - 1];
                if (f)
                    a.selectUnits([f.id]);
            }
            if (k === 'f' && s.selectedIds.length) {
                const f = own.find(f => f.id === s.selectedIds[0]);
                if (f) {
                    this.ctx.camera.x = f.x;
                    this.ctx.camera.y = f.y;
                }
            }
        }) as EventListener);
        this.on(window, 'keyup', ((e: KeyboardEvent) => { this.ctx.keys.delete(e.key.toLowerCase()); }) as EventListener);
        this.on(window, 'blur', () => { this.ctx.keys.clear(); this.ctx.down = null; });
    }
    destroy() { this.cleanup.forEach(fn => fn()); this.cleanup = []; }
}
