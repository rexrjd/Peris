import assert from 'node:assert/strict';
import test from 'node:test';
import { openRuler, rulerName, type AccountBackend } from '../src/platform/backend/accountLogin';
import { createSolo } from '../src/features/campaign/domain/newRealm';
function fixture(session: string | null = 'browser-one') {
    const calls: string[] = [], world = createSolo('Alpha');
    world.players[0].id = 'persistent-alpha';
    world.settlements[0].owner_id = world.armies[0].owner_id = 'persistent-alpha';
    const backend: AccountBackend = {
        async session() { calls.push('session'); return session; },
        async freshSession() { calls.push('fresh'); return 'browser-two'; },
        async login(name) { calls.push('login:' + name); return { player_id: 'persistent-alpha', display_name: 'Alpha', created: false }; },
        async sync() { calls.push('sync'); },
        async snapshot() { calls.push('snapshot'); return world; },
    };
    return { backend, calls, world };
}
test('name-only login uses the persistent ruler ID and settles before the first snapshot', async () => {
    const { backend, calls } = fixture();
    const result = await openRuler('  aLpHa  ', backend);
    assert.equal(result.ruler.player_id, 'persistent-alpha');
    assert.equal(result.sessionId, 'browser-one');
    assert.deepEqual(calls, ['session', 'login:aLpHa', 'sync', 'snapshot']);
});
test('a cleared browser opens a fresh connection and resumes the same ruler', async () => {
    const { backend, calls } = fixture(null);
    assert.equal((await openRuler('Alpha', backend)).ruler.player_id, 'persistent-alpha');
    assert.deepEqual(calls, ['session', 'fresh', 'login:Alpha', 'sync', 'snapshot']);
});
test('switching names replaces an incompatible session exactly once', async () => {
    const { backend, calls } = fixture(); const original = backend.login; let first = true;
    backend.login = async name => { if (first) { first = false; calls.push('mismatch'); throw { code: 'PT409' }; } return original(name); };
    assert.equal((await openRuler('Alpha', backend)).sessionId, 'browser-two');
    assert.deepEqual(calls, ['session', 'mismatch', 'fresh', 'login:Alpha', 'sync', 'snapshot']);
});
test('expired JWT and missing refresh token recover through the same name', async () => {
    for (const at of ['session', 'login'] as const) {
        const { backend, calls } = fixture(); const original = backend[at]; let first = true;
        if (at === 'session') backend.session = async () => { if (first) { first = false; throw { code: 'refresh_token_not_found' }; } return (original as AccountBackend['session'])(); };
        else backend.login = async name => { if (first) { first = false; throw { code: 'PGRST301', status: 401 }; } return (original as AccountBackend['login'])(name); };
        assert.equal((await openRuler('Alpha', backend)).ruler.player_id, 'persistent-alpha');
        assert.equal(calls.filter(c => c === 'fresh').length, 1);
    }
});
test('invalid names fail before Auth or allocation, and unavailable servers do not change account', async () => {
    for (const name of ['', ' ', 'x', 'a'.repeat(21), '!Alpha']) {
        const { backend, calls } = fixture(); await assert.rejects(() => openRuler(name, backend), /2–20/); assert.deepEqual(calls, []);
    }
    const { backend, calls } = fixture(); backend.login = async () => { throw new Error('offline'); };
    await assert.rejects(() => openRuler('Alpha', backend), /offline/); assert.deepEqual(calls, ['session']);
    assert.equal(rulerName(' Alpha '), 'Alpha');
});
test('a wrong ruler or incomplete snapshot cannot be installed as the active realm', async () => {
    const wrong = fixture(); wrong.backend.login = async () => ({ player_id: 'other', display_name: 'Beta', created: false });
    await assert.rejects(() => openRuler('Alpha', wrong.backend), /different ruler/);
    const empty = fixture(); empty.world.settlements = [];
    await assert.rejects(() => openRuler('Alpha', empty.backend), /could not be loaded/);
    const wrongId = fixture(); wrongId.world.players[0].id = 'other';
    await assert.rejects(() => openRuler('Alpha', wrongId.backend), /could not be loaded/);
});
test('creation race and request identity survive a fresh-session retry', async () => {
    const { backend } = fixture(); const entries: unknown[] = [];
    const entry = { mode: 'create' as const, faction: 'orc' as const, creationId: '12345678-1234-4234-8234-123456789012' };
    backend.login = async (_name, action) => { entries.push(action); if (entries.length === 1) throw { code: 'PT409' }; return { player_id: 'persistent-alpha', display_name: 'Alpha', created: true }; };
    assert.equal((await openRuler('Alpha', backend, entry)).ruler.created, true);
    assert.deepEqual(entries, [entry, entry]);
});
test('invalid creation race or request UUID fails before authentication', async () => {
    for (const entry of [{ mode: 'create', faction: 'alien', creationId: '12345678-1234-4234-8234-123456789012' }, { mode: 'create', faction: 'orc', creationId: 'invalid' }] as unknown as Parameters<typeof openRuler>[2][]) {
        const { backend, calls } = fixture(); await assert.rejects(() => openRuler('Alpha', backend, entry), /Choose a race/); assert.deepEqual(calls, []);
    }
});
