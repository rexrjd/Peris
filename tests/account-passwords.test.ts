import assert from 'node:assert/strict';
import test from 'node:test';
import * as accountLogin from '../src/platform/backend/accountLogin';
import { openRuler, type AccountBackend, type AccountEntry } from '../src/platform/backend/accountLogin';
import { createSolo } from '../src/features/campaign/domain/newRealm';

const creation = { mode: 'create' as const, faction: 'persian' as const, creationId: '12345678-1234-4234-8234-123456789012' };
const { accountEntryRequest, accountEntryError } = accountLogin;
// Generated only in test memory; no usable credential is saved with the test.
const password = () => crypto.randomUUID();

test('passwordless login and creation keep the existing four-argument account RPC', () => {
    for (const entry of [{ mode: 'login' }, { mode: 'login', password: '' }, creation] as AccountEntry[]) {
        const request = accountEntryRequest('Alpha', entry);
        assert.equal(request.functionName, 'peris_enter_account');
        assert.deepEqual(request.args, { p_display_name: 'Alpha', p_mode: entry.mode, p_faction: entry.mode === 'create' ? 'persian' : null, p_creation_id: entry.mode === 'create' ? creation.creationId : null });
    }
});

test('password-bearing login and creation send the credential only to the password RPC', () => {
    const secret = password();
    for (const entry of [{ mode: 'login', password: secret }, { ...creation, password: secret }] as AccountEntry[]) {
        const request = accountEntryRequest('Alpha', entry);
        assert.equal(request.functionName, 'peris_enter_password_account');
        assert.deepEqual(request.args, { p_display_name: 'Alpha', p_mode: entry.mode, p_faction: entry.mode === 'create' ? 'persian' : null, p_creation_id: entry.mode === 'create' ? creation.creationId : null, p_password: secret });
    }
});

test('invalid creation passwords fail before authentication and allocation', async () => {
    const world = createSolo('Alpha'); const calls: string[] = [];
    const backend: AccountBackend = {
        async session() { calls.push('session'); return 'browser'; },
        async freshSession() { calls.push('fresh'); return 'fresh'; },
        async login() { calls.push('login'); return { player_id: world.players[0].id, display_name: 'Alpha', created: true }; },
        async sync() { calls.push('sync'); }, async snapshot() { calls.push('snapshot'); return world; },
    };
    for (const invalid of ['x'.repeat(11), 'x'.repeat(73), '界'.repeat(25), '😀'.repeat(11)]) {
        await assert.rejects(() => openRuler('Alpha', backend, { ...creation, password: invalid }), /12.*72/);
        assert.deepEqual(calls, []);
    }
    for (const valid of ['', 'x'.repeat(12), '界'.repeat(24)]) {
        await openRuler('Alpha', backend, { ...creation, password: valid });
    }
    assert.equal(calls.filter(call => call === 'login').length, 3);
});

test('protected entry errors expose only safe text and retry metadata', () => {
    const secret = password();
    const cause = { code: 'PT401', status: 401, message: `Denied ${secret}`, details: secret, hint: secret };
    const error = accountEntryError(cause, { mode: 'login', password: secret });
    assert.match(error.message, /password/i);
    assert.equal(error.code, 'PT401'); assert.equal(error.status, 401);
    assert.equal(String(error).includes(secret), false);
    assert.equal(JSON.stringify(error).includes(secret), false);
    assert.equal('details' in error, false); assert.equal('hint' in error, false);
    assert.equal(accountEntryError({ message: secret }, { ...creation, password: secret }).message.includes(secret), false);
    assert.match(accountEntryError(cause, { mode: 'login' }).message, /password/i);
    assert.equal(accountEntryError({ message: 'No account has this name.' }, { mode: 'login' }).message, 'No account has this name.');
});

test('incorrect passwords do not replace a healthy browser session', async () => {
    let renewals = 0;
    const backend: AccountBackend = {
        async session() { return 'browser'; }, async freshSession() { renewals++; return 'fresh'; },
        async login() { throw { code: 'PT401', status: 401, message: 'This ruler requires a valid password.' }; },
        async sync() {}, async snapshot() { return createSolo('Alpha'); },
    };
    await assert.rejects(() => openRuler('Alpha', backend, { mode: 'login', password: password() }));
    assert.equal(renewals, 0);
});
