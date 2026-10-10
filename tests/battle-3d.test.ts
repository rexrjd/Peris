import { FIELD_W,FIELD_H,FIELD_SCALE } from '../src/features/battle/domain/dimensions';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Group, InstancedMesh, Matrix4, Vector3 } from 'three';
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
import { createLowPolySoldiers, soldierSlots, strikeAnimation } from '../src/features/battle/rendering/three/soldiers';
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
            for (const x of [0, FIELD_W]) for (const y of [0, FIELD_H]) assert.ok(camera.project(x, y).visible);
        }
    }
    camera.focus(-500, FIELD_H+500); near(camera.target.x, 0); near(camera.target.z, FIELD_H);
    camera.zoom(1e9); assert.ok(camera.span >= 120);
});

test('siege inspection fits tall roofs and wide living siege bounds in landscape and portrait viewports',()=>{
    for(const [width,height] of [[1345,620],[390,300],[300,600]])for(const size of [[38,42,24],[80,28,55]]){
        const camera=new BattleCamera(()=>4);camera.setSize(width,height);
        const bounds=new Box3(new Vector3(75-size[0]/2,4,290-size[2]/2),new Vector3(75+size[0]/2,4+size[1],290+size[2]/2));
        camera.inspectBounds(bounds);assert.equal(camera.inspecting,true);
        near(camera.target.y,4+size[1]/2);
        for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
            const corner=new Vector3(x,y,z).project(camera.camera);
            assert.ok(Math.abs(corner.x)<.8&&Math.abs(corner.y)<.8,'Every model corner fits with room for inspection controls');
        }
    }
});

test('visual high ground and terrain coloring retain the existing tactical terrain footprints', () => {
    assert.equal(terrainAt('highlands', 650*FIELD_SCALE, 285*FIELD_SCALE).kind, 'High ground'); assert.equal(battlefieldHeight('highlands', 650*FIELD_SCALE, 285*FIELD_SCALE), 28);
    assert.equal(battlefieldHeight('highlands', 50, 50), 0);
    for (const terrain of ['plains', 'woods', 'river', 'highlands'] as const) {
        const scene = createBattlefield(terrain);
        assert.ok(scene.children.length >= 1);
        disposeObject(scene);
    }
});

test('3D inspection selects either side, including routed units, and never issues movement or attack orders', () => {
    const { state, own, enemy } = setup();
    const before = structuredClone(state.world.formations);
    assert.deepEqual(battleInteraction(state, gesture(), enemy), { select: [enemy.id] });
    assert.deepEqual(battleInteraction(state, { ...gesture(), shift: true }, own[0]), { select: [] });
    own[1].status = 'routed';
    assert.deepEqual(battleInteraction(state, gesture(), own[1]), { select: [own[1].id] });
    own[1].status = before.find(f => f.id === own[1].id)!.status;
    for (const phase of ['deployment', 'combat'] as const) for (const touchOrder of ['select', 'move', 'attack'] as const) {
        state.battle!.phase = phase; state.touchOrder = touchOrder;
        assert.deepEqual(battleInteraction(state, gesture(), enemy), { select: [enemy.id] });
        assert.equal(battleInteraction(state, gesture(2), enemy), null);
        assert.equal(battleInteraction(state, { ...gesture(), end: { x: 200, y: 200 } }, enemy), null);
        assert.deepEqual(battleInteraction(state, gesture(), undefined), { select: [] });
    }
    assert.deepEqual(state.world.formations, before);
    enemy.soldiers = 0;
    assert.deepEqual(battleInteraction(state, gesture(), enemy), { select: [] });
});

test('3D casualties keep the initial formation grid and real strikes gate attack animation', () => {
    const { own } = setup(); const f = { ...own[0], soldiers: 60, initial_soldiers: 60, columns: 10 };
    const original = soldierSlots(f);
    f.soldiers = 17;
    assert.ok(soldierSlots(f).every(slot => original.some(p => p.x === slot.x && p.y === slot.y)));
    f.status = 'engaged';
    assert.equal(strikeAnimation(f, 3), false);
    f.attack_ready_at = 4.2;
    assert.equal(strikeAnimation(f, 3.1), true);
    assert.equal(strikeAnimation(f, 3.8), false);
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

test('large mount silhouettes keep their visual picking and inspection inside the original formation command contract',()=>{
    const {state,own}=setup('highlands'),savedDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({dataset:{},style:{},hidden:false,textContent:'',remove(){}})}});
    try {
        const view=new BattleCamera((x,y)=>battlefieldHeight('highlands',x,y));view.setSize(1200,700);view.focus(650,285);
        const scene=Object.create(BattleScene.prototype);
        Object.assign(scene,{scene:new Scene(),view,state:()=>state,labels:{append(){}},soldiers:createLowPolySoldiers,ray:new Raycaster(),formations:new Map(),visualTime:0});
        const f={...own[0],unit_type:'cavalry' as const,soldiers:20,columns:4,x:650,y:285,facing:0},before=structuredClone(f);
        state.world.formations=[f];state.selectedIds=[f.id];
        const record=scene.create(f);scene.formations.set(f.id,record);
        record.soldiers.object.userData.renderFootprint={depthScale:3.375,widthScale:2.25};
        record.soldiers.object.userData.inspectionBounds=new Box3(new Vector3(584,28,250),new Vector3(716,76,320));
        scene.updateFormation(f,record,0);scene.inspect(f.id);
        assert.equal(scene.hit(view.project(710,285,35))?.id,f.id,'The outer tall silhouette selects its existing cavalry formation');
        assert.equal(scene.hit(view.project(900,285,35)),undefined,'Expanded picking still excludes unrelated terrain');
        near(view.target.y,52);assert.equal(view.inspecting,true);
        assert.deepEqual(f,before,'Visual bounds never rewrite logical formation or orders');
        scene.remove(record);
    } finally {if(savedDocument)Object.defineProperty(globalThis,'document',savedDocument);else Reflect.deleteProperty(globalThis,'document');}
});

test('graphics interruption reports fallback exactly once and disposes scene resources and listeners', () => {
    const savedCancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
    let cancelled = 0, disconnected = 0, inputDisposed = 0, rendererDisposed = 0, removedListener = 0, fallback = 0, materialDisposed = 0, showcaseDisposed=0;
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => { cancelled++; } });
    try {
        const scene = Object.create(BattleScene.prototype), rendered = createBattlefield('plains');
        const showcase=new Group();showcase.userData.disposeShowcase=()=>showcaseDisposed++;rendered.add(showcase);
        rendered.traverse(object => { const material = (object as any).material; if (material) material.addEventListener('dispose', () => { materialDisposed++; }); });
        Object.assign(scene, { alive: true, frame: 1, scene: rendered, observer: { disconnect() { disconnected++; } },
            input: { destroy() { inputDisposed++; } }, formations: new Map(), showcases:[showcase], canvas: { removeEventListener() { removedListener++; } },
            sun: { shadow: { dispose() {} } }, renderer: { dispose() { rendererDisposed++; }, forceContextLoss() {} }, labels: { replaceChildren() {} },
            unavailable: () => { fallback++; } });
        scene.fail(); scene.fail(); scene.destroy();
        assert.deepEqual([cancelled, disconnected, inputDisposed, rendererDisposed, removedListener, fallback, materialDisposed,showcaseDisposed], [1, 1, 1, 1, 1, 1, 1,1]);
    } finally {
        if (savedCancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', savedCancel); else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
    }
});
