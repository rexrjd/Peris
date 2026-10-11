import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldScene } from '../src/features/map/rendering/three/WorldScene';
import { preferences, setPreferences } from '../src/platform/preferences/preferences';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, OrthographicCamera, Raycaster } from 'three';
import { PreviewCamera } from '../src/features/map/preview/PreviewCamera';
import { sampleHeight } from '../src/features/map/rendering/three/landscape';
import type { MapSelection } from '../src/features/map/domain/types';
import { CELL_SIZE, WORLD_MAX_X, WORLD_MIN_X } from '../src/features/map/domain/dimensions';

/** Exercise the real frame scheduler without allocating WebGL resources. */
function fixture() {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const previousFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
    const previousPreferences = preferences();
    let hidden = false, dialog: { contains(canvas: unknown): boolean } | null = null;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
        get hidden() { return hidden; }, querySelectorAll: () => dialog ? [dialog] : [],
    } });
    Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 1 });
    setPreferences({ reducedMotion: true });
    const world = {
        settlements: [{ id: 1, x: 64, y: 64, name: 'Home', owner_id: 'me', faction: 'roman', map_development: 1, wood: 100 }],
        camps: [], armies: [] as Record<string, unknown>[], buildings: [] as Record<string, unknown>[],
        players: [{ id: 'me', faction: 'roman', upgrades: 0 }], map_plots: [] as Record<string, unknown>[],
        heroes: [] as Record<string, unknown>[],
    };
    const state = { world, playerId: 'me', selectedIds: [], selection: null, mode: 'world' };
    const view = { camera: new OrthographicCamera(), target: { x: 0, y: 0, z: 0 }, span: 12, azimuth: 0, width: 800, height: 500, wrapRevision: 0, isOverview: false, update() {} };
    let draws = 0, synchronized = 0, ready = false, admitted = true;
    const submittedFrames: number[] = [];
    const publishedViews: { x: number; azimuth: number }[] = [], minimapViews: { x: number; azimuth: number }[] = [], wrapVisibility: boolean[] = [];
    const scene = Object.create(WorldScene.prototype) as {
        loop(time: number): void; onScreen: boolean; entities: Map<string, unknown>;
    };
    Object.assign(scene, {
        running: true, lastTime: 0, onScreen: true, redraw: true, idleScanTime: 0, renderInputsKey: '', renderViewKey: '', overlayTime: -Infinity, displayedFrames: 0,
        keys: new Set(), touches: new Map(), state: () => state, view, entities: new Map(), canvas: { style: {} },
        renderer: { render() { draws++; }, shadowMap: {} },
        frameBudget: { ready: () => admitted, get completedFrames() { return submittedFrames.length; }, submitted(time: number) { submittedFrames.push(time); } },
        landscape: { setWrapVisible(visible: boolean) { wrapVisibility.push(visible); }, setView() {}, animate() {} },
        sun: { position: { set() {} }, target: { position: { copy() {} } }, shadow: { camera: { updateProjectionMatrix() {} } } },
        armyModels: { ready: () => ready },
        syncEntities() { synchronized++; }, syncFields() {}, updateSelection() {}, updateRoutes() {}, updateLabels() {},
        drawMinimap() { minimapViews.push({ x: view.target.x, azimuth: view.azimuth }); },
        publishViewport() { publishedViews.push({ x: view.target.x, azimuth: view.azimuth }); },
    });
    return {
        scene, state, world, view, publishedViews, minimapViews, wrapVisibility, submittedFrames, draws: () => draws, synchronized: () => synchronized,
        setHidden(value: boolean) { hidden = value; },
        setDialog(containsMap: boolean | null) { dialog = containsMap === null ? null : { contains: () => containsMap }; },
        setReady(value: boolean) { ready = value; },
        setAdmitted(value: boolean) { admitted = value; },
        restore() {
            setPreferences(previousPreferences);
            for (const [name, descriptor] of [['document', previousDocument], ['requestAnimationFrame', previousFrame]] as const) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else Reflect.deleteProperty(globalThis, name);
            }
        },
    };
}

test('hidden, offscreen and covered maps suspend scene work, while a dialog-owned atlas resumes', () => {
    const f = fixture();
    try {
        f.scene.loop(0); assert.equal(f.draws(), 1);
        f.setHidden(true); f.scene.loop(20);
        f.setHidden(false); f.scene.onScreen = false; f.scene.loop(40);
        f.scene.onScreen = true; f.setDialog(false); f.scene.loop(60);
        assert.equal(f.draws(), 1); assert.equal(f.synchronized(), 1, 'hidden maps must avoid expensive model synchronization too');
        f.setDialog(true); f.scene.loop(80);
        assert.equal(f.draws(), 2, 'a modal containing the map must remain interactive');
        f.setDialog(null); f.scene.loop(300); assert.equal(f.draws(), 2);
    } finally { f.restore(); }
});

