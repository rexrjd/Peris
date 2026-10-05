import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, OrthographicCamera } from 'three';
import { WorldScene } from '../src/features/map/rendering/three/WorldScene';
import { CELL_SIZE, WORLD_MIN_X, WORLD_MIN_Y, WORLD_MAX_X, WORLD_MAX_Y } from '../src/features/map/domain/dimensions';
import { cellAt, cellCenter, isWalkable } from '../src/features/map/domain/worldGrid';

type Entity = { kind: 'settlement'; id: number; x: number; y: number; title: string; mine: boolean; model: Group; detail: boolean };
type Selection = { kind: string; id?: number; col?: number; row?: number } | null;
type LabelButton = { className: string; type: string; textContent: string; style: Record<string, string>; onclick: (() => void) | null; remove(): void };
type Harness = {
    hit(x: number, y: number): Selection;
    marchAt(x: number, y: number): void;
    updateLabels(): void;
    entities: Map<string, Entity>;
    hittable: Set<string>;
};

/** Inject presentation adapters, leaving the real picking/command/label methods intact. */
function sceneFixture() {
    const scene = Object.create(WorldScene.prototype) as Harness;
    const camera = new OrthographicCamera(-20, 20, 20, -20, .1, 100);
    camera.position.set(0, 0, 30); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const moved: { x: number; y: number }[] = [], selected: Selection[] = [];
    const buttons: LabelButton[] = [];
    let moveMode = false;
    let foreground = { x: 300, y: 300 };
    const view = {
        camera, span: 12, azimuth: 0, width: 600, height: 400,
        target: { x: 0, y: 0, z: 0 },
        project: (x: number, y: number) => ({ x: x / 2, y: y / 4, visible: true }),
        ground: () => foreground,
        focus: () => assert.fail('Selectable labels should not navigate the camera'),
    };
    Object.assign(scene, {
        view, entities: new Map(), hittable: new Set(), occlusion: new Map(), occlusionViewKey: '', labels: new Map(),
        state: () => ({ moveMode, selection: null, mapLayers: { grid: false, regions: false, resources: false } }),
        actions: () => ({ moveArmy: (x: number, y: number) => moved.push({ x, y }), selectMap: (selection: Selection) => selected.push(selection) }),
        hoverText: () => {},
        labelRoot: { append: (button: LabelButton) => buttons.push(button) },
    });
    function entity(id: number, x: number, y: number, rendered: boolean, mine = false) {
        const model = new Group(); model.visible = true;
        const key = `settlement:${id}`;
        scene.entities.set(key, { kind: 'settlement', id, x, y, title: `Village ${id}`, mine, model, detail: true });
        if (rendered) scene.hittable.add(key);
    }
    return { scene, view, moved, selected, buttons, entity, setMoveMode: (value: boolean) => { moveMode = value; }, setForeground: (point: { x: number; y: number }) => { foreground = point; } };
}

test('a closer culled marker cannot steal a click from the rendered village', () => {
    const fixture = sceneFixture();
    fixture.entity(1, 300, 400, true);
    fixture.entity(2, 306, 400, false);
    const click = fixture.view.project(306, 400);
    assert.deepEqual(fixture.scene.hit(click.x, click.y), { kind: 'settlement', id: 1 });
});

test('foreground terrain hides an entity and clicking falls back to the terrain field', () => {
    const fixture = sceneFixture();
    fixture.entity(1, 300, 400, true);
    // The camera adapter reports a surface nearer the camera than the entity.
    fixture.setForeground({ x: 300, y: 900 });
    const click = fixture.view.project(300, 400), field = cellAt(300, 900);
    assert.deepEqual(fixture.scene.hit(click.x, click.y), { kind: 'cell', col: field.col, row: field.row });
});

test('marching rejects invalid bounds, non-finite points, sea and inspection mode', () => {
    const fixture = sceneFixture(); fixture.setMoveMode(true);
    for (const point of [
        { x: NaN, y: 400 }, { x: Infinity, y: 400 }, { x: 300, y: -Infinity },
        { x: WORLD_MIN_X - 1, y: 400 }, { x: WORLD_MAX_X, y: 400 },
        { x: 300, y: WORLD_MIN_Y - 1 }, { x: 300, y: WORLD_MAX_Y },
    ]) fixture.scene.marchAt(point.x, point.y);
    const sea = cellAt(WORLD_MIN_X + CELL_SIZE / 2, WORLD_MIN_Y + CELL_SIZE / 2);
    assert.equal(isWalkable(sea.col, sea.row), false, 'The outer corner is open sea');
    const seaCenter = cellCenter(sea.col, sea.row); fixture.scene.marchAt(seaCenter.x, seaCenter.y);
    assert.deepEqual(fixture.moved, []);
    fixture.setMoveMode(false); fixture.scene.marchAt(300, 400);
    assert.deepEqual(fixture.moved, []);
    fixture.setMoveMode(true); fixture.scene.marchAt(300, 400);
    assert.deepEqual(fixture.moved, [cellCenter(2, 3)]);
});

test('activating a visible village label in March mode issues moveArmy, not selectMap', () => {
    const fixture = sceneFixture(); fixture.entity(1, 300, 400, true, true); fixture.setMoveMode(true);
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
        createElement: (tag: string): LabelButton => {
            assert.equal(tag, 'button');
            return { className: '', type: '', textContent: '', style: {}, onclick: null, remove() {} };
        },
    } });
    try {
        fixture.scene.updateLabels();
        assert.equal(fixture.buttons.length, 1, 'The visible own village has one interactive label');
        fixture.buttons[0].onclick!();
        assert.deepEqual(fixture.moved, [cellCenter(2, 3)]);
        assert.deepEqual(fixture.selected, []);
    } finally {
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else Reflect.deleteProperty(globalThis, 'document');
    }
});
