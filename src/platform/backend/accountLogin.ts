import type { World } from '../../shared/model/world';
export type RulerLogin = { player_id: string; display_name: string; created: boolean };
export type AccountBackend = {
    session: () => Promise<string | null>;
    freshSession: () => Promise<string>;
    login: (name: string) => Promise<RulerLogin>;
    sync: () => Promise<void>;
    snapshot: () => Promise<World>;
};
export function rulerName(value: string): string {
    const name = value.trim();
    if (!/^[A-Za-z0-9 _-]{2,20}$/.test(name)) throw new Error('Choose 2–20 letters, numbers, spaces, _ or -.');
    return name;
}
const expired = (error: unknown) => {
    const e = error as { code?: string; status?: number; message?: string };
    return e.status === 401 || ['PGRST301', 'PGRST302', 'PGRST303', 'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found'].includes(e.code ?? '') || /JWT expired|Invalid Refresh Token/i.test(e.message ?? '');
};
export function expiredSession(error: unknown) { return expired(error); }
/** One serialized attempt per tab; never infer ownership from the Auth UUID. */
export async function openRuler(value: string, backend: AccountBackend) {
    const name = rulerName(value);
    let session: string | null;
    try { session = await backend.session(); } catch (error) { if (!expired(error)) throw error; session = null; }
    if (!session) session = await backend.freshSession();
    let ruler: RulerLogin;
    try { ruler = await backend.login(name); }
    catch (error) {
        if ((error as { code?: string }).code !== 'PT409' && !expired(error)) throw error;
        session = await backend.freshSession();
        ruler = await backend.login(name);
    }
    if (typeof ruler?.player_id !== 'string' || typeof ruler.display_name !== 'string' || ruler.display_name.toLowerCase() !== name.toLowerCase()) throw new Error('The server opened a different ruler. Please retry.');
    // Settle offline queues before reading, so the first frame is current.
    await backend.sync();
    const world = await backend.snapshot();
    if (!world?.players?.some(player => player.id === ruler.player_id && player.display_name === ruler.display_name) || !world.settlements?.some(city => city.owner_id === ruler.player_id) || !world.armies?.some(army => army.owner_id === ruler.player_id)) throw new Error('Your realm could not be loaded. Please retry the same name.');
    return { ruler, world, sessionId: session };
}
