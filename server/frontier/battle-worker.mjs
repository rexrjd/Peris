import { parentPort } from 'node:worker_threads';
import { register } from 'tsx/esm/api';
register();
const { resolveRaidCombat } = await import('../../src/features/frontier/domain/combat.ts');
parentPort.on('message', ({ id, args }) => {
    try { parentPort.postMessage({ id, result: resolveRaidCombat(...args) }); }
    catch (error) { parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
});
