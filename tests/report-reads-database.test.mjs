import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
const uid = n => `83000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = async () => db.exec('reset role');
const connect = async n => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${uid(n)}',false)`);
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
async function seed(owner, army) {
    await admin();
    const battle = (await db.query("insert into public.battles(attacker_owner_id,attacker_army_id,status,mode,phase,terrain,difficulty,enemy_name) values($1,$2,'resolved','pve','combat','plains','easy','Report QA') returning id", [owner, army])).rows[0].id;
    return (await db.query("insert into public.peris_reports(owner_id,battle_id,title,won,result) values($1,$2,'Report QA',true,'{\"attacker_losses\":0,\"duration\":12}') returning id", [owner, battle])).rows[0].id;
}
try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
    await db.exec(await readFile('supabase/FRESH_INSTALL_V16.sql', 'utf8'));
    await db.query('insert into auth.users(id) values($1),($2),($3)', [uid(1), uid(2), uid(3)]);
    await connect(1); await rpc('peris_login', ['Read Alpha']); const a = await rpc('peris_snapshot');
    await connect(2); await rpc('peris_login', ['Read Beta']); const b = await rpc('peris_snapshot');
    // Model existing historical reports before the additive migration.
    await admin(); await db.exec('alter table public.peris_reports drop column read_at');
    const first = await seed(uid(1), a.armies[0].id), second = await seed(uid(1), a.armies[0].id), rival = await seed(uid(2), b.armies[0].id);
    const migration = await readFile('supabase/UPDATE_REPORT_READ_STATUS.sql', 'utf8');
    await admin(); await db.exec(migration);
    await connect(1);
    let snapshot = await rpc('peris_snapshot'); assert.equal(snapshot.reports.length, 2); assert.ok(snapshot.reports.every(r => r.read_at === null));
    await rpc('peris_read_reports', [[first]]);
    snapshot = await rpc('peris_snapshot'); const readAt = snapshot.reports.find(r => r.id === first).read_at;
    assert.ok(Number.isFinite(Date.parse(readAt))); assert.equal(snapshot.reports.find(r => r.id === second).read_at, null);
    await rpc('peris_read_reports', [[first]]); assert.equal((await rpc('peris_snapshot')).reports.find(r => r.id === first).read_at, readAt);
    console.log('PASS · existing receipts start unread; opened reports persist the first timestamp without changing other reports');
    for (const ids of [null, [], [null], [0], [-1], Array(51).fill(first)]) await assert.rejects(() => rpc('peris_read_reports', [ids]), e => e.code === '22023' || e.code === '42501');
    await assert.rejects(() => rpc('peris_read_reports', [[second, rival]]), e => e.code === '42501');
    await assert.rejects(() => rpc('peris_read_reports', [[999999]]), e => e.code === '42501');
    assert.equal((await rpc('peris_snapshot')).reports.find(r => r.id === second).read_at, null);
    await assert.rejects(() => db.query('update public.peris_reports set read_at=now() where id=$1', [second]), /permission denied/);
    await connect(2); await assert.rejects(() => rpc('peris_read_reports', [[first]]), e => e.code === '42501');
    assert.equal((await rpc('peris_snapshot')).reports[0].read_at, null);
    await db.exec('reset role;set role anon'); await assert.rejects(() => rpc('peris_read_reports', [[first]]), /permission denied/);
    await connect(1); await db.exec("select set_config('request.jwt.claim.sub','',false)"); await assert.rejects(() => rpc('peris_read_reports', [[first]]), /Authentication required/);
    console.log('PASS · rival, anonymous, invalid and mixed-owner writes are blocked atomically');
    await connect(3); assert.equal((await rpc('peris_login', ['read alpha'])).player_id, uid(1));
    assert.equal((await rpc('peris_snapshot')).reports.find(r => r.id === first).read_at, readAt);
    await rpc('peris_read_reports', [[second]]);
    await connect(1); const expected = (await rpc('peris_snapshot')).reports; assert.ok(expected.every(r => r.read_at));
    await admin(); await db.exec(migration); await db.exec(migration); await db.exec(await readFile('supabase/UPGRADE_TO_V16.sql', 'utf8'));
    await connect(3); assert.deepEqual((await rpc('peris_snapshot')).reports, expected); await rpc('peris_read_reports', [[first]]);
    await admin(); assert.equal((await db.query('select count(*) n from public.players')).rows[0].n, 2);
    console.log('PASS · recovered name-only devices share read status; repeat focused and full upgrades preserve reports, ownership and permissions');
} catch (error) {
    console.error(error.message, error.where ?? '', error.detail ?? ''); process.exitCode = 1;
} finally { await db.close(); }
