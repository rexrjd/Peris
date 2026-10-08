import assert from 'node:assert/strict';
import test from 'node:test';
import { InstancedMesh, Matrix4, Vector3 } from 'three';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { newBattle } from '../src/features/battle/domain/creation';
import { applyOrder } from '../src/features/battle/domain/orders';
import { stepBattle } from '../src/features/battle/domain/simulation';
import { terrainAt } from '../src/features/battle/domain/terrain';
import { formationSize } from '../src/features/battle/domain/formations';
import { type Formation, type Terrain } from '../src/features/battle/domain/types';
import { type RenderState } from '../src/shared/rendering/contracts';
import { BattleCamera } from '../src/features/battle/rendering/three/BattleCamera';
import { battlefieldHeight, createBattlefield } from '../src/features/battle/rendering/three/terrain';
import { battleInteraction, type BattleGesture } from '../src/features/battle/rendering/three/interaction';
import { createLowPolySoldiers, soldierSlots } from '../src/features/battle/rendering/three/soldiers';
import { disposeObject } from '../src/features/battle/rendering/three/dispose';
import { BattleScene } from '../src/features/battle/rendering/three/BattleScene';
import { Raycaster, Scene } from 'three';

const near = (a: number, b: number, tolerance = .01) => assert.ok(Math.abs(a - b) < tolerance, `${a} should equal ${b}`);
function setup(terrain: Terrain = 'plains') {
    const world = createSolo('Test'), instance = newBattle(1, 'solo-ruler', world.armies[0], { infantry: 120, archers: 40, cavalry: 24 }, terrain, 'normal', 'Enemy');
    world.battles = [instance.battle]; world.formations = instance.formations;
    const own = world.formations.filter(f => f.owner_id === 'solo-ruler'), enemy = world.formations.find(f => f.side === 'defender')!;
    const state: RenderState = { world, playerId: 'solo-ruler', mode: 'battle', battle: instance.battle, selectedIds: [own[0].id], touchOrder: 'select' };
    return { state, own, enemy, battle: instance.battle };
}
const gesture = (button = 0): BattleGesture => ({ button, shift: false, start: { x: 10, y: 10 }, end: { x: 10, y: 10 }, startGround: { x: 220, y: 250 }, ground: { x: 220, y: 250 } });
const project = (f: Formation) => ({ x: f.x, y: f.y, visible: true });

test('3D projection and ground picking preserve battle coordinates across terrains, zooms and rotations', () => {
    for (const terrain of ['plains', 'woods', 'river', 'highlands'] as const) for (const yaw of [0, .8, -1.4]) {
        const camera = new BattleCamera((x, y) => battlefieldHeight(terrain, x, y)); camera.setSize(1200, 700);
        camera.yaw = yaw; camera.focus(650, 285);
        for (const [x, y] of [[650, 285], [600, 250], [710, 300], [580, 330]]) {
            const p = camera.project(x, y), ground = camera.ground(p.x, p.y)!;
            near(ground.x, x); near(ground.y, y);
        }
        const anchor = camera.project(620, 300), before = camera.ground(anchor.x, anchor.y)!;
        camera.zoom(1.3, anchor); const after = camera.project(before.x, before.y);
        near(after.x, anchor.x, .1); near(after.y, anchor.y, .1);
    }
});

test('overview and resized/rotated cameras frame the entire battlefield, including mobile portrait', () => {
    const camera = new BattleCamera(() => 0);
    for (const [width, height] of [[1200, 600], [390, 600], [1600, 400]]) {
        camera.setSize(width, height); camera.center();
        for (const rotation of [0, .5, -.9]) {
            camera.rotate(rotation);
            for (const x of [0, 1200]) for (const y of [0, 700]) assert.ok(camera.project(x, y).visible);
        }
    }
    camera.focus(-500, 1000); near(camera.target.x, 0); near(camera.target.z, 700);
    camera.zoom(1e9); assert.ok(camera.span >= 120);
});

