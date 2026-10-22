import test from 'node:test';
import assert from 'node:assert/strict';
import { clock } from '../src/shared/time/clock';
const api: any = await import('../src/shared/time/gameClock').catch(() => ({}));
const base = { version: 1, rate: 1, profile_id: 'normal-v1', real_now: '2026-10-22T00:00:00.000Z', game_now: '2026-10-22T00:00:00.000Z' };
test('duration labels show real remaining time at the world rate', () => {
    assert.equal(clock(600, 100), '0:06');
    assert.equal(clock(600), '10:00');
});
test('absolute ETA maps virtual game dates back to real UTC for player labels', () => {
    assert.equal(typeof api.realTimeForGameDate, 'function');
    const sample = { ...base, rate: 100, profile_id: 'accelerated-test-v1', game_now: '2030-01-01T00:00:00.000Z' };
    assert.equal(api.realTimeForGameDate({ game_clock: sample }, Date.parse(sample.game_now) + 30000), Date.parse(base.real_now) + 300);
    assert.equal(api.realTimeForGameDate(undefined, base.real_now), Date.parse(base.real_now));
});
test('clock projects one elapsed real second at each supported fixed rate', () => {
    assert.equal(typeof api.projectGameNow, 'function', 'shared clock projection must exist');
    for (const rate of [1, 10, 100]) {
        const sample = { ...base, rate, profile_id: rate === 1 ? 'normal-v1' : 'accelerated-test-v1' };
        assert.equal(api.projectGameNow(sample, 1000) - Date.parse(base.game_now), rate * 1000);
        assert.equal(api.projectGameNow(sample, -1), Date.parse(base.game_now));
    }
});
test('countdowns convert game seconds to real seconds exactly once', () => {
    assert.equal(typeof api.realSecondsUntil, 'function');
    assert.equal(api.realSecondsUntil(30_000, 0, 100), .3);
    assert.equal(api.realSecondsUntil(0, 30_000, 1), 0);
});
test('clock rejects malformed metadata and nonfinite time rather than assuming 1x', () => {
    assert.equal(typeof api.validateGameClock, 'function');
    for (const patch of [{ version: 2 }, { rate: 0 }, { rate: 2 }, { game_now: 'bad' }, { real_now: 'bad' }, { profile_id: 'unknown' }, { rate: 100 }]) {
        assert.throws(() => api.validateGameClock({ ...base, ...patch }), /clock/i);
        assert.throws(() => api.projectGameNow({ ...base, ...patch }, 100), /clock/i);
    }
    assert.throws(() => api.projectGameNow(base, NaN), /clock/i);
    assert.throws(() => api.projectGameNow(base, Infinity), /clock/i);
    assert.throws(() => api.realSecondsUntil(Infinity, 0, 1), /clock/i);
    assert.throws(() => api.realSecondsUntil(1000, 0, 0), /clock/i);
});
