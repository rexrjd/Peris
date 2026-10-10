import { type RenderActions, type RenderState } from '../../../../shared/rendering/contracts';
import { type Formation } from '../../domain/types';
import { BattleCamera } from './BattleCamera';
import { battleInteraction, commandable, type BattleGesture, type Point } from './interaction';
import { preferences } from '../../../../platform/preferences/preferences';

export class BattleInput {
    private readonly cleanup: (() => void)[] = [];
    private gesture: (BattleGesture & { pointerId: number; pan: boolean; last: Point }) | null = null;
    private readonly touches = new Map<number, Point>();
    private pinch: { distance: number; midpoint: Point } | null = null;
    private readonly keys = new Set<string>();
    constructor(private readonly canvas: HTMLCanvasElement, private readonly view: BattleCamera,
        private readonly state: () => RenderState, private readonly actions: () => RenderActions,
        private readonly hit: (p: Point) => Formation | undefined,
        private readonly project: (f: Formation) => Point & { visible: boolean },
        private readonly preview: (gesture: BattleGesture | null) => void) { this.bind(); }
    private on(target: EventTarget, name: string, fn: EventListener, options?: AddEventListenerOptions) {
        target.addEventListener(name, fn, options); this.cleanup.push(() => target.removeEventListener(name, fn, options));
    }
    private coords(e: PointerEvent) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    private reset() { this.gesture = null; this.touches.clear(); this.pinch = null; this.keys.clear(); this.preview(null); }
    private bind() {
        this.on(this.canvas, 'contextmenu', e => e.preventDefault());
        this.on(this.canvas, 'pointerdown', ((e: PointerEvent) => {
            e.preventDefault(); this.canvas.focus(); this.canvas.setPointerCapture(e.pointerId);
            const p = this.coords(e);
            if (e.pointerType === 'touch') {
                this.touches.set(e.pointerId, p);
                if (this.touches.size >= 2) {
                    const [a, b] = [...this.touches.values()];
                    this.pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
                    this.gesture = null; this.preview(null); return;
                }
                if (this.pinch) return;
            }
            if (this.gesture) return;
            const pan = e.button === 1 || (e.button === 0 && e.altKey);
            this.gesture = { start: p, end: p, ground: this.view.ground(p.x, p.y), startGround: this.view.ground(p.x, p.y),
                button: e.button, shift: e.shiftKey, pointerId: e.pointerId, pan, last: p };
        }) as EventListener);
        this.on(this.canvas, 'pointermove', ((e: PointerEvent) => {
            const p = this.coords(e);
            if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, p);
            if (this.pinch) {
                if (this.touches.size < 2) return;
                const [a, b] = [...this.touches.values()], distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                this.view.zoom(distance / this.pinch.distance, midpoint);
                this.view.pan(midpoint.x - this.pinch.midpoint.x, midpoint.y - this.pinch.midpoint.y);
                this.pinch = { distance, midpoint }; return;
            }
            const gesture = this.gesture;
            if (!gesture || gesture.pointerId !== e.pointerId) return;
            if (gesture.pan) this.view.pan(p.x - gesture.last.x, p.y - gesture.last.y);
            gesture.last = p; gesture.end = p; gesture.ground = this.view.ground(p.x, p.y);
            if (!gesture.pan) this.preview(gesture);
        }) as EventListener);
        this.on(this.canvas, 'pointerup', ((e: PointerEvent) => {
            this.touches.delete(e.pointerId);
            const gesture = this.gesture; this.gesture = null; this.preview(null);
            if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
            if (this.pinch) { if (!this.touches.size) this.pinch = null; return; }
            if (!gesture || gesture.pointerId !== e.pointerId || gesture.pan) return;
            const p = this.coords(e);
            const result = battleInteraction(this.state(), { ...gesture, end: p, ground: this.view.ground(p.x, p.y) }, this.hit(p), this.project, preferences().simpleOrders);
            if (result && 'select' in result) this.actions().selectUnits(result.select);
            if (result && 'order' in result) this.actions().order(result.order);
        }) as EventListener);
        this.on(this.canvas, 'pointercancel', () => this.reset());
        this.on(this.canvas, 'lostpointercapture', ((e: PointerEvent) => { if (this.gesture?.pointerId === e.pointerId) { this.gesture = null; this.preview(null); } }) as EventListener);
        this.on(window, 'blur', () => this.reset());
        this.on(this.canvas, 'wheel', ((e: WheelEvent) => {
            e.preventDefault(); const rect = this.canvas.getBoundingClientRect();
            this.view.zoom(Math.exp(-e.deltaY * .001), { x: e.clientX - rect.left, y: e.clientY - rect.top });
        }) as EventListener, { passive: false });
        this.on(window, 'keydown', ((e: KeyboardEvent) => {
            const k = e.key.toLowerCase(), target = e.target as HTMLElement;
            if (target?.closest('input,select,textarea') || (target?.closest('button') && (k === ' ' || k === 'enter')) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role="dialog"]')) return;
            const state = this.state(), actions = this.actions();
            if (!['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'q', 'e', '+', '=', '-', '0', 'f', 'a', 'h', 'g', 'r', ' ', 'escape'].includes(k) && !/^[1-9]$/.test(k)) return;
            e.preventDefault(); this.keys.add(k);
            if (e.repeat) return;
            const own = state.world.formations.filter(f => f.battle_id === state.battle?.id && commandable(f, state.playerId));
            if (k === 'a') actions.selectUnits(own.map(f => f.id));
            if (k === 'h' && state.selectedIds.length) actions.order({ kind: 'halt', ids: state.selectedIds });
            if (k === 'g' && state.selectedIds.length) actions.order({ kind: 'stance', ids: state.selectedIds, stance: 'guard' });
            if (k === 'r') actions.rally();
            if (k === ' ') actions.pause();
            if (k === 'escape') { actions.menu?.(); actions.selectUnits([]); this.reset(); }
            if (/^[1-9]$/.test(k) && own[Number(k) - 1]) actions.selectUnits([own[Number(k) - 1].id]);
            if (k === 'f') { const f = own.find(f => state.selectedIds.includes(f.id)); if (f) this.view.focus(f.x, f.y); }
            if (k === '+' || k === '=') this.view.zoom(1.25);
            if (k === '-') this.view.zoom(.8);
            if (k === '0') this.view.center();
        }) as EventListener);
        this.on(window, 'keyup', ((e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); }) as EventListener);
    }
    update(dt: number) {
        if (document.querySelector('[role="dialog"]')) { this.keys.clear(); return; }
        const amount = dt * 420;
        const dx = (Number(this.keys.has('arrowleft')) - Number(this.keys.has('arrowright'))) * amount,
            dy = (Number(this.keys.has('arrowup')) - Number(this.keys.has('arrowdown'))) * amount;
        if (dx || dy) this.view.pan(dx, dy);
        const rotation = (Number(this.keys.has('e')) - Number(this.keys.has('q'))) * dt;
        if (rotation) this.view.rotate(rotation);
    }
    destroy() { this.cleanup.forEach(fn => fn()); this.reset(); }
}
