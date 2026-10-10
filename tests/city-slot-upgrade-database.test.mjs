import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);
        create role anon;create role authenticated;create role service_role;
        create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        grant usage on schema public,auth to authenticated,anon;
        grant execute on function auth.uid() to authenticated,anon;
        create publication supabase_realtime;`);
    await db.exec(await readFile('supabase/FRESH_INSTALL_V11.sql', 'utf8'));
    await db.exec(`insert into auth.users values('${owner}');set role authenticated;
        select set_config('request.jwt.claim.sub','${owner}',false);select public.create_player('Housing upgrade');reset role;`);
    const city = (await db.query('select id from public.settlements where owner_id=$1', [owner])).rows[0].id;
    await db.exec(`insert into public.peris_city_slots(settlement_id,slot_index,building_type,level) values
        (${city},0,'barracks',1),(${city},1,'stables',2),(${city},2,'smithy',3),
        (${city},3,'warehouse',4),(${city},4,'granary',5),(${city},5,'mage_tower',10),
        (${city},6,'housing',4),(${city},16,'fishery',2);
        insert into public.peris_spell_research(settlement_id,spell_id) values(${city},'spark'),(${city},'phoenix');`);
    const slots = async () => (await db.query('select * from public.peris_city_slots order by settlement_id,slot_index')).rows;
    const research = async () => (await db.query('select * from public.peris_spell_research order by settlement_id,spell_id')).rows;
    const before = await slots(), knowledge = await research();
    const originalHeroes = (await db.query('select * from public.peris_heroes order by id')).rows;
    const upgrade = await readFile('supabase/UPGRADE_TO_V11.sql', 'utf8');
    for (let run = 0; run < 2; run++) {
        await db.exec(upgrade);
        assert.deepEqual(await slots(), before, 'All eight slot types and levels survive an upgrade rerun');
        assert.deepEqual(await research(), knowledge, 'Research survives the upgrade');
        assert.deepEqual((await db.query('select * from public.peris_heroes order by id')).rows, originalHeroes);
    }
    console.log('PASS · V11 upgrades preserve housing, all other supported slots, level-ten towers, research and heroes on repeated execution');
    // Older complete aliases must carry exactly the same migration fix.
    for (const file of ['UPGRADE_TO_V10.sql', 'UPGRADE_TO_V9.sql', 'UPGRADE_TO_V8.sql', 'UPGRADE_TO_V7.sql', 'UPGRADE_V5_TO_V6.sql', 'schema.sql']) {
        assert.equal(await readFile(`supabase/${file}`, 'utf8'), upgrade, `${file} matches the corrected source`);
    }
    // The mage fragment must never narrow the existing population schema.
    await db.exec(await readFile('supabase/modules/magic/mage-tower.sql', 'utf8'));
    assert.deepEqual(await slots(), before);
    assert.deepEqual(await research(), knowledge);
    // Restore the complete server policy after testing the legacy fragment.
    await db.exec(upgrade);
    await assert.rejects(() => db.exec(`update public.peris_city_slots set building_type='unknown_building' where settlement_id=${city} and slot_index=0`), error => error.code === '23514');
    await assert.rejects(() => db.exec(`update public.peris_city_slots set level=6 where settlement_id=${city} and slot_index=6`), error => error.code === '23514');
    await assert.rejects(() => db.exec(`update public.peris_city_slots set level=11 where settlement_id=${city} and slot_index=5`), error => error.code === '23514');
    assert.deepEqual(await slots(), before, 'Rejected changes preserve every existing building');
    console.log('PASS · aliases and mage fragment retain housing; unknown types and invalid building levels remain blocked');
} catch (error) {
    console.error(error.stack, error.where ?? '', error.detail ?? '');
    process.exitCode = 1;
} finally {
    await db.close();
}
