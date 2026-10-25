import assert from 'node:assert/strict';
import test from 'node:test';
import {openRuler, accountEntryError, type AccountBackend} from '../src/platform/backend/accountLogin';
import {isLockContention} from '../src/platform/backend/polling';
import {createSolo} from '../src/features/campaign/domain/newRealm';

for (const failingStage of ['sync', 'snapshot'] as const) {
    test(`initial ${failingStage} lock contention retries state loading without re-entering the account`, async () => {
        const world = createSolo('Lock recovery'), calls: string[] = [];
        let failures = 0;
        const backend: AccountBackend = {
            async session() { return 'same-session'; },
            async freshSession() { throw new Error('A busy world must not change session.'); },
            async login() { calls.push('login'); return {player_id: world.players[0].id, display_name: 'Lock recovery', created: false}; },
            async sync() { calls.push('sync'); if (failingStage === 'sync' && failures++ < 2) throw {code: '55P03', message: 'lock_not_available', status: 400}; },
            async snapshot() { calls.push('snapshot'); if (failingStage === 'snapshot' && failures++ < 2) throw {code: '55P03', message: 'could not obtain lock on row in relation "players"', status: 400}; return world; },
            async wait(ms) { calls.push(`wait:${ms}`); },
        };
        const result = await openRuler('Lock recovery', backend);
        assert.equal(result.world, world);
        assert.equal(result.sessionId, 'same-session');
        assert.equal(calls.filter(call => call === 'login').length, 1);
        assert.deepEqual(calls.filter(call => call.startsWith('wait:')), ['wait:500', 'wait:1000']);
        assert.equal(failures, 3);
    });
}

test('initial lock recovery stops after three attempts and retains the failure code', async () => {
    const world = createSolo('Lock recovery');
    let attempts = 0, logins = 0;
    const backend: AccountBackend = {
        async session() { return 'same-session'; },
        async freshSession() { throw new Error('Unexpected session replacement'); },
        async login() { logins++; return {player_id: world.players[0].id, display_name: 'Lock recovery', created: false}; },
        async sync() { attempts++; throw {code: '55P03', message: 'lock_not_available', status: 400}; },
        async snapshot() { return world; },
        async wait() {},
    };
    await assert.rejects(() => openRuler('Lock recovery', backend), {code: '55P03'});
    assert.equal(attempts, 3);
    assert.equal(logins, 1);
});

test('lock classification is narrow and exhausted account loading gives a readable explanation', () => {
    assert.equal(isLockContention({code: '55P03', message: 'could not obtain lock on row'}), true);
    assert.equal(isLockContention({message: 'lock_not_available'}), true);
    assert.equal(isLockContention({code: '42501', message: 'lock_not_available'}), false);
    assert.equal(isLockContention({message: 'Server failed near lock_not_available'}), false);
    assert.equal(isLockContention(null), false);
    const error = accountEntryError({code: '55P03', message: 'lock_not_available', status: 400}, {mode: 'login'});
    assert.match(error.message, /shared world is busy/);
    assert.equal(error.code, '55P03');
});