test('visual high ground and terrain coloring retain the existing tactical terrain footprints', () => {
    assert.equal(terrainAt('highlands', 650, 285).kind, 'High ground'); assert.equal(battlefieldHeight('highlands', 650, 285), 28);
    assert.equal(battlefieldHeight('highlands', 50, 50), 0);
    for (const terrain of ['plains', 'woods', 'river', 'highlands'] as const) {
        const scene = createBattlefield(terrain);
        assert.ok(scene.children.length >= 1);
        disposeObject(scene);
    }
});

test('selection toggles own formations and screen-space group selection excludes enemies, fallen and routed troops', () => {
    const { state, own, enemy } = setup();
    assert.deepEqual(battleInteraction(state, gesture(), own[1], project, true), { select: [own[1].id] });
    assert.deepEqual(battleInteraction(state, { ...gesture(), shift: true }, own[0], project, true), { select: [] });
    own[1].status = 'routed';
    const drag = { ...gesture(), start: { x: 0, y: 0 }, end: { x: 1200, y: 700 } };
    const result = battleInteraction(state, drag, undefined, project, false);
    assert.ok(result && 'select' in result);
    assert.ok(!result.select.includes(enemy.id)); assert.ok(!result.select.includes(own[1].id));
    assert.deepEqual(result.select, own.filter(f => f.status !== 'routed').map(f => f.id));
    state.selectedIds = [enemy.id, own[1].id];
    assert.equal(battleInteraction(state, gesture(2), undefined, project, true), null);
});

test('3D move and line gestures use the original deployment, frontage and facing rules', () => {
    const { state, own, battle } = setup();
    const result = battleInteraction(state, gesture(2), undefined, project, true);
    assert.ok(result && 'order' in result); applyOrder(battle, state.world.formations, state.playerId, result.order);
    near(own[0].x, 220); near(own[0].y, 250);
    const line = battleInteraction(state, { ...gesture(2), end: { x: 10, y: 120 }, ground: { x: 220, y: 330 } }, undefined, project, true);
    assert.ok(line && 'order' in line); applyOrder(battle, state.world.formations, state.playerId, line.order);
    near(own[0].facing, 0); assert.equal(own[0].columns, 10); near(own[0].y, 290);
    assert.throws(() => applyOrder(battle, state.world.formations, state.playerId, { kind: 'move', ids: state.selectedIds, x: 800, y: 350 }), /shaded zone/);
});

test('touch and mouse attack commands use the existing combat simulation and cannot attack before combat', () => {
    const { state, own, enemy, battle } = setup(); state.touchOrder = 'attack';
    assert.equal(battleInteraction(state, gesture(), enemy, project, true), null);
    battle.phase = 'combat';
    const attack = battleInteraction(state, gesture(), enemy, project, true);
    assert.ok(attack && 'order' in attack); applyOrder(battle, state.world.formations, state.playerId, attack.order);
    assert.equal(own[0].target_formation_id, enemy.id);
    const x = own[0].x; stepBattle(battle, state.world.formations, .05); assert.ok(own[0].x > x);
    enemy.status = 'routed'; assert.equal(battleInteraction(state, gesture(), enemy, project, true), null);
    assert.equal(battleInteraction(state, gesture(1), undefined, project, true), null);
});

