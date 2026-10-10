import { createClient } from '@supabase/supabase-js';
import { authStorageKey, tabAuthStorage } from './accountStorage';
const url = import.meta.env.VITE_SUPABASE_URL || 'https://chtktuadlsnqgiisdcom.supabase.co';
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_8Jn_YIOHadU0ynPhR8IW9w_FHXIKNWl';
// A publishable browser key. Server rules, not this key, authorize game actions.
const boundedFetch: typeof fetch = async (input, init) => {
    const controller = new AbortController(), original = init?.signal;
    const abort = () => controller.abort(original?.reason);
    if (original?.aborted) abort(); else original?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Connection timed out. Retry the same ruler name.')), 20000);
    try { return await fetch(input, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timer); original?.removeEventListener('abort', abort); }
};
export const supabase = createClient(url, key, {
    auth: { storage: tabAuthStorage, storageKey: authStorageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: { fetch: boundedFetch },
});
