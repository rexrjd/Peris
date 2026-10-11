import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const uid=n=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=async sql=>{await db.exec('reset role');return db.exec(sql);};
const connect=async n=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${uid(n)}',false)`);
const rpc=async(name,args=[])=> (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const persisted=async()=>{
 await admin('reset role'); const result={};
 for(const table of ['players','settlements','buildings','armies','peris_heroes','peris_hero_artifacts','peris_city_slots','peris_orders','peris_progress','peris_map_plots','peris_settler_expeditions'])result[table]=(await db.query(`select to_jsonb(t) record from public.${table} t order by to_jsonb(t)::text`)).rows;
 return result;
};
try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
 await db.exec(await readFile('tests/fixtures/accounts-v13.sql','utf8'));
 await admin("create table public.unrelated_notes(owner_id uuid,note text);alter table public.unrelated_notes enable row level security;create policy own_notes on public.unrelated_notes for select to authenticated using(owner_id=auth.uid())");
 await admin(`insert into auth.users select ('80000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,25)n`);
 await connect(1);await rpc('create_player',['Alpha']);let a=await rpc('peris_snapshot');
 await connect(2);await rpc('create_player',['Beta']);let b=await rpc('peris_snapshot');
 const hero=a.heroes[0],town=a.settlements[0],army=a.armies[0];
 await admin(`update public.peris_heroes set experience=1200,attack=1,knowledge=1 where id=${hero.id};insert into public.peris_hero_artifacts(owner_id,hero_id,artifact_id,slot)values('${uid(1)}',${hero.id},'iron_sword','weapon');insert into public.peris_progress(owner_id,camp_id,defeated,available_at)values('${uid(1)}',1,2,now()+interval '10 minutes');insert into public.peris_orders(owner_id,settlement_id,army_id,kind,item,quantity,started_at,finish_at)values('${uid(1)}',${town.id},${army.id},'recruit','infantry',5,now(),now()+interval '1 hour');insert into public.settlements(owner_id,spawn_point_id,name,x,y)select '${uid(1)}',sp.id,'Alpha second city',sp.x,sp.y from public.spawn_points sp where not exists(select 1 from public.settlements s where s.spawn_point_id=sp.id)order by sp.id limit 1`);
 const second=(await db.query(`select id,x,y from public.settlements where name='Alpha second city'`)).rows[0];
 await admin(`insert into public.buildings(settlement_id,building_type,level)select ${second.id},t,0 from unnest(array['lumber','quarry','farm','market','barracks','stables','wall','storehouse'])t;insert into public.armies(owner_id,home_settlement_id,name,start_x,start_y,target_x,target_y)values('${uid(1)}',${second.id},'Second host',${second.x},${second.y},${second.x},${second.y});select public.peris_city_economy(${second.id})`);
 // Finish the original V13 city's normal bootstrap before testing preservation.
 await connect(1);await rpc('peris_snapshot');
 const before=await persisted();
 // The combined migration adds cancellation/return fields to V13 armies.
 // Require their neutral defaults while comparing every existing value exactly.
 for(const host of before.armies)Object.assign(host.record,{march_sent_at:null,march_cancel_until:null,raid_reserve:null,march_origin:null,march_returning:false,unit_roster:null,carried_loot:null,farm_list_id:null,loot_report_id:null});
 const upgrade=await readFile('supabase/UPGRADE_TO_V14.sql','utf8');await admin(upgrade);await admin(upgrade);assert.deepEqual(await persisted(),before);
 console.log('PASS · V13 upgraded twice without changing player IDs, multiple cities/armies, commanders, XP, equipment, queues or camp progress');
 assert.equal((await db.query("select count(*) n from pg_policies where schemaname='public' and tablename<>'unrelated_notes' and (qual like '%auth.uid()%' or with_check like '%auth.uid()%')")).rows[0].n,0);
 assert.ok((await db.query("select qual from pg_policies where tablename='unrelated_notes'")).rows[0].qual.includes('auth.uid()'));
 await connect(3);const recovered=await rpc('peris_login',['  aLpHa  ']);assert.deepEqual(recovered,{player_id:uid(1),display_name:'Alpha',created:false});
 a=await rpc('peris_snapshot');assert.equal(a.players.length,1);assert.equal(a.players[0].id,uid(1));assert.equal(a.settlements.length,2);assert.equal(a.armies.length,2);assert.equal(a.heroes.length,2);assert.equal(a.hero_artifacts[0].id,before.peris_hero_artifacts[0].record.id);
 assert.equal((await db.query('select public.peris_player_id() id')).rows[0].id,uid(1));
 await rpc('peris_rename',['Recovered city']);assert.equal((await rpc('peris_snapshot')).settlements.find(c=>c.id===town.id).name,'Recovered city');
 await rpc('peris_empire_command',[{type:'heroSkill',heroId:hero.id,stat:'defence'}]);assert.equal((await rpc('peris_snapshot')).heroes.find(h=>h.id===hero.id).defence,1);
 await rpc('peris_queue_upgrade',['wall']);assert.ok((await rpc('peris_snapshot')).orders.some(o=>o.owner_id===uid(1)&&o.kind==='upgrade'));
 await assert.rejects(()=>rpc('peris_empire_command',[{type:'heroSkill',heroId:b.heroes[0].id,skill:'attack'}]),/Hero not found|Choose your hero|ownership|own hero/i);
 const ownHeroes=(await db.query('select owner_id from public.peris_heroes')).rows;assert.equal(ownHeroes.length,2);assert.ok(ownHeroes.every(h=>h.owner_id===uid(1)));
 await assert.rejects(()=>db.query('select * from public.peris_account_sessions'),/permission denied/);
 await assert.rejects(()=>db.query(`insert into public.peris_account_sessions(auth_id,player_id)values('${uid(3)}','${uid(2)}')`),/permission denied/);
 const own=(await rpc('peris_login',['ALPHA']));assert.equal(own.player_id,uid(1));await assert.rejects(()=>rpc('peris_login',['Beta']),e=>e.code==='PT409');
 await connect(4);assert.equal((await rpc('peris_login',['Alpha'])).player_id,uid(1));assert.equal((await rpc('peris_snapshot')).settlements.length,2);
 await rpc('create_player',['Legacy retry']);assert.equal((await rpc('peris_snapshot')).settlements.length,2);
 await connect(1);assert.equal((await rpc('peris_login',['Alpha'])).player_id,uid(1));
 await connect(2);assert.equal((await rpc('peris_login',['Beta'])).player_id,uid(2));
 console.log('PASS · same name across fresh devices, case/space variants and old browser sessions controls exactly the original ruler; rival actions and session writes remain blocked');
 // The raid/farm branch must use the recovered ruler identity too, rather than
 // treating the new browser Auth UUID as a new troop or farm owner.
 await connect(4);
 const list=await rpc('peris_campaign_farm_command',[{type:'saveCampaignFarmList',name:'Recovered farms',troops:{infantry:2,archers:0,cavalry:0},casualtiesOnly:true}]);
 assert.equal(list.owner_id,uid(1));assert.equal((await db.query('select id from public.peris_campaign_farm_lists')).rows.length,1);
 a=await rpc('peris_snapshot');const originalHost=a.armies.find(host=>host.id!==army.id);
 const col=Math.floor(originalHost.target_x/128),row=Math.floor(originalHost.target_y/128);
 await admin(`select public.peris_garrison_add('${uid(1)}',${col},${row},'{"infantry":5,"archers":0,"cavalry":0}'::jsonb)`);await connect(4);
 await rpc('peris_collect_garrison',[originalHost.id,{infantry:5,archers:0,cavalry:0}]);
 const collected=(await rpc('peris_snapshot')).armies.find(host=>host.id===originalHost.id);assert.equal(collected.infantry,originalHost.infantry+5);
 await rpc('peris_empire_command',[{type:'raid',armyId:originalHost.id,campId:2,troops:{infantry:2,archers:0,cavalry:0}}]);
 const travelling=(await rpc('peris_snapshot')).armies.find(host=>host.id===originalHost.id);assert.equal(travelling.infantry,2);assert.ok(travelling.march_cancel_until);
 await connect(2);assert.equal((await db.query('select id from public.peris_campaign_farm_lists')).rows.length,0);
 await assert.rejects(()=>rpc('peris_collect_garrison',[originalHost.id,{infantry:1,archers:0,cavalry:0}]),/own armies|own legion|Choose/i);
 await assert.rejects(()=>rpc('peris_empire_command',[{type:'cancelMarch',armyId:originalHost.id,sentAt:travelling.march_sent_at}]),/own armies|own legion|Choose/i);
 await connect(4);await rpc('peris_empire_command',[{type:'cancelMarch',armyId:originalHost.id,sentAt:travelling.march_sent_at}]);
 assert.equal((await rpc('peris_snapshot')).armies.find(host=>host.id===originalHost.id).infantry,collected.infantry);
 console.log('PASS · recovered ruler farm lists, partial raids, cancellation and garrison collection preserve troop ownership; rival sessions remain blocked');
 await connect(4);const reserve=a.armies.find(host=>host.home_settlement_id===second.id);
 await admin(`update public.armies set infantry=40,archers=10,cavalry=0 where id=${reserve.id}`);await connect(4);
 await rpc('peris_empire_command',[{type:'challenge',armyId:reserve.id,ownerId:uid(2)}]);
 await connect(22);await rpc('peris_login',['Beta']);const invitation=(await rpc('peris_snapshot')).challenges[0];assert.equal(invitation.attacker_owner_id,uid(1));assert.equal(invitation.defender_owner_id,uid(2));
 const duel=await rpc('peris_empire_command',[{type:'respond',id:invitation.id,accept:true,armyId:b.armies[0].id}]);const fight=(await rpc('peris_snapshot')).battles.find(battle=>battle.id===duel.battle_id);assert.equal(fight.attacker_owner_id,uid(1));assert.equal(fight.defender_owner_id,uid(2));
 await rpc('peris_tick',[duel.battle_id]);
 console.log('PASS · recovered rulers retain selected-army PvP invitations, opponent acceptance and automatic battle access');
 await admin(`delete from auth.users where id='${uid(1)}'`);
 assert.equal((await db.query(`select count(*) n from public.players where id='${uid(1)}'`)).rows[0].n,1);
 await connect(5);assert.equal((await rpc('peris_login',['Alpha'])).player_id,uid(1));assert.equal((await rpc('peris_snapshot')).armies.length,2);
 console.log('PASS · deleting an obsolete anonymous Auth user cannot delete its ruler or progress');
 await connect(6);const fresh=await rpc('peris_login',['NewName']);assert.equal(fresh.created,true);assert.equal(fresh.player_id,uid(6));
 const initial=await rpc('peris_snapshot');assert.equal(initial.settlements.length,1);assert.equal(initial.armies.length,1);assert.equal(initial.heroes.length,1);
 for(let n=7;n<=20;n++){await connect(n);const again=await rpc('peris_login',[n%2?'newname':' NEWNAME ']);assert.equal(again.player_id,uid(6));assert.equal(again.created,false);const w=await rpc('peris_snapshot');assert.equal(w.settlements.length,1);assert.equal(w.armies.length,1);assert.equal(w.heroes.length,1);}
 await admin('reset role');assert.equal((await db.query("select count(*) n from public.players where lower(display_name)='newname'")).rows[0].n,1);
 await admin(upgrade);await connect(7);assert.equal((await rpc('peris_login',['NewName'])).player_id,uid(6));
 console.log('PASS · a new name creates one ruler/estate/commander; repeated logins and later migrations retain the same binding');
 const count=async()=> (await db.query('select count(*) n from public.players')).rows[0].n;
 await connect(21);const total=await count();for(const name of ['',null,'!','a'.repeat(21)])await assert.rejects(()=>rpc('peris_login',[name]),e=>e.code==='22023');assert.equal(await count(),total);
 await db.exec('reset role;set role anon');await assert.rejects(()=>rpc('peris_login',['Alpha']),/permission denied/);await assert.rejects(()=>rpc('peris_player_id'),/permission denied/);
 await admin("select set_config('request.jwt.claim.sub','',false)");await assert.rejects(()=>rpc('peris_login',['Alpha']),/Authentication required/);
 console.log('PASS · invalid or unauthenticated logins cannot create or bind accounts');
}catch(error){console.error(error.message,error.where??'',error.detail??'');process.exitCode=1;}finally{await db.close();}