test('idle reduced-motion maps ignore income changes but redraw in-place building, field and village changes', () => {
    const f = fixture();
    try {
        f.scene.loop(0); f.scene.loop(20); f.scene.loop(250); assert.equal(f.draws(), 1);
        f.world.settlements[0].wood += 10; f.scene.loop(500); assert.equal(f.draws(), 1);
        f.world.buildings.push({ id: 1, settlement_id: 1, building_type: 'wall', level: 1 });
        f.scene.loop(750); assert.equal(f.draws(), 2);
        f.world.map_plots.push({ col: 1, row: 0, owner_id: 'me', settlement_id: 1, building_type: 'farm', level: 1, faction: 'elf' });
        f.scene.loop(1000); assert.equal(f.draws(), 3);
        f.world.settlements[0].map_development = 2; f.scene.loop(1250); assert.equal(f.draws(), 4);
        f.world.heroes.push({ id: 5, army_id: 4, name: 'New captain', class: 'marshal' });
        f.scene.loop(1500); assert.equal(f.draws(), 5);
    } finally { f.restore(); }
});

test('camera changes and asynchronously published army models wake an idle map', () => {
    const f = fixture();
    try {
        f.scene.entities.set('army:4', { kind: 'army', id: 4, faction: 'roman', model: new Group() });
        f.scene.loop(0); f.scene.loop(20); assert.equal(f.draws(), 1);
        assert.deepEqual(f.publishedViews, [{ x: 0, azimuth: 0 }], 'the first idle frame must publish even before the first periodic overlay bucket');
        f.view.azimuth = .25; f.view.target.x = 1; f.scene.loop(30);
        assert.equal(f.draws(), 2, 'camera changes must not wait for the idle scan');
        assert.deepEqual(f.publishedViews.at(-1), { x: 1, azimuth: .25 }, 'camera center and viewport must follow an immediate idle redraw');
        assert.deepEqual(f.minimapViews, f.publishedViews, 'minimap must reflect the same camera as viewport publication');
        f.setReady(true); f.scene.loop(280); assert.equal(f.draws(), 3, 'published models must replace their temporary geometry');
    } finally { f.restore(); }
});

test('moving armies and ordinary map effects retain their active frame cadence', () => {
    const f = fixture();
    try {
        f.scene.loop(0);
        f.world.armies.push({ id: 4, status: 'moving', x: 64, y: 64 });
        f.scene.loop(16); f.scene.loop(32); assert.equal(f.draws(), 3);
        f.world.armies[0].status = 'idle'; f.scene.loop(250); assert.equal(f.draws(), 4);
        f.scene.loop(500); assert.equal(f.draws(), 4);
        setPreferences({ reducedMotion: false }); f.scene.loop(516); f.scene.loop(532); assert.equal(f.draws(), 6);
    } finally { f.restore(); }
});

test('overview mode invalidates wrapped map images without a camera projection change', () => {
    const f = fixture();
    try {
        f.scene.loop(0); f.scene.loop(250); assert.equal(f.draws(), 1);
        // Entering overview changes map copies and minimap footprints independently of projection.
        const previousMinimapFrames = f.minimapViews.length;
        f.view.isOverview = true; f.scene.loop(260);
        assert.equal(f.draws(), 2, 'an overview-only transition must redraw immediately');
        assert.deepEqual(f.wrapVisibility, [true, false], 'overview must hide repeated realm copies');
        assert.equal(f.minimapViews.length, previousMinimapFrames + 1, 'overview must publish its changed minimap footprint');
        f.scene.loop(500); assert.equal(f.draws(), 2, 'the new overview frame can become idle again');
    } finally { f.restore(); }
});

test('a busy GPU defers map synchronization while camera overlays stay live and dirty changes survive', () => {
    const f = fixture();
    try {
        f.scene.loop(0); assert.deepEqual(f.submittedFrames, [0]);
        f.setAdmitted(false);
        f.view.target.x = 3;
        f.world.map_plots.push({ col: 3, row: 0, owner_id: 'me', settlement_id: 1, building_type: 'farm', level: 1 });
        f.scene.loop(140); f.scene.loop(160);
        assert.equal(f.draws(), 1); assert.equal(f.synchronized(), 1, 'pending GPU work must prevent traversal and buffer updates as well as drawing');
        assert.deepEqual(f.publishedViews.at(-1), { x: 3, azimuth: 0 }, 'camera center and viewport must publish while drawing is deferred');
        assert.deepEqual(f.minimapViews.at(-1), f.publishedViews.at(-1));
        f.setAdmitted(true); f.scene.loop(180);
        assert.equal(f.draws(), 2); assert.equal(f.synchronized(), 2, 'latest mutable fields and camera must be drawn after admission resumes');
        assert.deepEqual(f.submittedFrames, [0, 180], 'only rendered frames may receive GPU fences');
        f.scene.loop(400); assert.equal(f.draws(), 2, 'deferred changes must settle into the normal idle state');
    } finally { f.restore(); }
});

