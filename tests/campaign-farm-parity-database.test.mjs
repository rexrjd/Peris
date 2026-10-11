import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite(), owner = '11111111-1111-4111-8111-111111111111', rival = '22222222-2222-4222-8222-222222222222';
const admin = async sql => { await db.exec('reset role'); return db.exec(sql); };
const login = (id = owner) => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);
const rpc = async (name,args=[]) => (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const command = cmd => rpc('peris_campaign_farm_command',[JSON.stringify(cmd)]), snapshot = () => rpc('peris_snapshot');
try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
    const manifest = JSON.parse(await readFile('supabase/modules/manifest.json','utf8'));
    const upgrade = (await Promise.all(manifest.map(path=>readFile('supabase/modules/'+path,'utf8')))).join('').replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');
    await db.exec(await readFile('supabase/modules/install/fresh-base.sql','utf8')+upgrade+await readFile('supabase/modules/install/fresh-tail.sql','utf8'));
    await admin(`insert into auth.users values('${owner}'),('${rival}')`); await login(); await rpc('create_player',['Farm parity']);
    let world = await snapshot(); const army = world.armies[0], camps = world.camps.filter(c=>c.bandit).slice(0,3), preset = {infantry:1,archers:0,cavalry:0,scout:0};
    const first = await command({type:'saveCampaignFarmList',name:'First list',troops:preset,casualtiesOnly:true}), second = await command({type:'saveCampaignFarmList',name:'Second list',troops:preset,casualtiesOnly:false});
    const save = (camp,list=first.id) => command({type:'saveCampaignFarm',listId:list,campId:camp.id,armyId:army.id,troops:preset,enabled:true,intervalSeconds:300});
    const one = await save(camps[0]), two = await save(camps[1]), duplicate = await save(camps[0],second.id);
    const before = (await snapshot()).campaign_farms;
    await assert.rejects(()=>command({type:'manageCampaignFarmTargets',ids:[one.id,two.id],action:'move',listId:second.id}),/already/);
    assert.deepEqual((await snapshot()).campaign_farms,before);
    for (const ids of [[one.id,987654],[one.id,one.id],[],[one.id+.5]]) await assert.rejects(()=>command({type:'manageCampaignFarmTargets',ids,action:'delete'}));
    await command({type:'manageCampaignFarmTargets',ids:[duplicate.id],action:'delete'});
    await command({type:'manageCampaignFarmTargets',ids:[one.id,two.id],action:'move',listId:second.id}); world=await snapshot();
    for(const farm of world.campaign_farms) { assert.equal(farm.list_id,second.id); assert.equal(farm.next_at,before.find(f=>f.id===farm.id).next_at); assert.deepEqual(farm.troops,before.find(f=>f.id===farm.id).troops); }
    // Real authoritative starts count the available party and busy-legion skip.
    // Failed whole batches roll back counters just like their troop allocation.
    await admin("update public.peris_world_map set walkable=decode(repeat('ff',5000),'hex')");await login();
    const batch=await command({type:'startCampaignFarmList',id:second.id});assert.equal(batch.started,1);assert.equal(batch.skipped.length,1);
    world=await snapshot();assert.deepEqual(world.campaign_farms.map(f=>[f.sent,f.skipped]),[[1,0],[0,1]]);
    const counted=structuredClone(world.campaign_farms);await assert.rejects(()=>command({type:'startCampaignFarmList',id:second.id}),/No raids started/);assert.deepEqual((await snapshot()).campaign_farms,counted);
    await rpc('peris_empire_command',[JSON.stringify({type:'cancelMarch',armyId:army.id,sentAt:world.armies[0].march_sent_at})]);world=await snapshot();assert.equal(world.armies[0].status,'idle');assert.equal(world.armies[0].infantry,army.infantry);
    const next = world.campaign_farms[0].next_at;
    await command({type:'setCampaignFarmListEnabled',id:second.id,enabled:true}); assert.equal((await snapshot()).campaign_farms[0].next_at,next);
    await command({type:'setCampaignFarmListEnabled',id:second.id,enabled:false}); assert.ok((await snapshot()).campaign_farms.every(f=>!f.enabled&&f.next_at===null));
    await command({type:'setCampaignFarmListEnabled',id:second.id,enabled:true}); assert.ok((await snapshot()).campaign_farms.every(f=>f.enabled&&f.next_at));
    const newPreset={infantry:0,archers:0,cavalry:0,heavyCavalry:3,catapult:2};
    await command({type:'saveCampaignFarmList',id:second.id,name:'Second list',troops:newPreset,casualtiesOnly:true});
    const schedules=(await snapshot()).campaign_farms.map(f=>f.next_at);
    await command({type:'applyCampaignFarmListTroops',id:second.id}); world=await snapshot(); assert.ok(world.campaign_farms.every(f=>f.troops.heavyCavalry===3&&f.troops.catapult===2)); assert.deepEqual(world.campaign_farms.map(f=>f.next_at),schedules);
    await login(rival); await rpc('create_player',['Other farms']);
    for(const cmd of [{type:'manageCampaignFarmTargets',ids:[one.id],action:'delete'},{type:'setCampaignFarmListEnabled',id:second.id,enabled:false},{type:'applyCampaignFarmListTroops',id:second.id}]) await assert.rejects(()=>command(cmd),/own/);
    assert.deepEqual((await snapshot()).campaign_farm_stats,[]);
    await login();
    await admin(`with inserted as(insert into public.battles(attacker_owner_id,attacker_army_id,status,phase,mode,camp_id,winner_side,result)select '${owner}',${army.id},'resolved','finished','pve',${camps[0].id},case when n=100 then 'draw'else 'attacker'end,jsonb_build_object('attacker_losses',case when n<=20 then 0 else 1 end,'loot',jsonb_build_object('wood',100),'delivered',jsonb_build_object('wood',3),'delivered_at',now()-make_interval(secs=>101-n))from generate_series(1,100)n returning id,result)insert into public.peris_reports(owner_id,battle_id,title,won,result,camp_id,farm_list_id)select '${owner}',id,'Quiet and visible deliveries',true,result,${camps[0].id},${second.id} from inserted;`);
    await login(); world=await snapshot(); assert.equal(world.reports.length,50); assert.equal(world.report_count,80); assert.equal(world.hidden_report_count,20);
    const stat=world.campaign_farm_stats.find(s=>s.camp_id===camps[0].id); assert.equal(stat.raids,100); assert.equal(stat.total_loot,300); assert.equal(stat.last_loot,3); assert.equal(stat.last_result,'draw');
    await admin(`with b as(insert into public.battles(attacker_owner_id,attacker_army_id,status,phase,mode,camp_id,winner_side,result)values('${owner}',${army.id},'resolved','finished','pve',${camps[0].id},'attacker','{"attacker_losses":1,"loot":{"wood":9999}}')returning id,result)insert into public.peris_reports(owner_id,battle_id,title,won,result,camp_id)select '${owner}',id,'Loot still returning',true,result,${camps[0].id} from b;`);
    await login(); assert.equal((await snapshot()).campaign_farm_stats[0].total_loot,300);
    await login(rival); assert.deepEqual((await snapshot()).campaign_farm_stats,[]); assert.equal((await snapshot()).report_count,0); assert.equal((await snapshot()).hidden_report_count,0);
    await login(); const farmState=(await snapshot()).campaign_farms; await admin(upgrade); await login(); assert.deepEqual((await snapshot()).campaign_farms,farmState); assert.equal((await snapshot()).campaign_farm_stats[0].total_loot,300);
    await command({type:'manageCampaignFarmTargets',ids:[one.id,two.id],action:'delete'}); assert.deepEqual((await snapshot()).campaign_farms,[]); assert.equal((await snapshot()).campaign_farm_stats[0].raids,100);
    console.log('PASS · atomic bulk farm ownership/move/delete, schedule/preset preservation, durable counters, all-time delivered history independent of filters/50-page/pending loot, private snapshots and migration rerun');
} catch(error) { console.error(error.message,error.where??'',error.stack);process.exitCode=1; }
finally {await db.close();}
