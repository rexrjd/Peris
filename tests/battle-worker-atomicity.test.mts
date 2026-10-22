import assert from 'node:assert/strict';
import { unattendedFixture } from './helpers/unattendedBattleFixture.ts';
const { db, query, owners } = await unattendedFixture();
try {
    assert.equal((await query("select to_regprocedure('public.peris_lock_battle_participants(uuid,uuid)') is not null as present"))[0].present, true, 'all battle modes need the same nonblocking participant preflight');
    const bid = (await query('select id from public.battles where attacker_owner_id=$1', [owners[0]]))[0].id;
    const guard = (await query("select pg_get_functiondef('public.peris_lock_battle_participants(uuid,uuid)'::regprocedure) as definition"))[0].definition;
    await db.exec("create or replace function public.peris_lock_battle_participants(p_attacker uuid,p_defender uuid)returns boolean language sql as $$select false$$");
    const elapsed = (await query('select elapsed from public.battles where id=$1', [bid]))[0].elapsed;
    assert.equal((await query('select public.peris_tick_for($1,$2) as result', [bid, owners[0]]))[0].result.busy, true);
    assert.equal((await query('select elapsed from public.battles where id=$1', [bid]))[0].elapsed, elapsed, 'busy preflight cannot consume elapsed debt');
    await db.exec(guard);
    const inventory = async () => (await query("select jsonb_build_object('battles',(select jsonb_agg(b order by id)from public.battles b),'formations',(select jsonb_agg(f order by id)from public.battle_formations f),'armies',(select jsonb_agg(a order by id)from public.armies a),'cities',(select jsonb_agg(s order by id)from public.settlements s),'heroes',(select jsonb_agg(h order by id)from public.peris_heroes h),'artifacts',(select jsonb_agg(a order by id)from public.peris_hero_artifacts a),'reports',(select jsonb_agg(r order by id)from public.peris_reports r),'garrisons',(select jsonb_agg(g)from public.peris_garrisons g),'city_garrisons',(select jsonb_agg(g)from public.peris_city_garrisons g),'evacuations',(select jsonb_agg(e)from public.peris_ruin_evacuations e)) as state"))[0].state;
    await query("update public.battle_formations set soldiers=0,status='routed'where battle_id=$1 and side='defender'", [bid]);
    const before = await inventory();
    await db.exec("create function public.peris_test_report_fault()returns trigger language plpgsql as $$begin raise exception 'Injected report write failure';end$$;create trigger peris_test_report_fault before insert on public.peris_reports for each row execute function public.peris_test_report_fault()");
    await assert.rejects(() => query("select public.peris_tick_for($1,$2)", [bid, owners[0]]), /Injected report write failure/);
    assert.deepEqual(await inventory(), before, 'late report failure rolls back all casualties, rewards, travel and elapsed state');
    await db.exec('drop trigger peris_test_report_fault on public.peris_reports;drop function public.peris_test_report_fault()');
    await query("select public.peris_tick_for($1,$2)", [bid, owners[0]]);
    assert.equal((await query('select status from public.battles where id=$1', [bid]))[0].status, 'resolved');
    const resolved = await inventory();
    await query("select public.peris_finish($1,'attacker','Repeated finalizer')", [bid]);
    await query("select public.peris_tick_for($1,$2)", [bid, owners[0]]);
    assert.deepEqual(await inventory(), resolved, 'duplicate result/tick is an inventory no-op');
    console.log('PASS · shared participant preflight, busy debt preservation, late-write rollback and exactly-once retry');
} catch (error: any) { console.error(error.message, error.where ?? ''); process.exitCode = 1; }
finally { await db.close(); }
