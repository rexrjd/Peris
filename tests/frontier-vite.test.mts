import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer, normalizePath, type ViteDevServer } from 'vite';

const repository = fileURLToPath(new URL('../', import.meta.url));

function get(port: number, url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const outgoing = request({ hostname: '127.0.0.1', port, path: url, method: 'GET' }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(Buffer.from(chunk)));
            response.on('error', reject);
            response.on('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString() }));
        });
        outgoing.on('error', reject);
        outgoing.setTimeout(15_000, () => outgoing.destroy(new Error(`Vite request timed out: ${url}`)));
        outgoing.end();
    });
}

test('the real Vite configuration blocks Frontier data through file and raw-import URLs without blocking the client', { timeout: 60_000 }, async t => {
    const scratch = path.resolve(repository, 'artifacts', 'frontier-tests');
    await mkdir(scratch, { recursive: true });
    const root = await realpath(scratch), directory = await mkdtemp(path.join(root, 'vite-test-'));
    // Square brackets are valid directory characters, not intentional glob syntax.
    const configuredData = path.join(directory, 'configured-data[probe]');
    const defaultNamedData = path.join(directory, '.peris-frontier');
    const previousData = process.env.FRONTIER_DATA_DIR;
    let server: ViteDevServer | undefined;
    t.after(async () => {
        try { await server?.close(); }
        finally {
            if (previousData === undefined) delete process.env.FRONTIER_DATA_DIR;
            else process.env.FRONTIER_DATA_DIR = previousData;
        }
        const target = await realpath(directory);
        assert.equal(path.dirname(target), root, 'Cleanup must stay inside artifacts/frontier-tests');
        await rm(target, { recursive: true, force: true });
    });
    await Promise.all([mkdir(configuredData), mkdir(defaultNamedData)]);
    const probe = 'Frontier-private-test-probe-6b35b976';
    const files = [path.join(configuredData, 'probe.txt'), path.join(defaultNamedData, 'probe.txt')];
    await Promise.all(files.map(file => writeFile(file, probe)));
    process.env.FRONTIER_DATA_DIR = configuredData;
    server = await createServer({
        root: repository,
        configFile: path.join(repository, 'vite.config.ts'),
        cacheDir: path.join(directory, 'vite-cache'),
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0, strictPort: true },
    });
    await server.listen();
    const address = server.httpServer?.address();
    assert.ok(address && typeof address !== 'string');

    for (const file of files) {
        const relative = `/${normalizePath(path.relative(repository, file))}`;
        const absolute = `/@fs/${normalizePath(file)}`;
        for (const url of [relative, absolute, `${relative}?raw&import`, `${absolute}?raw&import`]) {
            const reply = await get(address.port, url);
            assert.equal(reply.status, 403, `Private Frontier data must be forbidden: ${url}`);
            assert.ok(!reply.body.includes(probe), `Private data must not appear in an error response: ${url}`);
        }
    }

    const page = await get(address.port, '/');
    assert.equal(page.status, 200);
    assert.match(page.body, /<div id="root"><\/div>/);
    assert.match(page.body, /\/src\/main\.tsx/);
    const client = await get(address.port, '/src/main.tsx');
    assert.equal(client.status, 200);
    assert.match(client.body, /createRoot/);
    assert.match(client.body, /features\/.*App|app\/App/);
    assert.doesNotMatch(client.body, /import\(.*FrontierApp/);
    assert.ok(!client.body.includes(probe));
});

test('the authority rejects a data directory under public before creating it', { timeout: 20_000 }, async () => {
    const forbiddenDirectory = path.join(repository, 'public', `frontier-private-rejection-${randomUUID()}`);
    await assert.rejects(access(forbiddenDirectory), { code: 'ENOENT' });
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'server/frontier/index.ts'], {
        cwd: repository,
        windowsHide: true,
        timeout: 15_000,
        env: { ...process.env, FRONTIER_DATA_DIR: forbiddenDirectory },
    }).then(() => undefined, error => error as Error & { code?: number; stderr?: string });
    assert.ok(result, 'The authority must refuse a directory served as public assets');
    assert.equal(result.code, 1);
    assert.match(result.stderr ?? '', /FRONTIER_DATA_DIR must be outside public\//);
    await assert.rejects(access(forbiddenDirectory), { code: 'ENOENT' }, 'Rejection must happen before creating data files or directories');
});
