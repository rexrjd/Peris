// Disposable diagnostic only: no external connection or product changes.
import { PGlite } from '@electric-sql/pglite';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
const notices=[];
const db=new PGlite({onNotice:n=>{if(n.severity==='WARNING')notices.push(n.message);}});
const owners=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
try {
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;`);
 await db.exec(await readFile(root+'/supabase/FRESH_INSTALL_V19.sql','utf8'));
 await db.exec(`insert into auth.users values ${owners.map(id=>`('${id}')`).join(',')}`);
 for(let i=0;i<owners.length;i++){
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${owners[i]}',false);select public.create_player('Clock probe ${i}');reset role;`);
  await query('select public.peris_start_raid($1,1)',[owners[i]]);
 }
 await db.exec(`update public.battles set last_tick_at=now()-interval '30 seconds';insert into public.peris_orders(owner_id,kind,item,quantity,settlement_id,started_at,finish_at)select '${owners[0]}','field','field:99:99:lumber',1,id,now()-interval '2 days',now()-interval '1 day' from public.settlements where owner_id='${owners[0]}' order by id limit 1;`);
 const before=await query('select id,elapsed from public.battles order by id');
 const calls=[];
 for(let i=0;i<2;i++)calls.push((await query('select public.peris_game_tick(1) as result'))[0].result);
 const blocked=await query('select id,elapsed from public.battles order by id');
 assert.deepEqual(blocked,before,'invalid first owner prevents both otherwise eligible battles from advancing');
 await db.exec(`delete from public.peris_orders where owner_id='${owners[0]}'`);
 for(let i=0;i<2;i++)calls.push((await query('select public.peris_game_tick(1) as result'))[0].result);
 const recovered=await query('select id,elapsed from public.battles order by id');
 assert.ok(recovered.every(b=>Number(b.elapsed)>0),'both battles advance when bad order removed');
 const result={baseline:'7f933205db48cdacdab42101e6637d0e89e7290d',database:(await query('select version() as version'))[0].version,scope:'isolated PGlite diagnostic; no concurrency/load capacity claim',before,calls,blocked,recovered,notices};
 await writeFile(join(tmpdir(),'peris-server-current-probe.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
} finally {await db.close();}
