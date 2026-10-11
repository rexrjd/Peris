import test from 'node:test';
import assert from 'node:assert/strict';
import { GpuFrameBudget } from '../src/shared/rendering/GpuFrameBudget';

function fixture() {
    const deleted: WebGLSync[] = [], waits: { sync: WebGLSync; flags: number; timeout: number }[] = [];
    let status = 0x911b, lost = false, allocate = true, flushed = 0, created = 0;
    const gl = {
        TIMEOUT_EXPIRED: 0x911b, ALREADY_SIGNALED: 0x911a, CONDITION_SATISFIED: 0x911c, WAIT_FAILED: 0x911d,
        SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
        isContextLost: () => lost,
        fenceSync(condition: number, flags: number) {
            assert.equal(condition, 0x9117); assert.equal(flags, 0);
            return allocate ? { id: ++created } as unknown as WebGLSync : null;
        },
        clientWaitSync(sync: WebGLSync, flags: number, timeout: number) { waits.push({ sync, flags, timeout }); return status; },
        deleteSync(sync: WebGLSync) { deleted.push(sync); },
        flush() { flushed++; },
    };
    const budget = new GpuFrameBudget(gl as unknown as WebGL2RenderingContext);
    return {
        budget, gl, waits, deleted, flushed: () => flushed, created: () => created,
        complete() { status = gl.ALREADY_SIGNALED; },
        fail() { status = gl.WAIT_FAILED; },
        setLost(value: boolean) { lost = value; },
        setAllocate(value: boolean) { allocate = value; },
    };
}

test('unfinished GPU work admits no additional frame and polling never waits on the UI thread', () => {
    const f = fixture();
    assert.equal(f.budget.ready(0), true); f.budget.submitted(0);
    for (const time of [16, 32, 48]) assert.equal(f.budget.ready(time), false);
    assert.equal(f.created(), 1); assert.equal(f.flushed(), 1); assert.equal(f.deleted.length, 0);
    assert.equal(f.budget.completedFrames, 0, 'an unfinished submission must not promote displayed camera state');
    assert.ok(f.waits.every(wait => wait.flags === 0 && wait.timeout === 0), 'every poll must be nonblocking');
    f.complete(); assert.equal(f.budget.ready(64), false, 'a demonstrably slow frame needs breathing room');
    assert.equal(f.deleted.length, 1); assert.equal(f.budget.ready(80), true);
    assert.equal(f.budget.completedFrames, 1);
    f.budget.submitted(80); assert.equal(f.created(), 2);
    f.budget.dispose(); assert.equal(f.deleted.length, 2);
});

test('WebGL1 contexts preserve rendering without assuming synchronization support', () => {
    const budget = new GpuFrameBudget({ isContextLost: () => false } as unknown as WebGLRenderingContext);
    assert.equal(budget.ready(0), true); budget.submitted(0);
    assert.equal(budget.completedFrames, 1); assert.equal(budget.ready(16), true);
    budget.dispose(); assert.equal(budget.ready(32), false);
});

test('fast GPU frames preserve both 60 Hz and 30 Hz admission', () => {
    for (const interval of [1000 / 60, 1000 / 30]) {
        const f = fixture(); f.complete();
        for (let frame = 0; frame < 5; frame++) {
            const time = frame * interval;
            assert.equal(f.budget.ready(time), true); f.budget.submitted(time);
        }
        assert.equal(f.created(), 5); f.budget.dispose();
    }
});

test('very slow frames reserve bounded CPU headroom before another submission', () => {
    const f = fixture(); f.budget.submitted(0); f.complete();
    assert.equal(f.budget.ready(4000), false);
    assert.equal(f.budget.ready(4249), false);
    assert.equal(f.budget.ready(4250), true, 'cooldown must be capped instead of making controls wait for seconds');
    assert.equal(f.waits.length, 1, 'a completed fence must not be polled during cooldown');
    f.budget.dispose();
});

test('context loss and reset discard old synchronization and restoration creates a fresh fence', () => {
    const f = fixture(); f.budget.submitted(0); f.setLost(true);
    assert.equal(f.budget.ready(16), false); f.budget.reset();
    assert.equal(f.deleted.length, 0, 'lost-context objects are already invalidated');
    f.setLost(false); assert.equal(f.budget.ready(32), true); f.budget.submitted(32);
    f.budget.reset(); assert.equal(f.deleted.length, 1);
    assert.equal(f.budget.ready(33), true); f.budget.dispose(); assert.equal(f.budget.ready(34), false);
});

test('an unavailable fence keeps rendering usable and reset can recover synchronization', () => {
    const f = fixture(); f.setAllocate(false); f.budget.submitted(0);
    assert.equal(f.budget.ready(16), true); assert.equal(f.flushed(), 0);
    f.setAllocate(true); f.budget.reset(); f.budget.submitted(32); f.fail();
    assert.equal(f.budget.ready(48), true); assert.equal(f.deleted.length, 1);
    assert.equal(f.budget.ready(64), true); f.budget.dispose();
});
