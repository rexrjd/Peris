import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { FrontierStore, RuleError } from './store';

const COOKIE = 'peris_frontier';
function token(request: IncomingMessage) {
    const value = request.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function json(response: ServerResponse, status: number, data: unknown) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(data));
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
    if (!request.headers['content-type']?.startsWith('application/json')) throw new RuleError('Send JSON commands.');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > 16_384) throw new RuleError('The command is too large.');
        chunks.push(Buffer.from(chunk));
    }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString()); }
    catch { throw new RuleError('Invalid JSON.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RuleError('Send a JSON object.');
    return value as Record<string, unknown>;
}

export function frontierHttp(store: FrontierStore, port: number, allowedOrigins: string[]) {
    const origins = new Set(allowedOrigins.concat([`http://127.0.0.1:${port}`, `http://localhost:${port}`]));
    return createServer(async (request, response) => {
        try {
            // Loopback binding, host validation and strict cookies keep this local
            // development identity separate from any existing Supabase login.
            if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host ?? '') ||
                request.headers.origin && !origins.has(request.headers.origin)) {
                json(response, 403, { error: 'This local server only accepts the configured Peris origin.' }); return;
            }
            const path = new URL(request.url ?? '/', `http://127.0.0.1:${port}`).pathname;
            if (request.method === 'GET' && path === '/api/frontier/health') { json(response, 200, { ok: true, fixture: store.config.fixture }); return; }
            let session = token(request);
            if ((path === '/api/frontier/session' && request.method === 'GET') || (path === '/api/frontier/join' && request.method === 'POST')) {
                if (!session) {
                    session = randomBytes(32).toString('hex');
                    response.setHeader('Set-Cookie', `${COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/api/frontier; Max-Age=31536000`);
                }
                if (path.endsWith('/session')) { json(response, 200, { authenticated: Boolean(await store.ownerForSession(hash(session))) }); return; }
                const input = await body(request);
                await store.join(hash(session), input.name, input.faction);
                json(response, 200, { ok: true }); return;
            }
            const owner = session ? await store.ownerForSession(hash(session)) : null;
            if (!owner) { json(response, 401, { error: 'Create your Frontier ruler to continue.' }); return; }
            if (path === '/api/frontier/state' && request.method === 'GET') { json(response, 200, await store.snapshot(owner)); return; }
            if (path === '/api/frontier/command' && request.method === 'POST') {
                const input = await body(request);
                await store.command(owner, input.requestId, input.command);
                json(response, 200, { ok: true }); return;
            }
            json(response, 404, { error: 'Endpoint not found.' });
        } catch (error) {
            if (error instanceof RuleError) { json(response, 400, { error: error.message }); return; }
            console.error('Frontier request failed:', error);
            json(response, 500, { error: 'The server could not complete this request. Your command can be retried with the same request ID.' });
        }
    });
}
