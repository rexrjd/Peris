import assert from 'node:assert/strict';
import { unattendedFixture } from './helpers/unattendedBattleFixture.ts';
let parity: unknown;
for (const rate of [1, 10, 100]) {
    const { db, query, owners } = await unattendedFixture(0);
    try {
        await query('select public.peris_configure_test_clock($1)', [rate]);
        await db.exec("begin;update public.peris_world_clock set real_anchor=now(),game_anchor=now()+interval '10 minutes';set role authenticated;select set_config('request.jwt.claim.sub','" + owners[0] + "',false);select public.create_player('Clock journey');reset role");
        assert.equal((await query('select departure_at=public.peris_game_now() as correct from public.armies limit 1'))[0].correct, true, 'new army departure uses game time at rate ' + rate);
        assert.equal((await query('select resources_updated_at=public.peris_game_now() as correct from public.settlements limit 1'))[0].correct, true, 'new city accrual cursor uses game time');
        await db.exec("insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)select id,0,'barracks',1 from public.settlements on conflict(settlement_id,slot_index)do update set building_type='barracks',level=1;set role authenticated");
        const before = (await query("select public.peris_queue_upgrade('wall'),public.peris_queue_recruit('infantry',2),public.peris_empire_command('{\"type\":\"startResearch\",\"technologyId\":\"writing\"}'),public.peris_snapshot() as world"))[0].world;
        await db.exec("reset role;update public.peris_camp_stock set resources='{\"wood\":0,\"stone\":0,\"food\":0,\"gold\":0}',stock_updated_at=public.peris_game_now(),next_recruit_at=public.peris_game_now()+interval '10 minutes';set role authenticated");
        for (const order of before.orders) assert.equal(Date.parse(order.started_at), Date.parse(before.server_now), 'accepted queue begins on authoritative game clock');
        const infantry = before.armies[0].infantry;
        const wall = before.buildings.find((b: any) => b.building_type === 'wall');
        await db.exec('reset role;update public.peris_world_clock set real_anchor=real_anchor-make_interval(secs=>60.0/rate);set role authenticated;select public.sync_my_state()');
        const after = (await query('select public.peris_snapshot() as world'))[0].world;
        assert.equal(after.orders.length, 0, 'sixty game seconds complete real accepted queues');
        assert.equal(after.armies[0].infantry, infantry + 2);
        assert.equal(after.buildings.find((b: any) => b.id === wall.id).level, wall.level + 1);
        assert.ok(after.research_progress.find((p: any) => p.technology_id === 'writing').completed_at, 'accepted research completes on game time');
        assert.equal(after.account_science[0].active_id, null);
        await db.exec('select public.sync_my_state()');
        const repeated = (await query('select public.peris_snapshot() as world'))[0].world;
        assert.equal(repeated.armies[0].infantry, after.armies[0].infantry, 'repeated settlement cannot recruit twice');
        assert.equal(repeated.settlements[0].wood, after.settlements[0].wood, 'no double resource accrual at same game instant');
        await db.exec('reset role;select public.peris_camp_accrue(camp_id)from public.peris_camp_stock');
        const camps = await query('select camp_id,resources,recruit_sequence from public.peris_camp_stock order by camp_id');
        const state = {
            city: Object.fromEntries(['wood','stone','food','gold','population','population_growth','wood_rate','stone_rate','food_rate','gold_rate'].map(k => [k, after.settlements[0][k]])),
            science: after.account_science[0].points,
            culture: (await query('select culture_points from public.players limit 1'))[0].culture_points,
            troops: after.armies[0].unit_roster,
            camps,
        };
        if (parity === undefined) parity = state;
        else assert.deepEqual(state, parity, 'identical game elapsed time preserves economy, population, science, culture, troops and camp resource accounting at rate ' + rate);
        await db.exec('commit');
        console.log('PASS · rate ' + rate + ': paid upgrade/recruit/research, idempotent settlement, equivalent economy/population/science/culture/camp accounting');
    } catch (error: any) { console.error(error.message, error.where ?? ''); process.exitCode = 1; break; }
    finally { await db.close(); }
}
