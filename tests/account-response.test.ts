import test from 'node:test';
import assert from 'node:assert/strict';
import { openRuler } from '../src/platform/backend/accountLogin';
import { createSolo } from '../src/features/campaign/domain/newRealm';
const api: any = await import('../src/platform/backend/accountResponse').catch(() => ({}));

test('real PostgREST gateway/network responses retain status and retry the same identity', async () => {
    assert.equal(typeof api.accountResponse, 'function');
    for (const status of [0, 502, 503, 504]) {
        const world = createSolo('Alice'), owner = world.players[0].id;
        let logins = 0, reads = 0;
        const result = await openRuler('Alice', {
            session: async () => owner, freshSession: async () => { throw new Error('must retain session'); },
            login: async () => { logins++; return {player_id: owner, display_name: 'Alice', created: false}; },
            sync: async () => {}, wait: async () => {}, snapshot: async () => {
                reads++;
                return api.accountResponse(reads === 1 ? {data: null, error: {code: '', message: 'Fetch failed'}, status} : {data: world, error: null, status: 200});
            },
        });
        assert.equal(result.ruler.player_id, owner); assert.equal(logins, 1); assert.equal(reads, 2);
    }
});
