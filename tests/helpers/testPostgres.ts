import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export function testConnection(value: string | undefined) {
    if (!value) throw new Error('Set PERIS_TEST_DATABASE_URL to an empty loopback peris_test_* database; production is forbidden.');
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
        || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        || !/^\/peris_test_[a-z0-9_]+$/i.test(url.pathname)
        || url.search || url.hash) throw new Error('Only an isolated loopback peris_test_* database is allowed.');
    return url;
}

export function testPostgres(value = process.env.PERIS_TEST_DATABASE_URL) {
    const url = testConnection(value);
    const executable = process.env.PERIS_PSQL_PATH || 'psql';
    const environment = (timeout: number) => ({
        ...process.env, PGHOST: url.hostname.replace(/[[\]]/g, ''), PGHOSTADDR: url.hostname === '[::1]' ? '::1' : '127.0.0.1',
        PGPORT: url.port || '5432', PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
        PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
        PGSERVICE: undefined, PGSERVICEFILE: undefined, PGAPPNAME: 'peris-isolated-test', PGOPTIONS: '-c timezone=UTC -c lock_timeout=0 -c statement_timeout=' + timeout,
    });
    const args = ['-X', '-w', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
    async function exec(sql: string, timeout = 8000): Promise<string> {
        const child = spawn(executable, args, { env: environment(timeout), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let output = '', errors = '';
        const timer = setTimeout(() => child.kill(), timeout + 5000);
        try {
            return await new Promise<string>((resolve, reject) => {
                child.stdout.on('data', data => { output += data; });
                child.stderr.on('data', data => { errors += data; });
                child.on('error', reject);
                child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(errors.trim() || 'Postgres client failed: ' + code)));
                child.stdin.end(sql);
            });
        } finally { clearTimeout(timer); }
    }
    async function json<T = any>(sql: string, timeout = 8000): Promise<T> { return JSON.parse((await exec(sql, timeout)).split(/\r?\n/).at(-1)!); }
    async function assertTarget() {
        const target = await json("select json_build_object('host',host(inet_server_addr()),'database',current_database(),'version',version())");
        if (!['127.0.0.1', '::1'].includes(target.host) || target.database !== decodeURIComponent(url.pathname.slice(1))) throw new Error('Connected server is not the requested isolated loopback database.');
        return target;
    }
    async function initialize() {
        await assertTarget();
        const count = await json("select json_build_object('tables',count(*))from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in('pg_catalog','information_schema')and n.nspname not like 'pg_toast%'and c.relkind in('r','p')");
        if (Number(count.tables)) throw new Error('Refusing to initialize a nonempty test database.');
        await exec("create schema auth;create table auth.users(id uuid primary key);do $$begin if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role;end if;end$$;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;");
        await exec(await readFile(process.env.PERIS_TEST_INSTALL_SQL || 'supabase/FRESH_INSTALL_V19.sql', 'utf8'), 60000);
    }
    async function hold(sql: string) {
        const child = spawn(executable, args, { env: environment(30000), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let errors = '';
        child.stderr.on('data', data => { errors += data; });
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { child.kill(); reject(new Error('Lock holder did not become ready')); }, 5000);
            child.on('error', error => { clearTimeout(timer); reject(error); });
            child.on('exit', code => { clearTimeout(timer); reject(new Error(errors || 'Lock holder exited: ' + code)); });
            child.stdout.on('data', data => { if (String(data).includes('PERIS_LOCK_READY')) { clearTimeout(timer); resolve(); } });
            child.stdin.write("begin;" + sql + ";select 'PERIS_LOCK_READY';\n");
        });
        return async () => {
            const timer = setTimeout(() => child.kill(), 3000);
            await new Promise<void>(resolve => { child.once('close', () => resolve()); child.stdin.end("rollback;\n\\q\n"); });
            clearTimeout(timer);
        };
    }
    return { exec, json, initialize, assertTarget, hold };
}
