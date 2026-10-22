import test from 'node:test';
import assert from 'node:assert/strict';
const api: any = await import('../src/engine/clock').catch(() => ({}));
const iso = '2026-10-22T00:00:00.000Z';
test('engine projects legacy 1x time from receipt using a monotonic clock', () => {
    assert.equal(typeof api.EngineClock, 'function', 'engines need a shared sampled clock');
    let elapsed = 50;
    const clock = new api.EngineClock({ server_now: iso }, () => elapsed);
    elapsed += 2000;
    assert.equal(clock.nowGameMs(), Date.parse(iso) + 2000);
});
test('accelerated projection and resampling use authoritative game time, not device wall time', () => {
    assert.equal(typeof api.EngineClock, 'function');
    let elapsed = 50;
    const game_clock = { version: 1, rate: 100, profile_id: 'accelerated-test-v1', real_now: iso, game_now: iso };
    const clock = new api.EngineClock({ server_now: iso, game_clock }, () => elapsed);
    elapsed += 2000;
    assert.equal(clock.nowGameMs(), Date.parse(iso) + 200000);
    clock.accept({ server_now: iso, game_clock });
    assert.equal(clock.nowGameMs(), Date.parse(iso));
    elapsed += 300;
    assert.equal(clock.nowGameMs(), Date.parse(iso) + 30000);
    assert.throws(() => clock.accept({ server_now: iso, game_clock: { ...game_clock, rate: 2 } }), /clock/i);
});
