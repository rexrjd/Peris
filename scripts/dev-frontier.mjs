import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// No global tools, shell quoting or extra npm package needed on Windows.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiPort = process.env.FRONTIER_UI_PORT ?? '5174';
if (!/^\d+$/.test(uiPort) || Number(uiPort) < 1024 || Number(uiPort) > 65535) throw new Error('Invalid FRONTIER_UI_PORT.');
const children = [];
let stopping = false;
function stop(code = 0) {
    if (stopping) return; stopping = true;
    for (const child of children) if (!child.killed) child.kill();
    process.exitCode = code;
}
for (const args of [
    ['--import', 'tsx', 'server/frontier/index.ts'],
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', uiPort, '--strictPort'],
]) {
    const env = { ...process.env, FRONTIER_UI_ORIGINS: process.env.FRONTIER_UI_ORIGINS ?? `http://127.0.0.1:${uiPort},http://localhost:${uiPort}` };
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true, env });
    children.push(child);
    child.on('error', error => { console.error(error); stop(1); });
    child.on('exit', code => { if (!stopping) stop(code ?? 1); });
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
console.log(`Open http://127.0.0.1:${uiPort}/?frontier=1 · Keep this terminal open; closing the browser is safe.`);
