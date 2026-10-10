import { mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, FULL_CAMP_COUNTS } from '../../src/features/frontier/domain/balance';
import { FrontierStore } from './store';
import { frontierHttp } from './http';
import { battleWorker } from './worker';

let dataDir = path.resolve(process.env.FRONTIER_DATA_DIR ?? '.peris-frontier');
const publicDir = await realpath(fileURLToPath(new URL('../../public/', import.meta.url)));
const checkPrivateDirectory = (directory: string) => {
    const relative = path.relative(publicDir, directory);
    if (!relative || !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) {
        throw new Error('FRONTIER_DATA_DIR must be outside public/, where files are served directly to browsers.');
    }
};
checkPrivateDirectory(dataDir);
const port = Number(process.env.FRONTIER_PORT ?? 8787);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('FRONTIER_PORT must be a valid port from 1024 to 65535.');
await mkdir(dataDir, { recursive: true });
dataDir = await realpath(dataDir);
checkPrivateDirectory(dataDir);
const lockPath = path.join(dataDir, 'server.lock');
try { await writeFile(lockPath, String(process.pid), { flag: 'wx' }); }
catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // Serialize stale-lock takeover so two simultaneous restarts cannot delete
    // one another's newly acquired live lock and open the same PGlite directory.
    const recoveryPath = path.join(dataDir, 'recovery.lock');
    await writeFile(recoveryPath, String(process.pid), { flag: 'wx' });
    try {
        const previousPid = Number(await readFile(lockPath, 'utf8'));
        let alive = true;
        if (Number.isSafeInteger(previousPid) && previousPid > 0) {
            try { process.kill(previousPid, 0); } catch (check) { if ((check as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
        }
        if (alive) throw new Error(`Another server owns ${dataDir}. Use that server or stop it before restarting.`);
        await rm(lockPath);
        await writeFile(lockPath, String(process.pid), { flag: 'wx' });
    } finally { await rm(recoveryPath, { force: true }); }
}

const worker = battleWorker();
const store = new FrontierStore(path.join(dataDir, 'database'), worker.resolve);
let stop = false, timer: ReturnType<typeof setTimeout> | undefined;
try {
    const config = structuredClone(DEFAULT_CONFIG);
    if (process.env.FRONTIER_FIXTURE === 'full') { config.fixture = 'full'; config.campCounts = FULL_CAMP_COUNTS; }
    if (process.env.FRONTIER_SEED) {
        const seed = Number(process.env.FRONTIER_SEED);
        if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('FRONTIER_SEED must be an unsigned 32-bit integer.');
        config.seed = seed;
    }
    await store.initialize(Date.now(), config);
    const origins = (process.env.FRONTIER_UI_ORIGINS ?? 'http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:4173,http://localhost:4173').split(',');
    const server = frontierHttp(store, port, origins);
    const tick = async () => {
        let processed = 0;
        try { processed = await store.advance(Date.now(), 16); }
        catch (error) { console.error('Frontier event rolled back; retrying:', error); }
        if (!stop) timer = setTimeout(tick, processed === 16 ? 0 : 500);
    };
    const shutdown = async () => {
        if (stop) return; stop = true; clearTimeout(timer);
        server.close();
        await store.close(); await worker.close(); await rm(lockPath, { force: true });
    };
    process.once('SIGINT', () => { void shutdown(); });
    process.once('SIGTERM', () => { void shutdown(); });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    console.log(`Frontier authority: http://127.0.0.1:${port} · ${store.config.fixture} realm · saved in ${dataDir}`);
    void tick();
} catch (error) {
    await store.close(); await worker.close(); await rm(lockPath, { force: true }); throw error;
}