test('low-poly formations stay bounded, reflect casualties and facing, and never mutate authoritative state', () => {
    const { own } = setup('highlands');
    for (const type of ['infantry', 'archers', 'cavalry'] as const) {
        const f = { ...own[0], unit_type: type, x: 650, y: 285, facing: 90, soldiers: 500, columns: 20 };
        const before = structuredClone(f), visual = createLowPolySoldiers(f), size = formationSize(f), slots = soldierSlots(f);
        assert.equal(slots.length, 120); assert.ok(slots.every(p => Math.abs(p.x) < size.depth / 2 && Math.abs(p.y) < size.width / 2));
        visual.update({ formation: f, pose: f, time: 0, dt: 0, animate: false, height: (x, y) => battlefieldHeight('highlands', x, y) });
        near(visual.object.rotation.y, -Math.PI / 2); assert.deepEqual(f, before);
        const mesh = visual.object.children[0] as InstancedMesh, matrix = new Matrix4(), position = new Vector3();
        mesh.getMatrixAt(0, matrix); position.setFromMatrixPosition(matrix);
        near(position.y, battlefieldHeight('highlands', f.x - slots[0].y, f.y + slots[0].x));
        f.soldiers = 3; visual.update({ formation: f, pose: f, time: 0, dt: 0, animate: false, height: () => 0 }); assert.equal(mesh.count, 3);
        let disposed = false; mesh.geometry.addEventListener('dispose', () => { disposed = true; }); visual.dispose(); assert.ok(disposed);
    }
});

test('real scene picking follows interpolated rotated formation boxes and view updates preserve battle state', () => {
    const { state, own } = setup('highlands'), savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
        createElement: () => ({ dataset: {}, style: {}, hidden: false, textContent: '', remove() {} }),
    } });
    try {
        // Inject DOM and presentation adapters; exercise the real scene geometry and picking methods.
        const view = new BattleCamera((x, y) => battlefieldHeight('highlands', x, y)); view.setSize(1200, 700); view.focus(650, 285); view.rotate(.6);
        const scene = Object.create(BattleScene.prototype);
        Object.assign(scene, { scene: new Scene(), view, state: () => state, labels: { append() {} }, soldiers: createLowPolySoldiers, ray: new Raycaster(), formations: new Map(), visualTime: 0 });
        const f = { ...own[0], x: 650, y: 285, facing: 80 }, before = structuredClone(f);
        state.world.formations = [f]; const record = scene.create(f); scene.formations.set(f.id, record);
        scene.updateFormation(f, record, .05);
        assert.deepEqual(f, before, 'rendering never writes formation or order state');
        assert.equal(scene.hit(view.project(f.x, f.y, 8))?.id, f.id, 'soldier silhouette selects its existing formation');
        assert.equal(scene.hit(view.project(810, 450)), undefined, 'empty terrain does not select a distant formation');
        assert.ok(record.outline.visible); assert.equal(record.path.visible, false);
        state.paused = true; f.status = 'moving'; f.target_x = 700; scene.updateFormation(f, record, .05);
        assert.ok(record.path.visible && record.destination.visible);
        scene.remove(record); assert.equal(scene.scene.children.length, 0);
    } finally {
        if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else Reflect.deleteProperty(globalThis, 'document');
    }
});

test('graphics interruption reports fallback exactly once and disposes scene resources and listeners', () => {
    const savedCancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
    let cancelled = 0, disconnected = 0, inputDisposed = 0, rendererDisposed = 0, removedListener = 0, fallback = 0, materialDisposed = 0;
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => { cancelled++; } });
    try {
        const scene = Object.create(BattleScene.prototype), rendered = createBattlefield('plains');
        rendered.traverse(object => { const material = (object as any).material; if (material) material.addEventListener('dispose', () => { materialDisposed++; }); });
        Object.assign(scene, { alive: true, frame: 1, scene: rendered, observer: { disconnect() { disconnected++; } },
            input: { destroy() { inputDisposed++; } }, formations: new Map(), canvas: { removeEventListener() { removedListener++; } },
            sun: { shadow: { dispose() {} } }, renderer: { dispose() { rendererDisposed++; }, forceContextLoss() {} }, labels: { replaceChildren() {} },
            unavailable: () => { fallback++; } });
        scene.fail(); scene.fail(); scene.destroy();
        assert.deepEqual([cancelled, disconnected, inputDisposed, rendererDisposed, removedListener, fallback, materialDisposed], [1, 1, 1, 1, 1, 1, 1]);
    } finally {
        if (savedCancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', savedCancel); else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
    }
});