test('canvas picking and march targets use the completed image while a newer camera waits on the GPU', () => {
    const view = new PreviewCamera(sampleHeight);
    view.setSize(800, 500); view.focus(300, 400);
    let completedFrames = 0;
    const scene = Object.create(WorldScene.prototype) as {
        hit(x: number, y: number): MapSelection;
        canvasGround(x: number, y: number): { x: number; y: number } | null;
        copyFrameView(target: PreviewCamera, source: PreviewCamera): void;
        promoteFrameView(): void;
    };
    const pendingView = new PreviewCamera(sampleHeight);
    Object.assign(scene, {
        view, pendingView: null, displayedView: null, displayedFrames: 0, renderViewKey: '',
        frameBudget: { get completedFrames() { return completedFrames; } },
        entities: new Map(), hittable: new Set(),
    });
    assert.equal(scene.hit(400, 250), null, 'a blank initial canvas must not dispatch a selection');
    assert.equal(scene.canvasGround(400, 250), null, 'a blank initial canvas must not dispatch a march');
    Object.assign(scene, { pendingView, renderViewKey: 'first submitted view' });
    scene.copyFrameView(pendingView, view); scene.promoteFrameView();
    assert.equal(scene.hit(400, 250), null, 'an unfinished first image must remain unselectable');
    completedFrames = 1; scene.promoteFrameView();
    const firstSelection = scene.hit(400, 250), firstGround = scene.canvasGround(400, 250);
    assert.ok(firstSelection && firstGround);
    view.focus(900, 800); scene.copyFrameView(pendingView, view); scene.promoteFrameView();
    assert.notDeepEqual(view.ground(400, 250), firstGround, 'logical camera input must continue while drawing is pending');
    assert.deepEqual(scene.hit(400, 250), firstSelection, 'picking must agree with the old image still shown on the canvas');
    assert.deepEqual(scene.canvasGround(400, 250), firstGround, 'a march command must target the displayed field');
    completedFrames = 2; scene.promoteFrameView();
    assert.notDeepEqual(scene.hit(400, 250), firstSelection, 'completion must promote the new camera for picking');
    assert.deepEqual(scene.canvasGround(400, 250), view.ground(400, 250));
});

type PickEntity = { kind: 'army'; id: number; x: number; y: number; model: Group };
function pickingFixture(x = 300, y = 400) {
    const view = new PreviewCamera(sampleHeight); view.setSize(800, 500); view.focus(x, y);
    let completedFrames = 0;
    const pendingView = new PreviewCamera(sampleHeight);
    const scene = Object.create(WorldScene.prototype) as {
        hit(x: number, y: number): MapSelection;
        copyFrameView(target: PreviewCamera, source: PreviewCamera): void;
        capturePickFrame(): void;
        promoteFrameView(): void;
        entities: Map<string, PickEntity>;
        entityCopies: Map<string, Group[]>;
        hittable: Set<string>;
        hittableImages: Map<string, { x: number; y: number }[]>;
        fieldMarkers: InstancedMesh;
        fieldMarkerSelections: MapSelection[];
        displayedPick: { objects: Mesh[]; anchors: { x: number; y: number; lift: number }[] };
    };
    Object.assign(scene, {
        view, pendingView, displayedView: null, displayedFrames: 0, renderViewKey: 'submitted view',
        frameBudget: { get completedFrames() { return completedFrames; } }, pickingRay: new Raycaster(),
        entities: new Map(), entityCopies: new Map(), fields: new Map(), fieldCopies: new Map(),
        hittable: new Set(), hittableImages: new Map(), occlusion: new Map(),
    });
    return {
        scene, view,
        capture() { scene.copyFrameView(pendingView, view); scene.capturePickFrame(); },
        complete() { completedFrames++; scene.promoteFrameView(); },
    };
}

