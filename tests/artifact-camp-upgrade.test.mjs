import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { ARTIFACTS } from '../src/features/heroes/domain/artifacts.ts';
import { BANDIT_CAMPS } from '../src/features/map/domain/bandits.ts';
import { campRules } from '../src/features/campaign/domain/campStock.ts';
const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111';
const admin=async sql=>{await db.exec('reset role');return db.exec(sql);};
const login=()=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`);
const rpc=async(name,args=[])=> (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
    await db.exec(await readFile('supabase/FRESH_INSTALL_V15.sql','utf8'));
    await admin(`insert into auth.users values('${owner}')`);await login();await rpc('create_player',['Upgrade QA']);let world=await rpc('peris_snapshot');
    const hero=world.heroes[0],army=world.armies[0],camp=BANDIT_CAMPS.find(c=>c.tier===10 && world.camps.some(existing=>existing.id===c.id));
    await admin(`insert into public.peris_hero_artifacts(owner_id,artifact_id,slot,hero_id)values('${owner}','iron_sword','weapon',${hero.id});update public.peris_heroes set experience=730 where id=${hero.id};update public.peris_camps set tier=1,infantry=8,archers=2,cavalry=0 where id=${camp.id};update public.armies set status='moving',raid_target_id=${camp.id},departure_at=now(),arrival_at=now()+interval '1 hour' where id=${army.id}`);
    const oldItem=(await db.query('select id from public.peris_hero_artifacts where hero_id=$1',[hero.id])).rows[0].id;
    await admin(`update public.peris_camp_stock set resources='{"wood":12,"stone":8,"food":3,"gold":1}',recruit_sequence=19,next_recruit_at=now()+interval '1 hour'where camp_id=${camp.id}`);
    const savedStock=(await db.query('select resources,recruit_sequence,next_recruit_at from public.peris_camp_stock where camp_id=$1',[camp.id])).rows[0];
    const upgrade=await readFile('supabase/UPDATE_ARTIFACTS_AND_CAMPS.sql','utf8');
    await admin(upgrade);const busy=(await db.query('select tier,infantry from public.peris_camps where id=$1',[camp.id])).rows[0];assert.deepEqual(busy,{tier:1,infantry:8});
    await admin(`update public.armies set status='idle',raid_target_id=null where id=${army.id}`);await admin(upgrade);await admin(upgrade);
    const restored=(await db.query('select tier,x,y,infantry,archers,cavalry from public.peris_camps where id=$1',[camp.id])).rows[0];
    assert.deepEqual(restored,{tier:camp.tier,x:camp.x,y:camp.y,infantry:8,archers:2,cavalry:0});
    assert.deepEqual((await db.query('select resources,recruit_sequence,next_recruit_at from public.peris_camp_stock where camp_id=$1',[camp.id])).rows[0],savedStock);
    assert.equal((await db.query('select experience from public.peris_heroes where id=$1',[hero.id])).rows[0].experience,730);
    assert.equal((await db.query('select hero_id from public.peris_hero_artifacts where id=$1',[oldItem])).rows[0].hero_id,hero.id);
    console.log('PASS · focused upgrade waits for busy camps, preserves casualties, camp stock, old equipment and XP, and is repeatable');
    for(let level=1;level<=10;level++) {
        const current=BANDIT_CAMPS.find(c=>c.tier===level && world.camps.some(existing=>existing.id===c.id)), rule=campRules(current);
        await admin(`update public.peris_camps set infantry=0,archers=0,cavalry=0 where id=${current.id};update public.peris_camp_stock set resources='{"wood":0,"stone":0,"food":0,"gold":0}',stock_updated_at=now()-interval '7 days',next_recruit_at=now()-interval '7 days',engaged_battle_id=null where camp_id=${current.id};select public.peris_camp_accrue(${current.id})`);
        const replenished=(await db.query('select c.infantry+c.archers+c.cavalry as soldiers,s.resources from public.peris_camps c join public.peris_camp_stock s on s.camp_id=c.id where c.id=$1',[current.id])).rows[0];
        assert.equal(replenished.soldiers,rule.defenderCap);assert.deepEqual(replenished.resources,rule.capacity);
    }
    console.log('PASS · ten-level camp recruitment caps and resource production agree with the normal game domain');
    for (const [id,item] of Object.entries(ARTIFACTS)) {
        await admin(`insert into public.peris_hero_artifacts(owner_id,artifact_id,slot)select '${owner}',id,slot from public.peris_artifact_catalog where id='${id}'`);
        const artifact=(await db.query('select max(id) as id from public.peris_hero_artifacts where artifact_id=$1',[id])).rows[0].id;
        await login();await rpc('peris_empire_command',[{type:'equipArtifact',heroId:hero.id,artifactId:artifact,equip:true}]);
        const equipped=(await db.query('select hero_id from public.peris_hero_artifacts where id=$1',[artifact])).rows[0];assert.equal(equipped.hero_id,hero.id);
        await rpc('peris_empire_command',[{type:'equipArtifact',heroId:hero.id,artifactId:artifact,equip:false}]);
        await admin(`delete from public.peris_hero_artifacts where id=${artifact}`);
    }
    console.log('PASS · all 24 catalog entries can be equipped and unequipped through authenticated commands');
} finally { await db.close(); }
