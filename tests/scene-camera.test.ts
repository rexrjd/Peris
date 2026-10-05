import assert from 'node:assert/strict';
import test from 'node:test';
import { SceneCamera } from '../src/features/map/rendering/three/SceneCamera';
import { sampleHeight } from '../src/features/map/rendering/three/landscape';
import { CELL_SIZE, WORLD_MIN_X, WORLD_MIN_Y, WORLD_MAX_X, WORLD_MAX_Y } from '../src/features/map/domain/dimensions';

type Point = { x: number; y: number };

function near(actual: number, expected: number, tolerance: number, label: string) {
    assert.ok(Number.isFinite(actual), `${label} is finite`);
    assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, received ${actual} (tolerance ${tolerance})`);
}

function nearPoint(actual: Point | null, expected: Point, tolerance: number, label: string) {
    assert.ok(actual, `${label} intersects terrain`);
    near(actual.x, expected.x, tolerance, `${label} x`);
    near(actual.y, expected.y, tolerance, `${label} y`);
}

function view(elevation: (x: number, z: number) => number, width = 1200, height = 800) {
    const result = new SceneCamera(elevation);
    result.setSize(width, height);
    result.focus(-12 * CELL_SIZE, 7 * CELL_SIZE);
    return result;
}

test('terrain projection and picking round-trip signed positions on flat surfaces at different camera angles', () => {
    for (const height of [0, 4]) for (const azimuth of [0, .65, -1.1]) {
        const camera = view(() => height);
        camera.azimuth = azimuth;
        camera.update();
        for (const [dx, dy] of [[0, 0], [-2, -2], [2, 2], [-2, 2], [2, -2]]) {
            const position = { x: (-12 + dx) * CELL_SIZE, y: (7 + dy) * CELL_SIZE };
            const screen = camera.project(position.x, position.y, 0);
            assert.ok(screen.visible, 'Nearby terrain remains visible');
            nearPoint(camera.ground(screen.x, screen.y), position, .001, `Flat terrain at height ${height}, azimuth ${azimuth}`);
        }
    }
});

test('terrain projection and picking round-trip a sloping surface in landscape and portrait views', () => {
    for (const [width, height] of [[1200, 800], [450, 900]]) for (const azimuth of [0, .7]) {
        const camera = view((x, z) => 8 + .09 * x + .12 * z, width, height);
        camera.azimuth = azimuth;
        camera.span = 20;
        camera.update();
        for (const [dx, dy] of [[0, 0], [-2, -2], [2, 2], [-2, 2], [2, -2]]) {
            const position = { x: (-12 + dx) * CELL_SIZE, y: (7 + dy) * CELL_SIZE };
            const screen = camera.project(position.x, position.y, 0);
            assert.ok(screen.visible);
            nearPoint(camera.ground(screen.x, screen.y), position, .05, 'Sloping terrain');
        }
    }
});

test('picking steep mountain terrain returns a surface point on the clicked camera ray', () => {
    const camera = view(sampleHeight);
    for (const [x, z] of [[-30.5, -90.5], [49.5, -75.5]]) {
        camera.focus(x * CELL_SIZE, z * CELL_SIZE);
        const screen = camera.project(x * CELL_SIZE, z * CELL_SIZE, 0);
        const ground = camera.ground(screen.x, screen.y);
        assert.ok(ground, 'Mountain click intersects terrain');
        // A nearer peak may occlude the original point, but a valid picked
        // surface must still project onto the same pixel as the click.
        nearPoint(camera.project(ground.x, ground.y, 0), screen, .5, 'Mountain ray intersection');
    }
});

test('cursor-anchored zoom keeps the picked ground point under the cursor on flat terrain', () => {
    for (const factor of [1.5, .7]) for (const azimuth of [0, .8]) {
        const camera = view(() => 3);
        camera.azimuth = azimuth;
        camera.span = 24;
        camera.update();
        const anchor = { x: camera.width * .67, y: camera.height * .38 };
        const ground = camera.ground(anchor.x, anchor.y)!;
        camera.zoom(factor, anchor);
        nearPoint(camera.project(ground.x, ground.y, 0), anchor, .001, 'Zoom anchor');
    }
});

test('cursor-anchored zoom remains stable on sloping terrain', () => {
    const camera = view((x, z) => 8 + .09 * x + .12 * z);
    camera.azimuth = .7;
    camera.span = 24;
    camera.update();
    const anchor = { x: camera.width * .67, y: camera.height * .38 };
    const ground = camera.ground(anchor.x, anchor.y)!;
    camera.zoom(1.5, anchor);
    nearPoint(camera.project(ground.x, ground.y, 0), anchor, .5, 'Sloping zoom anchor');
});

test('cursor-anchored zoom keeps its point when crossing the overview camera angle', () => {
    const camera = view(() => 2);
    camera.span = 96;
    camera.update();
    const anchor = { x: camera.width * .65, y: camera.height * .4 };
    const ground = camera.ground(anchor.x, anchor.y)!;
    camera.zoom(1.2, anchor);
    nearPoint(camera.project(ground.x, ground.y, 0), anchor, .001, 'Overview transition anchor');
});

test('dragging moves terrain by the drag displacement, including a rotated camera', () => {
    for (const azimuth of [0, .8]) {
        const camera = view(() => 2);
        camera.azimuth = azimuth;
        camera.update();
        const center = { x: camera.width / 2, y: camera.height / 2 };
        const ground = camera.ground(center.x, center.y)!;
        camera.pan(84, -51);
        nearPoint(camera.project(ground.x, ground.y, 0), { x: center.x + 84, y: center.y - 51 }, .001, 'Dragged terrain');
        camera.pan(-84, 51);
        nearPoint(camera.project(ground.x, ground.y, 0), center, .001, 'Reversed drag');
    }
});

test('dragging sloping terrain tracks the pointer without accumulating vertical drift', () => {
    const camera = view((x, z) => 8 + .09 * x + .12 * z);
    camera.azimuth = .8;
    camera.span = 24;
    camera.update();
    const center = { x: camera.width / 2, y: camera.height / 2 };
    const ground = camera.ground(center.x, center.y)!;
    camera.pan(240, -150);
    nearPoint(camera.project(ground.x, ground.y, 0), { x: center.x + 240, y: center.y - 150 }, .5, 'Dragged sloping terrain');
});

test('focus and repeated pan preserve signed world bounds', () => {
    const camera = view(() => 0);
    camera.focus(WORLD_MIN_X * 2, WORLD_MAX_Y * 2);
    near(camera.target.x * CELL_SIZE, WORLD_MIN_X, 1e-6, 'West focus boundary');
    near(camera.target.z * CELL_SIZE, WORLD_MAX_Y, 1e-6, 'South focus boundary');
    camera.pan(1e6, -1e6);
    near(camera.target.x * CELL_SIZE, WORLD_MIN_X, 1e-6, 'West drag boundary');
    near(camera.target.z * CELL_SIZE, WORLD_MAX_Y, 1e-6, 'South drag boundary');
    camera.focus(WORLD_MAX_X * 2, WORLD_MIN_Y * 2);
    near(camera.target.x * CELL_SIZE, WORLD_MAX_X, 1e-6, 'East focus boundary');
    near(camera.target.z * CELL_SIZE, WORLD_MIN_Y, 1e-6, 'North focus boundary');
});

test('overview frames every signed world corner in square, wide, and portrait viewports', () => {
    for (const [width, height] of [[800, 800], [1600, 800], [400, 900]]) {
        const camera = view(() => 0, width, height);
        camera.overview();
        nearPoint(camera.project(0, 0, 0), { x: width / 2, y: height / 2 }, 1e-6, 'Overview center');
        for (const x of [WORLD_MIN_X, WORLD_MAX_X]) for (const y of [WORLD_MIN_Y, WORLD_MAX_Y]) {
            const screen = camera.project(x, y, 0);
            assert.ok(screen.visible, `World corner ${x}, ${y} is visible at ${width} × ${height}`);
            assert.ok(screen.x >= 0 && screen.x <= width, 'Corner fits viewport width');
            assert.ok(screen.y >= 0 && screen.y <= height, 'Corner fits viewport height');
            nearPoint(camera.ground(screen.x, screen.y), { x, y }, .001, 'Signed world corner');
        }
    }
});

test('resizing an overview from square to portrait keeps the complete world framed', () => {
    const camera = view(() => 0, 800, 800);
    camera.overview();
    camera.setSize(400, 900);
    for (const x of [WORLD_MIN_X, WORLD_MAX_X]) for (const y of [WORLD_MIN_Y, WORLD_MAX_Y]) {
        const screen = camera.project(x, y, 0);
        assert.ok(screen.x >= 0 && screen.x <= camera.width, 'Resized overview fits viewport width');
        assert.ok(screen.y >= 0 && screen.y <= camera.height, 'Resized overview fits viewport height');
    }
});
