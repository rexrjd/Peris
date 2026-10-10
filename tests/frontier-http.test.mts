import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { request, type IncomingHttpHeaders } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { battleWorker } from '../server/frontier/worker';
import { resolveRaidCombat } from '../src/features/frontier/domain/combat';
import { troopCost } from '../src/features/frontier/domain/balance';
import { RESOURCES } from '../src/shared/model/resources';
import type { FrontierSnapshot } from '../src/features/frontier/domain/types';

const repository = fileURLToPath(new URL('../', import.meta.url));
type Reply<T> = { status: number; headers: IncomingHttpHeaders; body: T };
type RequestOptions = { method?: string; cookie?: string; origin?: string; host?: string; body?: unknown; raw?: string; contentType?: string };

function api<T = Record<string, unknown>>(port: number, endpoint: string, options: RequestOptions = {}): Promise<Reply<T>> {
    const payload = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    return new Promise((resolve, reject) => {
        const headers: Record<string, string> = {};
        if (options.cookie) headers.Cookie = options.cookie;
        if (options.origin) headers.Origin = options.origin;
        if (options.host) headers.Host = options.host;
        if (payload !== undefined) {
            headers['Content-Type'] = options.contentType ?? 'application/json';
            headers['Content-Length'] = String(Buffer.byteLength(payload));
        }
        const outgoing = request({ hostname: '127.0.0.1', port, path: `/api/frontier/${endpoint}`, method: options.method ?? 'GET', headers }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(Buffer.from(chunk)));
            response.on('error', reject);
            response.on('end', () => {
                try { resolve({ status: response.statusCode!, headers: response.headers, body: JSON.parse(Buffer.concat(chunks).toString()) as T }); }
                catch (error) { reject(error); }
            });
        });
        outgoing.on('error', reject);
        outgoing.setTimeout(15_000, () => outgoing.destroy(new Error('Frontier HTTP request timed out')));
        outgoing.end(payload);
    });
}

async function availablePort(): Promise<number> {
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
    const address = reservation.address();
    assert.ok(address && typeof address !== 'string');
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    assert.ok(address.port >= 1024);
    return address.port;
}

function waitForExit(child: ChildProcess, timeout: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise(resolve => {
        const exited = () => { clearTimeout(timer); resolve(true); };
        const timer = setTimeout(() => { child.off('exit', exited); resolve(false); }, timeout);
        child.once('exit', exited);
    });
}

