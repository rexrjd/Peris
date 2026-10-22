import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unattendedFixture } from './helpers/unattendedBattleFixture.ts';
const { db, query, owners } = await unattendedFixture(0);
try {
    assert.equal((await query("select to_regprocedure('public.peris_game_now()') is not null as present"))[0].present, true, 'authoritative game clock must exist');
    const initial = (await query('select public.peris_clock_snapshot() as sample,public.peris_game_now()=now() as unchanged'))[0];
    assert.equal(initial.unchanged, true, '1x migration does not change existing UTC dates');
    assert.equal(initial.sample.rate, 1);
    assert.equal(initial.sample.version, 1);
    await assert.rejects(() => query('select public.peris_configure_test_clock(2)'), /clock/i);
    await query('select public.peris_configure_test_clock(100)');
    await db.exec("update public.peris_world_clock set real_anchor=now()-interval '1 second',game_anchor='2040-01-01T00:00:00Z'");
    const accelerated = (await query('select public.peris_clock_snapshot() as sample,(extract(epoch from(public.peris_game_now()-game_anchor))/extract(epoch from(now()-real_anchor))) as ratio from public.peris_world_clock'))[0];
    assert.equal(Number(accelerated.ratio), 100);
    assert.equal(accelerated.sample.profile_id, 'accelerated-test-v1');
    assert.equal(accelerated.sample.rate, 100);
    await db.exec('update public.peris_world_clock set real_anchor=now(),game_anchor=now()');
    await db.exec("set role authenticated;select set_config('request.jwt.claim.sub','" + owners[0] + "',false);select public.create_player('Clock ruler');reset role");
    await assert.rejects(() => query('select public.peris_configure_test_clock(1)'), /empty/i);
    const clockBefore = await query('select * from public.peris_world_clock');
    const datesBefore = await query('select id,departure_at,arrival_at from public.armies order by id');
    await db.exec(await readFile('supabase/UPGRADE_TO_V19.sql', 'utf8'));
    assert.deepEqual(await query('select * from public.peris_world_clock'), clockBefore, 'rerun does not reset accelerated clock anchors/profile');
    assert.deepEqual(await query('select id,departure_at,arrival_at from public.armies order by id'), datesBefore, 'rerun preserves accepted journey timestamps');
    await db.exec('set role authenticated');
    const world = (await query('select public.peris_snapshot() as world'))[0].world;
    assert.equal(world.game_clock.rate, 100);
    assert.equal(Date.parse(world.server_now), Date.parse(world.game_clock.game_now));
    await assert.rejects(() => query('select * from public.peris_world_clock'), /permission/);
    await assert.rejects(() => query('select public.peris_configure_test_clock(1)'), /permission/);
    await assert.rejects(() => query('select public.peris_game_now()'), /permission/);
    console.log('PASS · compatible 1x anchors, 100x arithmetic, empty-test-world configuration, rerun preservation and private clock permissions');
} catch (error: any) { console.error(error.message, error.where ?? ''); process.exitCode = 1; }
finally { await db.close(); }
