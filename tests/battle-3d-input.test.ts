import assert from 'node:assert/strict';
import test from 'node:test';
import { BattleInput } from '../src/features/battle/rendering/three/BattleInput';
import { BattleCamera } from '../src/features/battle/rendering/three/BattleCamera';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { newBattle } from '../src/features/battle/domain/creation';
import { type RenderState, type RenderActions } from '../src/shared/rendering/contracts';
import { type BattleOrder } from '../src/features/battle/domain/types';

class Canvas extends EventTarget {
    captured = new Set<number>();
    focus() {}
    closest() { return null; }
    getBoundingClientRect() { return { left: 0, top: 0 }; }
    setPointerCapture(id: number) { this.captured.add(id); }
    hasPointerCapture(id: number) { return this.captured.has(id); }
    releasePointerCapture(id: number) {
        this.captured.delete(id);
        send(this, 'lostpointercapture', { pointerId: id });
    }
}
function send(target: EventTarget, type: string, properties: Record<string, unknown>) {
    const event = new Event(type, { cancelable: true }); Object.assign(event, properties); target.dispatchEvent(event);
}
test('3D event binding handles captured clicks, camera gestures, canceled touches and cleanup without issuing phantom orders', () => {
    const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const windowTarget = new Canvas();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: windowTarget });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
    try {
        const world = createSolo('Input'), { battle, formations } = newBattle(1, 'solo-ruler', world.armies[0], world.camps[0], 'plains', 'normal', 'Enemy');
        world.formations = formations; world.battles = [battle];
        const own = formations.filter(f => f.owner_id === 'solo-ruler'), orders: BattleOrder[] = [], selections: number[][] = [];
        const state: RenderState = { world, playerId: 'solo-ruler', mode: 'battle', battle, selectedIds: [own[0].id], touchOrder: 'move' };
        const canvas = new Canvas(), camera = new BattleCamera(() => 0); camera.setSize(1200, 700); camera.center();
        const actions: RenderActions = { order: o => orders.push(o), selectUnits: ids => { selections.push(ids); }, pause: () => {}, rally: () => {}, moveArmy: () => {}, selectMap: () => {} };
        const input = new BattleInput(canvas as unknown as HTMLCanvasElement, camera, () => state, () => actions, () => undefined,
            f => camera.project(f.x, f.y), () => {});
        const pointer = (id = 1, x = 400, button = 0, pointerType = 'mouse') => ({ pointerId: id, clientX: x, clientY: 300, button, pointerType, shiftKey: false, altKey: false });
        send(canvas, 'pointerdown', pointer()); send(canvas, 'pointerup', pointer());
        assert.equal(orders.length, 1, 'captured click dispatches even if lost-capture fires synchronously');
        send(canvas, 'pointerdown', pointer(1, 400, 1)); send(canvas, 'pointermove', pointer(1, 460, 1)); send(canvas, 'pointerup', pointer(1, 460, 1));
        assert.equal(orders.length, 1, 'middle-drag is camera movement only');
        send(canvas, 'pointerdown', pointer(1, 400, 0, 'touch')); send(canvas, 'pointerdown', pointer(2, 500, 0, 'touch'));
        send(canvas, 'pointermove', pointer(2, 580, 0, 'touch')); send(canvas, 'pointerup', pointer(2, 580, 0, 'touch'));
        send(canvas, 'pointermove', pointer(1, 430, 0, 'touch')); send(canvas, 'pointerup', pointer(1, 430, 0, 'touch'));
        assert.equal(orders.length, 1, 'pinch and its remaining finger never produce a move');
        send(canvas, 'pointerdown', pointer()); send(canvas, 'pointercancel', pointer()); send(canvas, 'pointerup', pointer());
        assert.equal(orders.length, 1, 'cancellation never issues a move');
        state.touchOrder = 'select'; send(windowTarget, 'keydown', { key: 'a', ctrlKey: false, metaKey: false, altKey: false, repeat: false });
        assert.deepEqual(selections.at(-1), own.map(f => f.id));
        input.destroy();
        send(canvas, 'pointerdown', pointer()); send(canvas, 'pointerup', pointer()); send(windowTarget, 'keydown', { key: 'h' });
        assert.equal(orders.length, 1, 'disposed input has no event listeners');
    } finally {
        if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow); else Reflect.deleteProperty(globalThis, 'window');
        if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else Reflect.deleteProperty(globalThis, 'document');
    }
});
