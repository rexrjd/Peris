import assert from 'node:assert/strict';
import test from 'node:test';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { RenderContext } from '../src/shared/rendering/RenderContext';
import { type RenderState, type RenderActions } from '../src/shared/rendering/contracts';
import { MapRenderer } from '../src/features/map/rendering/MapRenderer';
import { WORLD_MIN_X, WORLD_MAX_Y } from '../src/features/map/domain/dimensions';

function fixture() {
    const world = createSolo('Navigator');
    const state: RenderState = { world, playerId: world.players[0].id, mode: 'world', selectedIds: [] };
    const canvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement;
    const ctx = new RenderContext(canvas, () => state, () => ({} as RenderActions));
    ctx.w = 390; ctx.h = 500; ctx.zoomBase = 390 / 1200;
    return { world, state, ctx, renderer: new MapRenderer(ctx) };
}

test('map selection follows server-adjusted marching time', t => {
    const { world, state, renderer } = fixture(), base = 1_800_000_000_000;
    t.mock.method(Date, 'now', () => base);
    Object.assign(world.armies[0], { status: 'moving', start_x: 100, start_y: 100, target_x: 900, target_y: 500, departure_at: new Date(base + 10_000).toISOString(), arrival_at: new Date(base + 30_000).toISOString() });
    state.clockOffset = 20_000;
    assert.deepEqual(renderer.hit(500, 295), { kind: 'army', id: 1 });
    assert.deepEqual(renderer.hit(100, 95), { kind: 'cell', col: 0, row: 0 });
});

test('nearby city and army selection chooses the nearest marker', () => {
    const { world, renderer } = fixture();
    Object.assign(world.armies[0], { start_x: 180, start_y: 290, target_x: 180, target_y: 290 });
    assert.deepEqual(renderer.hit(155, 273), { kind: 'settlement', id: 1 });
    assert.deepEqual(renderer.hit(180, 285), { kind: 'army', id: 1 });
});

test('world camera keeps zoomed map edges within the viewport and centers an overview', () => {
    const { ctx } = fixture();
    ctx.camera = { x: -99999, y: 99999, zoom: 3 };
    ctx.constrainMapCamera();
    assert.equal(ctx.worldPoint(0, 250).x, WORLD_MIN_X);
    assert.equal(ctx.worldPoint(195, 500).y, WORLD_MAX_Y);
    ctx.center(); ctx.camera.x = 0; ctx.camera.y = 0; ctx.constrainMapCamera();
    assert.deepEqual(ctx.camera, { x: 0, y: 0, zoom: ctx.mapMinZoom });
    ctx.zoom(.1); assert.equal(ctx.camera.zoom, ctx.mapMinZoom);
});

test('army focus selects the current player even when a rival is listed first', t => {
    const { world, ctx, state } = fixture(), base = 1_800_000_000_000;
    t.mock.method(Date, 'now', () => base);
    Object.assign(world.armies[0], { status: 'moving', start_x: 400, start_y: 200, target_x: 800, target_y: 500, departure_at: new Date(base).toISOString(), arrival_at: new Date(base + 20_000).toISOString() });
    world.armies.unshift({ ...world.armies[0], id: 99, owner_id: 'rival', status: 'idle', target_x: 100, target_y: 100 });
    state.clockOffset = 10_000;
    ctx.focusMap('army');
    assert.equal(ctx.camera.x, 600); assert.equal(ctx.camera.y, 350); assert.equal(ctx.camera.zoom, 3.2);
});

test('overview minimap opens the chosen region at a playable zoom', () => {
    const { ctx } = fixture(); ctx.center();
    const m = ctx.miniBounds();
    ctx.panMinimap({ x: m.x + m.w * .25, y: m.y + m.h * .75 });
    assert.equal(ctx.camera.zoom, 1);
    assert.equal(ctx.camera.x, -6400); assert.equal(ctx.camera.y, 6400);
});
