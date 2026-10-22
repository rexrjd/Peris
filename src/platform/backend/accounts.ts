import { supabase } from './supabase';
import { openRuler, accountEntryRequest, accountEntryError, type AccountBackend, type RulerLogin, type AccountEntry } from './accountLogin';
import type { World } from '../../shared/model/world';
import { accountResponse } from './accountResponse';
const ACCOUNT_UPGRADE = 'Install supabase/UPGRADE_TO_V15.sql to enable the account browser and race selection. Your existing accounts and progress are preserved.';
const PASSWORD_UPGRADE = 'Password access is not available on this server yet. Ask the world administrator to enable it, then retry.';
const backend: AccountBackend = {
    async session() { const { data, error } = await supabase.auth.getSession(); if (error) throw error; return data.session?.user.id ?? null; },
    async freshSession() {
        const old = await supabase.auth.getSession();
        if (old.data.session) { const { error } = await supabase.auth.signOut({ scope: 'local' }); if (error) throw error; }
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
        if (!data.session) throw new Error('The browser session could not be opened. Retry the same ruler name.');
        return data.session.user.id;
    },
    async login(name, entry = { mode: 'login' }) {
        const request = accountEntryRequest(name, entry);
        return accountResponse(await supabase.rpc(request.functionName, request.args)) as RulerLogin;
    },
    async sync() { accountResponse(await supabase.rpc('sync_my_state')); },
    async snapshot() { return accountResponse(await supabase.rpc('peris_snapshot')) as World; },
};
let pending: { name: string; entry: AccountEntry; result: ReturnType<typeof openRuler> } | null = null;
export function loginAccount(name: string, entry: AccountEntry = { mode: 'login' }): ReturnType<typeof openRuler> {
    const requested = name.trim().toLowerCase();
    if (pending) {
        if (pending.name === requested && pending.entry.mode === entry.mode && pending.entry.password === entry.password
            && (entry.mode === 'login' || pending.entry.mode === 'create' && pending.entry.faction === entry.faction && pending.entry.creationId === entry.creationId)) return pending.result;
        return Promise.reject(new Error('A ruler is already being opened. Wait for that login to finish.'));
    }
    const result = openRuler(name, backend, entry).catch(error => {
        if ((error as { code?: string }).code === 'PGRST202') throw new Error(entry.password ? PASSWORD_UPGRADE : ACCOUNT_UPGRADE);
        throw accountEntryError(error, entry);
    }).finally(() => { pending = null; });
    pending = { name: requested, entry, result };
    return result;
}
