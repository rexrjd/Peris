/** Read receipts are isolated by ruler, creation date and game mode. */
export function readReportIds(key: string): Set<number> {
    try {
        const values: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
        return new Set(Array.isArray(values) ? values.filter(id => Number.isSafeInteger(id) && id > 0) : []);
    } catch { return new Set(); }
}
export function storeReadReportIds(key: string, ids: Set<number>) {
    try { localStorage.setItem(key, JSON.stringify([...ids])); }
    catch { /* The current session still remembers opened reports. */ }
}