test('completed mesh picking survives moved, hidden and replaced live armies without uploading proxy geometry', () => {
    const f = pickingFixture(), geometry = new BoxGeometry(.5, .8, .5), material = new MeshBasicMaterial();
    const model = new Group(), mesh = new Mesh(geometry, material); mesh.position.y = .4; model.add(mesh);
    model.position.set(300 / CELL_SIZE, sampleHeight(300 / CELL_SIZE, 400 / CELL_SIZE), 400 / CELL_SIZE);
    model.userData.mapSelection = { kind: 'army', id: 1 };
    f.scene.entities.set('army:1', { kind: 'army', id: 1, x: 300, y: 400, model });
    f.capture(); f.complete();
    const point = f.view.project(300, 400, .4), proxy = f.scene.displayedPick.objects[0];
    assert.notEqual(proxy, mesh); assert.equal(proxy.geometry, geometry); assert.equal(proxy.material, material);
    assert.equal(proxy.parent, null, 'CPU pick proxies must never enter the render scene');
    assert.deepEqual(f.scene.hit(point.x, point.y), { kind: 'army', id: 1 }, 'flattened proxies must inherit the group selection');
    const oldMatrix = proxy.matrixWorld.clone();
    model.position.x += 5; model.visible = false; model.clear(); geometry.dispose();
    const replacement = new Group(); replacement.add(new Mesh(geometry, material)); replacement.children[0].position.y = .4;
    replacement.position.set(300 / CELL_SIZE, sampleHeight(300 / CELL_SIZE, 400 / CELL_SIZE), 400 / CELL_SIZE);
    replacement.userData.mapSelection = { kind: 'army', id: 2 };
    f.scene.entities.set('army:2', { kind: 'army', id: 2, x: 300, y: 400, model: replacement });
    f.capture();
    assert.deepEqual(proxy.matrixWorld, oldMatrix, 'pending synchronization must not overwrite the displayed proxy');
    assert.deepEqual(f.scene.hit(point.x, point.y), { kind: 'army', id: 1 }, 'the old army remains selectable until the next image completes');
    f.complete(); assert.deepEqual(f.scene.hit(point.x, point.y), { kind: 'army', id: 2 });
    material.dispose();
});

test('completed marker anchors retain seam images, detail lifts and visibility after live synchronization changes them', () => {
    const x = WORLD_MAX_X - CELL_SIZE / 2, imageX = WORLD_MAX_X + CELL_SIZE / 2;
    const f = pickingFixture(x, 400), model = new Group(); model.visible = false;
    const entity: PickEntity = { kind: 'army', id: 1, x: WORLD_MIN_X + CELL_SIZE / 2, y: 400, model };
    f.scene.entities.set('army:1', entity); f.scene.hittable.add('army:1');
    f.scene.hittableImages.set('army:1', [{ x: imageX, y: 400 }]);
    f.capture(); f.complete();
    const point = f.view.project(imageX, 400, .22);
    assert.deepEqual(f.scene.hit(point.x, point.y), { kind: 'army', id: 1 });
    entity.id = 2; model.visible = true;
    f.scene.hittableImages.set('army:1', [{ x: entity.x, y: 400 }]);
    f.capture();
    assert.equal(f.scene.displayedPick.anchors[0].x, imageX);
    assert.equal(f.scene.displayedPick.anchors[0].lift, .22);
    assert.deepEqual(f.scene.hit(point.x, point.y), { kind: 'army', id: 1 }, 'wrapped marker positions must come from the completed image');
    f.complete(); assert.equal(f.scene.hit(point.x, point.y)?.kind, 'cell', 'the replaced seam image must retire only when its next frame completes');
});

test('completed field-marker picking retains instance matrices, counts and selections independently', () => {
    const f = pickingFixture(), geometry = new BoxGeometry(.5, .5, .5), material = new MeshBasicMaterial();
    const markers = new InstancedMesh(geometry, material, 2);
    const matrix = new Matrix4().makeTranslation(300 / CELL_SIZE, sampleHeight(300 / CELL_SIZE, 400 / CELL_SIZE) + .4, 400 / CELL_SIZE);
    markers.setMatrixAt(0, matrix); markers.setMatrixAt(1, new Matrix4().makeTranslation(10, 1, 10)); markers.count = 2;
    markers.getMatrixAt(0, matrix);
    f.scene.fieldMarkers = markers; f.scene.fieldMarkerSelections = [{ kind: 'cell', col: 17, row: 18 }, { kind: 'cell', col: 19, row: 20 }];
    f.capture(); f.complete();
    const point = f.view.project(300, 400, .4), proxy = f.scene.displayedPick.objects[0] as InstancedMesh;
    assert.deepEqual(f.scene.hit(point.x, point.y), { kind: 'cell', col: 17, row: 18 });
    markers.setMatrixAt(0, new Matrix4().makeTranslation(15, 1, 15)); markers.count = 1;
    Object.assign(f.scene.fieldMarkerSelections[0]!, { col: 21, row: 22 }); f.scene.fieldMarkerSelections.length = 1;
    f.capture();
    const captured = new Matrix4(); proxy.getMatrixAt(0, captured);
    assert.deepEqual(captured, matrix); assert.equal(proxy.count, 2);
    assert.deepEqual(f.scene.hit(point.x, point.y), { kind: 'cell', col: 17, row: 18 }, 'a mutated marker array must not change completed selections');
    f.complete(); assert.notDeepEqual(f.scene.hit(point.x, point.y), { kind: 'cell', col: 17, row: 18 });
    geometry.dispose(); material.dispose(); markers.dispose();
});
