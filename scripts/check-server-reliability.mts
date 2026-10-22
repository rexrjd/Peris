import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { testPostgres } from '../tests/helpers/testPostgres.ts';

// Disposable loopback PostgreSQL only. This exercises real SQL, not hosted HTTP.
const minutes = Number(process.argv.find(a => a.startsWith('--minutes='))?.split('=')[1] ?? 10);
if (!Number.isFinite(minutes) || minutes < 1 || minutes > 30) throw new Error('Use --minutes=1..30 (acceptance run: 10).');
const db = testPostgres();
const target = await db.assertTarget();
if (process.argv.includes('--initialize')) {
    await db.initialize();
    for (let i = 1; i <= 5; i++) {
        const owner = ownerId(i);
        await db.exec(`insert into auth.users values('${owner}');set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);select public.create_player('Load ruler ${i}');reset role;insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)select id,0,'barracks',1 from public.settlements where owner_id='${owner}'on conflict(settlement_id,slot_index)do update set building_type='barracks',level=1;set role authenticated;select public.peris_queue_upgrade('wall');select public.peris_queue_recruit('infantry',2);reset role;select public.peris_start_raid('${owner}',1)`);
        // Synthetic setup history; these are not claimed as played/completed battles.
        await db.exec(`with history as(insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,status,ended_at)select attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,'resolved',now() from public.battles where attacker_owner_id='${owner}'limit 1), ids as(insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,status,ended_at)select '${owner}', '${owner}',a.id,a.id,'resolved',now()from public.armies a cross join generate_series(1,100)where a.owner_id='${owner}'returning id)insert into public.peris_reports(owner_id,battle_id,title,won,result)select '${owner}',id,'Synthetic profiling history',true,'{}'from ids`);
    }
}
const scenario = await db.json("select jsonb_build_object('players',count(*),'rate',(select rate from public.peris_world_clock))from public.players");
if (scenario.players !== 5 || scenario.rate !== 1) throw new Error('Requires exactly five synthetic players at 1x; use a new empty test DB with --initialize.');
function ownerId(i: number) { return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`; }
const samples: Array<{kind: string; ms: number; bytes: number; ok: boolean; sqlstate?: string}> = [];
const workers: any[] = [], lag: any[] = [], errors: Array<{kind: string; message: string}> = [];
const started = performance.now(), startedAt = new Date().toISOString();
let stop = false;
process.once('SIGINT', () => { stop = true; });
process.once('SIGTERM', () => { stop = true; });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function measure(kind: string, sql: string, timeout = 8000) {
    const before = performance.now();
    try {
        const text = await db.exec(sql, timeout);
        samples.push({ kind, ms: performance.now() - before, bytes: Buffer.byteLength(text), ok: true });
        return JSON.parse(text.split(/\r?\n/).at(-1)!);
    } catch (error: any) {
        const sqlstate = /ERROR:\s+([A-Z0-9]{5}):/.exec(error.message)?.[1];
        samples.push({ kind, ms: performance.now() - before, bytes: 0, ok: false, sqlstate });
        errors.push({ kind, message: error.message.slice(0, 1200) });
    }
}
const active = () => !stop && performance.now() - started < minutes * 60000;
async function client(i: number) {
    const prefix = `set role authenticated;select set_config('request.jwt.claim.sub','${ownerId(i)}',false);`;
    let turn = 0;
    while (active()) {
        await measure('core', prefix + 'select public.peris_snapshot()');
        if (turn % 2 === 0) await measure('sync', prefix + 'select public.sync_my_state()');
        if (turn % 3 === 0) await measure('map', prefix + 'select public.peris_map_snapshot(-10,-10,10,10)');
        if (turn % 2 === 0) await measure('social', prefix + 'select public.peris_social_snapshot()');
        turn++; await sleep(5000);
    }
}
async function worker() {
    while (active()) {
        const result = await measure('worker', 'select public.peris_game_tick(40)', 8000);
        if (result) workers.push(result);
        lag.push(await db.json("select jsonb_build_object('at',now(),'max_game_lag_seconds',coalesce(max(extract(epoch from(public.peris_game_now()-last_tick_at))),0),'active',count(*),'lock_waiters',(select count(*)from pg_stat_activity where datname=current_database()and wait_event_type='Lock'))from public.battles where status='active'"));
        await sleep(10000);
    }
}
const plans = await db.exec('explain (format json)select id from public.battles where status=\'active\'order by last_tick_at,id limit 20');
try { await Promise.all([worker(), ...[1, 2, 3, 4, 5].map(client)]); }
finally {
    stop = true;
    const summary = Object.fromEntries([...new Set(samples.map(s => s.kind))].map(kind => {
        const entries = samples.filter(s => s.kind === kind), times = entries.map(s => s.ms).sort((a, b) => a - b);
        return [kind, { count: entries.length, errors: entries.filter(s => !s.ok).length, median_ms: times[Math.floor(times.length / 2)], p95_ms: times[Math.ceil(times.length * .95) - 1], max_ms: times.at(-1), max_bytes: Math.max(...entries.map(s => s.bytes)) }];
    }));
    const findings = await db.json("select jsonb_build_object('active_battles',(select count(*)from public.battles where status='active'),'reports',(select count(*)from public.peris_reports),'duplicate_reports',(select count(*)from(select owner_id,battle_id from public.peris_reports group by owner_id,battle_id having count(*)>1)x),'queued_orders',(select count(*)from public.peris_orders))");
    const acceptance = { completed_ten_minutes: performance.now() - started >= 600000, zero_errors: errors.length === 0, no_duplicate_reports: findings.duplicate_reports === 0, core_p95_below_2s: summary.core?.p95_ms < 2000 };
    const directory = 'reports/server-reliability/' + startedAt.replace(/[:.]/g, '-');
    await mkdir(directory, { recursive: true });
    const report = { build: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), dirty: !!execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}).trim(), started_at: startedAt, elapsed_seconds: (performance.now() - started) / 1000, scenario, transport: 'Direct local psql sessions; client process startup included; not hosted HTTP or browser bots', hardware: { platform: os.platform(), cpu: os.cpus()[0]?.model, logical_cpus: os.cpus().length, memory_gb: os.totalmem() / 2 ** 30 }, postgres: target.version, summary, acceptance, findings, workers, lag, errors, samples, plans: JSON.parse(plans) };
    await writeFile(directory + '/report.json', JSON.stringify(report, null, 2));
    await writeFile(directory + '/report.md', '# Isolated five-client reliability probe\n\n' + report.transport + '. Synthetic setup includes 100 history reports per ruler.\n\n' + Object.entries(acceptance).map(([key, ok]) => `- [${ok ? 'x' : ' '}] ${key}`).join('\n') + '\n\n```json\n' + JSON.stringify(summary, null, 2) + '\n```\n\nSee report.json for real actions, errors, game-time lag, hardware and query plan. A passed local probe does not establish hosted capacity for 200 bots.\n');
    console.log(directory, JSON.stringify({ summary, acceptance, findings }));
    if (errors.length || !acceptance.no_duplicate_reports || !acceptance.core_p95_below_2s) process.exitCode = 1;
}
