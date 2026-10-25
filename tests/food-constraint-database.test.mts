import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

for (const rate of [1, 10, 100]) {
  const db = new PGlite();
  const attacker = '11111111-1111-4111-8111-111111111111';
  const defender = '22222222-2222-4222-8222-222222222222';
  const rows = async (sql: string) => (await db.query<any>(sql)).rows;
  try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);
      create role anon;create role authenticated;create role service_role;
      create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon;
      grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
    await db.exec(await readFile('supabase/FRESH_INSTALL_V19.sql', 'utf8'));
    await db.exec(`select public.peris_configure_test_clock(${rate});
      create or replace function public.peris_game_now()returns timestamptz language sql stable security definer set search_path='' as $$select '2030-01-02'::timestamptz$$;
      insert into auth.users values('${attacker}'),('${defender}');
      select set_config('request.jwt.claim.sub','${defender}',false);select public.create_player('Food defender ${rate}');
      select set_config('request.jwt.claim.sub','${attacker}',false);select public.create_player('Food attacker ${rate}')`);
    const city = (await rows(`select id from public.settlements where owner_id='${defender}'`))[0].id;
    const army = (await rows(`select id from public.armies where owner_id='${attacker}'`))[0].id;

    // Loading a depleted city must settle negative production without negative storage.
    await db.exec(`begin;select set_config('request.jwt.claim.sub','${defender}',false);
      update public.buildings set level=case when building_type='market' then 1 else 0 end where settlement_id=${city};
      update public.peris_city_slots set level=0 where settlement_id=${city};
      insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)values(${city},0,'housing',5)
      on conflict(settlement_id,slot_index)do update set building_type='housing',level=5;
      update public.settlements set food=0,population=200,population_capacity=200,resources_updated_at='2030-01-01' where id=${city};
      select public.peris_city_economy(${city});
      select public.sync_my_state()`);
    const depleted = (await rows(`select public.peris_snapshot() snapshot`))[0].snapshot;
    assert.ok(depleted.settlements.every((s: any) => Number(s.food) >= 0));
    assert.equal(Number(depleted.settlements.find((s: any) => s.id === city).food), 0);
    assert.ok(Number(depleted.settlements.find((s: any) => s.id === city).food_rate) < 0);
    await db.exec('rollback');

    // A pending siege can finish during login catch-up. The last building falls,
    // ruins clear the stores, and the raid must still take its loot exactly once.
    await db.exec(`select public.peris_write_roster(${army},'{"infantry":100,"catapult":100}');
      update public.armies set unit_roster=public.peris_roster('{}'),infantry=0,archers=0,cavalry=0 where owner_id='${defender}';
      update public.buildings set level=case when building_type='market' then 1 else 0 end where settlement_id=${city};
      update public.peris_city_slots set level=0 where settlement_id=${city};
      update public.settlements set wood=0,stone=0,food=100,gold=0,resources_updated_at=public.peris_game_now() where id=${city};
      update public.armies a set status='idle',raid_city_id=${city},siege_target='market',
      start_x=s.x,start_y=s.y,target_x=s.x,target_y=s.y from public.settlements s where a.id=${army} and s.id=${city}`);
    const battle = (await rows(`select public.peris_start_city_raid('${attacker}',${army}) id`))[0].id;
    assert.ok(battle);
    if (rate !== 1) {
      // The focused repair must be safe while this battle is pending, and must
      // leave the clock, crop integrator and other installed capabilities alone
      // (the unchanged private participant guard is included as a prerequisite).
      const otherFunctions = `select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.prokind='f' and p.proname<>'peris_finish_city_raid' order by p.oid`;
      const before = await rows(otherFunctions);
      const hotfix = await readFile('supabase/UPGRADE_CITY_RAID_RESOURCE_FIX.sql','utf8');
      await db.exec(hotfix);
      await db.exec(hotfix);
      assert.deepEqual(await rows(otherFunctions), before);
      assert.equal((await rows(`select status from public.battles where id=${battle}`))[0].status, 'active');
    }
    await db.exec(`update public.battles set last_tick_at=public.peris_game_now()-interval '1 second' where id=${battle};
      set role authenticated;select public.peris_tick(${battle});select public.sync_my_state();select public.peris_snapshot();reset role`);
    const ruined = (await rows(`select ruined_at,wood,stone,food,gold from public.settlements where id=${city}`))[0];
    assert.ok(ruined.ruined_at);
    for (const resource of ['wood','stone','food','gold']) assert.equal(Number(ruined[resource]), 0);
    const finished = (await rows(`select status,result from public.battles where id=${battle}`))[0];
    assert.equal(finished.status, 'resolved');
    assert.equal(finished.result.loot.food, 100);
    assert.equal((await rows(`select carried_loot->>'food' food from public.armies where id=${army}`))[0].food, '100');
    await db.exec(`select public.peris_finish(${battle},'attacker','duplicate');select public.sync_my_state()`);
    assert.deepEqual((await rows(`select ruined_at,wood,stone,food,gold from public.settlements where id=${city}`))[0], ruined);
    assert.equal((await rows(`select count(*)::int n from public.peris_reports where battle_id=${battle}`))[0].n, 2);
    // The database invariant remains intact, even after the hotfix.
    await assert.rejects(db.exec(`update public.settlements set food=-1 where id=${city}`), /settlements_food_check/);
    console.log(`Food constraint ${rate}x: depleted login and siege catch-up, conserved loot, replay and nonnegative storage passed.`);
  } catch (error: any) {
    console.error(`Food constraint ${rate}x`, error.message, error.where ?? '');
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
