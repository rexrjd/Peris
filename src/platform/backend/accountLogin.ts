import type { World } from '../../shared/model/world';
import { isFaction, type Faction } from '../../features/factions/domain/factions';
export type AccountEntry = { mode: 'login'; password?: string } | { mode: 'create'; faction: Faction; creationId: string; password?: string };
export type RulerLogin = { player_id: string; display_name: string; created: boolean; password_protected?: boolean };
export type AccountBackend = {
    session: () => Promise<string | null>;
    freshSession: () => Promise<string>;
    login: (name: string, entry?: AccountEntry) => Promise<RulerLogin>;
    sync: () => Promise<void>;
    snapshot: () => Promise<World>;
    /** Real-time delay; injected by tests so recovery checks do not sleep. */
    wait?: (milliseconds: number) => Promise<void>;
};
export function rulerName(value: string): string {
    const name = value.trim();
    if (!/^[A-Za-z0-9 _-]{2,20}$/.test(name)) throw new Error('Choose 2–20 letters, numbers, spaces, _ or -.');
    return name;
}
export function validateCreationPassword(password: string | undefined): void {
    if (password && (Array.from(password).length < 12 || new TextEncoder().encode(password).length > 72)) throw new Error('Use a password of at least 12 characters and at most 72 UTF-8 bytes.');
}
/** Credentials are sent in the RPC body only, never in account preferences. */
export function accountEntryRequest(name: string, entry: AccountEntry) {
    const args = { p_display_name: name, p_mode: entry.mode, p_faction: entry.mode === 'create' ? entry.faction : null, p_creation_id: entry.mode === 'create' ? entry.creationId : null };
    return entry.password
        ? { functionName: 'peris_enter_password_account', args: { ...args, p_password: entry.password } }
        : { functionName: 'peris_enter_account', args };
}
/** Server diagnostics can contain submitted values; never show them after password entry. */
export function accountEntryError(cause: unknown, entry: AccountEntry): Error & { code?: string; status?: number } {
    const error = cause as { code?: string; status?: number; message?: string } | null;
    const message = error?.code === 'PT401' ? 'This ruler requires a valid password. Enter it and retry.'
        : entry.password ? 'The account could not be opened. Check your ruler name and password, then retry.'
        : error?.message || 'The shared world could not be reached. Retry the same ruler name.';
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code) && error.code !== entry.password ? error.code : undefined;
    return Object.assign(new Error(message), { code, status: typeof error?.status === 'number' ? error.status : undefined });
}
const expired = (error: unknown) => {
    const e = error as { code?: string; status?: number; message?: string };
    if (e.code === 'PT401') return false;
    return e.status === 401 || ['PGRST301', 'PGRST302', 'PGRST303', 'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found'].includes(e.code ?? '') || /JWT expired|Invalid Refresh Token/i.test(e.message ?? '');
};
export function expiredSession(error: unknown) { return expired(error); }
async function loadRulerState(backend: AccountBackend): Promise<World> {
    for (let attempt = 0; ; attempt++) {
        try { await backend.sync(); return await backend.snapshot(); }
        catch (error) {
            const e = error as { code?: string; status?: number };
            const transient = [0, 500, 502, 503, 504].includes(e.status ?? -1) || e.code === '57014' || error instanceof TypeError;
            if (attempt >= 2 || !transient || expired(error)) throw error;
            await (backend.wait ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms))))(500 * (attempt + 1));
        }
    }
}
/** One serialized attempt per tab; never infer ownership from the Auth UUID. */
export async function openRuler(value: string, backend: AccountBackend, entry: AccountEntry = { mode: 'login' }) {
    const name = rulerName(value);
    if (entry.mode === 'create' && (!isFaction(entry.faction) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.creationId))) throw new Error('Choose a race for your new account.');
    if (entry.mode === 'create') validateCreationPassword(entry.password);
    let session: string | null;
    try { session = await backend.session(); } catch (error) { if (!expired(error)) throw error; session = null; }
    if (!session) session = await backend.freshSession();
    let ruler: RulerLogin;
    try { ruler = await backend.login(name, entry); }
    catch (error) {
        if ((error as { code?: string }).code !== 'PT409' && !expired(error)) throw error;
        session = await backend.freshSession();
        ruler = await backend.login(name, entry);
    }
    if (typeof ruler?.player_id !== 'string' || typeof ruler.display_name !== 'string' || ruler.display_name.toLowerCase() !== name.toLowerCase()) throw new Error('The server opened a different ruler. Please retry.');
    // Settle offline queues before reading, so the first frame is current.
    const world = await loadRulerState(backend);
    if (!world?.players?.some(player => player.id === ruler.player_id && player.display_name === ruler.display_name) || !world.settlements?.some(city => city.owner_id === ruler.player_id) || !world.armies?.some(army => army.owner_id === ruler.player_id)) throw new Error('Your realm could not be loaded. Please retry the same name.');
    return { ruler, world, sessionId: session };
}
