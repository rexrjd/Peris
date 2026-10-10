import { Worker } from 'node:worker_threads';
import type { resolveRaidCombat } from '../../src/features/frontier/domain/combat';

/** A single reusable worker keeps tactical simulation off the HTTP event loop.
 * The store awaits its result inside the arrival transaction. Failed computation
 * rolls the event back, leaving its due timestamp available for retry.
 */
export function battleWorker() {
    const worker = new Worker(new URL('./battle-worker.mjs', import.meta.url));
    type Result = ReturnType<typeof resolveRaidCombat>;
    const pending = new Map<number, { resolve: (value: Result) => void; reject: (error: Error) => void }>();
    let sequence = 0, failure: Error | undefined;
    const fail = (error: Error) => {
        failure = error;
        for (const task of pending.values()) task.reject(error);
        pending.clear();
    };
    worker.on('error', fail);
    worker.on('exit', code => fail(new Error(`Battle worker exited (${code}); restart the server.`)));
    worker.on('message', ({ id, result, error }: { id: number; result: Result; error?: string }) => {
        const task = pending.get(id); pending.delete(id);
        if (error) task?.reject(new Error(error)); else task?.resolve(result);
    });
    return {
        resolve: (...args: Parameters<typeof resolveRaidCombat>): Promise<Result> => new Promise((resolve, reject) => {
            if (failure) { reject(failure); return; }
            const id = ++sequence; pending.set(id, { resolve, reject }); worker.postMessage({ id, args });
        }),
        close: () => worker.terminate(),
    };
}