test('local HTTP authority enforces sessions, origins, ownership, validation, and retry idempotency', { timeout: 90_000 }, async t => {
    const scratch = path.resolve(repository, 'artifacts', 'frontier-tests');
    await mkdir(scratch, { recursive: true });
    const root = await realpath(scratch), directory = await mkdtemp(path.join(root, 'http-test-'));
    let child: ChildProcess | undefined;
    t.after(async () => {
        if (child && child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');
            if (!await waitForExit(child, 5000)) { child.kill('SIGKILL'); assert.ok(await waitForExit(child, 5000), 'The test server must stop before database cleanup'); }
        }
        const target = await realpath(directory);
        assert.equal(path.dirname(target), root, 'Cleanup must stay inside artifacts/frontier-tests');
        await rm(target, { recursive: true, force: true });
    });
    const port = await availablePort(), origin = 'http://127.0.0.1:5174';
    let logs = '', spawnFailure: Error | undefined;
    child = spawn(process.execPath, ['--import', 'tsx', 'server/frontier/index.ts'], {
        cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FRONTIER_DATA_DIR: directory, FRONTIER_PORT: String(port), FRONTIER_FIXTURE: 'development', FRONTIER_SEED: '1346720329', FRONTIER_UI_ORIGINS: origin },
    });
    child.on('error', error => { spawnFailure = error; });
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { logs = (logs + chunk.toString()).slice(-20000); });
    const deadline = Date.now() + 45_000;
    while (!logs.includes('Frontier authority:')) {
        if (spawnFailure) throw spawnFailure;
        assert.equal(child.exitCode, null, `Server exited before becoming ready:\n${logs}`);
        assert.ok(Date.now() < deadline, `Server failed to start:\n${logs}`);
        await delay(100);
    }

    const health = await api(port, 'health');
    assert.equal(health.status, 200); assert.equal(health.body.ok, true);
    assert.equal(health.headers['cache-control'], 'no-store');
    assert.equal(health.headers['x-content-type-options'], 'nosniff');
    assert.equal((await api(port, 'state')).status, 401);
    assert.equal((await api(port, 'command', { method: 'POST', body: { requestId: 'anonymous-command', command: { type: 'recruit', unit: 'infantry', count: 1 } } })).status, 401);
    assert.equal((await api(port, 'health', { origin: 'https://untrusted.invalid' })).status, 403);
    assert.equal((await api(port, 'health', { host: `untrusted.invalid:${port}` })).status, 403);

    const session = await api(port, 'session', { origin });
    assert.equal(session.status, 200); assert.equal(session.body.authenticated, false);
    const setCookie = session.headers['set-cookie']?.[0];
    assert.ok(setCookie);
    assert.match(setCookie, /^peris_frontier=[a-f0-9]{64};/);
    assert.match(setCookie, /; HttpOnly;/); assert.match(setCookie, /; SameSite=Strict;/); assert.match(setCookie, /; Path=\/api\/frontier;/);
    const cookie = setCookie.split(';')[0];
    assert.equal((await api(port, 'state', { cookie })).status, 401);
    assert.equal((await api(port, 'join', { method: 'POST', cookie, origin, body: { name: 'X', faction: 'persian' } })).status, 400);
    assert.equal((await api(port, 'join', { method: 'POST', cookie, origin, body: { name: 'Protocol ruler', faction: 'invalid' } })).status, 400);
    assert.equal((await api(port, 'join', { method: 'POST', cookie, origin: 'https://untrusted.invalid', body: { name: 'Protocol ruler', faction: 'persian' } })).status, 403);
    assert.equal((await api(port, 'join', { method: 'POST', cookie, origin, body: { name: 'Protocol ruler', faction: 'persian' } })).status, 200);
    const authenticated = await api(port, 'session', { cookie, origin });
    assert.equal(authenticated.body.authenticated, true);
    assert.equal(authenticated.headers['set-cookie'], undefined, 'An existing valid token should remain stable');
    const initial = await api<FrontierSnapshot>(port, 'state', { cookie, origin });
    assert.equal(initial.status, 200); assert.equal(initial.body.village.name, 'Protocol ruler');
    assert.equal(initial.body.campCount, 14);
    assert.deepEqual(initial.body.village.troops, { infantry: 0, archers: 0, cavalry: 0 });
    assert.equal((await api(port, 'join', { method: 'POST', cookie, body: { name: 'Ignored new name', faction: 'roman' } })).status, 200);
    assert.equal((await api<FrontierSnapshot>(port, 'state', { cookie })).body.village.id, initial.body.village.id);

    for (const options of [
        { raw: '{' }, { raw: '[]' }, { raw: 'null' }, { body: {}, contentType: 'text/plain' },
        { body: { requestId: 'short', command: { type: 'recruit', unit: 'infantry', count: 1 } } },
        { body: { requestId: 'negative-recruit-01', command: { type: 'recruit', unit: 'infantry', count: -1 } } },
        { body: { requestId: 'unknown-command-01', command: { type: 'unknown' } } },
        { body: { requestId: 'oversized-command', padding: 'x'.repeat(17_000) } },
    ]) {
        const invalid = await api(port, 'command', { ...options, method: 'POST', cookie, origin });
        assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
        assert.equal(typeof invalid.body.error, 'string');
    }
    const before = (await api<FrontierSnapshot>(port, 'state', { cookie })).body;
    assert.equal(before.training.length, 0);
    const requestId = 'protocol-recruit-0001', command = { type: 'recruit', unit: 'infantry', count: 100 };
    const replies = await Promise.all([
        api(port, 'command', { method: 'POST', cookie, origin, body: { requestId, command } }),
        api(port, 'command', { method: 'POST', cookie, origin, body: { command: { count: 100, unit: 'infantry', type: 'recruit' }, requestId } }),
    ]);
    replies.forEach(reply => assert.equal(reply.status, 200, JSON.stringify(reply.body)));
    assert.equal((await api(port, 'command', { method: 'POST', cookie, body: { requestId, command: { ...command, count: 101 } } })).status, 400);
    const after = (await api<FrontierSnapshot>(port, 'state', { cookie })).body;
    assert.equal(after.training.length, 1); assert.equal(after.training[0].count, 100);
    const cost = troopCost({ infantry: 100, archers: 0, cavalry: 0 });
    for (const resource of RESOURCES) {
        const expected = before.village.resources[resource] - cost[resource] + before.config.villageRates[resource] * (after.now - before.now) / 60000;
        assert.ok(Math.abs(after.village.resources[resource] - expected) < 1e-6, `${resource} must be spent exactly once`);
    }
    assert.equal((await api(port, 'command', { method: 'POST', cookie, origin: 'https://untrusted.invalid', body: { requestId: 'blocked-recruit-001', command } })).status, 403);

    const otherSession = await api(port, 'session');
    const otherCookie = otherSession.headers['set-cookie']![0].split(';')[0];
    assert.notEqual(otherCookie, cookie);
    assert.equal((await api(port, 'join', { method: 'POST', cookie: otherCookie, body: { name: 'Second protocol ruler', faction: 'elf' } })).status, 200);
    const other = (await api<FrontierSnapshot>(port, 'state', { cookie: otherCookie })).body;
    assert.notEqual(other.village.id, after.village.id); assert.equal(other.training.length, 0);
    assert.ok(!JSON.stringify(other).includes(after.village.id), 'Another owner must not receive private village or queue data');
    assert.equal((await api(port, 'command', { method: 'POST', cookie: otherCookie, body: { requestId, command: { ...command, count: 1 } } })).status, 200, 'Request IDs are scoped to each owner');
    assert.equal((await api(port, 'missing', { cookie })).status, 404);
    assert.ok(!logs.includes('Frontier request failed:'), logs);
});

test('battle worker resolves concurrent computations, returns command errors, and stays usable', { timeout: 45_000 }, async t => {
    const worker = battleWorker();
    t.after(() => worker.close());
    const attackers = { infantry: 80, archers: 24, cavalry: 12 }, defenders = { infantry: 50, archers: 12, cavalry: 6 };
    const args = [attackers, defenders, { col: 0, row: 0 }, 'low'] as const;
    const expected = resolveRaidCombat(...args);
    const [first, second] = await Promise.all([worker.resolve(...args), worker.resolve(...args)]);
    assert.deepEqual(first, expected); assert.deepEqual(second, expected);
    assert.ok(first.battleSeconds > 0);
    assert.ok(first.survivors.infantry < attackers.infantry || first.defenders.infantry < defenders.infantry);
    await assert.rejects(worker.resolve({ ...attackers, infantry: -1 }, defenders, { col: 0, row: 0 }, 'low'), /nonnegative whole numbers/);
    assert.deepEqual(await worker.resolve(...args), expected);
    assert.deepEqual(attackers, { infantry: 80, archers: 24, cavalry: 12 }, 'Worker inputs must not mutate the caller');
});
