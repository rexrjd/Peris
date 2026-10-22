import assert from 'node:assert/strict';
import { testPostgres } from './helpers/testPostgres.ts';
const db = testPostgres();
const owners = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const releases: Array<() => Promise<void>> = [];
const inventory = () => db.json("select jsonb_build_object('battles',(select jsonb_agg(b order by id)from public.battles b),'formations',(select jsonb_agg(f order by id)from public.battle_formations f),'armies',(select jsonb_agg(a order by id)from public.armies a),'cities',(select jsonb_agg(s order by id)from public.settlements s),'heroes',(select jsonb_agg(h order by id)from public.peris_heroes h),'reports',(select jsonb_agg(r order by id)from public.peris_reports r),'artifacts',(select jsonb_agg(a order by id)from public.peris_hero_artifacts a))");
try {
    await db.initialize();
    for (let i = 0; i < owners.length; i++) await db.exec("insert into auth.users values('" + owners[i] + "');set role authenticated;select set_config('request.jwt.claim.sub','" + owners[i] + "',false);select public.create_player('Concurrency ruler " + i + "');reset role;select public.peris_start_raid('" + owners[i] + "',1)");
    // Small real combat debt isolates lock scheduling from ten-second simulation cost.
    await db.exec("update public.battles set last_tick_at=now()-interval '200 milliseconds'");
    await db.exec("insert into public.peris_orders(owner_id,kind,item,quantity,settlement_id,started_at,finish_at)select owner_id,'upgrade','wall',1,id,now()-interval '2 seconds',now()-interval '1 second'from public.settlements where owner_id='" + owners[0] + "'");
    const ownerLock = await db.hold("select id from public.players where id='" + owners[0] + "' for update");
    releases.push(ownerLock);
    await db.json('select public.peris_game_tick(1)', 1500);
    const progress = await db.json("select jsonb_build_object('elapsed',elapsed)from public.battles where attacker_owner_id='" + owners[1] + "'");
    assert.ok(Number(progress.elapsed) > 0, 'a locked first owner must not prevent a healthy battle from advancing');
    await ownerLock(); releases.pop();
    console.log('PASS · real independent sessions: locked owner does not stall healthy battle progress');

    await db.exec("update public.battles set last_tick_at=now()-interval '200 milliseconds'");
    const battleLock = await db.hold('select id from public.battles where id=(select min(id)from public.battles)for update');
    releases.push(battleLock);
    await db.json('select public.peris_game_tick(1)', 1500);
    await battleLock(); releases.pop();
    const workerLock = await db.hold('select pg_advisory_xact_lock(204215)');
    releases.push(workerLock);
    assert.equal((await db.json('select public.peris_game_tick(1)', 1500)).busy, true);
    await workerLock(); releases.pop();
    console.log('PASS · real SKIP LOCKED battle selection and overlapping-worker exclusion');

    await db.exec("insert into public.peris_settler_expeditions(owner_id,origin_settlement_id,col,row,name,departure_at,arrival_at,culture_cost,march_path)select owner_id,id,99,99,'Lock fixture',now()-interval '2 seconds',now()-interval '1 second',1,'[]'from public.settlements where owner_id='" + owners[0] + "'");
    const landLock = await db.hold('select pg_advisory_xact_lock(204200)');
    releases.push(landLock);
    assert.equal((await db.json("select jsonb_build_object('acquired',public.peris_lock_battle_participants('" + owners[0] + "',null))")).acquired, false);
    await db.exec("begin;select id from public.players where id='" + owners[0] + "' for update nowait;rollback", 1500);
    await landLock(); releases.pop();
    assert.equal((await db.json("select jsonb_build_object('acquired',public.peris_lock_battle_participants('" + owners[0] + "',null))")).acquired, true);
    await db.exec('delete from public.peris_settler_expeditions');
    console.log('PASS · land reservation contention defers safely and retains no participant locks');

    const bid = Number((await db.json("select jsonb_build_object('id',min(id))from public.battles")).id);
    await db.exec("update public.battle_formations set soldiers=0,status='routed'where battle_id=" + bid + " and side='defender';update public.battles set last_tick_at=now()-interval '1 second'where id=" + bid);
    const before = await inventory();
    await db.exec("create function public.peris_test_late_fault()returns trigger language plpgsql as $$begin perform pg_sleep(2);return new;end$$;create trigger peris_test_late_fault before insert on public.peris_reports for each row execute function public.peris_test_late_fault()");
    await assert.rejects(() => db.exec("select public.peris_tick_for(" + bid + ",'" + owners[0] + "')", 150), /statement timeout/);
    assert.deepEqual(await inventory(), before, 'statement cancellation rolls back every gameplay write');
    await db.exec('drop trigger peris_test_late_fault on public.peris_reports;drop function public.peris_test_late_fault()');
    await Promise.all([db.exec("select public.peris_tick_for(" + bid + ",'" + owners[0] + "')"), db.exec("select public.peris_tick_for(" + bid + ",'" + owners[0] + "')")]);
    const settled = await inventory();
    assert.equal(settled.battles.find((b: any) => Number(b.id) === bid).status, 'resolved');
    await Promise.all([db.exec("select public.peris_finish(" + bid + ",'attacker','Duplicate')"), db.exec("select public.peris_finish(" + bid + ",'attacker','Duplicate')")]);
    assert.deepEqual(await inventory(), settled, 'overlapping result retries cannot duplicate gameplay effects');
    console.log('PASS · real statement cancellation, full rollback, concurrent ticks and duplicate finalizers');
} catch (error: any) { console.error(error.message); process.exitCode = 1; }
finally { for (const release of releases.reverse()) await release(); }
