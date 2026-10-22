import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unattendedFixture } from './helpers/unattendedBattleFixture.ts';
const { db, query, owners } = await unattendedFixture(2, 'tests/fixtures/v18-pre-social.sql');
try {
    assert.equal((await query("select to_regclass('public.peris_world_clock') as clock"))[0].clock, null, 'fixture really predates the clock');
    await db.exec("insert into public.peris_orders(owner_id,kind,item,quantity,settlement_id,started_at,finish_at)select owner_id,'upgrade','wall',1,id,now(),now()+interval '1 minute'from public.settlements;insert into public.peris_garrisons(owner_id,col,row,infantry,archers,cavalry,unit_roster)values('" + owners[0] + "',99,99,7,2,1,'{\"spearmen\":7,\"archers\":2,\"knights\":1}')");
    const tables = ['players','settlements','armies','battles','battle_formations','peris_orders','peris_garrisons','peris_account_science','peris_progress','peris_reports'];
    const inventory = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, await query('select to_jsonb(t)as row from public.' + table + ' t order by to_jsonb(t)::text')])));
    const before = await inventory();
    const clockSql = await readFile('supabase/modules/time/game-clock.sql', 'utf8');
    await db.exec(clockSql);
    assert.deepEqual(await inventory(), before, 'first clock installation preserves every populated legacy row, queue date, battle version, troop pool and balance');
    assert.equal((await query('select public.peris_game_now()=now()as same'))[0].same, true);
    await db.exec(clockSql);
    assert.deepEqual(await inventory(), before, 'repeat installation preserves legacy data too');
    console.log('PASS · populated pre-clock 1x upgrade: exact accounts, resources, accepted orders, armies, stationed troops, active battles, science and reports preserved');
} catch (error: any) { console.error(error.message, error.where ?? ''); process.exitCode = 1; }
finally { await db.close(); }
