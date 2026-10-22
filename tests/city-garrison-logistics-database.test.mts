/** Persistent garrison training and scheduled inter-city transport, exercised in
 * the full fresh-install Supabase schema using an in-memory PostgreSQL. */
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const db = new PGlite();
const user = '11111111-1111-4111-8111-111111111111';
const admin = async (sql: string) => { await db.exec('reset role'); return db.exec(sql); };
const login = () => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${user}',false)`);
const rpc = async (fn: string, args: unknown[] = []) =>
    (await db.query<{result: any}>(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')})result`,args)).rows[0].result;
const command = (cmd: unknown) => rpc('peris_empire_command',[JSON.stringify(cmd)]);

try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;
        create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        grant usage on schema public,auth to authenticated,anon,service_role;
        grant execute on function auth.uid() to authenticated,anon;create publication supabase_realtime`);
    await db.exec(await readFile('supabase/FRESH_INSTALL_V19.sql','utf8'));
    await admin(`insert into auth.users values('${user}')`);
    await login();
    await rpc('create_player',['Garrison logistics']);
    let snapshot=await rpc('peris_snapshot');
    const from=snapshot.settlements[0];
    // Pick one adjacent piece of actual server land; SQL and client must agree
    // that reinforcement troops have a connected, non-instant route.
    let destination:{x:number;y:number}|null=null;
    await db.exec('reset role'); // Private geography is fixture setup, not a player RPC.
    for(const [dx,dy] of [[128,0],[-128,0],[0,128],[0,-128]]){
        const x=from.x+dx,y=from.y+dy;
        if(x< -12800||x>=12800||y< -12800||y>=12800)continue;
        const ok=(await db.query<{v:boolean}>('select public.peris_world_walkable($1,$2) v',[x,y])).rows[0]?.v;
        if(ok){destination={x,y};break;}
    }
    assert.ok(destination,'starter city has a reachable dry neighbor');
    const inserted=await admin(`insert into public.settlements(owner_id,name,x,y,wood,stone,food,gold)
        values('${user}','Fort North',${destination!.x},${destination!.y},500,500,500,500) returning id`);
    const toId=Number(inserted[0].rows[0].id);
    await admin(`update public.settlements set wood=10000,stone=10000,food=10000,gold=10000 where id=${from.id};
        insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)
        values(${from.id},0,'barracks',1)on conflict(settlement_id,slot_index)do update set level=1`);
    await login();
    // A trained soldier has no legion assignment; garrison receives it only on completion.
    await command({type:'recruit',settlementId:from.id,item:'infantry',quantity:9,destination:'garrison'});
    let order=(await db.query<any>(`select * from public.peris_orders where kind='recruit'and settlement_id=${from.id} order by id desc limit 1`)).rows[0];
    assert.equal(order.recruit_destination,'garrison');
    assert.equal(order.army_id,null);
    assert.equal((await db.query<any>(`select count(*)::integer n from public.peris_city_garrisons where settlement_id=${from.id}`)).rows[0].n,0);
    await admin(`update public.peris_orders set started_at=now()-interval '20 minutes',finish_at=now()-interval '1 second' where id=${order.id}`);
    await admin(`select public.peris_game_tick(40)`);
    let stock=(await db.query<any>(`select unit_roster from public.peris_city_garrisons where settlement_id=${from.id}`)).rows[0].unit_roster;
    assert.equal(stock.infantry,9);
    await admin(`select public.peris_city_garrison_receive('${user}',${from.id},'{"infantry":45,"archers":15}'::jsonb)`);
    const initial=69; // 9 directly trained + 45 infantry + 15 archers
    await db.exec('reset role');
    const a=await rpc('peris_home_army_position',[from.x,from.y]);
    const b=await rpc('peris_home_army_position',[destination!.x,destination!.y]);
    const route=[[a.x,a.y],[b.x,b.y]];
    await login();
    await command({type:'reinforceCity',settlementId:from.id,targetCityId:toId,route,
        troops:{infantry:20,archers:5}});
    stock=(await db.query<any>(`select unit_roster from public.peris_city_garrisons where settlement_id=${from.id}`)).rows[0].unit_roster;
    assert.equal(stock.infantry,34);
    assert.equal(stock.archers,10);
    assert.equal((await db.query<any>(`select count(*)::integer n from public.peris_city_garrisons where settlement_id=${toId}`)).rows[0].n,0,'no instant teleport');
    let convoy=(await db.query<any>(`select * from public.peris_city_reinforcements where owner_id='${user}'`)).rows[0];
    assert.ok(convoy);
    assert.ok(Date.parse(convoy.arrival_at)>Date.parse(convoy.departure_at));
    await admin(`update public.peris_city_reinforcements set departure_at=now()-interval '1 hour',arrival_at=now()-interval '1 second' where id=${convoy.id}`);
    await admin(`select public.peris_game_tick(40); select public.peris_game_tick(40)`);
    const arrived=(await db.query<any>(`select unit_roster from public.peris_city_garrisons where settlement_id=${toId}`)).rows[0].unit_roster;
    assert.equal(arrived.infantry,20);
    assert.equal(arrived.archers,5);
    assert.equal((await db.query<any>(`select count(*)::integer n from public.peris_city_reinforcements where owner_id='${user}'`)).rows[0].n,0,'one-time delivery');
    assert.equal(stock.infantry+stock.archers+arrived.infantry+arrived.archers,initial);
    console.log('PASS · direct garrison training, real inter-city marching, private server-owned orders, offline game tick and exactly-once delivery');
} catch (error:any) {
    console.error(error.message,error.where??'',error.stack);
    process.exitCode=1;
} finally {
    await db.close();
}
