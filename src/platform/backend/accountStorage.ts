const project = (import.meta.env?.VITE_SUPABASE_URL || 'https://chtktuadlsnqgiisdcom.supabase.co').split('//')[1].split('/')[0];
const sessionKey = `peris-session:${project}`;
const nameKey = `peris-ruler:${project}`;
const activeKey = `peris-active-ruler:${project}`;
// Each live client gets a separate Auth broadcast/lock channel. The actual
// persisted token remains in this tab's sessionStorage through page refreshes.
export const authStorageKey = `${sessionKey}:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
const memory = new Map<string, string>();
const persistedKey = (key: string) => key.replace(authStorageKey, sessionKey);
export const tabAuthStorage = {
    getItem(key: string): string | null { const stored = persistedKey(key); try { return sessionStorage.getItem(stored) ?? memory.get(stored) ?? null; } catch { return memory.get(stored) ?? null; } },
    setItem(key: string, value: string) { const stored = persistedKey(key); memory.set(stored, value); try { sessionStorage.setItem(stored, value); } catch { /* Current tab stays usable without storage. */ } },
    removeItem(key: string) { const stored = persistedKey(key); memory.delete(stored); try { sessionStorage.removeItem(stored); } catch { /* No persisted token. */ } },
};
export function lastRulerName(): string { try { return localStorage.getItem(nameKey) || ''; } catch { return ''; } }
export function activeRulerName(): string { try { return sessionStorage.getItem(activeKey) || ''; } catch { return memory.get(activeKey) || ''; } }
export function rememberRuler(name: string) {
    memory.set(activeKey, name);
    try { localStorage.setItem(nameKey, name); } catch { /* Name entry still works. */ }
    try { sessionStorage.setItem(activeKey, name); } catch { /* Current tab remembers. */ }
}
export function leaveRuler() {
    memory.delete(activeKey);
    try { sessionStorage.removeItem(activeKey); } catch { /* Current tab is already cleared. */ }
}
