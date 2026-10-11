import test from 'node:test';
import assert from 'node:assert/strict';
import { MutationJournal, type MutationIntent } from '../src/engine/online/mutationJournal';
const id = '11111111-1111-4111-8111-111111111111';
function storage() { let saved: unknown = null; return { read: () => saved, write: (intent: MutationIntent | null) => { saved = structuredClone(intent); } }; }
test('lost response survives reload and retries the same request instead of repeating a purchase', async () => {
    const saved = storage(), receipts = new Set<string>(); let charges = 0, lose = true;
    const transport = async (intent: MutationIntent) => { if (!receipts.has(intent.requestId)) { charges++; receipts.add(intent.requestId); } if (lose) { lose = false; throw Error('Connection lost after commit'); } return { error: null }; };
    const journal = new MutationJournal(saved, transport, () => id, () => {});
    await assert.rejects(journal.send('peris_queue_recruit', { p_type: 'infantry', p_quantity: 2 }), /unconfirmed/);
    await assert.rejects(journal.send('peris_queue_recruit', { p_type: 'infantry', p_quantity: 2 }), /pending order/);
    const reloaded = new MutationJournal(saved, transport, () => 'other', () => {});
    assert.equal(reloaded.pending?.requestId, id); await reloaded.retry();
    assert.equal(charges, 1); assert.equal(reloaded.pending, null); assert.equal(saved.read(), null);
});
test('authoritative rejection clears pending command while network errors retain it', async () => {
    const saved = storage(); let definite = false;
    const journal = new MutationJournal(saved, async () => ({ error: definite ? { code: 'P0001', message: 'Insufficient stock' } : { code: '', message: 'Failed to fetch' } }), () => id, () => {});
    await assert.rejects(journal.send('peris_queue_recruit', {}), /unconfirmed/); assert.ok(journal.pending);
    definite = true; await assert.rejects(journal.retry(), /Insufficient stock/); assert.equal(journal.pending, null);
});
test('overlapping clicks and retries cannot dispatch a second mutation', async () => {
    let finish!: () => void; let calls = 0;
    const journal = new MutationJournal(storage(), async () => { calls++; await new Promise<void>(resolve => { finish = resolve; }); return { error: null }; }, () => id, () => {});
    const sending = journal.send('peris_queue_recruit', {});
    await assert.rejects(journal.send('peris_queue_recruit', {}), /pending order/); await assert.rejects(journal.retry(), /already/);
    finish(); await sending; assert.equal(calls, 1);
});
test('an expired session or unavailable receipt endpoint never forgets an accepted request', async () => {
    for (const code of ['PGRST301', 'PGRST302', 'PGRST303', '28000', '28P01', '42501', 'PGRST202', 'PGRST203']) {
        const saved = storage(); let calls = 0, charges = 0; const receipts = new Set<string>();
        const journal = new MutationJournal(saved, async intent => {
            calls++;
            if (calls === 2) return { error: { code, message: 'Session or endpoint unavailable' } };
            if (!receipts.has(intent.requestId)) { receipts.add(intent.requestId); charges++; }
            if (calls === 1) throw Error('Response lost after commit');
            return { error: null };
        }, () => id, () => {});
        await assert.rejects(journal.send('peris_queue_recruit', {})); await assert.rejects(journal.retry());
        assert.equal(journal.pending?.requestId, id); assert.equal((saved.read() as MutationIntent).requestId, id);
        await journal.retry(); assert.equal(charges, 1); assert.equal(journal.pending, null);
    }
});
test('failed persistence never sends and failed cleanup never marks accepted order as failed', async () => {
    let calls = 0;
    const failBefore = new MutationJournal({ read: () => null, write: () => { throw Error('Storage unavailable'); } }, async () => { calls++; return { error: null }; }, () => id, () => {});
    await assert.rejects(failBefore.send('peris_queue_recruit', {}), /Storage/); assert.equal(calls, 0);
    const failAfter = new MutationJournal({ read: () => null, write: intent => { if (!intent) throw Error('cleanup'); } }, async () => ({ error: null }), () => id, () => {});
    await failAfter.send('peris_queue_recruit', {}); assert.equal(failAfter.pending, null);
});
