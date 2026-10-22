import assert from 'node:assert/strict';
import { unattendedFixture } from './helpers/unattendedBattleFixture.ts';

const { db, query, owners, worker } = await unattendedFixture();
try {
    await db.exec("insert into public.peris_orders(owner_id,kind,item,quantity,settlement_id,started_at,finish_at)select '" + owners[0] + "','field','field:99:99:lumber',1,id,now()-interval '2 days',now()-interval '1 day' from public.settlements where owner_id='" + owners[0] + "' order by id limit 1");
    await db.exec("insert into public.peris_orders(owner_id,kind,item,quantity,settlement_id,started_at,finish_at)select '" + owners[1] + "','upgrade','wall',1,id,now()-interval '2 seconds',now()-interval '1 second' from public.settlements where owner_id='" + owners[1] + "' order by id limit 1");
    await worker();
    const healthy = (await query('select elapsed from public.battles where attacker_owner_id=$1', [owners[1]]))[0];
    assert.ok(Number(healthy.elapsed) > 0, 'healthy battle must advance independently of a corrupt oldest owner');
    const failed = (await query('select * from public.peris_worker_owners where owner_id=$1', [owners[0]]))[0];
    assert.equal(failed.consecutive_failures, 1);
    assert.ok(Date.parse(failed.next_attempt_at) > Date.now());
    await worker();
    assert.equal((await query('select consecutive_failures from public.peris_worker_owners where owner_id=$1', [owners[0]]))[0].consecutive_failures, 1, 'failed owner is backed off');
    assert.equal((await query('select * from public.peris_worker_owners where owner_id=$1', [owners[1]])).length, 1, 'healthy owner gets a turn');
    await assert.rejects(() => worker(null), /budget/i);
    await assert.rejects(() => worker(0), /budget/i);
    await assert.rejects(() => worker(101), /budget/i);
    await assert.rejects(() => query('select public.peris_advance_battles(null,2000)'), /budget/i);
    await assert.rejects(() => query('select public.peris_advance_battles(20,null)'), /budget/i);
    await assert.rejects(() => query('select public.peris_advance_battles(20,0)'), /budget/i);
    // No elapsed debt is thrown away, even across several bounded passes.
    const before = Number(healthy.elapsed);
    await query('select public.peris_advance_battles(100,5000)');
    const after = Number((await query('select elapsed from public.battles where attacker_owner_id=$1', [owners[1]]))[0].elapsed);
    assert.ok(after > before && after <= before + 20, 'each invocation advances at most ten game seconds per battle');
    await db.exec('set role authenticated');
    await assert.rejects(() => query('select public.peris_game_tick(1)'), /permission/);
    await assert.rejects(() => query('select public.peris_advance_battles(1,1)'), /permission/);
    await assert.rejects(() => query('select * from public.peris_battle_work'), /permission/);
    console.log('PASS · corrupt-owner isolation, independent battle progress, owner backoff/fairness, preserved debt, budget validation and private worker access');
} finally { await db.close(); }
