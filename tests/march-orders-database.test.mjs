import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { findMarchPath } from '../src/features/map/domain/pathfinding.ts';
import { homeArmyPosition, stationCell } from '../src/features/map/domain/garrisons.ts';
const db = new PGlite(), u = '11111111-1111-4111-8111-111111111111', v = '22222222-2222-4222-8222-222222222222';
const admin = async sql => { await db.exec('reset role'); return db.exec(sql); };
const login = (owner = u) => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`);
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args)).rows[0].result;
const snapshot = () => rpc('peris_snapshot');
const command = value => rpc('peris_empire_command', [JSON.stringify(value)]);
const total = world => [...world.armies, ...world.garrisons].reduce((sum, row) => sum + row.infantry + row.archers + row.cavalry, 0);
try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
    await db.exec(await readFile('supabase/FRESH_INSTALL_V12.sql', 'utf8'));
    await admin(`insert into auth.users values('${u}'),('${v}')`); await login(); await rpc('create_player', ['Ruler']);
    let w = await snapshot(); const first = w.armies[0], city = w.settlements[0], camp = w.camps.find(row => row.id === 1), initialTotal = total(w);
    await command({ type: 'recruitHero', settlementId: city.id, name: 'Second', heroClass: 'knight' });
    const second = (await snapshot()).armies.find(row => row.id !== first.id);
    const route = findMarchPath({ x: first.target_x, y: first.target_y }, camp); assert.ok(route);
    const raid = () => command({ type: 'raid', armyId: first.id, campId: camp.id, route: route.path, troops: { infantry: 10, archers: 2, cavalry: 1 } });
    const initial = await snapshot();
    for (const troops of [{ infantry: 121, archers: 0, cavalry: 0 }, { infantry: 0, archers: 0, cavalry: 0 }, { infantry: 1.5, archers: 0, cavalry: 0 }])
        await assert.rejects(() => command({ type: 'raid', armyId: first.id, campId: camp.id, route: route.path, troops }));
    assert.deepEqual((await snapshot()).armies, initial.armies); assert.deepEqual((await snapshot()).garrisons, initial.garrisons);
    await raid(); w = await snapshot(); let sent = w.armies.find(row => row.id === first.id);
    assert.equal(Date.parse(sent.march_cancel_until) - Date.parse(sent.march_sent_at), 30000);
    assert.equal(sent.departure_at, sent.march_cancel_until); assert.equal(sent.infantry, 10); assert.equal(sent.raid_reserve, null);
    assert.equal(w.garrisons[0].infantry, 110); assert.equal(total(w), initialTotal);
    const cancelledToken = sent.march_sent_at;
    await rpc('peris_collect_garrison', [second.id, JSON.stringify({ infantry: 50, archers: 10, cavalry: 1 })]);
    await command({ type: 'cancelMarch', armyId: first.id, sentAt: cancelledToken }); w = await snapshot();
    assert.equal(total(w), initialTotal); assert.deepEqual(w.garrisons, []); assert.equal(w.armies.find(row => row.id === first.id).infantry, 70);
    await assert.rejects(() => command({ type: 'cancelMarch', armyId: first.id, sentAt: cancelledToken }), /same order/);
    await raid(); w = await snapshot(); sent = w.armies.find(row => row.id === first.id);
    await assert.rejects(() => command({ type: 'cancelMarch', armyId: first.id, sentAt: cancelledToken }), /same order/);
    await assert.rejects(() => command({ type: 'move', armyId: first.id, x: city.x, y: city.y, route: route.path }), /already has a march/);
    await login(v); await rpc('create_player', ['Rival']);
    await assert.rejects(() => command({ type: 'cancelMarch', armyId: first.id, sentAt: sent.march_sent_at }), /your armies/);
    const rivalView = await rpc('peris_map_snapshot', [-12800, -12800, 12800, 12800]);
    const publicArmy = rivalView.armies.find(row => row.id === first.id);
    for (const key of ['march_origin', 'march_cancel_until', 'march_sent_at', 'raid_reserve']) assert.equal(Object.hasOwn(publicArmy, key), false);
    await admin(`update public.armies set march_sent_at=now()-interval '30 seconds',march_cancel_until=now(),departure_at=now(),arrival_at=now()+interval '10 seconds' where id=${first.id}`);
    await login(); sent = (await snapshot()).armies.find(row => row.id === first.id);
    await assert.rejects(() => command({ type: 'cancelMarch', armyId: first.id, sentAt: sent.march_sent_at }), /first 30 seconds/);
    await admin(`update public.armies set departure_at=now()-interval '40 seconds',arrival_at=now()-interval '1 second' where id=${first.id}`); await login(); await rpc('sync_my_state');
    w = await snapshot(); const battle = w.battles.find(row => row.status === 'active'); assert.ok(battle);
    assert.equal(w.formations.filter(row => row.side === 'attacker').reduce((sum, row) => sum + row.initial_soldiers, 0), 13);
    await admin(`update public.battle_formations set soldiers=greatest(0,soldiers-4) where battle_id=${battle.id} and side='attacker' and unit_type='infantry';select public.peris_finish(${battle.id},'defender','Test losses')`);
    await login(); w = await snapshot(); const returning = w.armies.find(row => row.id === first.id);
    assert.equal(returning.status, 'moving'); assert.equal(returning.march_returning, true); assert.equal(returning.infantry, 6);
    assert.deepEqual([returning.target_x, returning.target_y], [first.target_x, first.target_y]); assert.equal(returning.march_cancel_until, null);
    assert.equal(total(w), initialTotal - 4); assert.ok(w.garrisons.length > 0);
    await rpc('sync_my_state'); assert.equal((await snapshot()).armies.find(row => row.id === first.id).infantry, 6);
    await admin(`update public.armies set arrival_at=now()-interval '1 second' where id=${first.id}`); await login(); await rpc('sync_my_state');
    w = await snapshot(); assert.equal(total(w), initialTotal - 4); assert.deepEqual(w.garrisons, []);
    assert.equal(w.armies.find(row => row.id === first.id).status, 'idle'); assert.equal(w.armies.find(row => row.id === first.id).infantry, 66);
    const after = w.armies; await rpc('sync_my_state'); assert.deepEqual((await snapshot()).armies, after);
    await admin(`select public.peris_finish(${battle.id},'defender','Duplicate');select public.peris_return_raid(${first.id})`);
    await login(); assert.equal(total(await snapshot()), initialTotal - 4); assert.equal((await snapshot()).reports.filter(row => row.battle_id === battle.id).length, 1);
    // Older saves/servers allowed a legion to rest on neutral land. It can leave
    // for home, but cannot create a new raid or a stationed troop pool there.
    await admin(`update public.armies set status='idle',start_x=320,start_y=320,target_x=320,target_y=320,march_origin=null,march_sent_at=null,march_cancel_until=null,march_returning=false,march_path=null where id=${first.id}`);
    await login();
    const neutralRoute = findMarchPath({ x: 320, y: 320 }, camp);
    await assert.rejects(() => command({ type: 'raid', armyId: first.id, campId: camp.id, route: neutralRoute.path }), /Depart from one of your own/);
    const homeRoute = findMarchPath({ x: 320, y: 320 }, { x: first.target_x, y: first.target_y });
    await command({ type: 'move', armyId: first.id, x: first.target_x, y: first.target_y, route: homeRoute.path });
    sent = (await snapshot()).armies.find(row => row.id === first.id);
    await command({ type: 'cancelMarch', armyId: first.id, sentAt: sent.march_sent_at });
    w = await snapshot(); assert.deepEqual([w.armies.find(row => row.id === first.id).target_x, w.armies.find(row => row.id === first.id).target_y], [320, 320]);
    assert.deepEqual(w.garrisons, []); assert.equal(total(w), initialTotal - 4);
    await command({ type: 'move', armyId: first.id, x: first.target_x, y: first.target_y, route: homeRoute.path });
    await admin(`update public.armies set arrival_at=now()-interval '1 second' where id=${first.id}`); await login(); await rpc('sync_my_state');
    w = await snapshot(); assert.equal(w.armies.find(row => row.id === first.id).status, 'idle'); assert.equal(total(w), initialTotal - 4);
    // A new hero at a village near a cell boundary must still start in its
    // owned field. These legacy spawn coordinates previously crossed cells.
    await admin(`insert into public.settlements(owner_id,name,x,y,gold)values('${u}','Edge village',1000,660,1000)`);
    await login(); const edgeCity = (await snapshot()).settlements.find(row => row.name === 'Edge village');
    await command({ type: 'recruitHero', settlementId: edgeCity.id, name: 'Edge guard', heroClass: 'knight' });
    const edgeArmy = (await snapshot()).armies.find(row => row.home_settlement_id === edgeCity.id);
    assert.deepEqual({ x: edgeArmy.target_x, y: edgeArmy.target_y }, homeArmyPosition(edgeCity));
    assert.deepEqual(stationCell({ x: edgeArmy.target_x, y: edgeArmy.target_y }), stationCell(edgeCity));
    for (const point of [{ x: 1000, y: 660 }, { x: 350, y: 205 }, { x: 125, y: 420 }, { x: -1, y: -1 }, { x: 12799, y: 12799 }]) {
        await admin('select 1');
        const sqlPoint = (await db.query('select public.peris_home_army_position($1,$2) as point', [point.x, point.y])).rows[0].point;
        assert.deepEqual(sqlPoint, homeArmyPosition(point));
    }
    await admin(`update public.armies set infantry=5 where id=${edgeArmy.id}`); await login();
    const edgeRoute = findMarchPath({ x: edgeArmy.target_x, y: edgeArmy.target_y }, camp);
    await command({ type: 'raid', armyId: edgeArmy.id, campId: camp.id, route: edgeRoute.path });
    assert.equal((await snapshot()).armies.find(row => row.id === edgeArmy.id).status, 'moving');
    console.log('PASS · authoritative thirty-second deadline, allocation, shared station collection, stale/foreign/repeated rejection, private origin and timed return conserve troops after casualties');
} catch (error) { console.error(error.message, error.where ?? '', error.detail ?? '', error.stack); process.exitCode = 1; }
finally { await db.close(); }
