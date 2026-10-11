import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite(), u = '11111111-1111-4111-8111-111111111111', v = '22222222-2222-4222-8222-222222222222';
const admin = async sql => { await db.exec('reset role'); return db.exec(sql); };
const login = (id = u) => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const snapshot = () => rpc('peris_snapshot'), command = cmd => rpc('peris_campaign_farm_command', [JSON.stringify(cmd)]);
const total = w => [...w.armies, ...w.garrisons].reduce((n, a) => n + a.infantry + a.archers + a.cavalry, 0), troops = { infantry: 9, archers: 2, cavalry: 1 };
const manifest = JSON.parse(await readFile('supabase/modules/manifest.json', 'utf8'));
const upgrade = (await Promise.all(manifest.map(file => readFile('supabase/modules/' + file, 'utf8')))).join('').replace(/^begin;\s*$/gm, '').replace(/^commit;\s*$/gm, '');
const fresh = await readFile('supabase/modules/install/fresh-base.sql', 'utf8') + upgrade + await readFile('supabase/modules/install/fresh-tail.sql', 'utf8');
try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
    await db.exec(fresh); await admin(`insert into auth.users values('${u}'),('${v}')`);
    await login(); await rpc('create_player', ['Ruler']); let w = await snapshot(); const first = w.armies[0], city = w.settlements[0];
    await rpc('peris_empire_command', [JSON.stringify({ type: 'recruitHero', name: 'Second', heroClass: 'knight', settlementId: city.id })]);
    const second = (await snapshot()).armies.find(a => a.id !== first.id);
    // Route shape and authority are tested on controlled dry land, with real persisted numeric camps.
    await admin(`update public.peris_world_map set walkable=decode(repeat('ff',5000),'hex');update public.armies set infantry=20 where id=${second.id}`); await login();
    const camps = w.camps.filter(c => c.bandit).sort((a, b) => Math.hypot(a.x - first.target_x, a.y - first.target_y) - Math.hypot(b.x - first.target_x, b.y - first.target_y));
    const list = await command({ type: 'saveCampaignFarmList', name: 'Manual batch', troops, casualtiesOnly: false });
    await assert.rejects(() => command({ type: 'startCampaignFarmList', id: list.id }), /No raids started.*Add camp/);
    const saved = [];
    for (const [index, armyId, party] of [[0, first.id, troops], [1, first.id, troops], [2, second.id, { infantry: 5, archers: 0, cavalry: 0 }], [3, second.id, { infantry: 0, archers: 0, cavalry: 500 }]]) saved.push(await command({ type: 'saveCampaignFarm', listId: list.id, campId: camps[index].id, armyId, troops: party }));
    const before = total(await snapshot()), result = await command({ type: 'startCampaignFarmList', id: list.id });
    assert.equal(result.started, 2); assert.deepEqual(result.skipped.map(skip => skip.targetId), [saved[1].id, saved[3].id]);
    w = await snapshot(); assert.equal(w.armies.find(a => a.id === first.id).raid_target_id, camps[0].id); assert.equal(w.armies.find(a => a.id === second.id).raid_target_id, camps[2].id); assert.equal(total(w), before);
    for (const army of w.armies) assert.equal(Date.parse(army.departure_at) - Date.parse(army.march_sent_at), 30000);
    const sent = structuredClone(w.armies), pool = structuredClone(w.garrisons);
    await assert.rejects(() => command({ type: 'startCampaignFarmList', id: list.id }), /No raids started/);
    w = await snapshot(); assert.deepEqual(w.armies, sent); assert.deepEqual(w.garrisons, pool); assert.equal(total(w), before);
    await login(v); await rpc('create_player', ['Other']); await assert.rejects(() => command({ type: 'startCampaignFarmList', id: list.id }), /own farm list/);
    await login(); for (const army of (await snapshot()).armies) await rpc('peris_empire_command', [JSON.stringify({ type: 'cancelMarch', armyId: army.id, sentAt: army.march_sent_at })]);
    assert.equal(total(await snapshot()), before);
    const route = (army, camp) => {
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(camp.x - army.target_x), Math.abs(camp.y - army.target_y)) / 64));
        return Array.from({ length: steps + 1 }, (_, i) => [army.target_x + (camp.x - army.target_x) * i / steps, army.target_y + (camp.y - army.target_y) * i / steps]);
    };
    const routed = await command({ type: 'startCampaignFarmList', id: list.id, routes: [
        { targetId: saved[0].id, path: [[0, 0]] },
        { targetId: saved[1].id, path: route(first, camps[1]) },
        { targetId: saved[3].id, path: route(second, camps[3]) },
    ] });
    assert.equal(routed.started, 1); assert.deepEqual(routed.skipped.map(skip => skip.targetId), [saved[0].id, saved[2].id, saved[3].id]);
    assert.match(routed.skipped[0].reason, /route points/); assert.match(routed.skipped[1].reason, /connected land route/); assert.match(routed.skipped[2].reason, /available/);
    w = await snapshot(); assert.equal(w.armies.find(a => a.id === first.id).raid_target_id, camps[1].id); assert.equal(w.armies.find(a => a.id === second.id).status, 'idle'); assert.equal(total(w), before);
    await rpc('peris_empire_command', [JSON.stringify({ type: 'cancelMarch', armyId: first.id, sentAt: w.armies.find(a => a.id === first.id).march_sent_at })]);
    await admin(`insert into public.peris_progress(owner_id,camp_id,available_at)values('${u}',${camps[0].id},now()+interval '1 hour')`); await login();
    // Resource camps regrow defenders rather than using the old story cooldown.
    // A stale pre-integration progress row cannot block their manual farm target.
    const regrowing = await command({ type: 'startCampaignFarmList', id: list.id }); assert.equal(regrowing.started, 2); assert.match(regrowing.skipped[0].reason, /march or raid/);
    assert.equal((await snapshot()).armies.find(a => a.id === first.id).raid_target_id, camps[0].id); assert.equal(total(await snapshot()), before);
    console.log('PASS · authoritative manual farm batches, deterministic one-order legions, partial skips, 30s staging, duplicate starts, ownership, resource-camp regrowth and troop conservation');
} catch (e) { console.error(e.message, e.where ?? '', e.detail ?? '', e.stack); process.exitCode = 1; }
finally { await db.close(); }
