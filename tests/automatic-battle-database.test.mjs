import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),u='11111111-1111-4111-8111-111111111111',v='22222222-2222-4222-8222-222222222222';
const admin=async sql=>{await db.exec('reset role');return db.exec(sql);};
const login=async(owner=u)=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`);
const rpc=async(name,args=[])=> (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
 await db.exec(await readFile('supabase/FRESH_INSTALL_V11.sql','utf8'));
 await admin(`insert into auth.users values('${u}'),('${v}')`);await login();await rpc('create_player',['Ruler']);await login(v);await rpc('create_player',['Rival']);await login();
 let w=await rpc('peris_snapshot');const a=w.armies[0],city=w.settlements[0];
 await admin(`select public.peris_start_raid('${u}',1)`);await login();w=await rpc('peris_snapshot');const b=w.battles.find(b=>b.status==='active');assert.equal(b.phase,'combat');
 await assert.rejects(()=>rpc('peris_order',[b.id,JSON.stringify({kind:'move',ids:[w.formations[0].id],x:600,y:300})]),/automatically/);
 await assert.rejects(()=>rpc('peris_rally',[b.id]),/automatically/);await assert.rejects(()=>rpc('peris_cast_spell',[b.id,'spark',w.formations.at(-1).id]),/automatically/);
 await assert.rejects(()=>rpc('peris_cast_spell_for',[u,b.id,'spark',w.formations.at(-1).id]),/permission denied/);
 await admin(`update public.battles set last_tick_at=now()-interval '2 seconds'where id=${b.id}`);await login();await rpc('peris_tick',[b.id]);w=await rpc('peris_snapshot');assert.ok(w.formations.every(f=>f.target_formation_id));assert.ok(w.formations.some(f=>f.owner_id===u&&f.x!==285&&f.x!==175));
 console.log('PASS · automatic campaign start, both-sided AI and tactical command security');
 await admin(`insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)values(${city.id},4,'mage_tower',1);insert into public.peris_spell_research(settlement_id,spell_id)values(${city.id},'spark');update public.battles set mana_attacker=30,last_tick_at=now()-interval '2 seconds'where id=${b.id};update public.battle_formations set x=case when side='attacker'then 520 else 650 end,y=350 where battle_id=${b.id}`);await login();await rpc('peris_tick',[b.id]);w=await rpc('peris_snapshot');const current=w.battles.find(x=>x.id===b.id);assert.ok(current.last_spell?.id==='spark');assert.ok(current.mana_attacker<30);
 console.log('PASS · researched spells are chosen and cast by the server AI');
 await admin(`update public.battles set last_tick_at=now()-interval '30 seconds'where id=${b.id}`);await login();await rpc('peris_tick',[b.id]);const lag=(await db.query(`select extract(epoch from(now()-last_tick_at)) lag from public.battles where id=$1`,[b.id])).rows[0].lag;assert.ok(Number(lag)>15,'Capped catch-up must retain pending elapsed time');
 for(let i=0;i<80;i++){await admin(`update public.battles set last_tick_at=now()-interval '10 seconds'where id=${b.id} and status='active'`);await login();await rpc('peris_tick',[b.id]);w=await rpc('peris_snapshot');if(w.battles.find(x=>x.id===b.id)?.status==='resolved')break;}
 const finished=w.battles.find(x=>x.id===b.id);assert.equal(finished.status,'resolved');const report=w.reports.find(r=>r.battle_id===b.id);assert.ok(report);assert.equal(report.result.attacker_losses+report.result.attacker_survivors,report.result.attacker_initial);const exp=w.heroes.find(h=>h.army_id===a.id).experience;await rpc('peris_tick',[b.id]);assert.equal((await rpc('peris_snapshot')).heroes.find(h=>h.army_id===a.id).experience,exp);
 console.log('PASS · combat resolves, casualty accounting conserves troops, report and hero XP settle once');
 await admin(`update public.armies set infantry=60,archers=20,cavalry=8;update public.peris_heroes set experience=0`);await login();await rpc('peris_challenge',[v]);await login(v);let rival=await rpc('peris_snapshot');const challenge=rival.challenges.find(c=>c.status==='pending');await rpc('peris_respond',[challenge.id,true]);rival=await rpc('peris_snapshot');const duel=rival.battles.find(b=>b.status==='active');assert.equal(duel.phase,'combat');await admin(`update public.battles set last_tick_at=now()-interval '2 seconds'where id=${duel.id}`);await login(v);await rpc('peris_tick',[duel.id]);rival=await rpc('peris_snapshot');assert.ok(rival.formations.filter(f=>f.battle_id===duel.id).every(f=>f.target_formation_id));
 console.log('PASS · accepted PvP duel starts immediately and both player armies use AI');
 // Upgrade must retain existing cities, commanders, research and inventory.
 await admin(await readFile('supabase/UPGRADE_TO_V11.sql','utf8'));await login();w=await rpc('peris_snapshot');assert.equal(w.settlements[0].id,city.id);assert.ok(w.spell_research.some(s=>s.spell_id==='spark'));assert.ok(w.heroes.some(h=>h.army_id===a.id));
 console.log('PASS · upgrade preserves existing campaign and research');
}catch(e){console.error(e.message,e.where??'',e.detail??'',e.position??'',e.internalQuery??'');if(e.position){const sql=await readFile('supabase/FRESH_INSTALL_V11.sql','utf8');const pos=Number(e.position);console.error(sql.slice(Math.max(0,pos-250),pos+250));}process.exitCode=1;}finally{await db.close();}
