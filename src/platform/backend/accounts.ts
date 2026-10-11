import { supabase } from './supabase';
import { openRuler, type AccountBackend, type RulerLogin, type AccountEntry } from './accountLogin';
import type { World } from '../../shared/model/world';
const ACCOUNT_UPGRADE = 'Install supabase/UPGRADE_TO_V15.sql to enable the account browser and race selection. Your existing accounts and progress are preserved.';
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
        const { data, error } = await supabase.rpc('peris_enter_account', { p_display_name: name, p_mode: entry.mode, p_faction: entry.mode === 'create' ? entry.faction : null, p_creation_id: entry.mode === 'create' ? entry.creationId : null });
        if (error) throw error; return data as RulerLogin;
    },
    async sync() { const { error } = await supabase.rpc('sync_my_state'); if (error) throw error; },
    async snapshot() { const { data, error } = await supabase.rpc('peris_snapshot'); if (error) throw error; return data as World; },
};
let pending: { name: string; result: ReturnType<typeof openRuler> } | null = null;
export function loginAccount(name: string, entry: AccountEntry = { mode: 'login' }): ReturnType<typeof openRuler> {
    const requested = JSON.stringify([name.trim().toLowerCase(), entry]);
    if (pending) {
        if (pending.name === requested) return pending.result;
        return Promise.reject(new Error('A ruler is already being opened. Wait for that login to finish.'));
    }
    const result = openRuler(name, backend, entry).catch(error => {
        if ((error as { code?: string }).code === 'PGRST202') throw new Error(ACCOUNT_UPGRADE);
        throw Object.assign(new Error(error?.message || 'The shared world could not be reached. Retry the same ruler name.'), { code: error?.code, status: error?.status });
    }).finally(() => { pending = null; });
    pending = { name: requested, result };
    return result;
}
