import type { Faction } from '../features/factions/domain/factions';
import type { FrontierCommand, FrontierSnapshot } from '../features/frontier/domain/types';

export class FrontierApiError extends Error {
    constructor(message: string, public readonly status = 0) { super(message); }
    get uncertain() { return this.status === 0 || this.status >= 500; }
}

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = window.setTimeout(abort, 15_000);
    try {
        const response = await fetch(`/api/frontier/${path}`, {
            method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
        });
        let result: unknown;
        try { result = await response.json(); }
        catch { throw new FrontierApiError('The Frontier server did not return a valid response.', response.status >= 400 ? response.status : 503); }
        if (!response.ok) {
            const message = result && typeof result === 'object' && 'error' in result ? String(result.error) : 'The request could not be completed.';
            throw new FrontierApiError(message, response.status);
        }
        return result as T;
    } catch (error) {
        if (error instanceof FrontierApiError) throw error;
        throw new FrontierApiError('Cannot reach the Frontier server. Check that it is running and try again.');
    } finally {
        window.clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
    }
}

export const frontierSession = (signal?: AbortSignal) => request<{ authenticated: boolean }>('session', undefined, signal);
export const frontierState = (signal?: AbortSignal) => request<FrontierSnapshot>('state', undefined, signal);
export const joinFrontier = (name: string, faction: Faction) => request<{ ok: true }>('join', { name, faction });
// A caller retains this ID after a lost response, so retrying cannot spend or send twice.
export const commandFrontier = (requestId: string, command: FrontierCommand) => request<{ ok: true }>('command', { requestId, command });
