import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldScene } from '../src/features/map/rendering/three/WorldScene';
import { preferences, setPreferences } from '../src/platform/preferences/preferences';

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
    const view = { target: { x: 0, y: 0, z: 0 }, span: 12, azimuth: 0, width: 800, height: 500, wrapRevision: 0, isOverview: false, update() {} };
    let draws = 0, synchronized = 0, ready = false;
    const publishedViews: { x: number; azimuth: number }[] = [], minimapViews: { x: number; azimuth: number }[] = [], wrapVisibility: boolean[] = [];
    const scene = Object.create(WorldScene.prototype) as {
        loop(time: number): void; onScreen: boolean; entities: Map<string, unknown>;
    };
    Object.assign(scene, {
        running: true, lastTime: 0, onScreen: true, redraw: true, idleScanTime: 0, renderInputsKey: '', renderViewKey: '',
        keys: new Set(), touches: new Map(), state: () => state, view, entities: new Map(), canvas: { style: {} },
        renderer: { render() { draws++; }, shadowMap: {} },
        landscape: { setWrapVisible(visible: boolean) { wrapVisibility.push(visible); }, setView() {}, animate() {} },
        sun: { position: { set() {} }, target: { position: { copy() {} } }, shadow: { camera: { updateProjectionMatrix() {} } } },
        armyModels: { ready: () => ready },
        syncEntities() { synchronized++; }, syncFields() {}, updateSelection() {}, updateRoutes() {}, updateLabels() {},
        drawMinimap() { minimapViews.push({ x: view.target.x, azimuth: view.azimuth }); },
        publishViewport() { publishedViews.push({ x: view.target.x, azimuth: view.azimuth }); },
    });
    return {
        scene, state, world, view, publishedViews, minimapViews, wrapVisibility, draws: () => draws, synchronized: () => synchronized,
        setHidden(value: boolean) { hidden = value; },
        setDialog(containsMap: boolean | null) { dialog = containsMap === null ? null : { contains: () => containsMap }; },
        setReady(value: boolean) { ready = value; },
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
        f.scene.entities.set('army:4', { kind: 'army', id: 4, faction: 'roman' });
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
        f.view.isOverview = true; f.scene.loop(260);
        assert.equal(f.draws(), 2, 'an overview-only transition must redraw immediately');
        assert.deepEqual(f.wrapVisibility, [true, false], 'overview must hide repeated realm copies');
        assert.equal(f.minimapViews.length, 2, 'overview must publish its changed minimap footprint');
        f.scene.loop(500); assert.equal(f.draws(), 2, 'the new overview frame can become idle again');
    } finally { f.restore(); }
});
